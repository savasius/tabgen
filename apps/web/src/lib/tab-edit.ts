import type { Analysis, TabNote, Technique } from '@/api'

/** Hand edits on a tab's notes. Pure functions: the server re-derives pitch and re-writes the tab. */

const NAMES: Record<string, number> = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 }
export const MAX_FRET = 24

export function noteMidi(name: string): number {
  const m = /^([A-G]#?)(-?\d)$/.exec(name)
  if (!m) return 40
  return (Number(m[2]) + 1) * 12 + NAMES[m[1]]
}

/** MIDI of an open string; `string` is the tab's display number (1 = high e). */
export function openMidi(tuning: string[], string: number, capo = 0): number {
  const names = tuning.length ? tuning : ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']
  return noteMidi(names[names.length - string]) + capo
}

function mark(n: TabNote, patch: Partial<TabNote>): TabNote {
  return { ...n, ...patch, edited: true, low_confidence: false }
}

export function setFret(notes: TabNote[], i: number, fret: number, tuning: string[], capo = 0): TabNote[] {
  if (fret < 0 || fret > MAX_FRET) return notes
  return notes.map((n, k) => (k === i ? mark(n, { fret, midi: openMidi(tuning, n.string, capo) + fret }) : n))
}

/** Same pitch on the neighbouring string (dir -1 = towards high e). null when it doesn't fit. */
export function moveString(notes: TabNote[], i: number, dir: -1 | 1, tuning: string[], capo = 0): TabNote[] | null {
  const n = notes[i]
  const string = n.string + dir
  if (string < 1 || string > (tuning.length || 6)) return null
  const fret = n.midi - openMidi(tuning, string, capo)
  if (fret < 0 || fret > MAX_FRET) return null
  if (notes.some((o, k) => k !== i && o.string === string && Math.abs(o.start - n.start) < 0.02)) return null
  return notes.map((o, k) => (k === i ? mark(o, { string, fret }) : o))
}

export function toggleTechnique(notes: TabNote[], i: number, type: Technique['type'], extra: Partial<Technique> = {}): TabNote[] {
  return notes.map((n, k) => {
    if (k !== i) return n
    const has = n.techniques.find((t) => t.type === type)
    const same = has && Object.entries(extra).every(([key, v]) => (has as unknown as Record<string, unknown>)[key] === v)
    const rest = n.techniques.filter((t) => t.type !== type)
    // hammer and pull are one gesture each way; a note carries at most one of them
    const keep = type === 'hammer' || type === 'pull' ? rest.filter((t) => t.type !== 'hammer' && t.type !== 'pull') : rest
    return mark(n, { techniques: same ? keep : [...keep, { type, source: 'heuristic', ...extra } as Technique] })
  })
}

export function deleteNote(notes: TabNote[], i: number): TabNote[] {
  return notes.filter((_, k) => k !== i)
}

/** A new note on the 16th slot `pos` of `bar`, lasting one beat (cut at the bar's end). */
export function addNote(a: Analysis, notes: TabNote[], bar: number, pos: number, string: number,
  fret: number, tuning: string[], capo = 0): { notes: TabNote[]; index: number } | null {
  const b = a.bars[bar]
  if (!b || !b.beats.length) return null
  const beatIdx = b.beats[Math.min(b.beats.length - 1, Math.floor(pos / 4))]
  const g = a.grid[beatIdx]
  if (!g) return null
  const start = g.t + ((pos % 4) / 4) * (g.end - g.t)
  if (notes.some((n) => n.string === string && Math.abs(n.start - start) < 0.02)) return null
  const end = Math.min(b.end, start + (g.end - g.t))
  const note: TabNote = {
    start, end, midi: openMidi(tuning, string, capo) + fret, string, fret, techniques: [], edited: true, source: 'edit',
  }
  const out = [...notes, note].sort((x, y) => x.start - y.start || x.string - y.string)
  return { notes: out, index: out.indexOf(note) }
}

const PCS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const ALIAS: Record<string, string> = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#', Cb: 'B', Fb: 'E' }

/** Move a Harte label ("A:min/C") by semitones; "N" stays "N". */
export function shiftChordLabel(label: string, semis: number): string {
  if (!label || label === 'N' || label === 'X' || !semis) return label
  const move = (note: string) => {
    const i = PCS.indexOf(ALIAS[note] ?? note)
    return i < 0 ? note : PCS[(((i + semis) % 12) + 12) % 12]
  }
  const [root, rest = 'maj'] = label.split(':')
  const [quality, bass] = rest.split('/')
  // a bass given as a scale degree ("/5") moves with the root; a note name moves itself
  const b = bass === undefined ? '' : `/${/^[A-G]/.test(bass) ? move(bass) : bass}`
  return `${move(root)}:${quality}${b}`
}
