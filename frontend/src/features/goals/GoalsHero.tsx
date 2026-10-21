import { Check, Plus, Sparkles } from 'lucide-react';
import { BalanceVisibilityToggle } from '../../components/ui/BalanceVisibilityToggle';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn } from '../../lib/utils';
import { compactRupiah } from '../savings/plan';
import { coloredGoals, GOAL_COLORS } from './colors';
import type { GoalDraft } from './dialogs';
import type { GoalsOverview } from './queries';

const microLabel = 'text-[10px] font-bold uppercase tracking-[0.18em]';

/** A quick way to start a goal, like an emergency fund sized from your spending or a wishlist item. */
export type GoalStarter = { key: string; label: string; detail?: string; draft: Partial<GoalDraft> };

/** Free money, drawn as diagonal stripes so it never reads as another goal. */
const freeFill = 'repeating-linear-gradient(135deg, var(--ref-surface-container-high) 0 6px, var(--ref-surface-container-highest) 6px 12px)';

/** A wallet tipping coins into three envelopes, one in each of the first goal colours. */
function SplitIllustration() {
  const envelopes = [{ x: 106, y: 18, rotate: -8 }, { x: 140, y: 40, rotate: 4 }, { x: 112, y: 66, rotate: -2 }];
  return (
    <svg viewBox="0 0 190 120" className="h-[110px] w-[176px]" aria-hidden>
      <defs>
        <linearGradient id="goals-wallet" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#1e3a8a" />
          <stop offset="100%" stopColor="#0b1b3a" />
        </linearGradient>
        <linearGradient id="goals-coin" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#fef3c7" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      {/* The wallet, open, with a stitched edge, a clasp and notes peeking out. */}
      <g transform="rotate(-10 44 76)">
        <rect x="18" y="40" width="44" height="18" rx="3" fill="#a7f3d0" transform="rotate(-6 40 49)" />
        <rect x="24" y="36" width="44" height="18" rx="3" fill="#d1fae5" transform="rotate(4 46 45)" />
        <text x="38" y="50" fontSize="8" fontWeight="700" fill="#047857" transform="rotate(4 46 45)">Rp</text>
        <rect x="8" y="52" width="76" height="50" rx="9" fill="url(#goals-wallet)" />
        <rect x="13" y="57" width="66" height="40" rx="6" fill="none" stroke="#93c5fd" strokeOpacity="0.55" strokeDasharray="3 3" />
        <path d="M8 66 H70 a8 8 0 0 1 8 8 v4 a8 8 0 0 1 -8 8 H8 Z" fill="#1d4ed8" />
        <circle cx="68" cy="78" r="4" fill="#fde68a" stroke="#b45309" strokeWidth="1" />
      </g>
      {/* Coins on their way, each a little smaller as it flies. */}
      <path d="M70 46 q10 -14 22 -18 M74 60 q12 0 20 -2" fill="none" stroke="white" strokeOpacity="0.5" strokeWidth="1.2" strokeDasharray="2 3" strokeLinecap="round" />
      {[{ cx: 82, cy: 40, r: 7 }, { cx: 96, cy: 58, r: 6 }, { cx: 92, cy: 26, r: 5 }].map((coin) => (
        <g key={coin.cx}>
          <circle cx={coin.cx} cy={coin.cy} r={coin.r} fill="url(#goals-coin)" stroke="#b45309" strokeWidth="0.8" />
          <circle cx={coin.cx} cy={coin.cy} r={coin.r * 0.6} fill="none" stroke="#b45309" strokeOpacity="0.5" strokeWidth="0.6" />
        </g>
      ))}
      {/* Envelopes, each sealed in a goal colour. */}
      {envelopes.map((envelope, index) => (
        <g key={index} transform={`translate(${envelope.x} ${envelope.y}) rotate(${envelope.rotate} 24 16)`}>
          <rect width="48" height="32" rx="4" fill="#ffffff" />
          <path d="M0 4 L24 19 L48 4" fill="none" stroke="#cbd5e1" strokeWidth="1.4" />
          <path d="M0 30 L18 15 M48 30 L30 15" fill="none" stroke="#e2e8f0" strokeWidth="1.2" />
          <circle cx="24" cy="19" r="5" fill={GOAL_COLORS[index]} />
          <path d="M22 19 l1.6 1.8 l3 -3.4" fill="none" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      ))}
      <path d="M170 14 l1.6 4 l4 1.6 l-4 1.6 l-1.6 4 l-1.6 -4 l-4 -1.6 l4 -1.6 Z" fill="white" fillOpacity="0.85" />
      <path d="M100 100 l1 2.6 l2.6 1 l-2.6 1 l-1 2.6 l-1 -2.6 l-2.6 -1 l2.6 -1 Z" fill="white" fillOpacity="0.6" />
    </svg>
  );
}

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
export function GoalsHero({ overview, selectedId, onSelect, onAdd, onFundMonthly, funding, monthlyTotal, onAccounts, starters = [] }: {
  overview: GoalsOverview;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onAdd: (draft?: Partial<GoalDraft>) => void;
  onFundMonthly: () => void;
  funding: boolean;
  /** What the goals' monthly amounts still ask for this month. */
  monthlyTotal: number;
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
  const fundable = Math.min(monthlyTotal, free);
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
        <div className="hidden shrink-0 sm:block"><SplitIllustration /></div>
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
                className={cn('flex min-w-[6px] items-center overflow-hidden px-2 text-left text-[11px] font-semibold text-white transition-[filter,opacity]', selectedId !== null && selectedId !== goal.id ? 'opacity-55 hover:opacity-90' : 'hover:brightness-110')}
                style={{ flex: `0 1 ${share * 100}%`, background: color }}
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
            <>
              {monthlyTotal > 0 && (
                <button
                  type="button"
                  disabled={funding || fundable <= 0}
                  onClick={onFundMonthly}
                  title={fundable <= 0 ? 'Nothing is free to put in' : 'Put each goal’s monthly amount in from your free money'}
                  className="inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-[var(--ref-primary)] px-3 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />Put in {formatAmount(fundable > 0 ? fundable : monthlyTotal)} for this month
                </button>
              )}
              <button type="button" onClick={() => onAdd()} className="inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 text-xs font-semibold hover:bg-[var(--ref-surface-container-low)]">
                <Plus className="h-3.5 w-3.5" aria-hidden />Add goal
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
