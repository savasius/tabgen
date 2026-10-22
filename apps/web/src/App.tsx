import { useCallback, useEffect, useState } from 'react'
import { Home } from './components/Home'
import { JobView } from './components/JobView'
import { SongView } from './components/SongView'
import { useI18n } from './i18n'

type Route = { page: 'home' } | { page: 'job'; id: string } | { page: 'song'; id: string }

function parseHash(): Route {
  const [, page, id] = window.location.hash.split('/')
  if ((page === 'job' || page === 'song') && id) return { page, id }
  return { page: 'home' }
}

export default function App() {
  const { t, lang, setLang } = useI18n()
  const [route, setRoute] = useState<Route>(parseHash)

  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = (h: string) => { window.location.hash = h }
  const onDone = useCallback((id: string) => window.location.replace(`#/song/${id}`), [])

  return (
    <div className="app">
      <nav className="top">
        <a className="brand" href="#/">TabGen</a>
        <span className="muted tagline">{t('appTagline')}</span>
        <button className="lang" onClick={() => setLang(lang === 'tr' ? 'en' : 'tr')} title={t('language')}>
          {lang === 'tr' ? 'EN' : 'TR'}
        </button>
      </nav>
      {route.page === 'home' && <Home onJob={(id) => go(`#/job/${id}`)} onSong={(id) => go(`#/song/${id}`)} />}
      {route.page === 'job' && <JobView id={route.id} onDone={onDone} onBack={() => go('#/')} />}
      {route.page === 'song' && <SongView key={route.id} id={route.id} onBack={() => go('#/')} />}
    </div>
  )
}
