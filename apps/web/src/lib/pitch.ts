/**
 * Monophonic pitch for the tuner (and mic play-along): YIN (de Cheveigné & Kawahara 2002) with
 * parabolic interpolation of the dip, so the estimate is sub-sample — a tuner needs about one
 * cent, and whole-sample lags are 13 cents apart at the high e string.
 */

export interface Pitch {
  hz: number
  /** 0..1, 1 = perfectly periodic */
  clarity: number
}

const MIN_HZ = 60
const MAX_HZ = 1400
const THRESHOLD = 0.12

export function rms(buf: Float32Array): number {
  let s = 0
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]
  return Math.sqrt(s / buf.length)
}

export function detectPitch(buf: Float32Array, sr: number, minRms = 0.008): Pitch | null {
  if (rms(buf) < minRms) return null
  const maxLag = Math.min(Math.floor(sr / MIN_HZ), Math.floor(buf.length / 2))
  const minLag = Math.max(2, Math.floor(sr / MAX_HZ))
  const w = buf.length - maxLag
  if (w < 64) return null
  // difference function d(tau) and its cumulative-mean normalisation d'(tau)
  const d = new Float32Array(maxLag + 2)
  for (let tau = 1; tau <= maxLag + 1; tau++) {
    let s = 0
    for (let i = 0; i < w; i++) {
      const x = buf[i] - buf[i + tau]
      s += x * x
    }
    d[tau] = s
  }
  const dn = new Float32Array(maxLag + 2)
  dn[0] = 1
  let run = 0
  for (let tau = 1; tau <= maxLag + 1; tau++) {
    run += d[tau]
    dn[tau] = run > 0 ? (d[tau] * tau) / run : 1
  }
  // first dip under the threshold (the lowest-lag period, which avoids octave-down errors) ...
  let tau = -1
  for (let t = minLag; t <= maxLag; t++) {
    if (dn[t] < THRESHOLD) {
      while (t + 1 <= maxLag && dn[t + 1] < dn[t]) t++
      tau = t
      break
    }
  }
  // ... or, for a weak / noisy note, the global minimum if it is still fairly periodic
  if (tau < 0) {
    let best = minLag
    for (let t = minLag + 1; t <= maxLag; t++) if (dn[t] < dn[best]) best = t
    if (dn[best] > 0.35) return null
    tau = best
  }
  const a = dn[tau - 1]
  const b = dn[tau]
  const c = dn[tau + 1] ?? b
  const den = a - 2 * b + c
  const shift = den !== 0 ? Math.max(-0.5, Math.min(0.5, (a - c) / (2 * den))) : 0
  return { hz: sr / (tau + shift), clarity: Math.max(0, Math.min(1, 1 - b)) }
}

export function centsBetween(hz: number, ref: number): number {
  return 1200 * Math.log2(hz / ref)
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** Nearest equal-tempered note for a frequency, given the A4 reference. */
export function nearestNote(hz: number, a4 = 440): { name: string; octave: number; midi: number; cents: number } {
  const midiF = 69 + 12 * Math.log2(hz / a4)
  const midi = Math.round(midiF)
  return { name: NOTE_NAMES[((midi % 12) + 12) % 12], octave: Math.floor(midi / 12) - 1, midi, cents: (midiF - midi) * 100 }
}

/** Median of the last few readings: steadies the needle without lagging behind a retune. */
export class PitchSmoother {
  private hist: number[] = []
  private size: number
  constructor(size = 5) { this.size = size }
  push(hz: number): number {
    const last = this.hist[this.hist.length - 1]
    // a jump of more than ~a semitone is a new note: start over instead of averaging across it
    if (last && Math.abs(centsBetween(hz, last)) > 80) this.hist = []
    this.hist.push(hz)
    if (this.hist.length > this.size) this.hist.shift()
    const s = [...this.hist].sort((x, y) => x - y)
    return s[Math.floor(s.length / 2)]
  }
  reset() { this.hist = [] }
}
