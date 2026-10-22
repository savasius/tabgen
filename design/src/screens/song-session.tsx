import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { usePlayer, type Loop } from "@/lib/player";
import { SONG, SECONDS_PER_BEAT } from "@/mock/song";
import { useApp } from "@/lib/store";
import { suggestCapo, parseChord, type Level } from "@/lib/music";
import type { Analysis, LibrarySong } from "@/mock/types";

export interface SongSession {
  meta: LibrarySong;
  song: Analysis;
  time: number;
  playing: boolean;
  speed: number;
  loop: Loop | null;
  countIn: boolean;
  counting: number;
  toggle: () => void;
  seek: (t: number) => void;
  setSpeed: (s: number) => void;
  setLoop: (l: Loop | null) => void;
  setCountIn: (v: boolean) => void;
  pause: () => void;
  capo: number;
  setCapo: (n: number) => void;
  transpose: number;
  setTranspose: (n: number) => void;
  level: Level;
  setLevel: (l: Level) => void;
  stems: Record<string, boolean>;
  toggleStem: (id: string) => void;
  suggestion: { capo: number; difficulty: number };
}

const Ctx = createContext<SongSession | null>(null);

export function SongSessionProvider({ meta, children }: { meta: LibrarySong; children: ReactNode }) {
  const { settings } = useApp();
  const song: Analysis = { ...SONG, id: meta.id, title: meta.title, artist: meta.artist };
  const player = usePlayer(song.duration, SECONDS_PER_BEAT);
  const [capo, setCapo] = useState(0);
  const [transpose, setTranspose] = useState(0);
  const [level, setLevel] = useState<Level>(settings.level);
  const [stems, setStems] = useState<Record<string, boolean>>({ guitar: true, vocals: true, bass: true, drums: true, other: true });
  const suggestion = useMemo(() => {
    const chords = [...new Set(song.chords.map((c) => c.label))].map((l) => parseChord(l));
    return suggestCapo(chords)[0];
  }, [song.chords]);

  const value: SongSession = {
    meta,
    song,
    ...player,
    capo,
    setCapo,
    transpose,
    setTranspose,
    level,
    setLevel,
    stems,
    toggleStem: (id) => setStems((s) => ({ ...s, [id]: !s[id] })),
    suggestion,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSong() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSong");
  return c;
}
