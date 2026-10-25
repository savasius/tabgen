import type { Analysis, GuitarPart } from '@/api'

/** The song as seen through one guitar: its tab, its chords, its audio. null = all guitars. */
export function withPart(a: Analysis, partId: string | null): Analysis {
  const p = partId ? a.parts?.find((x) => x.id === partId) : undefined
  if (!p) return { ...a, viewPart: 'all' }
  return {
    ...a,
    viewPart: p.id,
    tab: p.tab,
    chords: p.chords,
    grid: p.grid ?? a.grid,
    audio: a.audio ? { ...a.audio, guitar: p.audio } : { mix: '', original: '', guitar: p.audio },
  }
}

/** i18n key + 1-based number when two parts share a role ("Ritim gitar 2"). */
export function partLabels(parts: GuitarPart[]): { id: string; role: GuitarPart['role']; side: GuitarPart['side']; n: number | null }[] {
  const count = (role: string) => parts.filter((p) => p.role === role).length
  const seen: Record<string, number> = {}
  return parts.map((p) => {
    seen[p.role] = (seen[p.role] ?? 0) + 1
    return { id: p.id, role: p.role, side: p.side, n: count(p.role) > 1 ? seen[p.role] : null }
  })
}
