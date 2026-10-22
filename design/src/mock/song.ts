import { seeded } from "@/lib/utils";
import type { Analysis, Bar, ChordEvent, Section, SectionLabel, TabNote } from "./types";

/**
 * A fictional song ("Sahil Yolu" – Mavi Rüzgar) so the prototype has no copyright issues.
 * Each entry is [section, bars], where bars is a list of per-bar chord strings ("Am" or "Am F" for half-bar changes).
 */
const FORM: [SectionLabel, string[]][] = [
  ["intro", ["Am", "F", "C", "G"]],
  ["verse", ["Am", "F", "C", "G", "Am", "F", "C", "E7"]],
  ["prechorus", ["Dm7", "Em7", "Fmaj7", "G Gsus4"]],
  ["chorus", ["C", "G", "Am", "F", "C", "G", "F", "F G"]],
  ["verse", ["Am", "F", "C", "G", "Am", "F", "C", "E7"]],
  ["prechorus", ["Dm7", "Em7", "Fmaj7", "G Gsus4"]],
  ["chorus", ["C", "G", "Am", "F", "C", "G", "F", "F G"]],
  ["solo", ["Am", "G", "F", "E7", "Am", "G", "F", "E7"]],
  ["bridge", ["Dm", "Am", "Dm", "E7"]],
  ["chorus", ["C", "G", "Am", "F", "C", "G", "F", "F G"]],
  ["outro", ["Am", "F", "C", "G", "Am"]],
];

const BPM = 96;
const BEAT = 60 / BPM;
const OFFSET = 0.42;

/** Chords the "model" was unsure about (bar index → confidence). */
const LOW_CONF: Record<number, number> = { 15: 0.41, 19: 0.58, 35: 0.52, 47: 0.38, 52: 0.61, 57: 0.44 };

function build(): Analysis {
  const bars: Bar[] = [];
  const sections: Section[] = [];
  const chords: ChordEvent[] = [];
  const beats: number[] = [];
  const counts: Partial<Record<SectionLabel, number>> = {};

  let barIdx = 0;
  for (const [label, chordBars] of FORM) {
    counts[label] = (counts[label] ?? 0) + 1;
    const startBar = barIdx;
    for (const cb of chordBars) {
      const parts = cb.split(" ");
      const perBeat = parts.length === 1 ? [parts[0], "", "", ""] : [parts[0], "", parts[1], ""];
      const start = OFFSET + barIdx * 4 * BEAT;
      bars.push({ index: barIdx, start, beats: perBeat, section: label });
      for (let b = 0; b < 4; b++) beats.push(start + b * BEAT);
      parts.forEach((p, i) => {
        const beat = parts.length === 1 ? 0 : i * 2;
        const len = parts.length === 1 ? 4 : 2;
        const prev = chords[chords.length - 1];
        const conf = LOW_CONF[barIdx] ?? 0.86 + ((barIdx * 7 + i) % 10) / 80;
        if (prev && prev.label === p && prev.end === start + beat * BEAT) {
          prev.end += len * BEAT;
          prev.beats += len;
        } else {
          chords.push({ start: start + beat * BEAT, end: start + (beat + len) * BEAT, label: p, confidence: conf, bar: barIdx, beat, beats: len });
        }
      });
      barIdx++;
    }
    sections.push({
      label,
      index: counts[label]!,
      start: OFFSET + startBar * 4 * BEAT,
      end: OFFSET + barIdx * 4 * BEAT,
      startBar,
      endBar: barIdx,
    });
  }

  sections[0].start = 0;
  const duration = OFFSET + barIdx * 4 * BEAT + 3.2;
  sections[sections.length - 1].end = duration;

  return {
    id: "sahil-yolu",
    title: "Sahil Yolu",
    artist: "Mavi Rüzgar",
    duration,
    bpm: BPM,
    timeSignature: [4, 4],
    key: { tonic: "A", mode: "minor", confidence: 0.82 },
    tuning: { a4Hz: 438.2, cents: -7, guess: "standard" },
    beats,
    sections,
    chords,
    bars,
    tab: buildTab(sections),
    stems: ["guitar", "vocals", "bass", "drums", "other"],
  };
}

/** Intro riff + A-minor pentatonic solo, with a few deliberately low-confidence notes. */
function buildTab(sections: Section[]): Analysis["tab"] {
  const rnd = seeded(7);
  const notes: TabNote[] = [];
  const intro = sections.find((s) => s.label === "intro")!;
  const solo = sections.find((s) => s.label === "solo")!;
  let id = 0;
  const push = (n: Omit<TabNote, "id" | "confidence"> & { confidence?: number }) =>
    notes.push({ id: `n${id++}`, confidence: n.confidence ?? 0.8 + rnd() * 0.2, ...n });

  const arp: Record<string, [number, number][]> = {
    Am: [[5, 0], [3, 2], [2, 1], [1, 0], [2, 1], [3, 2], [4, 2], [3, 2]],
    F: [[4, 3], [3, 2], [2, 1], [1, 1], [2, 1], [3, 2], [4, 3], [3, 2]],
    C: [[5, 3], [3, 0], [2, 1], [1, 0], [2, 1], [3, 0], [4, 2], [3, 0]],
    G: [[6, 3], [3, 0], [2, 0], [1, 3], [2, 0], [3, 0], [5, 2], [3, 0]],
  };
  ["Am", "F", "C", "G"].forEach((ch, i) => {
    arp[ch].forEach(([s, f], k) => push({ bar: intro.startBar + i, pos: k * 2, dur: 2, string: s, fret: f }));
  });

  // Solo phrases in A minor pentatonic (box 1, 5th fret).
  const phrases: [number, number, number, number, TabNote["technique"]?][][] = [
    [[0, 4, 3, 5], [4, 2, 3, 7, "h"], [6, 2, 2, 5], [8, 8, 2, 8, "b"]],
    [[0, 2, 1, 5], [2, 2, 2, 8], [4, 2, 2, 5], [6, 2, 3, 7], [8, 4, 3, 5], [12, 4, 4, 7]],
    [[0, 3, 4, 5], [3, 1, 4, 7, "h"], [4, 4, 3, 5], [8, 2, 3, 7], [10, 2, 2, 5], [12, 4, 2, 6]],
    [[0, 8, 3, 6, "v"], [8, 2, 4, 7], [10, 2, 4, 6], [12, 4, 5, 7]],
    [[0, 2, 1, 5], [2, 2, 1, 8, "p"], [4, 2, 2, 5], [6, 2, 2, 8], [8, 8, 1, 8, "b"]],
    [[0, 4, 2, 8], [4, 2, 2, 5], [6, 2, 3, 7], [8, 4, 3, 5], [12, 4, 4, 7]],
    [[0, 2, 3, 5], [2, 2, 3, 7], [4, 2, 2, 5], [6, 2, 2, 6], [8, 4, 2, 8], [12, 4, 1, 5]],
    [[0, 4, 3, 7], [4, 4, 3, 6], [8, 8, 4, 6, "v"]],
  ];
  const lowConf = new Set(["1-3", "3-1", "4-4", "6-3", "6-4"]);
  phrases.forEach((ph, bi) =>
    ph.forEach(([pos, dur, string, fret, technique], ni) =>
      push({
        bar: solo.startBar + bi,
        pos,
        dur,
        string,
        fret,
        technique,
        confidence: lowConf.has(`${bi}-${ni}`) ? 0.3 + rnd() * 0.25 : undefined,
      }),
    ),
  );

  const tabBars = [...Array.from({ length: 4 }, (_, i) => intro.startBar + i), ...Array.from({ length: 8 }, (_, i) => solo.startBar + i)];
  return { notes, bars: tabBars };
}

export const SONG: Analysis = build();
export const SECONDS_PER_BEAT = BEAT;
