/**
 * Opening the microphone, with a reason the player can act on when it fails. The same page runs
 * in the Mac app (WKWebView), in phone Safari / a home-screen icon and in desktop browsers, and
 * each fixes a refused microphone in a different place.
 */

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
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new MicError('insecure')
  try {
    return await navigator.mediaDevices.getUserMedia({ audio })
  } catch (e) {
    throw new MicError(micProblem(e), (e as Error)?.message)
  }
}

/** i18n key for the message: mic.<problem>[.<place>] */
export function micErrorKey(e: unknown, place: MicPlace = micPlace()): string {
  const p = e instanceof MicError ? e.problem : micProblem(e)
  return p === 'denied' ? `mic.denied.${place}` : `mic.${p}`
}
