import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, Info, Landmark, ShieldCheck, WalletCards, ArrowUpRight, ChevronDown, Target } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from 'recharts';
import { Card } from '../ui/Card';
import { CurrencyInput } from '../ui/CurrencyInput';
import { Input } from '../ui/Input';
import { formatCurrency, cn } from '../../lib/utils';
import { api } from '../../lib/api';
import { calculateRetirementProjection, INDONESIA_RULES_2026, type WorkerType } from '../../lib/retirement';

function parseMoney(value: string): number {
  if (!value.trim()) return 0;
  return Number(value.replace(/\./g, '').replace(',', '.'));
}

function parseRate(value: string, fallback: number): number {
  const parsed = Number(value);
  return value.trim() ? parsed : fallback;
}

function formatCompactCurrency(value: number): string {
  if (value >= 1_000_000_000) return `Rp ${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `Rp ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `Rp ${(value / 1_000).toFixed(0)}k`;
  return formatCurrency(value);
}

function RetirementMetric({ label, value, detail, tone = 'default' }: { label: string; value: string; detail: string; tone?: 'default' | 'positive' | 'negative' }) {
  return (
    <div className="min-w-0 rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-5">
      <p className="text-xs font-bold uppercase tracking-widest text-[var(--ref-outline)]">{label}</p>
      <p className={cn(
        'mt-3 break-words font-headline text-xl font-extrabold tracking-tight tabular-nums',
        tone === 'positive' && 'text-[var(--color-success)]',
        tone === 'negative' && 'text-[var(--color-danger)]',
      )}>{value}</p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">{detail}</p>
    </div>
  );
}

export function RetirementPlanner() {
  const [workerType, setWorkerType] = useState<WorkerType>('pu');
  const [currentAge, setCurrentAge] = useState('30');
  const [retirementAge, setRetirementAge] = useState(String(INDONESIA_RULES_2026.jpRetirementAge));
  const [monthlyWage, setMonthlyWage] = useState('');
  const [currentJhtBalance, setCurrentJhtBalance] = useState('');
  const [currentPersonalSavings, setCurrentPersonalSavings] = useState('');
  const [monthlyPersonalContribution, setMonthlyPersonalContribution] = useState('');
  const [existingJpYears, setExistingJpYears] = useState('0');
  const [targetMonthlySpending, setTargetMonthlySpending] = useState('');
  const [salaryGrowthRate, setSalaryGrowthRate] = useState('5');
  const [inflationRate, setInflationRate] = useState('3');
  const [jhtReturnRate, setJhtReturnRate] = useState(String(INDONESIA_RULES_2026.jhtReturnRate));
  const [personalReturnRate, setPersonalReturnRate] = useState('6');
  const [withdrawalRate, setWithdrawalRate] = useState('4');
  const [claimJhtEarly, setClaimJhtEarly] = useState(false);
  const [jpWageCap, setJpWageCap] = useState(String(INDONESIA_RULES_2026.jpWageCap));
  const currentAgeEdited = useRef(false);

  useEffect(() => {
    void api.profile.get()
      .then((profile) => {
        if (!currentAgeEdited.current && profile.age !== null && profile.age >= 18) {
          setCurrentAge(String(profile.age));
        }
      })
      .catch(() => undefined);
  }, []);

  const result = useMemo(() => {
    try {
      if (!currentAge.trim() || !retirementAge.trim()) throw new Error('Enter both ages to calculate your plan.');
      return { projection: calculateRetirementProjection({
    workerType,
    currentAge: Number(currentAge),
    retirementAge: Number(retirementAge),
    monthlyWage: parseMoney(monthlyWage),
    currentJhtBalance: parseMoney(currentJhtBalance),
    currentPersonalSavings: parseMoney(currentPersonalSavings),
    monthlyPersonalContribution: parseMoney(monthlyPersonalContribution),
    existingJpYears: workerType === 'pu' ? Number(existingJpYears) : 0,
    salaryGrowthRate: parseRate(salaryGrowthRate, 5),
    inflationRate: parseRate(inflationRate, 3),
    jhtReturnRate: parseRate(jhtReturnRate, INDONESIA_RULES_2026.jhtReturnRate),
    personalReturnRate: parseRate(personalReturnRate, 6),
    withdrawalRate: parseRate(withdrawalRate, 4),
    targetMonthlySpending: parseMoney(targetMonthlySpending),
    claimJhtEarly,
    jpWageCap: parseMoney(jpWageCap),
  }), error: null };
    } catch {
      return { projection: null, error: 'Check your inputs: ages must be whole numbers from 18–100, retirement cannot be earlier than today, amounts must be positive or zero, and rates must be 0–100%. JP history cannot predate age 18 or the program’s start in 2015.' };
    }
  }, [
    workerType,
    currentAge,
    retirementAge,
    monthlyWage,
    currentJhtBalance,
    currentPersonalSavings,
    monthlyPersonalContribution,
    existingJpYears,
    targetMonthlySpending,
    salaryGrowthRate,
    inflationRate,
    jhtReturnRate,
    personalReturnRate,
    withdrawalRate,
    claimJhtEarly,
    jpWageCap,
  ]);
  const { projection } = result;

  const hasTarget = parseMoney(targetMonthlySpending) > 0;
  const gapTone: 'default' | 'positive' | 'negative' = !hasTarget ? 'default' : (projection?.monthlyGap ?? 0) > 0 ? 'negative' : 'positive';
  const gapLabel = !hasTarget ? 'Add your target' : (projection?.monthlyGap ?? 0) > 0 ? 'Monthly shortfall' : 'Monthly surplus';
  const coverage = projection && hasTarget ? Math.round(projection.estimatedMonthlyIncome / projection.projectedRetirementSpending * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[#b8cdf7] bg-[#eef4ff] p-6 text-[var(--color-text-primary)] dark:border-[#36558b] dark:bg-[#172b4d] dark:text-[#f5f8ff] sm:p-8">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ref-primary)]" />
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#003b91] dark:text-[#b9d0ff]">Your next chapter</p>
            <h2 className="mt-2 font-headline text-2xl font-extrabold tracking-tight sm:text-3xl">A clearer path to retirement.</h2>
            <p className="mt-1 leading-relaxed text-[#334a73] dark:text-[#d4e2ff]">
              Bring your JHT, pension, and personal savings together. See what your future lifestyle could cost and how much to set aside today.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(300px,0.85fr)_minmax(0,2fr)]">
        <Card className="min-w-0" title="01 / Build your plan">
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-secondary)]" htmlFor="retirement-worker-type">Worker type</label>
              <select
                id="retirement-worker-type"
                value={workerType}
                onChange={(event) => setWorkerType(event.target.value as WorkerType)}
                className="brutalist-input mt-1 w-full"
              >
                <option value="pu">Employee / Penerima Upah (PU)</option>
                <option value="bpu">Independent / Bukan Penerima Upah (BPU)</option>
              </select>
              {workerType === 'bpu' && <p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">BPU is modeled with voluntary JHT only at 2% of the entered base; actual BPU contribution brackets may differ. JP is not included.</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input label="Current age" type="number" min="18" max="100" value={currentAge} onChange={(event) => { currentAgeEdited.current = true; setCurrentAge(event.target.value); }} />
              <Input label="Retirement age" type="number" min={currentAge || '18'} max="100" value={retirementAge} onChange={(event) => setRetirementAge(event.target.value)} />
            </div>
            <CurrencyInput label={workerType === 'pu' ? 'Monthly reported wage' : 'Monthly JHT contribution base'} value={monthlyWage} onChange={setMonthlyWage} size="sm" />
            <CurrencyInput label="Current JHT balance" value={currentJhtBalance} onChange={setCurrentJhtBalance} size="sm" />
            <CurrencyInput label="Current personal retirement savings" value={currentPersonalSavings} onChange={setCurrentPersonalSavings} size="sm" />
            <CurrencyInput label="Monthly personal contribution" value={monthlyPersonalContribution} onChange={setMonthlyPersonalContribution} size="sm" />
            {workerType === 'pu' && <Input label="Existing JP contribution (years)" type="number" min="0" max={Math.min(Number(currentAge) - 18, new Date().getFullYear() - 2015)} step={1 / 12} value={existingJpYears} onChange={(event) => setExistingJpYears(event.target.value)} />}
            <div className="rounded-xl border border-[#36558b] bg-[#1d3159] p-4 text-white">
              <CurrencyInput label="Monthly lifestyle target" value={targetMonthlySpending} onChange={setTargetMonthlySpending} size="sm" showDivider={false} hint="Use today’s rupiah. We apply inflation up to your retirement age." tone="inverse" />
            </div>
            {Number(retirementAge) < 56 && <label className="flex items-start gap-3 text-xs leading-relaxed text-[var(--ref-on-surface-variant)]"><input type="checkbox" className="mt-1 accent-[var(--ref-primary)]" checked={claimJhtEarly} onChange={event => setClaimJhtEarly(event.target.checked)} />Include JHT after leaving work before 56. Assumes you satisfy BPJS claim conditions and cover the claim waiting period separately.</label>}
          </div>
        </Card>

        <div className="min-w-0 space-y-6">
          <details className="group rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold">Adjust assumptions <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /></summary>
            <div className="mt-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Salary growth %" type="number" min="0" max="100" step="0.1" value={salaryGrowthRate} onChange={(event) => setSalaryGrowthRate(event.target.value)} />
              <Input label="Inflation %" type="number" min="0" max="100" step="0.1" value={inflationRate} onChange={(event) => setInflationRate(event.target.value)} />
              <Input label="JHT return %" type="number" min="0" max="100" step="0.1" value={jhtReturnRate} onChange={(event) => setJhtReturnRate(event.target.value)} />
              <Input label="Personal return %" type="number" min="0" max="100" step="0.1" value={personalReturnRate} onChange={(event) => setPersonalReturnRate(event.target.value)} />
            </div>
            <div className="mt-4 max-w-xs">
              <Input label="Annual withdrawal %" type="number" min="0" max="100" step="0.1" value={withdrawalRate} onChange={(event) => setWithdrawalRate(event.target.value)} />
            </div>
            {workerType === 'pu' && <div className="mt-5"><CurrencyInput label="JP monthly wage cap" value={jpWageCap} onChange={setJpWageCap} size="sm" hint="Defaults to the BPJS participant page snapshot. Update from your current payroll record; the cap is held fixed in this estimate." /></div>}
            <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              All rates are annual assumptions. Deposits arrive at month-end; wages grow once a year and personal deposits stay fixed. Returns are not guaranteed. This estimates income at retirement, not how long assets will last.
            </p>
            </div>
          </details>

          {result.error && <div role="alert" className="rounded-2xl border border-[var(--color-danger)] p-5 text-sm text-[var(--color-danger)]">{result.error}</div>}
          {projection && <>
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm font-semibold"><Target className="h-4 w-4 text-[var(--ref-primary)]" />02 / Your retirement outlook</p>
              <span className="rounded-full bg-[var(--ref-surface-container-low)] px-3 py-1 text-xs font-medium">Age {projection.retirementAge} · {projection.yearsToRetirement} years to prepare</span>
            </div>
            <p className="mt-6 text-sm text-[var(--ref-on-surface-variant)]">Projected monthly income</p>
            <p className="mt-2 break-words font-headline text-3xl font-extrabold tracking-tight tabular-nums sm:text-4xl">{formatCurrency(projection.estimatedMonthlyIncome)}<span className="ml-2 text-sm font-normal text-[var(--ref-outline)]">/ month</span></p>
            <div className="mt-6 flex justify-between gap-3 text-xs text-[var(--ref-on-surface-variant)]"><span>{hasTarget ? `${coverage}% of your lifestyle target` : 'Add a lifestyle target to measure your progress'}</span><span>{hasTarget ? formatCurrency(projection.projectedRetirementSpending) : 'In future rupiah'}</span></div>
            <div role="progressbar" aria-label="Retirement income target covered" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, coverage)} className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--ref-surface-container-highest)]"><div className="h-full rounded-full bg-[var(--ref-primary)] transition-all" style={{ width: `${Math.min(100, coverage)}%` }} /></div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <RetirementMetric label="JHT projected balance" value={formatCurrency(projection.projectedJht)} detail={projection.jhtAvailable ? `Included in assets at age ${projection.retirementAge}, subject to claim eligibility.` : `Excluded before 56 unless you select an eligible early claim.`} />
            <RetirementMetric label="JP monthly estimate" value={projection.estimatedJpIncome > 0 ? formatCurrency(projection.estimatedJpIncome) : 'Not included'} detail={!projection.jpEligible ? 'JP is modeled for PU participants only.' : !projection.jpAvailable ? `At your planned retirement in ${projection.retirementYear}, the normal JP age is ${projection.jpNormalAgeAtRetirement}; you will be ${projection.retirementAge}. You first meet the moving JP age at ${projection.jpAccessAge} in ${projection.jpAccessYear}, so no JP income is included at retirement.` : `${projection.totalJpContributionYears.toFixed(1)} years modeled; 15 years is needed for monthly JP.`} />
            <RetirementMetric label="Personal assets" value={formatCurrency(projection.projectedPersonalSavings)} detail={`Your personal balance at age ${projection.retirementAge}.`} />
            <RetirementMetric label={gapLabel} value={hasTarget ? formatCurrency(Math.abs(projection.monthlyGap)) : '—'} detail={hasTarget ? `Target at retirement: ${formatCurrency(projection.projectedRetirementSpending)} per month.` : 'Enter a target monthly spending amount to see the gap.'} tone={gapTone} />
          </div>

          <Card title="Retirement income plan">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="min-w-0 rounded-xl bg-[var(--ref-surface-container-low)] p-4">
                <p className="text-xs font-bold uppercase tracking-widest text-[var(--ref-outline)]">Target monthly spending</p>
                <p className="mt-2 font-headline text-xl font-extrabold">{formatCurrency(projection.projectedRetirementSpending)}</p>
                <p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">Nominal rupiah at retirement</p>
              </div>
              <div className="min-w-0 rounded-xl bg-[var(--ref-surface-container-low)] p-4">
                <p className="text-xs font-bold uppercase tracking-widest text-[var(--ref-outline)]">JP + assets</p>
                <p className="mt-2 font-headline text-xl font-extrabold text-[var(--color-success)]">{formatCurrency(projection.estimatedMonthlyIncome)}</p>
                <p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">JP benefit plus {projection.withdrawalRate}% annual asset drawdown</p>
              </div>
              <div className="min-w-0 rounded-xl border border-[#b8cdf7] bg-[#e7f0ff] p-5 text-[var(--color-text-primary)] dark:border-[#36558b] dark:bg-[#1d3964] dark:text-[#f5f8ff] sm:col-span-2">
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#003b91] dark:text-[#b9d0ff]"><ArrowUpRight className="h-4 w-4" />{projection.yearsToRetirement === 0 ? 'Capital needed today' : 'Extra monthly saving'}</p>
                <p className="mt-2 break-words font-headline text-2xl font-extrabold">{!hasTarget ? 'Set your lifestyle target' : projection.capitalGap === null ? 'Set a withdrawal rate above 0%' : formatCurrency(projection.yearsToRetirement === 0 ? projection.capitalGap : projection.requiredAdditionalSaving ?? 0)}</p>
                <p className="mt-2 text-xs leading-relaxed text-[#334a73] dark:text-[#d4e2ff]">{projection.yearsToRetirement === 0 ? 'There is no time left for new monthly deposits in this scenario.' : 'Additional to your current monthly contribution, saved from now until retirement.'}</p>
              </div>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">
              At the current reported wage, modeled monthly BPJS contributions are JHT {formatCurrency(projection.jhtMonthlyTotal)} ({formatCurrency(projection.jhtMonthlyEmployee)} employee{projection.jhtMonthlyEmployer > 0 ? ` + ${formatCurrency(projection.jhtMonthlyEmployer)} employer` : ''}){projection.jpEligible ? ` and JP ${formatCurrency(projection.jpMonthlyEmployee + projection.jpMonthlyEmployer)} (${formatCurrency(projection.jpMonthlyEmployee)} employee + ${formatCurrency(projection.jpMonthlyEmployer)} employer)` : ''}.
            </p>
            <div className="mt-6 border-t border-[var(--color-border)] pt-5"><p className="font-semibold">How your assets could grow</p><p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">JHT and personal savings combined · future rupiah</p></div>
            <div className="mt-5 h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={projection.series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="retirementJht" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--ref-primary)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--ref-primary)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="retirementPersonal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--ref-secondary)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--ref-secondary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="age" tickFormatter={(value) => `Age ${value}`} />
                  <YAxis tickFormatter={(value) => formatCompactCurrency(Number(value))} width={65} />
                  <Tooltip contentStyle={{ background: 'var(--ref-surface-container-lowest)', border: '1px solid var(--color-border)', borderRadius: 12, color: 'var(--color-text-primary)' }} formatter={(value) => formatCurrency(Number(value))} labelFormatter={(value) => `Age ${value}`} />
                  <Legend iconType="circle" />
                  <Area type="monotone" stackId="assets" dataKey="jht" name="JHT" stroke="var(--ref-primary)" fill="url(#retirementJht)" strokeWidth={2} isAnimationActive={false} />
                  <Area type="monotone" stackId="assets" dataKey="personal" name="Personal savings" stroke="var(--ref-secondary)" fill="url(#retirementPersonal)" strokeWidth={2} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          </>}
          <details className="group rounded-2xl border border-[var(--color-border)] p-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold">How benefits are estimated <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /></summary>
            <div className="mt-5">
            <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div className="flex items-start gap-3 rounded-xl bg-[var(--ref-surface-container-low)] p-3">
                <WalletCards className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ref-primary)]" />
                <div><p className="font-bold">JHT</p><p className="mt-1 text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">PU total 5.7% of reported wage: 2% employee + 3.7% employer. Modeled as a lump sum; BPJS lists age 56 as a claim milestone.</p></div>
              </div>
              <div className="flex items-start gap-3 rounded-xl bg-[var(--ref-surface-container-low)] p-3">
                <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ref-primary)]" />
                <div><p className="font-bold">JP</p><p className="mt-1 text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">PU total 3%: 1% employee + 2% employer. Estimate: 1% × contribution years × average capped wage. Past wages use today’s wage as a proxy; no historical inflation revaluation is included. The editable wage cap is held fixed.</p></div>
              </div>
              <div className="flex items-start gap-3 rounded-xl bg-[var(--ref-surface-container-low)] p-3">
                <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ref-primary)]" />
                <div><p className="font-bold">Different milestones</p><p className="mt-1 text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">JHT age claims begin at 56; leaving work may qualify earlier. JP’s normal age increases from 59 in 2025–2027 to 65 in 2043, based on the year you reach that age. If you remain employed then, you may take JP at the normal age or when you stop working, for up to three years afterward. Early retirement before the normal JP age is not included.</p></div>
              </div>
              <div className="flex items-start gap-3 rounded-xl bg-[var(--ref-surface-container-low)] p-3">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ref-primary)]" />
                <div><p className="font-bold">Benefit limits</p><p className="mt-1 text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">BPJS lists 2026 JP monthly minimum {formatCurrency(INDONESIA_RULES_2026.jpMinimumMonthlyBenefit)} and maximum {formatCurrency(INDONESIA_RULES_2026.jpMaximumMonthlyBenefit)}. Verify your actual record in JMO.</p></div>
              </div>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">Planning estimate, not an official BPJS calculation. JP limits stay at the published 2026 values; future indexation, taxes, and fees are excluded. Fewer than 15 contribution years may qualify for a lump sum, which is not included here. Disability and survivor benefits, BPU participants with past PU entitlement, post-retirement asset depletion, and the period between an early retirement date and normal JP age are not simulated.</p>
            <p className="mt-4 text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">
              Sources: <a className="font-semibold underline" href="https://www.bpjsketenagakerjaan.go.id/penerima-upah.html" target="_blank" rel="noreferrer">BPJS Ketenagakerjaan participant information</a>, <a className="font-semibold underline" href="https://peraturan.bpk.go.id/Details/5613/pp-no-45-tahun-2015" target="_blank" rel="noreferrer">PP 45/2015 (JP)</a>, and <a className="font-semibold underline" href="https://peraturan.bpk.go.id/Details/5614/pp-no-46-tahun-2015" target="_blank" rel="noreferrer">PP 46/2015 (JHT)</a>. Rules and benefit limits can change.
            </p>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}


