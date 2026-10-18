import { paceTone, type PeriodPacing } from '../dashboard/pacing.ts';

/** Urgency buckets the category list is grouped by, most pressing first. */
export type BudgetLineGroup = 'over' | 'watch' | 'onTrack' | 'notStarted';
export type BudgetLineTone = 'danger' | 'warning' | 'ok' | 'neutral';

export type BudgetLineStatus = {
  /** Spent as a share of the plan; 0 when there is no plan. */
  usedRatio: number;
  tone: BudgetLineTone;
  group: BudgetLineGroup;
  /** Short status chip, or null when nothing needs saying. */
  label: 'Over' | 'Near limit' | 'Ahead of pace' | null;
  /** Where the plan sits along the bar (0..1): the right edge unless spending has spilled past it. */
  planMark: number;
  /** Where today's expected spend sits along the bar (0..1), or null outside an active period. */
  paceMark: number | null;
  remaining: number;
  /** Calendar days left in the period, today included; 0 once it has ended or before it starts. */
  daysLeft: number;
  /** What can still be spent per remaining day, or null when nothing is left or no days remain. */
  perDay: number | null;
};

export const BUDGET_NEAR_LIMIT_RATIO = 0.75;

const groupRank: Record<BudgetLineGroup, number> = { over: 0, watch: 1, onTrack: 2, notStarted: 3 };

export const budgetGroupTitles: Record<BudgetLineGroup, string> = {
  over: 'Over budget',
  watch: 'Needs a look',
  onTrack: 'On track',
  notStarted: 'Not started',
};

/**
 * Everything a category row needs to judge itself: how much of the plan is used, whether that is
 * ahead of the calendar, and what is left per day. `pacing` is null when the period is not tracked.
 */
export function budgetLineStatus(
  line: { actualAmount: number; plannedAmount: number },
  pacing: PeriodPacing | null,
): BudgetLineStatus {
  const planned = Math.max(0, line.plannedAmount);
  const actual = Math.max(0, line.actualAmount);
  const usedRatio = planned > 0 ? actual / planned : 0;
  const remaining = planned - actual;
  const active = pacing?.status === 'active';
  const daysLeft = active ? Math.max(0, pacing.totalDays - pacing.dayIndex + 1) : 0;
  const perDay = daysLeft > 0 && remaining > 0 ? remaining / daysLeft : null;
  const planMark = usedRatio > 1 ? 1 / usedRatio : 1;
  const paceMark = active && planned > 0 ? pacing.elapsedRatio * planMark : null;

  const over = usedRatio > 1;
  const near = !over && usedRatio >= BUDGET_NEAR_LIMIT_RATIO;
  const ahead = !over && !near && active && paceTone(usedRatio, pacing.elapsedRatio) === 'warning';
  const group: BudgetLineGroup = over ? 'over' : near || ahead ? 'watch' : actual === 0 ? 'notStarted' : 'onTrack';
  const tone: BudgetLineTone = over ? 'danger' : near || ahead ? 'warning' : actual === 0 ? 'neutral' : 'ok';
  const label = over ? 'Over' : near ? 'Near limit' : ahead ? 'Ahead of pace' : null;

  return { usedRatio, tone, group, label, planMark, paceMark, remaining, daysLeft, perDay };
}

/** Most pressing first, then the most used within a group. */
export function compareByUrgency(a: BudgetLineStatus, b: BudgetLineStatus): number {
  return groupRank[a.group] - groupRank[b.group] || b.usedRatio - a.usedRatio;
}

/**
 * The two-line read-back on the right of a row: the headline number and what it means today.
 * `format` renders an amount, so the caller decides on currency and balance masking.
 */
export function budgetLineCopy(status: BudgetLineStatus, format: (amount: number) => string): { value: string; detail: string } {
  if (status.remaining < 0) return { value: `${format(-status.remaining)} over`, detail: 'Past the plan' };
  if (status.remaining === 0) return { value: `${format(0)} left`, detail: 'Plan fully used' };
  if (status.perDay != null) {
    return {
      value: `${format(status.remaining)} left`,
      detail: `${format(Math.floor(status.perDay))} a day for ${status.daysLeft} day${status.daysLeft === 1 ? '' : 's'}`,
    };
  }
  return { value: `${format(status.remaining)} left`, detail: 'Left in the plan' };
}
