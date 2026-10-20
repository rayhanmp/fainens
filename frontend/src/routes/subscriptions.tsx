import { createFileRoute } from '@tanstack/react-router';
import { AlertCircle, CalendarClock, Plus, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { RequireAuth } from '../lib/auth';
import { useBalanceVisibility } from '../hooks/useBalanceVisibility';
import { Button } from '../components/ui/Button';
import { PageContainer } from '../components/ui/PageContainer';
import { PageHeader } from '../components/ui/PageHeader';
import { SubscriptionsHero } from '../features/subscriptions/SubscriptionsHero';
import { MenuSelect } from '../components/ui/MenuSelect';
import { useConfirm } from '../components/ui/ConfirmDialog';
import { toast } from '../components/ui/useToast';
import { cn, formatDate, formatDayMonth } from '../lib/utils';
import { useResolveOccurrencesMutation, useSubscriptionsQuery, type RenewalOccurrence, type Subscription } from '../features/subscriptions/queries';
import { cycleLabel, cycleSuffix, DAY_MS, displayStatus, formatForeign, relativeDue, renews, startOfDay, upcomingRenewals, type DisplayStatus } from '../features/subscriptions/schedule';
import { SubscriptionEditor } from '../features/subscriptions/SubscriptionEditor';
import { PaymentDialog } from '../features/subscriptions/PaymentDialog';
import { StatusBadge, SubscriptionDetail } from '../features/subscriptions/SubscriptionDetail';
import { ListSkeleton, Section, SubscriptionIcon } from '../features/subscriptions/PageParts';
import type { PaymentAccount } from '../features/subscriptions/accounts';
import { PaymentTimeline } from '../features/subscriptions/PaymentTimeline';
import { AccountLoad } from '../features/subscriptions/AccountLoad';
import { ServiceMix } from '../features/subscriptions/ServiceMix';
import { serviceTypeLabel, serviceTypeOf, type ServiceType } from '../features/subscriptions/service-types';

export const Route = createFileRoute('/subscriptions')({
  component: SubscriptionsPage,
});

type Filter = 'active' | 'paused' | 'ended' | 'archived';
type Sort = 'next' | 'cost' | 'name';

const FILTERS: Array<{ value: Filter; label: string; matches: (status: DisplayStatus) => boolean }> = [
  { value: 'active', label: 'Active', matches: (status) => ['overdue', 'due-soon', 'trial', 'active', 'ending'].includes(status) },
  { value: 'paused', label: 'Paused', matches: (status) => status === 'paused' },
  { value: 'ended', label: 'Ended', matches: (status) => status === 'ended' },
  { value: 'archived', label: 'Archived', matches: (status) => status === 'archived' },
];

const SORTS = [
  { value: 'next', label: 'Next payment' },
  { value: 'cost', label: 'Cost per month' },
  { value: 'name', label: 'Name' },
] as const;

const UPCOMING_DAYS = 30;

const EMPTY_ACCOUNTS: PaymentAccount[] = [];
const EMPTY_CATEGORIES: Array<{ id: number; name: string }> = [];
const EMPTY_NAMES = new Map<number, string>();

function SubscriptionsPage() {
  const { formatAmount } = useBalanceVisibility();
  const { confirm } = useConfirm();
  const query = useSubscriptionsQuery();
  const resolve = useResolveOccurrencesMutation();
  const [filter, setFilter] = useState<Filter>('active');
  const [sort, setSort] = useState<Sort>('next');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<ServiceType | null>(null);
  const [editing, setEditing] = useState<Subscription | 'new' | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [paying, setPaying] = useState<{ subscriptionId: number; dueAt: number } | null>(null);

  const data = query.data;
  const subscriptions = useMemo(() => data?.subscriptions ?? [], [data]);
  const accounts = data?.accounts ?? EMPTY_ACCOUNTS;
  const categories = data?.categories ?? EMPTY_CATEGORIES;
  const accountNames = data?.accountNames ?? EMPTY_NAMES;
  // The day the page opened; windows and "in N days" labels count from it.
  const [now] = useState(() => Date.now());
  const occurrences = useMemo(() => data?.renewalPreview.occurrences ?? [], [data]);
  const byId = useMemo(() => new Map(subscriptions.map((subscription) => [subscription.id, subscription])), [subscriptions]);
  const overdueIds = useMemo(() => new Set(occurrences.map((occurrence) => occurrence.subscriptionId)), [occurrences]);
  const statusOf = useMemo(() => new Map(subscriptions.map((subscription) => [subscription.id, displayStatus(subscription, overdueIds)])), [subscriptions, overdueIds]);

  const notify = (message: string, tone: 'success' | 'error' = 'success') => (tone === 'success' ? toast.success(message) : toast.error(message));

  // Totals count what is still renewing: active, trials, and cancelled ones until their last day.
  const renewing = useMemo(() => subscriptions.filter((subscription) => subscription.status !== 'archived' && renews(subscription)), [subscriptions]);
  const monthlyTotal = renewing.reduce((sum, subscription) => sum + subscription.monthlyEquivalent, 0);
  const upcomingUntil = startOfDay(now) + (UPCOMING_DAYS + 1) * DAY_MS - 1;
  const upcoming = useMemo(() => renewing
    .flatMap((subscription) => (overdueIds.has(subscription.id) ? [] : upcomingRenewals(subscription, startOfDay(now), upcomingUntil)).map((dueAt) => ({ subscription, dueAt })))
    .sort((a, b) => a.dueAt - b.dueAt), [renewing, overdueIds, now, upcomingUntil]);
  const overdueTotal = occurrences.reduce((sum, occurrence) => sum + occurrence.amount, 0);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((option) => [option.value, subscriptions.filter((subscription) => option.matches(statusOf.get(subscription.id)!)).length])) as Record<Filter, number>, [subscriptions, statusOf]);
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matcher = FILTERS.find((option) => option.value === filter)!.matches;
    return subscriptions
      .filter((subscription) => matcher(statusOf.get(subscription.id)!))
      .filter((subscription) => !needle || subscription.name.toLowerCase().includes(needle) || (subscription.notes ?? '').toLowerCase().includes(needle))
      .filter((subscription) => !typeFilter || serviceTypeOf(subscription) === typeFilter)
      .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name)
        : sort === 'cost' ? b.monthlyEquivalent - a.monthlyEquivalent
        : a.nextRenewalAt - b.nextRenewalAt);
  }, [subscriptions, statusOf, filter, search, sort, typeFilter]);


  const resolveAll = async (action: 'post' | 'skip') => {
    const count = occurrences.length;
    const ok = await confirm({
      title: action === 'post' ? `Record ${count} renewal${count === 1 ? '' : 's'} as expected?` : `Skip ${count} renewal${count === 1 ? '' : 's'}?`,
      message: action === 'post'
        ? `Each is posted on its due date at its usual price and account, ${formatAmount(overdueTotal)} in all. If one was paid late, at another price, or is already in Transactions, record it on its own instead.`
        : 'Use this when nothing was charged. No transactions are created and the schedules carry on from their next date.',
      confirmLabel: action === 'post' ? 'Record all' : 'Skip all',
      variant: action === 'post' ? 'default' : 'danger',
    });
    if (!ok) return;
    try {
      const result = await resolve.mutateAsync(occurrences.map((occurrence) => ({ subscriptionId: occurrence.subscriptionId, dueAt: occurrence.dueAt, action })));
      notify(action === 'post' ? `Recorded ${result.posted} renewal${result.posted === 1 ? '' : 's'}.` : `Skipped ${result.skipped} renewal${result.skipped === 1 ? '' : 's'}.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not resolve the renewals', 'error');
    }
  };

  const skipOne = async (occurrence: RenewalOccurrence) => {
    const ok = await confirm({
      title: `Skip the ${formatDate(occurrence.dueAt)} renewal?`,
      message: `Nothing is posted for ${occurrence.subscriptionName} on this date. Use it when the renewal didn't charge you.`,
      confirmLabel: 'Skip renewal',
    });
    if (!ok) return;
    try {
      await resolve.mutateAsync([{ subscriptionId: occurrence.subscriptionId, dueAt: occurrence.dueAt, action: 'skip' }]);
      notify('Renewal skipped.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not skip the renewal', 'error');
    }
  };

  const loading = query.isPending && !data;
  const detail = detailId != null ? byId.get(detailId) ?? null : null;
  const payingSubscription = paying ? byId.get(paying.subscriptionId) ?? null : null;

  return (
    <RequireAuth>
      <PageContainer className="px-4 pt-6 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <PageHeader subtext="Recurring bills" title="Subscriptions" description="What renews, when, and what it actually charged." />
          <Button type="button" className="rounded-full" onClick={() => setEditing('new')}>
            <Plus className="mr-1.5 inline h-4 w-4" aria-hidden />Add subscription
          </Button>
        </div>

        <SubscriptionsHero
          loading={loading}
          renewing={renewing}
          monthlyTotal={monthlyTotal}
          upcoming={upcoming}
          charges={data?.monthlyCharges ?? []}
          overdue={occurrences}
          truncated={data?.renewalPreview.truncated ?? false}
          now={now}
          busy={resolve.isPending}
          onRecord={setPaying}
          onSkip={(occurrence) => void skipOne(occurrence)}
          onResolveAll={(action) => void resolveAll(action)}
        />

        {query.error && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/5 px-4 py-3 text-sm text-[var(--color-danger)]">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">{query.error instanceof Error ? query.error.message : "We couldn't load your subscriptions."}</span>
            <Button type="button" size="sm" variant="secondary" onClick={() => void query.refetch()}>Retry</Button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
          <Section
            title="Your subscriptions"
            aside={
              <div role="tablist" aria-label="Show" className="flex flex-wrap gap-1">
                {FILTERS.map((option) => (
                  <button key={option.value} type="button" role="tab" aria-selected={filter === option.value} onClick={() => setFilter(option.value)}
                    className={cn('rounded-full px-3 py-1 text-xs font-semibold transition-colors', filter === option.value ? 'bg-[var(--ref-surface-container-high)] text-[var(--ref-on-surface)]' : 'text-[var(--ref-on-surface-variant)] hover:text-[var(--ref-on-surface)]')}>
                    {option.label}{counts[option.value] > 0 && <span className="ml-1 tabular-nums opacity-70">{counts[option.value]}</span>}
                  </button>
                ))}
              </div>
            }
          >
            {subscriptions.length > 0 && (
              <div className="settings-compact flex gap-2 border-b border-[var(--color-border)] px-4 py-2.5 sm:px-5">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]" aria-hidden />
                  <input type="search" aria-label="Search subscriptions" className="brutalist-input !pl-9" placeholder="Search" value={search} onChange={(event) => setSearch(event.target.value)} />
                </div>
                <MenuSelect ariaLabel="Sort by" variant="field" className="w-40 shrink-0" value={sort} options={SORTS} onChange={setSort} />
              </div>
            )}
            {typeFilter && (
              <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-2 text-xs text-[var(--ref-on-surface-variant)] sm:px-5">
                Type:
                <button type="button" onClick={() => setTypeFilter(null)} className="inline-flex items-center gap-1 rounded-full bg-[var(--ref-primary)]/12 px-2.5 py-0.5 font-semibold text-[var(--ref-primary)] hover:bg-[var(--ref-primary)]/20" aria-label={`Clear the ${serviceTypeLabel(typeFilter)} filter`}>
                  {serviceTypeLabel(typeFilter)} <X className="h-3 w-3" aria-hidden />
                </button>
              </div>
            )}
            {loading ? <ListSkeleton /> : subscriptions.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
                <CalendarClock className="h-8 w-8 text-[var(--color-muted)]" aria-hidden />
                <div>
                  <p className="font-semibold text-[var(--ref-on-surface)]">No subscriptions yet</p>
                  <p className="mt-1 max-w-sm text-sm text-[var(--ref-on-surface-variant)]">Add streaming, cloud storage, phone plans or memberships to see what renews when, and record each charge in your ledger.</p>
                </div>
                <Button type="button" size="sm" onClick={() => setEditing('new')}>Add your first subscription</Button>
              </div>
            ) : visible.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-[var(--ref-on-surface-variant)] sm:px-5">{search ? `Nothing matches “${search}”.` : `No ${FILTERS.find((option) => option.value === filter)!.label.toLowerCase()} subscriptions.`}</p>
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {visible.map((subscription) => {
                  const status = statusOf.get(subscription.id)!;
                  const meta = [cycleLabel(subscription), accountNames.get(subscription.linkedAccountId) ?? subscription.linkedAccountName, subscription.paymentMode === 'manual' ? 'Paid manually' : null].filter(Boolean).join(' · ');
                  const when = status === 'paused' ? 'Paused'
                    : status === 'archived' ? 'Archived'
                    : status === 'ended' ? (subscription.endsAt ? `Ended ${formatDate(subscription.endsAt)}` : 'Ended')
                    : status === 'trial' && subscription.trialEndsAt ? `Trial ends ${formatDayMonth(subscription.trialEndsAt)}`
                    : `${formatDayMonth(subscription.nextRenewalAt)} · ${relativeDue(subscription.nextRenewalAt)}`;
                  const pastDue = occurrences.find((occurrence) => occurrence.subscriptionId === subscription.id);
                  const whenText = pastDue ? `Past due ${formatDayMonth(pastDue.dueAt)}` : when;
                  const price = subscription.currency && subscription.foreignAmount != null ? formatForeign(subscription.foreignAmount, subscription.currency) : formatAmount(subscription.amount);
                  // A row says two things: what it costs, and what happens next.
                  return (
                    <li key={subscription.id}>
                      <button type="button" onClick={() => setDetailId(subscription.id)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--ref-surface-container-low)] sm:px-5">
                        <SubscriptionIcon iconKey={subscription.iconKey} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-[var(--ref-on-surface)]">{subscription.name}</span>
                            {(status === 'trial' || status === 'ending') && <StatusBadge status={status} />}
                          </span>
                          <span className="block truncate text-xs text-[var(--ref-on-surface-variant)]">{meta}</span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-sm font-semibold tabular-nums text-[var(--ref-on-surface)]">
                            {price}<span className="text-xs font-normal text-[var(--ref-on-surface-variant)]">{cycleSuffix(subscription)}</span>
                          </span>
                          <span className={cn('block text-xs', pastDue ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-[var(--ref-on-surface-variant)]')}>{whenText}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <div className="grid gap-6">
            <Section title="Paid from" aside={<span className="text-xs text-[var(--ref-on-surface-variant)]">Due in {UPCOMING_DAYS} days against each balance</span>}>
              {loading ? <ListSkeleton rows={2} /> : (
                <AccountLoad accounts={accounts} accountNames={accountNames} renewing={renewing} upcoming={upcoming} overdue={occurrences} windowDays={UPCOMING_DAYS} />
              )}
            </Section>
            <Section title="What kind of services" aside={<span className="text-xs text-[var(--ref-on-surface-variant)]">Share of the monthly cost</span>}>
              {loading ? <ListSkeleton rows={2} /> : <ServiceMix renewing={renewing} selected={typeFilter} onSelect={setTypeFilter} />}
            </Section>
          </div>
        </div>

        {/* Analysis sits last: the lists above are what needs doing. */}
        <Section title="Payments by month" aside={<span className="text-xs text-[var(--ref-on-surface-variant)]">Paid so far, and the next 6 months</span>}>
          {loading ? <ListSkeleton rows={4} /> : (
            <PaymentTimeline charges={data?.monthlyCharges ?? []} unpaid={data?.unpaidRenewals ?? []} subscriptions={subscriptions} overdue={occurrences} now={now} onOpen={setDetailId} />
          )}
        </Section>
      </PageContainer>

      {editing && (
        <SubscriptionEditor
          subscription={editing === 'new' ? null : editing}
          accounts={accounts}
          categories={categories}
          accountNames={accountNames}
          onClose={() => setEditing(null)}
          onSaved={(message) => { setEditing(null); notify(message); }}
        />
      )}
      {detail && (
        <SubscriptionDetail
          subscription={detail}
          overdue={occurrences}
          accounts={accounts}
          accountNames={accountNames}
          categories={categories}
          onClose={() => setDetailId(null)}
          onEdit={() => setEditing(detail)}
          onRecord={(dueAt) => setPaying({ subscriptionId: detail.id, dueAt })}
          onSkip={(occurrence) => void skipOne(occurrence)}
          onMessage={notify}
        />
      )}
      {paying && payingSubscription && (
        <PaymentDialog
          key={`${paying.subscriptionId}-${paying.dueAt}`}
          subscription={payingSubscription}
          dueAt={paying.dueAt}
          accounts={accounts}
          onClose={() => setPaying(null)}
          onDone={(message) => { setPaying(null); notify(message); }}
        />
      )}
    </RequireAuth>
  );
}
