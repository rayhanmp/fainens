import { useMemo, useState, type ReactNode } from 'react';
import { ActivityPanel, type RecentTransaction } from '../dashboard/ActivityPanel';
import { BudgetPanel } from '../dashboard/BudgetPanel';
import type { PaymentRow, UpcomingCommitments } from '../dashboard/commitments';
import { DashboardHero, type BalanceMetrics, type BudgetPace } from '../dashboard/DashboardHero';
import { DashboardSections } from '../dashboard/DashboardSections';
import { heroCopy } from '../dashboard/hero-copy';
import type { PeriodPacing } from '../dashboard/pacing';
import { PaymentsPanel } from '../dashboard/PaymentsPanel';
import { PulsePanel } from '../dashboard/PulsePanel';
import { defaultPulseMetrics, type PulseInputs, type PulseMetricId } from '../dashboard/pulse-metrics';
import { dashboardPreset, type DashboardSection } from '../dashboard/view-preferences';
import '../dashboard/dashboard.css';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { HIDDEN_BALANCE, maskCurrencyAmounts } from '../../lib/balance-visibility';
import type { BudgetOutlook, BudgetPlan } from '../../lib/api';
import { cn, formatCurrency } from '../../lib/utils';
import { useAutoplay, useSequence } from './motion';
import { useHelpPersonal } from './personal';
import { VisualFrame } from './visuals';

/**
 * The Dashboard, assembled from its real components with sample numbers: the hero, Financial
 * pulse, Budget health, Upcoming payments and Recent activity. Clicks that would leave the page or
 * change anything are held; hover tips and the pulse’s metric picker still work.
 */

const DAY = 86_400_000;
const PACING: PeriodPacing = { dayIndex: 18, totalDays: 30, elapsedRatio: 0.6, status: 'active' };

function useSampleDashboard(hidden: boolean) {
  const personal = useHelpPersonal();
  const [now] = useState(() => Date.now());
  const formatAmount = (value: number) => (hidden ? HIDDEN_BALANCE : formatCurrency(value));
  const maskAmounts = (text: string) => (hidden ? maskCurrencyAmounts(text) : text);

  const rows: PaymentRow[] = [
    { id: 's1', name: 'Netflix', amount: 186_000, date: now + 2 * DAY, kind: 'Subscription', to: '/subscriptions' },
    { id: 'p1', name: 'Headphones', amount: 211_000, date: now + 6 * DAY, kind: 'PayLater', to: '/paylater' },
    { id: 'l1', name: 'Ani', amount: 300_000, date: now + 9 * DAY, kind: 'Loan repayment', to: '/loans' },
  ];
  const commitments: UpcomingCommitments = {
    subscriptions: [{ id: 1, name: 'Netflix', amount: 186_000, status: 'active', nextRenewalAt: now + 2 * DAY }],
    payLater: [{ recognitionTxId: 1, description: 'Headphones', outstandingCents: 211_000, dueDateMs: now + 6 * DAY, status: 'active' }],
    loans: [{ id: 1, direction: 'borrowed', status: 'active', remainingCents: 300_000, dueDate: now + 9 * DAY, isOverdue: false, contact: { name: 'Ani' } }],
    subscriptionTotal: 186_000,
    payLaterTotal: 211_000,
    loanTotal: 300_000,
    total: 697_000,
    count: 3,
    rows,
  };
  const metrics: BalanceMetrics = {
    cash: { label: 'Available cash', value: formatAmount(6_197_500), to: '/accounts' },
    budget: { label: 'Budget left', value: formatAmount(1_530_000), to: '/budget' },
    netWorth: { label: 'Net worth', value: formatAmount(17_279_500), to: '/accounts' },
  };
  const budgetPace: BudgetPace = { pacing: PACING, usedRatio: 0.48, dailyBudget: 117_000, daysRemaining: 13 };
  const copy = heroCopy({ budgetOverrun: null, periodName: 'October', periodEnded: false, netWorthChangePercent: 4.2, upcomingCommitmentTotal: commitments.total }, formatAmount);

  const pulseInputs: PulseInputs = {
    isTracked: true, incomeCents: 10_450_000, spentCents: 2_660_000, transactionCount: 46,
    topCategory: { name: 'Food & Dining', spentCents: 1_150_000 }, burnRate: 4_100_000,
    runway: { isUnbounded: false, runwayMonths: 4.2 }, netWorth: 17_279_500, liabilities: 1_662_000,
    upcoming: { total: commitments.total, count: commitments.count },
    budget: { planned: 3_500_000, actual: 2_660_000, dailyBudget: 117_000, daysRemaining: 13 },
    pacing: PACING, isAnalyticsLoading: false, isPeriodLoading: false,
    previousPeriod: { name: 'September', spentToDateCents: 2_890_000, dayIndex: 18 },
    netWorthChange: { amount: 700_000, percent: 4.2 },
    owedToYou: { total: 200_000, count: 1 }, reimbursements: { total: 150_000, count: 1 },
    subscriptions: { monthlyCents: 386_000, count: 3 }, pendingCount: 2,
  };

  const recent: RecentTransaction[] = [
    { id: 1, date: now - 2 * 3_600_000, description: 'Kopi susu', categoryId: 1, expenseCents: 25_000 },
    { id: 2, date: now - 5 * 3_600_000, description: 'Grab to office', categoryId: 2, expenseCents: 32_000 },
    { id: 3, date: now - DAY, description: 'Salary', incomeCents: 10_000_000 },
    { id: 4, date: now - 2 * DAY, description: 'Groceries at Superindo', categoryId: 3, expenseCents: 214_000 },
  ];
  const categories = [{ id: 1, name: 'Food & Dining', color: '#f97316' }, { id: 2, name: 'Transportation', color: '#0ea5e9' }, { id: 3, name: 'Groceries', color: '#22c55e' }];

  return { personal, now, formatAmount, maskAmounts, rows, commitments, metrics, budgetPace, copy, pulseInputs, recent, categories };
}

function sampleOutlook(): { outlook: BudgetOutlook; plans: BudgetPlan[] } {
  const lines = [
    { id: 1, name: 'Food & Dining', planned: 1_500_000, actual: 1_150_000, projected: 1_640_000 },
    { id: 2, name: 'Transportation', planned: 600_000, actual: 540_000, projected: 760_000 },
    { id: 3, name: 'Shopping', planned: 700_000, actual: 820_000, projected: 860_000 },
    { id: 4, name: 'Groceries', planned: 700_000, actual: 150_000, projected: 520_000 },
  ];
  const total = (key: 'planned' | 'actual' | 'projected') => lines.reduce((sum, line) => sum + line[key], 0);
  const risk = (line: (typeof lines)[number]) => (line.actual > line.planned ? 'over_budget' : line.projected > line.planned ? 'at_risk' : 'within_budget') as BudgetOutlook['total']['riskStatus'];
  return {
    outlook: {
      periodId: 1, asOfMs: 0, totalDays: 30, daysElapsed: 18, daysRemaining: 12, eligiblePeriodCount: 4, confidence: 'moderate', method: 'completed_cycle_median',
      patternReview: { applied: false, categoryCount: 0, evidenceRevision: 0 },
      total: { plannedAmount: total('planned'), actualAmount: total('actual'), remainingAmount: total('planned') - total('actual'), scheduledRemainingAmount: 186_000, projectedAmount: total('projected'), projectedLowAmount: total('projected') - 250_000, projectedHighAmount: total('projected') + 250_000, riskStatus: 'at_risk' },
      categories: lines.map((line) => ({ categoryId: line.id, categoryName: line.name, plannedAmount: line.planned, actualAmount: line.actual, remainingAmount: line.planned - line.actual, scheduledRemainingAmount: 0, historicalRemainingAmount: line.projected - line.actual, projectedAmount: line.projected, projectedLowAmount: line.projected - 60_000, projectedHighAmount: line.projected + 60_000, riskStatus: risk(line), historicalSampleCount: 4, outlierCount: 0, evidencePeriodIds: [], historicalSampleAmounts: [], patternReview: null })),
    },
    plans: lines.map((line) => ({ id: line.id, periodId: 1, categoryId: line.id, plannedAmount: line.planned, actualAmount: line.actual, variance: line.planned - line.actual, percentUsed: Math.round((line.actual / line.planned) * 100), categoryName: line.name, note: null })),
  };
}

/** Holds clicks so links and buttons in the real components don’t act; hovering still works. */
function Inert({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className} onClickCapture={(event) => { event.preventDefault(); event.stopPropagation(); }}>{children}</div>;
}

const REGIONS: Array<{ id: string; title: string; body: string }> = [
  { id: 'hero', title: 'At a glance', body: 'A greeting, a one-line read of where you stand, and one headline number you choose: cash, budget left or net worth. Beside it, how far through the period you are against how much budget is used, a safe daily pace, and what’s due soon.' },
  { id: 'pulse', title: 'Financial pulse', body: 'Two to six numbers you choose from 21. Click a label to swap it; Edit adds, removes and reorders them. (Try it here; it only changes this sample.)' },
  { id: 'budget', title: 'Budget health', body: 'Each budgeted category as a tile sized by its plan, filled by what’s spent, with a mark where it’s likely to finish.' },
  { id: 'payments', title: 'Upcoming payments', body: 'Subscriptions, pay-later installments and loan repayments coming due, soonest first.' },
  { id: 'activity', title: 'Recent activity', body: 'Your latest transactions, with their categories.' },
];

/** The Dashboard with sample numbers; each part lights up in turn (or when you point at it) with what it does. */
export function SampleDashboardDemo() {
  // Follows your hide-balances setting, as the real Dashboard does.
  const { balancesHidden } = useBalanceVisibility();
  const data = useSampleDashboard(balancesHidden);
  const { outlook, plans } = useMemo(() => sampleOutlook(), []);
  const [pulse, setPulse] = useState<PulseMetricId[]>(defaultPulseMetrics);
  const { ref, index, setIndex, setPaused } = useAutoplay(REGIONS.length, 3200);
  const active = REGIONS[index]!;
  const preferences = useMemo(() => ({ ...dashboardPreset('original'), hiddenSections: ['netWorth', 'spending'] as DashboardSection[] }), []);
  const region = (id: string, node: ReactNode, inert = true) => {
    const position = REGIONS.findIndex((item) => item.id === id);
    const content = inert ? <Inert>{node}</Inert> : node;
    return (
      <div onMouseEnter={() => setIndex(position)} className={cn('rounded-[1.6rem] transition-[box-shadow,opacity] duration-300', position === index ? 'ring-4 ring-[var(--color-accent)]/45 ring-offset-4 ring-offset-[var(--color-background)]' : 'opacity-75')}>{content}</div>
    );
  };

  const sections: Record<DashboardSection, ReactNode> = {
    pulse: region('pulse', <PulsePanel metrics={pulse} onChangeMetrics={setPulse} inputs={data.pulseInputs} formatAmount={data.formatAmount} />, false),
    budget: region('budget', <BudgetPanel periodId={1} coverageStatus="complete" isLoading={false} isTracked outlook={outlook} budgetRows={plans} spending={[]} totalPlanned={3_500_000} remaining={840_000} dailyBudget={117_000} formatAmount={data.formatAmount} />),
    payments: region('payments', <PaymentsPanel rows={data.rows} total={data.commitments.total} isLoading={false} now={data.now} formatAmount={data.formatAmount} maskAmounts={data.maskAmounts} />),
    activity: region('activity', <ActivityPanel transactions={data.recent} categories={data.categories} compact={false} now={data.now} formatAmount={data.formatAmount} maskAmounts={data.maskAmounts} />),
    netWorth: null,
    spending: null,
  };

  return (
    <VisualFrame frameRef={ref} caption="Your Dashboard’s own components with sample numbers. Point at a part to see what it does.">
      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_16rem]" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        <div className="dashboard-page space-y-4 rounded-2xl bg-[var(--color-background)] p-3 sm:p-4">
          {region('hero', <DashboardHero greeting={`Good evening${data.personal.name ? `, ${data.personal.name}` : ''}`} copy={data.copy} mainMetric="cash" metrics={data.metrics} budgetPace={data.budgetPace} commitments={data.commitments} isCommitmentsLoading={false} formatAmount={data.formatAmount} onAddTransaction={() => undefined} onViewReport={() => undefined} />)}
          <DashboardSections preferences={preferences} sections={sections} editing={false} onChange={() => undefined} onDone={() => undefined} />
        </div>
        <div key={active.id} className="animate-[finance-page-header-in_300ms_ease-out] 2xl:sticky 2xl:top-4 2xl:self-start">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-accent)]">{index + 1} of {REGIONS.length}</p>
          <p className="mt-1 text-lg font-semibold text-[var(--ref-on-surface)]">{active.title}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--ref-on-surface-variant)]">{active.body}</p>
          <div className="mt-4 flex gap-1" aria-hidden>{REGIONS.map((item, position) => <button key={item.id} type="button" tabIndex={-1} onClick={() => setIndex(position)} className={cn('h-1.5 flex-1 rounded-full', position === index ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]')} />)}</div>
        </div>
      </div>
    </VisualFrame>
  );
}

/** The real Dashboard hero, with balances shown and then hidden. */
export function HiddenBalanceDemo() {
  const { ref, step, replay } = useSequence(1, 1400);
  const data = useSampleDashboard(step >= 1);
  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption="One tap on the eye (or H) hides every amount; on the Dashboard, press and hold one to peek.">
      <Inert className="dashboard-page">
        <DashboardHero greeting={`Good evening${data.personal.name ? `, ${data.personal.name}` : ''}`} copy={data.copy} mainMetric="cash" metrics={data.metrics} budgetPace={data.budgetPace} commitments={data.commitments} isCommitmentsLoading={false} formatAmount={data.formatAmount} onAddTransaction={() => undefined} onViewReport={() => undefined} />
      </Inert>
    </VisualFrame>
  );
}
