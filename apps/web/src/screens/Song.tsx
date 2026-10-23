import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Download, Info } from 'lucide-react'
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
import { Transport } from '@/components/app/Transport'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/dropdown'
import { useApp } from '@/lib/store'
import { sectionNames, shownChord, uniqueLabels } from '@/lib/display'
import { chordKey, noteName, spellingForKey, transpose as transposeChord, type Level } from '@/music/chords'
import { cn } from '@/lib/utils'
import { SongSessionProvider, soundingSpelling, useSong } from './song-session'

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
  return (
    <SongSessionProvider analysis={analysis} setAnalysis={setAnalysis}>
      <SongChrome />
    </SongSessionProvider>
  )
}

function SongChrome() {
  const { t, settings } = useApp()
  const s = useSong()
  const a = s.analysis
  const [coach, setCoach] = useState(() => sessionStorage.getItem('tabgen.coach') !== '1')
  const [reErr, setReErr] = useState<string | null>(null)
  const nav = useNavigate()

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
          <h1 className="truncate text-xl font-semibold">{a.meta.title || a.id}</h1>
          <p className="truncate text-sm text-muted-foreground">{a.meta.artist || '—'}</p>
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
            <Badge>{Math.round(a.tempo.bpm)} {t('common.bpm')}</Badge>
            <HelpTip content={t('help.bpm')} />
          </span>
          <Badge variant="outline">
            {t('song.tuning')} {a.tuning.guess} · {a.tuning.cents}¢
          </Badge>
        </div>
        <Menu>
          <MenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Download className="size-3.5" /> {t('song.export')}
            </Button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem onSelect={() => { window.location.href = api.musicxmlUrl(a.id) }}>
              {t('song.exportItems.musicxml')}
            </MenuItem>
            <MenuItem onSelect={() => { window.location.href = api.alphatexUrl(a.id) }}>
              {t('tab.exportAlphatex')}
            </MenuItem>
          </MenuContent>
        </Menu>
      </header>

      {a.stale && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-2 text-sm">
          {t('song.stale')}
          <Button size="sm" onClick={() => {
            setReErr(null)
            api.reanalyze(a.id).then((j) => nav(`/processing/${j.id}`)).catch((e) => setReErr(String((e as Error).message)))
          }}>{t('song.reanalyze')}</Button>
          {reErr && <span className="text-destructive">{reErr}</span>}
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

      <audio ref={s.audioRef} src={api.audioUrl(a.id)} preload="auto" className="hidden" />
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
      {Math.abs(a.tuning.cents) >= 5 && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-2 text-sm">
          {t('song.tuningOff', { c: a.tuning.cents })}
        </div>
      )}

      <SectionStrip
        sections={a.sections}
        duration={a.duration}
        time={s.time}
        names={secNames}
        onJump={(sec) => s.seek(sec.start)}
        onLoop={(_, i) => s.loopSection(i)}
        loopStart={s.loop?.start}
      />
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
      <p className="order-4 -mt-2 text-[11px] text-muted-foreground">{t('song.uncertainHint')}</p>

      <div className="order-4">
        <ChordGrid
          analysis={a}
          names={names}
          changes={changes}
          sectionNames={sectionNames(a.sections, t)}
          curBeat={s.curBeat}
          loop={s.loop}
          autoScroll={s.autoScroll && s.playing}
          onSeek={s.seek}
        />
      </div>
      <p className="order-4 text-[11px] text-muted-foreground">
        {t('song.accuracy')} · {t('song.shortcuts')}
        {a.models.chords ? ` · ${a.models.chords}` : ''}
      </p>
    </div>
  )
}
