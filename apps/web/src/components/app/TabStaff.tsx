import { useEffect, useMemo, useRef, useState } from 'react'
import type { StaffNote } from '@/lib/time'
import { beatsPerBar } from '@/lib/time'
import type { Analysis } from '@/api'

const NAMES = ['e', 'B', 'G', 'D', 'A', 'E']

function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr]
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function sectionAt(analysis: Analysis, barIndex: number): string {
  const sec = analysis.bars[barIndex]?.section
  if (sec == null) return ''
  return analysis.sections[sec]?.label ?? ''
}

function Staff({
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
  const barW = 300 * zoom
  const h = 214
  const top = 68
  const gap = 24
  const gutter = 36
  const stringY = (s: number) => top + (s - 1) * gap
  const xAt = (bar: number, pos: number) => {
    const i = bars.indexOf(bar)
    return gutter + 8 + i * barW + 18 + (pos / steps) * (barW - 36)
  }
  const width = Math.max(240, gutter + 16 + bars.length * barW)
  const showPlayhead = bars.includes(currentBar)
  const inStaff = notes.filter((n) => bars.includes(n.bar))
  const byId = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes])

  useEffect(() => {
    if (!autoScroll || !showPlayhead || !scroller.current) return
    const i = bars.indexOf(currentBar)
    const x = gutter + 8 + i * barW + 18 + (currentPos / steps) * (barW - 36)
    const el = scroller.current
    const left = el.scrollLeft
    const right = left + el.clientWidth
    if (x < left + 72 || x > right - 88) {
      el.scrollTo({ left: Math.max(0, x - el.clientWidth * 0.35), behavior: 'smooth' })
    }
    const sysTop = el.getBoundingClientRect().top
    if (sysTop < 72 || sysTop > window.innerHeight - 180) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [autoScroll, showPlayhead, currentBar, currentPos, barW, steps, bars])

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card p-3" ref={scroller} data-testid="tab-staff">
      {emptyHint && inStaff.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{emptyHint}</p>
      ) : (
        <svg viewBox={`0 0 ${width} ${h}`} width={width} height={h} role="img" aria-label="tab">
          <rect x={gutter} y={top - 16} width={width - gutter - 6} height={5 * gap + 32} rx={12} fill="color-mix(in oklch, var(--muted) 55%, var(--card))" />
          {NAMES.map((name, idx) => (
            <g key={name}>
              <text x={8} y={stringY(idx + 1) + 4} fill="var(--muted-foreground)" fontSize="12" fontFamily="var(--font-mono)" fontWeight="700">
                {name}
              </text>
              <line
                x1={gutter}
                x2={width - 8}
                y1={stringY(idx + 1)}
                y2={stringY(idx + 1)}
                stroke="var(--string)"
                strokeWidth={idx === 0 || idx === 5 ? 1.5 : 1.1}
                opacity={0.55}
              />
            </g>
          ))}
          {bars.map((b, i) => {
            const x0 = gutter + 8 + i * barW
            const label = sectionAt(analysis, b)
            const prev = i > 0 ? sectionAt(analysis, bars[i - 1]) : ''
            const showSec = label && label !== prev
            return (
              <g key={b}>
                <line
                  x1={x0}
                  x2={x0}
                  y1={top - 10}
                  y2={top + 5 * gap + 10}
                  stroke="color-mix(in oklch, var(--foreground) 46%, transparent)"
                  strokeWidth={1.35}
                />
                {Array.from({ length: Math.max(0, Math.floor(steps / 4) - 1) }, (_, k) => {
                  const beat = k + 1
                  const x = x0 + 18 + (beat * 4 / steps) * (barW - 36)
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
                <text x={x0 + 8} y={20} fill="var(--muted-foreground)" fontSize="11" fontFamily="var(--font-mono)">
                  {b + 1}
                </text>
                {showSec ? (
                  <text x={x0 + 28} y={20} fill="var(--primary)" fontSize="11" fontWeight="700" fontFamily="var(--font-sans)">
                    {label}
                  </text>
                ) : null}
              </g>
            )
          })}
          {inStaff.map((n) => {
            const x = xAt(n.bar, n.pos)
            const y = stringY(n.string)
            const bar = analysis.bars[n.bar]
            const barDur = Math.max(0.001, (bar?.end ?? n.end) - (bar?.start ?? n.start))
            const durW = Math.max(12, Math.min(barW - 40, ((n.end - n.start) / barDur) * (barW - 36)))
            return (
              <line
                key={`${n.id}-tail`}
                x1={x}
                x2={x + durW}
                y1={y}
                y2={y}
                stroke="color-mix(in oklch, var(--foreground) 26%, transparent)"
                strokeWidth={3.5}
                strokeLinecap="round"
              />
            )
          })}
          {inStaff.map((n) => {
            if (!n.destId) return null
            const dest = byId.get(n.destId)
            if (!dest || !bars.includes(dest.bar)) return null
            const x1 = xAt(n.bar, n.pos)
            const y1 = stringY(n.string)
            const x2 = xAt(dest.bar, dest.pos)
            const y2 = stringY(dest.string)
            const mid = (x1 + x2) / 2
            const slide = n.glyphs.includes('sl')
            if (slide) {
              return (
                <line
                  key={`${n.id}-sl`}
                  x1={x1 + 18}
                  y1={y1 + 1}
                  x2={x2 - 18}
                  y2={y2 + 1}
                  stroke="var(--primary)"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              )
            }
            return (
              <path
                key={`${n.id}-h`}
                d={`M ${x1} ${y1 - 28} Q ${mid} ${y1 - 44} ${x2} ${y2 - 28}`}
                fill="none"
                stroke="var(--primary)"
                strokeWidth={1.8}
              />
            )
          })}
          {inStaff.map((n) => n.glyphs.includes('b') ? (
            <g key={`${n.id}-bend`} data-testid="tech-bend">
              <path
                d={`M ${xAt(n.bar, n.pos) + 16} ${stringY(n.string) - 8} Q ${xAt(n.bar, n.pos) + 30} ${stringY(n.string) - 28} ${xAt(n.bar, n.pos) + 40} ${stringY(n.string) - 12}`}
                fill="none"
                stroke="var(--primary)"
                strokeWidth={1.8}
                markerEnd={`url(#tab-arrow-${bars[0] ?? 0})`}
              />
            </g>
          ) : null)}
          {inStaff.map((n) => n.glyphs.includes('v') ? (
            <path
              key={`${n.id}-vwave`}
              d={`M ${xAt(n.bar, n.pos) + 16} ${stringY(n.string) - 40}
                  q 4 -5 8 0 t 8 0 t 8 0 t 8 0`}
              fill="none"
              stroke="var(--primary)"
              strokeWidth={1.6}
            />
          ) : null)}
          <defs>
            <marker id={`tab-arrow-${bars[0] ?? 0}`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 z" fill="var(--primary)" />
            </marker>
          </defs>
          {showPlayhead && (
            <g>
              <polygon
                points={`${xAt(currentBar, currentPos) - 6},12 ${xAt(currentBar, currentPos) + 6},12 ${xAt(currentBar, currentPos)},22`}
                fill="var(--primary)"
              />
              <line
                x1={xAt(currentBar, currentPos)}
                x2={xAt(currentBar, currentPos)}
                y1={top - 12}
                y2={top + 5 * gap + 12}
                stroke="var(--primary)"
                strokeWidth={2.2}
              />
            </g>
          )}
          {inStaff.map((n) => {
            const x = xAt(n.bar, n.pos)
            const y = stringY(n.string)
            const sel = selectedId === n.id
            const now = nowIds.has(n.id)
            const stroke = sel || now ? 'var(--primary)' : n.low ? 'var(--warning)' : 'color-mix(in oklch, var(--foreground) 22%, transparent)'
            const fill = now
              ? 'var(--primary)'
              : n.low
                ? 'color-mix(in oklch, var(--warning) 28%, var(--card))'
                : 'var(--card)'
            const text = now ? 'var(--primary-foreground)' : 'var(--foreground)'
            const chips = n.glyphs.filter((g) => g !== 'pm').map((g) => {
              if (g === 'b' && n.bendQt) {
                const amt = n.bendQt >= 4 ? 'b1' : n.bendQt >= 2 ? 'b½' : 'b¼'
                return n.bendRelease ? `${amt}↓` : amt
              }
              return g
            })
            const pm = n.glyphs.includes('pm')
            const boxW = n.fret >= 10 ? 32 : 28
            return (
              <g key={n.id} className="cursor-pointer" onClick={() => onSelect(n)}>
                <rect
                  x={x - boxW / 2}
                  y={y - 12}
                  width={boxW}
                  height={24}
                  rx={6}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={sel || now || n.low ? 2 : 1.1}
                  strokeDasharray={n.low && !now && !sel ? '3 2' : undefined}
                />
                <text
                  x={x}
                  y={y + 6}
                  textAnchor="middle"
                  fill={text}
                  fontSize="16"
                  fontWeight="800"
                  fontFamily="var(--font-mono)"
                >
                  {n.fret}
                </text>
                {pm && (
                  <text x={x} y={y + 22} textAnchor="middle" fill="var(--muted-foreground)" fontSize="9" fontFamily="var(--font-mono)" fontWeight="700">
                    pm
                  </text>
                )}
                {chips.map((chip, i) => {
                  const w = chip.length > 2 ? 28 : chip.length > 1 ? 24 : 18
                  const cx = x + (i - (chips.length - 1) / 2) * (w + 4)
                  return (
                    <g key={chip} data-testid="tech-glyph" data-glyph={n.glyphs[i]}>
                      <rect x={cx - w / 2} y={y - 34} width={w} height={15} rx={4} fill="var(--primary)" />
                      <text
                        x={cx}
                        y={y - 23}
                        textAnchor="middle"
                        fill="var(--primary-foreground)"
                        fontSize="11"
                        fontWeight="800"
                        fontFamily="var(--font-mono)"
                      >
                        {chip}
                      </text>
                    </g>
                  )
                })}
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
  emptyHint?: string
  autoScroll: boolean
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [perRow, setPerRow] = useState(4)
  const steps = beatsPerBar(analysis) * 4

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const measure = () => {
      const barW = 300 * zoom
      const n = Math.max(1, Math.min(6, Math.floor((el.clientWidth - 48) / barW) || 1))
      setPerRow(n)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [zoom])

  const bars = analysis.bars.map((b) => b.index)
  const systems = useMemo(() => chunk(bars, perRow), [bars, perRow])

  if (!bars.length) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyHint}</p>
  }

  return (
    <div className="flex flex-col gap-3" ref={wrap} data-testid="tab-staff-wrap">
      {systems.map((row) => (
        <Staff
          key={row[0] ?? 0}
          bars={row}
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
