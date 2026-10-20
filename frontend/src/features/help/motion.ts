import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';

const onScreen = (element: HTMLElement) => {
  const rect = element.getBoundingClientRect();
  return rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0;
};

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
    // Also start when it's already on screen as the page opens, in case no intersection change is reported.
    const timer = window.setTimeout(() => { if (onScreen(element)) setVisible(true); }, 400);
    return () => { observer.disconnect(); window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    const timers = Array.from({ length: count }, (_, index) => window.setTimeout(() => setStep(index + 1), 350 + index * interval));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [visible, run, count, interval]);

  const replay = () => { setStep(0); setRun((value) => value + 1); };
  return { ref, step, replay };
}

/** Loops `index` through `count` every `interval` ms while the element is on screen, unless paused. */
export function useAutoplay(count: number, interval: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { threshold: 0.35 });
    observer.observe(element);
    const timer = window.setTimeout(() => { if (onScreen(element)) setVisible(true); }, 400);
    return () => { observer.disconnect(); window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!visible || paused) return undefined;
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % count), interval);
    return () => window.clearInterval(timer);
  }, [visible, paused, count, interval]);

  return { ref, index, setIndex, setPaused };
}

/** Fades and lifts an element in once `visible` is true. */
export const shown = (visible: boolean) => cn('transition-all duration-500 ease-out', visible ? 'translate-y-0 opacity-100' : 'translate-y-1.5 opacity-0');
