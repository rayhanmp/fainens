import { useState, type ReactNode } from 'react';
import { SubscriptionsHero } from '../subscriptions/SubscriptionsHero';
import { AccountLoad } from '../subscriptions/AccountLoad';
import { ServiceMix } from '../subscriptions/ServiceMix';
import { PaymentTimeline } from '../subscriptions/PaymentTimeline';
import { Section } from '../subscriptions/PageParts';
import { upcomingRenewals } from '../subscriptions/schedule';
import type { RenewalOccurrence, Subscription } from '../subscriptions/queries';
import type { ServiceType } from '../subscriptions/service-types';
import { exampleAccounts, useHelpPersonal } from './personal';
import { VisualFrame } from './visuals';

/**
 * The Subscriptions page's own panels (the real components) on one set of example subscriptions:
 * the overview, Paid from beside What kind of services, and Payments by month. Clicks are held.
 */

function Inert({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className} onClickCapture={(event) => { event.preventDefault(); event.stopPropagation(); }}>{children}</div>;
}

const DAY = 86_400_000;
const atNoon = (ms: number) => { const date = new Date(ms); date.setHours(12, 0, 0, 0); return date.getTime(); };

type Example = { id: number; name: string; amount: number; days: number; account: 1 | 2; cycle?: 'monthly' | 'annual'; type: ServiceType; icon: string };

/** Netflix is four days past due; Spotify and iCloud renew this month; the domain once a year. */
const EXAMPLES: Example[] = [
  { id: 1, name: 'Netflix', amount: 186_000, days: -4, account: 1, type: 'video', icon: 'film' },
  { id: 2, name: 'Spotify Premium', amount: 64_990, days: 26, account: 1, type: 'music', icon: 'music' },
  { id: 3, name: 'iCloud+ 200 GB', amount: 49_000, days: 6, account: 2, type: 'cloud', icon: 'default' },
  { id: 4, name: 'Domain', amount: 278_405, days: 120, account: 1, cycle: 'annual', type: 'hosting', icon: 'sparkles' },
];

function useExampleSubscriptions() {
  const personal = useHelpPersonal();
  const { first, second } = exampleAccounts(personal);
  const [now] = useState(() => Date.now());
  const names = new Map([[1, first], [2, second]]);
  const subscriptions: Subscription[] = EXAMPLES.map((item) => {
    const next = atNoon(now + item.days * DAY);
    const annual = item.cycle === 'annual';
    return {
      id: item.id, name: item.name, amount: item.amount, billingCycle: annual ? 'annual' : 'monthly', intervalCount: 1,
      monthlyEquivalent: Math.round(annual ? item.amount / 12 : item.amount),
      nextRenewalAt: next, billingDay: new Date(next).getDate(), status: 'active', paymentMode: 'auto',
      linkedAccountId: item.account, linkedAccountName: names.get(item.account)!, linkedAccountType: 'asset', categoryId: null,
      trialEndsAt: null, endsAt: null, currency: null, foreignAmount: null, notes: null, serviceType: item.type, lastPayment: null,
      iconKey: item.icon, sortOrder: 0, createdAt: now - 400 * DAY, updatedAt: now,
    };
  });
  const overdue: RenewalOccurrence[] = [{ subscriptionId: 1, subscriptionName: 'Netflix', dueAt: subscriptions[0].nextRenewalAt, amount: 186_000, linkedAccountId: 1, billingCycle: 'monthly', intervalCount: 1, paymentMode: 'auto', currency: null, foreignAmount: null }];
  const upcoming = subscriptions
    .filter((item) => item.id !== 1)
    .flatMap((subscription) => upcomingRenewals(subscription, now, now + 30 * DAY).map((dueAt) => ({ subscription, dueAt })))
    .sort((a, b) => a.dueAt - b.dueAt);

  // A year of example charges: Netflix skipped once, iCloud started six months ago and voided once,
  // the domain renewed seven months ago.
  const today = new Date(now);
  const charges = Array.from({ length: 12 }, (_, index) => {
    const month = new Date(today.getFullYear(), today.getMonth() - 11 + index, 1);
    const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
    const ago = 11 - index;
    const items = [
      ...(ago >= 1 && ago !== 5 ? [{ subscriptionId: 1, amount: 186_000 }] : []),
      // Spotify renews in 26 days, so its last charge fell earlier this month.
      ...(ago >= 0 ? [{ subscriptionId: 2, amount: 64_990 }] : []),
      ...(ago >= 1 && ago <= 6 && ago !== 3 ? [{ subscriptionId: 3, amount: 49_000 }] : []),
      ...(ago === 7 ? [{ subscriptionId: 4, amount: 278_405 }] : []),
    ];
    return { month: key, total: items.reduce((sum, item) => sum + item.amount, 0), items };
  });
  const monthAgo = (months: number, day: number) => atNoon(new Date(today.getFullYear(), today.getMonth() - months, day).getTime());
  const unpaid = [
    { subscriptionId: 1, dueAt: monthAgo(5, new Date(subscriptions[0].nextRenewalAt).getDate()), kind: 'skipped' as const },
    { subscriptionId: 3, dueAt: monthAgo(3, new Date(subscriptions[2].nextRenewalAt).getDate()), kind: 'voided' as const },
  ];
  const accounts = [
    { id: 1, name: first, type: 'asset', balance: 1_850_000 },
    { id: 2, name: second, type: 'asset', balance: 32_000 },
  ];
  return { now, subscriptions, overdue, upcoming, charges, unpaid, accounts, accountNames: names };
}

export function SubscriptionsOverviewDemo() {
  const example = useExampleSubscriptions();
  const monthlyTotal = example.subscriptions.reduce((sum, item) => sum + item.monthlyEquivalent, 0);
  return (
    <VisualFrame caption="The top of the Subscriptions page, with example subscriptions: the cost a month and a year, this year’s running total, and the renewal calendar with Netflix four days past due.">
      <Inert>
        <SubscriptionsHero
          loading={false}
          renewing={example.subscriptions}
          monthlyTotal={monthlyTotal}
          upcoming={example.upcoming}
          charges={example.charges}
          overdue={example.overdue}
          truncated={false}
          now={example.now}
          busy={false}
          onRecord={() => undefined}
          onSkip={() => undefined}
          onResolveAll={() => undefined}
        />
      </Inert>
    </VisualFrame>
  );
}

export function SubscriptionsMoneyDemo() {
  const example = useExampleSubscriptions();
  const [selected, setSelected] = useState<ServiceType | null>(null);
  return (
    <VisualFrame caption="Paid from and What kind of services, with example figures: the second account can’t cover what’s due from it, and video is the biggest share. Choose a tile to try the filter.">
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Paid from" aside={<span className="text-xs text-[var(--ref-on-surface-variant)]">Due in 30 days</span>}>
          <AccountLoad accounts={example.accounts} accountNames={example.accountNames} renewing={example.subscriptions} upcoming={example.upcoming} overdue={example.overdue} windowDays={30} />
        </Section>
        <Section className="flex flex-col" title="What kind of services">
          <ServiceMix renewing={example.subscriptions} selected={selected} onSelect={setSelected} />
        </Section>
      </div>
    </VisualFrame>
  );
}

export function SubscriptionsTimelineDemo() {
  const example = useExampleSubscriptions();
  return (
    <VisualFrame caption="Payments by month, with example subscriptions: Netflix skipped once and is past due now, iCloud had one renewal voided, and the domain renews once a year. Hover any mark for its date and amount.">
      <Section title="Payments by month">
        <PaymentTimeline charges={example.charges} unpaid={example.unpaid} subscriptions={example.subscriptions} overdue={example.overdue} now={example.now} onOpen={() => undefined} />
      </Section>
    </VisualFrame>
  );
}
