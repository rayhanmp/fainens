import { DAY_MS, nextRenewal, renews, withinEnd, type SubscriptionLike } from '../subscriptions/schedule';

type SubscriptionSchedule = Omit<SubscriptionLike, 'id' | 'endsAt' | 'trialEndsAt'> & {
  id?: number;
  categoryId: number | null;
  endsAt?: number | null;
  trialEndsAt?: number | null;
  createdAt?: number;
};

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
  for (const raw of subscriptions) {
    const subscription = { id: 0, trialEndsAt: null, ...raw, endsAt: raw.endsAt ?? null };
    if (
      !renews(subscription) ||
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

    while (dueAt < lowerBound && iterations++ < 2400) dueAt = nextRenewal(dueAt, subscription);

    while (dueAt >= lowerBound && dueAt <= endInclusive && withinEnd(subscription, dueAt) && iterations++ < 2400) {
      totals.set(subscription.categoryId, (totals.get(subscription.categoryId) ?? 0) + subscription.amount);
      dueAt = nextRenewal(dueAt, subscription);
    }
  }

  return totals;
}
