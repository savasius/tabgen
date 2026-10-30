/**
 * Microphone / audio events sent to the local server (data/logs/client.log), so a problem on a
 * phone can be read on the Mac. Batched, fire-and-forget, never throws.
 */

const BASE = import.meta.env.VITE_API_BASE ?? ''
let queue: string[] = []
let timer = 0

export function diag(msg: string) {
  queue.push(`${location.hash || '#/'} ${msg}`)
  if (!timer) timer = window.setTimeout(flush, 800)
}

function flush() {
  timer = 0
  const lines = queue.splice(0)
  if (!lines.length) return
  void fetch(`${BASE}/v1/diag`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines }), keepalive: true,
  }).catch(() => {})
}

if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => diag(`error ${e.message}`))
  window.addEventListener('unhandledrejection', (e) => diag(`rejection ${String((e.reason as Error)?.message ?? e.reason)}`))
  window.addEventListener('pagehide', flush)
}
