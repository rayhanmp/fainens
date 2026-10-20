import { addMonthsOnDay } from "../lib/calendar";

/**
 * How often a subscription renews: a unit (`billingCycle`) repeated `intervalCount` times, so
 * "every 3 months" is monthly × 3. Month and year cycles land on `billingDay`, or on the month's
 * last day when the month is shorter; day and week cycles step whole calendar days.
 */
export const BILLING_CYCLES = ["daily", "weekly", "monthly", "annual"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export interface SubscriptionSchedule {
  billingCycle: string;
  intervalCount?: number | null;
  billingDay?: number | null;
}

export function isBillingCycle(value: string): value is BillingCycle {
  return (BILLING_CYCLES as readonly string[]).includes(value);
}

function stepCount(schedule: SubscriptionSchedule): number {
  const count = schedule.intervalCount ?? 1;
  return Number.isInteger(count) && count > 0 ? count : 1;
}

/** The renewal after `dueAt`. */
export function nextRenewal(dueAt: number, schedule: SubscriptionSchedule): number {
  const count = stepCount(schedule);
  if (schedule.billingCycle === "daily" || schedule.billingCycle === "weekly") {
    const next = new Date(dueAt);
    next.setDate(next.getDate() + count * (schedule.billingCycle === "weekly" ? 7 : 1));
    return next.getTime();
  }
  const months = count * (schedule.billingCycle === "annual" ? 12 : 1);
  return addMonthsOnDay(dueAt, months, schedule.billingDay ?? new Date(dueAt).getDate());
}

/** Average cost per month: a yearly plan counts a twelfth, a weekly one 52/12 charges. */
export function monthlyEquivalent(amount: number, schedule: SubscriptionSchedule): number {
  const count = stepCount(schedule);
  switch (schedule.billingCycle) {
    case "daily": return (amount * 365) / 12 / count;
    case "weekly": return (amount * 52) / 12 / count;
    case "annual": return amount / 12 / count;
    default: return amount / count;
  }
}
