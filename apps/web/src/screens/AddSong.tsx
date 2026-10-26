import { useNavigate, useSearchParams } from 'react-router-dom'
import { Mic, Upload, FileVideo } from 'lucide-react'
import { useApp, type TKey } from '@/lib/store'
import { micErrorKey, openMic } from '@/lib/mic'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn, coverHue, fmtBytes } from '@/lib/utils'
import { api } from '@/api'
import { trackJob } from '@/lib/local'
import { useEffect, useRef, useState } from 'react'

export function AddSong() {
  const { t } = useApp()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'file'
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">
      <h1 className="text-3xl font-semibold tracking-tight">{t('add.title')}</h1>
      <p className="mt-1 mb-6 text-muted-foreground">{t('add.subtitle')}</p>
      <Tabs
        value={tab}
        onValueChange={(v) => {
          params.set('tab', v)
          setParams(params, { replace: true })
        }}
      >
        <TabsList className="w-full">
          <TabsTrigger value="file"><Upload className="mr-1 size-4" /> {t('add.tabs.file')}</TabsTrigger>
          <TabsTrigger value="youtube"><FileVideo className="mr-1 size-4" /> {t('add.tabs.youtube')}</TabsTrigger>
          <TabsTrigger value="mic"><Mic className="mr-1 size-4" /> {t('add.tabs.mic')}</TabsTrigger>
        </TabsList>
        <TabsContent value="file" className="mt-5"><FilePanel /></TabsContent>
        <TabsContent value="youtube" className="mt-5"><YoutubePanel /></TabsContent>
        <TabsContent value="mic" className="mt-5"><MicPanel /></TabsContent>
      </Tabs>
    </div>
  )
}

function goJob(nav: ReturnType<typeof useNavigate>, jobId: string, title: string, source: string) {
  trackJob({ id: jobId, title, createdAt: Date.now(), coverHue: coverHue(jobId), source })
  nav(`/processing/${jobId}`)
}

function FilePanel() {
  const { t } = useApp()
  const nav = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [rights, setRights] = useState(false)
  const [over, setOver] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const pick = (f: File) => {
    setFile(f)
    setTitle(f.name.replace(/\.[^.]+$/, ''))
    setErr(null)
  }

  const start = async () => {
    if (!file) return
    setBusy(true)
    setErr(null)
    try {
      const job = await api.upload(file)
      goJob(nav, job.id, title || file.name, 'file')
    } catch (e) {
      setErr(t('add.file.error', { m: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('add.file.drop')}</CardTitle>
        <CardDescription>{t('add.file.local')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) pick(f) }}
          className={cn(
            'rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors',
            over ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent/40',
          )}
        >
          <Upload className="mx-auto mb-3 size-8 text-primary" />
          <p className="font-medium">{t('add.file.drop')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('add.file.or')}</p>
          <span className="mt-3 inline-flex h-10 items-center rounded-lg bg-secondary px-4 text-sm">{t('add.file.browse')}</span>
          <p className="mt-3 text-xs text-muted-foreground">{t('add.file.formats')}</p>
        </button>
        <input ref={input} type="file" accept="audio/*,video/mp4,video/webm" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f) }} />
        {file && (
          <div className="rounded-xl bg-muted p-3 text-sm">
            <p className="font-medium">{t('add.file.selected')}</p>
            <p className="text-muted-foreground">{file.name} · {fmtBytes(file.size)}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t('add.meta.title')} />
              <Input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder={t('add.meta.artist')} />
            </div>
          </div>
        )}
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1" checked={rights} onChange={(e) => setRights(e.target.checked)} />
          {t('add.file.rights')}
        </label>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <Button variant="glow" disabled={!file || !rights || busy} onClick={() => void start()}>
          {t('add.file.start')}
        </Button>
      </CardContent>
    </Card>
  )
}

function YoutubePanel() {
  const { t } = useApp()
  const nav = useNavigate()
  const [url, setUrl] = useState('')
  const [mode, setMode] = useState<'playback' | 'local'>('playback')
  const [enabled, setEnabled] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const valid = /youtu\.?be/.test(url)

  useEffect(() => {
    api.config().then((c) => setEnabled(c.url_ingest_enabled)).catch(() => {})
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('add.youtube.label')}</CardTitle>
        <CardDescription>{t('add.youtube.modeTitle')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('add.youtube.placeholder')} />
        {url && !valid && <p className="text-sm text-destructive">{t('add.youtube.invalid')}</p>}
        <button type="button" onClick={() => setMode('playback')} className={cn('rounded-xl border p-4 text-left', mode === 'playback' ? 'border-primary bg-primary/10' : 'border-border')}>
          <p className="font-medium">{t('add.youtube.modePlayback')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('add.youtube.modePlaybackBody')}</p>
        </button>
        <button type="button" onClick={() => setMode('local')} className={cn('rounded-xl border p-4 text-left', mode === 'local' ? 'border-primary bg-primary/10' : 'border-border')}>
          <p className="font-medium">{t('add.youtube.modeLocal')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('add.youtube.modeLocalBody')}</p>
        </button>
        {mode === 'local' && !enabled && <p className="text-sm text-muted-foreground">{t('add.youtube.disabled')}</p>}
        {err && <p className="text-sm text-destructive">{err}</p>}
        <Button
          variant="glow"
          disabled={!valid || (mode === 'local' && !enabled)}
          onClick={() => {
            if (mode === 'playback') { nav('/add?tab=file'); return }
            api.fromUrl(url).then((j) => goJob(nav, j.id, url, 'youtube')).catch((e) => setErr((e as Error).message))
          }}
        >
          {mode === 'local' ? t('add.youtube.analyze') : t('add.youtube.start')}
        </Button>
      </CardContent>
    </Card>
  )
}

function MicPanel() {
  const { t } = useApp()
  const nav = useNavigate()
  const [rec, setRec] = useState<'idle' | 'live' | 'done'>('idle')
  const [sec, setSec] = useState(0)
  const [level, setLevel] = useState(0.05)
  const [err, setErr] = useState<string | null>(null)
  const [blob, setBlob] = useState<Blob | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const timer = useRef<number>(0)
  const streamRef = useRef<MediaStream | null>(null)

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop())
    streamRef.current = null
  }

  const start = async () => {
    setErr(null)
    try {
      const stream = await openMic({ echoCancellation: false, noiseSuppression: false })
      streamRef.current = stream
      const mr = new MediaRecorder(stream)
      chunks.current = []
      mr.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data) }
      mr.onstop = () => {
        setBlob(new Blob(chunks.current, { type: mr.mimeType || 'audio/webm' }))
        setRec('done')
        stopTracks()
      }
      recRef.current = mr
      mr.start()
      setRec('live')
      setSec(0)
      const started = Date.now()
      const ctx = new AudioContext()
      const src = ctx.createMediaStreamSource(stream)
      const an = ctx.createAnalyser()
      an.fftSize = 256
      src.connect(an)
      const data = new Uint8Array(an.frequencyBinCount)
      const tick = () => {
        an.getByteTimeDomainData(data)
        let m = 0
        for (const v of data) m = Math.max(m, Math.abs(v - 128) / 128)
        setLevel(m)
      }
      timer.current = window.setInterval(() => {
        setSec(Math.floor((Date.now() - started) / 1000))
        tick()
      }, 200)
    } catch (e) {
      setErr(t(micErrorKey(e) as TKey))
    }
  }

  const stop = () => {
    window.clearInterval(timer.current)
    recRef.current?.stop()
  }

  const analyze = async () => {
    if (!blob) return
    // Safari / the Mac app record MP4 (AAC), Chrome and Firefox WebM
    const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'
    const file = new File([blob], `mic-${Date.now()}.${ext}`, { type: blob.type })
    try {
      const job = await api.upload(file)
      goJob(nav, job.id, t('add.tabs.mic'), 'mic')
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('add.mic.title')}</CardTitle>
        <CardDescription>{t('add.mic.body')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-5">
        <button
          type="button"
          onClick={rec === 'live' ? stop : () => void start()}
          className={cn(
            'grid size-28 place-items-center rounded-full border-4',
            rec === 'live' ? 'animate-pulse-ring border-destructive bg-destructive text-white' : 'border-primary bg-primary/15 text-primary',
          )}
        >
          <Mic className="size-10" />
        </button>
        <p className="font-mono text-2xl tabular">{Math.floor(sec / 60)}:{String(sec % 60).padStart(2, '0')}</p>
        <div className="w-full">
          <p className="mb-1 text-xs text-muted-foreground">{t('add.mic.level')}</p>
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div className={cn('h-full', level < 0.08 ? 'bg-destructive' : 'bg-success')} style={{ width: `${Math.min(100, level * 140)}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{level < 0.08 ? t('add.mic.tooQuiet') : t('add.mic.good')}</p>
        </div>
        {rec === 'idle' && <Button variant="glow" onClick={() => void start()}>{t('add.mic.start')}</Button>}
        {rec === 'live' && <Button variant="destructive" onClick={stop}>{t('add.mic.stop')}</Button>}
        {rec === 'done' && (
          <div className="flex flex-col items-center gap-2">
            {sec < 30 && <p className="text-xs text-warning">{t('add.mic.minDuration')}</p>}
            <div className="flex gap-2">
              <Button variant="glow" onClick={() => void analyze()}>{t('add.mic.analyze')}</Button>
              <Button variant="outline" onClick={() => { setRec('idle'); setBlob(null); setSec(0) }}>{t('add.mic.again')}</Button>
            </div>
          </div>
        )}
        {err && <p className="text-sm text-destructive">{err}</p>}
      </CardContent>
    </Card>
  )
}
