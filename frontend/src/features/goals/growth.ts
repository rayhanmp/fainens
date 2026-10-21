/**
 * The points behind a goal's growth chart: what it held at the end of each month so far (from
 * its history), then where it's headed at its monthly amount and return, month by month.
 */

export type GrowthPoint = { time: number; held?: number; projected?: number };

type Entry = { amount: number; createdAt: number };
type GoalFacts = { setAside: number; targetAmount: number; monthlyAmount: number; expectedReturn: number; paused: boolean; byDate: number | null };

const startOfMonth = (time: number) => {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
};
const addMonths = (time: number, months: number) => {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth() + months, 1).getTime();
};
const monthsBetween = (from: number, to: number) => {
  const a = new Date(from);
  const b = new Date(to);
  return (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
};

const DAY = 86_400_000;
/** Below this much history, with nothing ahead to draw, a chart is a single jump: say it in words instead. */
export const YOUNG_HISTORY_DAYS = 31;

/**
 * When a goal's money all went in within a few days of each other, lately, and there's no path
 * ahead to draw (it's reached, paused, or has no monthly amount), its chart would be one jump
 * squeezed against the edge. This gives when that money went in, for a sentence instead; null when
 * the chart has something to show.
 */
export function oneGoGrowth(points: readonly GrowthPoint[], now: number): { since: number; until: number } | null {
  if (points.some((point) => point.held === undefined)) return null;
  const steps = points.filter((point) => point.held !== undefined && point.projected === undefined && point.held !== 0);
  if (!steps.length) return null;
  const since = steps[0]!.time;
  const until = steps.at(-1)!.time;
  return now - since < YOUNG_HISTORY_DAYS * DAY && until - since < 7 * DAY ? { since, until } : null;
}

/**
 * What it held after each move of its money, on the day it happened (drawn as steps), then a
 * projection from today. Today carries both, so the two lines meet. The projection runs until the
 * target is reached or, without that, a few months past the needed-by date (at least a year, at
 * most ten); a paused goal stays flat for a year.
 */
export function goalGrowth(entries: readonly Entry[], goal: GoalFacts, now = Date.now()): GrowthPoint[] {
  const sorted = [...entries].filter((entry) => entry.createdAt <= now).sort((a, b) => a.createdAt - b.createdAt);
  const points: GrowthPoint[] = [];
  if (sorted.length) {
    // Nothing at the start of the first month, so the first step up is visible.
    points.push({ time: startOfMonth(sorted[0]!.createdAt), held: 0 });
    let held = 0;
    for (const entry of sorted) {
      held += entry.amount;
      // Moves on the same moment collapse into one step.
      if (points.at(-1)!.time === entry.createdAt) points.at(-1)!.held = held;
      else points.push({ time: entry.createdAt, held });
    }
  }
  points.push({ time: now, held: goal.setAside, projected: goal.setAside });

  const monthly = goal.paused ? 0 : goal.monthlyAmount;
  const rate = goal.expectedReturn / 100 / 12;
  const byMonths = goal.byDate ? monthsBetween(now, goal.byDate) : 0;
  const horizon = Math.min(120, Math.max(12, byMonths + 3));
  let balance = goal.setAside;
  if (balance >= goal.targetAmount) return points;
  for (let month = 1; month <= horizon; month += 1) {
    balance = balance * (1 + rate) + monthly;
    const reached = balance >= goal.targetAmount;
    points.push({ time: addMonths(startOfMonth(now), month), projected: Math.round(reached ? goal.targetAmount : balance) });
    if (reached) break;
  }
  return points;
}
