import type { Section } from '../api'
import {
  displayChord, formatChord, noteName, type Chord, type Level, type Spelling,
} from '../music/chords'
import type { Position } from '../music/diagrams'
import type { TKey } from './store'

export type Notation = 'letter' | 'solfege'

export const SECTION_COLOR: Record<string, string> = {
  intro: 'var(--sec-intro)',
  verse: 'var(--sec-verse)',
  prechorus: 'var(--sec-prechorus)',
  chorus: 'var(--sec-chorus)',
  bridge: 'var(--sec-bridge)',
  solo: 'var(--sec-solo)',
  inst: 'var(--sec-inst)',
  outro: 'var(--sec-outro)',
  break: 'var(--sec-outro)',
}

const SOLFEGE: Record<string, string> = {
  C: 'Do', 'C#': 'Do#', Db: 'Reb', D: 'Re', 'D#': 'Re#', Eb: 'Mib',
  E: 'Mi', F: 'Fa', 'F#': 'Fa#', Gb: 'Solb', G: 'Sol', 'G#': 'Sol#',
  Ab: 'Lab', A: 'La', 'A#': 'La#', Bb: 'Sib', B: 'Si',
}

export function confidenceKind(c: number): 'high' | 'mid' | 'low' {
  if (c < 0.5) return 'low'
  if (c < 0.7) return 'mid'
  return 'high'
}

export function toNotation(name: string, notation: Notation): string {
  if (notation === 'letter' || name === 'N.C.') return name
  return name.replace(/^[A-G][#b]?/, (n) => SOLFEGE[n] ?? n)
}

export function shownChord(
  label: string,
  opts: { level: Level; transpose: number; capo: number },
  spelling: Spelling,
  notation: Notation,
): { chord: Chord; name: string } {
  const chord = displayChord(label, opts)
  return { chord, name: toNotation(formatChord(chord, spelling), notation) }
}

export function uniqueLabels(labels: string[]) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const l of labels) {
    if (!seen.has(l)) {
      seen.add(l)
      out.push(l)
    }
  }
  return out
}

export function sectionTKey(label: string, short = false): TKey {
  const base = short ? 'song.sectionsShort' : 'song.sections'
  return `${base}.${label}` as TKey
}

export function sectionNames(
  sections: Section[],
  t: (k: TKey) => string,
  short = false,
): string[] {
  const totals: Record<string, number> = {}
  for (const s of sections) totals[s.label] = (totals[s.label] ?? 0) + 1
  const seen: Record<string, number> = {}
  return sections.map((s) => {
    seen[s.label] = (seen[s.label] ?? 0) + 1
    const key = sectionTKey(s.label, short)
    const translated = t(key)
    const base = translated === key ? s.label : translated
    return totals[s.label] > 1 ? `${base} ${seen[s.label]}` : base
  })
}

export interface Shape {
  frets: number[]
  fingers?: number[]
  barre?: { fret: number; from: number; to: number }
  baseFret?: number
}

/** chords-db frets are relative to baseFret; the diagram wants absolute. */
export function positionToShape(pos: Position): Shape {
  const abs = pos.frets.map((f) => (f <= 0 ? f : f + pos.baseFret - 1))
  const barreFret = pos.barres[0]
  let barre: Shape['barre']
  if (barreFret) {
    const absBarre = barreFret + pos.baseFret - 1
    const idx = pos.frets.map((f, i) => (f === barreFret ? i : -1)).filter((i) => i >= 0)
    if (idx.length >= 2) barre = { fret: absBarre, from: idx[0], to: idx[idx.length - 1] }
  }
  return { frets: abs, fingers: pos.fingers, barre, baseFret: pos.baseFret }
}

const QUALITY_TR: Record<string, string> = {
  maj: 'majör', min: 'minör', '7': 'yedili', maj7: 'majör yedili', min7: 'minör yedili',
  dim: 'eksik', aug: 'artık', sus2: 'sus2', sus4: 'sus4', '5': 'güç akoru',
  maj6: 'altılı', min6: 'minör altılı', hdim7: 'yarım eksik',
}
const QUALITY_EN: Record<string, string> = {
  maj: 'major', min: 'minor', '7': 'seven', maj7: 'major seven', min7: 'minor seven',
  dim: 'diminished', aug: 'augmented', sus2: 'sus two', sus4: 'sus four', '5': 'power chord',
  maj6: 'sixth', min6: 'minor sixth', hdim7: 'half diminished',
}

export function chordLongName(c: Chord, lang: 'tr' | 'en', spelling: Spelling, notation: Notation) {
  if (c.root === null) return lang === 'tr' ? 'akor yok' : 'no chord'
  const root = toNotation(noteName(c.root, spelling), notation)
  const table = lang === 'tr' ? QUALITY_TR : QUALITY_EN
  return `${root} ${table[c.quality] ?? c.quality}`
}
