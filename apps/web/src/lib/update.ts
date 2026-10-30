/**
 * Reload when a new build is on the server. A home-screen app on iPhone (and the Mac app's
 * window) can stay open for days showing the page it loaded first; when it comes back to the
 * front we compare the build's entry script with the one we are running.
 */
import { diag } from './diag'

const entry = (doc: Document | string) => {
  const html = typeof doc === 'string' ? doc : doc.documentElement.outerHTML
  return /\/assets\/index-[\w-]+\.js/.exec(html)?.[0] ?? null
}

export function watchForUpdates() {
  if (import.meta.env.DEV) return
  const running = entry(document)
  if (!running) return
  let last = 0
  const check = async () => {
    if (document.hidden || Date.now() - last < 30_000) return
    last = Date.now()
    try {
      const html = await (await fetch('/', { cache: 'no-store' })).text()
      const latest = entry(html)
      if (latest && latest !== running) {
        diag(`new version ${latest} (was ${running}): reloading`)
        location.reload()
      }
    } catch { /* offline: try again next time */ }
  }
  document.addEventListener('visibilitychange', () => void check())
  window.addEventListener('focus', () => void check())
  window.setInterval(() => void check(), 10 * 60_000)
}
