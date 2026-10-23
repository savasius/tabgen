import { SECTION_COLOR, sectionTKey } from '@/lib/display'
import { cn } from '@/lib/utils'
import type { Section } from '@/api'
import { useT, type TKey } from '@/lib/store'
import { useRef } from 'react'

export function SectionStrip({
  sections,
  duration,
  time,
  names,
  onJump,
  onLoop,
  loopStart,
}: {
  sections: Section[]
  duration: number
  time: number
  names: string[]
  onJump: (s: Section, i: number) => void
  onLoop?: (s: Section, i: number) => void
  loopStart?: number | null
}) {
  const t = useT()
  const clicks = useRef(new Map<number, number>())
  if (!sections.length || duration <= 0) return null

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative flex h-8 overflow-hidden rounded-lg bg-secondary sm:h-9">
        {sections.map((s, i) => {
          const left = (s.start / duration) * 100
          const width = ((s.end - s.start) / duration) * 100
          const active = time >= s.start && time < s.end
          const looping = loopStart != null && Math.abs(loopStart - s.start) < 0.05
          return (
            <button
              key={`${s.label}-${s.start}-${i}`}
              type="button"
              title={t(sectionTKey(s.label) as TKey)}
              onClick={() => {
                const now = Date.now()
                const prev = clicks.current.get(i) ?? 0
                clicks.current.set(i, now)
                if (now - prev < 320 && onLoop) onLoop(s, i)
                else onJump(s, i)
              }}
              className={cn(
                'absolute top-0 h-full text-[10px] font-semibold uppercase tracking-wide text-white/95 transition-opacity',
                active ? 'opacity-100' : 'opacity-80 hover:opacity-100',
                looping && 'ring-2 ring-foreground ring-inset',
              )}
              style={{ left: `${left}%`, width: `${width}%`, background: SECTION_COLOR[s.label] ?? 'var(--sec-verse)' }}
            >
              <span className="block truncate px-0.5">{names[i] ?? s.label}</span>
            </button>
          )
        })}
        <div
          className="pointer-events-none absolute top-0 z-10 h-full w-0.5 bg-white shadow"
          style={{ left: `${Math.min(100, (time / duration) * 100)}%` }}
        />
      </div>
      <p className="hidden text-[11px] text-muted-foreground sm:block">{t('song.sectionHelp')}</p>
    </div>
  )
}
