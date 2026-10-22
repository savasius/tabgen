import { cn } from "@/lib/utils";
import type { Shape } from "@/lib/music";

const STRINGS = 6;
const FRETS = 5;

export function ChordDiagram({
  shape,
  name,
  lefty,
  size = 132,
  className,
}: {
  shape: Shape;
  name?: string;
  lefty?: boolean;
  size?: number;
  className?: string;
}) {
  const padL = 18;
  const padT = 22;
  const padR = 10;
  const padB = 18;
  const w = size;
  const h = size + 10;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const minFret = Math.max(1, Math.min(...shape.frets.filter((f) => f > 0), shape.barre?.fret ?? 99) || 1);
  const base = shape.baseFret && shape.baseFret > 1 ? shape.baseFret : minFret > FRETS ? minFret : 1;
  const xAt = (s: number) => {
    const idx = lefty ? STRINGS - 1 - s : s;
    return padL + (idx * innerW) / (STRINGS - 1);
  };
  const yAt = (fret: number) => padT + ((fret - base + 1) * innerH) / FRETS;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={size} height={size + 8} className={cn("shrink-0", className)} aria-hidden>
      {name && (
        <text x={w / 2} y={12} textAnchor="middle" className="fill-foreground" fontSize="11" fontWeight="600">
          {name}
        </text>
      )}
      {base > 1 && (
        <text x={lefty ? w - 6 : 2} y={yAt(base) - 4} className="fill-muted-foreground" fontSize="9" fontFamily="var(--font-mono)">
          {base}
        </text>
      )}
      {Array.from({ length: FRETS + 1 }, (_, f) => (
        <line
          key={`f${f}`}
          x1={padL}
          x2={w - padR}
          y1={padT + (f * innerH) / FRETS}
          y2={padT + (f * innerH) / FRETS}
          className="stroke-foreground/70"
          strokeWidth={f === 0 && base === 1 ? 4 : 1}
        />
      ))}
      {Array.from({ length: STRINGS }, (_, s) => (
        <line
          key={`s${s}`}
          x1={xAt(s)}
          x2={xAt(s)}
          y1={padT}
          y2={padT + innerH}
          className="stroke-string"
          strokeWidth={1.2}
        />
      ))}
      {shape.barre && (
        <rect
          x={Math.min(xAt(shape.barre.from), xAt(shape.barre.to)) - 7}
          y={yAt(shape.barre.fret) - innerH / FRETS / 2 - 7}
          width={Math.abs(xAt(shape.barre.to) - xAt(shape.barre.from)) + 14}
          height={14}
          rx={7}
          className="fill-foreground"
        />
      )}
      {shape.frets.map((fret, s) => {
        const x = xAt(s);
        if (fret < 0) {
          return (
            <text key={s} x={x} y={padT - 6} textAnchor="middle" className="fill-muted-foreground" fontSize="10">
              ×
            </text>
          );
        }
        if (fret === 0) {
          return (
            <circle key={s} cx={x} cy={padT - 8} r={4} className="stroke-foreground fill-none" strokeWidth={1.2} />
          );
        }
        const finger = shape.fingers?.[s];
        return (
          <g key={s}>
            <circle cx={x} cy={yAt(fret) - innerH / FRETS / 2} r={7.5} className="fill-foreground" />
            {finger && finger > 0 && (
              <text
                x={x}
                y={yAt(fret) - innerH / FRETS / 2 + 3.5}
                textAnchor="middle"
                className="fill-background"
                fontSize="9"
                fontWeight="700"
              >
                {finger}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
