import { memo, useEffect, useRef } from 'react'
import type { Analysis } from '@/api'
import { SECTION_COLOR } from '@/lib/display'
import { cn } from '@/lib/utils'

interface Props {
  analysis: Analysis
  names: string[]
  changes: boolean[]
  sectionNames: string[]
  curBeat: number
  loop: { start: number; end: number } | null
  autoScroll: boolean
  onSeek: (t: number) => void
  /** fixing chords: a tap selects the beat (it still seeks) */
  selectedBeat?: number | null
  onPick?: (beat: number) => void
}

function ChordGridImpl({ analysis, names, changes, sectionNames, curBeat, loop, autoScroll, onSeek, selectedBeat, onPick }: Props) {
  const activeRef = useRef<HTMLDivElement>(null)
  const curBar = curBeat >= 0 ? analysis.grid[curBeat]?.bar ?? -1 : -1

  useEffect(() => {
    if (autoScroll && activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    }
  }, [curBar, autoScroll])

  const blocks: { section: number | null; bars: typeof analysis.bars }[] = []
  for (const bar of analysis.bars) {
    const last = blocks[blocks.length - 1]
    if (last && last.section === bar.section) last.bars.push(bar)
    else blocks.push({ section: bar.section, bars: [bar] })
  }
  const beatsPerBar = Number(analysis.tempo.time_signature.split('/')[0]) || 4

  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, bi) => {
        const sec = block.section === null ? null : analysis.sections[block.section]
        const rows: typeof block.bars[] = []
        for (let i = 0; i < block.bars.length; i += 4) rows.push(block.bars.slice(i, i + 4))
        return (
          <div className="flex flex-col gap-1" key={bi}>
            {sec && (
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span className="size-2 rounded-full" style={{ background: SECTION_COLOR[sec.label] ?? 'var(--sec-verse)' }} />
                {sectionNames[block.section!] ?? sec.label}
              </div>
            )}
            {rows.map((row) => (
              <div key={row[0].index} className="grid grid-cols-2 gap-1 sm:grid-cols-4 sm:gap-1.5">
                {row.map((bar) => {
                  const inLoop = loop && bar.start >= loop.start - 0.01 && bar.end <= loop.end + 0.01
                  const pad = bar.pickup ? beatsPerBar - bar.beats.length : 0
                  return (
                    <div
                      className={cn(
                        'grid overflow-hidden rounded-lg border bg-card',
                        bar.index === curBar ? 'border-primary' : 'border-border',
                        inLoop && 'bg-info/10',
                      )}
                      style={{ gridTemplateColumns: `repeat(${beatsPerBar}, minmax(0, 1fr))` }}
                      key={bar.index}
                      ref={bar.index === curBar ? activeRef : undefined}
                    >
                      {Array.from({ length: pad }, (_, i) => <div key={`p${i}`} className="h-11 sm:h-12" />)}
                      {bar.beats.map((i) => {
                        const active = i === curBeat
                        const past = i < curBeat
                        return (
                          <button
                            type="button"
                            key={i}
                            onClick={() => { onPick?.(i); onSeek(analysis.grid[i]?.t ?? bar.start) }}
                            data-testid={onPick ? `chord-beat-${i}` : undefined}
                            className={cn(
                              'relative flex h-11 items-center justify-center font-semibold tabular sm:h-12',
                              changes[i] ? 'text-sm' : 'text-[11px] text-muted-foreground',
                              active && 'bg-primary text-primary-foreground',
                              !active && past && 'text-muted-foreground',
                              selectedBeat === i && 'ring-2 ring-inset ring-primary',
                            )}
                          >
                            {changes[i] ? names[i] : '·'}
                            {analysis.grid[i]?.edited && (
                              <span className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" data-testid="chord-edited" />
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

export const ChordGrid = memo(ChordGridImpl)
