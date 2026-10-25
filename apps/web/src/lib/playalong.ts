import { parseHarte } from '@/music/chords'

/**
 * Play-along scoring from the microphone: does what the player is sounding match the song?
 * Chords: a 12-bin chroma of the mic spectrum against the expected chord's notes. Notes: the
 * monophonic pitch (lib/pitch) against the tab notes sounding now. Pure functions, unit-tested.
 */

const IV: Record<string, number[]> = {
  maj: [0, 4, 7], min: [0, 3, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10],
  dim: [0, 3, 6], aug: [0, 4, 8], dim7: [0, 3, 6, 9], hdim7: [0, 3, 6, 10], sus2: [0, 2, 7],
  sus4: [0, 5, 7], '7sus4': [0, 5, 7, 10], 'sus4(b7)': [0, 5, 7, 10], '5': [0, 7], '1': [0],
  maj6: [0, 4, 7, 9], min6: [0, 3, 7, 9], '9': [0, 4, 7, 10, 2], maj9: [0, 4, 7, 11, 2],
  min9: [0, 3, 7, 10, 2], minmaj7: [0, 3, 7, 11], '11': [0, 4, 7, 10, 5], '13': [0, 4, 7, 10, 9],
}

export function chordPcs(label: string): number[] | null {
  const c = parseHarte(label)
  if (c.root === null) return null
  // "maj(#11)", "7(9)": the base quality is what a strummed chord sounds like
  const pcs = (IV[c.quality] ?? IV[c.quality.split('(')[0]] ?? IV.maj).map((i) => (c.root! + i) % 12)
  if (c.bass !== null && !pcs.includes(c.bass)) pcs.push(c.bass)
  return pcs
}

export interface MatchParams {
  floorDb: number   // bins this far under the loudest are noise
  hiHz: number      // upper analysis limit (higher harmonics blur the chroma)
  minScore: number  // the chord must explain the sound at least this well
  margin: number    // ... and nearly as well as the best rival triad
  rootWeight: number
}
// Tuned on GuitarSet player 01 comping, checked on player 05 (lib/playalong.real.test.ts).
export const MATCH: MatchParams = { floorDb: 60, hiHz: 800, minScore: 0.55, margin: 0.04, rootWeight: 1 }

/** Chroma of an analyser frame (`getFloatFrequencyData`, dB), 70 Hz-hiHz, unit length. */
export function chroma(db: Float32Array, sr: number, fftSize: number, p: MatchParams = MATCH): Float32Array {
  const out = new Float32Array(12)
  const binHz = sr / fftSize
  const lo = Math.ceil(70 / binHz)
  const hi = Math.min(db.length - 1, Math.floor(p.hiHz / binHz))
  let peak = -Infinity
  for (let k = lo; k <= hi; k++) peak = Math.max(peak, db[k])
  for (let k = lo; k <= hi; k++) {
    if (db[k] < peak - p.floorDb) continue // ignore the noise floor
    const pw = 10 ** (db[k] / 10)
    const midi = 69 + 12 * Math.log2((k * binHz) / 440)
    const pc = ((Math.round(midi) % 12) + 12) % 12
    out[pc] += Math.sqrt(pw) // magnitude: one loud harmonic must not swamp the triad
  }
  let n = 0
  for (const v of out) n += v * v
  n = Math.sqrt(n) || 1
  for (let i = 0; i < 12; i++) out[i] /= n
  return out
}

function template(pcs: number[], root: number, rootWeight: number): Float32Array {
  const t = new Float32Array(12)
  pcs.forEach((pc) => { t[pc] = pc === root ? rootWeight : 1 })
  let n = 0
  for (const v of t) n += v * v
  n = Math.sqrt(n)
  for (let i = 0; i < 12; i++) t[i] /= n
  return t
}

function cos(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < 12; i++) s += a[i] * b[i]
  return s
}

const RIVALS: { pcs: number[]; root: number }[] = []
for (let r = 0; r < 12; r++) {
  RIVALS.push({ pcs: [r, (r + 4) % 12, (r + 7) % 12], root: r }, { pcs: [r, (r + 3) % 12, (r + 7) % 12], root: r })
}

/**
 * Is the player on the expected chord? `ok` when the chord explains the sound at least about as
 * well as any other major/minor triad (relative, so it works at any loudness and with voicing
 * differences) and clearly better than chance.
 */
export function chordMatch(ch: Float32Array, label: string, p: MatchParams = MATCH): { ok: boolean; score: number } {
  const pcs = chordPcs(label)
  if (!pcs) return { ok: false, score: 0 }
  const root = parseHarte(label).root!
  const want = cos(ch, template(pcs, root, p.rootWeight))
  let best = 0
  for (const rv of RIVALS) {
    if (rv.root === root && rv.pcs.every((p) => pcs.includes(p))) continue // the chord itself
    best = Math.max(best, cos(ch, template(rv.pcs, rv.root, p.rootWeight)))
  }
  return { ok: want >= p.minScore && want >= best - p.margin, score: want }
}

/** A detected pitch matches an expected note within 50 cents; an octave off counts (guitars often ring the octave). */
export function noteMatch(hz: number, expectedMidi: number[]): boolean {
  const m = 69 + 12 * Math.log2(hz / 440)
  return expectedMidi.some((e) => {
    const d = Math.abs(m - e)
    return d < 0.5 || Math.abs(d - 12) < 0.5
  })
}

/** Per-beat tally while playing: a beat is hit when enough of its loud frames matched. */
export class BeatScore {
  private frames = new Map<number, { ok: number; all: number }>()
  add(beat: number, ok: boolean) {
    const f = this.frames.get(beat) ?? { ok: 0, all: 0 }
    f.all++
    if (ok) f.ok++
    this.frames.set(beat, f)
  }
  /** 'hit' | 'miss' per beat that had sound */
  result(beat: number, need = 0.4): 'hit' | 'miss' | null {
    const f = this.frames.get(beat)
    if (!f || f.all < 2) return null
    return f.ok / f.all >= need ? 'hit' : 'miss'
  }
  summary(beats: number[]): { hit: number; played: number; accuracy: number; streak: number } {
    let hit = 0
    let played = 0
    let streak = 0
    let best = 0
    for (const b of beats) {
      const r = this.result(b)
      if (!r) continue
      played++
      if (r === 'hit') { hit++; streak++; best = Math.max(best, streak) } else streak = 0
    }
    return { hit, played, accuracy: played ? hit / played : 0, streak: best }
  }
  reset() { this.frames.clear() }
}
