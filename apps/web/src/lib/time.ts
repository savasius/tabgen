import type { Analysis, TabNote } from '@/api'
import { clamp } from './utils'

export function beatAt(grid: Analysis['grid'], t: number): number {
  let lo = 0
  let hi = grid.length - 1
  if (!grid.length) return -1
  if (t < grid[0].t) return 0
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (grid[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

export function beatsPerBar(a: Analysis): number {
  return Number(a.tempo.time_signature.split('/')[0]) || 4
}

/** 16th-note index inside the bar (0 .. bpb*4). `round: false` for a smooth now-line. */
export function posInBar(a: Analysis, barIndex: number, t: number, round = true): number {
  const bar = a.bars[barIndex]
  if (!bar) return 0
  const steps = beatsPerBar(a) * 4
  const frac = (t - bar.start) / Math.max(0.001, bar.end - bar.start)
  const raw = clamp(frac * steps, 0, steps)
  return round ? clamp(Math.round(raw), 0, steps - 1) : raw
}

export function locatePlayhead(a: Analysis, t: number): { bar: number; pos: number; beat: number } {
  const beat = beatAt(a.grid, t)
  if (beat < 0 || !a.grid[beat]) return { bar: 0, pos: 0, beat: -1 }
  const bar = a.grid[beat].bar
  return { bar, pos: posInBar(a, bar, t, false), beat }
}

export interface StaffNote {
  id: string
  bar: number
  pos: number
  string: number
  fret: number
  start: number
  end: number
  low: boolean
  technique?: 'h' | 'p' | 'b' | 's' | 'v' | 'pm'
  midi: number
}

const TECH: Record<string, StaffNote['technique']> = {
  hammer: 'h', pull: 'p', bend: 'b', slide: 's', vibrato: 'v', palmMute: 'pm',
}

export function staffNotes(a: Analysis, notes: TabNote[]): StaffNote[] {
  return notes.map((n, i) => {
    let bi = 0
    while (bi + 1 < a.grid.length && a.grid[bi + 1].t <= n.start + 0.01) bi++
    const g = a.grid[bi]
    const bar = g?.bar ?? 0
    const tech = n.techniques?.[0]?.type
    return {
      id: `${i}-${n.start}-${n.string}-${n.fret}`,
      bar,
      pos: posInBar(a, bar, n.start),
      string: n.string,
      fret: n.fret,
      start: n.start,
      end: n.end,
      low: !!n.low_confidence,
      technique: tech ? TECH[tech] : undefined,
      midi: n.midi,
    }
  })
}

export function timeToTick(a: Analysis, t: number): number {
  const grid = a.grid
  if (!grid.length) return 0
  let lo = 0
  let hi = grid.length - 1
  if (t < grid[0].t) return 0
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (grid[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  const g = grid[lo]
  const frac = Math.max(0, Math.min(1, (t - g.t) / Math.max(0.001, g.end - g.t)))
  return (lo + frac) * 960
}

export function notesAt(notes: TabNote[], t: number): TabNote[] {
  return notes.filter((n) => n.start <= t && t < n.end)
}
