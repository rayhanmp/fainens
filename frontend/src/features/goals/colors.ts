import type { Goal } from './queries';

/**
 * Each active goal's colour, by its place in the list: a fixed order checked for colour-blind
 * separation, never cycled. Goals past the sixth share the "other goals" grey.
 */
export const GOAL_COLORS = ['#0d9488', '#d97706', '#7c3aed', '#65a30d', '#db2777', '#0284c7'] as const;
export const OTHER_GOALS_COLOR = '#64748b';

export function goalColor(index: number): string {
  return index >= 0 && index < GOAL_COLORS.length ? GOAL_COLORS[index]! : OTHER_GOALS_COLOR;
}

/** Active goals in list order, each with its colour. */
export function coloredGoals(goals: readonly Goal[]): Array<{ goal: Goal; color: string }> {
  return goals.filter((goal) => goal.status === 'active').map((goal, index) => ({ goal, color: goalColor(index) }));
}
