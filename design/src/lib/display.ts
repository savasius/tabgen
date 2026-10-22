import type { SectionLabel } from "@/mock/types";
import { chordName, parseChord, shapeChord, shapeFor, simplify, transpose, type Level, type Notation } from "./music";

export const SECTION_COLOR: Record<SectionLabel, string> = {
  intro: "var(--sec-intro)",
  verse: "var(--sec-verse)",
  prechorus: "var(--sec-prechorus)",
  chorus: "var(--sec-chorus)",
  bridge: "var(--sec-bridge)",
  solo: "var(--sec-solo)",
  inst: "var(--sec-inst)",
  outro: "var(--sec-outro)",
};

export function confidenceKind(c: number): "high" | "mid" | "low" {
  if (c < 0.5) return "low";
  if (c < 0.7) return "mid";
  return "high";
}

/** What the player reads and grips after transpose + capo + simplify. */
export function displayOf(label: string, transposeBy: number, capo: number, level: Level, notation: Notation) {
  const sounding = simplify(transpose(parseChord(label), transposeBy), level);
  const gripped = shapeChord(sounding, capo);
  return {
    sounding,
    gripped,
    name: chordName(gripped, notation),
    soundingName: chordName(sounding, notation),
    shape: shapeFor(gripped),
  };
}

export function uniqueLabels(labels: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of labels) {
    if (!seen.has(l)) {
      seen.add(l);
      out.push(l);
    }
  }
  return out;
}

export const COMMON_CHORDS = [
  "C", "G", "Am", "F", "Em", "Dm", "D", "A", "E", "Bm",
  "C7", "G7", "D7", "E7", "A7", "Am7", "Em7", "Dm7",
  "Cmaj7", "Fmaj7", "Gmaj7", "Dsus4", "Dsus2", "Asus2", "Cadd9",
];
