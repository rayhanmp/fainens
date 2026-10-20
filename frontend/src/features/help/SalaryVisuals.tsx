import { useState, type ReactNode } from 'react';
import { TakeHomeCard } from '../salary/SalaryCards';
import { takeHomeBreakdown } from '../salary/income-insights';
import { SubscriptionsHero } from '../subscriptions/SubscriptionsHero';
import type { Subscription } from '../subscriptions/queries';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { exampleAccounts, useHelpPersonal } from './personal';
import { VisualFrame } from './visuals';

/**
 * Income & salary’s take-home card and the Subscriptions page’s overview (the real components,
 * with example figures). Clicks are held.
 */

function Inert({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className} onClickCapture={(event) => { event.preventDefault(); event.stopPropagation(); }}>{children}</div>;
}

/** Example monthly figures for a TK/0 employee on Rp15.000.000 gross. */
const EXAMPLE = { grossMonthly: 15_000_000, pph21Monthly: 1_050_000, jhtMonthly: 300_000, jpMonthly: 105_474, bpjsKesehatanMonthly: 120_000 };
const NET = EXAMPLE.grossMonthly - EXAMPLE.pph21Monthly - EXAMPLE.jhtMonthly - EXAMPLE.jpMonthly - EXAMPLE.bpjsKesehatanMonthly;

/** An example subscription renewing `days` from today. */
function exampleSubscription(id: number, name: string, amount: number, days: number, now: number, accountName: string, billingCycle: 'monthly' | 'annual' = 'monthly'): Subscription {
  const next = new Date(now);
  next.setDate(next.getDate() + days);
  next.setHours(12, 0, 0, 0);
  return {
    id, name, amount, billingCycle, intervalCount: 1,
    monthlyEquivalent: Math.round(billingCycle === 'annual' ? amount / 12 : amount),
    nextRenewalAt: next.getTime(), billingDay: next.getDate(), status: 'active', paymentMode: 'auto',
    linkedAccountId: 0, linkedAccountName: accountName, linkedAccountType: 'asset', categoryId: null,
    trialEndsAt: null, endsAt: null, currency: null, foreignAmount: null, notes: null, lastPayment: null,
    iconKey: 'default', sortOrder: 0, createdAt: now - 400 * 86_400_000, updatedAt: now,
  };
}

export function SalaryAndRenewalDemo() {
  const { formatAmount } = useBalanceVisibility();
  const { first } = exampleAccounts(useHelpPersonal());
  const segments = takeHomeBreakdown({ ...EXAMPLE, estimatedNetMonthly: NET });
  const [now] = useState(() => Date.now());
  const examples = [
    exampleSubscription(1, 'Netflix', 186_000, -4, now, first),
    exampleSubscription(2, 'Spotify', 64_990, 26, now, first),
    exampleSubscription(3, 'iCloud Storage', 15_000, 6, now, first),
    exampleSubscription(4, 'Domain', 278_405, 120, now, first, 'annual'),
  ];
  // Twelve months of example charges, this month last: the three monthly plans, and the domain once.
  const exampleCharges = Array.from({ length: 12 }, (_, index) => {
    const month = new Date(now);
    month.setDate(1);
    month.setMonth(month.getMonth() - 11 + index);
    const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
    return { month: key, total: index === 11 ? 64_990 : 265_990 + (index === 6 ? 278_405 : 0) };
  });

  return (
    <VisualFrame caption="The Income & salary page’s take-home card and the Subscriptions overview, with example figures: a month’s cost, the year it adds up to, and this month’s renewal days, one of them past due.">
      <Inert className="grid gap-5">
        <TakeHomeCard
          gross={EXAMPLE.grossMonthly}
          net={NET}
          segments={segments}
          method="TER"
          notes={['Example figures for a TK/0 employee.']}
          depositAccountName={first}
          payrollDay={25}
          ptkpCode="TK/0"
          ptkpAnnual={54_000_000}
          employerContribution={561_000}
          formatAmount={formatAmount}
          onEditProfile={() => undefined}
        />
        <SubscriptionsHero
          loading={false}
          renewing={examples}
          monthlyTotal={examples.reduce((sum, item) => sum + item.monthlyEquivalent, 0)}
          upcoming={examples.filter((item) => item.id !== 1).map((item) => ({ subscription: item, dueAt: item.nextRenewalAt })).sort((a, b) => a.dueAt - b.dueAt)}
          charges={exampleCharges}
          overdue={[{ subscriptionId: 1, subscriptionName: 'Netflix', dueAt: examples[0].nextRenewalAt, amount: 186_000, linkedAccountId: 0, billingCycle: 'monthly', intervalCount: 1, paymentMode: 'auto', currency: null, foreignAmount: null }]}
          truncated={false}
          now={now}
          busy={false}
          onRecord={() => undefined}
          onSkip={() => undefined}
          onResolveAll={() => undefined}
        />
      </Inert>
    </VisualFrame>
  );
}
