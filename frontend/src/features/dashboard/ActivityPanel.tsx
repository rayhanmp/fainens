import { Link } from '@tanstack/react-router';
import { cn, formatDate } from '../../lib/utils';
import { relativeDay } from './navigation';
import { PanelHeader, PanelLink } from './PanelParts';
import { panelCard } from './panel-styles';

export type RecentTransaction = {
  id: number;
  date: number;
  description: string;
  notes?: string | null;
  linkedTxId?: number | null;
  categoryId?: number | null;
  expenseCents?: number;
  incomeCents?: number;
  debitCents?: number;
  creditCents?: number;
};

type Kind = 'expense' | 'income' | 'neutral';

function classifyTx(tx: RecentTransaction): Kind {
  const expense = tx.expenseCents ?? 0;
  const income = tx.incomeCents ?? 0;
  if (expense > 0 && income <= 0) return 'expense';
  if (income > 0 && expense <= 0) return 'income';
  return 'neutral';
}

function transactionAmount(tx: RecentTransaction): number {
  const expense = tx.expenseCents ?? 0;
  const income = tx.incomeCents ?? 0;
  if (expense !== 0) return Math.abs(expense);
  if (income !== 0) return Math.abs(income);
  return Math.max(tx.debitCents ?? 0, tx.creditCents ?? 0);
}

function isTransferFee(tx: RecentTransaction): boolean {
  return tx.linkedTxId != null && (
    /^transfer fee:/i.test(tx.description) ||
    /^admin fee for transfer #\d+/i.test(tx.notes ?? '')
  );
}

const sign = (kind: Kind) => (kind === 'expense' ? '-' : kind === 'income' ? '+' : '');
// Spending is the normal case, so only income gets a colour; red stays reserved for problems.
const amountTone = (kind: Kind) => (kind === 'income' ? 'text-[var(--color-success)]' : 'text-[var(--ref-on-surface)]');

export function ActivityPanel({ transactions, categories, compact, now, formatAmount, maskAmounts }: {
  transactions: readonly RecentTransaction[];
  categories: readonly { id: number; name: string }[];
  /** Phone layout: fewer rows. */
  compact: boolean;
  /** Ticking clock, so "Today" rolls over at midnight. */
  now: number;
  formatAmount: (cents: number) => string;
  maskAmounts: (text: string) => string;
}) {
  const visible = transactions.filter((transaction) => !isTransferFee(transaction)).slice(0, compact ? 4 : 8);
  const dateLabel = (tx: RecentTransaction) => relativeDay(tx.date, now) ?? formatDate(tx.date);
  const categoryName = (tx: RecentTransaction, kind: Kind) => (tx.categoryId == null ? undefined : categories.find((item) => item.id === tx.categoryId)?.name)
    ?? (kind === 'income' ? 'Income' : kind === 'neutral' ? 'Transfer or adjustment' : 'Unallocated');

  return (
    <div className={cn('dashboard-activity', panelCard)}>
      <PanelHeader title="Recent activity" subtitle="Latest recorded in this period" />
      <div className="mt-3 divide-y divide-[var(--color-border)]">
        {visible.length === 0 ? <p className="py-6 text-sm text-[var(--ref-on-surface-variant)]">No activity recorded in this period.</p> : visible.map((tx) => {
          const kind = classifyTx(tx);
          return <Link key={tx.id} to="/transactions" search={{ transactionId: String(tx.id) }} className="dashboard-activity-row -mx-2 flex items-start justify-between gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-[var(--ref-surface-container-low)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ref-primary)]">
            <div className="min-w-0"><p className="truncate text-sm font-semibold text-[var(--ref-on-surface)]">{maskAmounts(tx.description)}</p><p className="mt-1 truncate text-xs text-[var(--ref-on-surface-variant)]">{categoryName(tx, kind)} · {dateLabel(tx)}</p></div>
            <p className={cn('shrink-0 text-sm font-bold tabular-nums', amountTone(kind))}>{sign(kind)}{formatAmount(transactionAmount(tx))}</p>
          </Link>;
        })}
      </div>
      <PanelLink to="/transactions" className="mt-4">View all transactions</PanelLink>
    </div>
  );
}
