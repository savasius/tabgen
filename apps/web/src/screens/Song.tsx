import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Download, Info, Sparkles } from 'lucide-react'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Segmented } from '@/components/ui/segmented'
import { HelpTip } from '@/components/app/HelpTip'
import { SectionStrip } from '@/components/app/SectionStrip'
import { Waveform } from '@/components/app/Waveform'
import { NowNext } from '@/components/app/NowNext'
import { ChordGrid } from '@/components/app/ChordGrid'
import { ChordPicker } from '@/components/app/ChordPicker'
import { shiftChordLabel } from '@/lib/tab-edit'
import { Transport } from '@/components/app/Transport'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/dropdown'
import { useApp, type TKey } from '@/lib/store'
import { sectionNames, shownChord, uniqueLabels } from '@/lib/display'
import { chordKey, noteName, spellingForKey, transpose as transposeChord, type Level } from '@/music/chords'
import { cn } from '@/lib/utils'
import { partLabels, withPart } from '@/lib/parts'
import { SongSessionProvider, soundingSpelling, useSong } from './song-session'

// a guitar 20 cents off is clearly out of tune; below that a note just distracts
const TUNING_NOTICE_CENTS = 20

export function SongLayout() {
  const { id = '' } = useParams()
  const { t } = useApp()
  const [analysis, setAnalysis] = useState<Awaited<ReturnType<typeof api.analysis>> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stop = false
    api.analysis(id).then((d) => { if (!stop) setAnalysis(d) }).catch((e) => {
      if (!stop) setError(String((e as Error).message ?? e))
    })
    return () => { stop = true }
  }, [id])

  if (error) {
    return (
      <div className="p-10 text-center">
        <p>{t('states.notFound.title')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        <Button asChild className="mt-4">
          <Link to="/">{t('nav.library')}</Link>
        </Button>
      </div>
    )
  }
  if (!analysis) {
    return <div className="p-10 text-center text-muted-foreground">{t('common.loading')}</div>
  }
  return <SongWithParts analysis={analysis} setAnalysis={setAnalysis} />
}

function SongWithParts({ analysis, setAnalysis }: {
  analysis: Awaited<ReturnType<typeof api.analysis>>
  setAnalysis: (a: Awaited<ReturnType<typeof api.analysis>>) => void
}) {
  const [partId, setPartId] = useState<string | null>(null)
  useEffect(() => { setPartId(null) }, [analysis.id])
  const view = useMemo(() => withPart(analysis, partId), [analysis, partId])
  return (
    <SongSessionProvider analysis={view} setAnalysis={setAnalysis}>
      <SongChrome partId={partId} setPartId={setPartId} parts={analysis.parts ?? []} />
    </SongSessionProvider>
  )
}

function PartPicker({ parts, partId, setPartId }: {
  parts: NonNullable<Awaited<ReturnType<typeof api.analysis>>['parts']>
  partId: string | null
  setPartId: (id: string | null) => void
}) {
  const { t } = useApp()
  const labels = partLabels(parts)
  const roleSplit = parts.some((p) => p.split === 'role') && partId !== null
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="part-picker">
      <span className="text-muted-foreground">{t('song.parts.label')}</span>
      <Segmented<string>
        size="sm"
        value={partId ?? 'all'}
        onChange={(v) => setPartId(v === 'all' ? null : v)}
        options={[
          { value: 'all', label: t('song.parts.all'), testId: 'part-all' },
          ...labels.map((l) => ({
            value: l.id,
            testId: `part-${l.id}`,
            label: `${t(`song.parts.${l.role}` as TKey)}${l.n ? ` ${l.n}` : ''} · ${t(`song.parts.side.${l.side}` as TKey)}`,
          })),
        ]}
      />
      <HelpTip content={t('song.parts.help')} />
      {roleSplit && <span className="text-xs text-muted-foreground">{t('song.parts.roleSplit')}</span>}
    </div>
  )
}

function SongChrome({ parts, partId, setPartId }: {
  parts: NonNullable<Awaited<ReturnType<typeof api.analysis>>['parts']>
  partId: string | null
  setPartId: (id: string | null) => void
}) {
  const { t, settings } = useApp()
  const s = useSong()
  const a = s.analysis
  const [coach, setCoach] = useState(() => sessionStorage.getItem('tabgen.coach') !== '1')
  const [reErr, setReErr] = useState<string | null>(null)
  const nav = useNavigate()
  const fixTempo = (factor: 2 | 0.5 | null) => {
    // chord fixes are per beat: a new beat grid can't keep them (tab fixes are timed and stay)
    if (a.edits?.chords?.length && !window.confirm(t('song.tempoFix.dropsChords'))) return
    setReErr(null)
    api.setTempo(a.id, factor).then((j) => nav(`/processing/${j.id}`)).catch((e) => setReErr(String((e as Error).message)))
  }

  const NOTE_PC: Record<string, number> = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 }
  const keyTonic = NOTE_PC[a.key.tonic]
  const soundingKey = keyTonic === undefined
    ? a.key.tonic
    : noteName(
      transposeChord({ root: keyTonic, quality: 'maj', bass: null }, s.transpose).root!,
      spellingForKey((keyTonic + s.transpose) % 12, a.key.mode),
    )

  return (
    <div className="relative mx-auto flex max-w-6xl flex-col gap-4 px-3 pb-4 md:px-8">
      <header className="flex flex-wrap items-center gap-3 pt-4">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/" aria-label={t('common.back')}>
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0 flex-1 basis-40">
          <h1 className="line-clamp-2 text-lg font-semibold leading-tight md:truncate md:text-xl">{a.meta.title || a.id}</h1>
          {a.meta.artist && <p className="truncate text-sm text-muted-foreground">{a.meta.artist}</p>}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 text-xs md:w-auto">
          <span className="inline-flex items-center gap-1">
            <Badge>
              {t('song.key')} {soundingKey}
              {a.key.mode === 'minor' ? 'm' : ''}
            </Badge>
            <HelpTip content={t('help.key')} />
          </span>
          <span className="inline-flex items-center gap-1">
            {/* the tempo octave is the one guess users can always hear is wrong: one click fixes it */}
            <Menu>
              <MenuTrigger asChild>
                <button type="button" className="rounded-md focus-visible:outline-2" aria-label={t('song.tempoFix.title')}
                  data-testid="tempo-menu">
                  <Badge className="cursor-pointer">
                    {Math.round(a.tempo.bpm)} {t('common.bpm')}{a.tempo.tempo_user ? ' ✎' : ''}
                  </Badge>
                </button>
              </MenuTrigger>
              <MenuContent>
                <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('song.tempoFix.title')}</p>
                <MenuItem onSelect={() => fixTempo(2)}>{t('song.tempoFix.double', { n: Math.round(a.tempo.bpm * 2) })}</MenuItem>
                <MenuItem onSelect={() => fixTempo(0.5)}>{t('song.tempoFix.half', { n: Math.round(a.tempo.bpm / 2) })}</MenuItem>
                {a.tempo.tempo_user ? <MenuItem onSelect={() => fixTempo(null)}>{t('song.tempoFix.auto')}</MenuItem> : null}
              </MenuContent>
            </Menu>
            <HelpTip content={t('help.bpm')} />
          </span>
          {Math.abs(a.tuning.cents) >= TUNING_NOTICE_CENTS && (
            <Badge variant="outline">{t('song.tuning')} {a.tuning.cents > 0 ? '+' : ''}{a.tuning.cents}¢</Badge>
          )}
        </div>
        <Menu>
          <MenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Download className="size-3.5" /> {t('song.export')}
            </Button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem onSelect={() => { window.location.href = api.musicxmlUrl(a.id, a.viewPart) }}>
              {t('song.exportItems.musicxml')}
            </MenuItem>
            <MenuItem onSelect={() => { window.location.href = api.alphatexUrl(a.id, a.viewPart) }}>
              {t('tab.exportAlphatex')}
            </MenuItem>
          </MenuContent>
        </Menu>
      </header>

      {parts.length > 1 && <PartPicker parts={parts} partId={partId} setPartId={setPartId} />}

      {a.stale && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1">{t('song.stale')}</span>
          <Button size="sm" variant="outline" onClick={() => {
            setReErr(null)
            api.reanalyze(a.id).then((j) => nav(`/processing/${j.id}`)).catch((e) => setReErr(String((e as Error).message)))
          }}>{t('song.reanalyze')}</Button>
          {reErr && <span className="text-destructive">{reErr}</span>}
        </div>
      )}
      {a.warnings?.some((w) => w.code === 'transcribe-failed') && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm">
          {t('song.transcribeFailed')}
        </div>
      )}
      {a.guitar?.warning && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-2 text-sm">
          {t('song.guitarWarning')}
          {a.guitar.source ? <span className="text-muted-foreground"> ({a.guitar.source})</span> : null}
        </div>
      )}

      <nav className="flex gap-1 rounded-xl bg-secondary p-1">
        {[
          { to: '.', end: true, k: 'song.tabs.chords' as const },
          { to: 'tab', k: 'song.tabs.tab' as const },
          { to: 'play', k: 'song.tabs.play' as const },
        ].map((it) => (
          <NavLink
            key={it.k}
            to={it.to}
            end={it.end}
            className={({ isActive }) =>
              cn(
                'flex-1 rounded-lg py-2 text-center text-sm font-medium text-muted-foreground',
                isActive && 'bg-card text-foreground shadow-sm',
              )
            }
          >
            {t(it.k)}
          </NavLink>
        ))}
      </nav>

      <audio ref={s.audioRef} src={api.audioUrl(a.id)} preload="auto" className="hidden" data-testid="mix-audio" />
      <audio ref={s.guitarRef} src={s.guitarUrl ?? undefined} preload="auto" className="hidden" data-testid="guitar-audio" />
      {s.mode === 'youtube' && a.meta.youtube_id && <div className="yt-frame mx-auto hidden max-w-lg md:block" ref={s.ytMount} />}
      <div
        ref={s.tabHost}
        className="pointer-events-none h-px w-px overflow-hidden opacity-0"
        style={{ width: 1, height: 1 }}
        aria-hidden
        data-testid="tab-synth-host"
      />

      <Outlet />

      {coach && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 md:items-center">
          <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl">
            <div className="mb-3 flex items-center gap-2 text-primary">
              <Info className="size-5" />
              <h2 className="font-semibold">{t('song.howToRead')}</h2>
            </div>
            <ol className="space-y-2 text-sm">
              <li>{t('help.coach.sections')}</li>
              <li>{t('help.coach.now')}</li>
              <li>{t('help.coach.grid')}</li>
              <li>{t('help.coach.controls')}</li>
            </ol>
            <Button
              className="mt-5 w-full"
              variant="glow"
              onClick={() => {
                sessionStorage.setItem('tabgen.coach', '1')
                setCoach(false)
              }}
            >
              {t('common.gotIt')}
            </Button>
          </div>
        </div>
      )}
      <p className="sr-only">{settings.lang}</p>
    </div>
  )
}

export function ChordsView() {
  const { t, settings, set } = useApp()
  const s = useSong()
  const a = s.analysis
  const spelling = soundingSpelling(a, s.transpose, s.capo)
  const opts = useMemo(() => ({ level: s.level, transpose: s.transpose, capo: s.capo }), [s.level, s.transpose, s.capo])
  const names = useMemo(
    () => a.grid.map((g) => shownChord(g.chord, opts, spelling, settings.notation).name),
    [a.grid, opts, spelling, settings.notation],
  )
  const beatChords = useMemo(() => a.grid.map((g) => shownChord(g.chord, opts, spelling, settings.notation).chord), [a.grid, opts, spelling, settings.notation])
  const changes = useMemo(() => beatChords.map((c, i) => {
    if (i === 0) return true
    const g = a.grid[i]
    const prev = a.grid[i - 1]
    const newBlock = a.bars[g.bar]?.section !== a.bars[prev.bar]?.section
    return newBlock || chordKey(c) !== chordKey(beatChords[i - 1])
  }), [a, beatChords])
  const secNames = useMemo(() => sectionNames(a.sections, t, true), [a.sections, t])
  const unique = uniqueLabels(a.chords.map((c) => c.label))

  const [fixing, setFixing] = useState(false)
  const [selBeat, setSelBeat] = useState<number | null>(null)
  const [scope, setScope] = useState<'beat' | 'bar'>('bar')
  const [chordErr, setChordErr] = useState(false)
  const part = a.viewPart ?? 'all'
  // Stored labels are concert pitch; the grid shows them through transpose and capo.
  const shown = s.transpose - (s.capo ?? 0)
  const pickChord = (label: string) => {
    if (selBeat == null) return
    const g = a.grid[selBeat]
    const beats = scope === 'bar' ? (a.bars[g.bar]?.beats ?? [selBeat]) : [selBeat]
    const stored = shiftChordLabel(label, -shown)
    setChordErr(false)
    api.saveChords(a.id, part, Object.fromEntries(beats.map((i) => [i, stored])))
      .then(s.setAnalysis).catch(() => setChordErr(true))
  }
  const revertChords = () => {
    if (!window.confirm(t('song.chordEdit.revertConfirm'))) return
    api.revertChords(a.id, part).then((res) => { s.setAnalysis(res); setSelBeat(null) }).catch(() => setChordErr(true))
  }
  const chordsEdited = a.grid.some((g) => g.edited)

  const snapToBar = (tt: number) => a.bars.findLast((bar) => bar.start <= tt + 0.05) ?? a.bars[0]
  const setLoopPoint = () => {
    if (s.pendingA === null) {
      s.setPendingA(snapToBar(s.time)?.start ?? 0)
      s.setLoop(null)
      return
    }
    const end = snapToBar(s.time)?.end ?? a.duration
    if (end > s.pendingA) s.setLoop({ start: s.pendingA, end })
    s.setPendingA(null)
  }

  return (
    <div className="flex flex-col gap-3 pb-28 md:pb-8">
      {Math.abs(a.tuning.cents) >= TUNING_NOTICE_CENTS && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          {t('song.tuningOff', { c: a.tuning.cents })}
        </div>
      )}

      {/* one section (or none, for a guitar-only take) is just a grey bar: show it when it helps */}
      {a.sections.length > 1 && <SectionStrip
        sections={a.sections}
        duration={a.duration}
        time={s.time}
        names={secNames}
        onJump={(sec) => s.seek(sec.start)}
        onLoop={(_, i) => s.loopSection(i)}
        loopStart={s.loop?.start}
      />}
      <Waveform url={api.audioUrl(a.id)} duration={a.duration} time={s.time} sections={a.sections} onSeek={s.seek} />

      <NowNext
        chords={a.chords}
        bpm={a.tempo.bpm}
        time={s.time}
        transpose={s.transpose}
        capo={s.capo}
        level={s.level}
        spelling={spelling}
        lefty={settings.lefty}
      />

      <div className="order-3 flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 md:order-2 md:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{t('song.capo')}</span>
            <HelpTip content={t('help.capo')} />
            <select
              className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
              value={s.capo}
              onChange={(e) => s.setCapo(Number(e.target.value))}
            >
              <option value={0}>{t('song.capoOff')}</option>
              {Array.from({ length: 7 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{t('song.capoN', { n })}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{t('song.transpose')}</span>
            <HelpTip content={t('help.transpose')} />
            <Button variant="outline" size="icon-sm" onClick={() => s.setTranspose(s.transpose - 1)}>−</Button>
            <span className="w-8 text-center font-mono text-sm tabular">{s.transpose > 0 ? `+${s.transpose}` : s.transpose}</span>
            <Button variant="outline" size="icon-sm" onClick={() => s.setTranspose(s.transpose + 1)}>+</Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{t('song.level')}</span>
            <Segmented
              size="sm"
              value={s.level}
              onChange={s.setLevel}
              options={[
                { value: 'basic' satisfies Level, label: t('song.levels.basic'), hint: t('song.levelHint.basic') },
                { value: 'normal', label: t('song.levels.normal'), hint: t('song.levelHint.normal') },
                { value: 'full', label: t('song.levels.full'), hint: t('song.levelHint.full') },
              ]}
            />
          </div>
          <label className="ml-auto flex items-center gap-2 text-sm">
            <Switch checked={settings.lefty} onCheckedChange={(v) => set('lefty', v)} />
            {t('song.lefty')}
          </label>
        </div>
        {s.suggestedCapo > 0 && s.capo !== s.suggestedCapo && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-primary/10 px-3 py-2 text-sm">
            <span>{t('song.capoSuggest', { n: s.suggestedCapo })}</span>
            <Button size="sm" onClick={() => s.setCapo(s.suggestedCapo)}>{t('song.capoApply')}</Button>
          </div>
        )}
        {s.capo > 0 && <p className="text-sm text-success">{t('song.capoExplain', { n: s.capo })}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('song.playerLabel')}</span>
          <Segmented
            size="sm"
            value={s.mode}
            onChange={s.setMode}
            options={[
              { value: 'file', label: t('song.playerFile') },
              { value: 'youtube', label: t('song.playerYoutube') },
            ]}
          />
          <label className="ml-auto flex items-center gap-2 text-sm">
            <Switch checked={s.autoScroll} onCheckedChange={s.setAutoScroll} />
            {t('song.autoScroll')}
          </label>
        </div>
        {s.mode === 'youtube' && (
          <div className="flex flex-wrap items-center gap-2">
            <input className="h-9 min-w-40 flex-1 rounded-lg border border-input bg-background px-2 text-sm" placeholder={t('song.youtubeLink')} value={s.ytInput} onChange={(e) => s.setYtInput(e.target.value)} />
            <label className="flex items-center gap-1 text-xs">
              {t('song.youtubeOffset')}
              <input type="number" step={0.05} className="h-9 w-20 rounded-lg border border-input bg-background px-2 text-sm" value={s.ytOffset} onChange={(e) => s.setYtOffset(Number(e.target.value))} />
            </label>
            <Button size="sm" onClick={() => api.patch(a.id, { youtube_id: s.ytInput, youtube_offset: s.ytOffset }).then(() => api.analysis(a.id)).then(s.setAnalysis)}>{t('common.save')}</Button>
          </div>
        )}
      </div>

      <div className="order-2 max-md:sticky max-md:bottom-3 max-md:z-20 md:order-3">
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
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant={s.pendingA !== null ? 'default' : 'outline'} onClick={setLoopPoint}>
            {s.pendingA === null ? t('player.loopA') : t('player.loopB')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => s.loopSection(a.bars[a.grid[Math.max(s.curBeat, 0)]?.bar]?.section ?? null)}>
            {t('player.loopThis')}
          </Button>
        </div>
      </div>

      <div className="order-4 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t('song.chordsInSong')}</span>
        {unique.map((label) => (
          <span key={label} className="rounded-md bg-secondary px-2 py-0.5 font-mono text-xs font-semibold">
            {shownChord(label, opts, spelling, settings.notation).name}
          </span>
        ))}
      </div>
      <div className="order-4 -mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-[11px] text-muted-foreground">{t('song.uncertainHint')}</p>
        <label className="ml-auto flex items-center gap-2 text-sm" data-testid="chord-fix-toggle">
          <Switch checked={fixing} onCheckedChange={(v) => { setFixing(v); if (!v) setSelBeat(null) }} />
          {t('tab.edit.toggle')}
        </label>
      </div>
      {(fixing || chordsEdited) && (
        <div className="order-4 flex flex-wrap items-center gap-2 text-sm">
          {fixing && selBeat == null && <span className="text-muted-foreground">{t('song.chordEdit.hint')}</span>}
          {chordErr && <span className="text-destructive">{t('tab.edit.error')}</span>}
          {chordsEdited && <span className="text-muted-foreground">{t('song.chordEdit.edited')}</span>}
          {chordsEdited && (
            <Button size="sm" variant="ghost" onClick={revertChords} data-testid="chord-revert">{t('tab.edit.revert')}</Button>
          )}
        </div>
      )}

      <div className="order-4">
        <ChordGrid
          analysis={a}
          names={names}
          changes={changes}
          sectionNames={sectionNames(a.sections, t)}
          curBeat={s.curBeat}
          loop={s.loop}
          autoScroll={s.autoScroll && s.playing && !fixing}
          onSeek={s.seek}
          selectedBeat={fixing ? selBeat : null}
          onPick={fixing ? setSelBeat : undefined}
        />
      </div>
      {fixing && selBeat != null && a.grid[selBeat] && (
        <div className="sticky bottom-3 z-30 order-5 max-md:bottom-44">
          <ChordPicker
            label={shiftChordLabel(a.grid[selBeat].chord, shown)}
            flats={spelling === 'flats'}
            scope={scope}
            onScope={setScope}
            onPick={pickChord}
            onClose={() => setSelBeat(null)}
          />
        </div>
      )}
      <p className="order-4 text-[11px] text-muted-foreground">
        {t('song.accuracy')} · {t('song.shortcuts')}
      </p>
    </div>
  )
}
