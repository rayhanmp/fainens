import { DEFAULT_PLAN, DEFAULT_POT, MAX_POTS, planMonthOf, type PlanGoal, type PlanInputs, type PlanPot } from './plan.ts';

type RealGoal = { id: number; name: string; targetAmount: number; byDate: number | null; kind: 'spend' | 'keep'; monthlyAmount: number; status: string; setAside: number };

/**
 * A simulator plan that starts from your real goals. Each goal is its own pot, holding what's in it
 * and fed by its monthly amount; past the room a plan has, the rest share an "Other goals" pot. The
 * free money is one more pot, fed by whatever you save beyond the goals' monthly amounts.
 */
export function planFromGoals(real: { goals: RealGoal[]; unassigned: number }, averageSaving: number, now = new Date()): PlanInputs {
  const active = real.goals.filter((goal) => goal.status === 'active').slice(0, 20);
  // One pot is kept for the free money, and one more for "Other goals" when they don't all fit.
  const room = active.length <= MAX_POTS - 1 ? active.length : MAX_POTS - 2;
  const own = active.slice(0, room);
  const others = active.slice(room);
  const potOf = (goal: RealGoal) => (own.includes(goal) ? `goal-pot-${goal.id}` : 'other-goals');
  const sum = (goals: RealGoal[], pick: (goal: RealGoal) => number) => goals.reduce((total, goal) => total + pick(goal), 0);
  const pots: PlanPot[] = own.map((goal) => ({ ...DEFAULT_POT, id: potOf(goal), name: goal.name.slice(0, 80), start: goal.setAside, monthly: goal.monthlyAmount }));
  if (others.length) pots.push({ ...DEFAULT_POT, id: 'other-goals', name: 'Other goals', start: sum(others, (goal) => goal.setAside), monthly: sum(others, (goal) => goal.monthlyAmount) });
  pots.push({
    ...DEFAULT_POT,
    id: 'unassigned',
    name: 'Free money',
    start: Math.max(0, Math.round(real.unassigned)),
    monthly: Math.max(0, Math.round((averageSaving - sum(active, (goal) => goal.monthlyAmount)) / 10_000) * 10_000),
  });
  const goals: PlanGoal[] = active.map((goal) => ({
    id: `goal-${goal.id}`,
    name: goal.name.slice(0, 80),
    amount: goal.targetAmount,
    // A dated goal already past its month counts as due next month.
    byMonth: goal.byDate ? Math.min(600, planMonthOf(new Date(goal.byDate), now)) : null,
    potId: potOf(goal),
    spend: goal.kind === 'spend',
    saved: goal.setAside,
  }));
  return { ...DEFAULT_PLAN, pots, goals };
}
