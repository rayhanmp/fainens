import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, TrendingUp } from 'lucide-react';
import { Area, ComposedChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BalanceVisibilityToggle } from '../ui/BalanceVisibilityToggle';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn, formatDecimal } from '../../lib/utils';
import { api } from '../../lib/api';
import { calculateRetirementProjection, INDONESIA_RULES_2026, jpAccessAge, type WorkerType } from '../../lib/retirement';
import { queryKeys } from '../../features/core/query-keys';
import { useSalarySettingsQuery } from '../../features/salary/queries';
import { Section } from '../../features/subscriptions/PageParts';
import { Toggle } from '../../features/settings/controls';
import { Field, MoneyField, PercentField, Segmented } from '../../features/savings/fields';
import { RetirementGarden, type GardenStop } from './RetirementGarden';
import { Term } from '../ui/Term';
import { compactRupiah, recentSaving } from '../../features/savings/plan';
import { usePeriodSummariesQuery } from '../../features/analytics/queries';

const microLabel = 'text-[10px] font-bold uppercase tracking-widest';

/** Self-paid (mandiri) BPJS Kesehatan a person a month in 2026, Kelas 3 after the government's Rp7.000. */
const HEALTH_PREMIUM = { none: 0, '3': 35_000, '2': 100_000, '1': 150_000 } as const;
type HealthClass = keyof typeof HEALTH_PREMIUM;

/** Where each figure in the guidance comes from, shown on hover and opened on tap. Checked October 2026. */
const SOURCES = {
  dplk: { href: 'https://www.investortrust.id/financial/109735/asosiasi-dplk-soroti-besarnya-gap-proteksi-dana-pensiun-dorong-sinergi-program-wajib-dan-sukarela', label: 'Asosiasi DPLK (pension fund association), via Investortrust' },
  ojk: { href: 'https://www.cnbcindonesia.com/market/20240516090927-17-538581/kejar-duit-pensiun-40-dari-gaji-ojk-bakal-bikin-ini', label: 'OJK, via CNBC Indonesia (May 2024); OJK repeated 10–15% in October 2025' },
  bpjsKesehatan: { href: 'https://www.idntimes.com/business/economy/iuran-bpjs-kesehatan-kelas-1-2-3-tahun-2026-1-01-tg1j7-l08bmf', label: 'Mandiri rates under the BPJS Kesehatan regulation, unchanged for 2026, via IDN Times. Kelas 3 is Rp42.000 with Rp7.000 paid by the government.' },
  seniorInsurance: { href: 'https://keuangan.kontan.co.id/news/apa-itu-asuransi-kesehatan-lansia-ini-tips-memilih-dan-cara-klaimnya-dengan-mudah', label: 'Kontan on senior health insurance in Indonesia; limits vary by insurer' },
  medical: { href: 'https://keuangan.kontan.co.id/news/proyeksi-inflasi-medis-indonesia-di-2026-178-tertinggi-di-asia-tenggara', label: 'Mercer Marsh Benefits, Health Trends 2026, via Kontan. Other estimates for 2025 range from 13.6% to 19%.' },
  lifeBirth: { href: 'https://georank.org/life-expectancy/indonesia/united-states', label: 'UN World Population Prospects: 71.6 years (69.4 men, 73.8 women), via GeoRank' },
  lifeAt60: { href: 'https://qmfinancial.com/life-expectancy-perempuan-indonesia-72-tahun-dana-pensiun-sudah-siap/', label: 'WHO Global Health Observatory (2013 data), via QM Financial' },
  ori030: { href: 'https://market.bisnis.com/read/20260706/92/1985752/ori030-tawarkan-kupon-7-ungguli-rata-rata-deposito', label: 'DJPPR, Ministry of Finance: ORI030-T3 6.9%, ORI030-T6 7%, offered July 2026, via Bisnis' },
  couponTax: { href: 'https://www.bareksa.com/berita/sbn/2026-06-30/ori030-layak-dibeli-ini-10-alasan-investor-menunggu-obligasi-negara-ritel-terbaru-2026/amp', label: 'Bareksa on SBN ritel (June 2026)' },
  jhtPartial: { href: 'https://finansial.bisnis.com/read/20250128/215/1835174/cara-mencairkan-jht-bpjs-ketenagakerjaan-2025-bisa-tarik-tunai-hingga-30-saat-jadi-karyawan', label: 'PP 46/2015 as amended by PP 60/2015, via Bisnis (January 2025)' },
} as const;

/** The latest SBN ritel coupon after its 10% tax: ORI030-T6 paid 7%. */
const PAYOUT_PRESETS = [
  { label: 'ORI030 after tax', rate: 6.3, title: 'ORI030-T6 paid 7% a year (July 2026); after the 10% coupon tax that is 6.3%' },
] as const;

/** The three parts of retirement income share one hue, from light to full. */
const PART_COLORS = { jht: 'bg-[var(--color-accent)]/35', jp: 'bg-[var(--color-accent)]/65', personal: 'bg-[var(--color-accent)]' } as const;
/** The same three parts on the dusk sky: white for BPJS, sunlight for your own money. */
// Explicit white: the app turns `bg-white` dark in dark mode.
const HERO_PART_COLORS = { jht: 'bg-[#fff]/55', jp: 'bg-[#fff]', personal: 'bg-[#fde68a]' } as const;

function AgeField({ id, value, onChange, min, max = 100 }: { id: string; value: string; onChange: (value: string) => void; min: number; max?: number }) {
  return <input id={id} className="brutalist-input brutalist-input--currency" type="number" inputMode="numeric" min={min} max={max} value={value} onChange={(event) => onChange(event.target.value)} />;
}

/** A group of fields that opens and closes, saying what it holds while closed. */
function Group({ title, summary, open, onToggle, children }: { title: string; summary: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="border-t border-[var(--color-border)] first:border-t-0">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--ref-surface-container-low)]/60 sm:px-5">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-[var(--ref-on-surface)]">{title}</span>
          {!open && <span className="mt-0.5 block truncate text-xs text-[var(--ref-on-surface-variant)]">{summary}</span>}
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-[var(--ref-on-surface-variant)] transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && <div className="settings-compact px-4 pb-5 sm:px-5">{children}</div>}
    </div>
  );
}

const source = (href: string, text: string) => <a className="font-semibold underline" href={href} target="_blank" rel="noreferrer">{text}</a>;

/**
 * BPJS JHT and JP with your own savings, against what you want to spend after work. Everything is
 * in today's prices. After retiring, JHT and savings stay invested and are paid out evenly (rising
 * with inflation) until the age you choose; JP is paid for life. Your age comes from your profile
 * and your wage from salary settings until you change them here.
 */
export function RetirementPlanner() {
  const { formatAmount, balancesHidden } = useBalanceVisibility();
  const profile = useQuery({ queryKey: queryKeys.profile, queryFn: () => api.profile.get() });
  const salary = useSalarySettingsQuery();
  const [now] = useState(() => Date.now());
  const summaries = usePeriodSummariesQuery();
  const [workerType, setWorkerType] = useState<WorkerType>('pu');
  const [ageInput, setAgeInput] = useState<string | null>(null);
  const [retirementInput, setRetirementAge] = useState<string | null>(null);
  const [wageInput, setWageInput] = useState<number | null>(null);
  const [currentJhtBalance, setCurrentJhtBalance] = useState(0);
  const [currentPersonalSavings, setCurrentPersonalSavings] = useState(0);
  const [monthlyPersonalContribution, setMonthlyPersonalContribution] = useState(0);
  const [existingJpYears, setExistingJpYears] = useState('0');
  const [targetMonthlySpending, setTargetMonthlySpending] = useState(0);
  const [healthClass, setHealthClass] = useState<HealthClass>('none');
  const [healthPeople, setHealthPeople] = useState<'1' | '2' | '3' | '4'>('1');
  const [privatePremium, setPrivatePremium] = useState(0);
  const [salaryGrowthRate, setSalaryGrowthRate] = useState(5);
  const [inflationRate, setInflationRate] = useState(3);
  const [jhtReturnRate, setJhtReturnRate] = useState<number>(INDONESIA_RULES_2026.jhtReturnRate);
  const [personalReturnRate, setPersonalReturnRate] = useState(6);
  const [postRetirementReturn, setPostRetirementReturn] = useState(6.3);
  const [payoutUntil, setPayoutUntil] = useState('90');
  const [claimJhtEarly, setClaimJhtEarly] = useState(false);
  const [jpWageCap, setJpWageCap] = useState<number>(INDONESIA_RULES_2026.jpWageCap);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(['work']));
  const toggleGroup = (key: string) => setOpenGroups((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  // What you spend a month now: the easiest place to start a retirement target from.
  const spendingNow = Math.round((recentSaving(summaries.data ?? [], now)?.averageSpending ?? 0) / 100_000) * 100_000;
  const profileAge = profile.data?.age != null && profile.data.age >= 18 ? String(profile.data.age) : '30';
  const currentAge = ageInput ?? profileAge;
  const ageNumber = Number(currentAge);
  // Until you choose, retire when JP starts for you, so the pension is part of the picture.
  const retirementAge = retirementInput ?? String(Number.isInteger(ageNumber) && ageNumber >= 18 && ageNumber <= 100 ? Math.max(ageNumber, jpAccessAge(ageNumber, new Date(now).getFullYear())) : INDONESIA_RULES_2026.jpRetirementAge);
  const salaryWage = salary.data?.settings.grossMonthly ?? 0;
  const monthlyWage = wageInput ?? salaryWage;
  const bpjsCost = HEALTH_PREMIUM[healthClass] * Number(healthPeople);
  const healthCost = bpjsCost + privatePremium;
  const totalTarget = targetMonthlySpending > 0 ? targetMonthlySpending + healthCost : 0;

  const result = useMemo(() => {
    try {
      if (!currentAge.trim() || !retirementAge.trim() || !payoutUntil.trim()) throw new Error('Enter the ages.');
      return { projection: calculateRetirementProjection({
        workerType,
        currentAge: Number(currentAge),
        retirementAge: Number(retirementAge),
        monthlyWage,
        currentJhtBalance,
        currentPersonalSavings,
        monthlyPersonalContribution,
        existingJpYears: workerType === 'pu' ? Number(existingJpYears) : 0,
        salaryGrowthRate,
        inflationRate,
        jhtReturnRate,
        personalReturnRate,
        postRetirementReturn,
        payoutUntilAge: Number(payoutUntil),
        targetMonthlySpending: totalTarget,
        claimJhtEarly,
        jpWageCap,
      }), error: null };
    } catch {
      return { projection: null, error: 'Check your inputs: ages are whole numbers from 18 to 100, you retire no earlier than today, the money lasts past retirement (up to 110), amounts are zero or more and rates 0–100%. JP history can’t start before 18 or before 2015.' };
    }
  }, [workerType, currentAge, retirementAge, monthlyWage, currentJhtBalance, currentPersonalSavings, monthlyPersonalContribution, existingJpYears, totalTarget, salaryGrowthRate, inflationRate, jhtReturnRate, personalReturnRate, postRetirementReturn, payoutUntil, claimJhtEarly, jpWageCap]);
  const { projection } = result;

  // Everything is shown in today's prices: rupiah decades from now mean little to anyone.
  const inflationAfter = (years: number) => (1 + inflationRate / 100) ** Math.max(0, years);
  const today = (value: number) => Math.round(value / (projection?.inflationFactor ?? 1));
  const jpToday = projection ? Math.round(projection.jpIncomeWhenPaid / inflationAfter(projection.jpAccessAge - ageNumber)) : 0;
  const parts = projection ? { jht: today(projection.jhtIncome), jp: today(projection.estimatedJpIncome), personal: today(projection.personalIncome) } : { jht: 0, jp: 0, personal: 0 };
  const income = parts.jht + parts.jp + parts.personal;
  const hasTarget = totalTarget > 0;
  const coverage = hasTarget ? Math.round((income / totalTarget) * 100) : 0;
  const formatted = formatAmount(income);
  const [prefix, digits] = formatted.startsWith('Rp') ? ['Rp', formatted.slice(2)] : ['', formatted];
  const mask = (text: string) => (balancesHidden ? '•••' : text);

  const chartRows = projection ? [
    ...projection.series.map((row) => {
      const scale = inflationAfter(row.age - ageNumber);
      return { age: row.age, jht: row.jht / scale, personal: row.personal / scale, left: undefined as number | undefined };
    }),
    ...projection.drawdown.slice(1).map((row) => ({ age: row.age, jht: undefined, personal: undefined, left: row.assets / inflationAfter(row.age - ageNumber) })),
  ] : [];
  // The spend-down starts where the build-up ends, so the two areas meet.
  const lastBuild = chartRows[projection?.series.length ? projection.series.length - 1 : 0];
  if (lastBuild && projection) lastBuild.left = projection.drawdown[0]!.assets / inflationAfter(projection.retirementAge - ageNumber);

  return (
    <>
      {result.error || !projection ? (
        <div role="alert" className="rounded-2xl border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/5 p-5 text-sm text-[var(--color-danger)]">{result.error}</div>
      ) : (
        // A question and its answer under a clear sky, the garden path of your ages beneath.
        <section className="garden-sky relative overflow-clip rounded-3xl text-white" aria-label="Retirement: what you want and what the plan pays">
          <div className="px-5 pt-5 sm:px-7 sm:pt-7">
          <div className="flex items-center justify-between gap-3">
            <p className={cn(microLabel, 'text-white/70')}>Retirement · in today’s prices</p>
            <BalanceVisibilityToggle inverted className="h-8 w-8" />
          </div>

          <div className="mt-5 grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="flex flex-col">
              <label htmlFor="retirement-target" className="block font-headline text-xl font-bold leading-snug sm:text-2xl">How much do you want to spend each month after you retire?</label>
              <p className="mt-1 text-xs text-white/70">In today’s prices; inflation is taken care of.</p>
              <div className="settings-compact field-inverse mt-3 max-w-sm">
                <MoneyField id="retirement-target" value={targetMonthlySpending} onChange={setTargetMonthlySpending} placeholder="e.g. 8jt" />
              </div>
              {spendingNow > 0 && (
                <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Start from what you spend now">
                  {[
                    { label: 'Same as today', amount: spendingNow },
                    { label: '80% of today', amount: Math.round((spendingNow * 0.8) / 100_000) * 100_000 },
                  ].map((pick) => (
                    <button
                      key={pick.label}
                      type="button"
                      aria-pressed={targetMonthlySpending === pick.amount}
                      onClick={() => setTargetMonthlySpending(pick.amount)}
                      className={cn('h-[34px] rounded-lg px-3 text-xs font-semibold transition-colors', targetMonthlySpending === pick.amount ? 'bg-[#fff] text-[#0b2a5c]' : 'bg-[#fff]/15 text-white hover:bg-[#fff]/25')}
                    >
                      {pick.label} · {mask(compactRupiah(pick.amount))}
                    </button>
                  ))}
                </div>
              )}
              {healthCost > 0 && targetMonthlySpending > 0 && (
                <p className="mt-2 text-xs text-white/75">Plus {formatAmount(healthCost)} for health cover, set under What old age needs.</p>
              )}
              <div className="mt-6">
                {!hasTarget ? (
                  <p className="max-w-sm text-sm text-white/80">
                    {spendingNow > 0
                      ? `You spend about ${mask(compactRupiah(spendingNow))} a month now. Pick an amount and this says whether the plan pays for it.`
                      : 'Type an amount and this says whether the plan pays for it, and how much more to save if it doesn’t.'}
                  </p>
                ) : projection.monthlyGap <= 0 ? (
                  <>
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-[#bbf7d0]"><CheckCircle2 className="h-4 w-4" aria-hidden />You’re covered</p>
                    <p className="mt-0.5 text-2xl font-bold tabular-nums">{formatAmount(today(Math.abs(projection.monthlyGap)))}<span className="ml-1.5 text-sm font-semibold text-white/70">a month left over</span></p>
                  </>
                ) : projection.yearsToRetirement === 0 ? (
                  <>
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-[#fde68a]"><TrendingUp className="h-4 w-4" aria-hidden />Not enough yet</p>
                    <p className="mt-0.5 text-2xl font-bold tabular-nums">{formatAmount(Math.round(projection.capitalGap ?? 0))}</p>
                    <p className="mt-0.5 text-xs text-white/75">more in savings today would pay for it. Without it you’d be {formatAmount(today(projection.monthlyGap))} a month short.</p>
                  </>
                ) : (
                  <>
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-[#fde68a]"><TrendingUp className="h-4 w-4" aria-hidden />Not enough yet. To afford it, save</p>
                    <p className="mt-0.5 text-2xl font-bold tabular-nums">{formatAmount(Math.round(projection.requiredAdditionalSaving ?? 0))}<span className="ml-1.5 text-sm font-semibold text-white/70">more a month</span></p>
                    <p className="mt-0.5 text-xs text-white/75">from now until {projection.retirementAge}, at Your return. Without it you’d be {formatAmount(today(projection.monthlyGap))} a month short.</p>
                  </>
                )}
              </div>
            </div>

            <div>
              <p className={cn(microLabel, 'text-[#fde68a]')}>Retiring at {projection.retirementAge}, you could spend</p>
              <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
                {prefix && <span className="font-headline text-xl font-bold text-white/70">{prefix}</span>}
                <span className="whitespace-nowrap font-headline text-[clamp(2rem,9vw,3.5rem)] font-black leading-none tracking-tighter tabular-nums lg:text-[clamp(2rem,4.2vw,3.5rem)]">{digits}</span>
                <span className="text-base font-semibold text-white/75">a month</span>
              </p>
              <p className="mt-1.5 text-sm text-white/80">
                <Term meaning={`Your JHT lump sum and your own savings stay invested at ${formatDecimal(postRetirementReturn, 2)}% and pay out a little each month, rising with inflation so it buys the same each year, until they run out at ${projection.payoutUntilAge}. JP is a separate BPJS pension paid for life. Change these under Your situation → After you retire.`}>Until you’re {projection.payoutUntilAge}</Term>, in today’s prices.
              </p>

                {/* The month split into its sources, with what you want marked on the same scale. */}
                <div className="mt-5">
                  {(() => {
                    const scale = Math.max(income, totalTarget, 1);
                    return (
                      <div className="relative">
                        <div className="flex h-3 overflow-hidden rounded-full bg-white/15" role="img" aria-label={`JHT ${formatAmount(parts.jht)}, JP ${formatAmount(parts.jp)}, your savings ${formatAmount(parts.personal)} a month${hasTarget ? `, against ${formatAmount(totalTarget)} wanted` : ''}`}>
                          {(['jht', 'jp', 'personal'] as const).map((key) => parts[key] > 0 && (
                            <span key={key} className={cn('h-full border-r-2 border-[#1b2f5c] last:border-r-0', HERO_PART_COLORS[key])} style={{ width: `${(parts[key] / scale) * 100}%` }} />
                          ))}
                        </div>
                        {hasTarget && (
                          <span className="absolute -top-1 bottom-[-4px] w-0.5 rounded-full bg-[#fff]" style={{ left: `calc(${(totalTarget / scale) * 100}% - 1px)` }} aria-hidden />
                        )}
                      </div>
                    );
                  })()}
                  {/* The bar's legend, in a line: each source, what it is on hover, and its share. */}
                  <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/80">
                    {[
                      { key: 'jht' as const, label: 'JHT', meaning: `Jaminan Hari Tua: BPJS savings from 5.7% of your wage (2% you, 3.7% your employer), claimable from 56${projection.jhtAvailable ? ` as a ${mask(compactRupiah(today(projection.projectedJht)))} lump sum` : ''}, then invested and spent down with your savings.` },
                      { key: 'jp' as const, label: 'JP', meaning: !projection.jpEligible ? 'Jaminan Pensiun is for employees (PU) only.' : jpToday === 0 ? 'Jaminan Pensiun: a BPJS pension for life, but it needs 15 years paid in.' : `Jaminan Pensiun: a BPJS pension for life from ${projection.jpAccessAge}${projection.jpAvailable ? '' : `, after you retire: ${formatAmount(jpToday)} a month then`}.` },
                      { key: 'personal' as const, label: 'Your savings', meaning: projection.projectedPersonalSavings > 0 ? `Your own retirement savings, ${mask(compactRupiah(today(projection.projectedPersonalSavings)))} by ${projection.retirementAge}, spent down with JHT.` : 'Your own retirement savings outside BPJS. Add them under Your situation.' },
                    ].map((item) => (
                      <li key={item.key} className="flex items-center gap-1.5">
                        <span className={cn('h-2.5 w-2.5 shrink-0 rounded-sm', HERO_PART_COLORS[item.key])} aria-hidden />
                        <Term meaning={item.meaning}>{item.label}</Term>
                        <span className="font-semibold tabular-nums text-white">{formatAmount(parts[item.key])}</span>
                      </li>
                    ))}
                    {hasTarget && (
                      <li className="flex items-center gap-1.5">
                        <span className="h-3 w-0.5 rounded-full bg-[#fff]" aria-hidden />
                        You want <span className="font-semibold tabular-nums text-white">{formatAmount(totalTarget)}</span>
                        <span>· {coverage}% covered</span>
                      </li>
                    )}
                  </ul>
                </div>
            </div>
          </div>
          </div>

          {/* The ages that matter, from now until the money runs out; a bench waits at retirement. */}
          {(() => {
            const jpSeparate = projection.jpEligible && jpToday > 0 && projection.jpAccessAge !== projection.retirementAge;
            const stops: GardenStop[] = [
              { key: 'now', age: ageNumber, label: 'Now' },
              ...(56 > ageNumber && 56 < projection.retirementAge ? [{ key: 'jht', age: 56, label: 'JHT claimable' }] : []),
              { key: 'retire', age: projection.retirementAge, label: 'Retire', detail: !jpSeparate && jpToday > 0 ? 'and JP starts' : undefined, emphasis: true },
              ...(jpSeparate ? [{ key: 'jp', age: projection.jpAccessAge, label: 'JP starts' }] : []),
              { key: 'end', age: projection.payoutUntilAge, label: 'Savings used up', detail: projection.estimatedJpIncome > 0 || jpToday > 0 ? 'JP goes on' : undefined },
            ];
            return <RetirementGarden fromAge={ageNumber} toAge={projection.payoutUntilAge} restAge={projection.retirementAge} stops={stops} />;
          })()}
        </section>
      )}

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        <Section title="Your situation">
          {/* Four groups, one open at first; each closed group still says what it holds. */}
          <Group
            title="You and your work"
            summary={`${workerType === 'pu' ? 'Employee' : 'Independent'} · ${currentAge} now, retiring at ${retirementAge} · ${mask(compactRupiah(monthlyWage))} a month`}
            open={openGroups.has('work')}
            onToggle={() => toggleGroup('work')}
          >
          <div className="grid grid-cols-1 items-start gap-5 sm:grid-cols-2 sm:gap-x-6 xl:grid-cols-1">
            <Field label="Worker type" info="Employee (Penerima Upah): your employer registers you and pays part of JHT and JP. Independent (Bukan Penerima Upah): you register and pay yourself, with JHT only." hint={workerType === 'bpu' ? 'Voluntary JHT only, at 2% of the base you enter; real BPU brackets may differ. JP isn’t included.' : 'Employee: JHT and JP through your employer.'}>
              <Segmented ariaLabel="Worker type" value={workerType} onChange={setWorkerType} options={[{ value: 'pu', label: 'Employee (PU)' }, { value: 'bpu', label: 'Independent (BPU)' }]} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Your age" htmlFor="retirement-age-now" info="From your profile until you change it here.">
                <AgeField id="retirement-age-now" value={currentAge} min={18} onChange={setAgeInput} />
              </Field>
              <Field label="Retire at" htmlFor="retirement-age" info="Starts at the age your JP pension begins, so it counts. Retire earlier and JP is left out until it starts.">
                <AgeField id="retirement-age" value={retirementAge} min={Number(currentAge) || 18} onChange={setRetirementAge} />
              </Field>
            </div>
            <Field
              label={workerType === 'pu' ? 'Monthly reported wage' : 'Monthly JHT base'}
              htmlFor="retirement-wage"
              info={workerType === 'pu' ? 'Your gross monthly wage as reported to BPJS. JHT and JP are a share of it.' : 'The income you declare to BPJS as an independent worker; JHT is 2% of it.'}
              hint={wageInput === null && salaryWage > 0 ? 'From your salary settings.' : undefined}
            >
              <MoneyField id="retirement-wage" value={monthlyWage} onChange={setWageInput} />
            </Field>
          </div>
          </Group>

          <Group
            title="What you have so far"
            summary={`JHT ${mask(compactRupiah(currentJhtBalance))}${workerType === 'pu' ? ` · JP ${existingJpYears || 0} yrs` : ''} · savings ${mask(compactRupiah(currentPersonalSavings))} + ${mask(compactRupiah(monthlyPersonalContribution))} a month`}
            open={openGroups.has('have')}
            onToggle={() => toggleGroup('have')}
          >
          <div className="grid grid-cols-1 items-start gap-5 sm:grid-cols-2 sm:gap-x-6 xl:grid-cols-1">
            <Field label="JHT balance now" htmlFor="retirement-jht" info="Your JHT balance today. You can see it in the JMO app.">
              <MoneyField id="retirement-jht" value={currentJhtBalance} onChange={setCurrentJhtBalance} />
            </Field>
            <Field label="Retirement savings now" htmlFor="retirement-personal" info="Money you’ve already set aside for retirement outside BPJS, like a fund or a pension account.">
              <MoneyField id="retirement-personal" value={currentPersonalSavings} onChange={setCurrentPersonalSavings} />
            </Field>
            <Field label="You add a month" htmlFor="retirement-contribution" info="What you put into those savings every month, on top of BPJS.">
              <MoneyField id="retirement-contribution" value={monthlyPersonalContribution} onChange={setMonthlyPersonalContribution} />
            </Field>
            {workerType === 'pu' && (
              <Field label="Years of JP paid so far" htmlFor="retirement-jp-years" info="How long you’ve been paying into JP, shown in JMO. JP began in July 2015.">
                <input id="retirement-jp-years" className="brutalist-input brutalist-input--currency" type="number" inputMode="decimal" min={0} max={Math.max(0, Math.min(ageNumber - 18, new Date(now).getFullYear() - 2015))} step={1 / 12} value={existingJpYears} onChange={(event) => setExistingJpYears(event.target.value)} />
              </Field>
            )}
            {Number(retirementAge) < 56 && (
              <div className="flex items-start justify-between gap-4 sm:col-span-2 xl:col-span-1">
                <p className="text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">
                  <span className="block text-sm font-medium text-[var(--ref-on-surface)]">Count JHT before 56</span>
                  Assumes you meet BPJS claim conditions after leaving work and cover the waiting period yourself.
                </p>
                <Toggle label="Count JHT before 56" checked={claimJhtEarly} onChange={setClaimJhtEarly} />
              </div>
            )}
          </div>
          </Group>

          <Group
            title="After you retire"
            summary={`Invested at ${formatDecimal(postRetirementReturn, 2)}% · lasting until ${payoutUntil || '—'}`}
            open={openGroups.has('after')}
            onToggle={() => toggleGroup('after')}
          >
            <p className="text-xs text-[var(--ref-on-surface-variant)]">Where the JHT lump sum and your savings go, and how long they last.</p>
            <div className="mt-4 grid grid-cols-2 items-start gap-x-3 gap-y-4">
              <Field label="Invested at" htmlFor="ret-post" info="The yearly return, after tax, on your JHT and savings once you retire. Money you live on should be somewhere safe, like SBN ritel; the button uses the latest ORI coupon.">
                <PercentField id="ret-post" value={postRetirementReturn} min={0} max={100} onChange={setPostRetirementReturn} />
              </Field>
              <Field label="Lasts until age" htmlFor="ret-until" info="When the money runs out. Many people live well past the average, so 90 leaves room for a long life; JP keeps paying after that.">
                <AgeField id="ret-until" value={payoutUntil} min={Number(retirementAge) + 1 || 19} max={110} onChange={setPayoutUntil} />
              </Field>
              <div className="col-span-2 grid grid-cols-1 gap-1.5" role="group" aria-label="A recent return after tax">
                {PAYOUT_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    title={preset.title}
                    aria-pressed={postRetirementReturn === preset.rate}
                    onClick={() => setPostRetirementReturn(preset.rate)}
                    className={cn(
                      'flex h-[34px] items-center justify-center gap-1.5 rounded-lg border text-[11px] transition-colors',
                      postRetirementReturn === preset.rate ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--ref-on-surface)]' : 'border-[var(--color-border)] text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]',
                    )}
                  >
                    <span className="font-semibold">{preset.label}</span>
                    <span className="tabular-nums opacity-80">{formatDecimal(preset.rate, 2)}%</span>
                  </button>
                ))}
              </div>
            </div>
          </Group>

          <Group
            title="Assumptions"
            summary={`Wages +${formatDecimal(salaryGrowthRate, 1)}% · inflation ${formatDecimal(inflationRate, 1)}% · JHT ${formatDecimal(jhtReturnRate, 1)}% · yours ${formatDecimal(personalReturnRate, 1)}%`}
            open={openGroups.has('assumptions')}
            onToggle={() => toggleGroup('assumptions')}
          >
            <p className="text-xs text-[var(--ref-on-surface-variant)]">Yearly rates until you retire. Returns are not guaranteed.</p>
            <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 xl:grid-cols-2">
              <Field label="Salary growth" htmlFor="ret-growth" info="How much your wage rises a year. JHT and JP grow with it."><PercentField id="ret-growth" value={salaryGrowthRate} min={0} max={100} onChange={setSalaryGrowthRate} /></Field>
              <Field label="Inflation" htmlFor="ret-inflation" info="How fast prices rise. Everything here is shown in today’s prices using it."><PercentField id="ret-inflation" value={inflationRate} min={0} max={100} onChange={setInflationRate} /></Field>
              <Field label="JHT return" htmlFor="ret-jht" info="What BPJS credits to JHT balances each year. It changes year to year."><PercentField id="ret-jht" value={jhtReturnRate} min={0} max={100} onChange={setJhtReturnRate} /></Field>
              <Field label="Your return" htmlFor="ret-personal" info="What your own retirement savings earn a year until you retire, after fees."><PercentField id="ret-personal" value={personalReturnRate} min={0} max={100} onChange={setPersonalReturnRate} /></Field>
              {workerType === 'pu' && <Field label="JP wage cap" htmlFor="ret-cap" className="col-span-2 sm:col-span-1 xl:col-span-2" info="The most wage JP counts. BPJS raises it every year; this keeps today’s figure, so it’s on the careful side."><MoneyField id="ret-cap" value={jpWageCap} onChange={setJpWageCap} /></Field>}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">
              Deposits arrive at month-end; wages grow once a year and your own deposits stay fixed. The JP cap defaults to the BPJS participant page and is held fixed; update it from your payroll record.
            </p>
          </Group>
        </Section>

        <div className="min-w-0 space-y-6">
          {projection && (
            <Section title="Your money over time">
              <div className="px-3 pb-4 pt-3 sm:px-5">
                <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-[var(--ref-on-surface-variant)]" aria-label="Legend">
                  <li className="flex items-center gap-1.5"><span className={cn('h-2.5 w-2.5 rounded-sm', PART_COLORS.jht)} aria-hidden />JHT</li>
                  <li className="flex items-center gap-1.5"><span className={cn('h-2.5 w-2.5 rounded-sm', PART_COLORS.personal)} aria-hidden />Your savings</li>
                  <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-dashed border-[var(--color-accent)] bg-[var(--color-accent)]/15" aria-hidden />Being spent</li>
                  <li className="ml-auto">In today’s prices</li>
                </ul>
                <div className="mt-3 h-[240px] sm:h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartRows} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="2 4" />
                      <XAxis
                        dataKey="age"
                        type="number"
                        domain={['dataMin', 'dataMax']}
                        ticks={Array.from(new Set([ageNumber, ...Array.from({ length: 12 }, (_, index) => (Math.floor(ageNumber / 10) + 1 + index) * 10).filter((age) => age < projection.payoutUntilAge && age - ageNumber >= 4), projection.payoutUntilAge]))}
                        tick={{ fontSize: 11, fill: 'var(--ref-on-surface-variant)' }} tickLine={false} axisLine={{ stroke: 'var(--color-border)' }} />
                      <YAxis width={52} tickFormatter={(value: number) => (balancesHidden ? '•••' : compactRupiah(value).replace('Rp', ''))} tick={{ fontSize: 11, fill: 'var(--ref-on-surface-variant)' }} tickLine={false} axisLine={false} />
                      <ReferenceLine x={projection.retirementAge} stroke="var(--ref-outline)" strokeDasharray="2 3" label={{ value: 'Retire', position: 'top', fill: 'var(--ref-on-surface-variant)', fontSize: 10 }} />
                      <Tooltip
                        cursor={{ stroke: 'var(--ref-outline)', strokeWidth: 1, strokeDasharray: '3 3' }}
                        offset={16}
                        isAnimationActive={false}
                        content={({ active, payload }) => {
                          const row = active ? (payload?.[0]?.payload as (typeof chartRows)[number] | undefined) : undefined;
                          if (!row) return null;
                          const building = row.jht !== undefined && row.age < projection.retirementAge;
                          const lines = building
                            ? [{ label: 'Total', value: row.jht! + row.personal!, strong: true }, { label: 'JHT', value: row.jht! }, { label: 'Your savings', value: row.personal! }]
                            : [{ label: 'Left to spend', value: row.left ?? 0, strong: true }];
                          return (
                            <div className="min-w-[190px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-xs shadow-lg">
                              <p className="font-semibold text-[var(--ref-on-surface)]">Age {Math.round(row.age)}</p>
                              <dl className="mt-1.5 space-y-1">
                                {lines.map((item) => (
                                  <div key={item.label} className="flex justify-between gap-4">
                                    <dt className="text-[var(--ref-on-surface-variant)]">{item.label}</dt>
                                    <dd className={cn('tabular-nums text-[var(--ref-on-surface)]', item.strong && 'font-semibold')}>{formatAmount(Math.round(item.value))}</dd>
                                  </div>
                                ))}
                              </dl>
                            </div>
                          );
                        }}
                      />
                      <Area type="monotone" stackId="assets" dataKey="jht" stroke="var(--color-surface)" strokeWidth={2} fill="var(--color-accent)" fillOpacity={0.35} isAnimationActive={false} activeDot={false} connectNulls={false} />
                      <Area type="monotone" stackId="assets" dataKey="personal" stroke="var(--color-accent)" strokeWidth={2} fill="var(--color-accent)" fillOpacity={0.9} isAnimationActive={false} activeDot={false} connectNulls={false} />
                      <Area type="monotone" dataKey="left" stroke="var(--color-accent)" strokeWidth={1.5} strokeDasharray="4 3" fill="var(--color-accent)" fillOpacity={0.15} isAnimationActive={false} activeDot={{ r: 4, stroke: 'var(--color-surface)', strokeWidth: 2, fill: 'var(--color-accent)' }} connectNulls={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">
                  At this wage BPJS takes JHT {formatAmount(projection.jhtMonthlyTotal)} a month ({formatAmount(projection.jhtMonthlyEmployee)} from you{projection.jhtMonthlyEmployer > 0 ? `, ${formatAmount(projection.jhtMonthlyEmployer)} from your employer` : ''}){projection.jpEligible ? ` and JP ${formatAmount(projection.jpMonthlyEmployee + projection.jpMonthlyEmployer)} (${formatAmount(projection.jpMonthlyEmployee)} from you, ${formatAmount(projection.jpMonthlyEmployer)} from your employer)` : ''}.
                </p>
              </div>
            </Section>
          )}

          <Section title="What old age needs">
            {/* Health cover first: the one part here you can add to your plan. */}
            <div className="settings-compact px-4 py-4 sm:px-5">
              <p className="text-sm font-semibold text-[var(--ref-on-surface)]">Add health cover to what you want to spend</p>
              <p className="mt-0.5 text-xs text-[var(--ref-on-surface-variant)]">
                Your employer stops paying <Term meaning="The national health insurance. Everyone must be a member; after work you pay for yourself and your family, by class.">BPJS Kesehatan</Term> when you leave work. From then it’s <Term href={SOURCES.bpjsKesehatan.href} meaning={SOURCES.bpjsKesehatan.label}>Rp35.000–150.000 a person a month</Term>.
              </p>
              <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,1.2fr)]">
                <Field label="BPJS class">
                  <Segmented ariaLabel="BPJS Kesehatan class" value={healthClass} onChange={setHealthClass} options={[{ value: 'none', label: 'None' }, { value: '3', label: 'Kelas 3' }, { value: '2', label: 'Kelas 2' }, { value: '1', label: 'Kelas 1' }]} />
                </Field>
                <Field label="People">
                  <Segmented ariaLabel="People covered" value={healthPeople} onChange={setHealthPeople} options={[{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }, { value: '4', label: '4' }]} />
                </Field>
                <Field label="Private insurance" htmlFor="ret-private-premium" info="A month, in today’s prices. BPJS doesn’t pay for everything. Private premiums depend on the insurer, benefits and your health, and rise with age; senior policies generally take new members only up to about 65 (Kontan), so buy before you retire.">
                  <MoneyField id="ret-private-premium" value={privatePremium} onChange={setPrivatePremium} placeholder="0 a month" />
                </Field>
              </div>
              {healthCost > 0 && (
                <p className="mt-2 text-xs text-[var(--ref-on-surface-variant)]">
                  Adds <span className="font-semibold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(healthCost)}</span> a month to what you want to spend, in today’s prices.
                </p>
              )}
            </div>

            {/* The facts: one number each, what it means, and what to do about it. */}
            <dl className="grid grid-cols-1 gap-px border-t border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-2 2xl:grid-cols-3">
              {[
                { key: 'aim', stat: <Term href={SOURCES.dplk.href} meaning={SOURCES.dplk.label}>70–80%</Term>, unit: 'of your last income', title: 'What to aim for', body: <>What planners suggest you live on. The <Term href={SOURCES.dplk.href} meaning={`ILO Convention 102, as cited by ${SOURCES.dplk.label}`}>ILO’s minimum is 40%</Term>.</> },
                { key: 'gap', stat: <Term href={SOURCES.ojk.href} meaning={SOURCES.ojk.label}>10–15%</Term>, unit: 'what pensions replace today', title: 'Most of it is on you', body: 'BPJS and pension funds cover little, so your own savings carry the rest.' },
                { key: 'medical', stat: <Term href={SOURCES.medical.href} meaning={SOURCES.medical.label}>17,8%</Term>, unit: 'medical costs, 2026', title: 'Health costs rise fastest', body: 'Against about 2.5% for prices in general. Keep a separate health fund or private cover.' },
                { key: 'long', stat: <Term href={SOURCES.lifeAt60.href} meaning={SOURCES.lifeAt60.label}>19 yrs</Term>, unit: 'more, on average, at 60', title: 'It has to last', body: <>And many live longer, so plan to 90. JP keeps paying either way. <Term href={SOURCES.lifeBirth.href} meaning={SOURCES.lifeBirth.label}>Why not 72?</Term></> },
                { key: 'keep', stat: <Term href={SOURCES.ori030.href} meaning={SOURCES.ori030.label}>7%</Term>, unit: 'ORI030, before 10% tax', title: 'Keep it safe and near', body: <><Term meaning="Government bonds sold to individuals (ORI, SR, SBR, ST), from Rp1 juta, backed by the state.">SBN ritel</Term> pays more than deposits, <Term href={SOURCES.couponTax.href} meaning={SOURCES.couponTax.label}>taxed less</Term>. Spread it over several series.</> },
                { key: 'jht', stat: <Term href={SOURCES.jhtPartial.href} meaning={SOURCES.jhtPartial.label}>30%</Term>, unit: 'of JHT, early, for a home', title: 'Taking JHT early', body: 'After 10 years of membership; 10% for other needs. What you take now won’t grow until 56.' },
              ].map((fact) => (
                <div key={fact.key} className="bg-[var(--color-surface)] px-4 py-4 sm:px-5">
                  <dt>
                    <span className="block font-headline text-2xl font-black tabular-nums tracking-tight text-[var(--ref-on-surface)]">{fact.stat}</span>
                    <span className="mt-0.5 block text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]">{fact.unit}</span>
                  </dt>
                  <dd className="mt-2">
                    <span className="block text-sm font-semibold text-[var(--ref-on-surface)]">{fact.title}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">{fact.body}</span>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="border-t border-[var(--color-border)] px-4 py-3 text-xs leading-relaxed text-[var(--ref-on-surface-variant)] sm:px-5">
              Underlined figures show their source; tap one to open it. Figures change, so check before you rely on them.
            </p>
          </Section>

          <Section title="How benefits are estimated">
            <dl className="divide-y divide-[var(--color-border)] text-sm">
              {[
                { title: 'JHT', body: 'Employees pay 5.7% of the reported wage: 2% from you, 3.7% from your employer. Modelled as a lump sum; BPJS lists age 56 as a claim milestone.' },
                { title: 'JP', body: 'Employees pay 3%: 1% from you, 2% from your employer. Estimate: 1% × years paid in × average capped wage. Past wages use today’s wage as a stand-in, without historical revaluation. The wage cap is held fixed.' },
                { title: 'Different ages', body: 'JHT age claims begin at 56; leaving work may qualify earlier. JP’s normal age rises from 59 in 2025–2027 to 65 in 2043, set by the year you reach it. If you’re still employed then, you may take JP at the normal age or when you stop working, up to three years later. Early retirement before the normal JP age isn’t included.' },
                { title: 'Benefit limits', body: `BPJS lists a 2026 JP monthly minimum of ${formatAmount(INDONESIA_RULES_2026.jpMinimumMonthlyBenefit)} and maximum of ${formatAmount(INDONESIA_RULES_2026.jpMaximumMonthlyBenefit)}. Check your own record in JMO.` },
                { title: 'Spending it down', body: 'From retirement, JHT and your savings earn the Invested at rate and pay out a monthly amount that rises with inflation, ending at zero at the age you set. Market swings and taxes beyond the rate you enter aren’t modelled.' },
              ].map((item) => (
                <div key={item.title} className="grid gap-1 px-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4 sm:px-5">
                  <dt className="font-semibold text-[var(--ref-on-surface)]">{item.title}</dt>
                  <dd className="text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">{item.body}</dd>
                </div>
              ))}
            </dl>
            <div className="space-y-3 border-t border-[var(--color-border)] px-4 py-3 text-xs leading-relaxed text-[var(--ref-on-surface-variant)] sm:px-5">
              <p>A planning estimate, not an official BPJS calculation. JP limits stay at the published 2026 values; future indexation and fees are left out. Fewer than 15 years paid in may qualify for a lump sum, which isn’t included. Disability and survivor benefits, BPU participants with past PU entitlement, and the gap between an early retirement and the normal JP age aren’t simulated.</p>
              <p>
                Sources: {source('https://www.bpjsketenagakerjaan.go.id/penerima-upah.html', 'BPJS Ketenagakerjaan participant information')}, {source('https://peraturan.bpk.go.id/Details/5613/pp-no-45-tahun-2015', 'PP 45/2015 (JP)')} and {source('https://peraturan.bpk.go.id/Details/5614/pp-no-46-tahun-2015', 'PP 46/2015 (JHT)')}. Rules and benefit limits can change.
              </p>
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}
