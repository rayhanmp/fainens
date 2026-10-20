import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { ActionSheet, type SheetAction } from '../../components/ui/ActionSheet';
import { usePhoneSheets } from '../../hooks/usePhoneSheets';
import { cn } from '../../lib/utils';
import { ICON_MAP } from './icons';

/**
 * A "More" button for the less frequent actions: a small menu that opens upward (it sits in dialog
 * footers), or a bottom sheet on phones, as on the Accounts page.
 */
export function MoreActions({ title, actions, disabled }: { title: string; actions: SheetAction[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const asSheet = usePhoneSheets();
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || asSheet) return undefined;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [open, asSheet]);
  return (
    <div ref={rootRef} className="relative">
      <Button type="button" size="sm" variant="secondary" disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <MoreHorizontal className="mr-1 inline h-4 w-4" aria-hidden />More
      </Button>
      {asSheet ? (
        <ActionSheet isOpen={open} onClose={() => setOpen(false)} title={title} actions={actions} />
      ) : open && (
        <div role="menu" aria-label={title} className="absolute bottom-[calc(100%+6px)] left-0 z-10 w-52 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-lg">
          {actions.map((action) => (
            <button key={action.key} type="button" role="menuitem" disabled={action.disabled} onClick={() => { setOpen(false); action.onSelect(); }}
              className={cn('flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm disabled:opacity-50', action.tone === 'danger' ? 'text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10' : 'text-[var(--ref-on-surface)] hover:bg-[var(--ref-surface-container-low)]')}>
              {action.icon && <action.icon className="h-4 w-4 shrink-0" aria-hidden />}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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

