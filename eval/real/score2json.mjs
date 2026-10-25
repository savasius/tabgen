// Reference tab (Guitar Pro 3-7, GPX, MusicXML, alphaTex) -> JSON notes in seconds, in playback
// order (repeats unrolled, tempo changes applied). Uses the alphaTab build the web app ships.
//
//   node eval/real/score2json.mjs song.gp5 > ref.json
//
// string_i: 0 = lowest string (TabGen's convention); alphaTab numbers strings 1 = lowest.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(resolve(here, '../../apps/web/package.json'))
const at = require('@coderline/alphatab')

function load(path) {
  const settings = new at.Settings()
  const ext = extname(path).toLowerCase()
  if (ext === '.tex' || ext === '.alphatex' || ext === '.atex') {
    const imp = new at.importer.AlphaTexImporter()
    imp.initFromString(readFileSync(path, 'utf8'), settings)
    return { score: imp.readScore(), settings }
  }
  return { score: at.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(readFileSync(path)), settings), settings }
}

function playbackOrder(score, settings) {
  const gen = new at.midi.MidiFileGenerator(score, settings, new at.midi.AlphaSynthMidiFileHandler(new at.midi.MidiFile()))
  gen.generate()
  const bars = gen.tickLookup.masterBars.map((m) => ({ index: m.masterBar.index, start: m.start, end: m.end }))
  const tempos = []
  for (const m of gen.tickLookup.masterBars) for (const t of m.tempoChanges ?? []) tempos.push({ tick: t.tick, bpm: t.tempo })
  tempos.sort((a, b) => a.tick - b.tick)
  if (!tempos.length || tempos[0].tick > 0) tempos.unshift({ tick: 0, bpm: score.tempo || 120 })
  return { bars, tempos }
}

function secondsOf(tempos) {
  const QUARTER = 960 // alphaTab ticks per quarter note
  const seg = []
  let sec = 0
  for (let i = 0; i < tempos.length; i++) {
    seg.push({ tick: tempos[i].tick, sec, bpm: tempos[i].bpm })
    if (i + 1 < tempos.length) sec += ((tempos[i + 1].tick - tempos[i].tick) / QUARTER) * (60 / tempos[i].bpm)
  }
  return (tick) => {
    let s = seg[0]
    for (const x of seg) { if (x.tick <= tick) s = x; else break }
    return s.sec + ((tick - s.tick) / QUARTER) * (60 / s.bpm)
  }
}

function techniques(n) {
  const t = []
  if (n.hasBend) t.push('bend')
  if (n.isHammerPullOrigin) t.push('hammer')
  if (n.slideOutType && n.slideOutType !== 0) t.push('slide')
  if (n.vibrato && n.vibrato !== 0) t.push('vibrato')
  if (n.isPalmMute) t.push('palmMute')
  return t
}

const path = process.argv[2]
if (!path) { console.error('usage: node eval/real/score2json.mjs <file>'); process.exit(2) }
const { score, settings } = load(path)
const { bars, tempos } = playbackOrder(score, settings)
const sec = secondsOf(tempos)
const tracks = score.tracks.map((track) => {
  const staff = track.staves[0]
  const tuning = [...(staff.tuning ?? [])].reverse() // low -> high midi
  const notes = []
  const open = new Map() // string -> last note (for ties)
  for (const pb of bars) {
    const bar = staff.bars[pb.index]
    if (!bar) continue
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        if (beat.isRest) continue
        const t0 = sec(pb.start + beat.playbackStart)
        const t1 = sec(pb.start + beat.playbackStart + beat.playbackDuration)
        for (const n of beat.notes) {
          if (n.isDead) continue
          const s = n.string - 1
          if (n.isTieDestination) {
            const prev = open.get(s)
            if (prev) prev.end = t1
            continue
          }
          const row = {
            start: +t0.toFixed(4), end: +t1.toFixed(4), midi: n.realValue, string_i: s, fret: n.fret,
            tech: techniques(n), chord: beat.chord?.name ?? null,
          }
          notes.push(row)
          open.set(s, row)
        }
      }
    }
  }
  notes.sort((a, b) => a.start - b.start || a.midi - b.midi)
  return {
    index: track.index, name: track.name, tuning, capo: staff.capo ?? 0,
    percussion: !!staff.isPercussion, strings: tuning.length, notes,
  }
})
process.stdout.write(JSON.stringify({
  source: path, title: score.title, artist: score.artist, tempo: score.tempo,
  duration: +sec(bars.length ? bars[bars.length - 1].end : 0).toFixed(3),
  bars: bars.map((b) => +sec(b.start).toFixed(4)), tempos: tempos.map((t) => ({ sec: +sec(t.tick).toFixed(4), bpm: t.bpm })),
  tracks,
}))
