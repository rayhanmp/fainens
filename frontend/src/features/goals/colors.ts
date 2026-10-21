import type { Goal } from './queries';

/**
 * Each active goal's colour, by its place in the list: a fixed, cool order that sits with the blue
 * pages, checked for colour-blind separation across every pair, never cycled. Goals past the fifth
 * share the "other goals" grey; every goal is also named in the legend, never told by colour alone.
 */
export const GOAL_COLORS = ['#0f766e', '#6366f1', '#db2777', '#38bdf8', '#65a30d'] as const;
export const OTHER_GOALS_COLOR = '#64748b';

/** Light colours carry dark text inside the bar. */
const LIGHT = new Set<string>(['#38bdf8']);

export function goalColor(index: number): string {
  return index >= 0 && index < GOAL_COLORS.length ? GOAL_COLORS[index]! : OTHER_GOALS_COLOR;
}

/** The text colour that reads on a goal's colour. */
export function goalInk(color: string): string {
  return LIGHT.has(color) ? '#0b1b3a' : '#ffffff';
}

/** Active goals in list order, each with its colour. */
export function coloredGoals(goals: readonly Goal[]): Array<{ goal: Goal; color: string }> {
  return goals.filter((goal) => goal.status === 'active').map((goal, index) => ({ goal, color: goalColor(index) }));
}
