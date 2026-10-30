import { describe, expect, it } from 'vitest'
import { MicError, micErrorKey, micPlace, micProblem } from './mic'

describe('mic errors', () => {
  it('maps browser error names to a fixable problem', () => {
    expect(micProblem({ name: 'NotAllowedError' })).toBe('denied')
    expect(micProblem({ name: 'NotFoundError' })).toBe('nodevice')
    expect(micProblem({ name: 'NotReadableError' })).toBe('busy')
    expect(micProblem(new Error('x'))).toBe('other')
  })
  it('tells each device where to switch the microphone on', () => {
    const denied = new MicError('denied')
    expect(micErrorKey(denied, 'mac-app')).toBe('mic.denied.mac-app')
    expect(micErrorKey(denied, 'ios')).toBe('mic.denied.ios')
    expect(micErrorKey(new MicError('insecure'), 'ios')).toBe('mic.insecure')
  })
  it('recognises the Mac app and iPhone', () => {
    expect(micPlace('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15 TabGenMac/1')).toBe('mac-app')
    expect(micPlace('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15')).toBe('ios')
  })
})
