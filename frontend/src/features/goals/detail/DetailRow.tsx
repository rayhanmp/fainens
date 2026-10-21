import type { ReactNode } from 'react';
import { InfoHint } from '../../savings/InfoHint';

/** One setting beside a goal's page: its name (and a hint) on the left, its control on the right; a note can follow below. */
export function DetailRow({ label, info, control, children }: { label: string; info?: ReactNode; control?: ReactNode; children?: ReactNode }) {
  return (
    <div className="px-4 py-3 sm:px-5">
      <div className="flex items-center justify-between gap-3">
        <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-[var(--ref-on-surface)]">
          {label}
          {info && <InfoHint label={`About ${label.toLowerCase()}`}>{info}</InfoHint>}
        </span>
        {control && <div className="min-w-0 max-w-[200px] flex-1">{control}</div>}
      </div>
      {children}
    </div>
  );
}
