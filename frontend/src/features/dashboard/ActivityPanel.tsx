import { Link } from '@tanstack/react-router';
import { ArrowRight, ReceiptText } from 'lucide-react';
import { cn, formatDate } from '../../lib/utils';

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
const amountTone = (kind: Kind, neutral: string) => (kind === 'expense' ? 'text-[var(--color-danger)]' : kind === 'income' ? 'text-[var(--color-success)]' : neutral);

export function ActivityPanel({ transactions, categories, compact, formatAmount, maskAmounts }: {
  transactions: readonly RecentTransaction[];
  categories: readonly { id: number; name: string }[];
  /** Phone layout: fewer rows, each linking to the transaction. */
  compact: boolean;
  formatAmount: (cents: number) => string;
  maskAmounts: (text: string) => string;
}) {
  const visible = transactions.filter((transaction) => !isTransferFee(transaction));
  const categoryName = (tx: RecentTransaction) => (tx.categoryId == null ? undefined : categories.find((item) => item.id === tx.categoryId)?.name);

  if (compact) {
    return (
      <div className="dashboard-activity rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-4">
        <div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]">Recent activity</p><h2 className="font-headline text-lg font-extrabold">Latest recorded</h2></div><Link to="/transactions" className="rounded-full px-3 py-2 text-xs font-bold text-[var(--ref-primary)]">See all</Link></div>
        <div className="mt-2 divide-y divide-[var(--color-border)]">
          {visible.length === 0 ? <p className="py-6 text-sm text-[var(--ref-on-surface-variant)]">No activity in this period.</p> : visible.slice(0, 4).map((tx) => {
            const kind = classifyTx(tx);
            return <Link key={tx.id} to="/transactions" search={{ transactionId: String(tx.id) }} className="dashboard-activity-row flex items-center justify-between gap-3 py-3">
              <span className="min-w-0"><strong className="block truncate text-sm">{maskAmounts(tx.description)}</strong><span className="mt-0.5 block truncate text-xs text-[var(--ref-on-surface-variant)]">{categoryName(tx) ?? (kind === 'income' ? 'Income' : 'Unallocated')} · {formatDate(tx.date)}</span></span>
              <strong className={cn('shrink-0 text-sm tabular-nums', amountTone(kind, ''))}>{sign(kind)}{formatAmount(transactionAmount(tx))}</strong>
            </Link>;
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-activity rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-6 shadow-sm">
      <div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-widest text-[var(--ref-outline)]">Recent activity</p><h2 className="mt-1 font-headline text-xl font-extrabold text-[var(--ref-on-surface)]">Latest recorded</h2></div><ReceiptText className="h-5 w-5 text-[var(--ref-primary)]" /></div>
      <div className="mt-5 divide-y divide-[var(--color-border)]">
        {visible.length === 0 ? <p className="py-6 text-sm text-[var(--ref-on-surface-variant)]">No active transactions in this period.</p> : visible.slice(0, 8).map((tx) => {
          const kind = classifyTx(tx);
          return <div key={tx.id} className="dashboard-activity-row py-3 first:pt-0"><div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><p className="truncate font-semibold text-[var(--ref-on-surface)]">{maskAmounts(tx.description)}</p><p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">{categoryName(tx) ?? (kind === 'income' ? 'Income' : kind === 'neutral' ? 'Transfer or adjustment' : 'Unallocated')} · {formatDate(tx.date)}</p></div>
            <p className={cn('shrink-0 font-mono text-sm font-bold', amountTone(kind, 'text-[var(--ref-on-surface)]'))}>{sign(kind)}{formatAmount(transactionAmount(tx))}</p>
          </div></div>;
        })}
      </div>
      <Link to="/transactions" className="mt-5 inline-flex items-center gap-1 text-sm font-bold text-[var(--ref-primary)] hover:underline">Open transactions <ArrowRight className="h-4 w-4" /></Link>
    </div>
  );
}
