import { ChordDiagram } from "./ChordDiagram";
import { displayOf } from "@/lib/display";
import { chordLongName } from "@/lib/music";
import type { Level, Notation } from "@/lib/music";
import type { Analysis } from "@/mock/types";
import { useApp } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { confidenceKind } from "@/lib/display";

export function NowNext({
  song,
  time,
  transpose,
  capo,
  level,
  notation,
  lefty,
}: {
  song: Analysis;
  time: number;
  transpose: number;
  capo: number;
  level: Level;
  notation: Notation;
  lefty: boolean;
}) {
  const { t, settings } = useApp();
  const now = song.chords.find((c) => time >= c.start && time < c.end) ?? song.chords[0];
  const idx = song.chords.indexOf(now);
  const next = song.chords[idx + 1];
  const dNow = displayOf(now.label, transpose, capo, level, notation);
  const dNext = next ? displayOf(next.label, transpose, capo, level, notation) : null;
  const kind = confidenceKind(now.confidence);
  const beatsLeft = next ? Math.max(1, Math.round((next.start - time) / (60 / song.bpm))) : 0;

  return (
    <div className="grid gap-3 md:grid-cols-[1fr_auto]">
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 sm:p-4">
        <ChordDiagram shape={dNow.shape} lefty={lefty} size={120} className="sm:hidden" />
        <ChordDiagram shape={dNow.shape} lefty={lefty} size={136} className="hidden sm:block" />
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("song.now")}</p>
          <p className="mt-0.5 font-sans text-4xl font-semibold tracking-tight sm:text-5xl">{dNow.name}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {chordLongName(dNow.gripped, settings.lang, notation)}
            {capo > 0 && dNow.name !== dNow.soundingName && (
              <span> · {dNow.soundingName}</span>
            )}
          </p>
          {kind !== "high" && (
            <Badge variant={kind === "low" ? "danger" : "warning"} className="mt-2">
              {t("song.uncertain")}
            </Badge>
          )}
        </div>
      </div>
      {dNext && next && (
        <div className="hidden items-center gap-3 rounded-2xl border border-dashed border-border bg-muted/40 p-4 md:flex md:w-56">
          <ChordDiagram shape={dNext.shape} lefty={lefty} size={88} />
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">{t("song.next")}</p>
            <p className="text-2xl font-semibold">{dNext.name}</p>
            <p className="text-xs text-muted-foreground">{t("song.inBeats", { n: beatsLeft })}</p>
          </div>
        </div>
      )}
    </div>
  );
}
