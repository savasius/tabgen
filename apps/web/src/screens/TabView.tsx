import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type TabNote, type Technique } from '@/api'
import { TabStaff } from '@/components/app/TabStaff'
import { NoteEditor } from '@/components/app/NoteEditor'
import { Fretboard, MeasureTable } from '@/components/app/Fretboard'
import { Transport } from '@/components/app/Transport'
import { SectionStrip } from '@/components/app/SectionStrip'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/switch'
import { useApp, type TKey } from '@/lib/store'
import { sectionNames, shownChord } from '@/lib/display'
import { ChordStrip } from '@/components/app/ChordStrip'
import { beatsPerBar, locatePlayhead, notesAt, staffNotes, timeToTick, type StaffNote } from '@/lib/time'
import { addNote, deleteNote, moveString, setFret, toggleTechnique } from '@/lib/tab-edit'
import { soundingSpelling, useSong } from './song-session'

const LEGEND_GLYPH: Record<string, string> = {
  bend: 'b', slide: 'sl', hammer: 'h', pull: 'p', vibrato: 'v', palmMute: 'pm',
}

export function TabView() {
  const { t, settings } = useApp()
  const s = useSong()
  const a = s.analysis
  const tab = a.tab
  const part = a.viewPart ?? 'all'
  const [selIdx, setSelIdx] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  // Local copy while a fix is on its way to the server (instant feedback, no flicker).
  const [draft, setDraft] = useState<TabNote[] | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const seq = useRef(0)
  const timer = useRef<number | undefined>(undefined)
  const [zoom, setZoom] = useState(1)
  const [view, setView] = useState<'tab' | 'both' | 'fretboard'>('tab')
  const [advanced, setAdvanced] = useState(false)
  // chord names over the tab + the song's chord diagrams; remembered per device
  const [showChords, setShowChords] = useState(() => {
    try { return localStorage.getItem('tabgen.tabChords') !== '0' } catch { return true }
  })
  const toggleChords = (v: boolean) => {
    setShowChords(v)
    try { localStorage.setItem('tabgen.tabChords', v ? '1' : '0') } catch { /* private mode */ }
  }
  const spelling = soundingSpelling(a, s.transpose, s.capo)
  const chordOpts = { level: s.level, transpose: s.transpose, capo: s.capo }
  const chordMarks = useMemo(() => {
    const m = new Map<number, { pos: number; name: string }[]>()
    let prev = ''
    for (const g of a.grid) {
      const label = g.chord && g.chord !== 'N' && g.chord !== 'X' ? g.chord : ''
      const name = label ? shownChord(label, chordOpts, spelling, settings.notation).name : ''
      const list = m.get(g.bar) ?? []
      // every bar keeps its opening chord (shown at a row start); inside a bar, only changes
      if (name && (g.pos === 0 || name !== prev)) list.push({ pos: g.pos, name })
      if (list.length) m.set(g.bar, list)
      prev = name
    }
    return m
  }, [a.grid, s.level, s.transpose, s.capo, spelling, settings.notation])
  const stripChords = useMemo(() => {
    const seen = new Set<string>()
    const out: { key: string; name: string; chord: ReturnType<typeof shownChord>['chord'] }[] = []
    for (const c of a.chords) {
      if (c.label === 'N' || c.label === 'X') continue
      const d = shownChord(c.label, chordOpts, spelling, settings.notation)
      if (seen.has(d.name)) continue
      seen.add(d.name)
      out.push({ key: d.name, name: d.name, chord: d.chord })
    }
    return out
  }, [a.chords, s.level, s.transpose, s.capo, spelling, settings.notation])
  const nowChord = useMemo(() => {
    const c = a.chords.find((x) => s.time >= x.start && s.time < x.end)
    return c && c.label !== 'N' ? shownChord(c.label, chordOpts, spelling, settings.notation).name : undefined
  }, [a.chords, s.time, s.level, s.transpose, s.capo, spelling, settings.notation])
  const host = useRef<HTMLDivElement>(null)
  const apiRef = useRef<{ destroy(): void; tickPosition: number } | null>(null)
  const [tabErr, setTabErr] = useState<string | null>(null)

  useEffect(() => { setDraft(null); setSelIdx(null); setSaveState('idle') }, [a.id, part])
  const notes = draft ?? tab?.notes
  const mapped = useMemo(() => staffNotes(a, notes ?? []), [a, notes])
  const sel: StaffNote | null = selIdx == null ? null : mapped.find((m) => m.index === selIdx) ?? null
  const tuning = tab?.tuning ?? []
  const capo = tab?.capo ?? 0

  const commit = (raw: TabNote[], select: number | null = selIdx) => {
    // the server stores notes by (start, string); keep the same order so the selection holds
    const picked = select == null ? null : raw[select]
    const next = [...raw].sort((x, y) => x.start - y.start || x.string - y.string)
    setDraft(next)
    setSelIdx(picked ? next.indexOf(picked) : null)
    const my = ++seq.current
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      setSaveState('saving')
      api.saveTab(a.id, part, next).then((res) => {
        if (my !== seq.current) return // a newer fix is already on its way
        s.setAnalysis(res)
        setDraft(null)
        setSaveState('saved')
      }).catch(() => { if (my === seq.current) setSaveState('error') })
    }, 450)
  }
  const edit = {
    fret: (f: number) => { if (notes && selIdx != null) commit(setFret(notes, selIdx, f, tuning, capo)) },
    string: (dir: -1 | 1) => {
      if (!notes || selIdx == null) return
      const next = moveString(notes, selIdx, dir, tuning, capo)
      if (next) commit(next)
    },
    toggle: (type: Technique['type'], extra?: Partial<Technique>) => {
      if (notes && selIdx != null) commit(toggleTechnique(notes, selIdx, type, extra))
    },
    remove: () => { if (notes && selIdx != null) commit(deleteNote(notes, selIdx), null) },
    add: (bar: number, pos: number, string: number) => {
      const r = notes && addNote(a, notes, bar, pos, string, 0, tuning, capo)
      if (r) commit(r.notes, r.index)
    },
  }
  const canMove = (dir: -1 | 1) => !!(notes && selIdx != null && moveString(notes, selIdx, dir, tuning, capo))
  const revert = () => {
    if (!window.confirm(t('tab.edit.revertConfirm'))) return
    window.clearTimeout(timer.current)
    seq.current++
    api.revertTab(a.id, part).then((res) => { s.setAnalysis(res); setDraft(null); setSelIdx(null); setSaveState('idle') })
      .catch(() => setSaveState('error'))
  }

  useEffect(() => {
    if (!editing || selIdx == null) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      const n = notes?.[selIdx]
      if (!n) return
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        if (e.shiftKey) edit.string(e.key === 'ArrowUp' ? -1 : 1)
        else edit.fret(n.fret + (e.key === 'ArrowUp' ? 1 : -1))
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        edit.remove()
      } else if (e.key === 'Escape') {
        setSelIdx(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  const head = locatePlayhead(a, s.time)
  const sounding = notesAt(notes ?? [], s.time)
  const uncertain = mapped.filter((n) => n.low).sort((x, y) => x.start - y.start)
  const nextU = uncertain.find((n) => n.start > s.time + 0.05)
  const nowIds = useMemo(
    () => new Set(mapped.filter((n) => n.start <= s.time && s.time < n.end).map((n) => n.id)),
    [mapped, s.time],
  )
  const bpb = beatsPerBar(a)

  const byBarBeat = useMemo(() => {
    const map = new Map<string, { string: number; fret: number; low: boolean }[]>()
    for (const n of notes ?? []) {
      let bi = 0
      while (bi + 1 < a.grid.length && a.grid[bi + 1].t <= n.start + 0.01) bi++
      const g = a.grid[bi]
      if (!g) continue
      const k = `${g.bar}:${g.pos}`
      const arr = map.get(k) ?? []
      arr.push({ string: n.string, fret: n.fret, low: !!n.low_confidence })
      map.set(k, arr)
    }
    return map
  }, [notes, a.grid])

  const from = Math.max(0, head.bar - 2)
  const to = Math.min(a.bars.length, Math.max(from + 8, head.bar + 6))
  const slice = a.bars.slice(from, to)

  useEffect(() => {
    const el = host.current
    const tex = tab?.alpha_tex
    if (!el || !tex || view !== 'both') return
    let cancelled = false
    let handle: { destroy(): void; tickPosition: number } | null = null
    import('@coderline/alphatab').then((alphaTab) => {
      if (cancelled || !host.current) return
      try {
        const atSettings = new alphaTab.Settings()
        atSettings.core.engine = 'svg'
        atSettings.core.fontDirectory = '/font/'
        atSettings.core.useWorkers = false
        atSettings.display.staveProfile = alphaTab.StaveProfile.Default
        atSettings.display.scale = zoom
        atSettings.player.enablePlayer = true
        atSettings.player.enableCursor = true
        atSettings.player.enableAnimatedBeatCursor = true
        atSettings.player.scrollMode = alphaTab.ScrollMode.Off
        // Visual only — audio comes from the shared Original | Tab guitar transport.
        atSettings.player.playerMode = alphaTab.PlayerMode.EnabledExternalMedia
        const at = new alphaTab.AlphaTabApi(host.current, atSettings)
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
  }, [tab?.alpha_tex, view, zoom])

  useEffect(() => {
    const at = apiRef.current
    if (!at) return
    try { at.tickPosition = timeToTick(a, s.time) } catch { /* player not ready */ }
  }, [a, s.time, s.playing])

  if (!tab || (!(notes?.length) && !tab.alpha_tex)) {
    return <p className="text-sm text-muted-foreground">{t('tab.empty')}</p>
  }

  return (
    <div className="flex flex-col gap-4 pb-44">
      {a.sections.length > 1 && (
        <SectionStrip
          sections={a.sections}
          duration={a.duration}
          time={s.time}
          names={sectionNames(a.sections, t, true)}
          onJump={(sec) => s.seek(sec.start)}
          onLoop={(_, i) => s.loopSection(i)}
          loopStart={s.loop?.start}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: 'tab', label: t('tab.view.tab') },
              { value: 'both', label: t('tab.view.both') },
              { value: 'fretboard', label: t('tab.view.fretboard') },
            ]}
          />
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={advanced} onCheckedChange={setAdvanced} />
            {t('tab.advanced')}
          </label>
          <label className="flex items-center gap-2 text-sm" data-testid="chords-toggle">
            <Switch checked={showChords} onCheckedChange={toggleChords} />
            {t('tab.showChords')}
          </label>
          <label className="flex items-center gap-2 text-sm" data-testid="edit-toggle">
            <Switch checked={editing} onCheckedChange={(v) => { setEditing(v); if (!v) setSelIdx(null) }} />
            {t('tab.edit.toggle')}
          </label>
        </div>
        <p className="text-xs text-muted-foreground" data-testid="tab-glyph-key">
          {t('tab.glyphs')}
        </p>
      </div>

      {showChords && <ChordStrip chords={stripChords} current={nowChord} lefty={settings.lefty} />}

      {(view === 'tab' || view === 'both') && (
        <TabStaff
          analysis={a}
          notes={mapped}
          currentBar={head.bar}
          currentPos={head.pos}
          selectedId={sel?.id}
          nowIds={nowIds}
          onSelect={(n, el) => {
            setSelIdx(n.index)
            s.seek(n.start)
            // keep the note clear of the editor docked at the bottom
            if (editing) el?.closest('[data-testid=tab-staff]')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
          }}
          zoom={zoom}
          emptyHint={t('tab.sectionChords')}
          sectionLabels={a.sections.length > 1 ? sectionNames(a.sections, t, true) : undefined}
          chordMarks={showChords ? chordMarks : undefined}
          autoScroll={s.autoScroll && !editing}
          onAdd={editing ? edit.add : undefined}
        />
      )}

      {(tab.edited || saveState !== 'idle') && (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="edit-status">
          {saveState === 'saving' && <span className="text-muted-foreground">{t('tab.edit.saving')}</span>}
          {saveState === 'saved' && <span className="text-primary">✓ {t('tab.edit.saved')}</span>}
          {saveState === 'error' && <span className="text-destructive">{t('tab.edit.error')}</span>}
          {saveState === 'idle' && tab.edited && <span className="text-muted-foreground">{t('tab.edit.edited')}</span>}
          {tab.edited && (
            <Button size="sm" variant="ghost" onClick={revert} data-testid="edit-revert">{t('tab.edit.revert')}</Button>
          )}
        </div>
      )}

      <p className="text-sm text-muted-foreground">{t('tab.how')}</p>

      {tab.stats?.fallback && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm">{t('tab.fallback')}</div>
      )}
      {tab.error && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm">{t('tab.noTab')} {tab.error}</div>
      )}

      {uncertain.length > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2 text-sm">
          <span>{t('tab.uncertainCount', { n: uncertain.length })}</span>
          <Button size="sm" variant="outline" disabled={!nextU} onClick={() => nextU && s.seek(nextU.start)}>
            {t('tab.nextUncertain')}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>{t('tab.zoom')}</span>
        <input type="range" min={0.8} max={1.8} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
        <label className="ml-2 flex items-center gap-2 text-sm">
          <Switch checked={s.autoScroll} onCheckedChange={s.setAutoScroll} />
          {t('song.autoScroll')}
        </label>
        {advanced && (
          <span className="text-xs text-muted-foreground">
            {t('tab.notesCount', { n: tab.stats?.n_notes ?? notes?.length ?? 0 })}
            {tab.stats?.n_low_confidence ? ` · ${tab.stats.n_low_confidence} ${t('tab.lowConf')}` : ''}
            {tab.stats?.guitar_source ? ` · ${t('tab.guitarSource', { s: tab.stats.guitar_source })}` : ''}
          </span>
        )}
        {advanced && (
          <>
            <a className="ml-auto text-xs text-primary underline-offset-4 hover:underline" href={api.musicxmlUrl(a.id, part)}>{t('song.exportItems.musicxml')}</a>
            <a className="text-xs text-primary underline-offset-4 hover:underline" href={api.alphatexUrl(a.id, part)}>{t('tab.exportAlphatex')}</a>
          </>
        )}
      </div>

      {view === 'both' && (
        <div className="alphatab-host overflow-auto rounded-2xl border border-border p-2" ref={host} />
      )}
      {view === 'both' && tabErr && <p className="text-xs text-muted-foreground">{tabErr}</p>}

      {(view === 'fretboard' || (view === 'both' && advanced)) && (
        <>
          <h3 className="text-sm font-semibold">{t('tab.fretboard')}</h3>
          <Fretboard notes={sounding} capo={tab.capo} lefty={settings.lefty} />
        </>
      )}

      {advanced && (
        <>
          <h3 className="text-sm font-semibold">{t('tab.measureTable')}</h3>
          <MeasureTable
            bars={slice}
            byBarBeat={byBarBeat}
            curBar={head.bar}
            curBeat={head.beat}
            bpb={bpb}
            onSeek={s.seek}
            autoScroll={s.autoScroll && s.playing}
            analysisBars={a.bars}
          />

          <details className="text-sm text-muted-foreground">
            <summary>{t('tab.legendTitle')}</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {Object.entries(tab.technique_legend || {}).map(([k, v]) => {
                const techKey = LEGEND_GLYPH[k] ?? 'none'
                return (
                  <li key={k}>
                    <b>{t(`tab.techniques.${techKey}` as TKey)}</b>
                    {' '}({v.reliability}) — {v.note}
                  </li>
                )
              })}
            </ul>
          </details>
        </>
      )}

      <p className="text-[11px] text-muted-foreground">{t('tab.attribution')}</p>

      {sel && (
        <p className="text-xs text-muted-foreground">
          {t('tab.string')} {sel.string} · {t('tab.fret')} {sel.fret}
          {sel.technique ? ` · ${sel.technique}` : ''}
        </p>
      )}

      <div className="sticky bottom-3 z-20 flex flex-col gap-2">
        {editing && (
          <div className="flex flex-col gap-2">
            {sel && notes?.[sel.index] ? (
              <NoteEditor
                note={notes[sel.index]}
                canHigher={canMove(-1)}
                canLower={canMove(1)}
                onFret={edit.fret}
                onString={edit.string}
                onToggle={edit.toggle}
                onDelete={edit.remove}
                onClose={() => setSelIdx(null)}
              />
            ) : (
              <p className="rounded-xl border border-dashed border-border bg-card/80 px-3 py-2 text-sm text-muted-foreground backdrop-blur">
                {t('tab.edit.hint')}
              </p>
            )}
          </div>
        )}
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
