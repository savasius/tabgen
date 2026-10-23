import { useEffect, useState } from 'react'
import { ChordDiagram } from './ChordDiagram'
import { chordLongName, positionToShape, shownChord } from '@/lib/display'
import type { Level } from '@/music/chords'
import type { Spelling } from '@/music/chords'
import { loadDb, voicing } from '@/music/diagrams'
import { useApp } from '@/lib/store'
import { Badge } from '@/components/ui/badge'
import type { ChordSeg } from '@/api'

export function NowNext({
  chords,
  bpm,
  time,
  transpose,
  capo,
  level,
  spelling,
  lefty,
}: {
  chords: ChordSeg[]
  bpm: number
  time: number
  transpose: number
  capo: number
  level: Level
  spelling: Spelling
  lefty: boolean
}) {
  const { t, settings } = useApp()
  const [ready, setReady] = useState(false)
  useEffect(() => { loadDb().then(() => setReady(true)) }, [])

  const now = chords.find((c) => time >= c.start && time < c.end) ?? chords[0]
  if (!now) {
    return <p className="text-sm text-muted-foreground">{t('song.noChord')}</p>
  }
  const idx = chords.indexOf(now)
  const next = chords[idx + 1]
  const opts = { level, transpose, capo }
  const dNow = shownChord(now.label, opts, spelling, settings.notation)
  const dNext = next ? shownChord(next.label, opts, spelling, settings.notation) : null
  const shapeNow = ready ? voicing(dNow.chord) : null
  const shapeNext = dNext && ready ? voicing(dNext.chord) : null
  const beatsLeft = next ? Math.max(1, Math.round((next.start - time) / Math.max(0.2, 60 / bpm))) : 0
  const uncertain = (now.beats ?? 1) >= 0 && (now.label === 'N' || now.label === 'X')

  return (
    <div className="grid gap-3 md:grid-cols-[1fr_auto]">
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 sm:p-4">
        <ChordDiagram shape={shapeNow ? positionToShape(shapeNow) : null} lefty={lefty} size={120} className="sm:hidden" />
        <ChordDiagram shape={shapeNow ? positionToShape(shapeNow) : null} lefty={lefty} size={136} className="hidden sm:block" />
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('song.now')}</p>
          <p className="mt-0.5 font-sans text-4xl font-semibold tracking-tight sm:text-5xl">{dNow.name}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {chordLongName(dNow.chord, settings.lang, spelling, settings.notation)}
          </p>
          {uncertain && (
            <Badge variant="warning" className="mt-2">{t('song.uncertain')}</Badge>
          )}
        </div>
      </div>
      {dNext && next && (
        <div className="hidden items-center gap-3 rounded-2xl border border-dashed border-border bg-muted/40 p-4 md:flex md:w-56">
          <ChordDiagram shape={shapeNext ? positionToShape(shapeNext) : null} lefty={lefty} size={88} />
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">{t('song.next')}</p>
            <p className="text-2xl font-semibold">{dNext.name}</p>
            <p className="text-xs text-muted-foreground">{t('song.inBeats', { n: beatsLeft })}</p>
          </div>
        </div>
      )}
    </div>
  )
}
