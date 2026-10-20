import { useCallback, useEffect, useRef } from 'react';

/** A timeout that is called off if the component unmounts before it fires (used by the mini-games). */
export function useLater() {
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(timer => window.clearTimeout(timer)), []);
  return useCallback((run: () => void, ms: number) => { timers.current.push(window.setTimeout(run, ms)); }, []);
}
