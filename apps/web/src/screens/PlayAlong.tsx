import { Headphones } from 'lucide-react'
import { useSong } from './song-session'
import { useApp } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Transport } from '@/components/app/Transport'
import { sectionNames } from '@/lib/display'
import { cn } from '@/lib/utils'
import { useState } from 'react'
import type { Section } from '@/api'

export function PlayAlong() {
  const { t } = useApp()
  const s = useSong()
  const [section, setSection] = useState<Section | 'all'>('all')
  const [headphones, setHeadphones] = useState(true)
  const [mode, setMode] = useState<'chords' | 'notes'>('chords')
  const names = sectionNames(s.analysis.sections, t)

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-5 pb-28">
      <div className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm">
        <p className="font-semibold">{t('play.soon')}</p>
        <p className="mt-1 text-muted-foreground">{t('play.soonBody')}</p>
      </div>
      <div>
        <h2 className="text-xl font-semibold">{t('play.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('play.subtitle')}</p>
      </div>
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'chords', label: t('play.mode.chords') },
          { value: 'notes', label: t('play.mode.notes') },
        ]}
      />
      <div>
        <p className="mb-2 text-sm font-medium">{t('play.pickSection')}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSection('all')}
            className={cn('rounded-full border px-3 py-1 text-sm', section === 'all' ? 'border-primary bg-primary/15' : 'border-border')}
          >
            {t('play.whole')}
          </button>
          {s.analysis.sections.map((sec, i) => (
            <button
              key={`${sec.label}-${i}`}
              type="button"
              onClick={() => { setSection(sec); s.seek(sec.start) }}
              className={cn(
                'rounded-full border px-3 py-1 text-sm',
                section !== 'all' && section.start === sec.start ? 'border-primary bg-primary/15' : 'border-border',
              )}
            >
              {names[i]}
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <Headphones className="mt-0.5 size-5 text-primary" />
          <div>
            <p className="font-medium">{t('play.headphones')}</p>
            <p className="text-sm text-muted-foreground">{t('play.headphonesBody')}</p>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!headphones} onChange={(e) => setHeadphones(!e.target.checked)} />
              {t('play.noHeadphones')}
            </label>
          </div>
        </div>
      </div>
      <Button
        variant="glow"
        size="lg"
        onClick={() => {
          const start = section === 'all' ? 0 : section.start
          s.seek(start)
          s.setLoop(section === 'all' ? null : { start: section.start, end: section.end, label: section.label })
          if (!s.playing) s.toggle()
        }}
      >
        {t('player.play')}
      </Button>
      <div className="sticky bottom-3 z-20">
        <Transport
          time={s.time}
          duration={s.analysis.duration}
          playing={s.playing}
          speed={s.speed}
          loop={s.loop}
          countIn={s.countIn}
          counting={0}
          onToggle={s.toggle}
          onSeek={s.seek}
          onSpeed={s.setSpeed}
          onLoopClear={() => s.setLoop(null)}
          onCountIn={s.setCountIn}
          onSkip={(dt) => s.seek(s.time + dt)}
          soundSource={s.soundSource}
          onSoundSource={s.setSoundSource}
          tabAvailable={s.tabAvailable}
        />
      </div>
    </div>
  )
}
