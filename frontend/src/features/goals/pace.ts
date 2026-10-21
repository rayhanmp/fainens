import type { Goal } from './queries';

/** Whole months from now until `time`, at least one. */
export function monthsUntil(time: number, now = new Date()): number {
  const date = new Date(time);
  return Math.max(1, (date.getFullYear() - now.getFullYear()) * 12 + date.getMonth() - now.getMonth());
}

/** What a goal still needs, and what that means a month (rounded up to Rp1.000) to make its date. */
export function goalPace(goal: Pick<Goal, 'targetAmount' | 'setAside' | 'byDate' | 'monthlyAmount'>, now = new Date()) {
  const toGo = Math.max(0, goal.targetAmount - goal.setAside);
  const perMonth = goal.byDate && toGo > 0 ? Math.ceil(toGo / monthsUntil(goal.byDate, now) / 1000) * 1000 : null;
  return { toGo, perMonth, behind: perMonth !== null && goal.monthlyAmount < perMonth };
}

/** What a goal's monthly amount still asks for this month: less what it got already, no more than it needs. */
export function dueThisMonth(goal: Pick<Goal, 'targetAmount' | 'setAside' | 'monthlyAmount' | 'setAsideThisMonth' | 'status' | 'paused'>): number {
  if (goal.status !== 'active' || goal.paused) return 0;
  return Math.max(0, Math.min(goal.monthlyAmount - goal.setAsideThisMonth, goal.targetAmount - goal.setAside));
}
