export interface Section { label: string; start: number; end: number }
export interface GridBeat { t: number; end: number; bar: number; pos: number; chord: string }
export interface Bar { index: number; start: number; end: number; beats: number[]; section: number | null; pickup: boolean }
export interface ChordSeg { start: number; end: number; label: string; beats: number }

export interface Technique {
  type: 'bend' | 'slide' | 'hammer' | 'pull' | 'vibrato' | 'palmMute'
  source: 'contour' | 'timing' | 'heuristic' | 'guess' | 'legato'
  cents?: number
  quarter_tones?: number
  /** bend-and-release folded from a split Basic Pitch note */
  release?: boolean
  to_fret?: number
}

export interface TabNote {
  start: number
  end: number
  midi: number
  string: number
  fret: number
  velocity?: number
  confidence?: number
  low_confidence?: boolean
  techniques: Technique[]
  source?: string
}

export interface TabData {
  tuning: string[]
  tuning_guess?: string
  capo: number
  notes: TabNote[]
  alpha_tex: string
  technique_legend: Record<string, { reliability: string; note: string }>
  models: Record<string, unknown>
  stats: { n_notes: number; n_low_confidence: number; fallback?: string | null; guitar_source?: string }
  error?: string | null
}

export type AudioStem = 'mix' | 'guitar' | 'original'

/** One guitar split out of the guitar stem (by stereo position, or lead line vs comping). */
export interface GuitarPart {
  id: string
  role: 'lead' | 'rhythm'
  pan: number
  side: 'left' | 'centre' | 'right'
  share: number | null
  split: 'stereo' | 'role'
  chords: ChordSeg[]
  /** per-beat chords heard on this guitar alone; null = the song's grid */
  grid: GridBeat[] | null
  chords_source: 'part' | 'song'
  audio: string
  tab: TabData
}

export interface GuitarInfo {
  source: string
  rms: number
  mix_rms: number
  ratio: number
  warning: string | null
  empty: boolean
  separation?: string | null
}

export interface Analysis {
  id: string
  version: string
  stale?: boolean
  meta: {
    title?: string | null
    artist?: string | null
    source?: string | null
    url?: string
    youtube_id?: string | null
    youtube_offset?: number | null
  }
  duration: number
  tempo: { bpm: number; bpm_allin1?: number; time_signature: string; beat_source?: string; tempo_folded?: string | null }
  beats: number[]
  downbeats: number[]
  key: {
    tonic: string
    mode: 'major' | 'minor'
    confidence: number
    relative_adjusted?: boolean
    skey_tonic?: string
    skey_mode?: string
  }
  tuning: { a4_hz: number; cents: number; guess: string }
  sections: Section[]
  chords: ChordSeg[]
  grid: GridBeat[]
  bars: Bar[]
  tab?: TabData | null
  /** empty when the stem holds a single guitar */
  parts?: GuitarPart[]
  guitar?: GuitarInfo
  audio?: { mix: string; original: string; guitar: string }
  warnings?: { code: string; message: string }[]
  stems?: Partial<Record<'guitar' | 'vocals' | 'bass' | 'drums' | 'piano' | 'other' | 'harmonic', boolean>>
  models: Record<string, string>
  timings: Record<string, number>
}

export interface Job {
  id: string
  status: 'queued' | 'running' | 'done' | 'failed'
  stage: string
  progress: number
  analysis_id: string | null
  error: string | null
}

export interface LibraryEntry { id: string; title?: string; artist?: string; source?: string; updated_at?: number }

const BASE = import.meta.env.VITE_API_BASE ?? ''

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = res.statusText
    try { msg = (await res.json()).detail ?? msg } catch { /* not json */ }
    throw new Error(msg)
  }
  return res.json()
}

export const api = {
  config: () => fetch(`${BASE}/v1/config`).then(json<{
    url_ingest_enabled: boolean; device: string; pipeline_version?: string; audio_stems?: AudioStem[]
  }>),
  upload: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return fetch(`${BASE}/v1/jobs/upload`, { method: 'POST', body: fd }).then(json<Job>)
  },
  fromUrl: (url: string) =>
    fetch(`${BASE}/v1/jobs/url`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
    }).then(json<Job>),
  job: (id: string) => fetch(`${BASE}/v1/jobs/${id}`).then(json<Job>),
  analysis: (id: string) => fetch(`${BASE}/v1/analyses/${id}`).then(json<Analysis>),
  library: () => fetch(`${BASE}/v1/analyses`).then(json<LibraryEntry[]>),
  patch: (id: string, body: Partial<{ title: string; artist: string; youtube_id: string | null; youtube_offset: number }>) =>
    fetch(`${BASE}/v1/analyses/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(json<LibraryEntry>),
  reanalyze: (id: string) =>
    fetch(`${BASE}/v1/analyses/${id}/reanalyze`, { method: 'POST' }).then(json<Job>),
  audioUrl: (id: string, stem: AudioStem = 'mix') =>
    `${BASE}/v1/analyses/${id}/audio${stem === 'mix' ? '' : `?stem=${encodeURIComponent(stem)}`}`,
  guitarStemUrl: (id: string) => `${BASE}/v1/analyses/${id}/stems/guitar`,
  guitarStemUrls: (id: string) => [
    `${BASE}/v1/analyses/${id}/audio?stem=guitar`,
    `${BASE}/v1/analyses/${id}/stems/guitar`,
  ],
  musicxmlUrl: (id: string) => `${BASE}/v1/analyses/${id}/export/musicxml`,
  alphatexUrl: (id: string) => `${BASE}/v1/analyses/${id}/export/alphatex`,
}
