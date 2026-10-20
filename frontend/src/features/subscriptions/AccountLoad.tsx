import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn } from '../../lib/utils';
import type { PaymentAccount } from './accounts';
import type { RenewalOccurrence, Subscription } from './queries';

type Upcoming = { subscription: Subscription; dueAt: number };

/**
 * Each account that pays subscriptions: its balance as a bar, with what is due from it in the next
 * 30 days (past-due renewals included) laid over it. A due segment longer than the balance is the
 * shortfall. Cards and other liabilities have no balance to cover, so they show what they'll carry.
 */
export function AccountLoad({ accounts, accountNames, renewing, upcoming, overdue, windowDays }: {
  accounts: PaymentAccount[];
  accountNames: Map<number, string>;
  renewing: Subscription[];
  upcoming: Upcoming[];
  overdue: RenewalOccurrence[];
  windowDays: number;
}) {
  const { formatAmount } = useBalanceVisibility();
  const byAccount = new Map<number, { monthly: number; count: number; due: number }>();
  for (const subscription of renewing) {
    const entry = byAccount.get(subscription.linkedAccountId) ?? { monthly: 0, count: 0, due: 0 };
    entry.monthly += subscription.monthlyEquivalent;
    entry.count += 1;
    byAccount.set(subscription.linkedAccountId, entry);
  }
  for (const item of upcoming) {
    const entry = byAccount.get(item.subscription.linkedAccountId);
    if (entry) entry.due += item.subscription.amount;
  }
  for (const item of overdue) {
    const entry = byAccount.get(item.linkedAccountId);
    if (entry) entry.due += item.amount;
  }
  const rows = [...byAccount.entries()]
    .map(([id, entry]) => ({ id, ...entry, account: accounts.find((account) => account.id === id) ?? null, name: accountNames.get(id) ?? 'Unknown account' }))
    .sort((a, b) => b.due - a.due || b.monthly - a.monthly);

  if (rows.length === 0) return <p className="px-4 py-8 text-center text-sm text-[var(--ref-on-surface-variant)] sm:px-5">Accounts show here once a subscription renews from them.</p>;

  return (
    <ul className="divide-y divide-[var(--color-border)]">
      {rows.map((row) => {
        const balance = row.account?.type === 'asset' ? row.account.balance : null;
        const short = balance != null && row.due > balance ? row.due - balance : 0;
        const scale = Math.max(1, balance ?? 0, row.due);
        return (
          <li key={row.id} className="px-4 py-3.5 sm:px-5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 truncate text-sm font-medium text-[var(--ref-on-surface)]">{row.name}</p>
              <p className="shrink-0 text-xs tabular-nums text-[var(--ref-on-surface-variant)]">{formatAmount(Math.round(row.monthly))}/mo · {row.count} {row.count === 1 ? 'plan' : 'plans'}</p>
            </div>
            {balance != null ? (
              <>
                {/* The balance is the track; what's due sits on it from the left. */}
                <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-[var(--ref-surface-container-highest)]" aria-hidden>
                  <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--ref-primary)]/20" style={{ width: `${(Math.max(0, balance) / scale) * 100}%` }} />
                  <div className={cn('absolute inset-y-0 left-0 rounded-full', short > 0 ? 'bg-[var(--color-danger)]' : 'bg-[var(--ref-primary)]')} style={{ width: `${(row.due / scale) * 100}%` }} />
                </div>
                <p className={cn('mt-1.5 text-xs', short > 0 ? 'font-medium text-[var(--color-danger)]' : 'text-[var(--ref-on-surface-variant)]')}>
                  {row.due === 0
                    ? `Nothing due in ${windowDays} days · holds ${formatAmount(balance)}`
                    : short > 0
                      ? `Short by ${formatAmount(short)}: ${formatAmount(row.due)} due, holds ${formatAmount(balance)}`
                      : `${formatAmount(row.due)} due in ${windowDays} days · holds ${formatAmount(balance)}`}
                </p>
              </>
            ) : (
              <p className="mt-1.5 text-xs text-[var(--ref-on-surface-variant)]">{row.due > 0 ? `${formatAmount(row.due)} goes on it in the next ${windowDays} days` : `Nothing due in ${windowDays} days`}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
