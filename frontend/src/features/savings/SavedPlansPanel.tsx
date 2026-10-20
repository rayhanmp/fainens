import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn } from '../../lib/utils';
import { ListSkeleton, Section } from '../subscriptions/PageParts';
import { compactRupiah, durationLabel, runPlan, type PlanRun } from './plan';
import type { ValueMode } from './ProjectionChart';
import type { SavedPlan } from './queries';

export const MAX_COMPARED = 3;

/**
 * Plans kept for later: each one's end balance against the plan on screen, a switch to draw it on
 * the chart, and Open to carry on with it.
 */
export function SavedPlansPanel({ plans, loading, error, onRetry, current, mode, openId, comparedIds, onToggleCompare, onOpen, onRename, onDelete, onNew }: {
  plans: SavedPlan[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  current: PlanRun;
  mode: ValueMode;
  openId: number | null;
  comparedIds: number[];
  onToggleCompare: (id: number) => void;
  onOpen: (plan: SavedPlan) => void;
  onRename: (plan: SavedPlan) => void;
  onDelete: (plan: SavedPlan) => void;
  /** Start a fresh plan from the ledger. */
  onNew: () => void;
}) {
  const { formatAmount, balancesHidden } = useBalanceVisibility();
  const endOf = (run: PlanRun) => {
    const last = run.months[run.months.length - 1]!;
    return last.balance / (mode === 'real' ? last.deflator : 1);
  };
  const currentEnd = endOf(current);
  const currentMonths = current.months.length - 1;

  return (
    <Section
      title="Saved plans"
      aside={<Button type="button" size="sm" variant="secondary" className="h-[34px]" title="A fresh plan from your ledger figures" onClick={onNew}>New plan</Button>}
    >
      {loading ? <ListSkeleton rows={2} /> : error ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 px-4 py-4 text-sm text-[var(--color-danger)] sm:px-5">
          <span className="flex-1">{error}</span>
          <Button type="button" size="sm" variant="secondary" onClick={onRetry}>Retry</Button>
        </div>
      ) : plans.length === 0 ? (
        <p className="px-4 py-4 text-sm text-[var(--ref-on-surface-variant)] sm:px-5">Save this plan, change it, and save another to compare up to {MAX_COMPARED} on the chart. Saved plans follow you to every device.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {plans.map((plan) => {
            const run = runPlan(plan.inputs);
            const end = endOf(run);
            const months = plan.inputs.years * 12;
            // Only a like-for-like horizon gives a fair difference.
            const difference = months === currentMonths ? end - currentEnd : null;
            const isOpen = plan.id === openId;
            const compared = comparedIds.includes(plan.id);
            const canCompare = compared || comparedIds.length < MAX_COMPARED;
            return (
              <li key={plan.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap sm:px-5">
                <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
                  <p className="flex items-center gap-2 truncate text-sm font-medium text-[var(--ref-on-surface)]">
                    <span className="truncate">{plan.name}</span>
                    {isOpen && <span className="shrink-0 rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-accent)]">Open</span>}
                  </p>
                  <p className="truncate text-xs text-[var(--ref-on-surface-variant)]">
                    {formatAmount(Math.round(end))} in {durationLabel(months)}
                    {difference !== null && !isOpen && Math.abs(difference) >= 1 && (
                      <> · <span className={cn('font-medium', difference > 0 ? 'text-[var(--color-success)]' : 'text-[var(--ref-on-surface)]')}>{difference > 0 ? '+' : '−'}{balancesHidden ? '•••' : compactRupiah(Math.abs(difference))}</span> vs this plan</>
                    )}
                  </p>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    aria-pressed={compared}
                    disabled={isOpen || !canCompare}
                    title={isOpen ? 'This is the plan on screen' : !canCompare ? `Up to ${MAX_COMPARED} at once` : undefined}
                    className={cn('h-[34px] w-[92px]', compared && '!border-[var(--color-accent)] !bg-[var(--color-accent)]/10')}
                    onClick={() => onToggleCompare(plan.id)}
                  >
                    {compared ? 'On chart' : 'Compare'}
                  </Button>
                  <Button type="button" size="sm" variant="secondary" className="h-[34px]" disabled={isOpen} onClick={() => onOpen(plan)}>Open</Button>
                  <button type="button" aria-label={`Rename ${plan.name}`} onClick={() => onRename(plan)} className="grid h-[34px] w-[34px] place-items-center rounded-lg text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]"><Pencil className="h-4 w-4" aria-hidden /></button>
                  <button type="button" aria-label={`Delete ${plan.name}`} onClick={() => onDelete(plan)} className="grid h-[34px] w-[34px] place-items-center rounded-lg text-[var(--ref-on-surface-variant)] hover:bg-[var(--color-danger)]/10 hover:text-[var(--color-danger)]"><Trash2 className="h-4 w-4" aria-hidden /></button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
