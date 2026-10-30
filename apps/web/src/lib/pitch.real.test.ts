/**
 * Tuner check on real guitar notes: IDMT-SMT-Guitar dataset1 (isolated electric guitar notes with
 * known pitch; eval only, not shipped). Skipped when the dataset is not under data/eval/idmt.
 * Compares the shipped detector with the plain autocorrelation the tuner used before.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { centsBetween, detectPitch } from './pitch'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../data/eval/idmt/IDMT-SMT-GUITAR_V2/dataset1')

function readWav(path: string): { data: Float32Array; sr: number } {
  const b = readFileSync(path)
  let off = 12
  let sr = 44100
  let ch = 1
  let bits = 16
  while (off < b.length) {
    const id = b.toString('ascii', off, off + 4)
    const size = b.readUInt32LE(off + 4)
    if (id === 'fmt ') { ch = b.readUInt16LE(off + 10); sr = b.readUInt32LE(off + 12); bits = b.readUInt16LE(off + 22) }
    if (id === 'data') {
      const n = size / (bits / 8) / ch
      const out = new Float32Array(n)
      for (let i = 0; i < n; i++) out[i] = bits === 16 ? b.readInt16LE(off + 8 + i * ch * 2) / 32768 : b.readInt32LE(off + 8 + i * ch * 4) / 2 ** 31
      return { data: out, sr }
    }
    off += 8 + size + (size % 2)
  }
  throw new Error('no data chunk')
}

/** the tuner's detector before this change */
function oldDetect(buf: Float32Array, sr: number): number | null {
  let rms = 0
  for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i]
  if (Math.sqrt(rms / buf.length) < 0.01) return null
  let bestLag = 0
  let bestCorr = 0
  for (let lag = Math.floor(sr / 1100); lag < Math.floor(sr / 70); lag++) {
    let c = 0
    for (let i = 0; i < buf.length - lag; i++) c += buf[i] * buf[i + lag]
    if (c > bestCorr) { bestCorr = c; bestLag = lag }
  }
  return bestLag ? sr / bestLag : null
}

describe.skipIf(!existsSync(ROOT))('tuner on real guitar notes (IDMT dataset1)', () => {
  it('finds the right note, without octave errors', () => {
    const rows: { midi: number; neu?: number; old?: number; sNeu?: number; sOld?: number }[] = []
    for (const dir of readdirSync(ROOT).filter((d: string) => !d.includes('Chords'))) {
      const ann = join(ROOT, dir, 'annotation')
      for (const f of readdirSync(ann).filter((x: string) => x.endsWith('.xml'))) {
        const xml = readFileSync(join(ann, f), 'utf8')
        const midi = Number(/<pitch>(\d+)<\/pitch>/.exec(xml)?.[1])
        const onset = Number(/<onsetSec>([\d.]+)<\/onsetSec>/.exec(xml)?.[1])
        const { data, sr } = readWav(join(ROOT, dir, 'audio', f.replace('.xml', '.wav')))
        const a = Math.round((onset + 0.25) * sr)
        const win = data.subarray(a, a + 4096)
        if (win.length < 4096) continue
        const ref = 440 * 2 ** ((midi - 69) / 12)
        const p = detectPitch(win, sr)
        const o = oldDetect(win, sr)
        // The same note resampled 7 cents sharp (cubic interpolation, same rate): the reading must
        // move by exactly 7 cents. A whole-sample detector moves by 0 or by a full lag step.
        const k = 2 ** (7 / 1200)
        const up = new Float32Array(4096)
        for (let i = 0; i < 4096; i++) {
          const x = a + i * k
          const j = Math.floor(x)
          const f = x - j
          const p0 = data[j - 1] ?? 0, p1 = data[j], p2 = data[j + 1] ?? 0, p3 = data[j + 2] ?? 0
          up[i] = p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)))
        }
        const shift = (fn: (w: Float32Array, rate: number) => number | null) => {
          const x = fn(win, sr)
          const y = fn(up, sr)
          return x && y ? Math.abs(centsBetween(y, x) - 7) : undefined
        }
        rows.push({
          midi, neu: p ? centsBetween(p.hz, ref) : undefined, old: o ? centsBetween(o, ref) : undefined,
          sNeu: shift((w, r) => detectPitch(w, r)?.hz ?? null), sOld: shift(oldDetect),
        })
      }
    }
    const rate = (k: 'neu' | 'old', ok: (c: number) => boolean) => rows.filter((r) => r[k] !== undefined && ok(r[k]!)).length / rows.length
    const right = (c: number) => Math.abs(c) < 50
    const octave = (c: number) => Math.abs(Math.abs(c) - 1200) < 60 || Math.abs(Math.abs(c) - 1902) < 60
    const med = (k: 'neu' | 'old') => {
      const v = rows.filter((r) => r[k] !== undefined && right(r[k]!)).map((r) => Math.abs(r[k]!)).sort((x, y) => x - y)
      return v[Math.floor(v.length / 2)]
    }
    const vals = (k: 'sNeu' | 'sOld') => rows.map((r) => r[k]).filter((x): x is number => x !== undefined).sort((x, y) => x - y)
    const medOf = (k: 'sNeu' | 'sOld') => vals(k)[Math.floor(vals(k).length / 2)]
    const p90 = (k: 'sNeu' | 'sOld') => vals(k)[Math.floor(vals(k).length * 0.9)]
    const report = {
      notes: rows.length,
      right_note: { new: rate('neu', right).toFixed(3), old: rate('old', right).toFixed(3) },
      octave_or_fifth_error: { new: rate('neu', octave).toFixed(3), old: rate('old', octave).toFixed(3) },
      median_abs_cents_when_right: { new: med('neu')?.toFixed(1), old: med('old')?.toFixed(1) },
      error_on_7_cent_change_median: { new: medOf('sNeu')?.toFixed(2), old: medOf('sOld')?.toFixed(2) },
      error_on_7_cent_change_p90: { new: p90('sNeu')?.toFixed(2), old: p90('sOld')?.toFixed(2) },
    }
    console.log('TUNER', JSON.stringify(report))
    expect(rate('neu', right)).toBeGreaterThan(0.95)
    expect(rate('neu', right)).toBeGreaterThanOrEqual(rate('old', right))
    expect(medOf('sNeu')).toBeLessThan(medOf('sOld'))
  }, 120000)
})
