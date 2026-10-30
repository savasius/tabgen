import { useEffect, useRef, useState } from 'react'
import { useApp, type TKey } from '@/lib/store'
import { micErrorKey, openMic, newAudioContext } from '@/lib/mic'
import { TUNINGS, type TuningId } from '@/lib/tunings'
import { centsBetween, detectPitch, nearestNote, PitchSmoother } from '@/lib/pitch'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { cn } from '@/lib/utils'

type Mode = 'auto' | 'manual' | 'chromatic'

function nearestString(hz: number, targets: readonly number[]) {
  let best = 0
  let bestDiff = Infinity
  targets.forEach((t, i) => {
    const d = Math.abs(Math.log2(hz / t))
    if (d < bestDiff) { bestDiff = d; best = i }
  })
  return best
}

const IN_TUNE = 4      // cents
const HOLD_MS = 350    // in tune for this long before it turns green

export function Tuner() {
  const { t, settings, set } = useApp()
  const tuning = TUNINGS[settings.tuning]
  const [mode, setMode] = useState<Mode>('auto')
  const [string, setString] = useState(0)
  const [reading, setReading] = useState<{ hz: number; cents: number; label: string } | null>(null)
  const [locked, setLocked] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [needsTap, setNeedsTap] = useState(false)
  // the audio loop reads these, so changing a setting never restarts the microphone
  const cfg = useRef({ mode, string, hz: tuning.hz as readonly number[], notes: tuning.notes as readonly string[], a4: settings.a4 })
  cfg.current = { mode, string, hz: tuning.hz, notes: tuning.notes, a4: settings.a4 }
  const start = useRef<() => void>(() => {})

  useEffect(() => {
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    let raf = 0
    let stopped = false
    const smooth = new PitchSmoother(5)
    let inSince = 0
    let quiet = 0
    const run = async () => {
      try {
        stream = await openMic({ echoCancellation: false, noiseSuppression: false, autoGainControl: false })
        if (stopped) { stream.getTracks().forEach((tr) => tr.stop()); return }
        ctx = newAudioContext()
        const c = ctx
        // shown until the context runs: a first tap anywhere starts it (lib/mic.ts)
        setNeedsTap(c.state !== 'running')
        c.addEventListener('statechange', () => setNeedsTap(c.state !== 'running' && c.state !== 'closed'))
        const an = ctx.createAnalyser()
        an.fftSize = 4096
        ctx.createMediaStreamSource(stream).connect(an)
        const data = new Float32Array(an.fftSize)
        const tick = () => {
          an.getFloatTimeDomainData(data)
          const p = detectPitch(data, ctx!.sampleRate)
          const c = cfg.current
          if (p && p.clarity > 0.75) {
            quiet = 0
            const hz = smooth.push(p.hz)
            let cents: number
            let label: string
            if (c.mode === 'chromatic') {
              const n = nearestNote(hz, c.a4)
              cents = n.cents
              label = n.name
            } else {
              const idx = c.mode === 'auto' ? nearestString(hz * (440 / c.a4), c.hz) : c.string
              if (c.mode === 'auto' && idx !== c.string) setString(idx)
              cents = centsBetween(hz, c.hz[idx] * (c.a4 / 440))
              label = c.notes[idx].replace(/\d/, '')
            }
            setReading({ hz, cents, label })
            const now = performance.now()
            if (Math.abs(cents) < IN_TUNE) {
              if (!inSince) inSince = now
              setLocked(now - inSince > HOLD_MS)
            } else {
              inSince = 0
              setLocked(false)
            }
          } else if (++quiet > 30) {
            // ~0.5 s of nothing: the string stopped ringing
            smooth.reset()
            inSince = 0
            setLocked(false)
            setReading(null)
          }
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        start.current = () => { void ctx?.resume().then(() => setNeedsTap(false)) }
      } catch (e) {
        setErr(t(micErrorKey(e) as TKey))
      }
    }
    void run()
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((tr) => tr.stop())
      void ctx?.close()
    }
  }, [t])

  const cents = reading?.cents ?? 0
  const angle = Math.max(-50, Math.min(50, cents * 1.6))
  const label = reading?.label ?? (mode === 'chromatic' ? '–' : tuning.notes[string].replace(/\d/, ''))

  const playTone = () => {
    const ctx = newAudioContext()
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.value = tuning.hz[string] * (settings.a4 / 440)
    g.gain.setValueAtTime(0.2, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.6)
    osc.connect(g).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 1.6)
    osc.onended = () => void ctx.close()
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <h1 className="text-3xl font-semibold">{t('tuner.title')}</h1>
      <p className="mt-1 text-muted-foreground">{t('tuner.subtitle')}</p>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <Segmented<Mode>
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'auto', label: t('tuner.auto') },
            { value: 'manual', label: t('tuner.manual') },
            { value: 'chromatic', label: t('tuner.chromatic') },
          ]}
        />
        <select
          className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
          value={settings.tuning}
          disabled={mode === 'chromatic'}
          onChange={(e) => set('tuning', e.target.value as TuningId)}
        >
          {(Object.keys(TUNINGS) as TuningId[]).map((id) => (
            <option key={id} value={id}>
              {t(`settings.tunings.${id}` as TKey)} · {TUNINGS[id].label}
            </option>
          ))}
        </select>
      </div>

      {err && (
        <p role="alert" className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>
      )}

      {needsTap && (
        <Button className="mt-4 w-full" onClick={() => start.current()}>{t('tuner.startMic')}</Button>
      )}

      <div className="mx-auto mt-8 w-full max-w-sm" data-testid="tuner-gauge">
        <svg viewBox="0 0 200 110" className="w-full">
          <path d="M10 100 A90 90 0 0 1 190 100" className="fill-none stroke-border" strokeWidth="10" />
          <path d="M10 100 A90 90 0 0 1 190 100" className="fill-none stroke-success" strokeWidth="10" strokeDasharray="12 400" strokeDashoffset="-135.4" />
          {[-50, -25, 0, 25, 50].map((c) => {
            const a = (c * 1.6 * Math.PI) / 180
            return (
              <line key={c} x1={100 + 92 * Math.sin(a)} y1={100 - 92 * Math.cos(a)} x2={100 + 100 * Math.sin(a)} y2={100 - 100 * Math.cos(a)}
                className="stroke-muted-foreground" strokeWidth={c === 0 ? 2 : 1} />
            )
          })}
          <line
            x1="100"
            y1="100"
            x2={100 + 80 * Math.sin((angle * Math.PI) / 180)}
            y2={100 - 80 * Math.cos((angle * Math.PI) / 180)}
            className={cn('transition-[x2,y2] duration-100', locked ? 'stroke-success' : reading ? 'stroke-primary' : 'stroke-muted-foreground')}
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="100" cy="100" r="6" className="fill-foreground" />
        </svg>
        <div className="mt-2 text-center">
          <p className={cn('text-5xl font-semibold', locked && 'text-success')} data-testid="tuner-note">{label}</p>
          <p className="font-mono text-sm tabular text-muted-foreground" data-testid="tuner-cents">
            {reading ? `${cents > 0 ? '+' : ''}${cents.toFixed(0)} ¢ · ${reading.hz.toFixed(1)} Hz` : '— ¢'}
          </p>
        </div>
      </div>

      <p className={cn('text-center text-sm font-medium', locked ? 'text-success' : 'text-muted-foreground')} data-testid="tuner-hint">
        {!reading ? t('tuner.hold') : locked ? t('tuner.inTune') : Math.abs(cents) < IN_TUNE ? t('tuner.listening') : cents < 0 ? t('tuner.tighten') : t('tuner.loosen')}
      </p>

      {mode !== 'chromatic' && (
        <div className="mt-6 grid grid-cols-6 gap-2">
          {tuning.notes.map((note, i) => (
            <button
              key={note + i}
              type="button"
              onClick={() => { setMode('manual'); setString(i) }}
              className={cn(
                'rounded-xl border py-3 text-sm font-semibold',
                string === i ? 'border-primary bg-primary/15' : 'border-border',
              )}
            >
              {note.replace(/\d/, '')}
            </button>
          ))}
        </div>
      )}
      {mode !== 'chromatic' && (
        <Button className="mt-6 w-full" variant="outline" onClick={playTone}>{t('tuner.playTone')}</Button>
      )}

    </div>
  )
}
