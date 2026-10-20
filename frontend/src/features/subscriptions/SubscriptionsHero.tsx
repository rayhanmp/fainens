import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { BalanceVisibilityToggle } from '../../components/ui/BalanceVisibilityToggle';
import { RenewalCalendar } from './RenewalCalendar';
import type { RenewalOccurrence, Subscription } from './queries';

type Upcoming = { subscription: Subscription; dueAt: number };

const SHARE_FILLS = [
  'var(--color-accent)',
  'color-mix(in srgb, var(--ref-on-surface) 55%, transparent)',
  'color-mix(in srgb, var(--ref-on-surface) 35%, transparent)',
  'color-mix(in srgb, var(--ref-on-surface) 22%, transparent)',
  'color-mix(in srgb, var(--ref-on-surface) 13%, transparent)',
];

/**
 * The page's headline: what subscriptions cost, said plainly, with where the month goes, beside a
 * renewal calendar. Same family as the Income page's cards (soft surface, accent card), its own
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
  // The three largest by cost per month, then the rest together: accent for the largest, ink tints
  // after it, the way the Income page splits gross pay.
  const shares = (() => {
    if (monthlyTotal <= 0) return [];
    const top = ranked.slice(0, ranked.length > 4 ? 3 : 4).map((item, index) => ({ key: String(item.id), label: item.name, amount: item.monthlyEquivalent, fill: SHARE_FILLS[index] }));
    const rest = ranked.slice(top.length).reduce((sum, item) => sum + item.monthlyEquivalent, 0);
    if (rest > 0) top.push({ key: 'rest', label: `${ranked.length - top.length} others`, amount: rest, fill: SHARE_FILLS[4] });
    return top.map((item) => ({ ...item, share: item.amount / monthlyTotal }));
  })();
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
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-[var(--ref-on-surface-variant)]">
            {renewing.length === 0 ? 'Add the services you pay for to see what they cost over a year.' : (
              <>
                About <span className="font-semibold text-[var(--ref-on-surface)]">{formatAmount(Math.round((monthlyTotal * 12) / 1000) * 1000)} a year</span> across {renewing.length} subscription{renewing.length === 1 ? '' : 's'}
                {biggest && renewing.length > 1 && <>. <span className="font-semibold text-[var(--ref-on-surface)]">{biggest.name}</span> is the biggest, {biggestShare}% of it</>}.
              </>
            )}
          </p>
          </div>

          {shares.length > 1 && (
            <div aria-label="Share of the monthly cost">
              <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden>
                {shares.map((share) => <div key={share.key} className="h-full" style={{ width: `${share.share * 100}%`, background: share.fill }} />)}
              </div>
              <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--ref-on-surface-variant)]">
                {shares.map((share) => (
                  <span key={share.key} className="flex min-w-0 items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: share.fill }} aria-hidden />
                    <span className="max-w-[12rem] truncate">{share.label}</span>
                    <span className="font-semibold tabular-nums text-[var(--ref-on-surface)]">{share.share < 0.01 ? '<1' : Math.round(share.share * 100)}%</span>
                  </span>
                ))}
              </p>
            </div>
          )}

          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
            {[
              { label: 'Next 30 days', value: formatAmount(next30), detail: `${upcoming.length} payment${upcoming.length === 1 ? '' : 's'}` },
              { label: `Paid in ${monthName}`, value: formatAmount(paidThisMonth), detail: 'From your ledger' },
              { label: 'Per day', value: formatAmount(Math.round((monthlyTotal * 12) / 365)), detail: 'Spread evenly' },
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
