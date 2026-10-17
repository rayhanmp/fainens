import type { ReactNode } from 'react';
import { Info } from 'lucide-react';

export function MetricHint({ children }: { children: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      <button type="button" aria-label="More information" className="grid h-5 w-5 place-items-center rounded-full text-[var(--ref-outline)] transition-colors hover:bg-[var(--ref-surface-container-high)] hover:text-[var(--ref-on-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ref-primary)]">
        <Info className="h-3.5 w-3.5" />
      </button>
      <span role="tooltip" className="pointer-events-none absolute bottom-[calc(100%+0.5rem)] left-0 z-30 hidden w-56 rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-3 text-left text-xs leading-relaxed text-[var(--ref-on-surface)] shadow-xl group-hover:block group-focus-within:block">
        {children}
      </span>
    </span>
  );
}
