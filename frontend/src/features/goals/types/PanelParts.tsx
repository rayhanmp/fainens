import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';
import { SOURCES, type SourceKey } from './sources';

/** A small line naming where a figure comes from, each source a link. */
export function Sources({ keys, className }: { keys: SourceKey[]; className?: string }) {
  return (
    <p className={cn('text-[11px] text-[var(--ref-on-surface-variant)]', className)}>
      Source{keys.length > 1 ? 's' : ''}:{' '}
      {keys.map((key, index) => (
        <span key={key}>
          {index > 0 && ' · '}
          <a href={SOURCES[key].url} target="_blank" rel="noreferrer noopener" className="font-medium text-[var(--ref-primary)] hover:underline">{SOURCES[key].label}</a>
        </span>
      ))}
    </p>
  );
}

/** A labelled figure, like "Needed upfront Rp265.000.000". */
export function Figure({ label, value, hint, tone = 'plain', large = false }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'plain' | 'warn' | 'good'; large?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--ref-on-surface-variant)]">{label}</p>
      <p className={cn('mt-1 font-semibold tabular-nums', large ? 'font-headline text-2xl font-black' : 'text-base', tone === 'warn' ? 'text-[var(--color-warning)]' : tone === 'good' ? 'text-[var(--color-success)]' : 'text-[var(--ref-on-surface)]')}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-[var(--ref-on-surface-variant)]">{hint}</p>}
    </div>
  );
}

/** A row of buttons under a tool, for what to do with its result. */
export function Actions({ children }: { children: ReactNode }) {
  return <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-3">{children}</div>;
}
