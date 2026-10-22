import { useEffect, useRef, useState } from 'react'
import { SVGuitarChord } from 'svguitar'
import type { Chord } from '../music/chords'
import { loadDb, voicing } from '../music/diagrams'

export function ChordDiagram({ chord, size = 120 }: { chord: Chord; size?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => { loadDb().then(() => setReady(true)) }, [])

  useEffect(() => {
    const el = ref.current
    if (!el || !ready) return
    el.innerHTML = ''
    const pos = voicing(chord)
    if (!pos) return
    const fingers: [number, number | 'x'][] = pos.frets.map((f, i) => [6 - i, f < 0 ? 'x' : f])
    const barres = pos.barres.map((fret) => {
      const idx = pos.frets.map((f, i) => (f === fret ? i : -1)).filter((i) => i >= 0)
      return { fret, fromString: 6 - idx[0], toString: 6 - idx[idx.length - 1] }
    })
    const barreStrings = new Set(
      barres.flatMap((b) => pos.frets.map((f, i) => (f === b.fret ? `${6 - i}:${f}` : ''))),
    )
    new SVGuitarChord(el)
      .configure({
        strings: 6, frets: 4, position: pos.baseFret, noPosition: pos.baseFret <= 1,
        color: '#e8e6e3', backgroundColor: 'none', fretLabelColor: '#e8e6e3', fingerColor: '#f5b942',
        fingerTextColor: '#1b1b1f', strokeWidth: 2, fingerSize: 0.7, fixedDiagramPosition: true,
        fretLabelFontSize: 36,
      })
      .chord({
        fingers: fingers.filter(([s, f]) => !barreStrings.has(`${s}:${f}`) || barres.length === 0),
        barres,
      })
      .draw()
  }, [chord, ready])

  return <div className="diagram" style={{ width: size }} ref={ref} />
}
