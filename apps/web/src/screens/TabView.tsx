import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/api'
import { TabStaff } from '@/components/app/TabStaff'
import { Fretboard, MeasureTable } from '@/components/app/Fretboard'
import { Transport } from '@/components/app/Transport'
import { SectionStrip } from '@/components/app/SectionStrip'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/switch'
import { useApp, type TKey } from '@/lib/store'
import { sectionNames } from '@/lib/display'
import { beatsPerBar, locatePlayhead, notesAt, staffNotes, timeToTick, type StaffNote } from '@/lib/time'
import { useSong } from './song-session'

const LEGEND_GLYPH: Record<string, string> = {
  bend: 'b', slide: 'sl', hammer: 'h', pull: 'h', vibrato: 'v', palmMute: 'pm',
}

export function TabView() {
  const { t, settings } = useApp()
  const s = useSong()
  const a = s.analysis
  const tab = a.tab
  const [sel, setSel] = useState<StaffNote | null>(null)
  const [zoom, setZoom] = useState(1)
  const [view, setView] = useState<'tab' | 'both' | 'fretboard'>('tab')
  const [advanced, setAdvanced] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  const apiRef = useRef<{ destroy(): void; tickPosition: number } | null>(null)
  const [tabErr, setTabErr] = useState<string | null>(null)

  const notes = tab?.notes
  const mapped = useMemo(() => staffNotes(a, notes ?? []), [a, notes])
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
      <SectionStrip
        sections={a.sections}
        duration={a.duration}
        time={s.time}
        names={sectionNames(a.sections, t, true)}
        onJump={(sec) => s.seek(sec.start)}
        onLoop={(_, i) => s.loopSection(i)}
        loopStart={s.loop?.start}
      />

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
        </div>
        <p className="font-mono text-xs font-semibold tracking-wide text-primary" data-testid="tab-glyph-key">
          {t('tab.glyphs')}
        </p>
      </div>

      {(view === 'tab' || view === 'both') && (
        <TabStaff
          analysis={a}
          notes={mapped}
          currentBar={head.bar}
          currentPos={head.pos}
          selectedId={sel?.id}
          nowIds={nowIds}
          onSelect={(n) => { setSel(n); s.seek(n.start) }}
          zoom={zoom}
          emptyHint={t('tab.sectionChords')}
          autoScroll={s.autoScroll}
        />
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
            <a className="ml-auto text-xs text-primary underline-offset-4 hover:underline" href={api.musicxmlUrl(a.id)}>{t('song.exportItems.musicxml')}</a>
            <a className="text-xs text-primary underline-offset-4 hover:underline" href={api.alphatexUrl(a.id)}>{t('tab.exportAlphatex')}</a>
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
        />
      </div>
    </div>
  )
}
