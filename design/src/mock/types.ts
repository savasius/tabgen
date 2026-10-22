/** Shapes follow the Analysis JSON in docs/design.md §3.4 (camelCased for the UI layer). */

export type SectionLabel = "intro" | "verse" | "prechorus" | "chorus" | "bridge" | "solo" | "inst" | "outro";

export type JobStage = "queued" | "decoding" | "separating" | "beats" | "sections" | "chords" | "key" | "tab" | "finalizing" | "done" | "failed";

export type SourceType = "file" | "youtube" | "mic";

export interface Section {
  label: SectionLabel;
  index: number;
  start: number;
  end: number;
  startBar: number;
  endBar: number;
}

export interface ChordEvent {
  start: number;
  end: number;
  /** Full-vocabulary label, e.g. "Am7". Display level/capo/transpose are applied in the UI. */
  label: string;
  confidence: number;
  bar: number;
  beat: number;
  beats: number;
}

export interface Bar {
  index: number;
  start: number;
  /** One chord label per beat ("" = same as previous beat). */
  beats: string[];
  section: SectionLabel;
}

export interface TabNote {
  id: string;
  bar: number;
  /** Position inside the bar in 16th notes, 0–15. */
  pos: number;
  /** Duration in 16th notes. */
  dur: number;
  string: number; // 1 = high e … 6 = low E
  fret: number;
  confidence: number;
  technique?: "h" | "p" | "b" | "s" | "v";
}

export interface Analysis {
  id: string;
  title: string;
  artist: string;
  duration: number;
  bpm: number;
  timeSignature: [number, number];
  key: { tonic: string; mode: "major" | "minor"; confidence: number };
  tuning: { a4Hz: number; cents: number; guess: "standard" | "dropD" | "halfDown" };
  beats: number[];
  sections: Section[];
  chords: ChordEvent[];
  bars: Bar[];
  tab: { notes: TabNote[]; bars: number[] };
  stems: ("guitar" | "vocals" | "bass" | "drums" | "piano" | "other")[];
}

export interface LibrarySong {
  id: string;
  title: string;
  artist: string;
  source: SourceType;
  duration: number;
  addedAt: string;
  lastPlayedAt?: string;
  status: JobStage;
  progress: number;
  error?: "too_long" | "no_music" | "decode" | "server";
  key?: string;
  bpm?: number;
  chordsPreview?: string[];
  practice?: { score: number; sessions: number };
  favorite?: boolean;
  coverHue: number;
  hasTab?: boolean;
}
