import { cn } from "@/lib/utils";

export function Cover({ hue, title, className }: { hue: number; title: string; className?: string }) {
  const initial = title.trim().slice(0, 1).toUpperCase();
  return (
    <div
      className={cn("relative flex aspect-square items-end overflow-hidden rounded-xl", className)}
      style={{
        background: `linear-gradient(145deg, oklch(0.45 0.12 ${hue}), oklch(0.28 0.08 ${hue + 30}))`,
      }}
    >
      <svg className="absolute inset-2 opacity-40" viewBox="0 0 40 40" aria-hidden>
        {[8, 16, 24, 32].map((x) => (
          <line key={x} x1={x} y1="6" x2={x} y2="34" stroke="white" strokeWidth="1.2" />
        ))}
        <circle cx="16" cy="14" r="2.4" fill="white" />
        <circle cx="24" cy="22" r="2.4" fill="white" />
      </svg>
      <span className="relative m-2 text-2xl font-semibold text-white/90">{initial}</span>
    </div>
  );
}
