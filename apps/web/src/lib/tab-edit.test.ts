import { describe, expect, it } from 'vitest'
import type { Analysis, TabNote } from '@/api'
import { addNote, deleteNote, moveString, openMidi, setFret, toggleTechnique } from './tab-edit'

const STD = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']
const n = (start: number, string: number, fret: number): TabNote => ({
  start, end: start + 0.4, string, fret, midi: openMidi(STD, string) + fret, techniques: [],
})

describe('tab edits', () => {
  it('fret change keeps the string and recomputes pitch', () => {
    const out = setFret([n(0, 1, 3)], 0, 5, STD)
    expect(out[0]).toMatchObject({ string: 1, fret: 5, midi: 69, edited: true })
    expect(setFret([n(0, 1, 3)], 0, 25, STD)[0].fret).toBe(3)
  })

  it('string move keeps the pitch (B string 5th fret = high e open)', () => {
    const out = moveString([n(0, 2, 5)], 0, -1, STD)!
    expect(out[0]).toMatchObject({ string: 1, fret: 0, midi: 64 })
    expect(moveString([n(0, 1, 0)], 0, 1, STD)![0]).toMatchObject({ string: 2, fret: 5 })
    expect(moveString([n(0, 6, 0)], 0, -1, STD)).toBeNull()   // below the open A
    expect(moveString([n(0, 2, 5), n(0, 1, 3)], 0, -1, STD)).toBeNull() // string already sounding
  })

  it('hammer and pull replace each other; same bend toggles off', () => {
    let notes = toggleTechnique([n(0, 3, 5)], 0, 'hammer')
    notes = toggleTechnique(notes, 0, 'pull')
    expect(notes[0].techniques.map((t) => t.type)).toEqual(['pull'])
    notes = toggleTechnique(notes, 0, 'bend', { quarter_tones: 2 })
    notes = toggleTechnique(notes, 0, 'bend', { quarter_tones: 4 })
    expect(notes[0].techniques.find((t) => t.type === 'bend')?.quarter_tones).toBe(4)
    notes = toggleTechnique(notes, 0, 'bend', { quarter_tones: 4 })
    expect(notes[0].techniques.some((t) => t.type === 'bend')).toBe(false)
  })

  it('add and delete', () => {
    const a = {
      bars: [{ index: 0, start: 0, end: 2, beats: [0, 1, 2, 3], section: null, pickup: false }],
      grid: [0, 0.5, 1, 1.5].map((t, i) => ({ t, end: t + 0.5, bar: 0, pos: i, chord: 'N' })),
    } as unknown as Analysis
    const added = addNote(a, [n(0, 1, 3)], 0, 6, 3, 2, STD)!
    expect(added.notes[added.index]).toMatchObject({ start: 0.75, end: 1.25, string: 3, fret: 2, midi: 57 })
    expect(addNote(a, added.notes, 0, 6, 3, 0, STD)).toBeNull()  // same spot taken
    expect(deleteNote(added.notes, 0)).toHaveLength(1)
  })
})

describe('shiftChordLabel', () => {
  it('moves the root and a note-name bass, keeps degree basses and N', async () => {
    const { shiftChordLabel } = await import('./tab-edit')
    expect(shiftChordLabel('A:min', 3)).toBe('C:min')
    expect(shiftChordLabel('C:maj/E', -2)).toBe('A#:maj/D')
    expect(shiftChordLabel('D:maj/5', 2)).toBe('E:maj/5')
    expect(shiftChordLabel('Bb:7', 2)).toBe('C:7')
    expect(shiftChordLabel('N', 5)).toBe('N')
  })
})
