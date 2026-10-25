import { ArrowDown, ArrowUp, Minus, Plus, Trash2, X } from 'lucide-react'
import type { TabNote, Technique } from '@/api'
import { Button } from '@/components/ui/button'
import { useApp } from '@/lib/store'
import { cn } from '@/lib/utils'

const NAMES = ['e', 'B', 'G', 'D', 'A', 'E']

type Toggle = { type: Technique['type']; label: string; extra?: Partial<Technique> }

export function NoteEditor({
  note,
  canHigher,
  canLower,
  onFret,
  onString,
  onToggle,
  onDelete,
  onClose,
}: {
  note: TabNote
  canHigher: boolean
  canLower: boolean
  onFret: (fret: number) => void
  onString: (dir: -1 | 1) => void
  onToggle: (type: Technique['type'], extra?: Partial<Technique>) => void
  onDelete: () => void
  onClose: () => void
}) {
  const { t } = useApp()
  const has = (type: string, extra?: Partial<Technique>) =>
    note.techniques.some((x) => x.type === type
      && Object.entries(extra ?? {}).every(([k, v]) => (x as unknown as Record<string, unknown>)[k] === v))
  const toggles: Toggle[] = [
    { type: 'hammer', label: 'h' },
    { type: 'pull', label: 'p' },
    { type: 'slide', label: 'sl' },
    { type: 'bend', label: t('tab.edit.bendHalf'), extra: { quarter_tones: 2 } },
    { type: 'bend', label: t('tab.edit.bendFull'), extra: { quarter_tones: 4 } },
    { type: 'vibrato', label: 'v' },
    { type: 'palmMute', label: 'pm' },
  ]
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-primary/40 bg-card px-3 py-2 shadow-lg"
      data-testid="note-editor"
      role="group"
      aria-label={t('tab.edit.title')}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('tab.string')}</span>
        <span className="w-6 text-center font-mono text-lg font-bold">{NAMES[note.string - 1] ?? note.string}</span>
        <div className="flex gap-1">
          <Button size="icon-sm" variant="outline" disabled={!canHigher}
            title={canHigher ? t('tab.edit.higher') : t('tab.edit.noMove')} aria-label={t('tab.edit.higher')}
            onClick={() => onString(-1)} data-testid="edit-string-up">
            <ArrowUp className="size-3.5" />
          </Button>
          <Button size="icon-sm" variant="outline" disabled={!canLower}
            title={canLower ? t('tab.edit.lower') : t('tab.edit.noMove')} aria-label={t('tab.edit.lower')}
            onClick={() => onString(1)} data-testid="edit-string-down">
            <ArrowDown className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('tab.fret')}</span>
        <Button size="icon-sm" variant="outline" disabled={note.fret <= 0} aria-label={t('tab.edit.fretDown')}
          onClick={() => onFret(note.fret - 1)} data-testid="edit-fret-down">
          <Minus className="size-3.5" />
        </Button>
        <input
          type="number"
          min={0}
          max={24}
          value={note.fret}
          onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onFret(Math.round(v)) }}
          className="h-8 w-14 rounded-lg border border-border bg-background text-center font-mono text-lg font-bold"
          aria-label={t('tab.fret')}
          data-testid="edit-fret"
        />
        <Button size="icon-sm" variant="outline" disabled={note.fret >= 24} aria-label={t('tab.edit.fretUp')}
          onClick={() => onFret(note.fret + 1)} data-testid="edit-fret-up">
          <Plus className="size-3.5" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('tab.legendTitle')}>
        {toggles.map((x) => {
          const on = has(x.type, x.extra)
          return (
            <button
              key={x.label}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(x.type, x.extra)}
              className={cn(
                'h-8 min-w-8 rounded-lg border px-1.5 font-mono text-sm font-bold transition-colors',
                on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:text-foreground',
              )}
              data-testid={`edit-tech-${x.label}`}
            >
              {x.label}
            </button>
          )
        })}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Button size="icon-sm" variant="outline" onClick={onDelete} data-testid="edit-delete"
          title={t('tab.edit.delete')} aria-label={t('tab.edit.delete')}>
          <Trash2 className="size-3.5" />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label={t('tab.edit.close')}>
          <X className="size-4" />
        </Button>
      </div>
    </div>
  )
}
