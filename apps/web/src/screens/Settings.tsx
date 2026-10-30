import { useEffect, useState, type ReactNode } from 'react'
import { useApp, type Lang, type Theme, type TKey } from '@/lib/store'
import { Switch } from '@/components/ui/switch'
import { Segmented } from '@/components/ui/segmented'
import { TUNINGS, type TuningId } from '@/lib/tunings'
import type { Level } from '@/music/chords'
import type { Notation } from '@/lib/display'
import { api } from '@/api'
import { CREDITS } from '@/lib/credits'

export function Settings() {
  const { t, settings, set } = useApp()
  const [nSongs, setNSongs] = useState(0)
  useEffect(() => { api.library().then((l) => setNSongs(l.length)).catch(() => {}) }, [])

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-3xl font-semibold">{t('settings.title')}</h1>

      <Section title={t('settings.sections.general')}>
        <Row label={t('settings.language')}>
          <Segmented size="sm" value={settings.lang} onChange={(v) => set('lang', v as Lang)} options={[{ value: 'tr', label: 'Türkçe' }, { value: 'en', label: 'English' }]} />
        </Row>
        <Row label={t('settings.theme')}>
          <Segmented
            size="sm"
            value={settings.theme}
            onChange={(v) => set('theme', v as Theme)}
            options={[
              { value: 'system', label: t('settings.themes.system') },
              { value: 'light', label: t('settings.themes.light') },
              { value: 'dark', label: t('settings.themes.dark') },
            ]}
          />
        </Row>
      </Section>

      <Section title={t('settings.sections.guitar')}>
        <Row label={t('settings.lefty')} hint={t('settings.leftyBody')}>
          <Switch checked={settings.lefty} onCheckedChange={(v) => set('lefty', v)} />
        </Row>
        <Row label={t('settings.tuning')}>
          <select className="h-9 rounded-lg border border-border bg-background px-2 text-sm" value={settings.tuning} onChange={(e) => set('tuning', e.target.value as TuningId)}>
            {(Object.keys(TUNINGS) as TuningId[]).map((id) => (
              <option key={id} value={id}>{t(`settings.tunings.${id}` as TKey)}</option>
            ))}
          </select>
        </Row>
        <Row label={t('settings.instrument')}>
          <select
            className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
            value={settings.instrument}
            onChange={(e) => set('instrument', e.target.value as typeof settings.instrument)}
          >
            {(['acoustic', 'electric', 'classical'] as const).map((id) => (
              <option key={id} value={id}>{t(`settings.instruments.${id}` as TKey)}</option>
            ))}
          </select>
        </Row>
        <Row label={t('settings.level')}>
          <Segmented
            size="sm"
            value={settings.level}
            onChange={(v) => set('level', v as Level)}
            options={[
              { value: 'basic', label: t('song.levels.basic') },
              { value: 'normal', label: t('song.levels.normal') },
              { value: 'full', label: t('song.levels.full') },
            ]}
          />
        </Row>
      </Section>

      <Section title={t('settings.sections.display')}>
        <Row label={t('settings.notation')}>
          <Segmented
            size="sm"
            value={settings.notation}
            onChange={(v) => set('notation', v as Notation)}
            options={[
              { value: 'letter', label: t('settings.notations.letter') },
              { value: 'solfege', label: t('settings.notations.solfege') },
            ]}
          />
        </Row>
        <Row label={t('settings.bigText')}>
          <Switch checked={settings.bigText} onCheckedChange={(v) => set('bigText', v)} />
        </Row>
        <Row label={t('settings.chordColors')}>
          <Switch checked={settings.chordColors} onCheckedChange={(v) => set('chordColors', v)} />
        </Row>
        <Row label={t('settings.reduceMotion')}>
          <Switch checked={settings.reduceMotion} onCheckedChange={(v) => set('reduceMotion', v)} />
        </Row>
      </Section>

      <Section title={t('settings.sections.audio')}>
        <Row label={t('settings.a4')}>
          <input
            type="number"
            className="h-9 w-24 rounded-lg border border-border bg-background px-2 text-sm"
            value={settings.a4}
            onChange={(e) => set('a4', Number(e.target.value))}
          />
        </Row>
      </Section>

      <Section title={t('settings.sections.data')}>
        <p className="text-sm text-muted-foreground">{t('settings.storageBody', { n: nSongs })}</p>
        <p className="text-sm text-muted-foreground">{t('settings.privacy')}</p>
      </Section>

      <Section title={t('settings.sections.about')}>
        <Row label={t('settings.version')}>
          <span className="text-sm text-muted-foreground">0.3.0 · p2.9</span>
        </Row>
        <details className="group" data-testid="licenses">
          <summary className="cursor-pointer text-sm font-medium">{t('settings.licenses')}</summary>
          <ul className="mt-3 space-y-2">
            {CREDITS.map((c) => (
              <li key={c.name} className="text-xs leading-relaxed">
                <a href={c.url} target="_blank" rel="noreferrer" className="font-medium text-foreground underline-offset-4 hover:underline">{c.name}</a>
                <span className="text-muted-foreground"> · {t(`settings.creditRoles.${c.role}` as TKey)} · {c.license}</span>
                {c.notice && <p className="text-muted-foreground">{c.notice}</p>}
              </li>
            ))}
          </ul>
        </details>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <div className="space-y-3 rounded-2xl border border-border bg-card p-4">{children}</div>
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  )
}
