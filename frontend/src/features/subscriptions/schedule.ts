/**
 * The subscription schedule as the server computes it (backend services/subscription-schedule.ts):
 * a unit repeated `intervalCount` times. Month and year cycles land on `billingDay`, or on the
 * month's last day when the month is shorter; day and week cycles step whole calendar days.
 */

export const DAY_MS = 86_400_000;

export type BillingCycle = 'daily' | 'weekly' | 'monthly' | 'annual';

export type SubscriptionSchedule = {
  billingCycle: string;
  intervalCount?: number | null;
  billingDay?: number | null;
};

function stepCount(schedule: SubscriptionSchedule): number {
  const count = schedule.intervalCount ?? 1;
  return Number.isInteger(count) && count > 0 ? count : 1;
}

function addMonthsOnDay(ms: number, months: number, dayOfMonth: number): number {
  const source = new Date(ms);
  const target = new Date(source.getFullYear(), source.getMonth() + months, 1, source.getHours(), source.getMinutes(), source.getSeconds(), source.getMilliseconds());
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(Math.max(1, dayOfMonth), lastDay));
  return target.getTime();
}

/** The renewal after `dueAt`. */
export function nextRenewal(dueAt: number, schedule: SubscriptionSchedule): number {
  const count = stepCount(schedule);
  if (schedule.billingCycle === 'daily' || schedule.billingCycle === 'weekly') {
    const next = new Date(dueAt);
    next.setDate(next.getDate() + count * (schedule.billingCycle === 'weekly' ? 7 : 1));
    return next.getTime();
  }
  const months = count * (schedule.billingCycle === 'annual' ? 12 : 1);
  return addMonthsOnDay(dueAt, months, schedule.billingDay ?? new Date(dueAt).getDate());
}

/** The renewal before `dueAt` on the same schedule. */
export function previousRenewal(dueAt: number, schedule: SubscriptionSchedule): number {
  const count = stepCount(schedule);
  if (schedule.billingCycle === 'daily' || schedule.billingCycle === 'weekly') {
    const previous = new Date(dueAt);
    previous.setDate(previous.getDate() - count * (schedule.billingCycle === 'weekly' ? 7 : 1));
    return previous.getTime();
  }
  const months = count * (schedule.billingCycle === 'annual' ? 12 : 1);
  return addMonthsOnDay(dueAt, -months, schedule.billingDay ?? new Date(dueAt).getDate());
}

/** Average cost per month: a yearly plan counts a twelfth, a weekly one 52/12 charges. */
export function monthlyEquivalent(amount: number, schedule: SubscriptionSchedule): number {
  const count = stepCount(schedule);
  switch (schedule.billingCycle) {
    case 'daily': return (amount * 365) / 12 / count;
    case 'weekly': return (amount * 52) / 12 / count;
    case 'annual': return amount / 12 / count;
    default: return amount / count;
  }
}

const UNIT_NAMES: Record<string, [string, string]> = {
  daily: ['day', 'days'],
  weekly: ['week', 'weeks'],
  monthly: ['month', 'months'],
  annual: ['year', 'years'],
};

/** "Monthly", "Every 3 months", "Yearly". */
export function cycleLabel(schedule: SubscriptionSchedule): string {
  const count = stepCount(schedule);
  if (count === 1) {
    return { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', annual: 'Yearly' }[schedule.billingCycle] ?? 'Monthly';
  }
  const [, plural] = UNIT_NAMES[schedule.billingCycle] ?? UNIT_NAMES.monthly;
  return `Every ${count} ${plural}`;
}

/** Short suffix beside a price: "/mo", "/yr", "/3 mo". */
export function cycleSuffix(schedule: SubscriptionSchedule): string {
  const count = stepCount(schedule);
  const unit = { daily: 'day', weekly: 'wk', monthly: 'mo', annual: 'yr' }[schedule.billingCycle] ?? 'mo';
  return count === 1 ? `/${unit}` : `/${count} ${unit}`;
}

/** The common cycles offered first in the editor; anything else is a custom interval. */
export const CYCLE_PRESETS = [
  { value: 'weekly-1', label: 'Weekly', billingCycle: 'weekly', intervalCount: 1 },
  { value: 'monthly-1', label: 'Monthly', billingCycle: 'monthly', intervalCount: 1 },
  { value: 'monthly-3', label: 'Every 3 months', billingCycle: 'monthly', intervalCount: 3 },
  { value: 'monthly-6', label: 'Every 6 months', billingCycle: 'monthly', intervalCount: 6 },
  { value: 'annual-1', label: 'Yearly', billingCycle: 'annual', intervalCount: 1 },
] as const;

export function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Whole calendar days from today to `ms`: 0 today, negative when past. */
export function daysFromToday(ms: number, now = Date.now()): number {
  return Math.round((startOfDay(ms) - startOfDay(now)) / DAY_MS);
}

/** "today", "tomorrow", "in 5 days", "3 days late". */
export function relativeDue(ms: number, now = Date.now()): string {
  const days = daysFromToday(ms, now);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return '1 day late';
  if (days < 0) return `${-days} days late`;
  return `in ${days} days`;
}

/** "US$20.00" in the user's locale, from minor units. */
export function formatForeign(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
}

/** Local noon of a "YYYY-MM-DD" date input, the time renewals are stored at. */
export function fromDateInput(value: string): number {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
}

export function toDateInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export type SubscriptionLike = SubscriptionSchedule & {
  id: number;
  status: string;
  amount: number;
  nextRenewalAt: number;
  endsAt: number | null;
  trialEndsAt: number | null;
};

/** Whether a renewal on `dueAt` still falls within the subscription's last day. */
export function withinEnd(subscription: Pick<SubscriptionLike, 'endsAt'>, dueAt: number): boolean {
  if (subscription.endsAt == null) return true;
  const end = new Date(subscription.endsAt);
  end.setHours(23, 59, 59, 999);
  return dueAt <= end.getTime();
}

/** Still renewing: active, or cancelled with renewals left before its last day. */
export function renews(subscription: SubscriptionLike): boolean {
  if (subscription.status === 'active') return withinEnd(subscription, subscription.nextRenewalAt);
  return subscription.status === 'cancelled' && subscription.endsAt != null && withinEnd(subscription, subscription.nextRenewalAt);
}

export type DisplayStatus = 'overdue' | 'due-soon' | 'trial' | 'active' | 'ending' | 'paused' | 'ended' | 'archived';

export const STATUS_LABELS: Record<DisplayStatus, string> = {
  overdue: 'Needs review',
  'due-soon': 'Due soon',
  trial: 'Free trial',
  active: 'Active',
  ending: 'Cancelled',
  paused: 'Paused',
  ended: 'Ended',
  archived: 'Archived',
};

export function displayStatus(subscription: SubscriptionLike, overdueIds: ReadonlySet<number>, now = Date.now()): DisplayStatus {
  if (subscription.status === 'archived') return 'archived';
  if (subscription.status === 'paused') return 'paused';
  if (!renews(subscription)) return overdueIds.has(subscription.id) ? 'overdue' : 'ended';
  if (overdueIds.has(subscription.id)) return 'overdue';
  if (subscription.status === 'cancelled') return 'ending';
  if (subscription.trialEndsAt != null && subscription.trialEndsAt >= startOfDay(now)) return 'trial';
  if (daysFromToday(subscription.nextRenewalAt, now) <= 7) return 'due-soon';
  return 'active';
}

export type RenewalState = 'done' | 'late' | 'due';

/**
 * Every renewal of `subscription` in [from, until]: those before its next renewal were already
 * recorded or skipped ('done'); from the next one on they are due, and past-due ones ('late') wait
 * for a decision when the subscription has renewals in review.
 */
export function renewalsBetween(subscription: SubscriptionLike & { createdAt: number }, from: number, until: number, now: number, hasLate: boolean): Array<{ dueAt: number; state: RenewalState }> {
  const found: Array<{ dueAt: number; state: RenewalState }> = [];
  const created = startOfDay(subscription.createdAt);
  let before = previousRenewal(subscription.nextRenewalAt, subscription);
  for (let guard = 0; guard < 400 && before >= from && before >= created; guard += 1) {
    if (before <= until) found.push({ dueAt: before, state: 'done' });
    before = previousRenewal(before, subscription);
  }
  let dueAt = subscription.nextRenewalAt;
  for (let guard = 0; guard < 400 && dueAt <= until; guard += 1) {
    if (!withinEnd(subscription, dueAt)) break;
    if (dueAt >= from) found.push({ dueAt, state: hasLate && dueAt <= now ? 'late' : 'due' });
    dueAt = nextRenewal(dueAt, subscription);
  }
  return found.sort((a, b) => a.dueAt - b.dueAt);
}

/** Renewals still to come from `from` up to `until`, ignoring the overdue ones already in review. */
export function upcomingRenewals(subscription: SubscriptionLike, from: number, until: number): number[] {
  if (!renews(subscription)) return [];
  const dates: number[] = [];
  let dueAt = subscription.nextRenewalAt;
  for (let guard = 0; guard < 400 && dueAt <= until; guard += 1) {
    if (!withinEnd(subscription, dueAt)) break;
    if (dueAt >= from) dates.push(dueAt);
    dueAt = nextRenewal(dueAt, subscription);
  }
  return dates;
}
