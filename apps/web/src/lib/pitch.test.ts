import { describe, expect, it } from 'vitest'
import { centsBetween, detectPitch, nearestNote, PitchSmoother } from './pitch'

const SR = 48000
/** Plucked-string-like tone: strong 2nd/3rd harmonics, slight inharmonicity, decay, noise. */
function pluck(f0: number, n = 4096, seed = 1, fundamental = 0.5): Float32Array {
  const out = new Float32Array(n)
  let r = seed
  const rand = () => { r = (r * 16807) % 2147483647; return r / 2147483647 - 0.5 }
  const amps = [fundamental, 1.0, 0.7, 0.4, 0.25, 0.15]
  for (let i = 0; i < n; i++) {
    const t = i / SR
    let x = 0
    amps.forEach((a, k) => {
      const h = k + 1
      x += a * Math.sin(2 * Math.PI * f0 * h * Math.sqrt(1 + 0.00008 * h * h) * t)
    })
    out[i] = 0.2 * x * Math.exp(-t * 3) + 0.01 * rand()
  }
  return out
}

describe('detectPitch', () => {
  const strings = [82.41, 110.0, 146.83, 196.0, 246.94, 329.63]
  it.each(strings)('open string %f Hz within 1.5 cents, no octave error', (f) => {
    const p = detectPitch(pluck(f), SR)!
    expect(p).not.toBeNull()
    expect(Math.abs(centsBetween(p.hz, f))).toBeLessThan(1.5)
  })

  it('weak fundamental (low E through a small amp) still reads the fundamental', () => {
    const p = detectPitch(pluck(82.41, 4096, 3, 0.1), SR)!
    expect(Math.abs(centsBetween(p.hz, 82.41))).toBeLessThan(2)
  })

  it('sees a string 10 cents flat as 10 cents flat', () => {
    const f = 196 * 2 ** (-10 / 1200)
    expect(Math.abs(centsBetween(detectPitch(pluck(f), SR)!.hz, 196) + 10)).toBeLessThan(1.5)
  })

  it('stays quiet on silence and noise', () => {
    expect(detectPitch(new Float32Array(4096), SR)).toBeNull()
    let r = 7
    const noise = Float32Array.from({ length: 4096 }, () => { r = (r * 16807) % 2147483647; return 0.2 * (r / 2147483647 - 0.5) })
    expect(detectPitch(noise, SR)).toBeNull()
  })
})

describe('helpers', () => {
  it('nearestNote with A4 = 440 and 432', () => {
    expect(nearestNote(440)).toMatchObject({ name: 'A', octave: 4, midi: 69 })
    expect(nearestNote(82.41)).toMatchObject({ name: 'E', octave: 2 })
    expect(Math.round(nearestNote(432, 432).cents)).toBe(0)
  })
  it('smoother takes the median and restarts on a new note', () => {
    const s = new PitchSmoother(5)
    ;[110, 111, 250, 110.5].forEach((x) => s.push(x))
    expect(s.push(110.2)).toBeCloseTo(110.35, 0)
  })
})
