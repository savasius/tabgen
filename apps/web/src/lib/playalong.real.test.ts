/**
 * Play-along chord check on real recordings: GuitarSet player 05 comping (30 clips, the chords the
 * players were asked to play). Eval only; skipped without data/eval/guitarset. For every 100 ms
 * frame we ask "is the player on chord X?" for the true chord (should say yes) and for the other
 * chords of the same piece (should say no), then the same per beat as the screen scores it.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BeatScore, chordMatch, chroma, MATCH, type MatchParams } from './playalong'

const GS = join(dirname(fileURLToPath(import.meta.url)), '../../../../data/eval/guitarset')

function find(dir: string, re: RegExp): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...find(p, re))
    else if (re.test(e.name)) out.push(p)
  }
  return out
}

function wav(path: string): { x: Float32Array; sr: number } {
  const b = readFileSync(path)
  let off = 12, sr = 44100, ch = 1
  while (off < b.length) {
    const id = b.toString('ascii', off, off + 4)
    const size = b.readUInt32LE(off + 4)
    if (id === 'fmt ') { ch = b.readUInt16LE(off + 10); sr = b.readUInt32LE(off + 12) }
    if (id === 'data') {
      const n = size / 2 / ch
      const x = new Float32Array(n)
      for (let i = 0; i < n; i++) x[i] = b.readInt16LE(off + 8 + i * ch * 2) / 32768
      return { x, sr }
    }
    off += 8 + size + (size % 2)
  }
  throw new Error('no data')
}

/** dB magnitude spectrum the way a Web Audio AnalyserNode reports it (Blackman window) */
function dbSpectrum(frame: Float32Array): Float32Array {
  const n = frame.length
  const re = new Float64Array(n), im = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / n) + 0.08 * Math.cos((4 * Math.PI * i) / n)
    re[i] = frame[i] * w
  }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k)
        const ur = re[i + k], ui = im[i + k]
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr
        re[i + k] = ur + vr; im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi
      }
    }
  }
  const db = new Float32Array(n / 2)
  for (let k = 0; k < n / 2; k++) db[k] = 20 * Math.log10(Math.hypot(re[k], im[k]) / n + 1e-12)
  return db
}

type Frame = { ch: (p: MatchParams) => Float32Array; truth: string; others: string[]; beat: number; style: string }

/** every scored 100 ms frame of one player's comping, spectra computed once */
function frames(player: string, style = ''): { list: Frame[]; beats: number[] } {
  const jams = find(join(GS, 'annotation'), new RegExp(`^${player}_.*_comp\\.jams$`))
  const wavs = new Map(find(join(GS, 'audio'), new RegExp(`^${player}_.*_comp_mic\\.wav$`)).map((p) => [p.split('/').pop()!.replace('_mic.wav', ''), p]))
  const list: Frame[] = []
  const beatIds: number[] = []
  let beatIdx = 0
  for (const jp of jams) {
    const id = jp.split('/').pop()!.replace('.jams', '')
    const path = wavs.get(id)
    if (!path || (style && !id.slice(3).startsWith(style))) continue
    const j = JSON.parse(readFileSync(jp, 'utf8'))
    const chords = j.annotations.find((a: { namespace: string }) => a.namespace === 'chord').data as { time: number; duration: number; value: string }[]
    const beats = (j.annotations.find((a: { namespace: string }) => a.namespace === 'beat_position').data as { time: number }[]).map((d) => d.time)
    const labels = [...new Set(chords.map((c) => c.value))]
    const { x, sr } = wav(path)
    const N = 8192
    for (let t = 0.1; t + N / sr < x.length / sr; t += 0.1) {
      const c = chords.find((k) => k.time <= t && t < k.time + k.duration)
      if (!c || t - c.time < 0.12) continue // the old chord still rings just after a change
      const a = Math.round(t * sr)
      const frame = x.subarray(a, a + N)
      let e = 0
      for (const v of frame) e += v * v
      if (Math.sqrt(e / N) < 0.005) continue // silence: the screen doesn't score it either
      const db = dbSpectrum(frame)
      const cache = new Map<string, Float32Array>()
      list.push({
        ch: (p) => { const k = `${p.floorDb}|${p.hiHz}`; if (!cache.has(k)) cache.set(k, chroma(db, sr, N, p)); return cache.get(k)! },
        style: id.slice(3).replace(/\d.*/, ''), truth: c.value, others: labels.filter((l) => l !== c.value), beat: beatIdx + beats.filter((bt) => bt <= t).length,
      })
    }
    for (let k = 0; k <= beats.length; k++) beatIds.push(beatIdx + k)
    beatIdx += beats.length + 1
  }
  return { list, beats: beatIds }
}

function score(fs: { list: Frame[]; beats: number[] }, p: MatchParams) {
  let tp = 0, fp = 0, neg = 0
  const right = new BeatScore(), wrong = new BeatScore()
  for (const f of fs.list) {
    const ch = f.ch(p)
    const ok = chordMatch(ch, f.truth, p).ok
    if (ok) tp++
    right.add(f.beat, ok)
    for (const o of f.others) { neg++; if (chordMatch(ch, o, p).ok) fp++ }
    if (f.others.length) wrong.add(f.beat, chordMatch(ch, f.others[f.beat % f.others.length], p).ok)
  }
  const r = right.summary(fs.beats), w = wrong.summary(fs.beats)
  return { tpr: tp / fs.list.length, fpr: fp / Math.max(1, neg), beatRight: r.accuracy, beatWrong: w.accuracy }
}

describe.skipIf(!existsSync(GS))('play-along chords on real guitar (GuitarSet comping)', () => {
  it('says yes to the played chord and no to the others', () => {
    const dev = frames('01')
    const test = frames('05')
    // tune for: a right beat is green, a wrong beat rarely is (beat hit when right - 2 x when wrong)
    let best = MATCH, bestJ = -Infinity
    for (const floorDb of [35, 45, 60]) for (const hiHz of [800, 1500]) for (const minScore of [0.4, 0.5, 0.55])
      for (const margin of [0.04, 0.08, 0.12]) for (const rootWeight of [1, 1.2]) {
        const p = { floorDb, hiHz, minScore, margin, rootWeight }
        const s = score(dev, p)
        const j = s.beatRight - 2 * s.beatWrong
        if (j > bestJ) { bestJ = j; best = p }
      }
    const shipped = score(test, MATCH)
    const tuned = score(test, best)
    const fmt = (s: ReturnType<typeof score>) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.toFixed(3)]))
    const byStyle = Object.fromEntries(['Rock', 'SS', 'Funk', 'BN', 'Jazz'].map((st) => {
      const sub = { list: test.list.filter((f) => f.style === st), beats: test.beats }
      const r = score(sub, best)
      return [st, `${r.beatRight.toFixed(2)} right / ${r.beatWrong.toFixed(2)} wrong`]
    }))
    console.log('PLAYALONG', JSON.stringify({ frames_test: test.list.length, shipped: fmt(shipped), tuned_on_01: best, tuned_test: fmt(tuned), beats_by_style_test: byStyle }))
    expect(shipped.beatRight).toBeGreaterThan(shipped.beatWrong + 0.4)
  }, 900000)
})
