import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { Banknote, Coins, Info, Landmark } from 'lucide-react';
import { cn, formatDate } from '../../lib/utils';
import { incomeKind, type MonthIncome, type PayCycle, type TakeHomeSegment } from './income-insights';

const card = 'rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-6 editorial-shadow';
const cardTitle = 'font-headline text-lg font-bold text-[var(--ref-on-surface)]';
const cardCaption = 'mt-1 text-xs text-[var(--ref-on-surface-variant)]';

/** Take-home keeps the accent; each deduction is a step of the same ink so the bar reads as one scale. */
const segmentFill: Record<TakeHomeSegment['key'], string> = {
  net: 'var(--color-accent)',
  pph21: 'color-mix(in srgb, var(--ref-on-surface) 70%, transparent)',
  jht: 'color-mix(in srgb, var(--ref-on-surface) 50%, transparent)',
  jp: 'color-mix(in srgb, var(--ref-on-surface) 35%, transparent)',
  bpjsKes: 'color-mix(in srgb, var(--ref-on-surface) 22%, transparent)',
};

const tip = 'pointer-events-none absolute z-40 hidden w-max max-w-72 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-left text-xs font-medium leading-relaxed text-[var(--ref-on-surface)] shadow-xl ring-1 ring-black/5 group-hover/hint:block group-focus-within/hint:block';

function Hint({ text, align = 'left', className, children }: { text: string; align?: 'left' | 'right'; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn('group/hint relative hover:z-30 focus-within:z-30', className)}>
      {children}
      <span role="tooltip" className={cn(tip, 'top-[calc(100%+0.375rem)]', align === 'right' ? 'right-0' : 'left-0')}>{text}</span>
    </span>
  );
}

type TakeHomeCardProps = {
  gross: number;
  net: number;
  segments: TakeHomeSegment[];
  method: string;
  notes: string[];
  depositAccountName: string | null;
  payrollDay: number;
  formatAmount: (amount: number) => string;
  onEditProfile: () => void;
};

/** Estimated monthly take-home with the gross-to-net split underneath. */
export function TakeHomeCard({ gross, net, segments, method, notes, depositAccountName, payrollDay, formatAmount, onEditProfile }: TakeHomeCardProps) {
  const keptShare = gross > 0 ? Math.round((net / gross) * 100) : 0;
  return (
    <section className={cn(card, 'flex flex-col')}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-[var(--ref-on-surface-variant)]">
            Estimated take-home
            <Hint text={`${method} method. ${notes.join(' ')} These are estimates, not tax advice.`}>
              <span tabIndex={0} aria-label="How this is calculated" className="grid h-5 w-5 place-items-center rounded text-[var(--ref-outline)] outline-none hover:text-[var(--ref-on-surface-variant)] focus-visible:ring-2 focus-visible:ring-[var(--ref-primary)]">
                <Info className="h-3.5 w-3.5" aria-hidden />
              </span>
            </Hint>
          </p>
          <p className="mt-2 font-headline text-4xl font-black tracking-tight text-[var(--ref-on-surface)] sm:text-5xl">{formatAmount(net)}</p>
          <p className="mt-2 text-sm text-[var(--ref-on-surface-variant)]">
            {keptShare}% of <span className="font-semibold text-[var(--ref-on-surface)]">{formatAmount(gross)}</span> gross a month
            {depositAccountName ? <>, paid into <span className="font-semibold text-[var(--ref-on-surface)]">{depositAccountName}</span> on day {payrollDay}</> : null}
          </p>
        </div>
        <button type="button" onClick={onEditProfile} className="shrink-0 rounded-full border border-[var(--color-border)] px-4 py-2 text-xs font-bold text-[var(--ref-on-surface)] transition-colors hover:bg-[var(--ref-surface-container-low)]">
          Edit profile
        </button>
      </div>

      <div className="mt-6 flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-[var(--ref-surface-container-highest)]" aria-hidden>
        {segments.map((segment) => (
          <div key={segment.key} className="h-full" style={{ width: `${segment.share * 100}%`, background: segmentFill[segment.key] }} />
        ))}
      </div>
      <ul className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2" aria-label="Where gross pay goes">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-center gap-2.5 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: segmentFill[segment.key] }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[var(--ref-on-surface)]">{segment.label}</span>
            <span className="tabular-nums text-[var(--ref-on-surface-variant)]">{formatAmount(segment.amount)}</span>
            <span className="w-11 text-right font-semibold tabular-nums text-[var(--ref-on-surface)]">{segment.share < 0.01 ? '<1' : (segment.share * 100).toFixed(segment.share < 0.1 ? 1 : 0)}%</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

type SetupCardProps = {
  recordedThisMonth: number;
  monthName: string;
  formatAmount: (amount: number) => string;
  onEditProfile: () => void;
};

/** Shown instead of the take-home card until a salary profile exists. */
export function SalarySetupCard({ recordedThisMonth, monthName, formatAmount, onEditProfile }: SetupCardProps) {
  return (
    <section className={cn(card, 'flex flex-col')}>
      <p className="text-xs font-bold uppercase tracking-widest text-[var(--ref-on-surface-variant)]">Income recorded in {monthName}</p>
      <p className="mt-2 font-headline text-4xl font-black tracking-tight text-[var(--ref-on-surface)] sm:text-5xl">{formatAmount(recordedThisMonth)}</p>
      <div className="mt-6 flex flex-col gap-3 rounded-2xl bg-[var(--ref-surface-container-low)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-bold text-[var(--ref-on-surface)]">Add your salary profile</p>
          <p className="mt-0.5 text-xs text-[var(--ref-on-surface-variant)]">Gross pay and PTKP give you PPh 21 and BPJS estimates, plus a payday countdown.</p>
        </div>
        <button type="button" onClick={onEditProfile} className="shrink-0 rounded-full bg-[var(--color-accent)] px-4 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90">
          Set up
        </button>
      </div>
    </section>
  );
}

type PaydayCardProps = {
  cycle: PayCycle;
  expectedNet: number | null;
  depositAccountName: string | null;
  recordedSinceLastPayday: number;
  formatAmount: (amount: number) => string;
  postAction?: { label: string; busy: boolean; onClick: () => void };
};

/** Countdown to the next payday, with how far the cycle has run and what has landed since the last one. */
export function PaydayCard({ cycle, expectedNet, depositAccountName, recordedSinceLastPayday, formatAmount, postAction }: PaydayCardProps) {
  return (
    <section className={cn(card, 'flex flex-col')}>
      <p className="text-xs font-bold uppercase tracking-widest text-[var(--ref-on-surface-variant)]">Next payday</p>
      <p className="mt-2 font-headline text-3xl font-extrabold leading-tight text-[var(--ref-on-surface)]">
        {cycle.isPayday ? 'Today' : cycle.daysLeft === 1 ? 'Tomorrow' : `In ${cycle.daysLeft} days`}
      </p>
      <p className="mt-1 text-sm text-[var(--ref-on-surface-variant)]">
        {formatDate(cycle.nextPayday)}
        {expectedNet != null && <> · about <span className="font-semibold text-[var(--ref-on-surface)]">{formatAmount(expectedNet)}</span>{depositAccountName ? ` into ${depositAccountName}` : ''}</>}
      </p>

      <div className="mt-5">
        <div className="h-1.5 w-full rounded-full bg-[var(--ref-surface-container-highest)]">
          <div className="h-full rounded-full bg-[var(--color-accent)] transition-[width]" style={{ width: `${cycle.progress * 100}%` }} />
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] text-[var(--ref-on-surface-variant)]">
          <span>Paid {formatDate(cycle.lastPayday)}</span>
          <span>{Math.round(cycle.progress * 100)}% of the cycle</span>
        </div>
      </div>

      <dl className="mt-5 flex items-baseline justify-between gap-3 border-t border-[var(--color-border)] pt-4 text-sm">
        <dt className="text-[var(--ref-on-surface-variant)]">Recorded since last payday</dt>
        <dd className="font-semibold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(recordedSinceLastPayday)}</dd>
      </dl>

      {postAction && (
        <button type="button" onClick={postAction.onClick} disabled={postAction.busy} className="mt-4 rounded-full border border-[var(--color-border)] px-4 py-2 text-xs font-bold text-[var(--ref-on-surface)] transition-colors hover:bg-[var(--ref-surface-container-low)] disabled:opacity-50">
          {postAction.label}
        </button>
      )}
    </section>
  );
}

type HistoryCardProps = {
  series: MonthIncome[];
  formatAmount: (amount: number) => string;
  loading: boolean;
};

const SALARY_FILL = 'var(--color-accent)';
const OTHER_FILL = 'color-mix(in srgb, var(--ref-on-surface) 35%, transparent)';

/** Six months of income, salary stacked under other income, with the averages that matter. */
export function IncomeHistoryCard({ series, formatAmount, loading }: HistoryCardProps) {
  const monthsWithIncome = series.filter((month) => month.total > 0);
  const average = monthsWithIncome.length ? monthsWithIncome.reduce((sum, month) => sum + month.total, 0) / monthsWithIncome.length : 0;
  const otherTotal = series.reduce((sum, month) => sum + month.other, 0);
  const grandTotal = series.reduce((sum, month) => sum + month.total, 0);
  const otherShare = grandTotal > 0 ? Math.round((otherTotal / grandTotal) * 100) : 0;
  return (
    <section className={card}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className={cardTitle}>Income history</h3>
          <p className={cardCaption}>Last six months, by calendar month.</p>
        </div>
        <dl className="flex gap-6 text-right">
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]">Monthly average</dt>
            <dd className="mt-0.5 text-sm font-bold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(Math.round(average))}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]">Other income</dt>
            <dd className="mt-0.5 text-sm font-bold tabular-nums text-[var(--ref-on-surface)]">{otherShare}%</dd>
          </div>
        </dl>
      </div>
      {loading ? (
        <p className="mt-6 text-sm text-[var(--ref-on-surface-variant)]">Loading…</p>
      ) : (
        <>
          <div className="mt-5 h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series} margin={{ top: 4, right: 4, left: 4, bottom: 0 }} barCategoryGap="28%">
                <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="3 3" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--ref-on-surface-variant)' }} />
                <Tooltip
                  cursor={{ fill: 'var(--ref-surface-container-low)' }}
                  content={({ active, payload }) => {
                    const month = payload?.[0]?.payload as MonthIncome | undefined;
                    if (!active || !month) return null;
                    return (
                      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs shadow-xl">
                        <p className="font-bold text-[var(--ref-on-surface)]">{month.label} · {formatAmount(month.total)}</p>
                        <p className="mt-1 text-[var(--ref-on-surface-variant)]">Salary {formatAmount(month.salary)}</p>
                        <p className="text-[var(--ref-on-surface-variant)]">Other {formatAmount(month.other)}</p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="salary" stackId="income" fill={SALARY_FILL} maxBarSize={44} isAnimationActive={false} />
                <Bar dataKey="other" stackId="income" fill={OTHER_FILL} radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex items-center gap-5 text-xs text-[var(--ref-on-surface-variant)]">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: SALARY_FILL }} aria-hidden />Salary</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: OTHER_FILL }} aria-hidden />Other income</span>
          </div>
        </>
      )}
    </section>
  );
}

type RecentIncomeProps = {
  rows: { id: number; date: number; description: string; incomeCents: number }[];
  loading: boolean;
  formatAmount: (amount: number) => string;
  viewAllHref: React.ReactNode;
};

/** The latest credits, one line each, with the kind told by the icon rather than a badge. */
export function RecentIncomeCard({ rows, loading, formatAmount, viewAllHref }: RecentIncomeProps) {
  return (
    <section className={card}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className={cardTitle}>Recent income</h3>
          <p className={cardCaption}>Latest credits across every account.</p>
        </div>
        {viewAllHref}
      </div>
      {loading ? (
        <p className="mt-6 text-sm text-[var(--ref-on-surface-variant)]">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--ref-on-surface-variant)]">No income recorded yet. Add one from the button above.</p>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--color-border)]">
          {rows.map((row) => {
            const kind = incomeKind(row.description);
            const Icon = kind === 'salary' ? Landmark : /refund|reimburse/i.test(row.description) ? Coins : Banknote;
            return (
              <li key={row.id} className="flex items-center gap-3 py-2.5">
                <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', kind === 'salary' ? 'bg-[var(--color-accent)]/12 text-[var(--color-accent)]' : 'bg-[var(--ref-surface-container-high)] text-[var(--ref-on-surface-variant)]')} aria-hidden>
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[var(--ref-on-surface)]">{row.description}</p>
                  <p className="text-xs text-[var(--ref-on-surface-variant)]">{kind === 'salary' ? 'Salary' : 'Other income'} · {formatDate(row.date)}</p>
                </div>
                <p className="shrink-0 text-sm font-bold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(row.incomeCents)}</p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
