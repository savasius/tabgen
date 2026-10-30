import { describe, expect, it } from 'vitest'
import type { Analysis, GuitarPart } from '@/api'
import { partLabels, withPart } from './parts'

const part = (id: string, role: GuitarPart['role'], side: GuitarPart['side']): GuitarPart => ({
  id, role, side, pan: 0, share: null, split: 'stereo', chords: [{ start: 0, end: 1, label: id, beats: 1 }],
  grid: null, chords_source: 'part', audio: `/a?part=${id}`,
  tab: { tuning: [], capo: 0, notes: [], alpha_tex: id, technique_legend: {}, models: {}, stats: { n_notes: 0, n_low_confidence: 0 } },
})

const base = {
  id: 'x', tab: null, chords: [], grid: [{ t: 0, end: 1, bar: 0, pos: 0, chord: 'C' }],
  audio: { mix: 'm', original: 'o', guitar: 'g' }, parts: [part('s1', 'rhythm', 'left'), part('s2', 'lead', 'centre')],
} as unknown as Analysis

describe('withPart', () => {
  it('keeps the song for all guitars', () => {
    expect(withPart(base, null)).toEqual({ ...base, viewPart: 'all' })
  })
  it('swaps tab, chords and guitar audio for one part, keeping the song grid when the part has none', () => {
    const v = withPart(base, 's2')
    expect(v.tab?.alpha_tex).toBe('s2')
    expect(v.chords[0].label).toBe('s2')
    expect(v.audio?.guitar).toBe('/a?part=s2')
    expect(v.audio?.mix).toBe('m')
    expect(v.grid).toBe(base.grid)
  })
})

describe('partLabels', () => {
  it('numbers parts only when a role repeats', () => {
    const l = partLabels([part('a', 'rhythm', 'left'), part('b', 'rhythm', 'right'), part('c', 'lead', 'centre')])
    expect(l.map((x) => x.n)).toEqual([1, 2, null])
  })
})
