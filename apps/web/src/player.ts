// One playback interface over <audio> and the YouTube IFrame player.
// All times are "analysis time" (seconds in the analyzed audio).

export interface PlayerApi {
  play(): void
  pause(): void
  seek(t: number): void
  time(): number
  setRate(r: number): void
  isPlaying(): boolean
}

export interface Loop {
  start: number
  end: number
  label?: string
}

export function audioPlayer(el: HTMLAudioElement): PlayerApi {
  el.preservesPitch = true
  return {
    play: () => void el.play(),
    pause: () => el.pause(),
    seek: (t) => { el.currentTime = Math.max(0, t) },
    time: () => el.currentTime,
    setRate: (r) => { el.playbackRate = r },
    isPlaying: () => !el.paused,
  }
}

// ---- YouTube ------------------------------------------------------------

interface YTPlayer {
  playVideo(): void
  pauseVideo(): void
  seekTo(t: number, allowSeekAhead: boolean): void
  getCurrentTime(): number
  setPlaybackRate(r: number): void
  getPlayerState(): number
  destroy(): void
}

declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: object) => YTPlayer; PlayerState: { PLAYING: number } }
    onYouTubeIframeAPIReady?: () => void
  }
}

let ytReady: Promise<void> | null = null
function loadYouTubeApi(): Promise<void> {
  if (ytReady) return ytReady
  ytReady = new Promise((resolve) => {
    if (window.YT?.Player) return resolve()
    window.onYouTubeIframeAPIReady = () => resolve()
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(s)
  })
  return ytReady
}

/** offset = videoTime - analysisTime (positive if the video has extra lead-in). */
export async function youtubePlayer(
  mount: HTMLElement, videoId: string, getOffset: () => number,
): Promise<PlayerApi & { destroy(): void }> {
  await loadYouTubeApi()
  let rate = 1
  // getCurrentTime() only updates every ~100-250 ms; interpolate between updates for smooth highlighting.
  let lastRaw = 0
  let lastPerf = performance.now()
  const player: YTPlayer = await new Promise((resolve) => {
    const p = new window.YT!.Player(mount, {
      videoId,
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
      events: { onReady: () => resolve(p) },
    })
  })
  const playing = () => player.getPlayerState() === window.YT!.PlayerState.PLAYING
  const rawTime = () => {
    const raw = player.getCurrentTime()
    const now = performance.now()
    if (raw !== lastRaw) { lastRaw = raw; lastPerf = now; return raw }
    return playing() ? raw + ((now - lastPerf) / 1000) * rate : raw
  }
  return {
    play: () => player.playVideo(),
    pause: () => player.pauseVideo(),
    seek: (t) => player.seekTo(Math.max(0, t + getOffset()), true),
    time: () => rawTime() - getOffset(),
    setRate: (r) => { rate = r; player.setPlaybackRate(r) },
    isPlaying: playing,
    destroy: () => player.destroy(),
  }
}

// ---- count-in clicks ------------------------------------------------------

let ctx: AudioContext | null = null
export function countIn(beats: number, intervalS: number): Promise<void> {
  ctx ??= new AudioContext()
  const c = ctx
  const t0 = c.currentTime + 0.05
  for (let i = 0; i < beats; i++) {
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.frequency.value = i === 0 ? 1500 : 1000
    gain.gain.setValueAtTime(0.4, t0 + i * intervalS)
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + i * intervalS + 0.08)
    osc.connect(gain).connect(c.destination)
    osc.start(t0 + i * intervalS)
    osc.stop(t0 + i * intervalS + 0.1)
  }
  return new Promise((r) => setTimeout(r, (beats * intervalS + 0.05) * 1000))
}
