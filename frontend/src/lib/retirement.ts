export const INDONESIA_RULES_2026 = {
  jhtEmployeeRate: 0.02,
  jhtEmployerRate: 0.037,
  jhtReturnRate: 5,
  jhtAccessAge: 56,
  jpEmployeeRate: 0.01,
  jpEmployerRate: 0.02,
  jpRetirementAge: 59,
  jpWageCap: 10_547_400,
  jpMinimumMonthlyBenefit: 411_400,
  jpMaximumMonthlyBenefit: 4_932_300,
  jpMinimumContributionYears: 15,
} as const;

export type WorkerType = 'pu' | 'bpu';

interface RetirementProjection {
  yearsToRetirement: number;
  retirementAge: number;
  jhtMonthlyEmployee: number;
  jhtMonthlyEmployer: number;
  jhtMonthlyTotal: number;
  jpMonthlyEmployee: number;
  jpMonthlyEmployer: number;
  projectedJht: number;
  projectedPersonalSavings: number;
  projectedAssets: number;
  availableAssetsAtRetirement: number;
  projectedRetirementSpending: number;
  estimatedAssetIncome: number;
  estimatedJpIncome: number;
  /** The JP pension a month once it starts at `jpAccessAge`, even when that is after retirement; 0 without one. */
  jpIncomeWhenPaid: number;
  /** Rupiah at retirement per rupiah today: divide by it for today's prices. */
  inflationFactor: number;
  estimatedMonthlyIncome: number;
  monthlyGap: number;
  requiredAdditionalSaving: number | null;
  capitalGap: number | null;
  jpAccessAge: number;
  jpAccessYear: number;
  retirementYear: number;
  jpNormalAgeAtRetirement: number;
  payoutUntilAge: number;
  /** The first month's pay-out from JHT and from personal savings, at retirement. */
  jhtIncome: number;
  personalIncome: number;
  totalJpContributionYears: number;
  jpAverageWage: number;
  jhtAvailable: boolean;
  jpAvailable: boolean;
  jpEligible: boolean;
  series: Array<{ age: number; jht: number; personal: number; total: number }>;
  /** JHT (when claimable) and savings left each year after retiring, as they're paid out. */
  drawdown: Array<{ age: number; assets: number }>;
}

function futureValueFactor(monthlyRate: number, months: number): number {
  if (months <= 0) return 0;
  if (monthlyRate === 0) return months;
  return Math.expm1(months * Math.log1p(monthlyRate)) / monthlyRate;
}

/** PP 45/2015: age rises every three years, reaching 65 in 2043. */
export function jpAgeForYear(year: number): number {
  return Math.min(65, 59 + Math.max(0, Math.floor((year - 2025) / 3)));
}

export function jpAccessAge(currentAge: number, currentYear: number): number {
  for (let age = currentAge; age <= 100; age += 1) {
    if (age >= jpAgeForYear(currentYear + age - currentAge)) return age;
  }
  return 65;
}

export function calculateRetirementProjection(input: {
  workerType: WorkerType;
  currentAge: number;
  retirementAge: number;
  monthlyWage: number;
  currentJhtBalance: number;
  currentPersonalSavings: number;
  monthlyPersonalContribution: number;
  existingJpYears: number;
  salaryGrowthRate: number;
  inflationRate: number;
  jhtReturnRate: number;
  personalReturnRate: number;
  /** Yearly return on JHT and savings after retiring, e.g. SBN ritel net of tax. */
  postRetirementReturn: number;
  /** The age the money should last until; it's spent down evenly, rising with inflation. */
  payoutUntilAge: number;
  targetMonthlySpending: number;
  currentYear?: number;
  claimJhtEarly?: boolean;
  jpWageCap?: number;
}): RetirementProjection {
  const currentYear = input.currentYear ?? new Date().getFullYear();
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'number' && (!Number.isFinite(value) || value < 0 || value > 1e15)) {
      throw new RangeError(`Invalid ${key}`);
    }
  }
  if (!Number.isInteger(input.currentAge) || !Number.isInteger(input.retirementAge)
    || input.currentAge < 18 || input.retirementAge < input.currentAge || input.retirementAge > 100
    || input.existingJpYears > Math.min(input.currentAge - 18, Math.max(0, currentYear - 2015))
    || !Number.isInteger(input.payoutUntilAge) || input.payoutUntilAge <= input.retirementAge || input.payoutUntilAge > 110
    || [input.salaryGrowthRate, input.inflationRate, input.jhtReturnRate, input.personalReturnRate, input.postRetirementReturn].some(rate => rate > 100)) {
    throw new RangeError('Check ages, contribution history, and annual rates.');
  }
  const pensionAge = jpAccessAge(input.currentAge, currentYear);
  const pensionYear = currentYear + pensionAge - input.currentAge;
  const yearsToRetirement = Math.max(0, input.retirementAge - input.currentAge);
  const retirementYear = currentYear + yearsToRetirement;
  const jpNormalAgeAtRetirement = jpAgeForYear(retirementYear);
  const monthsToRetirement = Math.round(yearsToRetirement * 12);
  const jhtTotalRate = input.workerType === 'pu'
    ? INDONESIA_RULES_2026.jhtEmployeeRate + INDONESIA_RULES_2026.jhtEmployerRate
    : INDONESIA_RULES_2026.jhtEmployeeRate;
  const jpEligible = input.workerType === 'pu';
  const wageCap = input.jpWageCap ?? INDONESIA_RULES_2026.jpWageCap;
  const jpWage = Math.min(input.monthlyWage, wageCap);
  const jpExistingMonths = jpEligible ? Math.max(0, Math.round(input.existingJpYears * 12)) : 0;
  // Stop new JP accrual at eligibility; deferred claims are outside this model.
  const jpFutureMonths = jpEligible && jpWage > 0
    ? Math.min(monthsToRetirement, Math.max(0, (pensionAge - input.currentAge) * 12)) : 0;
  const jpTotalMonths = jpExistingMonths + jpFutureMonths;
  const salaryGrowth = input.salaryGrowthRate / 100;
  const jhtMonthlyRate = Math.pow(1 + input.jhtReturnRate / 100, 1 / 12) - 1;
  const personalMonthlyRate = Math.pow(1 + input.personalReturnRate / 100, 1 / 12) - 1;

  let jhtBalance = input.currentJhtBalance;
  let personalBalance = input.currentPersonalSavings;
  let futureJpWageTotal = jpExistingMonths * jpWage;
  const series: RetirementProjection['series'] = [{
    age: input.currentAge,
    jht: Math.round(jhtBalance),
    personal: Math.round(personalBalance),
    total: Math.round(jhtBalance + personalBalance),
  }];

  for (let month = 1; month <= monthsToRetirement; month += 1) {
    const wageAtMonth = input.monthlyWage * Math.pow(1 + salaryGrowth, Math.floor((month - 1) / 12));
    jhtBalance = jhtBalance * (1 + jhtMonthlyRate) + wageAtMonth * jhtTotalRate;
    personalBalance = personalBalance * (1 + personalMonthlyRate) + input.monthlyPersonalContribution;
    if (month <= jpFutureMonths) futureJpWageTotal += Math.min(wageAtMonth, wageCap);

    if (month % 12 === 0 || month === monthsToRetirement) {
      series.push({
        age: Number((input.currentAge + month / 12).toFixed(1)),
        jht: Math.round(jhtBalance),
        personal: Math.round(personalBalance),
        total: Math.round(jhtBalance + personalBalance),
      });
    }
  }

  const averageJpWage = jpTotalMonths > 0 ? futureJpWageTotal / jpTotalMonths : 0;
  const rawJpIncome = jpEligible ? 0.01 * (jpTotalMonths / 12) * averageJpWage : 0;
  const estimatedJpIncome = jpEligible && averageJpWage > 0 && jpTotalMonths >= INDONESIA_RULES_2026.jpMinimumContributionYears * 12
    ? Math.min(
        INDONESIA_RULES_2026.jpMaximumMonthlyBenefit,
        Math.max(INDONESIA_RULES_2026.jpMinimumMonthlyBenefit, rawJpIncome),
      )
    : 0;
  const projectedAssets = jhtBalance + personalBalance;
  const jhtAvailable = input.retirementAge >= INDONESIA_RULES_2026.jhtAccessAge || input.claimJhtEarly === true;
  const jpAvailable = input.retirementAge >= pensionAge;
  const availableAssetsAtRetirement = personalBalance + (jhtAvailable ? jhtBalance : 0);
  const projectedRetirementSpending = input.targetMonthlySpending * Math.pow(1 + input.inflationRate / 100, yearsToRetirement);
  // After retiring, JHT and savings stay invested and are spent down by `payoutUntilAge`, the
  // monthly amount rising with inflation: a growing annuity. With i the monthly return, g monthly
  // inflation and r the real rate (1+i)/(1+g)−1, assets A pay a first month P = A(1+g)·r/(1−(1+r)^−n).
  const payoutMonths = (input.payoutUntilAge - input.retirementAge) * 12;
  const monthlyInflation = Math.pow(1 + input.inflationRate / 100, 1 / 12) - 1;
  const realMonthlyRate = Math.pow((1 + input.postRetirementReturn / 100) / (1 + input.inflationRate / 100), 1 / 12) - 1;
  const payoutFactor = (1 + monthlyInflation) * (Math.abs(realMonthlyRate) < 1e-12
    ? 1 / payoutMonths
    : realMonthlyRate / -Math.expm1(-payoutMonths * Math.log1p(realMonthlyRate)));
  const availableJpIncome = jpAvailable ? estimatedJpIncome : 0;
  const estimatedAssetIncome = availableAssetsAtRetirement * payoutFactor;
  // The same pay-out month by month, recorded yearly: what's left from retirement to `payoutUntilAge`.
  const postMonthlyRate = Math.pow(1 + input.postRetirementReturn / 100, 1 / 12) - 1;
  const drawdown: RetirementProjection['drawdown'] = [{ age: input.retirementAge, assets: availableAssetsAtRetirement }];
  let remaining = availableAssetsAtRetirement;
  let payment = estimatedAssetIncome;
  for (let month = 1; month <= payoutMonths; month += 1) {
    remaining = Math.max(0, remaining * (1 + postMonthlyRate) - payment);
    payment *= 1 + monthlyInflation;
    if (month % 12 === 0) drawdown.push({ age: input.retirementAge + month / 12, assets: remaining });
  }
  const estimatedMonthlyIncome = availableJpIncome + estimatedAssetIncome;
  const monthlyGap = projectedRetirementSpending - estimatedMonthlyIncome;
  const targetAssets: number | null = Math.max(0, (projectedRetirementSpending - availableJpIncome) / payoutFactor);
  const capitalGap = targetAssets === null ? null : Math.max(0, targetAssets - availableAssetsAtRetirement);
  const requiredAdditionalSaving = monthlyGap <= 0 ? 0
    : monthsToRetirement > 0 && capitalGap !== null
      ? capitalGap / futureValueFactor(personalMonthlyRate, monthsToRetirement) : null;

  return {
    yearsToRetirement,
    retirementAge: input.retirementAge,
    jhtMonthlyEmployee: input.monthlyWage * INDONESIA_RULES_2026.jhtEmployeeRate,
    jhtMonthlyEmployer: input.workerType === 'pu' ? input.monthlyWage * INDONESIA_RULES_2026.jhtEmployerRate : 0,
    jhtMonthlyTotal: input.monthlyWage * jhtTotalRate,
    jpMonthlyEmployee: jpEligible ? jpWage * INDONESIA_RULES_2026.jpEmployeeRate : 0,
    jpMonthlyEmployer: jpEligible ? jpWage * INDONESIA_RULES_2026.jpEmployerRate : 0,
    projectedJht: jhtBalance,
    projectedPersonalSavings: personalBalance,
    projectedAssets,
    availableAssetsAtRetirement,
    projectedRetirementSpending,
    estimatedAssetIncome,
    estimatedJpIncome: availableJpIncome,
    jpIncomeWhenPaid: estimatedJpIncome,
    inflationFactor: Math.pow(1 + input.inflationRate / 100, yearsToRetirement),
    estimatedMonthlyIncome,
    monthlyGap,
    requiredAdditionalSaving,
    capitalGap,
    jpAccessAge: pensionAge,
    jpAccessYear: pensionYear,
    retirementYear,
    jpNormalAgeAtRetirement,
    payoutUntilAge: input.payoutUntilAge,
    jhtIncome: jhtAvailable ? jhtBalance * payoutFactor : 0,
    personalIncome: personalBalance * payoutFactor,
    totalJpContributionYears: jpTotalMonths / 12,
    jpAverageWage: averageJpWage,
    jhtAvailable,
    jpAvailable,
    jpEligible,
    series,
    drawdown,
  };
}


