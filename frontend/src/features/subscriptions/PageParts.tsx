import { cn } from '../../lib/utils';
import { ICON_MAP } from './icons';

/** A titled panel on the Subscriptions page: one border, rows divided inside, no nested cards. */
export function Section({ id, title, aside, children, className }: { id?: string; title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={cn('scroll-mt-20 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--color-border)] px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold text-[var(--ref-on-surface)]">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function SubscriptionIcon({ iconKey }: { iconKey: string }) {
  const Icon = ICON_MAP[iconKey] ?? ICON_MAP.default;
  return (
    <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full border border-[var(--color-border)] text-[var(--ref-on-surface-variant)]" aria-hidden>
      <Icon className="h-4 w-4" />
    </span>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="divide-y divide-[var(--color-border)]" aria-busy aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-3 sm:px-5">
          <div className="h-[34px] w-[34px] animate-pulse rounded-full bg-[var(--color-muted)]/20" />
          <div className="flex-1 space-y-1.5"><div className="h-3.5 w-1/3 animate-pulse rounded bg-[var(--color-muted)]/20" /><div className="h-3 w-1/2 animate-pulse rounded bg-[var(--color-muted)]/15" /></div>
          <div className="h-4 w-20 animate-pulse rounded bg-[var(--color-muted)]/20" />
        </div>
      ))}
    </div>
  );
}

