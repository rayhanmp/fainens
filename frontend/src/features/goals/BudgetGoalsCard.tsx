import { Link } from '@tanstack/react-router';
import { Check, ChevronRight, Sparkles } from 'lucide-react';
import { toast } from '../../components/ui/useToast';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn } from '../../lib/utils';
import { coloredGoals } from './colors';
import { dueThisMonth } from './pace';
import { useFundMonthlyMutation, useGoalsQuery } from './queries';

/**
 * The budget's side of goals: what your goals ask each month against this period's savings
 * target, and a button that puts this month's amounts in.
 */
export function BudgetGoalsCard({ savingsTarget, canFund }: {
  /** This period's savings target, or null when it isn't set or tracked. */
  savingsTarget: number | null;
  /** Funding only makes sense for the period you're in. */
  canFund: boolean;
}) {
  const { formatAmount } = useBalanceVisibility();
  const query = useGoalsQuery();
  const fund = useFundMonthlyMutation();
  const overview = query.data;
  const active = (overview?.goals ?? []).filter((goal) => goal.status === 'active');
  const monthly = active.reduce((sum, goal) => sum + (goal.paused ? 0 : goal.monthlyAmount), 0);
  const due = active.reduce((sum, goal) => sum + dueThisMonth(goal), 0);
  const fundable = Math.min(due, Math.max(0, overview?.unassigned ?? 0));
  const shown = [...active].sort((a, b) => (a.byDate ?? Infinity) - (b.byDate ?? Infinity) || b.monthlyAmount - a.monthlyAmount).slice(0, 4);
  const share = savingsTarget && savingsTarget > 0 ? monthly / savingsTarget : null;
  const colors = new Map(coloredGoals(overview?.goals ?? []).map(({ goal, color }) => [goal.id, color]));

  return (
    <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-6 editorial-shadow">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-headline text-lg font-bold text-[var(--ref-on-surface)]">Savings goals</h2>
        <Link to="/goals" className="inline-flex items-center gap-0.5 text-xs font-semibold text-[var(--ref-primary)] hover:underline">
          Goals<ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>

      {!overview ? (
        <div className="mt-4 h-24 animate-pulse rounded-2xl bg-[var(--ref-surface-container-low)]" aria-label="Loading goals" />
      ) : active.length === 0 ? (
        <>
          <p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">Give your savings a job, like an emergency fund, a trip or a laptop, and see it grow each period.</p>
          <Link to="/goals" className="mt-4 inline-flex h-[34px] items-center rounded-lg bg-[var(--ref-primary)] px-3 text-xs font-semibold text-white hover:opacity-90">Add a goal</Link>
        </>
      ) : (
        <>
          <p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">
            Your goals ask <span className="font-semibold text-[var(--ref-on-surface)]">{formatAmount(monthly)}</span> a month
            {share !== null && <> of this period’s <span className="font-semibold text-[var(--ref-on-surface)]">{formatAmount(savingsTarget!)}</span> savings target</>}.
          </p>
          {share !== null && (
            <div className="mt-3">
              <div className="h-2 overflow-hidden rounded-full bg-[var(--ref-surface-container-high)]" role="img" aria-label={`Goals take ${Math.round(share * 100)}% of the savings target`}>
                <div className={cn('h-full rounded-full', share > 1 ? 'bg-[var(--ref-error)]' : 'bg-[var(--ref-primary)]')} style={{ width: `${Math.min(1, share) * 100}%` }} />
              </div>
              <p className={cn('mt-1.5 text-[11px]', share > 1 ? 'text-[var(--ref-error)]' : 'text-[var(--ref-on-surface-variant)]')}>
                {share > 1 ? `${formatAmount(monthly - savingsTarget!)} more than the target` : `${formatAmount(savingsTarget! - monthly)} of the target left for anything else`}
              </p>
            </div>
          )}

          <ul className="mt-4 space-y-3">
            {shown.map((goal) => {
              const color = colors.get(goal.id);
              const progress = goal.targetAmount > 0 ? Math.min(1, goal.setAside / goal.targetAmount) : 0;
              const got = goal.monthlyAmount > 0 && dueThisMonth(goal) === 0;
              return (
                <li key={goal.id}>
                  <div className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate font-semibold text-[var(--ref-on-surface)]">{goal.name}</span>
                    <span className="flex shrink-0 items-center gap-1 tabular-nums text-[var(--ref-on-surface-variant)]">
                      {got && <Check className="h-3 w-3 text-[var(--color-success)]" aria-label="This month’s amount is in" />}
                      {goal.monthlyAmount > 0 ? `${formatAmount(goal.monthlyAmount)}/mo` : 'No monthly amount'}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--ref-surface-container-high)]">
                    <div className="h-full rounded-full" style={{ width: `${progress * 100}%`, background: color }} />
                  </div>
                  <p className="mt-1 text-[11px] tabular-nums text-[var(--ref-on-surface-variant)]">{formatAmount(goal.setAside)} of {formatAmount(goal.targetAmount)}</p>
                </li>
              );
            })}
          </ul>
          {active.length > shown.length && <p className="mt-2 text-[11px] text-[var(--ref-on-surface-variant)]">and {active.length - shown.length} more on the Goals page</p>}

          {canFund && monthly > 0 && (
            due === 0 ? (
              <p className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-success)]"><Check className="h-3.5 w-3.5" aria-hidden />This month’s amounts are in</p>
            ) : (
              <button
                type="button"
                disabled={fund.isPending || fundable <= 0}
                title={fundable <= 0 ? 'Nothing is free to put in' : 'Put each goal’s monthly amount in from your free money'}
                onClick={async () => {
                  try {
                    const result = await fund.mutateAsync(null);
                    toast.success(result.total > 0 ? `Put ${formatAmount(result.total)} into ${result.assigned.length} goal${result.assigned.length === 1 ? '' : 's'}.` : 'Nothing to put in.');
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : 'Could not put the money in');
                  }
                }}
                className="mt-4 inline-flex h-[34px] w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-xs font-semibold text-[var(--ref-on-surface)] transition-colors hover:bg-[var(--ref-surface-container-low)] disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden />Put in {formatAmount(fundable > 0 ? fundable : due)} for this month
              </button>
            )
          )}
        </>
      )}
    </div>
  );
}
