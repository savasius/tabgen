import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { Analysis } from '@/api'
import { useApp } from '@/lib/store'
import { beatAt } from '@/lib/time'
import { createTabGuitarPlayer } from '@/lib/tab-player'
import { bestCapo, capoSuggestions, spellingForKey, type Level } from '@/music/chords'
import { audioPlayer, countIn, youtubePlayer, type Loop, type PlayerApi, type SoundSource } from '@/player'
import { markPlayed } from '@/lib/local'

export type { SoundSource }

export interface SongSession {
  analysis: Analysis
  setAnalysis: (a: Analysis) => void
  time: number
  playing: boolean
  speed: number
  loop: Loop | null
  pendingA: number | null
  countIn: boolean
  autoScroll: boolean
  curBeat: number
  toggle: () => void
  seek: (t: number) => void
  setSpeed: (s: number) => void
  setLoop: (l: Loop | null) => void
  setPendingA: (n: number | null) => void
  setCountIn: (v: boolean) => void
  setAutoScroll: (v: boolean) => void
  loopSection: (i: number | null) => void
  capo: number
  setCapo: (n: number) => void
  transpose: number
  setTranspose: (n: number) => void
  level: Level
  setLevel: (l: Level) => void
  suggestedCapo: number
  mode: 'file' | 'youtube'
  setMode: (m: 'file' | 'youtube') => void
  ytInput: string
  setYtInput: (s: string) => void
  ytOffset: number
  setYtOffset: (n: number) => void
  audioRef: RefObject<HTMLAudioElement | null>
  ytMount: RefObject<HTMLDivElement | null>
  tabHost: RefObject<HTMLDivElement | null>
  soundSource: SoundSource
  setSoundSource: (s: SoundSource) => void
  tabAvailable: boolean
}

const Ctx = createContext<SongSession | null>(null)

export function SongSessionProvider({
  analysis,
  setAnalysis,
  children,
}: {
  analysis: Analysis
  setAnalysis: (a: Analysis) => void
  children: ReactNode
}) {
  const { settings } = useApp()
  const [level, setLevel] = useState<Level>(settings.level)
  const [semis, setSemis] = useState(0)
  const [capo, setCapo] = useState<number | null>(null)
  const [rate, setRate] = useState(1)
  const [loop, setLoop] = useState<Loop | null>(null)
  const [pendingA, setPendingA] = useState<number | null>(null)
  const [useCountIn, setUseCountIn] = useState(() => localStorage.getItem('tabgen.countIn') === '1')
  const [autoScroll, setAutoScroll] = useState(() => localStorage.getItem('tabgen.autoScroll') !== '0')
  const [mode, setMode] = useState<'file' | 'youtube'>(analysis.meta.youtube_id ? 'youtube' : 'file')
  const [ytInput, setYtInput] = useState(analysis.meta.youtube_id ?? '')
  const [ytOffset, setYtOffset] = useState(analysis.meta.youtube_offset ?? 0)
  const [curBeat, setCurBeat] = useState(-1)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [soundSource, setSoundSourceState] = useState<SoundSource>('original')

  const audioRef = useRef<HTMLAudioElement>(null)
  const ytMount = useRef<HTMLDivElement>(null)
  const tabHost = useRef<HTMLDivElement>(null)
  const originalRef = useRef<PlayerApi | null>(null)
  const tabRef = useRef<(PlayerApi & { destroy?: () => void }) | null>(null)
  const sourceRef = useRef<SoundSource>(soundSource)
  sourceRef.current = soundSource
  const loopRef = useRef(loop)
  loopRef.current = loop
  const ytOffsetRef = useRef(ytOffset)
  ytOffsetRef.current = ytOffset
  const rateRef = useRef(rate)
  rateRef.current = rate

  const tabAvailable = !!(analysis.tab?.alpha_tex || analysis.tab?.notes?.length)

  const active = useCallback((): PlayerApi | null => {
    return sourceRef.current === 'tab' ? tabRef.current : originalRef.current
  }, [])

  useEffect(() => { markPlayed(analysis.id) }, [analysis.id])

  useEffect(() => {
    if (mode === 'file' && audioRef.current) {
      originalRef.current = audioPlayer(audioRef.current)
      originalRef.current.setRate(rateRef.current)
      return
    }
    if (mode === 'youtube' && ytMount.current && analysis.meta.youtube_id) {
      const holder = document.createElement('div')
      ytMount.current.innerHTML = ''
      ytMount.current.appendChild(holder)
      let destroyed = false
      let p: Awaited<ReturnType<typeof youtubePlayer>> | null = null
      youtubePlayer(holder, analysis.meta.youtube_id, () => ytOffsetRef.current).then((pl) => {
        if (destroyed) { pl.destroy(); return }
        p = pl
        originalRef.current = pl
        pl.setRate(rateRef.current)
      })
      return () => { destroyed = true; p?.destroy(); originalRef.current = null }
    }
  }, [analysis.meta.youtube_id, mode])

  useEffect(() => {
    const tab = analysis.tab
    if (!tab?.alpha_tex && !(tab?.notes?.length)) {
      tabRef.current = null
      return
    }
    const p = createTabGuitarPlayer({
      host: tabHost.current,
      tex: tab.alpha_tex,
      notes: tab.notes ?? [],
      duration: analysis.duration,
    })
    p.setRate(rateRef.current)
    tabRef.current = p
    return () => {
      p.destroy()
      if (tabRef.current === p) tabRef.current = null
    }
  }, [analysis.id, analysis.tab?.alpha_tex, analysis.duration, analysis.tab?.notes])

  useEffect(() => {
    let raf = 0
    let lastBeat = -2
    let lastShown = -1
    let lastPlaying: boolean | null = null
    const tick = () => {
      const p = active()
      if (p) {
        let now = p.time()
        const l = loopRef.current
        if (l && p.isPlaying() && now >= l.end) { p.seek(l.start); now = l.start }
        const b = beatAt(analysis.grid, now)
        if (b !== lastBeat) { lastBeat = b; setCurBeat(b) }
        if (Math.abs(now - lastShown) >= 0.05) { lastShown = now; setTime(now) }
        const isP = p.isPlaying()
        if (isP !== lastPlaying) { lastPlaying = isP; setPlaying(isP) }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [analysis, active])

  const suggestions = useMemo(
    () => capoSuggestions(analysis.chords, { level, transpose: semis }),
    [analysis.chords, level, semis],
  )
  const suggestedCapo = bestCapo(suggestions)
  const effCapo = capo ?? suggestedCapo

  const seek = useCallback((tt: number) => {
    const t = Math.max(0, Math.min(analysis.duration, tt))
    originalRef.current?.seek(t)
    tabRef.current?.seek(t)
  }, [analysis.duration])

  const toggle = useCallback(async () => {
    const p = active()
    if (!p) return
    if (p.isPlaying()) return p.pause()
    if (useCountIn && analysis.tempo.bpm > 0) {
      const beats = Number(analysis.tempo.time_signature.split('/')[0]) || 4
      await countIn(beats, 60 / analysis.tempo.bpm / rateRef.current)
    }
    p.play()
  }, [analysis.tempo, useCountIn, active])

  const setSoundSource = useCallback((next: SoundSource) => {
    if (next === 'tab' && !tabAvailable) return
    const cur = active()
    const tnow = cur?.time() ?? 0
    const was = cur?.isPlaying() ?? false
    cur?.pause()
    sourceRef.current = next
    setSoundSourceState(next)
    const other = next === 'tab' ? tabRef.current : originalRef.current
    other?.seek(tnow)
    other?.setRate(rateRef.current)
    if (was) other?.play()
  }, [active, tabAvailable])

  const loopSection = useCallback((i: number | null) => {
    if (i === null) return
    const s = analysis.sections[i]
    if (!s) return
    setLoop({ start: s.start, end: s.end, label: s.label })
    seek(s.start)
  }, [analysis.sections, seek])

  const currentBar = curBeat >= 0 ? analysis.bars[analysis.grid[curBeat]?.bar] : null
  const currentSectionIdx = currentBar?.section ?? null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return
      if (e.code === 'Space') { e.preventDefault(); void toggle() }
      const bar = currentBar?.index ?? 0
      if (e.code === 'ArrowRight') seek(analysis.bars[Math.min(analysis.bars.length - 1, bar + 1)]?.start ?? 0)
      if (e.code === 'ArrowLeft') seek(analysis.bars[Math.max(0, bar - 1)]?.start ?? 0)
      if (e.key === 'l' || e.key === 'L') {
        if (loop) setLoop(null)
        else loopSection(currentSectionIdx)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [analysis.bars, toggle, seek, currentBar, currentSectionIdx, loop, loopSection])

  const value: SongSession = {
    analysis,
    setAnalysis,
    time,
    playing,
    speed: rate,
    loop,
    pendingA,
    countIn: useCountIn,
    autoScroll,
    curBeat,
    toggle: () => { void toggle() },
    seek,
    setSpeed: (s) => {
      setRate(s)
      rateRef.current = s
      originalRef.current?.setRate(s)
      tabRef.current?.setRate(s)
    },
    setLoop,
    setPendingA,
    setCountIn: (v) => { localStorage.setItem('tabgen.countIn', v ? '1' : '0'); setUseCountIn(v) },
    setAutoScroll: (v) => { localStorage.setItem('tabgen.autoScroll', v ? '1' : '0'); setAutoScroll(v) },
    loopSection,
    capo: effCapo,
    setCapo,
    transpose: semis,
    setTranspose: setSemis,
    level,
    setLevel,
    suggestedCapo,
    mode,
    setMode,
    ytInput,
    setYtInput,
    ytOffset,
    setYtOffset,
    audioRef,
    ytMount,
    tabHost,
    soundSource,
    setSoundSource,
    tabAvailable,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSong() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useSong')
  return c
}

export function soundingSpelling(a: Analysis, transpose: number, capo: number) {
  const NOTE_PC: Record<string, number> = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 }
  const keyTonic = NOTE_PC[a.key.tonic]
  if (keyTonic === undefined) return spellingForKey(null, a.key.mode)
  return spellingForKey((keyTonic + transpose - capo + 24) % 12, a.key.mode)
}
