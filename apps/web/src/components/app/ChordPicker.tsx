import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { useApp } from '@/lib/store'
import { cn } from '@/lib/utils'

const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT: Record<string, string> = { 'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb' }
/** Harte quality -> how a guitarist writes it */
export const QUALITIES: { q: string; label: string }[] = [
  { q: 'maj', label: '' }, { q: 'min', label: 'm' }, { q: '7', label: '7' }, { q: 'maj7', label: 'maj7' },
  { q: 'min7', label: 'm7' }, { q: '5', label: '5' }, { q: 'sus2', label: 'sus2' }, { q: 'sus4', label: 'sus4' },
  { q: 'dim', label: 'dim' },
]

export function splitLabel(label: string): { root: string | null; quality: string } {
  if (!label || label === 'N' || label === 'X') return { root: null, quality: 'maj' }
  const [root, rest = 'maj'] = label.split(':')
  return { root, quality: rest.split('/')[0] || 'maj' }
}

export function ChordPicker({
  label,
  flats,
  scope,
  onScope,
  onPick,
  onClose,
}: {
  label: string
  flats: boolean
  scope: 'beat' | 'bar'
  onScope: (s: 'beat' | 'bar') => void
  onPick: (label: string) => void
  onClose: () => void
}) {
  const { t } = useApp()
  const cur = splitLabel(label)
  const name = (r: string) => (flats && FLAT[r]) || r
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-primary/40 bg-card px-3 py-2 shadow-lg" data-testid="chord-picker">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('song.chordEdit.title')}</span>
        <Segmented<'beat' | 'bar'>
          size="sm"
          value={scope}
          onChange={onScope}
          options={[
            { value: 'beat', label: t('song.chordEdit.beat') },
            { value: 'bar', label: t('song.chordEdit.bar') },
          ]}
        />
        <Button size="sm" variant={cur.root ? 'outline' : 'default'} onClick={() => onPick('N')} data-testid="chord-none">
          {t('song.chordEdit.none')}
        </Button>
        <Button size="icon-sm" variant="ghost" className="ml-auto" onClick={onClose} aria-label={t('tab.edit.close')}>
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label={t('song.chordEdit.root')}>
        {ROOTS.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={cur.root === r}
            onClick={() => onPick(`${r}:${cur.quality}`)}
            className={cn(
              'h-8 min-w-9 rounded-lg border px-1.5 font-mono text-sm font-bold',
              cur.root === r ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:text-foreground',
            )}
            data-testid={`chord-root-${r}`}
          >
            {name(r)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label={t('song.chordEdit.quality')}>
        {QUALITIES.map(({ q, label: l }) => (
          <button
            key={q}
            type="button"
            disabled={!cur.root}
            aria-pressed={!!cur.root && cur.quality === q}
            onClick={() => cur.root && onPick(`${cur.root}:${q}`)}
            className={cn(
              'h-8 min-w-10 rounded-lg border px-2 font-mono text-sm font-bold disabled:opacity-40',
              cur.root && cur.quality === q ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background',
            )}
            data-testid={`chord-q-${q}`}
          >
            {cur.root ? name(cur.root) : '–'}{l}
          </button>
        ))}
      </div>
    </div>
  )
}
