import { cn } from "@/lib/utils";
import { confidenceKind } from "@/lib/display";
import type { TabNote } from "@/mock/types";

const NAMES = ["e", "B", "G", "D", "A", "E"];

function Staff({
  title,
  bars,
  notes,
  currentBar,
  currentPos,
  selectedId,
  onSelect,
  zoom,
}: {
  title: string;
  bars: number[];
  notes: TabNote[];
  currentBar: number;
  currentPos: number;
  selectedId?: string;
  onSelect: (n: TabNote) => void;
  zoom: number;
}) {
  const barW = 210 * zoom;
  const h = 148;
  const top = 36;
  const gap = 16;
  const stringY = (s: number) => top + (s - 1) * gap;
  const xAt = (bar: number, pos: number) => {
    const i = bars.indexOf(bar);
    return 36 + i * barW + 14 + (pos / 16) * (barW - 28);
  };
  const width = Math.max(200, 48 + bars.length * barW);
  const showPlayhead = bars.includes(currentBar);

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card p-3">
      <p className="mb-1 text-xs font-semibold tracking-wider text-muted-foreground">{title}</p>
      <svg viewBox={`0 0 ${width} ${h}`} width={width} height={h}>
        {NAMES.map((name, idx) => (
          <g key={name}>
            <text x={8} y={stringY(idx + 1) + 4} className="fill-muted-foreground" fontSize="10" fontFamily="var(--font-mono)">
              {name}
            </text>
            <line
              x1={28}
              x2={width - 8}
              y1={stringY(idx + 1)}
              y2={stringY(idx + 1)}
              stroke="var(--border)"
              strokeWidth={1}
            />
          </g>
        ))}
        {bars.map((b, i) => (
          <g key={b}>
            <line
              x1={36 + i * barW}
              x2={36 + i * barW}
              y1={top - 6}
              y2={top + 5 * gap + 6}
              stroke="color-mix(in oklch, var(--foreground) 35%, transparent)"
            />
            <text x={36 + i * barW + 6} y={18} fill="var(--muted-foreground)" fontSize="10">
              {b + 1}
            </text>
          </g>
        ))}
        {showPlayhead && (
          <line
            x1={xAt(currentBar, currentPos)}
            x2={xAt(currentBar, currentPos)}
            y1={top - 8}
            y2={top + 5 * gap + 8}
            stroke="var(--primary)"
            strokeWidth={2}
          />
        )}
        {notes
          .filter((n) => bars.includes(n.bar))
          .map((n) => {
            const kind = confidenceKind(n.confidence);
            const x = xAt(n.bar, n.pos);
            const y = stringY(n.string);
            const sel = selectedId === n.id;
            const stroke =
              sel ? "var(--primary)" : kind === "low" ? "var(--destructive)" : kind === "mid" ? "var(--warning)" : "transparent";
            const fill =
              kind === "low" ? "color-mix(in oklch, var(--destructive) 22%, var(--card))" : kind === "mid" ? "color-mix(in oklch, var(--warning) 25%, var(--card))" : "var(--card)";
            return (
              <g key={n.id} className="cursor-pointer" onClick={() => onSelect(n)}>
                <rect
                  x={x - 10}
                  y={y - 9}
                  width={20}
                  height={18}
                  rx={4}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={sel || kind !== "high" ? 1.4 : 0}
                  strokeDasharray={kind === "high" ? undefined : "3 2"}
                />
                <text x={x} y={y + 4} textAnchor="middle" fill="var(--foreground)" fontSize="11" fontWeight="700" fontFamily="var(--font-mono)">
                  {n.fret}
                </text>
                {n.technique && (
                  <text x={x + 11} y={y - 11} fill="var(--muted-foreground)" fontSize="9">
                    {n.technique}
                  </text>
                )}
              </g>
            );
          })}
      </svg>
    </div>
  );
}

export function TabStaff({
  bars,
  notes,
  currentBar,
  currentPos,
  selectedId,
  onSelect,
  lefty,
  zoom = 1,
  groups,
}: {
  bars: number[];
  notes: TabNote[];
  currentBar: number;
  currentPos: number;
  selectedId?: string;
  onSelect: (n: TabNote) => void;
  lefty?: boolean;
  zoom?: number;
  groups?: { title: string; bars: number[] }[];
}) {
  const parts = groups?.length ? groups : [{ title: "", bars }];
  return (
    <div className={cn("flex flex-col gap-3", lefty && "origin-left")}>
      {parts.map((g) => (
        <Staff
          key={g.title + g.bars[0]}
          title={g.title}
          bars={g.bars}
          notes={notes}
          currentBar={currentBar}
          currentPos={currentPos}
          selectedId={selectedId}
          onSelect={onSelect}
          zoom={zoom}
        />
      ))}
    </div>
  );
}
