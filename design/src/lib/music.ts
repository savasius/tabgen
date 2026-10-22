/**
 * Minimal music-core for the prototype: chord parsing, transpose, capo, simplify, display names
 * and guitar shapes. Mirrors what `packages/music-core` is expected to provide in the real app.
 */

export const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
export const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"] as const;
const SOLFEGE = ["Do", "Do#", "Re", "Re#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"] as const;
const SOLFEGE_FLAT = ["Do", "Reb", "Re", "Mib", "Mi", "Fa", "Solb", "Sol", "Lab", "La", "Sib", "Si"] as const;

export type Quality =
  | "maj"
  | "min"
  | "7"
  | "maj7"
  | "min7"
  | "sus2"
  | "sus4"
  | "dim"
  | "aug"
  | "add9"
  | "9"
  | "min9";

export type Level = "basic" | "normal" | "full";
export type Notation = "letter" | "solfege";

export interface Chord {
  root: number;
  quality: Quality;
  bass?: number;
}

const QUALITY_SUFFIX: Record<Quality, string> = {
  maj: "",
  min: "m",
  "7": "7",
  maj7: "maj7",
  min7: "m7",
  sus2: "sus2",
  sus4: "sus4",
  dim: "dim",
  aug: "aug",
  add9: "add9",
  "9": "9",
  min9: "m9",
};

const SUFFIX_TO_QUALITY: [string, Quality][] = [
  ["maj7", "maj7"],
  ["m7", "min7"],
  ["m9", "min9"],
  ["sus2", "sus2"],
  ["sus4", "sus4"],
  ["add9", "add9"],
  ["dim", "dim"],
  ["aug", "aug"],
  ["m", "min"],
  ["7", "7"],
  ["9", "9"],
  ["", "maj"],
];

export function noteIndex(name: string): number {
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[name[0].toUpperCase() as "C"];
  let i = base;
  for (const ch of name.slice(1)) {
    if (ch === "#") i++;
    if (ch === "b") i--;
  }
  return (i + 12) % 12;
}

/** Parses "Am7", "F#m", "C/G". */
export function parseChord(s: string): Chord {
  const [main, bass] = s.split("/");
  const m = main.match(/^([A-G][#b]?)(.*)$/);
  if (!m) throw new Error(`Bad chord ${s}`);
  const rest = m[2];
  const q = SUFFIX_TO_QUALITY.find(([suf]) => rest === suf)?.[1] ?? "maj";
  return { root: noteIndex(m[1]), quality: q, bass: bass ? noteIndex(bass) : undefined };
}

export function transpose(c: Chord, semis: number): Chord {
  const t = (n: number) => (((n + semis) % 12) + 12) % 12;
  return { root: t(c.root), quality: c.quality, bass: c.bass === undefined ? undefined : t(c.bass) };
}

export function simplify(c: Chord, level: Level): Chord {
  if (level === "full") return c;
  const minorish = c.quality === "min" || c.quality === "min7" || c.quality === "min9" || c.quality === "dim";
  if (level === "basic") return { root: c.root, quality: minorish ? "min" : "maj" };
  const normal: Partial<Record<Quality, Quality>> = { min9: "min7", "9": "7", add9: "maj", aug: "maj", dim: "min" };
  return { root: c.root, quality: normal[c.quality] ?? c.quality };
}

export function noteName(i: number, notation: Notation = "letter", preferFlat = false) {
  if (notation === "solfege") return (preferFlat ? SOLFEGE_FLAT : SOLFEGE)[i];
  return (preferFlat ? FLAT_NAMES : SHARP_NAMES)[i];
}

/** Keys where flats read more naturally. */
const FLAT_ROOTS = new Set([1, 3, 5, 8, 10]);

export function chordName(c: Chord, notation: Notation = "letter") {
  const flat = FLAT_ROOTS.has(c.root);
  const root = noteName(c.root, notation, flat);
  const bass = c.bass !== undefined ? `/${noteName(c.bass, notation, flat)}` : "";
  return `${root}${QUALITY_SUFFIX[c.quality]}${bass}`;
}

/** Plain-language name for people without theory knowledge. */
export function chordLongName(c: Chord, lang: "tr" | "en", notation: Notation) {
  const root = noteName(c.root, notation, FLAT_ROOTS.has(c.root));
  const tr: Record<Quality, string> = {
    maj: "majör", min: "minör", "7": "yedili", maj7: "majör yedili", min7: "minör yedili",
    sus2: "sus2", sus4: "sus4", dim: "eksik", aug: "artık", add9: "add9", "9": "dokuzlu", min9: "minör dokuzlu",
  };
  const en: Record<Quality, string> = {
    maj: "major", min: "minor", "7": "seven", maj7: "major seven", min7: "minor seven",
    sus2: "sus two", sus4: "sus four", dim: "diminished", aug: "augmented", add9: "add nine", "9": "nine", min9: "minor nine",
  };
  return `${root} ${(lang === "tr" ? tr : en)[c.quality]}`;
}

/* ------------------------------------------------------------------ */
/* Guitar shapes. frets: low E → high e. -1 = muted, 0 = open.         */
/* ------------------------------------------------------------------ */

export interface Shape {
  frets: number[];
  fingers?: number[];
  barre?: { fret: number; from: number; to: number };
  baseFret?: number;
  difficulty: number;
}

const OPEN: Record<string, Shape> = {
  C: { frets: [-1, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0], difficulty: 0.25 },
  D: { frets: [-1, -1, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2], difficulty: 0.2 },
  E: { frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0], difficulty: 0.15 },
  G: { frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, 0, 0, 0, 3], difficulty: 0.25 },
  A: { frets: [-1, 0, 2, 2, 2, 0], fingers: [0, 0, 1, 2, 3, 0], difficulty: 0.2 },
  Am: { frets: [-1, 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0], difficulty: 0.12 },
  Em: { frets: [0, 2, 2, 0, 0, 0], fingers: [0, 2, 3, 0, 0, 0], difficulty: 0.08 },
  Dm: { frets: [-1, -1, 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1], difficulty: 0.2 },
  F: { frets: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1], barre: { fret: 1, from: 0, to: 5 }, difficulty: 0.75 },
  A7: { frets: [-1, 0, 2, 0, 2, 0], fingers: [0, 0, 2, 0, 3, 0], difficulty: 0.15 },
  B7: { frets: [-1, 2, 1, 2, 0, 2], fingers: [0, 2, 1, 3, 0, 4], difficulty: 0.45 },
  C7: { frets: [-1, 3, 2, 3, 1, 0], fingers: [0, 3, 2, 4, 1, 0], difficulty: 0.35 },
  D7: { frets: [-1, -1, 0, 2, 1, 2], fingers: [0, 0, 0, 2, 1, 3], difficulty: 0.22 },
  E7: { frets: [0, 2, 0, 1, 0, 0], fingers: [0, 2, 0, 1, 0, 0], difficulty: 0.12 },
  G7: { frets: [3, 2, 0, 0, 0, 1], fingers: [3, 2, 0, 0, 0, 1], difficulty: 0.3 },
  Am7: { frets: [-1, 0, 2, 0, 1, 0], fingers: [0, 0, 2, 0, 1, 0], difficulty: 0.1 },
  Em7: { frets: [0, 2, 0, 0, 0, 0], fingers: [0, 2, 0, 0, 0, 0], difficulty: 0.06 },
  Dm7: { frets: [-1, -1, 0, 2, 1, 1], fingers: [0, 0, 0, 2, 1, 1], difficulty: 0.25 },
  Cmaj7: { frets: [-1, 3, 2, 0, 0, 0], fingers: [0, 3, 2, 0, 0, 0], difficulty: 0.18 },
  Fmaj7: { frets: [-1, -1, 3, 2, 1, 0], fingers: [0, 0, 3, 2, 1, 0], difficulty: 0.3 },
  Gmaj7: { frets: [3, 2, 0, 0, 0, 2], fingers: [3, 2, 0, 0, 0, 1], difficulty: 0.28 },
  Dsus4: { frets: [-1, -1, 0, 2, 3, 3], fingers: [0, 0, 0, 1, 3, 4], difficulty: 0.25 },
  Dsus2: { frets: [-1, -1, 0, 2, 3, 0], fingers: [0, 0, 0, 1, 3, 0], difficulty: 0.18 },
  Asus2: { frets: [-1, 0, 2, 2, 0, 0], fingers: [0, 0, 1, 2, 0, 0], difficulty: 0.12 },
  Asus4: { frets: [-1, 0, 2, 2, 3, 0], fingers: [0, 0, 1, 2, 3, 0], difficulty: 0.2 },
  Esus4: { frets: [0, 2, 2, 2, 0, 0], fingers: [0, 2, 3, 4, 0, 0], difficulty: 0.18 },
  Cadd9: { frets: [-1, 3, 2, 0, 3, 0], fingers: [0, 2, 1, 0, 3, 0], difficulty: 0.25 },
};

/** Movable barre shapes, intervals relative to root fret. */
type Form = (number | null)[];
const E_FORM: Partial<Record<Quality, Form>> = {
  maj: [0, 2, 2, 1, 0, 0],
  min: [0, 2, 2, 0, 0, 0],
  "7": [0, 2, 0, 1, 0, 0],
  min7: [0, 2, 0, 0, 0, 0],
  maj7: [0, null, 1, 1, 0, null],
  sus4: [0, 2, 2, 2, 0, 0],
};
const A_FORM: Partial<Record<Quality, Form>> = {
  maj: [null, 0, 2, 2, 2, 0],
  min: [null, 0, 2, 2, 1, 0],
  "7": [null, 0, 2, 0, 2, 0],
  min7: [null, 0, 2, 0, 1, 0],
  maj7: [null, 0, 2, 1, 2, 0],
  sus2: [null, 0, 2, 2, 0, 0],
  sus4: [null, 0, 2, 2, 3, 0],
};

function barreShape(c: Chord): Shape {
  const q = E_FORM[c.quality] && A_FORM[c.quality] ? c.quality : simplify(c, "basic").quality;
  const eFret = (c.root - 4 + 12) % 12 || 12;
  const aFret = (c.root - 9 + 12) % 12 || 12;
  const useE = eFret <= aFret;
  const form = (useE ? E_FORM[q] : A_FORM[q])!;
  const fret = useE ? eFret : aFret;
  const frets = form.map((v) => (v === null ? -1 : fret + v));
  return {
    frets,
    barre: { fret, from: useE ? 0 : 1, to: 5 },
    baseFret: fret,
    difficulty: Math.min(1, 0.7 + fret * 0.02),
  };
}

export function shapeFor(c: Chord): Shape {
  const key = chordName({ root: c.root, quality: c.quality });
  const sharpKey = `${SHARP_NAMES[c.root]}${QUALITY_SUFFIX[c.quality]}`;
  return OPEN[key] ?? OPEN[sharpKey] ?? barreShape(c);
}

/**
 * The shape the player actually grips: with capo on fret N, they finger the chord N semitones lower.
 */
export function shapeChord(sounding: Chord, capo: number): Chord {
  return transpose(sounding, -capo);
}

export function songDifficulty(chords: Chord[], capo: number) {
  if (!chords.length) return 0;
  return chords.reduce((s, c) => s + shapeFor(shapeChord(c, capo)).difficulty, 0) / chords.length;
}

export function suggestCapo(chords: Chord[]) {
  return Array.from({ length: 8 }, (_, capo) => ({ capo, difficulty: songDifficulty(chords, capo) })).sort(
    (a, b) => a.difficulty - b.difficulty,
  );
}

export const TUNINGS = {
  standard: { label: "E A D G B E", notes: ["E2", "A2", "D3", "G3", "B3", "E4"], hz: [82.41, 110, 146.83, 196, 246.94, 329.63] },
  dropD: { label: "D A D G B E", notes: ["D2", "A2", "D3", "G3", "B3", "E4"], hz: [73.42, 110, 146.83, 196, 246.94, 329.63] },
  halfDown: { label: "Eb Ab Db Gb Bb Eb", notes: ["Eb2", "Ab2", "Db3", "Gb3", "Bb3", "Eb4"], hz: [77.78, 103.83, 138.59, 185, 233.08, 311.13] },
  openG: { label: "D G D G B D", notes: ["D2", "G2", "D3", "G3", "B3", "D4"], hz: [73.42, 98, 146.83, 196, 246.94, 293.66] },
  dadgad: { label: "D A D G A D", notes: ["D2", "A2", "D3", "G3", "A3", "D4"], hz: [73.42, 110, 146.83, 196, 220, 293.66] },
} as const;
export type TuningId = keyof typeof TUNINGS;
