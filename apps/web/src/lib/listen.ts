import { api, type Analysis } from '@/api'
import type { SoundSource } from '@/player'

/** Isolated guitar is present when PR #3 wrote `audio.guitar` / `guitar`, or a stem file exists. */
export function hasIsolatedGuitar(a: Pick<Analysis, 'stems' | 'audio' | 'guitar'>): boolean {
  if (a.stems?.guitar) return true
  if (a.audio?.guitar) return true
  if (a.guitar) return true
  return false
}

/** PR #3 ships `audio?stem=guitar`; `/stems/guitar` is a thin alias. Try both. */
export function guitarStemCandidates(id: string, listed?: string | null): string[] {
  const urls = api.guitarStemUrls(id)
  if (listed && !urls.includes(listed)) return [listed, ...urls]
  return urls
}

export function preferredListenMode(opts: { guitar: boolean; tab: boolean }): SoundSource {
  if (opts.guitar) return 'guitar'
  if (opts.tab) return 'tab'
  return 'original'
}

async function urlExists(url: string): Promise<boolean> {
  try {
    const head = await fetch(url, { method: 'HEAD' })
    if (head.ok) return true
    if (head.status === 404 || head.status === 400) return false
    const get = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-1' } })
    return get.ok
  } catch {
    return false
  }
}

/** Resolve an isolated guitar-stem URL. Retries briefly if the API is still catching up. */
export async function resolveGuitarStemUrl(
  id: string,
  hinted = false,
  wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  listed?: string | null,
): Promise<string | null> {
  const urls = guitarStemCandidates(id, listed)
  const delays = hinted ? [0, 250] : [0, 400, 1200]
  for (const ms of delays) {
    if (ms) await wait(ms)
    for (const url of urls) {
      if (await urlExists(url)) return url
    }
  }
  return null
}
