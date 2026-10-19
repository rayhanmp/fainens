const DAY_MS = 86_400_000;

export type IncomeKind = 'salary' | 'other';

export type IncomeRow = { id: number; date: number; description: string; incomeCents: number };

/** Salary credits are told apart by their name; everything else counts as other income. */
export function incomeKind(description: string): IncomeKind {
  return /\b(salary|gaji|payroll|take.?home)\b/i.test(description) ? 'salary' : 'other';
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
    entry[incomeKind(row.description)] += row.incomeCents;
    entry.total += row.incomeCents;
  }
  return series;
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
