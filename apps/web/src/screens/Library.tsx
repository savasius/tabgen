import { Link, useNavigate } from 'react-router-dom'
import { Heart, MoreHorizontal, Plus, Search, Upload, FileVideo, Mic } from 'lucide-react'
import { useApp, relativeTime, type TKey } from '@/lib/store'
import { Cover } from '@/components/app/Cover'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/dropdown'
import { Segmented } from '@/components/ui/segmented'
import { coverHue } from '@/lib/utils'
import { api, ApiError, type Job, type LibraryEntry } from '@/api'
import { lastPlayedMap, listFavorites, listTrackedJobs, toggleFavorite, untrackJob, type TrackedJob } from '@/lib/local'
import { useEffect, useMemo, useState } from 'react'

type Filter = 'all' | 'ready' | 'processing' | 'favorites'

interface CardSong {
  id: string
  title: string
  artist: string
  status: 'done' | 'queued' | 'running' | 'failed'
  progress: number
  stage?: string
  coverHue: number
  lastPlayed?: number
  favorite: boolean
  source?: string
  jobId?: string
  stale?: boolean
  guitars?: number
  edited?: boolean
}

export function Library() {
  const { t } = useApp()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [lib, setLib] = useState<LibraryEntry[]>([])
  const [jobs, setJobs] = useState<(TrackedJob & { job?: Job })[]>([])
  const [favs, setFavs] = useState(listFavorites)
  const played = lastPlayedMap()

  useEffect(() => {
    api.library().then(setLib).catch(() => {})
  }, [])

  useEffect(() => {
    let stop = false
    const poll = async () => {
      const tracked = listTrackedJobs()
      const next: (TrackedJob & { job?: Job })[] = []
      for (const j of tracked) {
        try {
          const job = await api.job(j.id)
          if (job.status === 'done' && job.analysis_id) untrackJob(j.id)
          else if (job.status === 'failed') next.push({ ...j, job })
          else next.push({ ...j, job })
        } catch (e) {
          // jobs live in the server's memory: after a restart it no longer knows this one, and
          // asking again forever won't change that (a finished song is in the library anyway)
          if (e instanceof ApiError && e.status === 404) untrackJob(j.id)
          else next.push(j)
        }
      }
      if (!stop) {
        setJobs(next)
        api.library().then(setLib).catch(() => {})
      }
      if (!stop && next.some((j) => j.job?.status === 'running' || j.job?.status === 'queued' || !j.job)) {
        setTimeout(poll, 1200)
      }
    }
    void poll()
    return () => { stop = true }
  }, [])

  const songs: CardSong[] = useMemo(() => {
    const ready: CardSong[] = lib.map((e) => ({
      id: e.id,
      title: e.title || e.id,
      artist: e.artist || '—',
      status: 'done',
      progress: 100,
      coverHue: coverHue(e.id),
      lastPlayed: played[e.id],
      favorite: favs.includes(e.id),
      source: e.source,
      stale: e.stale,
      guitars: e.guitars,
      edited: e.edited,
    }))
    const processing: CardSong[] = jobs.map((j) => ({
      id: j.job?.analysis_id || j.id,
      jobId: j.id,
      title: j.title,
      artist: j.artist || '—',
      status: (j.job?.status as CardSong['status']) || 'queued',
      progress: j.job?.progress ?? 0,
      stage: j.job?.stage,
      coverHue: j.coverHue,
      favorite: false,
      source: j.source,
    }))
    return [...processing, ...ready]
  }, [lib, jobs, favs, played])

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    return songs.filter((s) => {
      if (query && !`${s.title} ${s.artist}`.toLowerCase().includes(query)) return false
      if (filter === 'ready') return s.status === 'done'
      if (filter === 'processing') return s.status !== 'done' && s.status !== 'failed'
      if (filter === 'favorites') return s.favorite
      return true
    })
  }, [songs, q, filter])

  const recent = songs.filter((s) => s.lastPlayed && s.status === 'done').sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
  const processing = songs.filter((s) => s.status !== 'done' && s.status !== 'failed')

  if (!lib.length && !jobs.length) return <EmptyLibrary />

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-6 md:px-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{t('library.title')}</h1>
          <p className="mt-1 text-muted-foreground">{t('library.subtitle')}</p>
        </div>
        <Button asChild variant="glow">
          <Link to="/add">
            <Plus /> {t('nav.add')}
          </Link>
        </Button>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: t('library.filters.all') },
            { value: 'ready', label: t('library.filters.ready') },
            { value: 'processing', label: t('library.filters.processing') },
            { value: 'favorites', label: t('library.filters.favorites') },
          ]}
        />
      </div>

      {!!recent.length && filter === 'all' && !q && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t('library.recent')}</h2>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none">
            {recent.slice(0, 8).map((s) => (
              <SongCard key={s.id} song={s} compact />
            ))}
          </div>
        </section>
      )}

      {!!processing.length && filter !== 'ready' && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t('library.processing')}</h2>
          <div className="grid gap-3">
            {processing.map((s) => (
              <ProcessingRow key={s.jobId || s.id} song={s} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t('library.all')}</h2>
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((s) => (
              <SongCard
                key={s.jobId || s.id}
                song={s}
                onFav={() => setFavs(toggleFavorite(s.id))}
              />
            ))}
          </div>
        )}
      </section>
      <p className="text-xs text-muted-foreground">{t('library.tip')}</p>
    </div>
  )
}

function EmptyLibrary() {
  const { t } = useApp()
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-6 py-20 text-center">
      <div className="mb-5 grid size-16 place-items-center rounded-2xl bg-primary/15 text-primary">
        <Plus className="size-8" />
      </div>
      <h1 className="text-2xl font-semibold">{t('library.empty.title')}</h1>
      <p className="mt-2 text-muted-foreground">{t('library.empty.body')}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button asChild variant="glow">
          <Link to="/add">{t('library.empty.cta')}</Link>
        </Button>
      </div>
      <div className="mt-10 grid w-full grid-cols-3 gap-2 text-xs text-muted-foreground">
        <Link to="/add?tab=file" className="rounded-xl border border-border p-3 hover:bg-accent">
          <Upload className="mx-auto mb-1 size-4" /> {t('add.tabs.file')}
        </Link>
        <Link to="/add?tab=youtube" className="rounded-xl border border-border p-3 hover:bg-accent">
          <FileVideo className="mx-auto mb-1 size-4" /> {t('add.tabs.youtube')}
        </Link>
        <Link to="/add?tab=mic" className="rounded-xl border border-border p-3 hover:bg-accent">
          <Mic className="mx-auto mb-1 size-4" /> {t('add.tabs.mic')}
        </Link>
      </div>
    </div>
  )
}

function statusLabel(s: CardSong, t: (k: TKey, v?: Record<string, string | number>) => string) {
  if (s.status === 'done') return t('library.status.done')
  if (s.status === 'failed') return t('library.status.failed')
  if (s.status === 'queued') return t('library.status.queued')
  return t('library.status.processing', { p: s.progress })
}

function SongCard({ song, compact, onFav }: { song: CardSong; compact?: boolean; onFav?: () => void }) {
  const { t } = useApp()
  const nav = useNavigate()
  const href = song.status === 'failed'
    ? `/processing/${song.jobId || song.id}`
    : song.status === 'done' ? `/song/${song.id}` : `/processing/${song.jobId || song.id}`
  return (
    <article className={compact ? 'w-56 shrink-0' : ''}>
      <button type="button" onClick={() => nav(href)} className="flex w-full gap-3 rounded-2xl border border-border bg-card p-3 text-left hover:bg-accent/40">
        <Cover hue={song.coverHue} title={song.title} className="size-16 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-semibold">{song.title}</p>
              <p className="truncate text-sm text-muted-foreground">{song.artist}</p>
            </div>
            {song.favorite && <Heart className="size-4 shrink-0 fill-primary text-primary" />}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge variant={song.status === 'failed' ? 'danger' : song.status === 'done' ? (song.stale ? 'warning' : 'success') : 'primary'}>
              {song.status === 'done' && song.stale ? t('library.stale') : statusLabel(song, t)}
            </Badge>
            {song.status === 'done' && (song.guitars ?? 1) > 1 && (
              <Badge variant="outline" data-testid="card-guitars">{t('library.guitars', { n: song.guitars! })}</Badge>
            )}
            {song.status === 'done' && song.edited && (
              <Badge variant="outline" data-testid="card-edited">{t('library.edited')}</Badge>
            )}
          </div>
        </div>
      </button>
      {!compact && song.status === 'done' && (
        <div className="-mt-10 mr-2 mb-2 flex justify-end">
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="more">
                <MoreHorizontal />
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={() => nav(href)}>{t('common.open')}</MenuItem>
              <MenuItem onSelect={onFav}>{t('library.filters.favorites')}</MenuItem>
              <MenuItem onSelect={() => api.reanalyze(song.id).then((j) => nav(`/processing/${j.id}`))}>
                {t('library.reanalyze')}
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      )}
      {song.lastPlayed && song.status === 'done' && (
        <p className="mt-1 px-1 text-[11px] text-muted-foreground">
          {t('library.lastPlayed', { when: relativeTime(song.lastPlayed, t) })}
        </p>
      )}
    </article>
  )
}

function ProcessingRow({ song }: { song: CardSong }) {
  const { t } = useApp()
  const stageKey = `processing.stages.${song.stage ?? 'queued'}` as TKey
  return (
    <Link to={`/processing/${song.jobId || song.id}`} className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 hover:bg-accent/40">
      <Cover hue={song.coverHue} title={song.title} className="size-12" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{song.title}</p>
        <p className="text-xs text-muted-foreground">{t(stageKey)}</p>
        <Progress value={song.progress} className="mt-2" />
      </div>
      <span className="font-mono text-sm tabular text-muted-foreground">{song.progress}%</span>
    </Link>
  )
}
