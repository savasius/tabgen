import { useEffect, useMemo, useRef, useState } from 'react'
import { Headphones, Mic, MicOff } from 'lucide-react'
import type { Section } from '@/api'
import { useSong, soundingSpelling } from './song-session'
import { useApp, type TKey } from '@/lib/store'
import { micErrorKey, openMic, newAudioContext } from '@/lib/mic'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Transport } from '@/components/app/Transport'
import { sectionNames, shownChord } from '@/lib/display'
import { detectPitch, rms } from '@/lib/pitch'
import { BeatScore, chordMatch, chroma, noteMatch } from '@/lib/playalong'
import { shiftChordLabel } from '@/lib/tab-edit'
import { cn } from '@/lib/utils'

type Verdict = 'hit' | 'miss' | null

function beatAt(grid: { t: number; end: number }[], t: number): number {
  let lo = 0
  let hi = grid.length - 1
  if (!grid.length || t < grid[0].t || t >= grid[hi].end) return -1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (grid[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

export function PlayAlong() {
  const { t, settings } = useApp()
  const s = useSong()
  const a = s.analysis
  const [section, setSection] = useState<Section | 'all'>('all')
  const [headphones, setHeadphones] = useState(true)
  const [mode, setMode] = useState<'chords' | 'notes'>('chords')
  const [listening, setListening] = useState(false)
  const [micErr, setMicErr] = useState<string | null>(null)
  const [latency, setLatency] = useState(() => Number(localStorage.getItem('tabgen.latencyMs') ?? 120))
  const [, setTick] = useState(0)
  const names = sectionNames(a.sections, t)
  const score = useRef(new BeatScore())
  const live = useRef({ time: s.time, playing: s.playing, mode, latency, a, transpose: s.transpose })
  live.current = { time: s.time, playing: s.playing, mode, latency, a, transpose: s.transpose }

  useEffect(() => { localStorage.setItem('tabgen.latencyMs', String(latency)) }, [latency])
  useEffect(() => { score.current.reset(); setTick((x) => x + 1) }, [a.id, a.viewPart, mode])

  useEffect(() => {
    if (!listening) return
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    let timer = 0
    let stopped = false
    const run = async () => {
      try {
        stream = await openMic({ echoCancellation: false, noiseSuppression: false, autoGainControl: false })
        if (stopped) { stream.getTracks().forEach((tr) => tr.stop()); return }
        ctx = newAudioContext()
        await ctx.resume()
        const an = ctx.createAnalyser()
        an.fftSize = 8192
        an.smoothingTimeConstant = 0.3
        ctx.createMediaStreamSource(stream).connect(an)
        const freq = new Float32Array(an.frequencyBinCount)
        const wave = new Float32Array(an.fftSize)
        let frames = 0
        timer = window.setInterval(() => {
          const L = live.current
          if (!L.playing) return
          an.getFloatTimeDomainData(wave)
          if (rms(wave) < 0.01) return // the player is silent: neither right nor wrong
          // the sound we hear now was played `latency` ago
          const at = L.time - L.latency / 1000
          const b = beatAt(L.a.grid, at)
          if (b < 0) return
          if (L.mode === 'chords') {
            const label = L.a.grid[b].chord
            if (!label || label === 'N') return
            an.getFloatFrequencyData(freq)
            const ok = chordMatch(chroma(freq, ctx!.sampleRate, an.fftSize), shiftChordLabel(label, L.transpose)).ok
            score.current.add(b, ok)
          } else {
            const want = (L.a.tab?.notes ?? [])
              .filter((n) => n.start - 0.06 <= at && at < Math.max(n.end, n.start + 0.25))
              .map((n) => n.midi + L.transpose)
            if (!want.length) return
            const p = detectPitch(wave, ctx!.sampleRate)
            score.current.add(b, !!p && noteMatch(p.hz, want))
          }
          if (++frames % 4 === 0) setTick((x) => x + 1)
        }, 50)
      } catch (e) {
        setMicErr(t(micErrorKey(e) as TKey))
        setListening(false)
      }
    }
    void run()
    return () => {
      stopped = true
      window.clearInterval(timer)
      stream?.getTracks().forEach((tr) => tr.stop())
      void ctx?.close()
    }
  }, [listening, t])

  const range = section === 'all' ? null : section
  const beatsInRange = useMemo(
    () => a.grid.map((g, i) => ({ g, i })).filter(({ g }) => !range || (g.t >= range.start - 0.01 && g.t < range.end)).map(({ i }) => i),
    [a.grid, range],
  )
  const sum = score.current.summary(beatsInRange)
  const cur = beatAt(a.grid, s.time - latency / 1000)
  const recent = cur < 0 ? [] : Array.from({ length: 16 }, (_, k) => cur - 15 + k).filter((b) => b >= 0)
  const spelling = soundingSpelling(a, s.transpose, s.capo)
  const nowLabel = cur >= 0 ? a.grid[cur]?.chord : null
  const nowName = nowLabel && nowLabel !== 'N'
    ? shownChord(nowLabel, { level: s.level, transpose: s.transpose, capo: s.capo }, spelling, settings.notation).name
    : null
  const verdictNow: Verdict = cur >= 0 ? score.current.result(cur, 0.4) : null

  const weakest = useMemo(() => {
    const byBar = new Map<number, { hit: number; all: number }>()
    for (const b of beatsInRange) {
      const r = score.current.result(b)
      if (!r) continue
      const bar = a.grid[b].bar
      const x = byBar.get(bar) ?? { hit: 0, all: 0 }
      x.all++
      if (r === 'hit') x.hit++
      byBar.set(bar, x)
    }
    return [...byBar.entries()].filter(([, x]) => x.all >= 2 && x.hit / x.all < 0.5)
      .sort((p, q) => p[1].hit / p[1].all - q[1].hit / q[1].all).slice(0, 3).map(([bar]) => bar)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beatsInRange, a.grid, sum.played])

  const start = () => {
    const from = section === 'all' ? 0 : section.start
    score.current.reset()
    s.seek(from)
    s.setLoop(section === 'all' ? null : { start: section.start, end: section.end, label: section.label })
    setMicErr(null)
    setListening(true)
    if (!s.playing) s.toggle()
  }
  const stop = () => {
    setListening(false)
    if (s.playing) s.toggle()
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-5 pb-28">
      <div>
        <h2 className="text-xl font-semibold">{t('play.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('play.subtitle')}</p>
      </div>
      <p className="rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground">{t('play.beta')}</p>
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'chords', label: t('play.mode.chords') },
          { value: 'notes', label: t('play.mode.notes'), disabled: !a.tab?.notes?.length },
        ]}
      />
      <div>
        <p className="mb-2 text-sm font-medium">{t('play.pickSection')}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSection('all')}
            className={cn('rounded-full border px-3 py-1 text-sm', section === 'all' ? 'border-primary bg-primary/15' : 'border-border')}
          >
            {t('play.whole')}
          </button>
          {a.sections.map((sec, i) => (
            <button
              key={`${sec.label}-${i}`}
              type="button"
              onClick={() => { setSection(sec); s.seek(sec.start) }}
              className={cn(
                'rounded-full border px-3 py-1 text-sm',
                section !== 'all' && section.start === sec.start ? 'border-primary bg-primary/15' : 'border-border',
              )}
            >
              {names[i]}
            </button>
          ))}
        </div>
      </div>

      <div
        className={cn(
          'flex flex-col items-center gap-2 rounded-2xl border bg-card p-5 transition-colors',
          verdictNow === 'hit' ? 'border-success bg-success/10' : verdictNow === 'miss' ? 'border-destructive/60 bg-destructive/5' : 'border-border',
        )}
        data-testid="play-now"
      >
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {listening ? <><Mic className="mr-1 inline size-3.5 text-primary" />{t('play.listening')}</> : t('play.nowChord')}
        </p>
        <p className="text-5xl font-semibold">{mode === 'chords' ? (nowName ?? '–') : '♪'}</p>
        {mode === 'chords' && !nowName && <p className="text-xs text-muted-foreground">{t('play.nothingToPlay')}</p>}
        <div className="mt-2 flex gap-1" aria-hidden>
          {recent.map((b) => {
            const r = score.current.result(b)
            return (
              <span key={b} className={cn('h-3 w-3 rounded-sm',
                r === 'hit' ? 'bg-success' : r === 'miss' ? 'bg-destructive/70' : 'bg-muted', b === cur && 'ring-2 ring-primary')} />
            )
          })}
        </div>
        <div className="mt-2 grid w-full grid-cols-3 text-center">
          <div><p className="text-2xl font-semibold tabular" data-testid="play-accuracy">{sum.played ? Math.round(sum.accuracy * 100) : 0}%</p><p className="text-xs text-muted-foreground">{t('play.accuracy')}</p></div>
          <div><p className="text-2xl font-semibold tabular">{sum.streak}</p><p className="text-xs text-muted-foreground">{t('play.streak')}</p></div>
          <div><p className="text-2xl font-semibold tabular">{sum.played}</p><p className="text-xs text-muted-foreground">{t('play.playedBeats', { n: '' }).trim()}</p></div>
        </div>
      </div>

      {!listening && sum.played > 8 && (
        <div className="rounded-2xl border border-border bg-card p-4 text-sm">
          <p className="font-semibold" data-testid="play-result-title">
            {t(sum.accuracy >= 0.7 ? 'play.resultTitle' : sum.accuracy >= 0.4 ? 'play.resultOk' : 'play.resultLow')}
          </p>
          <p className="text-muted-foreground">
            {t('play.resultBody', { s: section === 'all' ? t('play.whole') : names[a.sections.indexOf(section)] ?? '', p: Math.round(sum.accuracy * 100) })}
          </p>
          {weakest.length > 0 && (
            <>
              <p className="mt-3 font-medium">{t('play.weakest')}</p>
              <ul className="mt-1 flex flex-wrap gap-2">
                {weakest.map((bar) => {
                  const g = a.grid[a.bars[bar]?.beats[0] ?? 0]
                  const label = g?.chord && g.chord !== 'N'
                    ? shownChord(g.chord, { level: s.level, transpose: s.transpose, capo: s.capo }, spelling, settings.notation).name : '–'
                  return (
                    <li key={bar}>
                      <Button size="sm" variant="outline" onClick={() => {
                        const b = a.bars[bar]
                        s.setLoop({ start: b.start, end: b.end, label: `${bar + 1}` })
                        s.setSpeed(0.7)
                        s.seek(b.start)
                      }}>{t('play.weakBar', { b: bar + 1, c: label })}</Button>
                    </li>
                  )
                })}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">{t('play.practiceSlow')}</p>
            </>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <Headphones className="mt-0.5 size-5 text-primary" />
          <div className="flex-1">
            <p className="font-medium">{t('play.headphones')}</p>
            <p className="text-sm text-muted-foreground">{t('play.headphonesBody')}</p>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!headphones} onChange={(e) => setHeadphones(!e.target.checked)} />
              {t('play.noHeadphones')}
            </label>
            {!headphones && <p className="mt-1 text-xs text-warning" data-testid="play-no-headphones">{t('play.noHeadphonesWarn')}</p>}
            <label className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              {t('play.latency')}
              <input type="range" min={0} max={350} step={10} value={latency} onChange={(e) => setLatency(Number(e.target.value))} />
              <span className="font-mono tabular">{latency} ms</span>
            </label>
            <p className="text-xs text-muted-foreground">{t('play.latencyHint')}</p>
          </div>
        </div>
      </div>

      {listening ? (
        <Button size="lg" variant="outline" onClick={stop} data-testid="play-stop"><MicOff className="size-4" /> {t('play.stop')}</Button>
      ) : (
        <Button variant="glow" size="lg" onClick={start} data-testid="play-start"><Mic className="size-4" /> {t('play.start')}</Button>
      )}
      {micErr && <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{micErr}</p>}

      <div className="sticky bottom-3 z-20">
        <Transport
          time={s.time}
          duration={a.duration}
          playing={s.playing}
          speed={s.speed}
          loop={s.loop}
          countIn={s.countIn}
          counting={0}
          onToggle={s.toggle}
          onSeek={s.seek}
          onSpeed={s.setSpeed}
          onLoopClear={() => s.setLoop(null)}
          onCountIn={s.setCountIn}
          onSkip={(dt) => s.seek(s.time + dt)}
          soundSource={s.soundSource}
          onSoundSource={s.setSoundSource}
          tabAvailable={s.tabAvailable}
          guitarAvailable={s.guitarAvailable}
        />
      </div>
    </div>
  )
}
