import type { Chord } from './chords'

// chords-db (MIT) guitar voicings, loaded lazily (~1 MB JSON).
export interface Position { frets: number[]; fingers: number[]; baseFret: number; barres: number[] }
type Db = { chords: Record<string, { suffix: string; positions: Position[] }[]> }

const DB_KEYS = ['C', 'Csharp', 'D', 'Eb', 'E', 'F', 'Fsharp', 'G', 'Ab', 'A', 'Bb', 'B']
const DB_NOTES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
const DB_SUFFIX: Record<string, string> = {
  maj: 'major', min: 'minor', '7': '7', maj7: 'maj7', min7: 'm7', dim: 'dim', aug: 'aug', dim7: 'dim7',
  hdim7: 'm7b5', sus2: 'sus2', sus4: 'sus4', 'sus4(b7)': '7sus4', '7sus4': '7sus4', '9': '9', maj9: 'maj9',
  min9: 'm9', '11': '11', '13': '13', maj6: '6', min6: 'm6', minmaj7: 'mmaj7',
}

let db: Db | null = null
let loading: Promise<Db> | null = null
export function loadDb(): Promise<Db> {
  if (db) return Promise.resolve(db)
  loading ??= import('@tombatossals/chords-db/lib/guitar.json').then((m) => (db = (m.default ?? m) as Db))
  return loading
}

function powerChord(root: number): Position {
  // Root on the low E string (frets 0-7) or the A string otherwise.
  // Frets are relative to baseFret, like chords-db.
  const onE = (root - 4 + 12) % 12
  if (onE === 0) return { frets: [0, 2, 2, -1, -1, -1], fingers: [0, 1, 1, 0, 0, 0], baseFret: 1, barres: [] }
  if (onE <= 7) return { frets: [1, 3, 3, -1, -1, -1], fingers: [1, 3, 4, 0, 0, 0], baseFret: onE, barres: [] }
  const onA = (root - 9 + 12) % 12
  return { frets: [-1, 1, 3, 3, -1, -1], fingers: [0, 1, 3, 4, 0, 0], baseFret: onA, barres: [] }
}

/** First (easiest) voicing for a chord, or null when the DB has nothing usable. */
export function voicing(c: Chord): Position | null {
  if (!db || c.root === null) return null
  if (c.quality === '5' || c.quality === '1') return powerChord(c.root)
  const list = db.chords[DB_KEYS[c.root]] ?? []
  const base = DB_SUFFIX[c.quality] ?? 'major'
  if (c.bass !== null && (base === 'major' || base === 'minor')) {
    const slash = (base === 'minor' ? 'm/' : '/') + DB_NOTES[c.bass]
    const hit = list.find((e) => e.suffix === slash)
    if (hit) return hit.positions[0]
  }
  const hit = list.find((e) => e.suffix === base) ?? list.find((e) => e.suffix === 'major')
  return hit?.positions[0] ?? null
}
