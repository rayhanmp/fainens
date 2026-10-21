import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn } from '../../lib/utils';
import { Section } from '../subscriptions/PageParts';
import { InfoHint } from './InfoHint';
import { compactRupiah, durationLabel, monthDate, potGoals, setAside, unallocated, type GoalOutlook, type PlanGoal, type PlanInputs } from './plan';
import { potColor } from './pots';

export type GoalSuggestion = { key: string; name: string; amount: number; byMonth: number | null; spend: boolean; source: string };

const monthYear = (month: number) => monthDate(month).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

/** Shades for the goals inside one pot's bar, so neighbours stand apart. */
const SHADES = [0.95, 0.7, 0.5, 0.82, 0.6];

/**
 * The money you have today, split per pot into what's set aside for each goal and what's
 * unallocated. Point at a part for its figure; tap a goal's part to mark the goal on the chart.
 */
function MoneyToday({ inputs, held, selectedId, onSelect }: { inputs: PlanInputs; held: Record<string, number>; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const { formatAmount, balancesHidden } = useBalanceVisibility();
  const pots = inputs.pots.map((pot, index) => ({ pot, index })).filter(({ pot }) => pot.start > 0);
  if (pots.length === 0) return null;
  const short = (value: number) => (balancesHidden ? '•••' : compactRupiah(value));
  return (
    <div className="space-y-3 border-b border-[var(--color-border)] px-4 py-3.5 sm:px-5">
      <div className="flex items-center gap-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ref-outline)]">Your money today</p>
        <InfoHint label="About your money today">Each pot’s money today, split into what’s set aside for a goal and what isn’t yet. Set money aside in a goal’s Already set aside; only that goal can use it.</InfoHint>
      </div>
      {pots.map(({ pot, index }) => {
        const parts = potGoals(inputs, pot.id).filter((goal) => (held[goal.id] ?? 0) > 0);
        const free = unallocated(inputs, pot);
        return (
          <div key={pot.id}>
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="font-semibold text-[var(--ref-on-surface)]">{inputs.pots.length > 1 ? pot.name : 'All of it'}</span>
              <span className="tabular-nums text-[var(--ref-on-surface-variant)]">{formatAmount(pot.start)}</span>
            </div>
            <div className="mt-1.5 flex h-3 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={[...parts.map((goal) => `${goal.name} ${formatAmount(held[goal.id] ?? 0)}`), `unallocated ${formatAmount(free)}`].join(', ')}>
              {parts.map((goal, position) => (
                <button
                  key={goal.id}
                  type="button"
                  title={`${goal.name}: ${formatAmount(held[goal.id] ?? 0)} set aside`}
                  aria-pressed={goal.id === selectedId}
                  onClick={() => onSelect(goal.id === selectedId ? null : goal.id)}
                  className={cn('h-full min-w-[4px] transition-opacity hover:opacity-100', goal.id === selectedId && 'outline outline-2 outline-offset-[-2px] outline-[var(--ref-on-surface)]')}
                  style={{ width: `${((held[goal.id] ?? 0) / pot.start) * 100}%`, background: potColor(index), opacity: SHADES[position % SHADES.length] }}
                />
              ))}
              {free > 0 && (
                <span
                  title={`Unallocated: ${formatAmount(free)}`}
                  className="h-full bg-[var(--ref-surface-container-highest)]"
                  style={{ width: `${(free / pot.start) * 100}%`, backgroundImage: 'repeating-linear-gradient(135deg, transparent 0 4px, color-mix(in srgb, var(--ref-outline) 25%, transparent) 4px 5px)' }}
                />
              )}
            </div>
            <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--ref-on-surface-variant)]">
              {parts.map((goal, position) => (
                <li key={goal.id} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm" style={{ background: potColor(index), opacity: SHADES[position % SHADES.length] }} aria-hidden />
                  {goal.name} <span className="tabular-nums text-[var(--ref-on-surface)]">{short(held[goal.id] ?? 0)}</span>
                </li>
              ))}
              <li className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-[var(--ref-surface-container-highest)] ring-1 ring-inset ring-[var(--ref-outline)]/40" aria-hidden />
                Unallocated <span className="tabular-nums text-[var(--ref-on-surface)]">{short(free)}</span>
              </li>
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/**
 * What the plan is for: each goal says when the plan reaches it and, when it misses a date, the
 * monthly saving that would make it. Selecting one marks it on the chart.
 */
export function GoalsPanel({ outlooks, inputs, selectedId, onSelect, onAdd, onEdit, onRemove, onUseMonthly, suggestions, onAddSuggestion }: {
  outlooks: GoalOutlook[];
  inputs: PlanInputs;
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
  const pots = inputs.pots;
  const held = Object.assign({}, ...pots.map((pot) => setAside(inputs, pot))) as Record<string, number>;
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
      <MoneyToday inputs={inputs} held={held} selectedId={selectedId} onSelect={onSelect} />

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
                    {(held[goal.id] ?? 0) > 0 && (
                      <span className="mt-1.5 flex items-center gap-2 text-[11px] text-[var(--ref-on-surface-variant)]">
                        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--ref-surface-container-highest)]" aria-hidden>
                          <span className="block h-full rounded-full" style={{ width: `${Math.min(100, ((held[goal.id] ?? 0) / goal.amount) * 100)}%`, background: potColor(potIndex) }} />
                        </span>
                        <span><span className="font-semibold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(held[goal.id] ?? 0)}</span> set aside today</span>
                      </span>
                    )}
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
