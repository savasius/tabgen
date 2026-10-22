// Harte chord labels ("A:min7/b3") -> display symbols, transpose, simplification, capo.
// Mirrors workers/analysis/tabgen_analysis/chord_label.py.

export type Level = 'basic' | 'normal' | 'full'

export interface Chord {
  root: number | null // pitch class 0..11, null = no chord
  quality: string
  bass: number | null // pitch class of the bass note when it is not the root
}

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const COMMON_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

const NOTE_PC: Record<string, number> = {
  C: 0, 'B#': 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, F: 5, 'E#': 5, 'F#': 6, Gb: 6,
  G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11,
}

const INTERVAL_SEMIS: Record<string, number> = {
  '1': 0, b2: 1, '2': 2, b3: 3, '3': 4, '4': 5, b5: 6, '#4': 6, '5': 7, '#5': 8, b6: 8,
  '6': 9, bb7: 9, b7: 10, '7': 11, '9': 2, b9: 1, '11': 5, '#11': 6, '13': 9,
}

// quality -> [normal, basic]
const SIMPLIFY: Record<string, [string, string]> = {
  maj: ['maj', 'maj'], min: ['min', 'min'],
  '7': ['7', 'maj'], maj7: ['maj7', 'maj'], min7: ['min7', 'min'],
  dim: ['dim', 'min'], aug: ['aug', 'maj'], dim7: ['dim7', 'min'], hdim7: ['hdim7', 'min'],
  sus2: ['sus2', 'maj'], sus4: ['sus4', 'maj'], 'sus4(b7)': ['7sus4', 'maj'], '7sus4': ['7sus4', 'maj'],
  '9': ['7', 'maj'], maj9: ['maj7', 'maj'], min9: ['min7', 'min'], '11': ['7', 'maj'], '13': ['7', 'maj'],
  maj6: ['maj6', 'maj'], min6: ['min6', 'min'], minmaj7: ['min', 'min'], '5': ['5', 'maj'], '1': ['5', 'maj'],
}

const SUFFIX: Record<string, string> = {
  maj: '', min: 'm', '7': '7', maj7: 'maj7', min7: 'm7', dim: 'dim', aug: 'aug', dim7: 'dim7',
  hdim7: 'm7b5', sus2: 'sus2', sus4: 'sus4', 'sus4(b7)': '7sus4', '7sus4': '7sus4', '9': '9', maj9: 'maj9',
  min9: 'm9', '11': '11', '13': '13', maj6: '6', min6: 'm6', minmaj7: 'mMaj7', '5': '5', '1': '5',
}

export const NO_CHORD: Chord = { root: null, quality: '', bass: null }

export function parseHarte(label: string): Chord {
  if (!label || label === 'N' || label === 'X') return NO_CHORD
  const [rootStr, rest = 'maj'] = label.split(':')
  const root = NOTE_PC[rootStr]
  if (root === undefined) return NO_CHORD
  const [quality = 'maj', bassIv] = rest.split('/')
  const semis = bassIv ? INTERVAL_SEMIS[bassIv] : undefined
  const bass = semis === undefined || semis === 0 ? null : (root + semis) % 12
  return { root, quality: quality || 'maj', bass }
}

export function transpose(c: Chord, semis: number): Chord {
  if (c.root === null) return c
  const t = (p: number) => (((p + semis) % 12) + 12) % 12
  return { root: t(c.root), quality: c.quality, bass: c.bass === null ? null : t(c.bass) }
}

export function atLevel(c: Chord, level: Level): Chord {
  if (c.root === null || level === 'full') return c
  const [normal, basic] = SIMPLIFY[c.quality] ?? ['maj', 'maj']
  return { root: c.root, quality: level === 'normal' ? normal : basic, bass: null }
}

export type Spelling = 'common' | 'flats' | 'sharps'

// Keys conventionally written with flats.
const FLAT_MAJOR = new Set([5, 10, 3, 8, 1, 6]) // F Bb Eb Ab Db Gb
const FLAT_MINOR = new Set([2, 7, 0, 5, 10, 3]) // Dm Gm Cm Fm Bbm Ebm

export function spellingForKey(tonic: number | null, mode: string | undefined): Spelling {
  if (tonic === null) return 'common'
  const flats = mode === 'minor' ? FLAT_MINOR : FLAT_MAJOR
  if (flats.has(tonic)) return 'flats'
  // C major / A minor: mixed conventional names. Sharp keys (G D A E B F# …) keep G# not Ab.
  if ((mode === 'minor' && tonic === 9) || (mode !== 'minor' && tonic === 0)) return 'common'
  return 'sharps'
}

export function noteName(pc: number, spelling: Spelling = 'common'): string {
  const table = spelling === 'flats' ? FLAT_NAMES : spelling === 'sharps' ? SHARP_NAMES : COMMON_NAMES
  return table[((pc % 12) + 12) % 12]
}

export function formatChord(c: Chord, spelling: Spelling = 'common'): string {
  if (c.root === null) return 'N.C.'
  const s = noteName(c.root, spelling) + (SUFFIX[c.quality] ?? c.quality)
  return c.bass === null ? s : `${s}/${noteName(c.bass, spelling)}`
}

export function chordKey(c: Chord): string {
  return c.root === null ? 'N' : `${c.root}:${c.quality}/${c.bass ?? ''}`
}

/** Display chord for a Harte label after level, transpose and capo are applied. */
export function displayChord(label: string, opts: { level: Level; transpose: number; capo: number }): Chord {
  return transpose(atLevel(parseHarte(label), opts.level), opts.transpose - opts.capo)
}

// ---- capo / difficulty -------------------------------------------------

// Open-position shapes a beginner learns first.
const EASY = new Set([
  'C', 'A', 'G', 'E', 'D', 'Am', 'Em', 'Dm', 'A7', 'E7', 'D7', 'G7', 'C7', 'B7', 'Am7', 'Em7', 'Dm7',
  'Cmaj7', 'Fmaj7', 'Amaj7', 'Dmaj7', 'Gmaj7', 'Asus2', 'Asus4', 'Dsus2', 'Dsus4', 'Esus4', 'A7sus4',
  'E7sus4', 'D7sus4', 'Cadd9', 'E5', 'A5', 'D5', 'G6', 'A6', 'D6', 'E6', 'Am6', 'Dm6', 'Em6',
])
const MEDIUM = new Set(['F', 'Bm', 'Fmaj7', 'Bm7', 'F#m', 'Bdim', 'Edim', 'Adim', 'Ddim', 'Gm', 'Cm', 'Fm'])

export function shapeDifficulty(c: Chord): number {
  if (c.root === null) return 0
  const name = formatChord({ ...c, bass: null }, 'sharps')
  if (EASY.has(name)) return 1
  if (c.quality === '5') return 1.5
  if (MEDIUM.has(name)) return 2.5
  if (c.quality === 'maj' || c.quality === 'min') return 3.5 // full barre
  return 4.5
}

export interface CapoSuggestion {
  capo: number
  difficulty: number // 1 (easiest) .. ~4.5, duration-weighted
}

export function capoSuggestions(
  chords: { label: string; start: number; end: number }[],
  opts: { level: Level; transpose: number },
  maxCapo = 7,
): CapoSuggestion[] {
  const out: CapoSuggestion[] = []
  for (let capo = 0; capo <= maxCapo; capo++) {
    let total = 0
    let score = 0
    for (const ch of chords) {
      const c = displayChord(ch.label, { ...opts, capo })
      if (c.root === null) continue
      const d = ch.end - ch.start
      total += d
      score += d * shapeDifficulty(c)
    }
    out.push({ capo, difficulty: total ? score / total : 0 })
  }
  return out.sort((a, b) => a.difficulty - b.difficulty || a.capo - b.capo)
}

/** Best capo, preferring no capo unless a capo makes it clearly easier. */
export function bestCapo(suggestions: CapoSuggestion[]): number {
  const none = suggestions.find((s) => s.capo === 0)
  const best = suggestions[0]
  if (!best || !none) return 0
  return none.difficulty - best.difficulty > 0.3 ? best.capo : 0
}
