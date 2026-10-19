import { useState } from 'react';
import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Banknote, Calendar, Coins, Info, Landmark } from 'lucide-react';
import { cn, formatDate } from '../../lib/utils';
import { incomeKind, withRollingAverage, type MonthIncome, type MonthIncomeTrend, type PayCycle, type TakeHomeSegment, type YearPoint } from './income-insights';

const card = 'rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-6 editorial-shadow';
const cardTitle = 'font-headline text-lg font-bold text-[var(--ref-on-surface)]';
const cardCaption = 'mt-1 text-xs text-[var(--ref-on-surface-variant)]';
const statLabel = 'text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]';
const statValue = 'mt-0.5 text-sm font-bold tabular-nums text-[var(--ref-on-surface)]';
const chartTip = 'rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs shadow-xl';

const SALARY_FILL = 'var(--color-accent)';
const OTHER_FILL = 'color-mix(in srgb, var(--ref-on-surface) 35%, transparent)';
const INK = 'var(--ref-on-surface)';

/** Take-home keeps the accent; each deduction is a step of the same ink so the bar reads as one scale. */
const segmentFill: Record<TakeHomeSegment['key'], string> = {
  net: SALARY_FILL,
  pph21: 'color-mix(in srgb, var(--ref-on-surface) 70%, transparent)',
  jht: 'color-mix(in srgb, var(--ref-on-surface) 50%, transparent)',
  jp: 'color-mix(in srgb, var(--ref-on-surface) 35%, transparent)',
  bpjsKes: 'color-mix(in srgb, var(--ref-on-surface) 22%, transparent)',
};

function compactAxisIdr(value: number): string {
  const absolute = Math.abs(value);
  const decimal = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','));
  if (absolute >= 1_000_000_000) return `${decimal(value / 1_000_000_000)}B`;
  if (absolute >= 1_000_000) return `${decimal(value / 1_000_000)}M`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return String(Math.round(value));
}

const tip = 'pointer-events-none absolute z-40 hidden w-max max-w-72 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-left text-xs font-medium normal-case leading-relaxed tracking-normal text-[var(--ref-on-surface)] shadow-xl ring-1 ring-black/5 group-hover/hint:block group-focus-within/hint:block';

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
  ptkpCode: string;
  ptkpAnnual: number;
  /** What the employer pays on top of gross: JKK, JKM and its BPJS Kesehatan share. */
  employerContribution: number;
  formatAmount: (amount: number) => string;
  onEditProfile: () => void;
};

/** Estimated monthly take-home as the page's hero, with yearly figures and the gross-to-net split underneath. */
export function TakeHomeCard({ gross, net, segments, method, notes, depositAccountName, payrollDay, ptkpCode, ptkpAnnual, employerContribution, formatAmount, onEditProfile }: TakeHomeCardProps) {
  const keptShare = gross > 0 ? Math.round((net / gross) * 100) : 0;
  const [amountPrefix, amountDigits] = formatAmount(net).startsWith('Rp') ? ['Rp', formatAmount(net).slice(2)] : ['', formatAmount(net)];
  return (
    <section className="relative flex h-full flex-col justify-between overflow-hidden rounded-3xl bg-[var(--ref-surface-container-low)] p-6 sm:p-8">
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[var(--color-accent)]/10 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-32 -left-16 h-64 w-64 rounded-full bg-[var(--color-accent)]/5 blur-3xl" aria-hidden />
      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-[var(--ref-on-surface-variant)]">
            Estimated take-home
            <Hint text={`${method} method. ${notes.join(' ')} These are estimates, not tax advice.`}>
              <span tabIndex={0} aria-label="How this is calculated" className="grid h-5 w-5 place-items-center rounded text-[var(--ref-outline)] outline-none hover:text-[var(--ref-on-surface-variant)] focus-visible:ring-2 focus-visible:ring-[var(--ref-primary)]">
                <Info className="h-3.5 w-3.5" aria-hidden />
              </span>
            </Hint>
          </p>
          <button type="button" onClick={onEditProfile} className="shrink-0 rounded-full border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)]/60 px-4 py-2 text-xs font-bold text-[var(--ref-on-surface)] transition-colors hover:bg-[var(--ref-surface-container-lowest)]">
            Edit profile
          </button>
        </div>
        <p className="mt-3 flex flex-wrap items-baseline gap-2">
          {amountPrefix && <span className="font-headline text-2xl font-bold text-[var(--color-accent)]">{amountPrefix}</span>}
          <span className="font-headline text-5xl font-black tracking-tighter text-[var(--ref-on-surface)] sm:text-6xl">{amountDigits}</span>
        </p>
        <p className="mt-3 text-sm text-[var(--ref-on-surface-variant)]">
          {keptShare}% of <span className="font-semibold text-[var(--ref-on-surface)]">{formatAmount(gross)}</span> gross a month
          {depositAccountName ? <>, paid into <span className="font-semibold text-[var(--ref-on-surface)]">{depositAccountName}</span> on day {payrollDay}</> : null}
        </p>
      </div>

      <dl className="relative mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: 'Take-home a year', value: formatAmount(net * 12), hint: 'Twelve months of the estimate above, before bonuses or THR.' },
          { label: `PTKP ${ptkpCode}`, value: `${formatAmount(ptkpAnnual)} a year`, hint: 'Income that is not taxed at all under your PTKP status.' },
          { label: 'Employer adds', value: `${formatAmount(employerContribution)} a month`, hint: 'JKK, JKM and the employer share of BPJS Kesehatan, paid on top of gross.' },
        ].map((item) => (
          <div key={item.label} className="rounded-2xl bg-[var(--ref-surface-container-lowest)]/70 px-4 py-3">
            <dt className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]">
              {item.label}
              <Hint text={item.hint}>
                <span tabIndex={0} aria-label={`About ${item.label}`} className="grid h-4 w-4 place-items-center rounded text-[var(--ref-outline)] outline-none hover:text-[var(--ref-on-surface-variant)] focus-visible:ring-2 focus-visible:ring-[var(--ref-primary)]">
                  <Info className="h-3 w-3" aria-hidden />
                </span>
              </Hint>
            </dt>
            <dd className="mt-1 text-sm font-bold tabular-nums text-[var(--ref-on-surface)]">{item.value}</dd>
          </div>
        ))}
      </dl>

      <div className="relative mt-6 border-t border-[var(--color-border)]/60 pt-6">
        <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-[var(--ref-surface-container-highest)]" aria-hidden>
          {segments.map((segment) => (
            <div key={segment.key} className="h-full" style={{ width: `${segment.share * 100}%`, background: segmentFill[segment.key] }} />
          ))}
        </div>
        <ul className="mt-4 grid grid-cols-1 gap-x-8 gap-y-1.5 sm:grid-cols-2" aria-label="Where gross pay goes">
          {segments.map((segment) => (
            <li key={segment.key} className="flex items-center gap-2.5 text-sm">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: segmentFill[segment.key] }} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[var(--ref-on-surface)]">{segment.label}</span>
              <span className="tabular-nums text-[var(--ref-on-surface-variant)]">{formatAmount(segment.amount)}</span>
              <span className="w-11 text-right font-semibold tabular-nums text-[var(--ref-on-surface)]">{segment.share < 0.01 ? '<1' : (segment.share * 100).toFixed(segment.share < 0.1 ? 1 : 0)}%</span>
            </li>
          ))}
        </ul>
      </div>
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
    <section className="relative flex h-full flex-col justify-between overflow-hidden rounded-3xl bg-[var(--ref-surface-container-low)] p-6 sm:p-8">
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[var(--color-accent)]/10 blur-3xl" aria-hidden />
      <div className="relative">
        <p className="text-xs font-bold uppercase tracking-widest text-[var(--ref-on-surface-variant)]">Income recorded in {monthName}</p>
        <p className="mt-3 font-headline text-5xl font-black tracking-tighter text-[var(--ref-on-surface)] sm:text-6xl">{formatAmount(recordedThisMonth)}</p>
      </div>
      <div className="relative mt-8 flex flex-col gap-3 rounded-2xl bg-[var(--ref-surface-container-lowest)] p-4 sm:flex-row sm:items-center sm:justify-between">
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
  monthLabel: string;
  expectedNet: number | null;
  depositAccountName: string | null;
  recordedSinceLastPayday: number;
  formatAmount: (amount: number) => string;
  postAction?: { label: string; busy: boolean; onClick: () => void };
};

/** The blue tile: countdown to payday, how far the cycle has run, and what has landed since the last one. */
export function PaydayCard({ cycle, monthLabel, expectedNet, depositAccountName, recordedSinceLastPayday, formatAmount, postAction }: PaydayCardProps) {
  return (
    <section className="relative flex h-full flex-col justify-between overflow-hidden rounded-3xl bg-[var(--color-accent)] p-6 text-white sm:p-8">
      <div
        className="pointer-events-none absolute inset-0 opacity-10"
        style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '24px 24px' }}
        aria-hidden
      />
      <div className="pointer-events-none absolute -bottom-24 -right-16 h-56 w-56 rounded-full bg-white/10 blur-3xl" aria-hidden />
      <div className="relative">
        <div className="flex items-start justify-between">
          <div className="rounded-2xl bg-white/20 p-3 backdrop-blur-md">
            <Calendar className="h-7 w-7" aria-hidden />
          </div>
          <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-bold">{monthLabel}</span>
        </div>
        <p className="mt-6 text-[10px] font-bold uppercase tracking-widest text-white/70">Next payday</p>
        <p className="mt-1 font-headline text-4xl font-extrabold leading-tight">
          {cycle.isPayday ? 'Today, payday!' : cycle.daysLeft === 1 ? 'Tomorrow' : <>{cycle.daysLeft} days<br />to payday</>}
        </p>
        <p className="mt-2 text-sm text-white/80">
          {formatDate(cycle.nextPayday)}
          {expectedNet != null && <> · about <span className="font-semibold text-white">{formatAmount(expectedNet)}</span>{depositAccountName ? ` into ${depositAccountName}` : ''}</>}
        </p>
      </div>

      <div className="relative mt-8">
        <div className="h-2 w-full rounded-full bg-white/20">
          <div className="h-full rounded-full bg-white transition-[width]" style={{ width: `${cycle.progress * 100}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-[10px] font-bold uppercase tracking-widest text-white/60">
          <span>Paid {formatDate(cycle.lastPayday)}</span>
          <span>{Math.round(cycle.progress * 100)}%</span>
        </div>
        <dl className="mt-5 flex items-baseline justify-between gap-3 border-t border-white/15 pt-4 text-sm">
          <dt className="text-white/75">Recorded since last payday</dt>
          <dd className="font-bold tabular-nums">{formatAmount(recordedSinceLastPayday)}</dd>
        </dl>
        {postAction && (
          <button type="button" onClick={postAction.onClick} disabled={postAction.busy} className="mt-4 w-full rounded-full border border-white/25 bg-white/15 px-4 py-2 text-xs font-bold text-white backdrop-blur-sm transition-colors hover:bg-white/25 disabled:opacity-50">
            {postAction.label}
          </button>
        )}
      </div>
    </section>
  );
}

type HistoryCardProps = {
  series: MonthIncome[];
  expectedNet: number | null;
  balancesHidden: boolean;
  formatAmount: (amount: number) => string;
  loading: boolean;
};

/** A year of income, salary stacked under other income, smoothed by a trailing average against the payroll line. */
export function IncomeHistoryCard({ series, expectedNet, balancesHidden, formatAmount, loading }: HistoryCardProps) {
  const [months, setMonths] = useState<6 | 12>(6);
  const trend = withRollingAverage(series).slice(-months);
  const monthsWithIncome = trend.filter((month) => month.total > 0);
  const average = monthsWithIncome.length ? monthsWithIncome.reduce((sum, month) => sum + month.total, 0) / monthsWithIncome.length : 0;
  const otherTotal = trend.reduce((sum, month) => sum + month.other, 0);
  const grandTotal = trend.reduce((sum, month) => sum + month.total, 0);
  const otherShare = grandTotal > 0 ? Math.round((otherTotal / grandTotal) * 100) : 0;
  const axis = (value: number) => (balancesHidden ? '•••' : compactAxisIdr(value));
  return (
    <section className={cn(card, 'flex h-full flex-col')}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className={cardTitle}>Income history</h3>
          <p className={cardCaption}>Salary and other income by calendar month, with a three-month average.</p>
        </div>
        <div className="ui-segmented ui-segmented--2 inline-grid shrink-0 auto-cols-fr grid-flow-col gap-1 rounded-xl bg-[var(--ref-surface-container)] p-1" role="radiogroup" aria-label="Range" data-segment-index={months === 6 ? 0 : 1}>
          {([6, 12] as const).map((option) => (
            <button key={option} type="button" role="radio" aria-checked={months === option} onClick={() => setMonths(option)} className={cn('rounded-lg px-3 py-1 text-xs font-bold', months === option ? 'text-[var(--ref-on-surface)]' : 'text-[var(--ref-on-surface-variant)]')}>
              {option}M
            </button>
          ))}
        </div>
      </div>
      <dl className="mt-4 flex gap-8">
        <div>
          <dt className={statLabel}>Monthly average</dt>
          <dd className={statValue}>{formatAmount(Math.round(average))}</dd>
        </div>
        <div>
          <dt className={cn(statLabel, 'flex items-center gap-1')}>
            Other income
            <Hint text="Salary is what your salary profile posted, plus hand-entered credits named salary, gaji or payroll. Anything marked freelance, bonus, THR or refund counts as other income.">
              <span tabIndex={0} aria-label="How salary is told apart" className="grid h-4 w-4 place-items-center rounded text-[var(--ref-outline)] outline-none hover:text-[var(--ref-on-surface-variant)] focus-visible:ring-2 focus-visible:ring-[var(--ref-primary)]">
                <Info className="h-3 w-3" aria-hidden />
              </span>
            </Hint>
          </dt>
          <dd className={statValue}>{otherShare}%</dd>
        </div>
      </dl>
      {loading ? (
        <p className="mt-6 text-sm text-[var(--ref-on-surface-variant)]">Loading…</p>
      ) : (
        <>
          <div className="mt-5 min-h-56 w-full flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trend} margin={{ top: 12, right: 8, left: 0, bottom: 0 }} barCategoryGap={months === 12 ? '30%' : '36%'}>
                <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="3 3" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--ref-on-surface-variant)' }} />
                <YAxis axisLine={false} tickLine={false} tickCount={4} width={40} tick={{ fontSize: 10, fill: 'var(--ref-outline)' }} tickFormatter={axis} />
                <Tooltip
                  cursor={{ fill: 'var(--ref-surface-container-low)' }}
                  content={({ active, payload }) => {
                    const month = payload?.[0]?.payload as MonthIncomeTrend | undefined;
                    if (!active || !month) return null;
                    const delta = expectedNet != null ? month.total - expectedNet : null;
                    return (
                      <div className={chartTip}>
                        <p className="font-bold text-[var(--ref-on-surface)]">{month.label} · {formatAmount(month.total)}</p>
                        <p className="mt-1 text-[var(--ref-on-surface-variant)]">Salary {formatAmount(month.salary)} · Other {formatAmount(month.other)}</p>
                        {month.rolling != null && <p className="text-[var(--ref-on-surface-variant)]">3-month average {formatAmount(Math.round(month.rolling))}</p>}
                        {delta != null && month.total > 0 && (
                          <p className={cn('mt-1 font-semibold', delta >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--ref-on-surface-variant)]')}>
                            {delta >= 0 ? '+' : '−'}{formatAmount(Math.abs(delta))} vs expected salary
                          </p>
                        )}
                      </div>
                    );
                  }}
                />
                {expectedNet != null && (
                  <ReferenceLine y={expectedNet} stroke={INK} strokeOpacity={0.45} strokeDasharray="4 4" label={{ value: 'Expected salary', position: 'insideTopRight', fontSize: 10, fill: 'var(--ref-on-surface-variant)' }} />
                )}
                <Bar dataKey="salary" stackId="income" fill={SALARY_FILL} maxBarSize={40} isAnimationActive={false} />
                <Bar dataKey="other" stackId="income" fill={OTHER_FILL} radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} />
                <Line type="monotone" dataKey="rolling" stroke={INK} strokeWidth={2} dot={{ r: 3, fill: 'var(--ref-surface-container-lowest)', strokeWidth: 2 }} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[var(--ref-on-surface-variant)]">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: SALARY_FILL }} aria-hidden />Salary</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: OTHER_FILL }} aria-hidden />Other income</span>
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full" style={{ background: INK }} aria-hidden />3-month average</span>
            {expectedNet != null && <span className="flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: INK, opacity: 0.6 }} aria-hidden />Expected salary</span>}
          </div>
        </>
      )}
    </section>
  );
}

type YearCardProps = {
  curve: YearPoint[];
  year: number;
  expectedNet: number;
  balancesHidden: boolean;
  formatAmount: (amount: number) => string;
  loading: boolean;
};

/** The year so far: actual income accumulated against what salary alone would have brought in. */
export function YearToDateCard({ curve, year, expectedNet, balancesHidden, formatAmount, loading }: YearCardProps) {
  const latest = [...curve].reverse().find((point) => point.actual != null);
  const startLabel = curve.find((point) => point.expected != null)?.label;
  const actual = latest?.actual ?? 0;
  const expected = latest?.expected ?? 0;
  const ahead = actual - expected;
  const axis = (value: number) => (balancesHidden ? '•••' : compactAxisIdr(value));
  return (
    <section className={cn(card, 'flex h-full flex-col')}>
      <div>
        <h3 className={cardTitle}>{year} so far</h3>
        <p className={cardCaption}>Everything received since {startLabel ?? 'January'} against salary alone.</p>
      </div>
      <dl className="mt-4 flex gap-8">
        <div>
          <dt className={statLabel}>Received</dt>
          <dd className={statValue}>{formatAmount(actual)}</dd>
        </div>
        <div>
          <dt className={statLabel}>{ahead >= 0 ? 'Ahead by' : 'Behind by'}</dt>
          <dd className={cn(statValue, ahead >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--ref-error)]')}>{formatAmount(Math.abs(ahead))}</dd>
        </div>
      </dl>
      {loading ? (
        <p className="mt-6 text-sm text-[var(--ref-on-surface-variant)]">Loading…</p>
      ) : (
        <>
          <div className="mt-5 min-h-56 w-full flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={curve} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="ytd-actual" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="3 3" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--ref-on-surface-variant)' }} interval={0} />
                <YAxis axisLine={false} tickLine={false} tickCount={4} width={40} tick={{ fontSize: 10, fill: 'var(--ref-outline)' }} tickFormatter={axis} />
                <Tooltip
                  cursor={{ stroke: 'var(--ref-outline)', strokeDasharray: '4 4' }}
                  content={({ active, payload }) => {
                    const point = payload?.[0]?.payload as YearPoint | undefined;
                    if (!active || !point) return null;
                    if (point.expected == null) return null;
                    const gap = point.actual != null ? point.actual - point.expected : null;
                    return (
                      <div className={chartTip}>
                        <p className="font-bold text-[var(--ref-on-surface)]">By end of {point.label}</p>
                        {point.actual != null && <p className="mt-1 text-[var(--ref-on-surface-variant)]">Received {formatAmount(point.actual)}</p>}
                        <p className="text-[var(--ref-on-surface-variant)]">Salary alone {formatAmount(point.expected)}</p>
                        {gap != null && (
                          <p className={cn('mt-1 font-semibold', gap >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--ref-error)]')}>
                            {gap >= 0 ? '+' : '−'}{formatAmount(Math.abs(gap))}
                          </p>
                        )}
                      </div>
                    );
                  }}
                />
                <Line type="monotone" dataKey="expected" stroke={INK} strokeOpacity={0.5} strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
                <Area type="monotone" dataKey="actual" stroke="var(--color-accent)" strokeWidth={2.5} fill="url(#ytd-actual)" dot={false} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[var(--ref-on-surface-variant)]">
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full" style={{ background: 'var(--color-accent)' }} aria-hidden />Received</span>
            <span className="flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: INK, opacity: 0.6 }} aria-hidden />Salary alone ({formatAmount(expectedNet)} a month)</span>
          </div>
        </>
      )}
    </section>
  );
}

type RecentIncomeProps = {
  rows: { id: number; date: number; description: string; incomeCents: number; txType?: string }[];
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
        <ul className="mt-4 grid grid-cols-1 gap-x-10 lg:grid-cols-2">
          {rows.map((row) => {
            const kind = incomeKind(row);
            const Icon = kind === 'salary' ? Landmark : /refund|reimburse/i.test(row.description) ? Coins : Banknote;
            return (
              <li key={row.id} className="flex items-center gap-3 border-b border-[var(--color-border)] py-2.5 last:border-b-0 lg:[&:nth-last-child(2)]:border-b-0">
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
