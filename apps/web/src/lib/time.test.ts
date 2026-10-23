import { describe, expect, it } from 'vitest'
import type { Analysis } from '@/api'
import { locatePlayhead, posInBar, staffNotes } from './time'

function stub(): Analysis {
  const beats = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]
  return {
    id: 'x',
    version: 'p2',
    meta: {},
    duration: 4,
    tempo: { bpm: 120, time_signature: '4/4' },
    beats,
    downbeats: [0, 2],
    key: { tonic: 'A', mode: 'minor', confidence: 1 },
    tuning: { a4_hz: 440, cents: 0, guess: 'standard' },
    sections: [{ label: 'intro', start: 0, end: 2 }, { label: 'solo', start: 2, end: 4 }],
    chords: [],
    grid: beats.map((t, i) => ({ t, end: t + 0.5, bar: Math.floor(i / 4), pos: i % 4, chord: 'A:min' })),
    bars: [
      { index: 0, start: 0, end: 2, beats: [0, 1, 2, 3], section: 0, pickup: false },
      { index: 1, start: 2, end: 4, beats: [4, 5, 6, 7], section: 1, pickup: false },
    ],
    models: {},
    timings: {},
  }
}

describe('tab time mapping', () => {
  it('places a note on the first 16th of bar 0', () => {
    const a = stub()
    const notes = staffNotes(a, [{ start: 0, end: 0.2, midi: 64, string: 2, fret: 5, techniques: [] }])
    expect(notes[0].bar).toBe(0)
    expect(notes[0].pos).toBe(0)
    expect(notes[0].string).toBe(2)
    expect(notes[0].fret).toBe(5)
  })

  it('maps mid-bar time to 16th slots and playhead', () => {
    const a = stub()
    expect(posInBar(a, 0, 1)).toBe(8)
    const p = locatePlayhead(a, 2.25)
    expect(p.bar).toBe(1)
    expect(p.pos).toBe(2)
  })

  it('keeps a smooth now-line between 16ths', () => {
    const a = stub()
    const p = locatePlayhead(a, 2.3)
    expect(p.bar).toBe(1)
    expect(p.pos).toBeCloseTo(2.4, 5)
  })

  it('maps hammer/bend techniques onto staff notes', () => {
    const a = stub()
    const notes = staffNotes(a, [
      { start: 0.1, end: 0.3, midi: 64, string: 2, fret: 7, techniques: [{ type: 'hammer', source: 'heuristic' }] },
      { start: 2.1, end: 2.4, midi: 69, string: 1, fret: 5, low_confidence: true, techniques: [{ type: 'bend', source: 'contour', cents: 80 }] },
    ])
    expect(notes[0].technique).toBe('h')
    expect(notes[1].bar).toBe(1)
    expect(notes[1].low).toBe(true)
    expect(notes[1].technique).toBe('b')
  })
})
