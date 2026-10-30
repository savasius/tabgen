import { describe, expect, it } from 'vitest'
import { coach, COACH, initialCoach, type CoachState } from './coach'

const bars = (entries: [number, number, number][]) => new Map(entries.map(([b, hit, all]) => [b, { hit, all }]))
const pass = (s: CoachState, hit: number, all = 4) => coach(s, { type: 'passEnd', hit, all })

describe('practice coach', () => {
  it('drills the worst bars of the run-through, worst first', () => {
    let s = coach(initialCoach, { type: 'start' })
    s = coach(s, { type: 'runEnd', bars: bars([[0, 4, 4], [1, 1, 4], [2, 2, 4], [3, 0, 4], [4, 3, 4]]) })
    expect(s.phase).toBe('drill')
    expect(s.bar).toBe(3)
    expect(s.targets).toEqual([1, 2])
    expect(s.speed).toBe(COACH.startSpeed)
  })

  it('says well done when nothing is weak', () => {
    let s = coach(initialCoach, { type: 'start' })
    s = coach(s, { type: 'runEnd', bars: bars([[0, 4, 4], [1, 3, 4]]) })
    expect(s.phase).toBe('done')
    expect(s.message.key).toBe('allGood')
  })

  it('speeds up after two good passes and masters the bar at full speed', () => {
    let s = coach(coach(initialCoach, { type: 'start' }), { type: 'runEnd', bars: bars([[5, 0, 4]]) })
    const speeds: number[] = []
    for (let i = 0; i < 20 && s.phase === 'drill'; i++) {
      s = pass(s, 4)
      speeds.push(s.speed)
    }
    expect(s.phase).toBe('done')
    expect(s.mastered).toEqual([5])
    expect(Math.max(...speeds)).toBe(1)
  })

  it('slows down after two bad passes, never below half speed', () => {
    let s = coach(coach(initialCoach, { type: 'start' }), { type: 'runEnd', bars: bars([[2, 0, 4]]) })
    s = pass(pass(s, 0), 0)
    expect(s.speed).toBe(0.5)
    expect(s.message.key).toBe('slower')
    s = pass(pass(s, 0), 0)
    expect(s.speed).toBe(0.5)
  })

  it('ignores a pass where the player was silent', () => {
    let s = coach(coach(initialCoach, { type: 'start' }), { type: 'runEnd', bars: bars([[2, 0, 4]]) })
    const before = s.passes
    s = pass(s, 0, 1)
    expect(s.passes).toBe(before)
    expect(s.message.key).toBe('silent')
  })

  it('moves on to the next bar when one is mastered or skipped', () => {
    let s = coach(coach(initialCoach, { type: 'start' }), { type: 'runEnd', bars: bars([[1, 0, 4], [7, 1, 4]]) })
    expect(s.bar).toBe(1)
    s = coach(s, { type: 'skip' })
    expect(s.bar).toBe(7)
  })
})
