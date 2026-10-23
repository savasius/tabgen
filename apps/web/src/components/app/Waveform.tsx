import { useEffect, useState } from 'react'
import { SECTION_COLOR } from '@/lib/display'
import type { Section } from '@/api'

export function Waveform({
  url,
  duration,
  time,
  sections,
  onSeek,
}: {
  url?: string
  duration: number
  time: number
  sections: Section[]
  onSeek: (t: number) => void
}) {
  const [peaks, setPeaks] = useState<number[] | null>(null)

  useEffect(() => {
    if (!url) return
    let cancelled = false
    const ac = new AbortController()
    fetch(url, { signal: ac.signal })
      .then((r) => r.arrayBuffer())
      .then(async (buf) => {
        const ctx = new AudioContext()
        try {
          const audio = await ctx.decodeAudioData(buf.slice(0))
          const data = audio.getChannelData(0)
          const n = 96
          const block = Math.max(1, Math.floor(data.length / n))
          const hs = Array.from({ length: n }, (_, i) => {
            let m = 0
            const start = i * block
            for (let j = 0; j < block; j += 32) m = Math.max(m, Math.abs(data[start + j] ?? 0))
            return Math.min(1, 0.18 + m * 2.4)
          })
          if (!cancelled) setPeaks(hs)
        } finally {
          void ctx.close()
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
      ac.abort()
    }
  }, [url])

  const bars = peaks ?? Array.from({ length: 96 }, (_, i) => 0.3 + ((i * 17) % 13) / 30)
  const played = duration > 0 ? time / duration : 0

  return (
    <div
      role="slider"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={time}
      tabIndex={0}
      className="relative flex h-10 cursor-pointer items-end gap-px overflow-hidden rounded-xl bg-secondary px-1 py-1 sm:h-12"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        onSeek(((e.clientX - r.left) / r.width) * duration)
      }}
    >
      {sections.map((s) => (
        <div
          key={`${s.start}-${s.label}`}
          className="pointer-events-none absolute inset-y-0 opacity-20"
          style={{
            left: `${(s.start / duration) * 100}%`,
            width: `${((s.end - s.start) / duration) * 100}%`,
            background: SECTION_COLOR[s.label] ?? 'var(--sec-verse)',
          }}
        />
      ))}
      {bars.map((h, i) => (
        <div
          key={i}
          className="relative z-[1] flex-1 rounded-full"
          style={{
            height: `${h * 100}%`,
            background: i / bars.length < played ? 'var(--primary)' : 'color-mix(in oklch, var(--foreground) 28%, transparent)',
          }}
        />
      ))}
    </div>
  )
}
