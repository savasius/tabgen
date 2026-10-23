import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type Analysis, type TabNote } from '../api'
import { useI18n, type TKey } from '../i18n'

const STRING_NAMES = ['e', 'B', 'G', 'D', 'A', 'E'] // display high e on top
const TECH_KEYS: Record<string, TKey> = {
  bend: 'tech_bend', slide: 'tech_slide', hammer: 'tech_hammer',
  pull: 'tech_pull', vibrato: 'tech_vibrato', palmMute: 'tech_palmMute',
}

function timeToTick(a: Analysis, t: number): number {
  const grid = a.grid
  if (!grid.length) return 0
  let lo = 0
  let hi = grid.length - 1
  if (t < grid[0].t) return 0
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (grid[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  const g = grid[lo]
  const frac = Math.max(0, Math.min(1, (t - g.t) / Math.max(0.001, g.end - g.t)))
  return (lo + frac) * 960
}

function notesAt(notes: TabNote[], t: number): TabNote[] {
  return notes.filter((n) => n.start <= t && t < n.end)
}

function Fretboard({ notes, capo = 0 }: { notes: TabNote[]; capo?: number }) {
  const frets = 12
  const lit = new Map<string, TabNote>()
  for (const n of notes) lit.set(`${n.string}:${n.fret}`, n)
  return (
    <div className="fretboard" aria-hidden>
      {STRING_NAMES.map((name, row) => {
        const stringNo = row + 1
        return (
          <div className="fb-row" key={name}>
            <span className="fb-name">{name}</span>
            {Array.from({ length: frets + 1 }, (_, f) => {
              const n = lit.get(`${stringNo}:${f}`)
              const cls = n ? (n.low_confidence ? ' fb-dot low' : ' fb-dot') : ''
              return (
                <span className={`fb-cell${f === capo && capo > 0 ? ' fb-capo' : ''}${cls}`} key={f}>
                  {n ? n.fret : f === 0 ? '|' : ''}
                </span>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

function MeasureTable({
  analysis, notes, curBeat, onSeek, autoScroll,
}: {
  analysis: Analysis
  notes: TabNote[]
  curBeat: number
  onSeek: (t: number) => void
  autoScroll: boolean
}) {
  const active = useRef<HTMLDivElement>(null)
  const curBar = curBeat >= 0 ? analysis.grid[curBeat].bar : -1
  useEffect(() => {
    if (autoScroll && active.current) active.current.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [curBar, autoScroll])

  const byBarBeat = useMemo(() => {
    const map = new Map<string, TabNote[]>()
    for (const n of notes) {
      let bi = 0
      while (bi + 1 < analysis.grid.length && analysis.grid[bi + 1].t <= n.start + 0.01) bi++
      const g = analysis.grid[bi]
      if (!g) continue
      const k = `${g.bar}:${g.pos}`
      const arr = map.get(k) ?? []
      arr.push(n)
      map.set(k, arr)
    }
    return map
  }, [notes, analysis.grid])

  const from = Math.max(0, curBar - 2)
  const to = Math.min(analysis.bars.length, Math.max(from + 8, curBar + 6))
  const slice = analysis.bars.slice(from, to)
  const bpb = Number(analysis.tempo.time_signature.split('/')[0]) || 4

  return (
    <div className="meas-table">
      {slice.map((bar) => (
        <div
          key={bar.index}
          className={`meas${bar.index === curBar ? ' meas-now' : ''}`}
          ref={bar.index === curBar ? active : undefined}
        >
          <div className="meas-num">{bar.index + 1}</div>
          <div className="meas-strings">
            {STRING_NAMES.map((name, row) => (
              <div className="meas-str" key={name}>
                <span className="fb-name">{name}</span>
                {Array.from({ length: bpb }, (_, pos) => {
                  const hits = (byBarBeat.get(`${bar.index}:${pos}`) ?? []).filter((n) => n.string === row + 1)
                  const beatIdx = bar.beats[pos]
                  const isNow = beatIdx === curBeat
                  return (
                    <button
                      type="button"
                      key={pos}
                      className={`meas-cell${isNow ? ' meas-cell-now' : ''}${hits.some((n) => n.low_confidence) ? ' low' : ''}`}
                      onClick={() => onSeek(analysis.grid[beatIdx]?.t ?? bar.start)}
                    >
                      {hits.length ? hits.map((n) => n.fret).join(' ') : '—'}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function TabView({
  analysis, time, curBeat, onSeek, autoScroll, playing,
}: {
  analysis: Analysis
  time: number
  curBeat: number
  onSeek: (t: number) => void
  autoScroll: boolean
  playing: boolean
}) {
  const { t } = useI18n()
  const tab = analysis.tab
  const host = useRef<HTMLDivElement>(null)
  const apiRef = useRef<{ destroy(): void; tickPosition: number } | null>(null)
  const [tabErr, setTabErr] = useState<string | null>(null)

  useEffect(() => {
    const el = host.current
    const tex = tab?.alpha_tex
    if (!el || !tex) return
    let cancelled = false
    let handle: { destroy(): void; tickPosition: number } | null = null
    import('@coderline/alphatab').then((alphaTab) => {
      if (cancelled || !host.current) return
      try {
        const settings = new alphaTab.Settings()
        settings.core.engine = 'svg'
        settings.core.fontDirectory = '/font/'
        // Vite production IIFE strips import.meta.url, which breaks alphaTab workers.
        settings.core.useWorkers = false
        settings.display.staveProfile = alphaTab.StaveProfile.Tab
        settings.player.enablePlayer = true
        settings.player.enableCursor = true
        settings.player.enableAnimatedBeatCursor = true
        settings.player.playerMode = alphaTab.PlayerMode.EnabledExternalMedia
        const at = new alphaTab.AlphaTabApi(host.current, settings)
        at.error.on((e: Error) => { if (!cancelled) setTabErr(e?.message || String(e)) })
        at.tex(tex)
        handle = at
        apiRef.current = at
      } catch (e) {
        if (!cancelled) setTabErr(String(e))
      }
    }).catch((e) => { if (!cancelled) setTabErr(String(e)) })
    return () => {
      cancelled = true
      handle?.destroy()
      apiRef.current = null
    }
  }, [tab?.alpha_tex])

  useEffect(() => {
    const at = apiRef.current
    if (!at) return
    try { at.tickPosition = timeToTick(analysis, time) } catch { /* player not ready */ }
  }, [analysis, time, playing])

  if (!tab || (!tab.notes.length && !tab.alpha_tex)) {
    return <p className="muted">{t('tabEmpty')}</p>
  }

  const sounding = notesAt(tab.notes, time)
  const uncertain = tab.notes.filter((n) => n.low_confidence).sort((a, b) => a.start - b.start)
  const nextU = uncertain.find((n) => n.start > time + 0.05)

  return (
    <div className="tab-view">
      {tab.stats?.fallback && <p className="banner warn">{t('tabFallback')}</p>}
      {tab.error && <p className="banner warn">{t('noTab')} {tab.error}</p>}
      <div className="tab-toolbar">
        <button onClick={() => nextU && onSeek(nextU.start)} disabled={!nextU}>{t('nextUncertain')}</button>
        <a className="btn-link" href={api.musicxmlUrl(analysis.id)}>{t('exportMusicxml')}</a>
        <a className="btn-link" href={api.alphatexUrl(analysis.id)}>{t('exportAlphatex')}</a>
        <span className="muted small">
          {tab.stats.n_notes} notes · {tab.stats.n_low_confidence} {t('lowConf')}
          {tab.stats.guitar_source ? ` · ${tab.stats.guitar_source}` : ''}
        </span>
      </div>

      <div className="alphatab-host" ref={host} />
      {tabErr && <p className="muted small">{tabErr}</p>}
      <p className="muted small foot">{t('alphaTabCredit')}</p>

      <h3>{t('fretboard')}</h3>
      <Fretboard notes={sounding} capo={tab.capo} />

      <h3>{t('measureTable')}</h3>
      <MeasureTable analysis={analysis} notes={tab.notes} curBeat={curBeat} onSeek={onSeek} autoScroll={autoScroll && playing} />

      <details className="legend">
        <summary>{t('legendTitle')}</summary>
        <ul>
          {Object.entries(tab.technique_legend || {}).map(([k, v]) => (
            <li key={k}>
              <b>{t(TECH_KEYS[k] ?? 'tech_bend')}</b>
              {' '}({v.reliability}) — {v.note}
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
