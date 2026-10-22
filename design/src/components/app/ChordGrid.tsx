import { displayOf, confidenceKind, SECTION_COLOR } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { Level, Notation } from "@/lib/music";
import type { Analysis, Bar, SectionLabel } from "@/mock/types";

export function ChordGrid({
  song,
  time,
  transpose,
  capo,
  level,
  notation,
  sectionTitle,
  onBeat,
}: {
  song: Analysis;
  time: number;
  transpose: number;
  capo: number;
  level: Level;
  notation: Notation;
  sectionTitle?: (label: SectionLabel) => string;
  onBeat: (bar: Bar, beat: number) => void;
}) {
  const beatDur = 60 / song.bpm;
  const rows: Bar[][] = [];
  for (let i = 0; i < song.bars.length; i += 4) rows.push(song.bars.slice(i, i + 4));

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => {
        const first = row[0];
        const showSection = first && (first.index === 0 || song.bars[first.index - 1]?.section !== first.section);
        return (
          <div key={row[0].index} className="flex flex-col gap-1">
            {showSection && (
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span className="size-2 rounded-full" style={{ background: SECTION_COLOR[first.section] }} />
                {sectionTitle?.(first.section) ?? first.section}
              </div>
            )}
            <div className="grid grid-cols-4 gap-1 sm:gap-1.5">
              {row.map((bar) => (
                <div key={bar.index} className="grid grid-cols-4 overflow-hidden rounded-lg border border-border bg-card">
                  {bar.beats.map((raw, bi) => {
                    const start = bar.start + bi * beatDur;
                    const active = time >= start && time < start + beatDur;
                    const label = raw || bar.beats.find((b, i) => i <= bi && b) || "";
                    const event = song.chords.find((c) => start >= c.start - 0.01 && start < c.end);
                    const conf = event?.confidence ?? 1;
                    const kind = confidenceKind(conf);
                    const shown = label ? displayOf(label, transpose, capo, level, notation).name : "";
                    const isChange = !!raw;
                    return (
                      <button
                        key={bi}
                        type="button"
                        onClick={() => onBeat(bar, bi)}
                        className={cn(
                          "relative flex h-11 items-center justify-center font-semibold tabular sm:h-12",
                          isChange ? "text-sm" : "text-[11px] text-muted-foreground",
                          active && "bg-primary text-primary-foreground",
                          !active && kind === "low" && "bg-destructive/10",
                          !active && kind === "mid" && "bg-warning/15",
                        )}
                      >
                        {shown}
                        {kind !== "high" && !active && (
                          <span
                            className={cn(
                              "absolute inset-x-1 bottom-1 h-0.5 rounded",
                              kind === "low" ? "bg-conf-low" : "bg-conf-mid",
                            )}
                            style={{ backgroundImage: "repeating-linear-gradient(90deg, currentColor 0 3px, transparent 3px 6px)" }}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
