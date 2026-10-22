import { seeded } from "@/lib/utils";
import { SECTION_COLOR } from "@/lib/display";
import type { Section } from "@/mock/types";

const BARS = 96;
const rnd = seeded(42);
const HEIGHTS = Array.from({ length: BARS }, () => 0.25 + rnd() * 0.75);

export function Waveform({
  duration,
  time,
  sections,
  onSeek,
}: {
  duration: number;
  time: number;
  sections: Section[];
  onSeek: (t: number) => void;
}) {
  const played = time / duration;
  return (
    <div
      role="slider"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={time}
      tabIndex={0}
      className="relative flex h-10 cursor-pointer items-end gap-px overflow-hidden rounded-xl bg-secondary px-1 py-1 sm:h-12"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onSeek(((e.clientX - r.left) / r.width) * duration);
      }}
    >
      {sections.map((s) => (
        <div
          key={`${s.start}-${s.label}`}
          className="pointer-events-none absolute inset-y-0 opacity-20"
          style={{
            left: `${(s.start / duration) * 100}%`,
            width: `${((s.end - s.start) / duration) * 100}%`,
            background: SECTION_COLOR[s.label],
          }}
        />
      ))}
      {HEIGHTS.map((h, i) => (
        <div
          key={i}
          className="relative z-[1] flex-1 rounded-full"
          style={{
            height: `${h * 100}%`,
            background: i / BARS < played ? "var(--primary)" : "color-mix(in oklch, var(--foreground) 28%, transparent)",
          }}
        />
      ))}
    </div>
  );
}
