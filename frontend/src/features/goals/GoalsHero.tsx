import { Check, Plus } from 'lucide-react';
import { BalanceVisibilityToggle } from '../../components/ui/BalanceVisibilityToggle';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn } from '../../lib/utils';
import { compactRupiah } from '../savings/plan';
import { coloredGoals, goalInk } from './colors';
import type { GoalDraft } from './dialogs';
import { GoalsIllustration } from './GoalsIllustration';
import type { GoalsOverview } from './queries';

const microLabel = 'text-[10px] font-bold uppercase tracking-[0.18em]';

/** A quick way to start a goal, like an emergency fund sized from your spending or a wishlist item. */
export type GoalStarter = { key: string; label: string; detail?: string; draft: Partial<GoalDraft> };

/** Free money, drawn as diagonal stripes so it never reads as another goal. */
const freeFill = 'repeating-linear-gradient(135deg, var(--ref-surface-container-high) 0 6px, var(--ref-surface-container-highest) 6px 12px)';

const STEPS = [
  { title: 'Add a goal', text: 'What it’s for and how much it needs.' },
  { title: 'Put money in', text: 'From your free money, now or every month. Nothing moves between accounts.' },
  { title: 'Use it', text: 'Bought it? Mark it and its money is used up. Or keep it, like an emergency fund.' },
] as const;

/**
 * The money you have today, split: one bar of everything your counted accounts hold, a coloured
 * stretch per goal for what's set aside and stripes for what's still free. Until goals hold
 * money, it walks you through the three steps.
 */
export function GoalsHero({ overview, selectedId, onSelect, onAdd, onAccounts, starters = [] }: {
  overview: GoalsOverview;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onAdd: (draft?: Partial<GoalDraft>) => void;
  /** Opens the choice of accounts that count. */
  onAccounts?: () => void;
  starters?: GoalStarter[];
}) {
  const { formatAmount, balancesHidden } = useBalanceVisibility();
  const goals = coloredGoals(overview.goals);
  const short = (value: number) => (balancesHidden ? '•••' : compactRupiah(value));
  const free = Math.max(0, overview.unassigned);
  const over = overview.unassigned < 0;
  const whole = Math.max(overview.available, overview.setAside, 1);
  const holding = goals.filter(({ goal }) => goal.setAside > 0);
  const counted = overview.accounts.filter((account) => account.included).length;
  // Where you are in the flow: no goals yet, goals without money, or both done.
  const step = goals.length === 0 ? 0 : holding.length === 0 ? 1 : 2;
  const formatted = formatAmount(Math.round(overview.available));
  const [prefix, digits] = formatted.startsWith('Rp') ? ['Rp', formatted.slice(2)] : ['', formatted];
  const accounts = `${counted} account${counted === 1 ? '' : 's'}`;

  return (
    <section className="plan-sky relative overflow-clip rounded-3xl text-white" aria-label="Your money today">
      <div className="flex items-start justify-between gap-4 px-5 pt-5 sm:px-7 sm:pt-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className={cn(microLabel, 'text-white/75')}>Your money today</p>
            <BalanceVisibilityToggle inverted className="h-7 w-7" />
          </div>
          <p className="mt-3 flex items-baseline gap-x-1.5 whitespace-nowrap">
            {prefix && <span className="font-headline text-xl font-bold text-white/70">{prefix}</span>}
            <span className="font-headline text-[clamp(2rem,9vw,3.25rem)] font-black leading-none tracking-tighter tabular-nums">{digits}</span>
          </p>
          <p className="mt-2 text-sm text-white/80">
            Cash and investments in{' '}
            {onAccounts
              ? <button type="button" onClick={onAccounts} title="Choose which accounts count" className="font-semibold text-white underline decoration-white/50 decoration-dotted underline-offset-4 hover:decoration-white">{accounts}</button>
              : <span className="font-semibold text-white">{accounts}</span>}
            . Splitting it here moves no money.
          </p>
        </div>
        <div className="-mb-4 -mt-2 hidden shrink-0 md:block"><GoalsIllustration envelopes={goals.map(({ goal, color }) => ({ key: goal.id, color, fill: goal.targetAmount > 0 ? goal.setAside / goal.targetAmount : 0 }))} /></div>
      </div>

      {/* The tray: the split itself, on the page's own surface so the goal colours read true. */}
      <div className="m-3 mt-5 rounded-2xl bg-[var(--color-surface)] p-4 text-[var(--ref-on-surface)] shadow-[0_10px_30px_rgb(11_27_58/0.25)] sm:m-5 sm:mt-6 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="flex flex-wrap gap-x-8 gap-y-1">
            <p>
              <span className="block text-xs text-[var(--ref-on-surface-variant)]">In goals</span>
              <span className="text-lg font-bold tabular-nums">{formatAmount(overview.setAside)}</span>
            </p>
            <p>
              <span className="block text-xs text-[var(--ref-on-surface-variant)]">{over ? 'Over by' : 'Free'}</span>
              <span className={cn('text-lg font-bold tabular-nums', over ? 'text-[var(--ref-error)]' : 'text-[var(--ref-primary)]')}>{formatAmount(Math.abs(overview.unassigned))}</span>
            </p>
          </div>
          {over && <p className="max-w-sm text-xs text-[var(--ref-error)]">Goals have more than your accounts hold now. Take some out, or wait for payday.</p>}
        </div>

        {/* The bar: goals in their colours, then the free stripes; 2px gaps keep the pieces apart. */}
        <div className="mt-3 flex h-11 gap-[2px] overflow-hidden rounded-xl" role="img" aria-label={`${formatAmount(overview.setAside)} in ${holding.length} goal${holding.length === 1 ? '' : 's'}, ${formatAmount(free)} free`}>
          {holding.map(({ goal, color }) => {
            const share = goal.setAside / whole;
            return (
              <button
                key={goal.id}
                type="button"
                onClick={() => onSelect(goal.id)}
                title={`${goal.name}: ${formatAmount(goal.setAside)}`}
                className={cn('flex min-w-[6px] items-center overflow-hidden px-2 text-left text-[11px] font-semibold transition-[filter,opacity]', selectedId !== null && selectedId !== goal.id ? 'opacity-55 hover:opacity-90' : 'hover:brightness-110')}
                style={{ flex: `0 1 ${share * 100}%`, background: color, color: goalInk(color) }}
              >
                {share >= 0.14 && <span className="truncate">{goal.name} · {short(goal.setAside)}</span>}
              </button>
            );
          })}
          {free > 0 && (
            <div className="flex min-w-[6px] flex-1 items-center justify-end overflow-hidden px-2.5 text-[11px] font-semibold text-[var(--ref-on-surface-variant)]" style={{ background: freeFill }}>
              {free / whole >= 0.14 && <span className="truncate rounded bg-[var(--color-surface)] px-1.5 py-0.5">Free · {short(free)}</span>}
            </div>
          )}
        </div>

        {/* Legend: every goal, even one without money yet, then the free part. */}
        {goals.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
            {goals.map(({ goal, color }) => (
              <li key={goal.id}>
                <button type="button" onClick={() => onSelect(goal.id)} className={cn('flex items-center gap-1.5 rounded-md py-0.5 hover:text-[var(--ref-on-surface)]', goal.id === selectedId ? 'font-semibold text-[var(--ref-on-surface)]' : 'text-[var(--ref-on-surface-variant)]')}>
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} aria-hidden />
                  {goal.name}
                  <span className="tabular-nums text-[var(--ref-on-surface)]">{short(goal.setAside)}</span>
                </button>
              </li>
            ))}
            <li className="flex items-center gap-1.5 py-0.5 text-[var(--ref-on-surface-variant)]">
              <span className="h-2.5 w-2.5 rounded-sm ring-1 ring-inset ring-[var(--ref-outline)]/40" style={{ background: freeFill }} aria-hidden />
              Free <span className="tabular-nums text-[var(--ref-on-surface)]">{short(free)}</span>
            </li>
          </ul>
        )}

        {/* The flow, until goals hold money: where you are, and what's next. */}
        {step < 2 && (
          <ol className="mt-5 grid gap-3 border-t border-[var(--color-border)] pt-4 sm:grid-cols-3 sm:gap-5">
            {STEPS.map((item, index) => {
              const done = index < step;
              const current = index === step;
              return (
                <li key={item.title} className={cn('flex gap-3', !done && !current && 'opacity-60')}>
                  <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold', done ? 'bg-[var(--color-success)] text-white' : current ? 'bg-[var(--ref-primary)] text-white' : 'bg-[var(--ref-surface-container-high)] text-[var(--ref-on-surface-variant)]')}>
                    {done ? <Check className="h-3.5 w-3.5" aria-label="Done" /> : index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{item.title}</span>
                    <span className="block text-xs text-[var(--ref-on-surface-variant)]">{index === 1 && step === 1 ? 'Press Put money in on a goal below.' : item.text}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        {/* What to do now. */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {step === 0 ? (
            <>
              {starters.length > 0 && <span className="mr-1 text-xs font-semibold text-[var(--ref-on-surface-variant)]">Start with</span>}
              {starters.map((starter) => (
                <button key={starter.key} type="button" onClick={() => onAdd(starter.draft)} className="inline-flex h-[34px] max-w-full items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 text-xs font-semibold hover:bg-[var(--ref-surface-container-low)]">
                  <span className="truncate">{starter.label}</span>
                  {starter.detail && <span className="shrink-0 font-normal tabular-nums text-[var(--ref-on-surface-variant)]">{starter.detail}</span>}
                </button>
              ))}
              <button type="button" onClick={() => onAdd()} className="inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-[var(--ref-primary)] px-3 text-xs font-semibold text-white hover:opacity-90">
                <Plus className="h-3.5 w-3.5" aria-hidden />{starters.length ? 'Something else' : 'Add a goal'}
              </button>
            </>
          ) : (
            <button type="button" onClick={() => onAdd()} className="inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 text-xs font-semibold hover:bg-[var(--ref-surface-container-low)]">
              <Plus className="h-3.5 w-3.5" aria-hidden />Add goal
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
