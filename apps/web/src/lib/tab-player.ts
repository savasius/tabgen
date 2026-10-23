import type { TabNote } from '@/api'
import type { PlayerApi } from '@/player'

function midiHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

function voice(
  ctx: AudioContext,
  dest: AudioNode,
  n: TabNote,
  when: number,
  dur: number,
  legato: boolean,
) {
  const f0 = midiHz(n.midi)
  const bend = (n.techniques ?? []).find((t) => t.type === 'bend')
  const qt = bend
    ? Math.max(1, Math.min(12, bend.quarter_tones ?? Math.round((bend.cents ?? 100) / 50)))
    : 0
  const vibrato = (n.techniques ?? []).some((t) => t.type === 'vibrato')
  const palm = (n.techniques ?? []).some((t) => t.type === 'palmMute')

  const osc = ctx.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.setValueAtTime(f0, when)
  if (qt) {
    const f1 = f0 * 2 ** (qt / 24)
    osc.frequency.linearRampToValueAtTime(f1, when + Math.min(0.16, dur * 0.45))
  }
  if (vibrato) {
    const lfo = ctx.createOscillator()
    const depth = ctx.createGain()
    lfo.frequency.value = 5.6
    depth.gain.value = f0 * 0.012
    lfo.connect(depth).connect(osc.frequency)
    lfo.start(when)
    lfo.stop(when + dur + 0.04)
  }

  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.Q.value = 1.1
  filter.frequency.setValueAtTime(palm ? 520 : legato ? 1600 : 2400, when)
  filter.frequency.exponentialRampToValueAtTime(palm ? 260 : 700, when + Math.max(0.08, dur))

  const g = ctx.createGain()
  const peak = palm ? 0.1 : 0.2
  g.gain.setValueAtTime(0.0001, when)
  g.gain.exponentialRampToValueAtTime(peak, when + (legato ? 0.018 : 0.007))
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur)

  osc.connect(filter).connect(g).connect(dest)
  osc.start(when)
  osc.stop(when + dur + 0.03)
  return osc
}

/** Mechanical guitar from the extracted note list. Always available; alphaTab synth may replace it. */
export function noteListPlayer(notes: TabNote[], duration: number): PlayerApi & { destroy(): void } {
  const sorted = [...notes].sort((a, b) => a.start - b.start)
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let playing = false
  let rate = 1
  let songTime = 0
  let songOrigin = 0
  let ctxOrigin = 0
  let timer: ReturnType<typeof setInterval> | null = null
  let scheduledUntil = -1
  const live = new Set<OscillatorNode>()

  const nowSong = () => {
    if (!playing || !ctx) return songTime
    return songOrigin + Math.max(0, ctx.currentTime - ctxOrigin) * rate
  }

  const stopVoices = () => {
    for (const o of live) {
      try { o.stop() } catch { /* already stopped */ }
    }
    live.clear()
  }

  const schedule = () => {
    if (!ctx || !master || !playing) return
    const t = nowSong()
    if (t >= duration) {
      playing = false
      songTime = duration
      if (timer) clearInterval(timer)
      timer = null
      stopVoices()
      return
    }
    const horizon = t + 0.4
    for (const n of sorted) {
      if (n.start < scheduledUntil - 1e-4) continue
      if (n.start > horizon) break
      const when = ctx.currentTime + (n.start - t) / Math.max(0.05, rate)
      if (when < ctx.currentTime - 0.02) continue
      const dur = Math.max(0.08, (n.end - n.start) / Math.max(0.05, rate))
      let prev: TabNote | undefined
      for (let i = sorted.length - 1; i >= 0; i--) {
        const p = sorted[i]
        if (p.string === n.string && p.start < n.start - 1e-4) { prev = p; break }
      }
      const legato = !!prev && (prev.techniques ?? []).some((x) => x.type === 'hammer' || x.type === 'pull' || x.type === 'slide')
      const osc = voice(ctx, master, n, Math.max(ctx.currentTime, when), dur, legato)
      live.add(osc)
      osc.onended = () => live.delete(osc)
    }
    scheduledUntil = horizon
  }

  const arm = () => {
    if (!ctx) {
      ctx = new AudioContext()
      master = ctx.createGain()
      master.gain.value = 0.85
      master.connect(ctx.destination)
    }
    void ctx.resume()
    songOrigin = songTime
    ctxOrigin = ctx.currentTime
    scheduledUntil = songTime - 0.002
    if (timer) clearInterval(timer)
    schedule()
    timer = setInterval(schedule, 40)
  }

  return {
    play: () => { playing = true; arm() },
    pause: () => {
      playing = false
      songTime = nowSong()
      if (timer) clearInterval(timer)
      timer = null
      stopVoices()
    },
    seek: (t) => {
      songTime = Math.max(0, Math.min(duration, t))
      if (playing) {
        stopVoices()
        arm()
      }
    },
    time: nowSong,
    setRate: (r) => {
      if (playing) {
        songTime = nowSong()
        songOrigin = songTime
        if (ctx) ctxOrigin = ctx.currentTime
      }
      rate = r
    },
    isPlaying: () => playing,
    destroy: () => {
      playing = false
      if (timer) clearInterval(timer)
      timer = null
      stopVoices()
      void ctx?.close()
      ctx = null
    },
  }
}

/** Song seconds ↔ alphaTab ticks. The alphaTex has one quarter note per analysis beat, so
 *  alphaTab's own milliseconds are not song time (pickup before beat 1, tempo drift). */
export interface TickMap {
  toTick(t: number): number
  fromTick(tick: number): number
}

async function alphaTabSynthPlayer(
  host: HTMLElement,
  tex: string,
  map?: TickMap,
): Promise<PlayerApi & { destroy(): void }> {
  const alphaTab = await import('@coderline/alphatab')
  const settings = new alphaTab.Settings()
  settings.core.engine = 'svg'
  settings.core.fontDirectory = '/font/'
  settings.core.useWorkers = false
  settings.display.staveProfile = alphaTab.StaveProfile.Tab
  settings.display.scale = 0.25
  settings.player.enablePlayer = true
  settings.player.enableCursor = false
  settings.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer
  settings.player.soundFont = '/soundfont/sonivox.sf2'
  settings.player.scrollMode = alphaTab.ScrollMode.Off
  settings.player.scrollElement = host
  const at = new alphaTab.AlphaTabApi(host, settings)
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('tab synth timeout')), 12000)
    let settled = false
    at.error.on((e: Error) => {
      if (settled) return
      settled = true
      clearTimeout(t)
      reject(e)
    })
    at.playerReady.on(() => {
      if (settled) return
      settled = true
      clearTimeout(t)
      resolve()
    })
    try {
      at.tex(tex)
    } catch (e) {
      settled = true
      clearTimeout(t)
      reject(e)
    }
  })
  const Playing = alphaTab.synth.PlayerState.Playing
  return {
    play: () => { at.play() },
    pause: () => { at.pause() },
    seek: (t) => {
      if (map) at.tickPosition = Math.max(0, map.toTick(t))
      else at.timePosition = Math.max(0, t) * 1000
    },
    time: () => (map ? map.fromTick(at.tickPosition || 0) : (at.timePosition || 0) / 1000),
    setRate: (r) => { at.playbackSpeed = r },
    isPlaying: () => at.playerState === Playing,
    destroy: () => {
      try { at.pause() } catch { /* ignore */ }
      try { at.destroy() } catch { /* ignore */ }
    },
  }
}

/**
 * Prefer alphaTab's SONiVOX guitar synth from `analysis.tab.alpha_tex` (fed to `at.tex` unchanged).
 * Fall back to a Web Audio pluck of `tab.notes` if the soundfont player is not ready.
 */
export function createTabGuitarPlayer(opts: {
  host: HTMLElement | null
  tex?: string | null
  notes: TabNote[]
  duration: number
  map?: TickMap
}): PlayerApi & { destroy(): void } {
  const fallback = noteListPlayer(opts.notes, opts.duration)
  let primary: (PlayerApi & { destroy(): void }) | null = null
  let gone = false
  let rate = 1

  if (opts.host && opts.tex) {
    void alphaTabSynthPlayer(opts.host, opts.tex, opts.map).then((p) => {
      if (gone) {
        p.destroy()
        return
      }
      const t = fallback.time()
      const playing = fallback.isPlaying()
      fallback.pause()
      p.setRate(rate)
      p.seek(t)
      primary = p
      if (playing) p.play()
    }).catch(() => { /* keep the note-list guitar */ })
  }

  const active = () => primary ?? fallback
  return {
    play: () => active().play(),
    pause: () => active().pause(),
    seek: (t) => active().seek(t),
    time: () => active().time(),
    setRate: (r) => { rate = r; active().setRate(r) },
    isPlaying: () => active().isPlaying(),
    destroy: () => {
      gone = true
      try { primary?.destroy() } catch { /* ignore */ }
      fallback.destroy()
    },
  }
}
