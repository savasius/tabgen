import { SECTION_COLOR } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { Section, SectionLabel } from "@/mock/types";
import { useT, type TKey } from "@/lib/store";

export function SectionStrip({
  sections,
  duration,
  time,
  onJump,
  onLoop,
  loopLabel,
}: {
  sections: Section[];
  duration: number;
  time: number;
  onJump: (s: Section) => void;
  onLoop?: (s: Section) => void;
  loopLabel?: SectionLabel;
}) {
  const t = useT();
  const clicks = new Map<string, number>();

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative flex h-8 overflow-hidden rounded-lg bg-secondary sm:h-9">
        {sections.map((s, i) => {
          const left = (s.start / duration) * 100;
          const width = ((s.end - s.start) / duration) * 100;
          const active = time >= s.start && time < s.end;
          const looping = loopLabel === s.label && s.start <= time && time < s.end;
          return (
            <button
              key={`${s.label}-${s.startBar}-${i}`}
              type="button"
              title={t(`song.sections.${s.label}` as TKey)}
              onClick={() => {
                const k = `${s.start}`;
                const now = Date.now();
                const prev = clicks.get(k) ?? 0;
                clicks.set(k, now);
                if (now - prev < 320 && onLoop) onLoop(s);
                else onJump(s);
              }}
              className={cn(
                "absolute top-0 h-full text-[10px] font-semibold uppercase tracking-wide text-white/95 transition-opacity",
                active ? "opacity-100" : "opacity-80 hover:opacity-100",
                looping && "ring-2 ring-foreground ring-inset",
              )}
              style={{ left: `${left}%`, width: `${width}%`, background: SECTION_COLOR[s.label] }}
            >
              <span className="block truncate px-0.5">{t(`song.sectionsShort.${s.label}` as TKey)}</span>
            </button>
          );
        })}
        <div
          className="pointer-events-none absolute top-0 z-10 h-full w-0.5 bg-white shadow"
          style={{ left: `${(time / duration) * 100}%` }}
        />
      </div>
      <p className="hidden text-[11px] text-muted-foreground sm:block">{t("song.sectionHelp")}</p>
    </div>
  );
}
