import type { PeriodPacing } from './pacing.ts';

/** Every metric the Financial pulse strip can show. All are computed from data the dashboard already loads. */
export const pulseMetricIds = [
  'cashFlow', 'savingsRate', 'burn', 'runway',
  'income', 'spending', 'dailySpend', 'safePace',
  'budgetUsed', 'topCategory', 'upcoming', 'netWorth',
  'debt', 'transactions', 'daysLeft',
  'spendVsLast', 'netWorthChange', 'owedToYou', 'reimbursementsDue', 'subscriptionsMonthly', 'pendingReview',
] as const;
export type PulseMetricId = typeof pulseMetricIds[number];

/** The strip holds between two and six metrics; four by default. */
export const MIN_PULSE_METRICS = 2;
export const MAX_PULSE_METRICS = 6;
export const defaultPulseMetrics: PulseMetricId[] = ['cashFlow', 'savingsRate', 'burn', 'runway'];

export const pulseMetricGroups: { label: string; ids: PulseMetricId[] }[] = [
  { label: 'This period', ids: ['cashFlow', 'savingsRate', 'income', 'spending', 'spendVsLast', 'dailySpend', 'transactions', 'topCategory'] },
  { label: 'Budget', ids: ['budgetUsed', 'safePace', 'daysLeft'] },
  { label: 'Wealth', ids: ['netWorth', 'netWorthChange', 'debt', 'owedToYou', 'burn', 'runway'] },
  { label: 'Bills & follow-ups', ids: ['upcoming', 'subscriptionsMonthly', 'reimbursementsDue', 'pendingReview'] },
];

export const pulseMetricLabels: Record<PulseMetricId, string> = {
  cashFlow: 'Period cash flow',
  savingsRate: 'Savings rate',
  burn: 'Monthly burn',
  runway: 'Cash runway',
  income: 'Income',
  spending: 'Spending',
  dailySpend: 'Avg daily spend',
  safePace: 'Safe daily spend',
  budgetUsed: 'Budget used',
  topCategory: 'Top category',
  upcoming: 'Due in 30 days',
  netWorth: 'Net worth',
  debt: 'Total debt',
  transactions: 'Transactions',
  daysLeft: 'Days left',
  spendVsLast: 'Spending vs last period',
  netWorthChange: 'Net worth change',
  owedToYou: 'Owed to you',
  reimbursementsDue: 'Reimbursements due',
  subscriptionsMonthly: 'Subscriptions / month',
  pendingReview: 'Pending review',
};

export const isPulseMetric = (value: unknown): value is PulseMetricId =>
  typeof value === 'string' && (pulseMetricIds as readonly string[]).includes(value);

/**
 * Distinct, known metrics within the allowed count. Nothing saved means the defaults;
 * unknown or repeated entries are dropped, and a list that ends up too short is topped up from the defaults.
 */
export function normalizePulseMetrics(value: unknown): PulseMetricId[] {
  if (!Array.isArray(value)) return [...defaultPulseMetrics];
  const picked = [...new Set(value.filter(isPulseMetric))].slice(0, MAX_PULSE_METRICS);
  for (const id of [...defaultPulseMetrics, ...pulseMetricIds]) {
    if (picked.length >= MIN_PULSE_METRICS) break;
    if (!picked.includes(id)) picked.push(id);
  }
  return picked;
}

/** Appends a metric that is not already shown, up to the maximum. */
export function addPulseMetric(current: readonly PulseMetricId[], metric: PulseMetricId): PulseMetricId[] {
  if (current.includes(metric) || current.length >= MAX_PULSE_METRICS) return [...current];
  return [...current, metric];
}

/** Moves the metric at `from` to position `to`, shifting the ones between (drag and drop, arrow keys). */
export function movePulseMetric(current: readonly PulseMetricId[], from: number, to: number): PulseMetricId[] {
  const next = [...current];
  if (from === to || from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** Removes the metric in `slot`, keeping at least the minimum. */
export function removePulseMetric(current: readonly PulseMetricId[], slot: number): PulseMetricId[] {
  if (current.length <= MIN_PULSE_METRICS) return [...current];
  return current.filter((_, index) => index !== slot);
}

/** Puts `metric` in `slot`; if it was already shown elsewhere, the two swap places. */
export function choosePulseMetric(current: readonly PulseMetricId[], slot: number, metric: PulseMetricId): PulseMetricId[] {
  const next = [...current];
  const existing = next.indexOf(metric);
  if (existing === slot) return next;
  if (existing >= 0) next[existing] = next[slot]!;
  next[slot] = metric;
  return next;
}

export type PulseInputs = {
  isTracked: boolean;
  incomeCents: number;
  spentCents: number;
  transactionCount: number;
  topCategory: { name: string; spentCents: number } | null;
  burnRate: number | null;
  runway: { isUnbounded: boolean; runwayMonths: number | null } | null;
  netWorth: number | null;
  liabilities: number | null;
  upcoming: { total: number; count: number } | null;
  budget: { planned: number; actual: number; dailyBudget: number | null; daysRemaining: number | null } | null;
  pacing: PeriodPacing | null;
  isAnalyticsLoading: boolean;
  isPeriodLoading: boolean;
  /**
   * The previous period's spending up to the same day as this one, for a fair mid-period comparison.
   * 'none' when there is no earlier period; null while loading.
   */
  previousPeriod?: { name: string; spentToDateCents: number; dayIndex: number } | 'none' | null;
  /** Change across the 30-day net worth trend; null while loading. */
  netWorthChange?: { amount: number; percent: number | null } | null;
  /** Active money lent out that has not been repaid; null while loading. */
  owedToYou?: { total: number; count: number } | null;
  /** Approved or partly paid reimbursement claims still outstanding; null while loading. */
  reimbursements?: { total: number; count: number } | null;
  /** Active subscriptions as a monthly cost (annual plans divided by twelve); null while loading. */
  subscriptions?: { monthlyCents: number; count: number } | null;
  /** Imported items waiting for review; null while loading. */
  pendingCount?: number | null;
};

/** Sums a period's spending through `dayIndex` days after its start, matching the current period's elapsed days. */
export function spentThroughDay(rows: readonly { date: number; expenseCents: number }[], periodStart: number, dayIndex: number): number {
  const cutoff = periodStart + dayIndex * 86_400_000;
  return rows.reduce((sum, row) => (row.date < cutoff && row.expenseCents > 0 ? sum + row.expenseCents : sum), 0);
}

/** Monthly cost of active subscriptions; annual plans count as a twelfth. */
export function monthlySubscriptionCost(subscriptions: readonly { amount: number; billingCycle: string; status: string }[]) {
  const active = subscriptions.filter((subscription) => subscription.status === 'active');
  const monthlyCents = Math.round(active.reduce((sum, subscription) => sum + (subscription.billingCycle === 'annual' ? subscription.amount / 12 : subscription.amount), 0));
  return { monthlyCents, count: active.length };
}

export type PulseMetricValue = {
  value: string;
  /** A short qualifier shown after the value, e.g. "of Rp3.1jt" or "4 due". */
  detail?: string;
  tone?: 'positive' | 'negative';
  hint: string;
};

type Format = { amount: (cents: number) => string; decimal: (value: number) => string };

const notTracked = (hint: string): PulseMetricValue => ({ value: 'Not tracked', hint });

export function pulseMetricValue(id: PulseMetricId, input: PulseInputs, format: Format): PulseMetricValue {
  const { amount, decimal } = format;
  const analytics = (value: string): string => (input.isAnalyticsLoading ? 'Loading…' : value);
  const period = (value: string): string => (input.isPeriodLoading ? 'Loading…' : value);
  const coverageHint = 'Complete period coverage to calculate this.';
  switch (id) {
    case 'cashFlow': {
      if (!input.isTracked) return notTracked(coverageHint);
      const net = input.incomeCents - input.spentCents;
      return { value: period(`${net >= 0 ? '+' : ''}${amount(net)}`), tone: net >= 0 ? 'positive' : 'negative', hint: `${amount(input.incomeCents)} income minus ${amount(input.spentCents)} spending.` };
    }
    case 'savingsRate': {
      if (!input.isTracked || input.incomeCents <= 0) return { value: period('—'), hint: 'Needs tracked income for this period.' };
      const rate = ((input.incomeCents - input.spentCents) / input.incomeCents) * 100;
      return { value: period(`${decimal(rate)}%`), tone: rate < 0 ? 'negative' : undefined, hint: 'Share of period income kept after recorded spending.' };
    }
    case 'burn':
      return { value: input.burnRate != null ? amount(input.burnRate) : analytics('—'), hint: 'Average operating spend over the last three months.' };
    case 'runway':
      return {
        value: analytics(input.runway?.isUnbounded ? 'No burn yet' : input.runway?.runwayMonths != null ? `${decimal(input.runway.runwayMonths)} months` : '—'),
        hint: 'Months your liquid cash lasts at the current monthly burn.',
      };
    case 'income':
      return input.isTracked ? { value: period(amount(input.incomeCents)), hint: 'Income recorded in this period.' } : notTracked(coverageHint);
    case 'spending':
      return input.isTracked ? { value: period(amount(input.spentCents)), hint: 'Spending recorded in this period.' } : notTracked(coverageHint);
    case 'dailySpend': {
      const days = input.pacing && input.pacing.status !== 'upcoming' ? input.pacing.dayIndex : 0;
      if (!input.isTracked) return notTracked(coverageHint);
      if (days <= 0) return { value: '—', hint: 'Shown once the period has started.' };
      return { value: period(amount(Math.round(input.spentCents / days))), detail: `over ${days} day${days === 1 ? '' : 's'}`, hint: 'Spending so far divided by the days elapsed in this period.' };
    }
    case 'safePace': {
      if (!input.budget || input.budget.planned <= 0) return { value: period('No budget'), hint: 'Set a budget for this period to see a safe daily amount.' };
      if (input.budget.dailyBudget == null) return { value: period('—'), hint: 'No days remain in this period.' };
      const days = input.budget.daysRemaining;
      return { value: period(amount(input.budget.dailyBudget)), detail: 'per day', hint: `Budget left spread evenly over the ${days ?? 'remaining'} remaining day${days === 1 ? '' : 's'}.` };
    }
    case 'budgetUsed': {
      if (!input.budget || input.budget.planned <= 0) return { value: period('No budget'), hint: 'Set a budget for this period to track it here.' };
      const ratio = input.budget.actual / input.budget.planned;
      return { value: period(`${decimal(ratio * 100)}%`), detail: `of ${amount(input.budget.planned)}`, tone: ratio > 1 ? 'negative' : undefined, hint: `${amount(input.budget.actual)} spent against a ${amount(input.budget.planned)} plan.` };
    }
    case 'topCategory':
      if (!input.isTracked) return notTracked(coverageHint);
      return input.topCategory
        ? { value: period(input.topCategory.name), detail: amount(input.topCategory.spentCents), hint: 'The category with the most spending this period.' }
        : { value: period('—'), hint: 'No categorized spending yet this period.' };
    case 'upcoming':
      return input.upcoming
        ? { value: input.upcoming.count > 0 ? amount(input.upcoming.total) : 'Nothing due', detail: input.upcoming.count > 0 ? `${input.upcoming.count} due` : undefined, hint: 'Subscriptions, PayLater and borrowed loans due in the next 30 days.' }
        : { value: 'Loading…', hint: 'Subscriptions, PayLater and borrowed loans due in the next 30 days.' };
    case 'netWorth':
      return { value: input.netWorth != null ? amount(input.netWorth) : analytics('—'), hint: 'Everything you own minus everything you owe.' };
    case 'debt':
      return { value: input.liabilities != null ? amount(input.liabilities) : analytics('—'), hint: 'Total balance across liability accounts.' };
    case 'transactions':
      return { value: period(input.transactionCount.toLocaleString('id-ID')), detail: 'this period', hint: 'Income and spending entries recorded in this period.' };
    case 'daysLeft': {
      if (!input.pacing) return { value: '—', hint: 'Pick a salary period to see its pace.' };
      const { status, dayIndex, totalDays } = input.pacing;
      if (status === 'ended') return { value: 'Ended', detail: `${totalDays} days`, hint: 'This period has finished.' };
      if (status === 'upcoming') return { value: 'Not started', detail: `${totalDays} days`, hint: 'This period has not started yet.' };
      const left = totalDays - dayIndex;
      return { value: `${left} day${left === 1 ? '' : 's'}`, detail: `day ${dayIndex} of ${totalDays}`, hint: 'Full days remaining in the selected salary period after today.' };
    }
    case 'spendVsLast': {
      if (!input.isTracked) return notTracked(coverageHint);
      const previous = input.previousPeriod;
      if (previous == null || input.isPeriodLoading) return { value: 'Loading…', hint: 'Comparing with the previous salary period.' };
      if (previous === 'none') return { value: '—', hint: 'There is no earlier period to compare with.' };
      const diff = input.spentCents - previous.spentToDateCents;
      const percent = previous.spentToDateCents > 0 ? (diff / previous.spentToDateCents) * 100 : null;
      const value = percent != null ? `${diff >= 0 ? '+' : '−'}${decimal(Math.abs(percent))}%` : `${diff >= 0 ? '+' : '−'}${amount(Math.abs(diff))}`;
      return {
        value,
        detail: `vs ${amount(previous.spentToDateCents)}`,
        // Spending less than last time is the good direction.
        tone: diff > 0 ? 'negative' : diff < 0 ? 'positive' : undefined,
        hint: `Spending so far compared with the first ${previous.dayIndex} day${previous.dayIndex === 1 ? '' : 's'} of ${previous.name}.`,
      };
    }
    case 'netWorthChange': {
      const change = input.netWorthChange;
      if (!change) return { value: 'Loading…', hint: 'Change in net worth over the last 30 days.' };
      return {
        value: `${change.amount >= 0 ? '+' : '−'}${amount(Math.abs(change.amount))}`,
        detail: change.percent != null ? `${change.percent >= 0 ? '+' : '−'}${decimal(Math.abs(change.percent))}% · 30d` : '30 days',
        tone: change.amount > 0 ? 'positive' : change.amount < 0 ? 'negative' : undefined,
        hint: 'Change in net worth over the last 30 days.',
      };
    }
    case 'owedToYou': {
      const owed = input.owedToYou;
      if (!owed) return { value: 'Loading…', hint: 'Money you lent that has not been repaid yet.' };
      return { value: owed.count > 0 ? amount(owed.total) : 'Nothing owed', detail: owed.count > 0 ? `${owed.count} loan${owed.count === 1 ? '' : 's'}` : undefined, hint: 'Money you lent that has not been repaid yet.' };
    }
    case 'reimbursementsDue': {
      const claims = input.reimbursements;
      if (!claims) return { value: 'Loading…', hint: 'Approved reimbursements still waiting to be paid back.' };
      return { value: claims.count > 0 ? amount(claims.total) : 'All paid', detail: claims.count > 0 ? `${claims.count} claim${claims.count === 1 ? '' : 's'}` : undefined, hint: 'Approved reimbursements still waiting to be paid back.' };
    }
    case 'subscriptionsMonthly': {
      const subscriptions = input.subscriptions;
      if (!subscriptions) return { value: 'Loading…', hint: 'What your active subscriptions cost per month; annual plans count as a twelfth.' };
      return { value: subscriptions.count > 0 ? amount(subscriptions.monthlyCents) : 'None active', detail: subscriptions.count > 0 ? `${subscriptions.count} active` : undefined, hint: 'What your active subscriptions cost per month; annual plans count as a twelfth.' };
    }
    case 'pendingReview': {
      const count = input.pendingCount;
      if (count == null) return { value: 'Loading…', hint: 'Imported transactions waiting for you to review before posting.' };
      return { value: count > 0 ? String(count) : 'All clear', detail: count > 0 ? `item${count === 1 ? '' : 's'} to review` : undefined, tone: count > 0 ? 'negative' : undefined, hint: 'Imported transactions waiting for you to review before posting.' };
    }
  }
}
