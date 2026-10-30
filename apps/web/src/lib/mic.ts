/**
 * Opening the microphone, with a reason the player can act on when it fails. The same page runs
 * in the Mac app (WKWebView), in phone Safari / a home-screen icon and in desktop browsers, and
 * each fixes a refused microphone in a different place.
 */

import { diag } from './diag'

export type MicProblem = 'insecure' | 'denied' | 'nodevice' | 'busy' | 'other'
export type MicPlace = 'mac-app' | 'ios' | 'browser'

export class MicError extends Error {
  problem: MicProblem
  constructor(problem: MicProblem, message = '') {
    super(message || problem)
    this.problem = problem
  }
}

/** The Mac app tags its user agent (apps/mac/TabGen.swift). */
export function micPlace(ua = navigator.userAgent): MicPlace {
  if (/TabGenMac/.test(ua)) return 'mac-app'
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios'
  return 'browser'
}

export function micProblem(e: unknown): MicProblem {
  const name = (e as { name?: string })?.name ?? ''
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'nodevice'
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy'
  return 'other'
}

export async function openMic(audio: MediaTrackConstraints = {}): Promise<MediaStream> {
  // browsers hide the microphone API entirely on plain-http pages (e.g. http://<mac-ip>:8000)
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    diag(`mic insecure secure=${window.isSecureContext}`)
    throw new MicError('insecure')
  }
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio })
    const t = s.getAudioTracks()[0]
    diag(`mic ok ${t ? `${t.label} ${t.readyState} muted=${t.muted}` : 'no audio track'}`)
    return s
  } catch (e) {
    diag(`mic FAILED ${(e as Error)?.name}: ${(e as Error)?.message}`)
    throw new MicError(micProblem(e), (e as Error)?.message)
  }
}

/** i18n key for the message: mic.<problem>[.<place>] */
export function micErrorKey(e: unknown, place: MicPlace = micPlace()): string {
  const p = e instanceof MicError ? e.problem : micProblem(e)
  return p === 'denied' ? `mic.denied.${place}` : `mic.${p}`
}

/** File extension for a MediaRecorder blob, read from its first bytes (the reported type can be
 * empty or generic): MP4 from Safari / the Mac app, WebM from Chrome, Ogg from Firefox. */
export async function recordingExt(blob: Blob): Promise<string> {
  const h = new Uint8Array(await blob.slice(0, 12).arrayBuffer())
  const ascii = (a: number, b: number) => String.fromCharCode(...h.slice(a, b))
  if (ascii(4, 8) === 'ftyp') return 'm4a'
  if (h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3) return 'webm'
  if (ascii(0, 4) === 'OggS') return 'ogg'
  if (ascii(0, 4) === 'RIFF') return 'wav'
  return blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'
}

/**
 * An AudioContext that starts as soon as the player touches the page. iPhone (and the Mac app)
 * create contexts suspended when no tap started them -- e.g. the tuner, which opens the mic on
 * page load -- and a suspended context hears nothing, so the needle never moves.
 */
const contexts = new Set<AudioContext>()
export function newAudioContext(opts?: AudioContextOptions): AudioContext {
  const c = new AudioContext(opts)
  contexts.add(c)
  diag(`audio context ${c.state} ${c.sampleRate}Hz`)
  c.addEventListener('statechange', () => {
    diag(`audio context -> ${c.state}`)
    if (c.state === 'closed') contexts.delete(c)
  })
  return c
}
function wake() {
  // iOS also has 'interrupted' (a call, Siri, another app took the audio)
  contexts.forEach((c) => { if (c.state !== 'running' && c.state !== 'closed') void c.resume() })
}
if (typeof window !== 'undefined') {
  for (const ev of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(ev, wake, true)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake() })
}
