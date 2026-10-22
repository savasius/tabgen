import { describe, expect, it } from 'vitest'
import {
  atLevel, bestCapo, capoSuggestions, displayChord, formatChord, parseHarte, spellingForKey, transpose,
} from './chords'

const fmt = (label: string, level: 'basic' | 'normal' | 'full' = 'full', t = 0, capo = 0) =>
  formatChord(displayChord(label, { level, transpose: t, capo }))

describe('chords', () => {
  it('parses Harte labels with inversions', () => {
    expect(parseHarte('A:min7/b3')).toEqual({ root: 9, quality: 'min7', bass: 0 })
    expect(parseHarte('N').root).toBeNull()
    expect(fmt('C:maj/3')).toBe('C/E')
    expect(fmt('B:hdim7')).toBe('Bm7b5')
  })

  it('simplifies by level', () => {
    expect(fmt('A:min9', 'normal')).toBe('Am7')
    expect(fmt('A:min9', 'basic')).toBe('Am')
    expect(fmt('G:sus4(b7)', 'basic')).toBe('G')
    expect(fmt('C:maj/3', 'normal')).toBe('C')
    expect(formatChord(atLevel(parseHarte('B:dim'), 'basic'))).toBe('Bm')
  })

  it('transposes and applies capo', () => {
    expect(fmt('A:min', 'full', 2)).toBe('Bm')
    expect(formatChord(transpose(parseHarte('B:maj'), -4))).toBe('G')
    expect(fmt('B:maj', 'full', 0, 4)).toBe('G')
    expect(formatChord(parseHarte('A#:maj'), spellingForKey(5, 'major'))).toBe('Bb')
    expect(formatChord(parseHarte('G#:min'), spellingForKey(11, 'major'))).toBe('G#m')
    expect(formatChord(parseHarte('A#:maj'), spellingForKey(5, 'minor'))).toBe('Bb')
    const capo4 = ['B:maj', 'F#:maj', 'G#:min', 'E:maj'].map((l) =>
      formatChord(displayChord(l, { level: 'basic', transpose: 0, capo: 4 }), spellingForKey(7, 'major')),
    )
    expect(capo4).toEqual(['G', 'D', 'Em', 'C'])
  })

  it("suggests capo 4 for I'm Yours (B F# G#m E)", () => {
    const prog = ['B:maj', 'F#:maj', 'G#:min', 'E:maj'].map((label, i) => ({ label, start: i, end: i + 1 }))
    const s = capoSuggestions(prog, { level: 'normal', transpose: 0 })
    expect(bestCapo(s)).toBe(4)
  })

  it('keeps capo 0 for an open-chord song', () => {
    const prog = ['G:maj', 'D:maj', 'A:min', 'C:maj'].map((label, i) => ({ label, start: i, end: i + 1 }))
    expect(bestCapo(capoSuggestions(prog, { level: 'normal', transpose: 0 }))).toBe(0)
  })
})
