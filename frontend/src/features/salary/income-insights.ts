const DAY_MS = 86_400_000;

export type IncomeKind = 'salary' | 'other';

export type IncomeRow = { id: number; date: number; description: string; incomeCents: number; txType?: string };

/** The transaction type the salary profile stamps on the credits it posts. */
export const SALARY_TX_TYPE = 'salary_income';

/**
 * Salary is what the salary profile posted. A hand-entered credit counts too when its name says
 * salary, gaji or payroll, unless the name also marks it as freelance, bonus, THR or a refund.
 */
export function incomeKind(row: Pick<IncomeRow, 'description' | 'txType'>): IncomeKind {
  if (row.txType === SALARY_TX_TYPE) return 'salary';
  if (/\b(freelance|side|project|bonus|thr|refund|reimburse|cashback)\b/i.test(row.description)) return 'other';
  return /\b(salary|gaji|payroll)\b/i.test(row.description) ? 'salary' : 'other';
}

export type MonthIncome = { key: string; label: string; salary: number; other: number; total: number };

const monthKey = (year: number, month: number) => `${year}-${String(month + 1).padStart(2, '0')}`;

/** Income per calendar month for the last `months` months ending with `now`, oldest first. */
export function monthlyIncomeSeries(rows: IncomeRow[], now: number, months = 6): MonthIncome[] {
  const today = new Date(now);
  const series: MonthIncome[] = [];
  const index = new Map<string, MonthIncome>();
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const date = new Date(today.getFullYear(), today.getMonth() - offset, 1);
    const entry = { key: monthKey(date.getFullYear(), date.getMonth()), label: date.toLocaleDateString('en-US', { month: 'short' }), salary: 0, other: 0, total: 0 };
    series.push(entry);
    index.set(entry.key, entry);
  }
  for (const row of rows) {
    if (row.incomeCents <= 0) continue;
    const date = new Date(row.date);
    const entry = index.get(monthKey(date.getFullYear(), date.getMonth()));
    if (!entry) continue;
    entry[incomeKind(row)] += row.incomeCents;
    entry.total += row.incomeCents;
  }
  return series;
}

export type MonthIncomeTrend = MonthIncome & {
  /** Mean of this month and the months before it, up to `window` months; null until there are two. */
  rolling: number | null;
};

/** Smooths the series with a trailing average so one bonus month does not read as a new normal. */
export function withRollingAverage(series: MonthIncome[], window = 3): MonthIncomeTrend[] {
  return series.map((month, index) => {
    const slice = series.slice(Math.max(0, index - window + 1), index + 1);
    const rolling = slice.length >= 2 ? slice.reduce((sum, item) => sum + item.total, 0) / slice.length : null;
    return { ...month, rolling };
  });
}

export type YearPoint = {
  label: string;
  /** Income received so far this year, up to and including this month; null before the first pay month and for months still ahead. */
  actual: number | null;
  /** What salary alone would have brought in by this month; null before the first pay month. */
  expected: number | null;
};

/**
 * The year as a race between what has actually come in and what the payroll estimate alone would
 * give. Both lines start at the first month of the year with a salary credit (or any income, when
 * no salary has been recorded), so a job that began in February is not measured from January.
 */
export function yearToDateCurve(series: MonthIncome[], now: number, expectedNet: number): YearPoint[] {
  const today = new Date(now);
  const year = today.getFullYear();
  const months = Array.from({ length: 12 }, (_, month) => series.find((item) => item.key === monthKey(year, month)));
  const firstSalary = months.findIndex((entry) => (entry?.salary ?? 0) > 0);
  const firstIncome = months.findIndex((entry) => (entry?.total ?? 0) > 0);
  const start = firstSalary >= 0 ? firstSalary : firstIncome >= 0 ? firstIncome : today.getMonth();
  const points: YearPoint[] = [];
  let actual = 0;
  for (let month = 0; month < 12; month += 1) {
    const label = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'short' });
    if (month < start) {
      points.push({ label, actual: null, expected: null });
      continue;
    }
    if (month <= today.getMonth()) actual += months[month]?.total ?? 0;
    points.push({ label, actual: month <= today.getMonth() ? actual : null, expected: expectedNet * (month - start + 1) });
  }
  return points;
}

export type PayCycle = {
  lastPayday: number;
  nextPayday: number;
  /** Whole days until the next payday; 0 on payday itself. */
  daysLeft: number;
  /** How far through the cycle today is, 0..1. */
  progress: number;
  isPayday: boolean;
};

const paydayIn = (year: number, month: number, payrollDay: number) => {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(Math.max(1, payrollDay), lastDay)).getTime();
};

/** Where today sits between the previous and the coming payday. Short months pull the day in. */
export function payCycle(payrollDay: number, now: number): PayCycle {
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const thisMonth = paydayIn(today.getFullYear(), today.getMonth(), payrollDay);
  const isPayday = thisMonth === startOfToday;
  const nextPayday = startOfToday <= thisMonth ? thisMonth : paydayIn(today.getFullYear(), today.getMonth() + 1, payrollDay);
  const lastPayday = startOfToday <= thisMonth ? paydayIn(today.getFullYear(), today.getMonth() - 1, payrollDay) : thisMonth;
  const daysLeft = Math.max(0, Math.round((nextPayday - startOfToday) / DAY_MS));
  const progress = isPayday ? 1 : Math.min(1, Math.max(0, (now - lastPayday) / (nextPayday - lastPayday)));
  return { lastPayday, nextPayday, daysLeft, progress, isPayday };
}

export type TakeHomeSegment = { key: 'net' | 'pph21' | 'jht' | 'jp' | 'bpjsKes'; label: string; amount: number; share: number };

/** How gross pay splits into take-home and each statutory deduction, as shares of gross. */
export function takeHomeBreakdown(computed: {
  grossMonthly: number;
  estimatedNetMonthly: number;
  pph21Monthly: number;
  jhtMonthly: number;
  jpMonthly: number;
  bpjsKesehatanMonthly: number;
}): TakeHomeSegment[] {
  const gross = Math.max(0, computed.grossMonthly);
  const share = (amount: number) => (gross > 0 ? amount / gross : 0);
  const segments: TakeHomeSegment[] = [
    { key: 'net', label: 'Take-home', amount: computed.estimatedNetMonthly, share: share(computed.estimatedNetMonthly) },
    { key: 'pph21', label: 'PPh 21', amount: computed.pph21Monthly, share: share(computed.pph21Monthly) },
    { key: 'jht', label: 'JHT', amount: computed.jhtMonthly, share: share(computed.jhtMonthly) },
    { key: 'jp', label: 'JP', amount: computed.jpMonthly, share: share(computed.jpMonthly) },
    { key: 'bpjsKes', label: 'BPJS Kesehatan', amount: computed.bpjsKesehatanMonthly, share: share(computed.bpjsKesehatanMonthly) },
  ];
  return segments.filter((segment) => segment.amount > 0);
}
