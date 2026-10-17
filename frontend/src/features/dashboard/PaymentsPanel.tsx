import { Link } from '@tanstack/react-router';
import { cn, formatDate } from '../../lib/utils';
import type { PaymentRow } from './commitments';
import { PanelHeader, PanelLink } from './PanelParts';
import { panelCard } from './panel-styles';

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
    <section className={cn('dashboard-payments', panelCard)} aria-label="Upcoming payments">
      <PanelHeader
        title="Upcoming payments"
        subtitle={isLoading ? 'Loading upcoming payments…' : rows.length ? `${formatAmount(total)} due in the next 30 days, including overdue items.` : 'No outstanding payments due in the next 30 days.'}
      />
      <div className="mt-3 divide-y divide-[var(--color-border)]">{rows.slice(0, VISIBLE_ROWS).map((item) => {
        const overdue = item.date < now;
        return <Link key={item.id} to={item.to} className="dashboard-payment-row -mx-2 flex items-start justify-between gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-[var(--ref-surface-container-low)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ref-primary)]">
          <span className="min-w-0"><span className="block truncate text-sm font-semibold text-[var(--ref-on-surface)]">{maskAmounts(item.name)}</span><span className={cn('mt-1 block truncate text-xs', overdue ? 'text-[var(--color-danger)]' : 'text-[var(--ref-on-surface-variant)]')}>{item.kind} · {formatDate(item.date)}{overdue ? ' · Overdue' : ''}</span></span>
          <span className="shrink-0 text-sm font-bold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(item.amount)}</span>
        </Link>;
      })}</div>
      {rows.length > VISIBLE_ROWS && <p className="mt-3 text-xs text-[var(--ref-on-surface-variant)]">Showing {VISIBLE_ROWS} of {rows.length} payments</p>}
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2"><PanelLink to="/subscriptions">Subscriptions</PanelLink><PanelLink to="/paylater">PayLater</PanelLink><PanelLink to="/loans">Loans</PanelLink></div>
    </section>
  );
}
