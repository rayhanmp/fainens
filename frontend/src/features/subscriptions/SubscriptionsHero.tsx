import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { BalanceVisibilityToggle } from '../../components/ui/BalanceVisibilityToggle';
import { cn } from '../../lib/utils';
import { RenewalCalendar } from './RenewalCalendar';
import type { RenewalOccurrence, Subscription } from './queries';

type Upcoming = { subscription: Subscription; dueAt: number };

/**
 * The page's headline: what subscriptions cost a month, a year and a day, beside a renewal
 * calendar. Same family as the Income page's cards (soft surface, accent card), its own
 * arrangement. Past-due renewals are recorded or skipped from the calendar card.
 */
export function SubscriptionsHero({ loading, renewing, monthlyTotal, upcoming, paidThisMonth, overdue, truncated, now, busy, onRecord, onSkip, onResolveAll }: {
  loading: boolean;
  renewing: Subscription[];
  monthlyTotal: number;
  upcoming: Upcoming[];
  paidThisMonth: number;
  overdue: RenewalOccurrence[];
  truncated: boolean;
  now: number;
  busy: boolean;
  onRecord: (renewal: { subscriptionId: number; dueAt: number }) => void;
  onSkip: (occurrence: RenewalOccurrence) => void;
  onResolveAll: (action: 'post' | 'skip') => void;
}) {
  const { formatAmount } = useBalanceVisibility();
  if (loading) {
    return (
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]" aria-label="Loading subscription overview">
        <div className="h-[300px] animate-pulse rounded-3xl bg-[var(--ref-surface-container-low)]" />
        <div className="h-[300px] animate-pulse rounded-3xl bg-[var(--color-accent)]/30" />
      </div>
    );
  }
  const formatted = formatAmount(Math.round(monthlyTotal));
  const [prefix, digits] = formatted.startsWith('Rp') ? ['Rp', formatted.slice(2)] : ['', formatted];
  const ranked = [...renewing].sort((a, b) => b.monthlyEquivalent - a.monthlyEquivalent);
  const biggest = ranked[0];
  const biggestShare = biggest && monthlyTotal > 0 ? Math.round((biggest.monthlyEquivalent / monthlyTotal) * 100) : 0;
  const next30 = upcoming.reduce((sum, item) => sum + item.subscription.amount, 0);
  const monthName = new Date(now).toLocaleDateString('en-US', { month: 'short' });

  return (
    // Side by side only when the cost card has room for its three tiles.
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
      <section className="relative overflow-hidden rounded-3xl bg-[var(--ref-surface-container-low)] p-6 sm:p-8" aria-label="What subscriptions cost">
        <div className="pointer-events-none absolute -left-20 -top-28 h-72 w-72 rounded-full bg-[var(--color-accent)]/10 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-28 -right-16 h-64 w-64 rounded-full bg-[var(--color-accent)]/5 blur-3xl" aria-hidden />
        {/* Figures at the top, the three tiles at the foot: the card matches the calendar's height. */}
        <div className="relative flex h-full flex-col justify-between gap-6">
          <div>
          <div className="flex items-start justify-between gap-4">
            <p className="text-xs font-bold uppercase tracking-widest text-[var(--ref-on-surface-variant)]">Subscriptions cost you</p>
            <BalanceVisibilityToggle className="h-8 w-8" />
          </div>
          <p className="mt-3 flex flex-wrap items-baseline gap-x-2">
            {prefix && <span className="font-headline text-2xl font-bold text-[var(--color-accent)]">{prefix}</span>}
            <span className="font-headline text-5xl font-black tracking-tighter text-[var(--ref-on-surface)] tabular-nums sm:text-6xl">{digits}</span>
            <span className="text-base font-semibold text-[var(--ref-on-surface-variant)]">a month</span>
          </p>
          {renewing.length === 0 && <p className="mt-3 text-sm text-[var(--ref-on-surface-variant)]">Add the services you pay for to see what they cost over a year.</p>}
          </div>

          {/* The year and the day are figures in their own right, not a sentence. */}
          {renewing.length > 0 && (
            <dl className="grid grid-cols-3 divide-x divide-[var(--color-border)]">
              {[
                { label: 'Per year', value: formatAmount(Math.round(monthlyTotal * 12)) },
                { label: 'Per day', value: formatAmount(Math.round((monthlyTotal * 12) / 365)) },
                { label: 'Renewing', value: String(renewing.length) },
              ].map((item, index) => (
                <div key={item.label} className={cn('min-w-0', index > 0 && 'pl-4 sm:pl-6')}>
                  <dt className="text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]">{item.label}</dt>
                  <dd className="mt-1 truncate text-lg font-bold tabular-nums text-[var(--ref-on-surface)] sm:text-2xl">{item.value}</dd>
                </div>
              ))}
            </dl>
          )}

          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
            {[
              { label: 'Next 30 days', value: formatAmount(next30), detail: `${upcoming.length} payment${upcoming.length === 1 ? '' : 's'}` },
              { label: `Paid in ${monthName}`, value: formatAmount(paidThisMonth), detail: 'From your ledger' },
              ...(biggest ? [{ label: 'Biggest', value: biggest.name, detail: `${biggestShare}% of the total, ${formatAmount(biggest.monthlyEquivalent)}/mo` }] : []),
            ].map((item) => (
              // Phones: one row per figure, label left and value right; wider: three tiles.
              <div key={item.label} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 rounded-2xl bg-[var(--ref-surface-container-lowest)]/70 px-4 py-2.5 sm:block sm:py-3">
                <dt className="truncate text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]">{item.label}</dt>
                <dd className="truncate text-sm font-bold tabular-nums text-[var(--ref-on-surface)] sm:mt-1">{item.value}</dd>
                <dd className="col-span-2 truncate text-[11px] text-[var(--ref-on-surface-variant)]">{item.detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="relative overflow-hidden rounded-3xl bg-[var(--color-accent)] p-5 text-white sm:p-6" aria-label="Renewal calendar">
        <div className="pointer-events-none absolute inset-0 opacity-10" style={{ backgroundImage: 'repeating-linear-gradient(135deg, white 0 1px, transparent 1px 14px)' }} aria-hidden />
        <div className="relative mx-auto h-full max-w-[380px] xl:max-w-none">
          <RenewalCalendar subscriptions={renewing} overdue={overdue} truncated={truncated} now={now} busy={busy} onRecord={onRecord} onSkip={onSkip} onResolveAll={onResolveAll} />
        </div>
      </section>
    </div>
  );
}
