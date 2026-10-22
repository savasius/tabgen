import type { Section } from '../api'
import type { TKey } from '../i18n'

export const SECTION_COLORS: Record<string, string> = {
  intro: '#6b7fd7', verse: '#3fa37a', chorus: '#e2725b', bridge: '#b46fd8', inst: '#d1a33d',
  solo: '#e04e8a', outro: '#5b8fa8', break: '#8a8a8a',
}

/** "Kıta 2"-style names: numbered when a label repeats. */
export function sectionNames(sections: Section[], t: (k: TKey) => string): string[] {
  const totals: Record<string, number> = {}
  for (const s of sections) totals[s.label] = (totals[s.label] ?? 0) + 1
  const seen: Record<string, number> = {}
  return sections.map((s) => {
    seen[s.label] = (seen[s.label] ?? 0) + 1
    const base = t(`sec_${s.label}` as TKey)
    return totals[s.label] > 1 ? `${base} ${seen[s.label]}` : base
  })
}
