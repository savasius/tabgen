import { useEffect, useRef } from 'react'
import type { TabNote } from '@/api'
import { cn } from '@/lib/utils'

const NAMES_STD = ['e', 'B', 'G', 'D', 'A', 'E']
const MARKERS = new Set([3, 5, 7, 9, 12, 15])

export function Fretboard({
  notes,
  capo = 0,
  lefty = false,
  frets = 15,
}: {
  notes: TabNote[]
  capo?: number
  lefty?: boolean
  frets?: number
}) {
  const names = lefty ? [...NAMES_STD].reverse() : NAMES_STD
  const lit = new Map<string, TabNote>()
  for (const n of notes) {
    const s = lefty ? 7 - n.string : n.string
    lit.set(`${s}:${n.fret}`, n)
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-fretboard p-3" data-testid="fretboard">
      <div className="mb-1 flex pl-6">
        {Array.from({ length: frets + 1 }, (_, f) => (
          <span key={f} className="w-8 shrink-0 text-center font-mono text-[10px] text-muted-foreground">
            {MARKERS.has(f) ? f : ''}
          </span>
        ))}
      </div>
      {names.map((name, row) => {
        const stringNo = row + 1
        return (
          <div className="flex items-center" key={name}>
            <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground">{name}</span>
            {Array.from({ length: frets + 1 }, (_, f) => {
              const n = lit.get(`${stringNo}:${f}`)
              return (
                <span
                  key={f}
                  className={cn(
                    'relative grid h-7 w-8 shrink-0 place-items-center border-b border-string/40 font-mono text-xs',
                    f === 0 && 'border-r-2 border-r-foreground/70',
                    f === capo && capo > 0 && 'bg-primary/20',
                  )}
                >
                  {n && (
                    <span
                      className={cn(
                        'grid size-6 place-items-center rounded-full font-bold',
                        n.low_confidence
                          ? 'border border-dashed border-warning bg-warning/20 text-foreground'
                          : 'bg-primary text-primary-foreground',
                      )}
                    >
                      {n.fret}
                    </span>
                  )}
                </span>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

export function MeasureTable({
  bars,
  byBarBeat,
  curBar,
  curBeat,
  bpb,
  onSeek,
  autoScroll,
  analysisBars,
}: {
  bars: { index: number; start: number; beats: number[] }[]
  byBarBeat: Map<string, { string: number; fret: number; low: boolean }[]>
  curBar: number
  curBeat: number
  bpb: number
  onSeek: (t: number) => void
  autoScroll: boolean
  analysisBars: { index: number; start: number }[]
}) {
  const active = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!autoScroll || !active.current || !box.current) return
    const parent = box.current
    const el = active.current
    const top = el.offsetTop - parent.offsetTop
    const view = parent.clientHeight
    if (top < parent.scrollTop || top + el.offsetHeight > parent.scrollTop + view) {
      parent.scrollTo({ top: Math.max(0, top - 8), behavior: 'smooth' })
    }
  }, [curBar, autoScroll])

  return (
    <div className="relative flex max-h-[28rem] flex-col gap-3 overflow-auto" data-testid="measure-table" ref={box}>
      {bars.map((bar) => (
        <div
          key={bar.index}
          ref={bar.index === curBar ? active : undefined}
          className={cn(
            'flex gap-3 rounded-xl border bg-card p-3',
            bar.index === curBar ? 'border-primary' : 'border-border',
          )}
        >
          <div className="w-8 shrink-0 font-mono text-xs text-muted-foreground tabular">{bar.index + 1}</div>
          <div className="min-w-0 flex-1">
            {NAMES_STD.map((name, row) => (
              <div className="flex items-center gap-1" key={name}>
                <span className="w-4 font-mono text-[10px] text-muted-foreground">{name}</span>
                {Array.from({ length: bpb }, (_, pos) => {
                  const hits = (byBarBeat.get(`${bar.index}:${pos}`) ?? []).filter((n) => n.string === row + 1)
                  const beatIdx = bar.beats[pos]
                  const isNow = beatIdx === curBeat
                  return (
                    <button
                      type="button"
                      key={pos}
                      className={cn(
                        'h-6 min-w-8 flex-1 rounded-md font-mono text-[11px]',
                        isNow ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
                        hits.some((n) => n.low) && !isNow && 'outline outline-dashed outline-warning',
                      )}
                      onClick={() => onSeek(analysisBars[bar.index]?.start ?? bar.start)}
                    >
                      {hits.length ? hits.map((n) => n.fret).join(' ') : '—'}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
