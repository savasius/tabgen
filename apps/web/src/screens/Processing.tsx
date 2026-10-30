import { Link, useNavigate, useParams } from 'react-router-dom'
import { useApp, type TKey } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Cover } from '@/components/app/Cover'
import { Check, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type Job } from '@/api'
import { listTrackedJobs, untrackJob } from '@/lib/local'
import { coverHue, cn } from '@/lib/utils'

// The engine reports a dozen stages; a player needs four. Each backend stage maps to one phase.
const PHASES = ['prepare', 'separate', 'listen', 'write'] as const
type Phase = typeof PHASES[number]
const PHASE_OF: Record<string, Phase> = {
  queued: 'prepare', fetching: 'prepare', decoding: 'prepare',
  separating: 'separate',
  beats: 'listen', sections: 'listen', chords: 'listen', key: 'listen',
  transcribe: 'write', tab: 'write', parts: 'write', finalizing: 'write', done: 'write',
}

/** A message the player can act on instead of the engine's exception text. */
function friendlyError(raw: string): { title: TKey; body: TKey } {
  if (/unreadable|decode|invalid data|ffmpeg|ebml/i.test(raw)) return { title: 'states.decode.title', body: 'states.decode.body' }
  if (/too long|duration/i.test(raw)) return { title: 'states.tooLong.title', body: 'states.tooLong.body' }
  if (/no music|silent|empty/i.test(raw)) return { title: 'states.noMusic.title', body: 'states.noMusic.body' }
  return { title: 'processing.failedTitle', body: 'processing.failedBody' }
}

export function Processing() {
  const { id = '' } = useParams()
  const { t } = useApp()
  const nav = useNavigate()
  const [job, setJob] = useState<Job | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [started] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  const tracked = listTrackedJobs().find((j) => j.id === id)
  useEffect(() => { const h = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(h) }, [])

  useEffect(() => {
    let stop = false
    const poll = async () => {
      try {
        const j = await api.job(id)
        if (stop) return
        setJob(j)
        if (j.status === 'done' && j.analysis_id) {
          untrackJob(id)
          nav(`/song/${j.analysis_id}`, { replace: true })
          return
        }
        if (j.status === 'failed') return
      } catch (e) {
        setErr(String((e as Error).message))
        return
      }
      setTimeout(poll, 900)
    }
    void poll()
    return () => { stop = true }
  }, [id, nav])

  const title = tracked?.title || id
  const pct = job?.progress ?? 0
  const hue = tracked?.coverHue ?? coverHue(id)
  const failed = job?.status === 'failed'
  const phase: Phase = PHASE_OF[job?.stage ?? 'queued'] ?? 'prepare'
  // remaining time from how fast this job is actually going, once there is something to go on
  const elapsed = (now - started) / 1000
  const remaining = pct >= 10 && pct < 100 ? Math.max(5, Math.round((elapsed * (100 - pct)) / pct)) : null
  const fe = failed ? friendlyError(job?.error || '') : null

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <div className="flex items-center gap-4">
        <Cover hue={hue} title={title} className="size-16" />
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{failed ? t('processing.failedTitle') : t('processing.title')}</p>
          <h1 className="truncate text-2xl font-semibold">{title}</h1>
        </div>
      </div>

      {!failed && (
        <>
          <Progress value={pct} className="mt-8 h-2" />
          <p className="mt-2 text-sm tabular text-muted-foreground" data-testid="processing-eta">
            {remaining == null
              ? t('processing.starting')
              : remaining < 60
                ? t('processing.etaSeconds', { n: remaining })
                : t('processing.eta', { t: `${Math.round(remaining / 60)} ${t('common.min')}` })}
          </p>

          <ol className="mt-8 space-y-4">
            {PHASES.map((ph) => {
              const ci = PHASES.indexOf(phase)
              const i = PHASES.indexOf(ph)
              const done = job?.status === 'done' || i < ci
              const active = ph === phase && job?.status !== 'done'
              return (
                <li key={ph} className={cn('flex items-start gap-3 transition-opacity', !done && !active && 'opacity-50')}>
                  <span
                    className={cn(
                      'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border',
                      done && 'border-success bg-success text-white',
                      active && 'border-primary text-primary',
                      !done && !active && 'border-border text-muted-foreground',
                    )}
                  >
                    {done ? <Check className="size-3.5" /> : active ? <Loader2 className="size-3.5 animate-spin" /> : i + 1}
                  </span>
                  <div>
                    <p className={cn('text-sm font-medium', active && 'text-primary')}>{t(`processing.phases.${ph}` as TKey)}</p>
                    {active && <p className="text-xs text-muted-foreground">{t(`processing.phaseHint.${ph}` as TKey)}</p>}
                  </div>
                </li>
              )
            })}
          </ol>
          <p className="mt-6 text-sm text-muted-foreground">{t('processing.body')}</p>
        </>
      )}

      {fe && (
        <div role="alert" className="mt-8 rounded-2xl border border-destructive/40 bg-destructive/5 p-4">
          <p className="font-medium">{t(fe.title)}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t(fe.body)}</p>
          {job?.error && (
            <details className="mt-3 text-xs text-muted-foreground">
              <summary className="cursor-pointer">{t('processing.details')}</summary>
              <p className="mt-1 break-words font-mono">{job.error}</p>
            </details>
          )}
        </div>
      )}
      {err && <p className="mt-4 text-sm text-destructive">{err}</p>}

      <div className="mt-8 flex flex-wrap gap-2">
        {failed ? (
          <Button variant="glow" asChild><Link to="/add">{t('processing.tryAnother')}</Link></Button>
        ) : (
          <Button variant="outline" asChild><Link to="/">{t('processing.background')}</Link></Button>
        )}
      </div>
    </div>
  )
}
