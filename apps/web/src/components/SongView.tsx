import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type Analysis } from '../api'
import { useI18n } from '../i18n'
import {
  bestCapo, capoSuggestions, chordKey, displayChord, formatChord, noteName, spellingForKey, transpose,
  type Chord, type Level,
} from '../music/chords'
import { audioPlayer, countIn, youtubePlayer, type PlayerApi } from '../player'
import { ChordDiagram } from './ChordDiagram'
import { ChordGrid } from './ChordGrid'
import { SECTION_COLORS, sectionNames } from './sections'

const NOTE_PC: Record<string, number> = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 }

function usePersisted<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    const s = localStorage.getItem(key)
    return s === null ? initial : (JSON.parse(s) as T)
  })
  return [v, (nv: T) => { localStorage.setItem(key, JSON.stringify(nv)); setV(nv) }]
}

function fmtTime(t: number) {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function beatAt(grid: Analysis['grid'], t: number): number {
  let lo = 0
  let hi = grid.length - 1
  if (!grid.length) return -1
  if (t < grid[0].t) return 0
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (grid[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

export function SongView({ id, onBack }: { id: string; onBack: () => void }) {
  const { t } = useI18n()
  const [a, setA] = useState<Analysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [level, setLevel] = usePersisted<Level>('level', 'normal')
  const [semis, setSemis] = useState(0)
  const [capo, setCapo] = useState<number | null>(null)
  const [rate, setRate] = useState(1)
  const [loop, setLoop] = useState<{ a: number; b: number } | null>(null)
  const [pendingA, setPendingA] = useState<number | null>(null)
  const [useCountIn, setUseCountIn] = usePersisted('countIn', false)
  const [autoScroll, setAutoScroll] = usePersisted('autoScroll', true)
  const [mode, setMode] = useState<'file' | 'youtube'>('file')
  const [ytInput, setYtInput] = useState('')
  const [ytOffset, setYtOffset] = useState(0)
  const [curBeat, setCurBeat] = useState(-1)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)

  const audioRef = useRef<HTMLAudioElement>(null)
  const ytMount = useRef<HTMLDivElement>(null)
  const playerRef = useRef<PlayerApi | null>(null)
  const loopRef = useRef(loop)
  loopRef.current = loop
  const ytOffsetRef = useRef(ytOffset)
  ytOffsetRef.current = ytOffset

  useEffect(() => {
    api.analysis(id).then((d) => {
      setA(d)
      if (d.meta.youtube_id) { setYtInput(d.meta.youtube_id); setYtOffset(d.meta.youtube_offset ?? 0) }
    }).catch((e) => setError(String(e.message ?? e)))
  }, [id])

  // Player setup
  useEffect(() => {
    if (!a) return
    if (mode === 'file' && audioRef.current) {
      playerRef.current = audioPlayer(audioRef.current)
      playerRef.current.setRate(rate)
      return
    }
    if (mode === 'youtube' && ytMount.current && a.meta.youtube_id) {
      const holder = document.createElement('div')
      ytMount.current.innerHTML = ''
      ytMount.current.appendChild(holder)
      let destroyed = false
      let p: Awaited<ReturnType<typeof youtubePlayer>> | null = null
      youtubePlayer(holder, a.meta.youtube_id, () => ytOffsetRef.current).then((pl) => {
        if (destroyed) return pl.destroy()
        p = pl
        playerRef.current = pl
        pl.setRate(rate)
      })
      return () => { destroyed = true; p?.destroy(); playerRef.current = null }
    }
  }, [a, mode, a?.meta.youtube_id])

  // Sync loop: highlight + A-B looping
  useEffect(() => {
    if (!a) return
    let raf = 0
    let lastBeat = -2
    let lastShown = -1
    const tick = () => {
      const p = playerRef.current
      if (p) {
        let now = p.time()
        const l = loopRef.current
        if (l && p.isPlaying() && now >= l.b) { p.seek(l.a); now = l.a }
        const b = beatAt(a.grid, now)
        if (b !== lastBeat) { lastBeat = b; setCurBeat(b) }
        if (Math.abs(now - lastShown) >= 0.25) { lastShown = now; setTime(now) }
        setPlaying(p.isPlaying())
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [a])

  const keyTonic = a ? NOTE_PC[a.key.tonic] ?? null : null
  const suggestions = useMemo(
    () => (a ? capoSuggestions(a.chords, { level, transpose: semis }) : []),
    [a, level, semis],
  )
  const suggested = bestCapo(suggestions)
  const effCapo = capo ?? suggested
  // Spell shapes in the key they are played in (sounding key minus capo).
  const spelling = spellingForKey(keyTonic === null ? null : (keyTonic + semis - effCapo + 24) % 12, a?.key.mode)
  const opts = useMemo(() => ({ level, transpose: semis, capo: effCapo }), [level, semis, effCapo])

  const beatChords: Chord[] = useMemo(() => (a ? a.grid.map((g) => displayChord(g.chord, opts)) : []), [a, opts])
  const names = useMemo(() => beatChords.map((c) => formatChord(c, spelling)), [beatChords, spelling])
  const changes = useMemo(() => {
    if (!a) return []
    return beatChords.map((c, i) => {
      if (i === 0) return true
      const g = a.grid[i]
      const prev = a.grid[i - 1]
      const newBlock = a.bars[g.bar].section !== a.bars[prev.bar].section
      return newBlock || chordKey(c) !== chordKey(beatChords[i - 1])
    })
  }, [a, beatChords])
  // Display-level chord segments (beat indices where the shown chord changes).
  const segStarts = useMemo(
    () => beatChords.flatMap((c, i) => (i === 0 || chordKey(c) !== chordKey(beatChords[i - 1]) ? [i] : [])),
    [beatChords],
  )
  const secNames = useMemo(() => (a ? sectionNames(a.sections, t) : []), [a, t])

  const seek = useCallback((tt: number) => playerRef.current?.seek(tt), [])

  const togglePlay = useCallback(async () => {
    const p = playerRef.current
    if (!p || !a) return
    if (p.isPlaying()) return p.pause()
    if (useCountIn && a.tempo.bpm > 0) {
      const beatsPerBar = Number(a.tempo.time_signature.split('/')[0]) || 4
      await countIn(beatsPerBar, 60 / a.tempo.bpm / rate)
    }
    p.play()
  }, [a, useCountIn, rate])

  const currentBar = a && curBeat >= 0 ? a.bars[a.grid[curBeat].bar] : null
  const currentSectionIdx = currentBar?.section ?? null

  const loopSection = useCallback((i: number | null) => {
    if (!a || i === null) return
    const s = a.sections[i]
    setLoop({ a: s.start, b: s.end })
    seek(s.start)
  }, [a, seek])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      if (e.code === 'Space') { e.preventDefault(); togglePlay() }
      if (!a) return
      const bar = currentBar?.index ?? 0
      if (e.code === 'ArrowRight') seek(a.bars[Math.min(a.bars.length - 1, bar + 1)].start)
      if (e.code === 'ArrowLeft') seek(a.bars[Math.max(0, bar - 1)].start)
      if (e.key === 'l' || e.key === 'L') loop ? setLoop(null) : loopSection(currentSectionIdx)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [a, togglePlay, seek, currentBar, currentSectionIdx, loop, loopSection])

  if (error) return <div className="page"><button className="link" onClick={onBack}>{t('back')}</button><p className="error">{error}</p></div>
  if (!a) return <div className="page"><p>{t('processing')}</p></div>

  // Now / next from display segments
  const segIdx = segStarts.findLastIndex((s) => s <= Math.max(curBeat, 0))
  const nowBeat = curBeat >= 0 ? segStarts[segIdx] : -1
  const upcoming = segStarts.slice(segIdx + 1, segIdx + 4)
  const barStart = (i: number) => a.bars[a.grid[i].bar].start
  const snapToBar = (tt: number) => {
    const b = a.bars.findLast((bar) => bar.start <= tt + 0.05) ?? a.bars[0]
    return b
  }
  const setLoopPoint = () => {
    if (pendingA === null) { setPendingA(snapToBar(time).start); setLoop(null); return }
    const end = snapToBar(time).end
    if (end > pendingA) setLoop({ a: pendingA, b: end })
    setPendingA(null)
  }

  const soundingKey = keyTonic === null ? '?' : noteName(transpose({ root: keyTonic, quality: 'maj', bass: null }, semis).root!, spellingForKey((keyTonic + semis) % 12, a.key.mode))

  return (
    <div className="song">
      <div className="song-sticky">
      <header className="song-head">
        <button className="link" onClick={onBack}>{t('back')}</button>
        <div className="song-title">
          <h1>{a.meta.title || a.id}</h1>
          {a.meta.artist && <span className="muted">{a.meta.artist}</span>}
        </div>
        <div className="song-facts">
          <span>{t('key')}: <b>{soundingKey} {t(a.key.mode)}</b></span>
          <span>{t('tempo')}: <b>{Math.round(a.tempo.bpm)} BPM</b> ({a.tempo.time_signature})</span>
          <span>{t('tuning')}: <b>{Math.abs(a.tuning.cents) <= 10 ? t('tuningStd') : t('tuningOff', { c: a.tuning.cents })}</b></span>
        </div>
      </header>

      <div className="sections-strip">
        {a.sections.map((s, i) => (
          <button
            key={i}
            className={`sec${i === currentSectionIdx ? ' sec-active' : ''}`}
            style={{ flexGrow: s.end - s.start, background: SECTION_COLORS[s.label] }}
            title={`${secNames[i]} ${fmtTime(s.start)}–${fmtTime(s.end)}`}
            onClick={() => seek(s.start)}
            onDoubleClick={() => loopSection(i)}
          >
            {secNames[i]}
          </button>
        ))}
      </div>
      <div className="progress" onClick={(e) => {
        const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
        seek(((e.clientX - r.left) / r.width) * a.duration)
      }}>
        <div className="progress-fill" style={{ width: `${(time / a.duration) * 100}%` }} />
        {loop && <div className="progress-loop" style={{ left: `${(loop.a / a.duration) * 100}%`, width: `${((loop.b - loop.a) / a.duration) * 100}%` }} />}
      </div>

      <div className="now-next">
        <div className="now">
          <div className="label">{t('now')}</div>
          <div className="now-chord">{nowBeat >= 0 ? names[nowBeat] : '—'}</div>
          {nowBeat >= 0 && beatChords[nowBeat].root !== null && <ChordDiagram chord={beatChords[nowBeat]} size={130} />}
        </div>
        <div className="next">
          <div className="label">{t('next')}</div>
          <div className="next-list">
            {upcoming.map((bi, k) => (
              <div className="next-item" key={bi} style={{ opacity: 1 - k * 0.25 }}>
                <div className="next-chord">{names[bi]}</div>
                {beatChords[bi].root !== null && <ChordDiagram chord={beatChords[bi]} size={80} />}
                {k === 0 && curBeat >= 0 && <div className="muted small">{t('inBeats', { n: bi - curBeat })}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="controls">
        <button className="play" onClick={togglePlay}>{playing ? '❚❚ ' + t('pause') : '▶ ' + t('play')}</button>
        <span className="time">{fmtTime(time)} / {fmtTime(a.duration)}</span>

        <label className="ctl">
          {t('speed')} <b>{Math.round(rate * 100)}%</b>
          <input type="range" min={0.5} max={1.25} step={0.05} value={rate}
            onChange={(e) => { const r = Number(e.target.value); setRate(r); playerRef.current?.setRate(r) }} />
        </label>

        <div className="ctl">
          {t('loop')}:
          <button onClick={setLoopPoint} className={pendingA !== null ? 'on' : ''}>
            {pendingA === null ? t('loopA') : t('loopB')}
          </button>
          <button onClick={() => loopSection(currentSectionIdx)} disabled={currentSectionIdx === null}>{t('loopSection')}</button>
          {loop && <button onClick={() => { setLoop(null); setPendingA(null) }}>✕ {t('loopClear')}</button>}
        </div>

        <label className="ctl check">
          <input type="checkbox" checked={useCountIn} onChange={(e) => setUseCountIn(e.target.checked)} /> {t('countIn')}
        </label>

        <div className="ctl">
          {t('transpose')}:
          <button onClick={() => setSemis(semis - 1)}>−</button>
          <b>{semis > 0 ? `+${semis}` : semis}</b>
          <button onClick={() => setSemis(semis + 1)}>+</button>
          <span className="muted small">{t('transposeNote')}</span>
        </div>

        <div className="ctl">
          {t('capo')}:
          <select value={effCapo} onChange={(e) => setCapo(Number(e.target.value))}>
            {Array.from({ length: 8 }, (_, i) => <option key={i} value={i}>{i === 0 ? t('capoNone') : i}</option>)}
          </select>
          {suggested > 0 && effCapo !== suggested && (
            <button className="badge" onClick={() => setCapo(suggested)}>{t('capoSuggest', { n: suggested })}</button>
          )}
        </div>

        <div className="ctl seg">
          {t('level')}:
          {(['basic', 'normal', 'full'] as Level[]).map((l) => (
            <button key={l} className={l === level ? 'on' : ''} onClick={() => setLevel(l)}>{t(`level_${l}`)}</button>
          ))}
        </div>

        <label className="ctl check">
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} /> {t('autoScroll')}
        </label>
      </div>
      {effCapo > 0 && <div className="capo-note">{t('capoExplain', { n: effCapo })}</div>}
      </div>

      <div className="player-box">
        <div className="ctl seg">
          {t('player')}:
          <button className={mode === 'file' ? 'on' : ''} onClick={() => setMode('file')}>{t('playerFile')}</button>
          <button className={mode === 'youtube' ? 'on' : ''} onClick={() => setMode('youtube')}>{t('playerYoutube')}</button>
        </div>
        {mode === 'file' && <audio ref={audioRef} src={api.audioUrl(a.id)} preload="auto" />}
        {mode === 'youtube' && (
          <div className="yt">
            <div className="yt-form">
              <input placeholder={t('youtubeLink')} value={ytInput} onChange={(e) => setYtInput(e.target.value)} />
              <label>{t('youtubeOffset')}
                <input type="number" step={0.05} value={ytOffset} onChange={(e) => setYtOffset(Number(e.target.value))} />
              </label>
              <button onClick={() => api.patch(a.id, { youtube_id: ytInput, youtube_offset: ytOffset }).then(() => api.analysis(a.id)).then(setA)}>
                {t('save')}
              </button>
              <span className="muted small">{t('youtubeOffsetHint')}</span>
            </div>
            {a.meta.youtube_id && <div className="yt-frame" ref={ytMount} />}
          </div>
        )}
      </div>

      <div className="grid-wrap">
        <ChordGrid
          analysis={a} names={names} changes={changes} sectionNames={secNames} curBeat={curBeat}
          loop={loop} autoScroll={autoScroll && playing} onSeek={seek}
        />
      </div>
      <p className="muted small foot">{t('accuracyNote')} · {t('shortcuts')} · {barStart(0) >= 0 && `${a.models.chords} · ${a.models.device}`}</p>
    </div>
  )
}
