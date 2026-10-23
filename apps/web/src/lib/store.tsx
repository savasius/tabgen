import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { en } from '@/i18n/en'
import { tr, type Dict } from '@/i18n/tr'
import type { Level } from '@/music/chords'
import type { Notation } from './display'
import type { TuningId } from './tunings'

export type Lang = 'tr' | 'en'
export type Theme = 'system' | 'light' | 'dark'

export interface Settings {
  lang: Lang
  theme: Theme
  lefty: boolean
  notation: Notation
  tuning: TuningId
  level: Level
  instrument: 'acoustic' | 'electric' | 'classical'
  latencyMs: number
  a4: number
  bigText: boolean
  chordColors: boolean
  reduceMotion: boolean
}

const DEFAULTS: Settings = {
  lang: 'tr',
  theme: 'dark',
  lefty: false,
  notation: 'letter',
  tuning: 'standard',
  level: 'normal',
  instrument: 'acoustic',
  latencyMs: 42,
  a4: 440,
  bigText: false,
  chordColors: true,
  reduceMotion: false,
}

const DICTS: Record<Lang, Dict> = { tr, en }

type Path<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Path<T[K], `${P}${K}.`>
}[keyof T & string]
export type TKey = Path<Dict>

interface Ctx {
  settings: Settings
  set: <K extends keyof Settings>(k: K, v: Settings[K]) => void
  t: (key: TKey, vars?: Record<string, string | number>) => string
  resolvedTheme: 'light' | 'dark'
}

const AppCtx = createContext<Ctx | null>(null)

function load(): Settings {
  try {
    const params = new URLSearchParams(location.search)
    const stored = JSON.parse(localStorage.getItem('tabgen.settings') ?? '{}') as Partial<Settings>
    const s = { ...DEFAULTS, ...stored }
    if (params.get('lang') === 'en' || params.get('lang') === 'tr') s.lang = params.get('lang') as Lang
    if (params.get('theme') === 'light' || params.get('theme') === 'dark') s.theme = params.get('theme') as Theme
    return s
  } catch {
    return DEFAULTS
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load)
  const [systemDark, setSystemDark] = useState(() =>
    typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)').matches : true,
  )

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const fn = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])

  const resolvedTheme = settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : settings.theme

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark')
    document.documentElement.lang = settings.lang
    document.documentElement.style.fontSize = settings.bigText ? '18px' : ''
    localStorage.setItem('tabgen.settings', JSON.stringify(settings))
  }, [settings, resolvedTheme])

  const set = useCallback(<K extends keyof Settings>(k: K, v: Settings[K]) => {
    setSettings((s) => ({ ...s, [k]: v }))
  }, [])

  const t = useCallback(
    (key: TKey, vars?: Record<string, string | number>) => {
      let node: unknown = DICTS[settings.lang]
      for (const part of key.split('.')) node = (node as Record<string, unknown>)?.[part]
      let str = typeof node === 'string' ? node : key
      if (vars) for (const [k, v] of Object.entries(vars)) str = str.replaceAll(`{${k}}`, String(v))
      return str
    },
    [settings.lang],
  )

  const value = useMemo(() => ({ settings, set, t, resolvedTheme }), [settings, set, t, resolvedTheme])
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

export function useApp() {
  const c = useContext(AppCtx)
  if (!c) throw new Error('useApp outside provider')
  return c
}

export function useT() {
  return useApp().t
}

export function relativeTime(ms: number, t: Ctx['t']) {
  const diff = (Date.now() - ms) / 60000
  if (diff < 2) return t('time.justNow')
  if (diff < 60) return t('time.minutesAgo', { n: Math.round(diff) })
  if (diff < 60 * 24) return t('time.hoursAgo', { n: Math.round(diff / 60) })
  return t('time.daysAgo', { n: Math.round(diff / 1440) })
}
