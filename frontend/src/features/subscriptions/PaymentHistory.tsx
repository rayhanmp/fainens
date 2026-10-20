import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '../../components/ui/Button';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn, formatDate } from '../../lib/utils';
import { daysFromToday } from './schedule';
import type { useSubscriptionHistoryQuery } from './queries';

export type HistoryEntry = NonNullable<ReturnType<typeof useSubscriptionHistoryQuery>['data']>['entries'][number];
export type DatedHistoryEntry = HistoryEntry & { dueAt: number };

const STATUS_NOTE: Partial<Record<HistoryEntry['status'], string>> = {
  linked: 'Linked',
  corrected: 'Corrected',
  voided: 'Voided',
};

/**
 * The charges a subscription has made, newest first. Renewals skipped without a charge fold away;
 * tapping a charge shows what can be done with it.
 */
export function PaymentHistory({ history, onUnlink, onFix }: {
  history: ReturnType<typeof useSubscriptionHistoryQuery>;
  onUnlink: (entry: DatedHistoryEntry) => void;
  onFix: (entry: DatedHistoryEntry, kind: 'correct' | 'void') => void;
}) {
  const navigate = useNavigate();
  const { formatAmount } = useBalanceVisibility();
  const [open, setOpen] = useState<string | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);

  if (history.isPending) {
    return <div className="space-y-2" aria-busy>{[0, 1, 2].map((i) => <div key={i} className="h-9 animate-pulse rounded-md bg-[var(--color-muted)]/20" />)}</div>;
  }
  if (history.error) {
    return (
      <p className="text-sm text-[var(--color-danger)]">
        {history.error instanceof Error ? history.error.message : 'Could not load the payments'}{' '}
        <button type="button" className="underline" onClick={() => void history.refetch()}>Retry</button>
      </p>
    );
  }
  const entries = history.data!.entries;
  const charges = entries.filter((entry) => entry.status !== 'skipped');
  const skipped = entries.filter((entry) => entry.status === 'skipped');
  const shown = showSkipped ? entries : charges;

  return (
    <div>
      {shown.length === 0 ? (
        <p className="py-2 text-sm text-[var(--ref-on-surface-variant)]">No payments recorded yet.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {shown.map((entry, index) => {
            const tx = entry.transaction;
            const key = `${entry.dueAt ?? 'manual'}-${tx?.id ?? index}`;
            const expanded = open === key;
            const dated = entry.dueAt != null;
            const late = tx && dated && daysFromToday(tx.date, entry.dueAt!) > 0;
            const live = tx?.status === 'posted';
            if (!tx) {
              return (
                <li key={key} className="flex items-center justify-between gap-3 py-2 text-sm text-[var(--ref-on-surface-variant)]">
                  <span>{formatDate(entry.dueAt ?? 0)}</span>
                  <span className="text-xs">Skipped</span>
                </li>
              );
            }
            const detail = [late ? `paid late, ${formatDate(tx.date)}` : dated && daysFromToday(tx.date, entry.dueAt!) < 0 ? `paid early, ${formatDate(tx.date)}` : null, tx.accountName].filter(Boolean).join(' · ');
            return (
              <li key={key}>
                <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : key)} className="flex w-full items-center gap-3 py-2 text-left">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-[var(--ref-on-surface)]">
                      {formatDate(entry.dueAt ?? tx.date)}
                      {STATUS_NOTE[entry.status] && <span className="ml-2 text-xs text-[var(--ref-on-surface-variant)]">{STATUS_NOTE[entry.status]}</span>}
                    </span>
                    {detail && <span className="block truncate text-xs text-[var(--ref-on-surface-variant)]">{detail}</span>}
                  </span>
                  <span className={cn('shrink-0 text-sm tabular-nums', live ? 'font-medium text-[var(--ref-on-surface)]' : 'text-[var(--ref-on-surface-variant)] line-through')}>{formatAmount(tx.amount)}</span>
                  <ChevronDown className={cn('h-4 w-4 shrink-0 text-[var(--color-muted)] transition-transform', expanded && 'rotate-180')} aria-hidden />
                </button>
                {expanded && (
                  <div className="space-y-2 pb-3 text-xs">
                    <p className="text-[var(--ref-on-surface-variant)]">“{tx.description}”{entry.note && entry.status !== 'paid' ? ` — ${entry.note}` : ''}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="secondary" onClick={() => void navigate({ to: '/transactions', search: { periodId: 'all', transactionId: String(tx.id) } })}>Open transaction</Button>
                      {live && dated && entry.status === 'paid' && <Button type="button" size="sm" variant="secondary" onClick={() => onFix(entry as DatedHistoryEntry, 'correct')}>Correct</Button>}
                      {live && dated && entry.status === 'linked' && <Button type="button" size="sm" variant="secondary" onClick={() => onUnlink(entry as DatedHistoryEntry)}>Unlink</Button>}
                      {live && dated && (entry.status === 'paid' || entry.status === 'linked') && <Button type="button" size="sm" variant="secondary" className="text-[var(--color-danger)]" onClick={() => onFix(entry as DatedHistoryEntry, 'void')}>Void</Button>}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {skipped.length > 0 && (
        <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={() => setShowSkipped((value) => !value)}>
          {showSkipped ? 'Hide skipped renewals' : `Show ${skipped.length} skipped renewal${skipped.length === 1 ? '' : 's'}`}
        </Button>
      )}
    </div>
  );
}
