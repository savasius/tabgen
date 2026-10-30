/**
 * The practice coach: after a run-through, take the bars the player missed most, loop each one
 * slowly, and speed it up as the player gets it -- the way a teacher would ("again, a bit slower;
 * good, now a little faster"). Pure state machine; PlayAlong feeds it per-pass accuracy and
 * applies the loop and speed it asks for.
 */

export const COACH = {
  weakBelow: 0.7,      // a bar under this accuracy in the run-through gets drilled
  maxTargets: 3,       // at most this many bars per session
  startSpeed: 0.6,
  step: 0.1,
  goodPass: 0.8,       // a pass at or above this counts as good
  badPass: 0.5,        // two passes under this in a row: slow down
  goodToAdvance: 2,    // good passes in a row before speeding up
  minBeats: 2,         // a pass with fewer scored beats (player paused) doesn't count
}

export type CoachPhase = 'idle' | 'run' | 'drill' | 'done'

export interface CoachState {
  phase: CoachPhase
  targets: number[]        // bars still to drill, worst first
  bar: number | null       // the bar being drilled
  speed: number
  good: number             // good passes in a row at this speed
  bad: number              // bad passes in a row
  passes: number           // passes on this bar
  mastered: number[]       // bars brought up to full speed
  lastAcc: number | null
  message: CoachMessage
}

export type CoachMessage =
  | { key: 'idle' }
  | { key: 'run' }
  | { key: 'allGood'; acc: number }
  | { key: 'drillStart'; bar: number; speed: number }
  | { key: 'again'; acc: number }
  | { key: 'faster'; speed: number }
  | { key: 'slower'; speed: number }
  | { key: 'mastered'; bar: number; next: number | null }
  | { key: 'silent' }
  | { key: 'done'; mastered: number }

export type CoachEvent =
  | { type: 'start' }
  | { type: 'runEnd'; bars: Map<number, { hit: number; all: number }> }
  | { type: 'passEnd'; hit: number; all: number }
  | { type: 'skip' }
  | { type: 'stop' }

export const initialCoach: CoachState = {
  phase: 'idle', targets: [], bar: null, speed: 1, good: 0, bad: 0, passes: 0, mastered: [], lastAcc: null,
  message: { key: 'idle' },
}

const round1 = (x: number) => Math.round(x * 10) / 10

function nextTarget(s: CoachState, mastered: number[]): CoachState {
  const [bar, ...rest] = s.targets
  if (bar === undefined) {
    return { ...s, phase: 'done', bar: null, speed: 1, targets: [], mastered, message: { key: 'done', mastered: mastered.length } }
  }
  return {
    ...s, phase: 'drill', bar, targets: rest, speed: COACH.startSpeed, good: 0, bad: 0, passes: 0, mastered,
    message: { key: 'drillStart', bar, speed: COACH.startSpeed },
  }
}

export function coach(s: CoachState, e: CoachEvent): CoachState {
  switch (e.type) {
    case 'start':
      return { ...initialCoach, phase: 'run', message: { key: 'run' } }
    case 'stop':
      return { ...initialCoach }
    case 'runEnd': {
      if (s.phase !== 'run') return s
      let hit = 0
      let all = 0
      const weak: [number, number][] = []
      for (const [bar, x] of e.bars) {
        hit += x.hit
        all += x.all
        if (x.all >= COACH.minBeats && x.hit / x.all < COACH.weakBelow) weak.push([bar, x.hit / x.all])
      }
      if (all < COACH.minBeats) return { ...s, message: { key: 'silent' } }
      weak.sort((p, q) => p[1] - q[1] || p[0] - q[0])
      const targets = weak.slice(0, COACH.maxTargets).map(([bar]) => bar)
      if (!targets.length) {
        return { ...s, phase: 'done', lastAcc: hit / all, message: { key: 'allGood', acc: hit / all } }
      }
      return nextTarget({ ...s, targets, lastAcc: hit / all }, [])
    }
    case 'passEnd': {
      if (s.phase !== 'drill' || s.bar === null) return s
      if (e.all < COACH.minBeats) return { ...s, message: { key: 'silent' } }
      const acc = e.hit / e.all
      const passes = s.passes + 1
      if (acc >= COACH.goodPass) {
        const good = s.good + 1
        if (good < COACH.goodToAdvance) return { ...s, good, bad: 0, passes, lastAcc: acc, message: { key: 'again', acc } }
        if (s.speed >= 1 - 1e-6) {
          const mastered = [...s.mastered, s.bar]
          const after = nextTarget({ ...s, lastAcc: acc }, mastered)
          return after.phase === 'done'
            ? after
            : { ...after, message: { key: 'mastered', bar: s.bar, next: after.bar } }
        }
        const speed = round1(Math.min(1, s.speed + COACH.step))
        return { ...s, speed, good: 0, bad: 0, passes, lastAcc: acc, message: { key: 'faster', speed } }
      }
      const bad = acc < COACH.badPass ? s.bad + 1 : 0
      if (bad >= 2 && s.speed > 0.5 + 1e-6) {
        const speed = round1(Math.max(0.5, s.speed - COACH.step))
        return { ...s, speed, good: 0, bad: 0, passes, lastAcc: acc, message: { key: 'slower', speed } }
      }
      return { ...s, good: 0, bad, passes, lastAcc: acc, message: { key: 'again', acc } }
    }
    case 'skip':
      if (s.phase !== 'drill') return s
      return nextTarget(s, s.mastered)
  }
}
