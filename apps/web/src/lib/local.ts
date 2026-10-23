const FAV_KEY = 'tabgen.favorites'
const PLAYED_KEY = 'tabgen.lastPlayed'
const JOBS_KEY = 'tabgen.trackedJobs'

export interface TrackedJob {
  id: string
  title: string
  artist?: string
  createdAt: number
  coverHue: number
  source?: string
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key)
    return s ? (JSON.parse(s) as T) : fallback
  } catch {
    return fallback
  }
}

export function listFavorites(): string[] {
  return readJson<string[]>(FAV_KEY, [])
}

export function toggleFavorite(id: string): string[] {
  const cur = listFavorites()
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [id, ...cur]
  localStorage.setItem(FAV_KEY, JSON.stringify(next))
  return next
}

export function lastPlayedMap(): Record<string, number> {
  return readJson<Record<string, number>>(PLAYED_KEY, {})
}

export function markPlayed(id: string) {
  const m = lastPlayedMap()
  m[id] = Date.now()
  localStorage.setItem(PLAYED_KEY, JSON.stringify(m))
}

export function listTrackedJobs(): TrackedJob[] {
  return readJson<TrackedJob[]>(JOBS_KEY, [])
}

export function trackJob(job: TrackedJob) {
  const all = [job, ...listTrackedJobs().filter((j) => j.id !== job.id)].slice(0, 24)
  localStorage.setItem(JOBS_KEY, JSON.stringify(all))
}

export function untrackJob(id: string) {
  localStorage.setItem(JOBS_KEY, JSON.stringify(listTrackedJobs().filter((j) => j.id !== id)))
}
