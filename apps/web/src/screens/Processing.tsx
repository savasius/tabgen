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

const ORDER = ['queued', 'fetching', 'decoding', 'separating', 'beats', 'sections', 'chords', 'key', 'transcribe', 'tab', 'finalizing'] as const

export function Processing() {
  const { id = '' } = useParams()
  const { t } = useApp()
  const nav = useNavigate()
  const [job, setJob] = useState<Job | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const tracked = listTrackedJobs().find((j) => j.id === id)

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
  const current = job?.stage ?? 'queued'
  const pct = job?.progress ?? 0
  const hue = tracked?.coverHue ?? coverHue(id)

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <div className="flex items-center gap-4">
        <Cover hue={hue} title={title} className="size-16" />
        <div>
          <p className="text-sm text-muted-foreground">{job?.status === 'failed' ? t('processing.failedTitle') : t('processing.title')}</p>
          <h1 className="text-2xl font-semibold">{title}</h1>
        </div>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">{t('processing.body')}</p>
      <Progress value={pct} className="mt-6 h-2" />
      <p className="mt-2 text-sm tabular text-muted-foreground">
        {pct}% · {t('processing.eta', { t: `${Math.max(1, Math.round((100 - pct) / 20))} ${t('common.min')}` })}
      </p>

      <ol className="mt-8 space-y-3">
        {ORDER.map((st, i) => {
          const ci = ORDER.indexOf(current as typeof ORDER[number])
          const done = job?.status === 'done' || (ci >= 0 && i < ci)
          const active = st === current && job?.status !== 'done' && job?.status !== 'failed'
          return (
            <li key={st} className="flex items-start gap-3">
              <span
                className={cn(
                  'mt-0.5 grid size-6 place-items-center rounded-full border',
                  done && 'border-success bg-success text-white',
                  active && 'border-primary text-primary',
                  !done && !active && 'border-border text-muted-foreground',
                )}
              >
                {done ? <Check className="size-3.5" /> : active ? <Loader2 className="size-3.5 animate-spin" /> : i + 1}
              </span>
              <div>
                <p className={cn('text-sm font-medium', active && 'text-primary')}>{t(`processing.stages.${st}` as TKey)}</p>
                {active && (st === 'separating' || st === 'chords' || st === 'tab') && (
                  <p className="text-xs text-muted-foreground">{t(`processing.stageHint.${st}` as TKey)}</p>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      {job?.error && <p className="mt-4 text-sm text-destructive">{job.error}</p>}
      {err && <p className="mt-4 text-sm text-destructive">{err}</p>}

      <div className="mt-8 flex flex-wrap gap-2">
        <Button variant="outline" asChild>
          <Link to="/">{t('processing.background')}</Link>
        </Button>
      </div>
    </div>
  )
}
