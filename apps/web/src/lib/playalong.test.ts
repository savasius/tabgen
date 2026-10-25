import { describe, expect, it } from 'vitest'
import { BeatScore, chordMatch, chordPcs, chroma, noteMatch } from './playalong'

const SR = 48000
const FFT = 8192
/** analyser-like dB spectrum of guitar notes (fundamentals + harmonics + noise floor) */
function spectrum(midis: number[]): Float32Array {
  const db = new Float32Array(FFT / 2).fill(-100)
  const binHz = SR / FFT
  for (const m of midis) {
    const f0 = 440 * 2 ** ((m - 69) / 12)
    ;[1, 0.6, 0.45, 0.3, 0.2].forEach((a, h) => {
      const k = Math.round((f0 * (h + 1)) / binHz)
      if (k < db.length) db[k] = Math.max(db[k], 20 * Math.log10(a) - 20)
    })
  }
  return db
}
// open-position voicings (low to high)
const C = [48, 52, 55, 60, 64]          // C E G C E
const G = [43, 47, 50, 55, 59, 67]      // G B D G B G
const Am = [45, 52, 57, 60, 64]         // A E A C E
const Em = [40, 47, 52, 55, 59, 64]

describe('chordMatch', () => {
  it('recognises the chord being strummed', () => {
    expect(chordMatch(chroma(spectrum(C), SR, FFT), 'C:maj').ok).toBe(true)
    expect(chordMatch(chroma(spectrum(G), SR, FFT), 'G:maj').ok).toBe(true)
    expect(chordMatch(chroma(spectrum(Am), SR, FFT), 'A:min').ok).toBe(true)
    expect(chordMatch(chroma(spectrum(Em), SR, FFT), 'E:min').ok).toBe(true)
  })
  it('rejects a different chord, including close relatives', () => {
    expect(chordMatch(chroma(spectrum(G), SR, FFT), 'C:maj').ok).toBe(false)
    expect(chordMatch(chroma(spectrum(Am), SR, FFT), 'C:maj').ok).toBe(false)  // shares C and E
    expect(chordMatch(chroma(spectrum(C), SR, FFT), 'A:min').ok).toBe(false)
    expect(chordMatch(chroma(spectrum(Em), SR, FFT), 'G:maj').ok).toBe(false)  // shares G and B
  })
  it('accepts a seventh played as its triad', () => {
    expect(chordMatch(chroma(spectrum(G), SR, FFT), 'G:7').ok).toBe(true)
  })
  it('no chord expected = nothing to match', () => {
    expect(chordPcs('N')).toBeNull()
    expect(chordMatch(chroma(spectrum(C), SR, FFT), 'N').ok).toBe(false)
  })
})

describe('noteMatch', () => {
  it('within half a semitone, octave errors forgiven', () => {
    expect(noteMatch(440, [69])).toBe(true)
    expect(noteMatch(440 * 2 ** (40 / 1200), [69])).toBe(true)
    expect(noteMatch(466.16, [69])).toBe(false)
    expect(noteMatch(220, [69])).toBe(true)
  })
})

describe('BeatScore', () => {
  it('counts hits, misses and the best streak', () => {
    const s = new BeatScore()
    const play = (b: number, oks: boolean[]) => oks.forEach((o) => s.add(b, o))
    play(0, [true, true, false]); play(1, [true, true]); play(2, [false, false, false]); play(3, [true, true])
    expect(s.result(0)).toBe('hit')
    expect(s.result(2)).toBe('miss')
    expect(s.result(9)).toBeNull()
    expect(s.summary([0, 1, 2, 3, 4])).toEqual({ hit: 3, played: 4, accuracy: 0.75, streak: 2 })
  })
})
