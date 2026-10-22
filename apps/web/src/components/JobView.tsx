import { useEffect, useState } from 'react'
import { api, type Job } from '../api'
import { useI18n, type TKey } from '../i18n'

export function JobView({ id, onDone, onBack }: { id: string; onDone: (analysisId: string) => void; onBack: () => void }) {
  const { t } = useI18n()
  const [job, setJob] = useState<Job | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let stop = false
    const poll = async () => {
      try {
        const j = await api.job(id)
        if (stop) return
        setJob(j)
        if (j.status === 'done' && j.analysis_id) return onDone(j.analysis_id)
        if (j.status === 'failed') return
      } catch (e) {
        setErr(String((e as Error).message))
        return
      }
      setTimeout(poll, 1000)
    }
    poll()
    return () => { stop = true }
  }, [id, onDone])

  return (
    <div className="page job">
      <button className="link" onClick={onBack}>{t('back')}</button>
      <h2>{job?.status === 'failed' ? t('failed') : t('processing')}</h2>
      {job && (
        <>
          <div className="bar-outer"><div className="bar-inner" style={{ width: `${job.progress}%` }} /></div>
          <p>{t(`stage_${job.stage}` as TKey)} — {job.progress}%</p>
          {job.error && <p className="error">{job.error}</p>}
        </>
      )}
      {err && <p className="error">{err}</p>}
    </div>
  )
}
