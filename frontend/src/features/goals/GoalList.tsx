import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, GripVertical, Pencil, RotateCcw } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn, formatDate } from '../../lib/utils';
import { Section } from '../subscriptions/PageParts';
import { InfoHint } from '../savings/InfoHint';
import { coloredGoals } from './colors';
import { goalPace } from './pace';
import type { Goal, GoalsOverview } from './queries';

const monthYear = (time: number) => new Date(time).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

/** Moves the item at `from` to `to`, shifting the ones between. */
function moved<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/**
 * Every goal, in priority order: the top one gets money first when monthly amounts go in. Drag a
 * goal by its handle (or focus the handle and use the arrow keys) to change its place; open one
 * for its page. Finished and archived goals are folded away below.
 */
export function GoalList({ overview, selectedId, onMove, onComplete, onEdit, onReopen, onReorder }: {
  overview: GoalsOverview;
  selectedId: number | null;
  onMove: (goal: Goal) => void;
  onComplete: (goal: Goal) => void;
  onEdit: (goal: Goal) => void;
  onReopen: (goal: Goal) => void;
  /** The active goals' ids in their new order. */
  onReorder: (ids: number[]) => void;
}) {
  const { formatAmount } = useBalanceVisibility();
  const [showDone, setShowDone] = useState(false);
  const colored = coloredGoals(overview.goals);
  const [dragOrder, setDragOrder] = useState<number[] | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const order = dragOrder ?? colored.map(({ goal }) => goal.id);
  const active = order.map((id) => colored.find(({ goal }) => goal.id === id)!).filter(Boolean);
  const finished = overview.goals.filter((goal) => goal.status !== 'active');

  const commit = (ids: number[]) => {
    setDragOrder(null);
    setDragging(null);
    if (ids.join() !== colored.map(({ goal }) => goal.id).join()) onReorder(ids);
  };

  return (
    <Section
      title="Goals"
      aside={<InfoHint label="How goals work" align="right">Each goal is its own pot inside Fainens. Put money in from what’s free and take it out again any time; nothing moves between your accounts. The list is in priority order: drag a goal by its handle, and the top one gets money first when monthly amounts go in.</InfoHint>}
    >
      {active.length === 0 ? (
        <p className="px-4 py-4 text-sm text-[var(--ref-on-surface-variant)] sm:px-5">No goals yet. Add one to give part of your money a job.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]" onDragOver={(event) => event.preventDefault()}>
          {active.map(({ goal, color }, index) => {
            const { toGo, perMonth, behind } = goalPace(goal);
            const progress = goal.targetAmount > 0 ? Math.min(1, goal.setAside / goal.targetAmount) : 0;
            const selected = goal.id === selectedId;
            return (
              <li
                key={goal.id}
                id={`goal-${goal.id}`}
                draggable={dragging === goal.id}
                onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; setDragOrder(order); }}
                onDragEnter={() => {
                  if (dragging === null || dragging === goal.id) return;
                  setDragOrder((current) => {
                    const ids = current ?? order;
                    return moved(ids, ids.indexOf(dragging), ids.indexOf(goal.id));
                  });
                }}
                onDragEnd={() => commit(dragOrder ?? order)}
                className={cn('scroll-mt-24 transition-colors', selected && 'bg-[var(--color-accent)]/[0.06]', dragging === goal.id && dragOrder && 'opacity-60')}
              >
                <div className="flex gap-1 py-3.5 pl-1.5 pr-4 sm:pr-5">
                  {/* The handle: drag it, or focus it and press the arrow keys. */}
                  <button
                    type="button"
                    aria-label={`Move ${goal.name}, priority ${index + 1} of ${active.length}`}
                    title="Drag to change its priority"
                    onPointerDown={() => setDragging(goal.id)}
                    onPointerUp={() => { if (!dragOrder) setDragging(null); }}
                    onKeyDown={(event) => {
                      const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : -1;
                      if (to < 0 || to >= active.length) return;
                      event.preventDefault();
                      commit(moved(order, index, to));
                      requestAnimationFrame(() => (document.querySelector(`#goal-${goal.id} [aria-label^="Move"]`) as HTMLElement | null)?.focus());
                    }}
                    className="mt-0.5 grid h-7 w-6 shrink-0 cursor-grab touch-none place-items-center rounded-md text-[var(--ref-outline)] hover:bg-[var(--ref-surface-container-low)] active:cursor-grabbing"
                  >
                    <GripVertical className="h-4 w-4" aria-hidden />
                  </button>
                  <div className="min-w-0 flex-1">
                    <Link to="/goals/$goalId" params={{ goalId: String(goal.id) }} className="group -mx-2 -my-1 block rounded-lg px-2 py-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-[var(--ref-on-surface)]">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} aria-hidden />
                          {goal.icon && <span aria-hidden>{goal.icon}</span>}
                          <span className="truncate group-hover:underline">{goal.name}</span>
                          {goal.paused && <span className="shrink-0 rounded bg-[var(--ref-surface-container-high)] px-1.5 py-px text-[10px] font-semibold text-[var(--ref-on-surface-variant)]">Paused</span>}
                          {goal.recurrence === 'yearly' && <span className="shrink-0 rounded bg-[var(--ref-surface-container-high)] px-1.5 py-px text-[10px] font-semibold text-[var(--ref-on-surface-variant)]">Yearly</span>}
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--ref-outline)]" aria-hidden />
                        </span>
                        <span className="shrink-0 text-sm tabular-nums text-[var(--ref-on-surface-variant)]"><span className="font-semibold text-[var(--ref-on-surface)]">{formatAmount(goal.setAside)}</span> of {formatAmount(goal.targetAmount)}</span>
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-[var(--ref-on-surface-variant)]">
                        {goal.kind === 'spend' ? 'to buy' : 'to keep'}
                        {goal.byDate ? ` · by ${monthYear(goal.byDate)}` : ''}
                        {goal.monthlyAmount > 0 && !goal.paused ? ` · ${formatAmount(goal.monthlyAmount)} a month${goal.monthlyPercent ? ` (${goal.monthlyPercent}% of salary)` : ''}` : ''}
                      </span>
                      <span className="mt-2 block h-2 overflow-hidden rounded-full bg-[var(--ref-surface-container-highest)]" aria-hidden>
                        <span className="block h-full rounded-full transition-[width]" style={{ width: `${progress * 100}%`, background: color }} />
                      </span>
                      <span className={cn('mt-1.5 block text-xs', progress >= 1 ? 'font-medium text-[var(--color-success)]' : behind && !goal.paused ? 'text-[var(--color-warning)]' : 'text-[var(--ref-on-surface-variant)]')}>
                        {progress >= 1
                          ? goal.kind === 'spend' ? 'Ready to buy.' : 'All there.'
                          : perMonth !== null && !goal.paused
                            ? `${formatAmount(toGo)} to go: ${formatAmount(perMonth)} a month makes ${monthYear(goal.byDate!)}${behind ? `, more than the ${formatAmount(goal.monthlyAmount)} you plan` : ''}.`
                            : `${formatAmount(toGo)} to go.`}
                      </span>
                    </Link>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <Button type="button" size="sm" variant={goal.setAside === 0 ? 'primary' : 'secondary'} className="h-[34px]" onClick={() => onMove(goal)}>Put money in</Button>
                      {/* Money you keep is never finished; only a purchase is. */}
                      {goal.kind === 'spend' && <Button type="button" size="sm" variant="secondary" className="h-[34px]" onClick={() => onComplete(goal)}>{goal.recurrence === 'yearly' ? 'Paid this year' : 'Bought it'}</Button>}
                      <button type="button" aria-label={`Edit ${goal.name}`} onClick={() => onEdit(goal)} className="ml-auto grid h-[34px] w-[34px] place-items-center rounded-lg text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]"><Pencil className="h-4 w-4" aria-hidden /></button>
                    </div>
                  </div>
                </div>
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
                  <Link to="/goals/$goalId" params={{ goalId: String(goal.id) }} className="min-w-0 flex-1 hover:underline">
                    <span className="block truncate text-sm text-[var(--ref-on-surface)]">{goal.icon ? `${goal.icon} ` : ''}{goal.name}</span>
                    <span className="block text-xs text-[var(--ref-on-surface-variant)]">{goal.status === 'done' ? `${goal.kind === 'spend' ? 'Bought' : 'Finished'}${goal.doneAt ? ` ${formatDate(goal.doneAt)}` : ''}` : 'Archived'} · {formatAmount(goal.targetAmount)}</span>
                  </Link>
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
