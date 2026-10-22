import { useEffect, useRef, useState } from 'react'
import { api, type LibraryEntry } from '../api'
import { useI18n } from '../i18n'

export function Home({ onJob, onSong }: { onJob: (id: string) => void; onSong: (id: string) => void }) {
  const { t } = useI18n()
  const [urlEnabled, setUrlEnabled] = useState(false)
  const [url, setUrl] = useState('')
  const [lib, setLib] = useState<LibraryEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.config().then((c) => setUrlEnabled(c.url_ingest_enabled)).catch(() => {})
    api.library().then(setLib).catch(() => {})
  }, [])

  const upload = async (f: File | undefined) => {
    if (!f) return
    setError(null)
    try { onJob((await api.upload(f)).id) } catch (e) { setError(String((e as Error).message)) }
  }
  const fromUrl = async () => {
    setError(null)
    try { onJob((await api.fromUrl(url.trim())).id) } catch (e) { setError(String((e as Error).message)) }
  }

  return (
    <div className="page home">
      <div
        className={`drop${drag ? ' drop-on' : ''}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files[0]) }}
      >
        <div className="drop-icon">♪</div>
        <h2>{t('uploadTitle')}</h2>
        <p className="muted">{t('uploadHint')}</p>
        <input ref={fileRef} type="file" accept="audio/*,video/mp4,video/webm" hidden onChange={(e) => upload(e.target.files?.[0])} />
      </div>

      {urlEnabled && (
        <form className="url" onSubmit={(e) => { e.preventDefault(); if (url.trim()) fromUrl() }}>
          <span className="muted">{t('urlTitle')}</span>
          <input placeholder={t('urlHint')} value={url} onChange={(e) => setUrl(e.target.value)} />
          <button type="submit" disabled={!url.trim()}>{t('analyze')}</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}

      <h3>{t('recent')}</h3>
      {lib.length === 0 && <p className="muted">{t('noRecent')}</p>}
      <ul className="library">
        {lib.map((e) => (
          <li key={e.id}>
            <button className="link" onClick={() => onSong(e.id)}>
              <b>{e.title || e.id}</b>{e.artist && <span className="muted"> — {e.artist}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
