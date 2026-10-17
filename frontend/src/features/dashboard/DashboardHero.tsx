import { Link } from '@tanstack/react-router';
import { ArrowRight, BarChart3, Plus } from 'lucide-react';
import { BalanceVisibilityToggle } from '../../components/ui/BalanceVisibilityToggle';
import { cn, formatDate } from '../../lib/utils';
import { microLabel, tooltipSurface } from './panel-styles';
import mountainHero from '../../assets/dashboard-mountain-hero.png';
import type { UpcomingCommitments } from './commitments';
import type { HeroCopy } from './hero-copy';
import { PeekableAmount } from './PeekableAmount';
import type { DashboardMetric } from './view-preferences';

/** `value` is the display text (amount, or a state like "Loading…"); `cents` is set when it is an amount that can be peeked. */
export type BalanceMetric = { label: string; value: string; cents?: number; to: '/accounts' | '/budget' };

const metricValue = (metric: BalanceMetric) => (metric.cents != null ? <PeekableAmount cents={metric.cents} /> : metric.value);
export type BalanceMetrics = Record<DashboardMetric, BalanceMetric>;

export function DashboardHero({ greeting, copy, mainMetric, metrics, commitments, isCommitmentsLoading, formatAmount, onAddTransaction, onViewReport }: {
  greeting: string;
  copy: HeroCopy;
  mainMetric: DashboardMetric;
  metrics: BalanceMetrics;
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
          <div className="flex items-center justify-between"><p className={`${microLabel} text-white/65`}>At a glance</p><BalanceVisibilityToggle inverted className="h-8 w-8" /></div>
          <Link to={main.to} className="mt-3 block"><span className="text-xs text-white/70">{main.label}</span><strong className="mt-0.5 block truncate text-xl">{metricValue(main)}</strong></Link>
          <div className="mt-3 grid grid-cols-3 gap-3 border-t border-white/15 pt-3 text-xs">
            {(['netWorth', 'budget', 'cash'] as const).filter((id) => id !== mainMetric).map((id) => <Link key={id} to={metrics[id].to}><span className="block text-white/60">{metrics[id].label}</span><strong className="mt-1 block truncate">{metricValue(metrics[id])}</strong></Link>)}
            <CommitmentsSummary commitments={commitments} isLoading={isCommitmentsLoading} formatAmount={formatAmount} />
          </div>
        </aside>
      </div>
    </section>
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
      <div id="upcoming-commitments-tip" role="tooltip" className={cn(tooltipSurface, 'bottom-[calc(100%+0.75rem)] right-0 max-h-60 overflow-y-auto')}>
        <p className="font-bold text-[var(--ref-on-surface)]">Upcoming commitments</p>
        {commitments.count === 0 ? <p className="mt-1 text-[11px] leading-relaxed text-[var(--ref-on-surface-variant)]">No subscriptions, PayLater, or borrowed loans due in the next 30 days.</p> : <div className="mt-2 space-y-1.5 text-[11px] text-[var(--ref-on-surface-variant)]">
          {subscriptions.length > 0 && <>
            <p className="flex justify-between gap-3"><span>Subscriptions · {subscriptions.length}</span><strong className="text-[var(--ref-on-surface)]">{formatAmount(commitments.subscriptionTotal)}</strong></p>
            <div className="mt-2 space-y-1 border-t border-[var(--color-border)] pt-2">
              {subscriptions.map((subscription) => <p key={subscription.id} className="flex items-center justify-between gap-3"><span className="flex min-w-0 items-center gap-1"><span className="min-w-0 truncate text-[var(--ref-on-surface-variant)]">{subscription.name}</span><span className="shrink-0 whitespace-nowrap text-[var(--ref-outline)]">· {formatDate(subscription.nextRenewalAt)}</span></span><strong className="shrink-0 text-[var(--ref-on-surface)]">{formatAmount(subscription.amount)}</strong></p>)}
            </div>
          </>}
          {payLater.length > 0 && <p className="flex justify-between gap-3"><span>PayLater · {payLater.length}</span><strong className="text-[var(--ref-on-surface)]">{formatAmount(commitments.payLaterTotal)}</strong></p>}
          {loans.length > 0 && <p className="flex justify-between gap-3"><span>Borrowed loans · {loans.length}</span><strong className="text-[var(--ref-on-surface)]">{formatAmount(commitments.loanTotal)}</strong></p>}
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
