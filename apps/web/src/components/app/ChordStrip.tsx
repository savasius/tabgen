import { useEffect, useState } from 'react'
import { ChordDiagram } from './ChordDiagram'
import { positionToShape } from '@/lib/display'
import { loadDb, voicing } from '@/music/diagrams'
import type { Chord } from '@/music/chords'

/** The song's chords as small diagrams, in order of first appearance; the current one is lit. */
export function ChordStrip({ chords, current, lefty }: {
  chords: { key: string; name: string; chord: Chord }[]
  current?: string
  lefty: boolean
}) {
  const [ready, setReady] = useState(false)
  useEffect(() => { loadDb().then(() => setReady(true)) }, [])
  if (!chords.length) return null
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none" data-testid="chord-strip">
      {chords.map((c) => {
        const shape = ready ? voicing(c.chord) : null
        const on = c.key === current
        return (
          <div key={c.key}
            className={`flex shrink-0 flex-col items-center rounded-xl border px-2 pt-1 pb-1.5 transition-colors ${on ? 'border-primary bg-primary/10' : 'border-border bg-card'}`}>
            <ChordDiagram shape={shape ? positionToShape(shape) : null} lefty={lefty} size={64} />
            <span className={`-mt-1 text-sm font-semibold ${on ? 'text-primary' : ''}`}>{c.name}</span>
          </div>
        )
      })}
    </div>
  )
}
