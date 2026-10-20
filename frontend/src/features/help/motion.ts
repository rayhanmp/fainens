import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';

/** Steps through `count` stages, one every `interval` ms, once the element is on screen. */
export function useSequence(count: number, interval = 900) {
  const ref = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [run, setRun] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const observer = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) setVisible(true); }, { threshold: 0.4 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    const timers = Array.from({ length: count }, (_, index) => window.setTimeout(() => setStep(index + 1), 350 + index * interval));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [visible, run, count, interval]);

  const replay = () => { setStep(0); setRun((value) => value + 1); };
  return { ref, step, replay };
}

/** Fades and lifts an element in once `visible` is true. */
export const shown = (visible: boolean) => cn('transition-all duration-500 ease-out', visible ? 'translate-y-0 opacity-100' : 'translate-y-1.5 opacity-0');
