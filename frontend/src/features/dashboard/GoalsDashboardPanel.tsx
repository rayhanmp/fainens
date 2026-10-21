import { Link } from '@tanstack/react-router';
import { cn } from '../../lib/utils';
import { coloredGoals } from '../goals/colors';
import type { GoalsOverview } from '../goals/queries';
import { PanelHeader, PanelLink } from './PanelParts';
import { panelCard } from './panel-styles';

const VISIBLE_GOALS = 4;
const monthYear = (months: number, now: number) => {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth() + months, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};

/**
 * Goals on the Dashboard: your money split into goals and what's free, as one bar, then the top
 * goals by priority with how far each has got and when it's reached. Each opens its own page.
 */
export function GoalsDashboardPanel({ overview, isLoading, now, formatAmount }: {
  overview: GoalsOverview | undefined;
  isLoading: boolean;
  now: number;
  formatAmount: (amount: number) => string;
}) {
  const goals = coloredGoals(overview?.goals ?? []);
  const whole = Math.max(overview?.available ?? 0, overview?.setAside ?? 0, 1);
  const free = Math.max(0, overview?.unassigned ?? 0);

  return (
    <section className={cn('dashboard-goals', panelCard)} aria-label="Goals">
      <PanelHeader
        title="Goals"
        subtitle={isLoading || !overview ? 'Loading goals…' : goals.length ? `${formatAmount(overview.setAside)} in ${goals.length} goal${goals.length === 1 ? '' : 's'} · ${formatAmount(free)} free` : 'Split your money into goals, like an emergency fund or a trip.'}
      />
      {overview && goals.length > 0 && (
        <>
          <div className="mt-3 flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-[var(--ref-surface-container-high)]" role="img" aria-label={`${formatAmount(overview.setAside)} in goals, ${formatAmount(free)} free`}>
            {goals.filter(({ goal }) => goal.setAside > 0).map(({ goal, color }) => <span key={goal.id} style={{ flex: `0 1 ${(goal.setAside / whole) * 100}%`, background: color }} />)}
          </div>
          <ul className="mt-3 divide-y divide-[var(--color-border)]">
            {goals.slice(0, VISIBLE_GOALS).map(({ goal, color }) => {
              const progress = goal.targetAmount > 0 ? Math.min(1, goal.setAside / goal.targetAmount) : 0;
              return (
                <li key={goal.id}>
                  <Link to="/goals/$goalId" params={{ goalId: String(goal.id) }} className="-mx-2 block rounded-xl px-2 py-2.5 transition-colors hover:bg-[var(--ref-surface-container-low)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ref-primary)]">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-[var(--ref-on-surface)]">
                        <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: color }} aria-hidden />
                        {goal.icon && <span aria-hidden>{goal.icon}</span>}
                        <span className="truncate">{goal.name}</span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-[var(--ref-on-surface-variant)]">{Math.round(progress * 100)}%</span>
                    </span>
                    <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-[var(--ref-surface-container-high)]" aria-hidden>
                      <span className="block h-full rounded-full" style={{ width: `${progress * 100}%`, background: color }} />
                    </span>
                    <span className="mt-1 block text-[11px] tabular-nums text-[var(--ref-on-surface-variant)]">
                      {formatAmount(goal.setAside)} of {formatAmount(goal.targetAmount)}
                      {goal.paused ? ' · Paused' : goal.reachMonths === 0 ? ' · All there' : goal.reachMonths !== null ? ` · ${monthYear(goal.reachMonths, now)}` : ''}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {goals.length > VISIBLE_GOALS && <p className="mt-2 text-xs text-[var(--ref-on-surface-variant)]">Showing {VISIBLE_GOALS} of {goals.length} goals</p>}
        </>
      )}
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2"><PanelLink to="/goals">{goals.length ? 'All goals' : 'Add a goal'}</PanelLink></div>
    </section>
  );
}
