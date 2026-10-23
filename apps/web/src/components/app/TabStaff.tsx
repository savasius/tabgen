import { useEffect, useRef } from 'react'
import type { StaffNote } from '@/lib/time'
import { beatsPerBar } from '@/lib/time'
import type { Analysis } from '@/api'

const NAMES = ['e', 'B', 'G', 'D', 'A', 'E']

function Staff({
  title,
  bars,
  notes,
  currentBar,
  currentPos,
  selectedId,
  nowIds,
  onSelect,
  zoom,
  steps,
  emptyHint,
  autoScroll,
  analysis,
}: {
  title: string
  bars: number[]
  notes: StaffNote[]
  currentBar: number
  currentPos: number
  selectedId?: string
  nowIds: Set<string>
  onSelect: (n: StaffNote) => void
  zoom: number
  steps: number
  emptyHint?: string
  autoScroll: boolean
  analysis: Analysis
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const barW = 228 * zoom
  const h = 168
  const top = 40
  const gap = 18
  const gutter = 34
  const stringY = (s: number) => top + (s - 1) * gap
  const xAt = (bar: number, pos: number) => {
    const i = bars.indexOf(bar)
    return gutter + 8 + i * barW + 16 + (pos / steps) * (barW - 32)
  }
  const width = Math.max(240, gutter + 16 + bars.length * barW)
  const showPlayhead = bars.includes(currentBar)
  const inStaff = notes.filter((n) => bars.includes(n.bar))

  useEffect(() => {
    if (!autoScroll || !showPlayhead || !scroller.current) return
    const i = bars.indexOf(currentBar)
    const x = gutter + 8 + i * barW + 16 + (currentPos / steps) * (barW - 32)
    const el = scroller.current
    const left = el.scrollLeft
    const right = left + el.clientWidth
    if (x < left + 80 || x > right - 100) {
      el.scrollTo({ left: Math.max(0, x - el.clientWidth * 0.35), behavior: 'smooth' })
    }
  }, [autoScroll, showPlayhead, currentBar, currentPos, barW, steps, bars])

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card p-3" ref={scroller} data-testid="tab-staff">
      {title ? (
        <p className="mb-1 text-xs font-semibold tracking-wider text-muted-foreground">{title}</p>
      ) : null}
      {emptyHint && inStaff.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{emptyHint}</p>
      ) : (
        <svg viewBox={`0 0 ${width} ${h}`} width={width} height={h} role="img" aria-label={title || 'tab'}>
          <rect x={gutter} y={top - 14} width={width - gutter - 6} height={5 * gap + 28} rx={10} fill="color-mix(in oklch, var(--muted) 55%, var(--card))" />
          {NAMES.map((name, idx) => (
            <g key={name}>
              <text x={8} y={stringY(idx + 1) + 4} fill="var(--muted-foreground)" fontSize="11" fontFamily="var(--font-mono)" fontWeight="600">
                {name}
              </text>
              <line
                x1={gutter}
                x2={width - 8}
                y1={stringY(idx + 1)}
                y2={stringY(idx + 1)}
                stroke="var(--string)"
                strokeWidth={idx === 0 || idx === 5 ? 1.35 : 1}
                opacity={0.55}
              />
            </g>
          ))}
          {bars.map((b, i) => {
            const x0 = gutter + 8 + i * barW
            return (
              <g key={b}>
                <line
                  x1={x0}
                  x2={x0}
                  y1={top - 8}
                  y2={top + 5 * gap + 8}
                  stroke="color-mix(in oklch, var(--foreground) 42%, transparent)"
                  strokeWidth={1.2}
                />
                {Array.from({ length: Math.max(0, Math.floor(steps / 4) - 1) }, (_, i) => {
                  const beat = i + 1
                  const x = x0 + 16 + (beat * 4 / steps) * (barW - 32)
                  return (
                    <line
                      key={beat}
                      x1={x}
                      x2={x}
                      y1={top - 4}
                      y2={top + 5 * gap + 4}
                      stroke="color-mix(in oklch, var(--foreground) 14%, transparent)"
                    />
                  )
                })}
                <text x={x0 + 8} y={18} fill="var(--muted-foreground)" fontSize="11" fontFamily="var(--font-mono)">
                  {b + 1}
                </text>
              </g>
            )
          })}
          {inStaff.map((n) => {
            const x = xAt(n.bar, n.pos)
            const y = stringY(n.string)
            const bar = analysis.bars[n.bar]
            const barDur = Math.max(0.001, (bar?.end ?? n.end) - (bar?.start ?? n.start))
            const durW = Math.max(10, Math.min(barW - 36, ((n.end - n.start) / barDur) * (barW - 32)))
            return (
              <line
                key={`${n.id}-tail`}
                x1={x}
                x2={x + durW}
                y1={y}
                y2={y}
                stroke="color-mix(in oklch, var(--foreground) 28%, transparent)"
                strokeWidth={3}
                strokeLinecap="round"
              />
            )
          })}
          {showPlayhead && (
            <g>
              <polygon
                points={`${xAt(currentBar, currentPos) - 5},10 ${xAt(currentBar, currentPos) + 5},10 ${xAt(currentBar, currentPos)},20`}
                fill="var(--primary)"
              />
              <line
                x1={xAt(currentBar, currentPos)}
                x2={xAt(currentBar, currentPos)}
                y1={top - 10}
                y2={top + 5 * gap + 10}
                stroke="var(--primary)"
                strokeWidth={2}
              />
            </g>
          )}
          {inStaff.map((n) => {
            const x = xAt(n.bar, n.pos)
            const y = stringY(n.string)
            const sel = selectedId === n.id
            const now = nowIds.has(n.id)
            const stroke = sel || now ? 'var(--primary)' : n.low ? 'var(--warning)' : 'transparent'
            const fill = now
              ? 'var(--primary)'
              : n.low
                ? 'color-mix(in oklch, var(--warning) 28%, var(--card))'
                : 'var(--card)'
            const text = now ? 'var(--primary-foreground)' : 'var(--foreground)'
            return (
              <g key={n.id} className="cursor-pointer" onClick={() => onSelect(n)}>
                <rect
                  x={x - 11}
                  y={y - 10}
                  width={22}
                  height={20}
                  rx={5}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={sel || now || n.low ? 1.6 : 0}
                  strokeDasharray={n.low && !now && !sel ? '3 2' : undefined}
                />
                <text
                  x={x}
                  y={y + 4.5}
                  textAnchor="middle"
                  fill={text}
                  fontSize="13"
                  fontWeight="700"
                  fontFamily="var(--font-mono)"
                >
                  {n.fret}
                </text>
                {n.technique && (
                  <text x={x + 12} y={y - 12} fill="var(--muted-foreground)" fontSize="10" fontFamily="var(--font-mono)">
                    {n.technique}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}

export function TabStaff({
  analysis,
  notes,
  currentBar,
  currentPos,
  selectedId,
  nowIds,
  onSelect,
  zoom = 1,
  groups,
  emptyHint,
  autoScroll,
}: {
  analysis: Analysis
  notes: StaffNote[]
  currentBar: number
  currentPos: number
  selectedId?: string
  nowIds: Set<string>
  onSelect: (n: StaffNote) => void
  zoom?: number
  groups: { title: string; bars: number[] }[]
  emptyHint?: string
  autoScroll: boolean
}) {
  const steps = beatsPerBar(analysis) * 4
  const parts = groups.filter((g) => g.bars.length)
  return (
    <div className="flex flex-col gap-3">
      {parts.map((g) => (
        <Staff
          key={g.title + (g.bars[0] ?? 0)}
          title={g.title}
          bars={g.bars}
          notes={notes}
          currentBar={currentBar}
          currentPos={currentPos}
          selectedId={selectedId}
          nowIds={nowIds}
          onSelect={onSelect}
          zoom={zoom}
          steps={steps}
          emptyHint={emptyHint}
          autoScroll={autoScroll}
          analysis={analysis}
        />
      ))}
    </div>
  )
}
