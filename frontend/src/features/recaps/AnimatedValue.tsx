import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { HIDDEN_BALANCE } from '../../lib/balance-visibility';
import { useEffect, useState, type CSSProperties } from 'react';
import { formatRecapCurrency as formatCurrency } from './currency';

export function AnimatedValue({ value, money = false, suffix = '' }: { value: number; money?: boolean; suffix?: string }) {
  const { balancesHidden } = useBalanceVisibility();
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / 850);
      setDisplay(value * (1 - Math.pow(1 - progress, 3)));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  const format = (amount: number) => money ? balancesHidden ? HIDDEN_BALANCE : formatCurrency(amount) : amount.toLocaleString('en', { maximumFractionDigits: suffix === '%' ? 1 : 0 });
  return <span className="recap-animated-value"><span aria-hidden="true">{format(display)}{suffix}</span><span className="sr-only">{format(value)}{suffix}</span></span>;
}

const strip = Array.from({ length: 20 }, (_, i) => i % 10);

/** Money that lands like a slot machine: each digit spins through its column and stops in turn. */
export function RollingValue({ value }: { value: number }) {
  const { balancesHidden } = useBalanceVisibility();
  const text = balancesHidden ? HIDDEN_BALANCE : formatCurrency(value);
  if (balancesHidden) return <span className="recap-animated-value">{text}</span>;
  let digit = 0;
  return <span className="recap-roll"><span className="sr-only">{text}</span><span aria-hidden="true">{[...text].map((char, i) => /\d/.test(char)
    ? <span key={i} className="recap-roll-col" style={{ '--to': Number(char), '--i': digit++ } as CSSProperties}><span className="recap-roll-strip">{strip.map((n, j) => <span key={j}>{n}</span>)}</span></span>
    : <span key={i}>{char}</span>)}</span></span>;
}
