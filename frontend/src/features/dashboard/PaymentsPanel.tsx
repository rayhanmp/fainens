import { Link } from '@tanstack/react-router';
import { CalendarClock } from 'lucide-react';
import { cn, formatDate } from '../../lib/utils';
import type { PaymentRow } from './commitments';

const VISIBLE_ROWS = 5;

export function PaymentsPanel({ rows, total, isLoading, now, formatAmount, maskAmounts }: {
  rows: readonly PaymentRow[];
  total: number;
  isLoading: boolean;
  now: number;
  formatAmount: (cents: number) => string;
  maskAmounts: (text: string) => string;
}) {
  return (
    <section className="dashboard-payments" aria-label="Upcoming payments">
      <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-[var(--ref-outline)]">Due & upcoming</p><h2 className="mt-1 font-headline text-xl font-extrabold">Next payments</h2></div><CalendarClock className="h-5 w-5 shrink-0 text-[var(--ref-primary)]" aria-hidden /></div>
      <p className="mt-2 text-xs text-[var(--color-text-secondary)]">{isLoading ? 'Loading upcoming payments…' : rows.length ? `${formatAmount(total)} due in the next 30 days, including overdue items.` : 'No outstanding payments due in the next 30 days.'}</p>
      <div className="mt-4 divide-y divide-[var(--color-border)]">{rows.slice(0, VISIBLE_ROWS).map((item) => {
        const overdue = item.date < now;
        return <Link key={item.id} to={item.to} className="dashboard-payment-row flex items-center justify-between gap-3">
          <span className="min-w-0"><strong className="block truncate text-sm">{maskAmounts(item.name)}</strong><span className={cn('mt-1 block text-xs', overdue ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-secondary)]')}>{item.kind} · {formatDate(item.date)}{overdue ? ' · Overdue' : ''}</span></span>
          <strong className="shrink-0 text-sm tabular-nums">{formatAmount(item.amount)}</strong>
        </Link>;
      })}</div>
      {rows.length > VISIBLE_ROWS && <p className="mt-3 text-xs text-[var(--color-muted)]">Showing {VISIBLE_ROWS} of {rows.length} payments</p>}
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs font-bold text-[var(--ref-primary)]"><Link to="/subscriptions">Subscriptions →</Link><Link to="/paylater">Pay later →</Link><Link to="/loans">Loans →</Link></div>
    </section>
  );
}
