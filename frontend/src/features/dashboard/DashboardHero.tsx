import { Link } from '@tanstack/react-router';
import { ArrowRight, BarChart3, Plus } from 'lucide-react';
import { BalanceVisibilityToggle } from '../../components/ui/BalanceVisibilityToggle';
import { cn, formatDate } from '../../lib/utils';
import { microLabel } from './panel-styles';
import mountainHero from '../../assets/dashboard-mountain-hero.png';
import type { UpcomingCommitments } from './commitments';
import type { HeroCopy } from './hero-copy';
import { PeekableAmount } from './PeekableAmount';
import { formatPercent, paceTone, type PeriodPacing } from './pacing';
import type { DashboardMetric } from './view-preferences';

/** `value` is the display text (amount, or a state like "Loading…"); `cents` is set when it is an amount that can be peeked. */
export type BalanceMetric = { label: string; value: string; cents?: number; to: '/accounts' | '/budget' };

/** Where the selected period stands, drawn under the Budget left metric. */
export type BudgetPace = { pacing: PeriodPacing; usedRatio: number | null; dailyBudget: number | null; daysRemaining: number | null };

const metricValue = (metric: BalanceMetric) => (metric.cents != null ? <PeekableAmount cents={metric.cents} /> : metric.value);
export type BalanceMetrics = Record<DashboardMetric, BalanceMetric>;

export function DashboardHero({ greeting, copy, mainMetric, metrics, budgetPace, commitments, isCommitmentsLoading, formatAmount, onAddTransaction, onViewReport }: {
  greeting: string;
  copy: HeroCopy;
  mainMetric: DashboardMetric;
  metrics: BalanceMetrics;
  budgetPace: BudgetPace | null;
  commitments: UpcomingCommitments;
  isCommitmentsLoading: boolean;
  formatAmount: (cents: number) => string;
  onAddTransaction: () => void;
  onViewReport: () => void;
}) {
  const main = metrics[mainMetric];
  return (
    <section className="relative rounded-3xl bg-[#102b4d] text-white" aria-labelledby="dashboard-hero-title">
      <img src={mountainHero} alt="" className="absolute inset-0 h-full w-full rounded-3xl object-cover object-center" />
      <div className="absolute inset-0 rounded-3xl bg-[linear-gradient(90deg,rgba(7,29,55,0.98)_0%,rgba(9,35,66,0.88)_48%,rgba(12,41,72,0.35)_100%)]" />
      <div className="absolute inset-0 rounded-3xl bg-[linear-gradient(0deg,rgba(5,24,44,0.5),transparent_55%)]" />
      <div className="relative grid gap-5 p-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,1fr)] lg:items-center">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white/88">{greeting}</p>
          <h1 id="dashboard-hero-title" className="mt-1 text-2xl leading-tight tracking-tight text-white sm:text-3xl">{copy.headline}</h1>
          <p className="mt-2 text-sm leading-relaxed text-white/88">{copy.message}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {/* The hero is dark in both themes; an arbitrary white avoids the global `.dark .bg-white` surface override. */}
            <button type="button" onClick={onAddTransaction} className="inline-flex min-h-11 items-center justify-center gap-2.5 rounded-full bg-[#ffffff] px-5 py-2.5 text-sm font-bold text-[#10243e] shadow-sm transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-[#132747] text-white"><Plus className="h-3.5 w-3.5" strokeWidth={3} /></span>
              Add transaction
            </button>
            <button type="button" onClick={onViewReport} className="inline-flex min-h-11 items-center justify-center gap-2.5 rounded-full border border-white/55 bg-white/5 px-5 py-2.5 text-sm font-bold text-white backdrop-blur-sm transition hover:bg-white/12 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
              <BarChart3 className="h-5 w-5" />
              View report
            </button>
          </div>
        </div>
        <aside className="dashboard-main-balance hidden rounded-2xl border border-white/20 bg-[#091d35]/55 p-4 backdrop-blur-sm md:block" aria-label="Financial summary">
          <div className="flex items-center justify-between gap-3"><p className={`${microLabel} text-white/65`}>At a glance</p><div className="flex min-w-0 items-center gap-2">{budgetPace && <BudgetPaceLabel pace={budgetPace} />}<BalanceVisibilityToggle inverted className="h-8 w-8" /></div></div>
          <Link to={main.to} className="group/budget relative mt-3 block"><span className="text-xs text-white/70">{main.label}</span><strong className="mt-0.5 block truncate text-xl">{metricValue(main)}</strong>{mainMetric === 'budget' && safePaceTip(budgetPace, formatAmount, 'left-0')}</Link>
          {/* The divider doubles as the period pacing bar when there is a tracked budget. */}
          {budgetPace ? <BudgetPaceBar pace={budgetPace} /> : <div className="mt-3 h-px bg-white/15" />}
          <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
            {(['netWorth', 'budget', 'cash'] as const).filter((id) => id !== mainMetric).map((id) => <Link key={id} to={metrics[id].to} className="group/budget relative"><span className="block text-white/60">{metrics[id].label}</span><strong className="mt-1 block truncate">{metricValue(metrics[id])}</strong>{id === 'budget' && safePaceTip(budgetPace, formatAmount, 'left-0')}</Link>)}
            <CommitmentsSummary commitments={commitments} isLoading={isCommitmentsLoading} formatAmount={formatAmount} />
          </div>
        </aside>
      </div>
    </section>
  );
}

const paceFill = { ok: 'bg-white', warning: 'bg-amber-400', danger: 'bg-rose-400' } as const;
const paceText = { ok: 'text-white/85', warning: 'text-amber-300', danger: 'text-rose-300' } as const;

function paceDetail({ pacing, usedRatio }: BudgetPace): string {
  return [
    `${formatPercent(pacing.elapsedRatio)} of the period elapsed`,
    usedRatio != null ? `${formatPercent(usedRatio)} of the budget used` : null,
  ].filter(Boolean).join(' · ');
}


const paceTip = 'pointer-events-none absolute top-[calc(100%+0.5rem)] z-40 hidden whitespace-nowrap rounded-xl border border-white/15 bg-[#0a1b33]/95 px-3 py-2 text-left text-[11px] leading-relaxed text-white/80 shadow-xl backdrop-blur-sm';
/** Keeps a tooltip anchored at a layer's end from leaving the card. */
const tipAlign = (ratio: number) => (ratio < 0.25 ? 'left-0' : ratio > 0.6 ? 'right-0' : 'left-full -translate-x-1/2');

/** "Safe pace Rp… a day for the remaining N days", shown while hovering the Budget left metric. */
function safePaceTip(pace: BudgetPace | null, formatAmount: (cents: number) => string, align: string) {
  if (!pace || pace.dailyBudget == null) return null;
  const remaining = pace.daysRemaining != null && pace.daysRemaining > 0 ? ` for the remaining ${pace.daysRemaining} day${pace.daysRemaining === 1 ? '' : 's'}` : '';
  return <span role="tooltip" className={cn(paceTip, align, 'group-hover/budget:block')}>Safe pace <span className="text-white">{formatAmount(pace.dailyBudget)}</span> a day{remaining}</span>;
}

/** "Day 24 of 30 · 35% budget used" in the card header. */
function BudgetPaceLabel({ pace }: { pace: BudgetPace }) {
  const { pacing, usedRatio } = pace;
  const tone = usedRatio != null ? paceTone(usedRatio, pacing.elapsedRatio) : 'ok';
  const dayLabel = pacing.status === 'active' ? `Day ${pacing.dayIndex} of ${pacing.totalDays}` : pacing.status === 'ended' ? 'Period ended' : 'Not started';
  return (
    <Link to="/budget" className="dashboard-pace-label flex min-w-0 items-center gap-1.5 text-[11px] leading-none text-white/65">
      {/* A miniature of the divider bar, so the label reads as its legend. */}
      <span className="relative h-[3px] w-5 shrink-0 rounded-full bg-white/20" aria-hidden>
        <span className="absolute inset-y-0 left-0 rounded-full bg-white/40" style={{ width: `${pacing.elapsedRatio * 100}%` }} />
        {usedRatio != null && <span className={cn('absolute inset-y-0 left-0 rounded-full', paceFill[tone])} style={{ width: `${Math.min(1, usedRatio) * 100}%` }} />}
      </span>
      <span className="truncate">{dayLabel}{usedRatio != null && <> · <span className={cn('font-semibold', paceText[tone])}>{formatPercent(usedRatio)} budget used</span></>}</span>
    </Link>
  );
}

/**
 * The card divider as a pacing bar: period time elapsed (faint) under budget used (solid).
 * Each layer explains itself on hover, with a taller invisible hit area since the bar is only 3px.
 */
function BudgetPaceBar({ pace }: { pace: BudgetPace }) {
  const { pacing, usedRatio } = pace;
  const tone = usedRatio != null ? paceTone(usedRatio, pacing.elapsedRatio) : 'ok';
  const elapsedText = pacing.status === 'active' ? `${formatPercent(pacing.elapsedRatio)} of the period has passed · day ${pacing.dayIndex} of ${pacing.totalDays}` : pacing.status === 'ended' ? `The period has ended · ${pacing.totalDays} days` : `The period has not started · ${pacing.totalDays} days`;
  const paceNote = tone === 'warning' ? ' · ahead of the calendar' : tone === 'danger' ? ' · over the plan' : '';
  const layer = 'absolute inset-y-0 left-0 rounded-full transition-shadow before:absolute before:-inset-y-2 before:inset-x-0 before:content-[""] hover:z-10 hover:shadow-[0_0_0_2px_rgba(255,255,255,0.55)]';
  return (
    <Link to="/budget" aria-label={paceDetail(pace)} className="dashboard-pace-bar relative mt-3 block h-[3px] rounded-full bg-white/15">
      <span className={cn('group/elapsed', layer, 'bg-white/35')} style={{ width: `${pacing.elapsedRatio * 100}%` }}>
        <span role="tooltip" className={cn(paceTip, tipAlign(pacing.elapsedRatio), 'group-hover/elapsed:block')}>{elapsedText}</span>
      </span>
      {usedRatio != null && <span className={cn('group/used', layer, paceFill[tone])} style={{ width: `${Math.min(1, usedRatio) * 100}%` }}>
        <span role="tooltip" className={cn(paceTip, tipAlign(Math.min(1, usedRatio)), 'group-hover/used:block')}>
          <span className={cn('block', paceText[tone])}>{formatPercent(usedRatio)} of the budget used{paceNote}</span>
        </span>
      </span>}
    </Link>
  );
}

function CommitmentsSummary({ commitments, isLoading, formatAmount }: { commitments: UpcomingCommitments; isLoading: boolean; formatAmount: (cents: number) => string }) {
  const { subscriptions, payLater, loans } = commitments;
  return (
    <div className="group relative min-w-0">
      <button type="button" className="block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" aria-describedby="upcoming-commitments-tip">
        <span className="block truncate text-white/60">Due · 30d</span>
        <strong className="mt-1 block truncate">{isLoading ? 'Loading…' : commitments.count > 0 ? <PeekableAmount cents={commitments.total} /> : 'None'}</strong>
      </button>
      {/* Same dark, compact surface as the pacing and Budget left tooltips; sits above the cell since it is at the card's bottom edge. */}
      <div id="upcoming-commitments-tip" role="tooltip" className="pointer-events-none absolute bottom-[calc(100%+0.5rem)] right-0 z-40 hidden max-h-60 w-60 overflow-y-auto rounded-xl border border-white/15 bg-[#0a1b33]/95 px-3 py-2 text-left text-[11px] leading-relaxed text-white/80 shadow-xl backdrop-blur-sm group-hover:block group-focus-within:block">
        {commitments.count === 0 ? <p>No subscriptions, PayLater or borrowed loans due in the next 30 days.</p> : <div className="space-y-1">
          {subscriptions.length > 0 && <>
            <p className="flex justify-between gap-3"><span>Subscriptions · {subscriptions.length}</span><span className="text-white">{formatAmount(commitments.subscriptionTotal)}</span></p>
            <div className="space-y-0.5 pb-1">
              {subscriptions.map((subscription) => <p key={subscription.id} className="flex items-center justify-between gap-3 text-white/60"><span className="flex min-w-0 items-center gap-1"><span className="min-w-0 truncate">{subscription.name}</span><span className="shrink-0 whitespace-nowrap text-white/40">· {formatDate(subscription.nextRenewalAt)}</span></span><span className="shrink-0">{formatAmount(subscription.amount)}</span></p>)}
            </div>
          </>}
          {payLater.length > 0 && <p className="flex justify-between gap-3"><span>PayLater · {payLater.length}</span><span className="text-white">{formatAmount(commitments.payLaterTotal)}</span></p>}
          {loans.length > 0 && <p className="flex justify-between gap-3"><span>Borrowed loans · {loans.length}</span><span className="text-white">{formatAmount(commitments.loanTotal)}</span></p>}
        </div>}
      </div>
    </div>
  );
}

/** Phone-only summary that stands in for the hero's "At a glance" panel. */
export function DashboardTodayCard({ mainMetric, metrics, dailyBudget, formatAmount }: {
  mainMetric: DashboardMetric;
  metrics: BalanceMetrics;
  dailyBudget: number | null;
  formatAmount: (cents: number) => string;
}) {
  const main = metrics[mainMetric];
  return (
    <section className="mt-5 space-y-4 md:hidden" aria-label="Today">
      <div className="cash-satin rounded-[1.75rem] bg-[var(--ref-primary-container)] p-5 text-[var(--ref-on-primary-container)]">
        <div className="flex items-center justify-between gap-2"><p className={`${microLabel} opacity-75`}>{mainMetric === 'cash' ? 'Available today' : main.label}</p><BalanceVisibilityToggle className="text-inherit hover:bg-black/5" /></div>
        <p className="mt-2 font-headline text-3xl font-extrabold tracking-tight">{metricValue(main)}</p>
        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-black/10 pt-4 text-sm">
          {(['budget', 'netWorth', 'cash'] as const).filter((id) => id !== mainMetric).map((id) => <Link key={id} to={metrics[id].to} className="rounded-2xl bg-white/15 p-3"><span className={`block ${microLabel} opacity-70`}>{metrics[id].label}</span><strong className="mt-1 block truncate">{metricValue(metrics[id])}</strong></Link>)}
        </div>
      </div>
      {dailyBudget != null && <Link to="/budget" className="flex items-center justify-between rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-4 py-3"><span><span className="block text-xs text-[var(--ref-on-surface-variant)]">Safe daily pace</span><strong className="text-sm">{formatAmount(dailyBudget)} per day</strong></span><ArrowRight className="h-4 w-4 text-[var(--ref-primary)]" /></Link>}
    </section>
  );
}
