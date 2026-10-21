import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { ActivityHero } from '../audit-log/ActivityGrid';
import { activityStart, dayKey, type ActivityDay } from '../audit-log/activity';
import { EntryChanges, EntryReason, EntryRow, RecordHistory } from '../audit-log/EntryViews';
import { entrySubtitle, entryTitle } from '../audit-log/format';
import { auditReason, type AuditEntry, type AuditFormat } from '../audit-log/describe';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { formatDate, formatDateTime, formatWeekdayDate } from '../../lib/utils';
import { exampleAccounts, useHelpPersonal } from './personal';
import { VisualFrame } from './visuals';

/**
 * The Security audit page's own pieces (the 12-week grid, entry rows, and an opened entry's
 * changes and history) with sample entries, so the picture is the page itself.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Twelve weeks of made-up but steady activity: quieter weekends, one import day, a few deletions. */
function sampleDays(start: number): ActivityDay[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days: ActivityDay[] = [];
  for (let at = start, index = 0; at <= today.getTime(); at += DAY_MS, index += 1) {
    const date = new Date(at);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const count = index === 30 ? 214 : (index * 7 + 3) % 5 === 0 ? 0 : weekend ? (index % 3) + 1 : (index * 5) % 9 + 2;
    const removed = index === 30 || index % 23 === 11 || at === today.getTime() ? 1 : 0;
    days.push({ day: dayKey(date), count: Math.max(count, removed), removed });
  }
  return days;
}

/** The sample records' names, and money that follows Hide balances like the page does. */
function useSampleFormat(): AuditFormat {
  const { formatAmount } = useBalanceVisibility();
  const { first } = exampleAccounts(useHelpPersonal());
  return useMemo(() => ({
    amount: formatAmount,
    date: formatDate,
    dateTime: (ms) => formatDateTime(ms),
    category: (id) => ({ 1: 'Food & dining', 2: 'Coffee' })[id] ?? null,
    account: (id) => ({ 10: first, 11: 'Expense (Auto)' })[id] ?? null,
    period: () => null,
    tag: () => null,
  }), [first, formatAmount]);
}

function sampleEntries(): AuditEntry[] {
  const now = new Date();
  const at = (daysAgo: number, hours: number, minutes: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hours, minutes).getTime();
  const coffee = (categoryId: number, amount: number) => ({
    transaction: { id: 812, description: 'Kopi susu', categoryId, date: new Date(at(1, 8, 5)).toISOString(), status: 'posted' },
    lines: [{ accountId: 11, debit: amount, credit: 0 }, { accountId: 10, debit: 0, credit: amount }],
  });
  return [
    { id: 6, entityType: 'transaction', entityId: 812, action: 'update', beforeSnapshot: coffee(1, 25_000), afterSnapshot: coffee(2, 28_000), createdAt: at(0, 9, 41) },
    { id: 5, entityType: 'subscription', entityId: 4, action: 'delete', beforeSnapshot: { id: 4, name: 'Netflix', amount: 186_000, billingCycle: 'monthly', status: 'active' }, afterSnapshot: null, createdAt: at(0, 9, 12) },
    { id: 4, entityType: 'salary_period', entityId: 20, action: 'close', beforeSnapshot: { id: 20, name: 'September 2026', status: 'open', closedAt: null }, afterSnapshot: { id: 20, name: 'September 2026', status: 'closed', closedAt: new Date(at(0, 8, 30)).toISOString(), reason: 'Every account reconciled' }, createdAt: at(0, 8, 30) },
    { id: 3, entityType: 'transaction', entityId: 812, action: 'create', beforeSnapshot: null, afterSnapshot: coffee(1, 25_000), createdAt: at(1, 8, 6) },
    { id: 2, entityType: 'category', entityId: 2, action: 'create', beforeSnapshot: null, afterSnapshot: { name: 'Coffee', color: '#8B5E3C' }, createdAt: at(1, 8, 2) },
  ];
}

/** The grid at the top of the page; points and clicks work as they do there. */
export function AuditActivityDemo() {
  const [start] = useState(() => activityStart());
  const days = useMemo(() => sampleDays(start), [start]);
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <VisualFrame caption="Sample activity. Point at a square to see its day; click one to pick it, as the page does to list only that day.">
      <ActivityHero days={days} start={start} selected={selected} onSelect={(day) => setSelected(day ? dayKey(day) : null)} loading={false} />
    </VisualFrame>
  );
}

/** Entries as the page lists them; clicking one opens it beside the list, as the page's dialog shows it. */
export function AuditEntryDemo() {
  const format = useSampleFormat();
  const entries = useMemo(() => sampleEntries(), []);
  const [open, setOpen] = useState<AuditEntry>(entries[0]!);
  const groups = useMemo(() => {
    const out: Array<{ key: string; at: number; rows: AuditEntry[] }> = [];
    for (const entry of entries) {
      const key = dayKey(new Date(entry.createdAt));
      const last = out[out.length - 1];
      if (last?.key === key) last.rows.push(entry);
      else out.push({ key, at: entry.createdAt, rows: [entry] });
    }
    return out;
  }, [entries]);
  const history = entries.filter((entry) => entry.entityType === open.entityType && entry.entityId === open.entityId);
  const reason = auditReason(open);

  return (
    <VisualFrame caption="Sample entries. Click one to open it: what changed, and everything else that happened to that record.">
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)]">
          {groups.map((group) => (
            <div key={group.key}>
              <h3 className="border-b border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--ref-on-surface-variant)]">
                {formatWeekdayDate(group.at)}
              </h3>
              <ul className="divide-y divide-[var(--color-border)]">
                {group.rows.map((entry) => <EntryRow key={entry.id} entry={entry} format={format} onOpen={() => setOpen(entry)} />)}
              </ul>
            </div>
          ))}
        </div>

        {/* The opened entry, laid out as the dialog's header and body. */}
        <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)]" aria-live="polite">
          <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] p-5">
            <div className="min-w-0">
              <p className="font-headline text-2xl font-extrabold tracking-tight text-[var(--color-text-primary)]">{entryTitle(open)}</p>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{entrySubtitle(open)}</p>
            </div>
            <X className="mt-1.5 h-5 w-5 shrink-0 text-[var(--color-muted)]" aria-hidden />
          </div>
          <div className="space-y-6 px-5 py-4">
            {reason && <EntryReason reason={reason} />}
            <EntryChanges entry={open} format={format} />
            {history.length > 1 && <RecordHistory history={history} currentId={open.id} onOpen={setOpen} />}
          </div>
        </div>
      </div>
    </VisualFrame>
  );
}
