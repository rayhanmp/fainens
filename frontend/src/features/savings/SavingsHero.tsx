import { Check } from 'lucide-react';
import { BalanceVisibilityToggle } from '../../components/ui/BalanceVisibilityToggle';
import { Term } from '../../components/ui/Term';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn } from '../../lib/utils';
import { Segmented } from './fields';
import { PlanLandscape, type Landmark } from './PlanLandscape';
import { compactRupiah, durationLabel, monthDate, monthlyRate, type GoalOutlook, type PlanInputs, type PlanPot, type PlanRange, type PlanRun } from './plan';
import type { ValueMode } from './ProjectionChart';
import type { LedgerFacts } from './queries';

const microLabel = 'text-[10px] font-bold uppercase tracking-[0.18em]';

/**
 * The plan as a climb: today at the foot, the destination at the summit, and a landscape drawn
 * from the plan's own balance with a flag wherever a goal is reached. The ledger's figures run along
 * the ground as starting points you can use.
 */
export function SavingsHero({ inputs, run, range, outlooks, mode, onMode, ledger, pot, onUse }: {
  inputs: PlanInputs;
  run: PlanRun;
  range: PlanRange | null;
  outlooks: GoalOutlook[];
  mode: ValueMode;
  onMode: (mode: ValueMode) => void;
  ledger: LedgerFacts;
  /** The pot the ledger's figures fill. */
  pot: PlanPot;
  onUse: (field: 'start' | 'monthly', value: number) => void;
}) {
  const { formatAmount, balancesHidden } = useBalanceVisibility();
  const months = inputs.years * 12;
  const end = run.months[run.months.length - 1]!;
  const scale = mode === 'real' ? end.deflator : 1;
  const formatted = formatAmount(Math.round(end.balance / scale));
  const [prefix, digits] = formatted.startsWith('Rp') ? ['Rp', formatted.slice(2)] : ['', formatted];
  const endYear = monthDate(months).getFullYear();
  const net = mode === 'real' ? end.realNetDeposits : end.deposits - end.withdrawals;
  const growth = end.balance / scale - net;
  const earns = run.pots.reduce((sum, part) => sum + part.months[months]!.balance * monthlyRate(part.pot.returnRate), 0) / scale;
  const startTotal = inputs.pots.reduce((sum, item) => sum + item.start, 0);
  const monthlyTotal = inputs.pots.reduce((sum, item) => sum + item.monthly, 0);
  const several = inputs.pots.length > 1;
  const raises = new Set(inputs.pots.filter((item) => item.monthly > 0).map((item) => item.raise));
  const averageReturn = end.balance > 0 ? run.pots.reduce((sum, part) => sum + part.months[months]!.balance * part.pot.returnRate, 0) / end.balance : 0;
  const low = range ? range.low[months]! / scale : null;
  const high = range ? range.high[months]! / scale : null;
  const mask = (text: string) => (balancesHidden ? '•••' : text);
  const strong = 'whitespace-nowrap font-semibold tabular-nums text-white';

  // The hill: each pot's balance, sampled to at most 120 points, in the chosen money.
  const every = Math.max(1, Math.ceil(months / 120));
  const layers = run.pots.map((part) => part.months.filter((row) => row.month % every === 0 || row.month === months).map((row) => row.balance / (mode === 'real' ? row.deflator : 1)));

  const when = (month: number) => (month === 0 ? 'Now' : monthDate(month).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }));
  const landmarks: Landmark[] = [
    ...outlooks.flatMap((outlook): Landmark[] => {
      const { goal, reach, late } = outlook;
      if (reach !== null && reach <= months) {
        return [{ key: goal.id, at: reach / months, kind: 'goal', label: goal.name, detail: `${reach === 0 ? 'Already there' : `Reached ${when(reach)}`}${late ? `, ${durationLabel(late)} late` : ''}` }];
      }
      if (goal.byMonth !== null && goal.byMonth <= months) return [{ key: goal.id, at: goal.byMonth / months, kind: 'miss', label: goal.name, detail: `Wanted by ${when(goal.byMonth)}, not reached` }];
      return [];
    }),
    ...inputs.events.filter((event) => event.month <= months).map((event): Landmark => ({
      key: event.id,
      at: event.month / months,
      kind: event.amount > 0 ? 'in' : 'out',
      label: event.label || (event.amount > 0 ? 'Money in' : 'Money out'),
      detail: `${event.amount > 0 ? '+' : '−'}${mask(compactRupiah(Math.abs(event.amount)))}, ${event.yearly ? `every year from ${when(event.month)}` : when(event.month)}`,
    })),
  ];

  return (
    <section className="plan-sky relative overflow-clip rounded-3xl text-white" aria-label="Your plan, from today to where it lands">
      {/* The sky and the landscape share one layer; the figures sit above it. */}
      <div className="relative">
      <PlanLandscape layers={layers} landmarks={landmarks} />
      <div className="relative z-10 px-5 pt-5 sm:px-7 sm:pt-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={cn(microLabel, 'text-white/75')}>Your plan · {durationLabel(months)}</p>
          <div className="flex items-center gap-1">
            <Segmented
              inverse
              ariaLabel="Show amounts"
              className="w-[214px]"
              value={mode}
              onChange={onMode}
              options={[{ value: 'nominal', label: `Rupiah of ${endYear}` }, { value: 'real', label: 'Today’s money' }]}
            />
            <BalanceVisibilityToggle inverted className="h-8 w-8" />
          </div>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className={cn(microLabel, 'text-white/65')}>Today</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{formatAmount(startTotal)}</p>
            <p className="mt-0.5 text-sm text-white/80">
              + <span className={strong}>{formatAmount(monthlyTotal)}</span> a month
              {several ? ` across ${inputs.pots.length} pots` : ''}
              {raises.size === 1 && [...raises][0]! > 0 ? `, ${[...raises][0]!.toLocaleString('id-ID')}% more each year` : raises.size > 1 ? ', rising each year' : ''}
            </p>
          </div>
          <div className="sm:text-right">
            <p className={cn(microLabel, 'text-white/65')}>{when(months)}, you’d have</p>
            <p className="mt-1 flex items-baseline gap-x-1.5 whitespace-nowrap sm:justify-end">
              {prefix && <span className="font-headline text-xl font-bold text-white/70">{prefix}</span>}
              <span className="font-headline text-[clamp(2rem,10vw,3.5rem)] font-black leading-none tracking-tighter tabular-nums">{digits}</span>
            </p>
            <p className="mt-1.5 text-sm text-white/80">
              {low !== null && high !== null
                ? <><Term meaning="Where 8 in 10 of the 400 possible futures end up, with returns that swing as much as your Uncertainty setting.">likely</Term> <span className={strong}>{mask(compactRupiah(low))}</span> – <span className={strong}>{mask(compactRupiah(high))}</span></>
                : mode === 'real' ? 'in today’s money' : 'in the rupiah of then'}
            </p>
          </div>
        </div>
        {run.emptiedAt !== null && (
          <p className="mt-3 inline-block rounded-lg bg-[#0b1b3a]/30 px-2.5 py-1 text-sm font-medium">A withdrawal in {when(run.emptiedAt)} takes more than the pot holds.</p>
        )}
      </div>
      {/* Room for the landscape below the figures. */}
      <div className="h-[150px] sm:h-[190px]" />
      </div>

      {/* The ground: what the climb is made of, and where you can start from. */}
      <div className="bg-[#0b1b3a]/30 px-5 pb-5 pt-4 sm:px-7 sm:pb-6">
        <p className="max-w-3xl text-sm leading-relaxed text-white/80">
          <Term meaning="Your starting amount plus every monthly saving and deposit, less withdrawals.">You put in</Term> <span className={strong}>{formatAmount(Math.round(net))}</span>
          {growth >= 0
            ? <>; <Term meaning="What returns earn on top of your own money: the balance minus what you put in.">growth adds</Term> <span className={strong}>{formatAmount(Math.round(growth))}</span></>
            : <>; inflation takes <span className={strong}>{formatAmount(Math.round(-growth))}</span></>}
          . By then it would <Term meaning={`What the final balance earns in a month at ${several ? `its pots’ returns (about ${averageReturn.toLocaleString('id-ID', { maximumFractionDigits: 1 })}% a year on average)` : `${averageReturn.toLocaleString('id-ID', { maximumFractionDigits: 2 })}% a year`}, if you stopped adding and left it alone.`}>earn</Term> <span className={strong}>{formatAmount(Math.round(earns))}</span> a month on its own.
        </p>
        <LedgerStrip pot={pot} several={several} ledger={ledger} onUse={onUse} />
      </div>
    </section>
  );
}

/** What the ledger says you have and save, each usable as the plan's starting point. */
function LedgerStrip({ pot, several, ledger, onUse }: { pot: PlanPot; several: boolean; ledger: LedgerFacts; onUse: (field: 'start' | 'monthly', value: number) => void }) {
  const { formatAmount } = useBalanceVisibility();
  const saving = ledger.saving;
  const items: Array<{ key: string; label: React.ReactNode; value: number | null; field: 'start' | 'monthly'; action: string; extra?: React.ReactNode }> = [
    {
      key: 'liquid',
      label: <Term meaning={`Balances of your ${ledger.liquidAccounts} active cash, bank, e-wallet and investment accounts. Money others owe you isn’t counted.`}>Cash and investments</Term>,
      value: ledger.liquid,
      field: 'start',
      action: 'Use as start',
    },
    {
      key: 'saving',
      label: <Term meaning={saving ? `Income minus spending, averaged over your last ${saving.periods.length} finished salary periods. Each bar is one period; point at it for its figure.` : 'Income minus spending per salary period, once you have finished periods.'}>You save a period</Term>,
      value: saving ? Math.max(0, saving.average) : null,
      field: 'monthly',
      action: 'Use as monthly',
      extra: saving && <SavingStrip periods={saving.periods} />,
    },
    {
      key: 'target',
      label: <Term meaning="The savings target on this period’s budget: what you planned to keep this period.">Budget target</Term>,
      value: ledger.target,
      field: 'monthly',
      action: 'Use as monthly',
    },
  ];

  return (
    <div className="mt-4">
      <p className={cn(microLabel, 'text-white/60')}>From your ledger{several ? ` · fills ${pot.name}` : ''}</p>
      {/* Three across, each with its button beneath; on phones one per row, the button beside. */}
      <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {items.map((item) => {
          const inUse = item.value !== null && item.value > 0 && pot[item.field] === item.value;
          return (
            <li key={item.key} className="flex items-center justify-between gap-3 rounded-xl bg-[#fff]/10 px-3 py-2.5 backdrop-blur-sm sm:flex-col sm:items-stretch sm:justify-start sm:gap-2">
              <div className="min-w-0">
                <p className="text-xs text-white/75">{item.label}</p>
                <div className="flex items-end gap-2">
                  <p className="truncate text-base font-bold tabular-nums">{item.value === null ? (ledger.loading ? '…' : '—') : formatAmount(item.value)}</p>
                  {item.extra}
                </div>
              </div>
              <button
                type="button"
                disabled={inUse || item.value === null || item.value <= 0}
                onClick={() => item.value !== null && onUse(item.field, item.value)}
                className={cn(
                  'inline-flex h-[34px] w-[118px] shrink-0 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors sm:mt-auto sm:w-full',
                  // Explicit white: the app turns `bg-white` dark in dark mode.
                  inUse ? 'text-white' : 'bg-[#fff] text-[#0b2a5c] hover:bg-[#fff]/90 disabled:bg-[#fff]/10 disabled:text-white/50',
                )}
              >
                {inUse ? <><Check className="h-3.5 w-3.5" aria-hidden />In use</> : item.action}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The last few periods' savings as small bars around a zero line; hover a bar for its figure. */
function SavingStrip({ periods }: { periods: Array<{ name: string; net: number }> }) {
  const { formatAmount } = useBalanceVisibility();
  const peak = Math.max(1, ...periods.map((period) => Math.abs(period.net)));
  const hasNegative = periods.some((period) => period.net < 0);
  const height = 18;
  const zero = hasNegative ? height / 2 : height;
  const span = hasNegative ? height / 2 : height;
  return (
    <svg width={periods.length * 6} height={height} className="mb-1 hidden shrink-0 overflow-visible sm:block" role="img" aria-label="Saved in each recent period">
      <line x1={0} x2={periods.length * 6 - 2} y1={zero} y2={zero} stroke="white" strokeOpacity={0.4} />
      {periods.map((period, index) => {
        const size = Math.max(1.5, (Math.abs(period.net) / peak) * span);
        return (
          <rect key={period.name + index} x={index * 6} y={period.net >= 0 ? zero - size : zero} width={4} height={size} rx={1} fill="white" fillOpacity={period.net >= 0 ? 0.9 : 0.4}>
            <title>{`${period.name}: ${formatAmount(period.net)}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
