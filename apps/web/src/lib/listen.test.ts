import { afterEach, describe, expect, it, vi } from 'vitest'
import { guitarStemCandidates, hasIsolatedGuitar, preferredListenMode, resolveGuitarStemUrl } from './listen'

describe('listen modes', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('prefers isolated guitar, then tab synth, never the mix when a guitar source exists', () => {
    expect(preferredListenMode({ guitar: true, tab: true })).toBe('guitar')
    expect(preferredListenMode({ guitar: true, tab: false })).toBe('guitar')
    expect(preferredListenMode({ guitar: false, tab: true })).toBe('tab')
    expect(preferredListenMode({ guitar: false, tab: false })).toBe('original')
  })

  it('treats PR #3 guitar metadata as a live stem hint', () => {
    expect(hasIsolatedGuitar({ audio: { mix: '/m', original: '/o', guitar: '/g' } })).toBe(true)
    expect(hasIsolatedGuitar({ guitar: { source: 'guitar', rms: 1, mix_rms: 1, ratio: 1, warning: null, empty: false } })).toBe(true)
    expect(hasIsolatedGuitar({ stems: { guitar: true } })).toBe(true)
    expect(hasIsolatedGuitar({})).toBe(false)
  })

  it('probes audio?stem=guitar first, then /stems/guitar', () => {
    const urls = guitarStemCandidates('demo01ab2c3d')
    expect(urls[0]).toMatch(/\/v1\/analyses\/demo01ab2c3d\/audio\?stem=guitar$/)
    expect(urls[1]).toMatch(/\/v1\/analyses\/demo01ab2c3d\/stems\/guitar$/)
  })

  it('resolves the first live stem URL and skips a missing /stems/guitar', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const ok = url.includes('audio?stem=guitar')
      if (init?.method === 'HEAD') return new Response(null, { status: ok ? 200 : 404 })
      return new Response(null, { status: ok ? 200 : 404 })
    }))
    const url = await resolveGuitarStemUrl('demo01ab2c3d', false, async () => {})
    expect(url).toMatch(/\/audio\?stem=guitar$/)
  })
})
