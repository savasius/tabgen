import { useCallback, useEffect, useRef, useState } from "react";

export interface Loop {
  start: number;
  end: number;
  label?: string;
}

export interface PlayerState {
  time: number;
  playing: boolean;
  speed: number;
  loop: Loop | null;
  countIn: boolean;
  /** Beats remaining in the count-in (0 when not counting). */
  counting: number;
}

/**
 * Simulated transport. The real app drives this from `audio.currentTime` (or the YouTube IFrame API);
 * the component contract (time/playing/speed/loop + seek/toggle) stays the same.
 */
export function usePlayer(duration: number, secondsPerBeat: number, initialTime = 0) {
  const [state, setState] = useState<PlayerState>({
    time: initialTime,
    playing: false,
    speed: 1,
    loop: null,
    countIn: true,
    counting: 0,
  });
  const raf = useRef(0);
  const last = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!state.playing) return;
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - last.current) / 1000;
      last.current = now;
      setState((s) => {
        if (!s.playing) return s;
        if (s.counting > 0) {
          const c = s.counting - dt / (secondsPerBeat / s.speed);
          return { ...s, counting: c <= 0 ? 0 : c };
        }
        let time = s.time + dt * s.speed;
        if (s.loop && time >= s.loop.end) time = s.loop.start;
        if (time >= duration) return { ...s, time: duration, playing: false };
        return { ...s, time };
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [state.playing, duration, secondsPerBeat]);

  const toggle = useCallback(() => {
    setState((s) => ({ ...s, playing: !s.playing, counting: !s.playing && s.countIn ? 4 : 0 }));
  }, []);
  const seek = useCallback((time: number) => setState((s) => ({ ...s, time: Math.max(0, Math.min(duration, time)) })), [duration]);
  const setSpeed = useCallback((speed: number) => setState((s) => ({ ...s, speed })), []);
  const setLoop = useCallback((loop: Loop | null) => setState((s) => ({ ...s, loop, time: loop ? loop.start : s.time })), []);
  const setCountIn = useCallback((countIn: boolean) => setState((s) => ({ ...s, countIn })), []);
  const pause = useCallback(() => setState((s) => ({ ...s, playing: false })), []);

  return { ...state, toggle, seek, setSpeed, setLoop, setCountIn, pause, ref: stateRef };
}
