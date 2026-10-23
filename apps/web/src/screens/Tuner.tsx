import { useEffect, useRef, useState } from 'react'
import { useApp, type TKey } from '@/lib/store'
import { TUNINGS, type TuningId } from '@/lib/tunings'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { cn } from '@/lib/utils'

const STRING_LABELS = ['E', 'A', 'D', 'G', 'B', 'e']

function detectPitch(buf: Float32Array, sr: number): number | null {
  let rms = 0
  for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i]
  rms = Math.sqrt(rms / buf.length)
  if (rms < 0.01) return null
  const minLag = Math.floor(sr / 1100)
  const maxLag = Math.floor(sr / 70)
  let bestLag = 0
  let bestCorr = 0
  for (let lag = minLag; lag < maxLag; lag++) {
    let corr = 0
    for (let i = 0; i < buf.length - lag; i++) corr += buf[i] * buf[i + lag]
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag }
  }
  if (!bestLag || bestCorr < 0.01) return null
  return sr / bestLag
}

function nearestString(hz: number, targets: readonly number[]) {
  let best = 0
  let bestDiff = Infinity
  targets.forEach((t, i) => {
    const d = Math.abs(Math.log2(hz / t))
    if (d < bestDiff) { bestDiff = d; best = i }
  })
  return best
}

export function Tuner() {
  const { t, settings, set } = useApp()
  const tuning = TUNINGS[settings.tuning]
  const [auto, setAuto] = useState(true)
  const [string, setString] = useState(0)
  const [cents, setCents] = useState(0)
  const [hz, setHz] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const raf = useRef(0)
  const stringRef = useRef(string)
  stringRef.current = string

  useEffect(() => {
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } })
        ctx = new AudioContext()
        const src = ctx.createMediaStreamSource(stream)
        const an = ctx.createAnalyser()
        an.fftSize = 2048
        src.connect(an)
        const data = new Float32Array(an.fftSize)
        const tick = () => {
          an.getFloatTimeDomainData(data)
          const f = detectPitch(data, ctx!.sampleRate)
          if (f) {
            const idx = auto ? nearestString(f * (440 / settings.a4), tuning.hz) : stringRef.current
            if (auto) setString(idx)
            const target = tuning.hz[idx] * (settings.a4 / 440)
            setHz(f)
            setCents(1200 * Math.log2(f / target))
          }
          raf.current = requestAnimationFrame(tick)
        }
        raf.current = requestAnimationFrame(tick)
      } catch {
        setErr(t('tuner.noMic'))
      }
    }
    void start()
    return () => {
      cancelAnimationFrame(raf.current)
      stream?.getTracks().forEach((tr) => tr.stop())
      void ctx?.close()
    }
  }, [auto, settings.a4, settings.tuning, t, tuning.hz])

  const inTune = Math.abs(cents) < 5 && hz != null
  const angle = Math.max(-50, Math.min(50, cents * 1.6))

  const playTone = () => {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.frequency.value = tuning.hz[string] * (settings.a4 / 440)
    g.gain.value = 0.15
    osc.connect(g).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 1.2)
    osc.onended = () => void ctx.close()
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <h1 className="text-3xl font-semibold">{t('tuner.title')}</h1>
      <p className="mt-1 text-muted-foreground">{t('tuner.subtitle')}</p>

      <div className="mt-4 flex items-center justify-between">
        <Segmented
          size="sm"
          value={auto ? 'auto' : 'manual'}
          onChange={(v) => setAuto(v === 'auto')}
          options={[
            { value: 'auto', label: t('tuner.auto') },
            { value: 'manual', label: t('tuner.manual') },
          ]}
        />
        <select
          className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
          value={settings.tuning}
          onChange={(e) => set('tuning', e.target.value as TuningId)}
        >
          {(Object.keys(TUNINGS) as TuningId[]).map((id) => (
            <option key={id} value={id}>
              {t(`settings.tunings.${id}` as TKey)} · {TUNINGS[id].label}
            </option>
          ))}
        </select>
      </div>

      <div className="relative mx-auto mt-8 h-52 w-full max-w-sm">
        <svg viewBox="0 0 200 110" className="w-full">
          <path d="M10 100 A90 90 0 0 1 190 100" className="fill-none stroke-border" strokeWidth="10" />
          <path d="M10 100 A90 90 0 0 1 190 100" className="fill-none stroke-success" strokeWidth="10" strokeDasharray="40 400" strokeDashoffset="-80" />
          <line
            x1="100"
            y1="100"
            x2={100 + 80 * Math.sin((angle * Math.PI) / 180)}
            y2={100 - 80 * Math.cos((angle * Math.PI) / 180)}
            className={inTune ? 'stroke-success' : 'stroke-primary'}
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="100" cy="100" r="6" className="fill-foreground" />
        </svg>
        <div className="absolute inset-x-0 top-24 text-center">
          <p className="text-5xl font-semibold">{STRING_LABELS[string]}</p>
          <p className="font-mono text-sm tabular text-muted-foreground">
            {cents > 0 ? '+' : ''}
            {cents.toFixed(0)} ¢ · {(hz ?? tuning.hz[string]).toFixed(1)} Hz
          </p>
        </div>
      </div>

      <p className={cn('text-center text-sm font-medium', inTune ? 'text-success' : 'text-muted-foreground')}>
        {hz == null ? t('tuner.listening') : inTune ? t('tuner.inTune') : cents < 0 ? t('tuner.tighten') : t('tuner.loosen')}
      </p>

      <div className="mt-6 grid grid-cols-6 gap-2">
        {STRING_LABELS.map((lab, i) => (
          <button
            key={lab + i}
            type="button"
            onClick={() => { setAuto(false); setString(i) }}
            className={cn(
              'rounded-xl border py-3 text-sm font-semibold',
              string === i ? 'border-primary bg-primary/15' : 'border-border',
            )}
          >
            {tuning.notes[i].replace(/\d/, '')}
          </button>
        ))}
      </div>
      <Button className="mt-6 w-full" variant="outline" onClick={playTone}>{t('tuner.playTone')}</Button>
      {err && <p className="mt-4 text-xs text-destructive">{err}</p>}
    </div>
  )
}
