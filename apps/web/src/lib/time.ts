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

/** PR #3 / alphaTab 1.8 note-property glyphs. `{p}` is slap/pop, `{/}` and `{~}` are invalid. */
export type TechGlyph = 'h' | 'b' | 'sl' | 'v' | 'pm'

export const TECH_GLYPH: Record<string, TechGlyph> = {
  hammer: 'h',
  pull: 'h',
  bend: 'b',
  slide: 'sl',
  vibrato: 'v',
  palmMute: 'pm',
}

export function techniqueGlyph(type: string | undefined): TechGlyph | undefined {
  if (!type) return undefined
  return TECH_GLYPH[type]
}

export function glyphsForNote(note: TabNote): TechGlyph[] {
  const seen = new Set<TechGlyph>()
  const out: TechGlyph[] = []
  for (const t of note.techniques ?? []) {
    const g = techniqueGlyph(t.type)
    if (!g || seen.has(g)) continue
    seen.add(g)
    out.push(g)
  }
  return out
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
  technique?: TechGlyph
  glyphs: TechGlyph[]
  techKind?: TabNote['techniques'][number]['type']
  destId?: string
  bendQt?: number
  midi: number
}

function bendQuarterTones(note: TabNote): number | undefined {
  const bend = (note.techniques ?? []).find((t) => t.type === 'bend')
  if (!bend) return undefined
  if (typeof bend.quarter_tones === 'number') return clamp(Math.round(bend.quarter_tones), 1, 12)
  if (typeof bend.cents === 'number') return clamp(Math.round(bend.cents / 50), 1, 12)
  return 2
}

function nextSameString(list: StaffNote[], i: number): StaffNote | undefined {
  const n = list[i]
  let best: StaffNote | undefined
  for (let j = 0; j < list.length; j++) {
    if (j === i) continue
    const m = list[j]
    if (m.string !== n.string) continue
    if (m.start <= n.start + 1e-4) continue
    if (!best || m.start < best.start) best = m
  }
  return best
}

export function staffNotes(a: Analysis, notes: TabNote[]): StaffNote[] {
  const mapped: StaffNote[] = notes.map((n, i) => {
    let bi = 0
    while (bi + 1 < a.grid.length && a.grid[bi + 1].t <= n.start + 0.01) bi++
    const g = a.grid[bi]
    const bar = g?.bar ?? 0
    const glyphs = glyphsForNote(n)
    const kind = n.techniques?.[0]?.type
    return {
      id: `${i}-${n.start}-${n.string}-${n.fret}`,
      bar,
      pos: posInBar(a, bar, n.start),
      string: n.string,
      fret: n.fret,
      start: n.start,
      end: n.end,
      low: !!n.low_confidence,
      technique: glyphs[0],
      glyphs,
      techKind: kind,
      bendQt: bendQuarterTones(n),
      midi: n.midi,
    }
  })
  for (let i = 0; i < mapped.length; i++) {
    const n = mapped[i]
    if (!n.glyphs.includes('h') && !n.glyphs.includes('sl')) continue
    const dest = nextSameString(mapped, i)
    if (dest) n.destId = dest.id
  }
  return mapped
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
