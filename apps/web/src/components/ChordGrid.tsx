import { memo, useEffect, useRef } from 'react'
import type { Analysis } from '../api'
import { SECTION_COLORS } from './sections'

interface Props {
  analysis: Analysis
  names: string[] // display chord name per grid beat
  changes: boolean[] // true where the displayed chord changes
  sectionNames: string[]
  curBeat: number
  loop: { a: number; b: number } | null
  autoScroll: boolean
  onSeek: (t: number) => void
}

function ChordGridImpl({ analysis, names, changes, sectionNames, curBeat, loop, autoScroll, onSeek }: Props) {
  const activeRef = useRef<HTMLDivElement>(null)
  const curBar = curBeat >= 0 ? analysis.grid[curBeat].bar : -1

  useEffect(() => {
    if (autoScroll && activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    }
  }, [curBar, autoScroll])

  // Group bars into blocks per section.
  const blocks: { section: number | null; bars: typeof analysis.bars }[] = []
  for (const bar of analysis.bars) {
    const last = blocks[blocks.length - 1]
    if (last && last.section === bar.section) last.bars.push(bar)
    else blocks.push({ section: bar.section, bars: [bar] })
  }
  const beatsPerBar = Number(analysis.tempo.time_signature.split('/')[0]) || 4

  return (
    <div className="grid">
      {blocks.map((block, bi) => {
        const sec = block.section === null ? null : analysis.sections[block.section]
        return (
          <div className="grid-block" key={bi}>
            {sec && (
              <div className="grid-section" style={{ borderColor: SECTION_COLORS[sec.label] }}>
                <span style={{ color: SECTION_COLORS[sec.label] }}>{sectionNames[block.section!]}</span>
              </div>
            )}
            <div className="bars">
              {block.bars.map((bar) => {
                const inLoop = loop && bar.start >= loop.a - 0.01 && bar.end <= loop.b + 0.01
                const pad = bar.pickup ? beatsPerBar - bar.beats.length : 0
                return (
                  <div
                    className={`bar${bar.index === curBar ? ' bar-active' : ''}${inLoop ? ' bar-loop' : ''}`}
                    key={bar.index}
                    ref={bar.index === curBar ? activeRef : undefined}
                  >
                    {Array.from({ length: pad }, (_, i) => <div className="beat beat-pad" key={`p${i}`} />)}
                    {bar.beats.map((i) => {
                      const cls = i === curBeat ? ' beat-now' : i < curBeat ? ' beat-past' : ''
                      return (
                        <div className={`beat${cls}`} key={i} onClick={() => onSeek(analysis.grid[i].t)}>
                          {changes[i] ? <span className="beat-chord">{names[i]}</span> : <span className="beat-dot">·</span>}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export const ChordGrid = memo(ChordGridImpl)
