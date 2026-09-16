const DAY_MS = 86_400_000;

type SubscriptionSchedule = {
  categoryId: number | null;
  amount: number;
  billingCycle: string;
  nextRenewalAt: number;
  status: string;
  createdAt?: number;
};

function addMonthsClamped(timestamp: number, months: number): number {
  const source = new Date(timestamp);
  const day = source.getDate();
  const target = new Date(timestamp);
  target.setDate(1);
  target.setMonth(target.getMonth() + months);
  const lastDay = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0,
    source.getHours(),
    source.getMinutes(),
    source.getSeconds(),
    source.getMilliseconds(),
  ).getDate();
  target.setDate(Math.min(day, lastDay));
  return target.getTime();
}

function nextOccurrence(timestamp: number, billingCycle: string): number {
  return addMonthsClamped(timestamp, billingCycle === 'annual' ? 12 : 1);
}

/**
 * Returns the scheduled subscription payment total for each category in an
 * inclusive salary period. The schedule is walked forward from its current
 * pointer; occurrences before that pointer have already been settled or
 * skipped and must not be reconstructed into an older budget period.
 */
export function getSubscriptionDueByCategory(
  subscriptions: readonly SubscriptionSchedule[],
  periodStart: number,
  periodEnd: number,
): Map<number, number> {
  const totals = new Map<number, number>();
  if (!Number.isFinite(periodStart) || !Number.isFinite(periodEnd) || periodEnd < periodStart) return totals;

  const endInclusive = periodEnd + DAY_MS - 1;
  for (const subscription of subscriptions) {
    if (
      subscription.status !== 'active' ||
      subscription.categoryId == null ||
      !Number.isSafeInteger(subscription.amount) ||
      subscription.amount <= 0 ||
      !Number.isSafeInteger(subscription.nextRenewalAt)
    ) continue;

    const createdAtValue = subscription.createdAt;
    const createdAt = typeof createdAtValue === 'number' && Number.isSafeInteger(createdAtValue)
      ? createdAtValue
      : periodStart;
    const lowerBound = Math.max(periodStart, createdAt);
    let dueAt = subscription.nextRenewalAt;
    let iterations = 0;

    if (dueAt < lowerBound) {
      while (dueAt < lowerBound && iterations++ < 2400) {
        dueAt = nextOccurrence(dueAt, subscription.billingCycle);
      }
    }

    while (dueAt >= lowerBound && dueAt <= endInclusive && iterations++ < 2400) {
      totals.set(subscription.categoryId, (totals.get(subscription.categoryId) ?? 0) + subscription.amount);
      dueAt = nextOccurrence(dueAt, subscription.billingCycle);
    }
  }

  return totals;
}
