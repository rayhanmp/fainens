import { Check, Sparkles } from 'lucide-react';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn } from '../../lib/utils';
import { InfoHint } from '../savings/InfoHint';
import { Section } from '../subscriptions/PageParts';
import { coloredGoals } from './colors';
import { dueThisMonth, monthsUntil } from './pace';
import type { GoalsOverview } from './queries';

const monthYear = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
const addMonths = (months: number, now = new Date()) => new Date(now.getFullYear(), now.getMonth() + months, 1);

/**
 * This month's plan: what each goal's monthly amount asks, what it already got, and one button
 * that puts in the rest from your free money.
 */
export function ThisMonthPanel({ overview, funding, onFund }: { overview: GoalsOverview; funding: boolean; onFund: () => void }) {
  const { formatAmount } = useBalanceVisibility();
  const month = new Date().toLocaleDateString('en-US', { month: 'long' });
  const goals = coloredGoals(overview.goals).filter(({ goal }) => goal.monthlyAmount > 0);
  const due = goals.reduce((sum, { goal }) => sum + dueThisMonth(goal), 0);
  const fundable = Math.min(due, Math.max(0, overview.unassigned));

  return (
    <Section title="This month" aside={<span className="text-xs text-[var(--ref-on-surface-variant)]">{month}</span>}>
      {goals.length === 0 ? (
        <p className="px-4 py-4 text-sm text-[var(--ref-on-surface-variant)] sm:px-5">Give a goal an amount to put in each month and it shows here, ready to put in with one tap.</p>
      ) : (
        <>
          <ul className="space-y-3 px-4 py-4 sm:px-5">
            {goals.map(({ goal, color }) => {
              const full = goal.setAside >= goal.targetAmount;
              const left = dueThisMonth(goal);
              const share = Math.min(1, goal.setAsideThisMonth / goal.monthlyAmount);
              return (
                <li key={goal.id}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} aria-hidden />
                      <span className="truncate text-[var(--ref-on-surface)]">{goal.name}</span>
                    </span>
                    <span className={cn('flex shrink-0 items-center gap-1 text-xs tabular-nums', left === 0 ? 'font-semibold text-[var(--color-success)]' : 'text-[var(--ref-on-surface-variant)]')}>
                      {full ? 'Full' : left === 0 ? <><Check className="h-3.5 w-3.5" aria-hidden />In</> : `${formatAmount(left)} to put in`}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--ref-surface-container-high)]" role="img" aria-label={`${formatAmount(goal.setAsideThisMonth)} of ${formatAmount(goal.monthlyAmount)} this month`}>
                    <div className="h-full rounded-full" style={{ width: `${(full ? 1 : share) * 100}%`, background: color }} />
                  </div>
                  <p className="mt-1 text-[11px] tabular-nums text-[var(--ref-on-surface-variant)]">{formatAmount(Math.min(goal.setAsideThisMonth, goal.monthlyAmount))} of {formatAmount(goal.monthlyAmount)} a month</p>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-[var(--color-border)] px-4 py-3 sm:px-5">
            {due === 0 ? (
              <p className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-success)]"><Check className="h-4 w-4" aria-hidden />All in for {month}</p>
            ) : (
              <>
                <button
                  type="button"
                  disabled={funding || fundable <= 0}
                  onClick={onFund}
                  className="inline-flex h-[34px] w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--ref-primary)] px-3 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />Put in {formatAmount(fundable > 0 ? fundable : due)}
                </button>
                <p className="mt-1.5 text-[11px] text-[var(--ref-on-surface-variant)]">
                  {fundable <= 0 ? 'Nothing is free to put in right now.' : fundable < due ? `Only ${formatAmount(fundable)} is free; dated goals get theirs first.` : 'From your free money. Nothing moves between accounts.'}
                </p>
              </>
            )}
          </div>
        </>
      )}
    </Section>
  );
}

/**
 * When each goal gets there at its monthly amount, drawn as a line from today, with a tick where
 * it's needed by. Interest isn't counted, so it errs on the late side.
 */
export function ReachPanel({ overview }: { overview: GoalsOverview }) {
  const now = new Date();
  const rows = coloredGoals(overview.goals).map(({ goal, color }) => {
    const toGo = Math.max(0, goal.targetAmount - goal.setAside);
    const months = toGo === 0 ? 0 : goal.monthlyAmount > 0 ? Math.ceil(toGo / goal.monthlyAmount) : null;
    const by = goal.byDate ? monthsUntil(goal.byDate, now) : null;
    return { goal, color, months, by };
  });
  if (rows.length === 0) return null;
  const horizon = Math.max(12, ...rows.map((row) => Math.max(row.months ?? 0, row.by ?? 0)));
  const at = (months: number) => `${Math.min(100, (months / horizon) * 100)}%`;

  return (
    <Section
      title="When you’ll get there"
      aside={<InfoHint label="How this is worked out" align="right">From what’s in each goal now, adding its monthly amount every month. Interest isn’t counted, so goals in savings or SBN may get there a little sooner. A tick marks the month a goal is needed by.</InfoHint>}
    >
      <ul className="space-y-4 px-4 py-4 sm:px-5">
        {rows.map(({ goal, color, months, by }) => {
          const late = months !== null && by !== null && months > by ? months - by : 0;
          return (
            <li key={goal.id}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate text-[var(--ref-on-surface)]">{goal.name}</span>
                <span className={cn('shrink-0 text-xs tabular-nums', months === 0 ? 'font-semibold text-[var(--color-success)]' : late ? 'text-[var(--color-warning)]' : 'text-[var(--ref-on-surface-variant)]')}>
                  {months === 0 ? 'There already' : months === null ? 'No monthly amount' : monthYear(addMonths(months, now))}
                </span>
              </div>
              {/* The track: from today to the month it's reached; a tick where it's needed by. */}
              <div className="relative mt-1.5 h-2 rounded-full bg-[var(--ref-surface-container-high)]">
                {months !== null && <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: months === 0 ? '100%' : at(months), background: color }} />}
                {months === null && <div className="absolute inset-y-0 left-0 w-full rounded-full opacity-40" style={{ background: `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 8px)` }} />}
                {by !== null && months !== 0 && <div className="absolute -top-1 h-4 w-0.5 rounded-full bg-[var(--ref-on-surface)]" style={{ left: at(by) }} title={`Needed by ${monthYear(new Date(goal.byDate!))}`} />}
              </div>
              {(late > 0 || (by !== null && months !== null && months > 0)) && (
                <p className={cn('mt-1 text-[11px]', late ? 'text-[var(--color-warning)]' : 'text-[var(--ref-on-surface-variant)]')}>
                  {late ? `${late} month${late === 1 ? '' : 's'} after ${monthYear(new Date(goal.byDate!))}: put in more each month to make it` : `On time for ${monthYear(new Date(goal.byDate!))}`}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex justify-between border-t border-[var(--color-border)] px-4 py-2 text-[11px] text-[var(--ref-on-surface-variant)] sm:px-5">
        <span>Now</span>
        <span>{monthYear(addMonths(horizon, now))}</span>
      </div>
    </Section>
  );
}
