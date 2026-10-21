import { useState } from 'react';
import { ChevronDown, Pencil, RotateCcw } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn, formatDate } from '../../lib/utils';
import { Section } from '../subscriptions/PageParts';
import { InfoHint } from '../savings/InfoHint';
import { coloredGoals } from './colors';
import { goalPace } from './pace';
import { useGoalAllocationsQuery, type Goal, type GoalsOverview } from './queries';

const monthYear = (time: number) => new Date(time).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

function History({ goalId }: { goalId: number }) {
  const { formatAmount } = useBalanceVisibility();
  const history = useGoalAllocationsQuery(goalId);
  const rows = history.data ?? [];
  return (
    <div className="px-4 pb-3 sm:px-5">
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ref-outline)]">History</p>
      {history.isPending ? <p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">Loading…</p> : rows.length === 0 ? (
        <p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">No money in it yet.</p>
      ) : (
        <ul className="mt-1 divide-y divide-[var(--color-border)] text-xs">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 py-1.5">
              <span className="min-w-0 text-[var(--ref-on-surface-variant)]">
                <span className="tabular-nums">{formatDate(row.createdAt)}</span>
                {' · '}{row.kind === 'spend' ? (row.transactionDescription ? `Bought: ${row.transactionDescription}` : 'Finished') : row.note ?? (row.amount > 0 ? 'Put in' : 'Taken out')}
              </span>
              <span className={cn('shrink-0 font-semibold tabular-nums', row.amount > 0 ? 'text-[var(--color-success)]' : 'text-[var(--ref-on-surface)]')}>{row.amount > 0 ? '+' : '−'}{formatAmount(Math.abs(row.amount))}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Every goal: how much it holds against its target, what it needs a month to make its date, and
 * its actions. Tap a goal for its history; finished ones are folded away below.
 */
export function GoalList({ overview, selectedId, onSelect, onMove, onComplete, onEdit, onReopen }: {
  overview: GoalsOverview;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onMove: (goal: Goal) => void;
  onComplete: (goal: Goal) => void;
  onEdit: (goal: Goal) => void;
  onReopen: (goal: Goal) => void;
}) {
  const { formatAmount } = useBalanceVisibility();
  const [showDone, setShowDone] = useState(false);
  const active = coloredGoals(overview.goals);
  const finished = overview.goals.filter((goal) => goal.status !== 'active');

  return (
    <Section
      title="Goals"
      aside={<InfoHint label="How goals work" align="right">Each goal is its own pot inside Fainens. Put money in from what’s free and take it out again any time; nothing moves between your accounts. When you buy it, choose Bought it and its money is used up.</InfoHint>}
    >
      {active.length === 0 ? (
        <p className="px-4 py-4 text-sm text-[var(--ref-on-surface-variant)] sm:px-5">No goals yet. Add one to give part of your money a job.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {active.map(({ goal, color }) => {
            const { toGo, perMonth, behind } = goalPace(goal);
            const progress = goal.targetAmount > 0 ? Math.min(1, goal.setAside / goal.targetAmount) : 0;
            const selected = goal.id === selectedId;
            return (
              <li key={goal.id} id={`goal-${goal.id}`} className={cn('scroll-mt-24 transition-colors', selected && 'bg-[var(--color-accent)]/[0.06]')}>
                <div className="px-4 py-3.5 sm:px-5">
                  <button type="button" aria-expanded={selected} onClick={() => onSelect(selected ? null : goal.id)} className="block w-full text-left">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-[var(--ref-on-surface)]">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} aria-hidden />
                        <span className="truncate">{goal.name}</span>
                        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-[var(--ref-outline)] transition-transform', selected && 'rotate-180')} aria-hidden />
                      </span>
                      <span className="shrink-0 text-sm tabular-nums text-[var(--ref-on-surface-variant)]"><span className="font-semibold text-[var(--ref-on-surface)]">{formatAmount(goal.setAside)}</span> of {formatAmount(goal.targetAmount)}</span>
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-[var(--ref-on-surface-variant)]">
                      {goal.kind === 'spend' ? 'to buy' : 'to keep'}
                      {goal.byDate ? ` · by ${monthYear(goal.byDate)}` : ''}
                      {goal.monthlyAmount > 0 ? ` · ${formatAmount(goal.monthlyAmount)} a month` : ''}
                    </span>
                    <span className="mt-2 block h-2 overflow-hidden rounded-full bg-[var(--ref-surface-container-highest)]" aria-hidden>
                      <span className="block h-full rounded-full transition-[width]" style={{ width: `${progress * 100}%`, background: color }} />
                    </span>
                    <span className={cn('mt-1.5 block text-xs', progress >= 1 ? 'font-medium text-[var(--color-success)]' : behind ? 'text-[var(--color-warning)]' : 'text-[var(--ref-on-surface-variant)]')}>
                      {progress >= 1
                        ? goal.kind === 'spend' ? 'Ready to buy.' : 'All there.'
                        : perMonth !== null
                          ? `${formatAmount(toGo)} to go: ${formatAmount(perMonth)} a month makes ${monthYear(goal.byDate!)}${behind ? `, more than the ${formatAmount(goal.monthlyAmount)} you plan` : ''}.`
                          : `${formatAmount(toGo)} to go.`}
                    </span>
                  </button>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <Button type="button" size="sm" variant={goal.setAside === 0 ? 'primary' : 'secondary'} className="h-[34px]" onClick={() => onMove(goal)}>Put money in</Button>
                    <Button type="button" size="sm" variant="secondary" className="h-[34px]" onClick={() => onComplete(goal)}>{goal.kind === 'spend' ? 'Bought it' : 'Done'}</Button>
                    <button type="button" aria-label={`Edit ${goal.name}`} onClick={() => onEdit(goal)} className="ml-auto grid h-[34px] w-[34px] place-items-center rounded-lg text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]"><Pencil className="h-4 w-4" aria-hidden /></button>
                  </div>
                </div>
                {selected && <History goalId={goal.id} />}
              </li>
            );
          })}
        </ul>
      )}

      {finished.length > 0 && (
        <div className="border-t border-[var(--color-border)]">
          <button type="button" aria-expanded={showDone} onClick={() => setShowDone((value) => !value)} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-[var(--ref-on-surface)] hover:bg-[var(--ref-surface-container-low)]/60 sm:px-5">
            Finished and archived · {finished.length}
            <ChevronDown className={cn('h-4 w-4 text-[var(--ref-on-surface-variant)] transition-transform', showDone && 'rotate-180')} aria-hidden />
          </button>
          {showDone && (
            <ul className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
              {finished.map((goal) => (
                <li key={goal.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-[var(--ref-on-surface)]">{goal.name}</p>
                    <p className="text-xs text-[var(--ref-on-surface-variant)]">{goal.status === 'done' ? `${goal.kind === 'spend' ? 'Bought' : 'Finished'}${goal.doneAt ? ` ${formatDate(goal.doneAt)}` : ''}` : 'Archived'} · {formatAmount(goal.targetAmount)}</p>
                  </div>
                  <Button type="button" size="sm" variant="secondary" className="h-[34px]" onClick={() => onReopen(goal)}><RotateCcw className="mr-1 inline h-3.5 w-3.5" aria-hidden />Reopen</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Section>
  );
}
