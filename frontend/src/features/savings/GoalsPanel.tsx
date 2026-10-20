import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn } from '../../lib/utils';
import { Section } from '../subscriptions/PageParts';
import { InfoHint } from './InfoHint';
import { durationLabel, monthDate, type GoalOutlook, type PlanGoal, type PlanPot } from './plan';
import { potColor } from './pots';

export type GoalSuggestion = { key: string; name: string; amount: number; byMonth: number | null; spend: boolean; source: string };

const monthYear = (month: number) => monthDate(month).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

/**
 * What the plan is for: each goal says when the plan reaches it and, when it misses a date, the
 * monthly saving that would make it. Selecting one marks it on the chart.
 */
export function GoalsPanel({ outlooks, pots, selectedId, onSelect, onAdd, onEdit, onRemove, onUseMonthly, suggestions, onAddSuggestion }: {
  outlooks: GoalOutlook[];
  pots: PlanPot[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: () => void;
  onEdit: (goal: PlanGoal) => void;
  onRemove: (goal: PlanGoal) => void;
  onUseMonthly: (goal: PlanGoal, monthly: number) => void;
  suggestions: GoalSuggestion[];
  onAddSuggestion: (suggestion: GoalSuggestion) => void;
}) {
  const { formatAmount } = useBalanceVisibility();
  return (
    <Section
      title="Goals"
      aside={
        <div className="flex items-center gap-2">
          <InfoHint label="How goals work" align="right">
            A goal’s cost is in today’s prices; the plan adds inflation. Each goal is paid from one pot, in order: dated goals by date, then the rest. <strong>Spent</strong> goals leave the pot when bought; <strong>kept</strong> ones stay in it, held back from later goals. Tap a goal to mark it on the chart.
          </InfoHint>
          <Button type="button" size="sm" variant="secondary" className="h-[34px]" onClick={onAdd}>
            <Plus className="mr-1 inline h-3.5 w-3.5" aria-hidden />Add goal
          </Button>
        </div>
      }
    >
      {outlooks.length === 0 ? (
        <p className="px-4 py-4 text-sm text-[var(--ref-on-surface-variant)] sm:px-5">Add what you’re saving for to see when the plan gets there, in today’s prices.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {outlooks.map(({ goal, reach, late, needed, chance }) => {
            const selected = goal.id === selectedId;
            const missed = goal.byMonth !== null && reach === null;
            const verb = goal.spend ? 'Bought' : 'Saved';
            const status = reach === null
              ? { text: 'Not within 50 years', tone: 'warn' as const }
              : reach === 0
                ? { text: goal.spend ? 'Affordable now' : 'Already there', tone: 'good' as const }
                : late === null
                  ? { text: `${verb} ${monthYear(reach)}`, tone: 'plain' as const }
                  : late === 0
                    ? { text: `${verb} ${monthYear(reach)} · on time`, tone: 'good' as const }
                    : { text: `${verb} ${monthYear(reach)} · ${durationLabel(late)} late`, tone: 'warn' as const };
            const potIndex = Math.max(0, pots.findIndex((pot) => pot.id === goal.potId));
            const pot = pots[potIndex]!;
            return (
              <li key={goal.id} className={cn('transition-colors', selected ? 'bg-[var(--color-accent)]/[0.07]' : 'hover:bg-[var(--ref-surface-container-low)]/60')}>
                <div className="flex items-start gap-3 px-4 py-3 sm:px-5">
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onSelect(selected ? null : goal.id)}
                    className="min-w-0 flex-1 text-left"
                    title={selected ? 'Hide it on the chart' : 'Show it on the chart'}
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 break-words text-sm font-medium text-[var(--ref-on-surface)]">{goal.name}</span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(goal.amount)}</span>
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
                      <span className="flex items-center gap-1.5 text-[var(--ref-on-surface-variant)]">
                        {pots.length > 1 && <><span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: potColor(potIndex) }} aria-hidden />{pot.name} ·{' '}</>}
                        {goal.spend ? 'spend' : 'keep'} · {goal.byMonth === null ? 'whenever' : `by ${monthYear(goal.byMonth)}`}
                      </span>
                      <span className={cn('font-medium', status.tone === 'good' && 'text-[var(--color-success)]', status.tone === 'warn' && 'text-[var(--color-warning)]', status.tone === 'plain' && 'text-[var(--ref-on-surface-variant)]')}>{status.text}</span>
                    </span>
                    {chance !== null && reach !== 0 && (
                      <span className="mt-1.5 flex items-center gap-2 text-[11px] text-[var(--ref-on-surface-variant)]">
                        <span className="h-1 w-16 overflow-hidden rounded-full bg-[var(--ref-surface-container-highest)]" aria-hidden>
                          <span className="block h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${Math.round(chance * 100)}%` }} />
                        </span>
                        {Math.round(chance * 100)}% of outcomes get there in time
                      </span>
                    )}
                  </button>
                  <div className="-mr-2 -mt-1 flex shrink-0">
                    <button type="button" aria-label={`Edit ${goal.name}`} onClick={() => onEdit(goal)} className="grid h-[34px] w-[34px] place-items-center rounded-lg text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]"><Pencil className="h-4 w-4" aria-hidden /></button>
                    <button type="button" aria-label={`Remove ${goal.name}`} onClick={() => onRemove(goal)} className="grid h-[34px] w-[34px] place-items-center rounded-lg text-[var(--ref-on-surface-variant)] hover:bg-[var(--color-danger)]/10 hover:text-[var(--color-danger)]"><Trash2 className="h-4 w-4" aria-hidden /></button>
                  </div>
                </div>
                {needed !== null && (missed || (late ?? 0) > 0) && (
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3 sm:px-5">
                    <p className="text-xs text-[var(--ref-on-surface-variant)]">
                      Saving <span className="font-semibold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(needed)}</span> a month{pots.length > 1 ? ` into ${pot.name}` : ''} makes it{needed > pot.monthly ? <>, <span className="tabular-nums">{formatAmount(needed - pot.monthly)}</span> more than now</> : ''}.
                    </p>
                    <Button type="button" size="sm" variant="secondary" className="h-[34px]" onClick={() => onUseMonthly(goal, needed)}>Use this amount</Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {suggestions.length > 0 && (
        <div className="border-t border-[var(--color-border)] px-4 py-3 sm:px-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]">Suggested</p>
          <ul className="mt-1 divide-y divide-[var(--color-border)]">
            {suggestions.map((suggestion) => (
              <li key={suggestion.key} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-[var(--ref-on-surface)]">{suggestion.name}</p>
                  <p className="truncate text-xs text-[var(--ref-on-surface-variant)]">{formatAmount(suggestion.amount)} · {suggestion.source}</p>
                </div>
                <Button type="button" size="sm" variant="secondary" className="h-[34px] shrink-0" onClick={() => onAddSuggestion(suggestion)}>
                  <Plus className="mr-1 inline h-3.5 w-3.5" aria-hidden />Add
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}
