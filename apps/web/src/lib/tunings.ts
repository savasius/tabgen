export const TUNINGS = {
  standard: { label: 'E A D G B E', notes: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], hz: [82.41, 110, 146.83, 196, 246.94, 329.63] },
  dropD: { label: 'D A D G B E', notes: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'], hz: [73.42, 110, 146.83, 196, 246.94, 329.63] },
  halfDown: { label: 'Eb Ab Db Gb Bb Eb', notes: ['Eb2', 'Ab2', 'Db3', 'Gb3', 'Bb3', 'Eb4'], hz: [77.78, 103.83, 138.59, 185, 233.08, 311.13] },
  openG: { label: 'D G D G B D', notes: ['D2', 'G2', 'D3', 'G3', 'B3', 'D4'], hz: [73.42, 98, 146.83, 196, 246.94, 293.66] },
  dadgad: { label: 'D A D G A D', notes: ['D2', 'A2', 'D3', 'G3', 'A3', 'D4'], hz: [73.42, 110, 146.83, 196, 220, 293.66] },
} as const

export type TuningId = keyof typeof TUNINGS
