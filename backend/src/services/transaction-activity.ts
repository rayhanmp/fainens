export interface DailyTransactionActivity {
  date: string;
  expenseCents: number;
  incomeCents: number;
  transactionCount: number;
}

/** One row per journal, using the same signed ledger effects as list summaries. */
export function aggregateTransactionActivity(rows: Array<{
  date: Date | number;
  expenseCents: number;
  incomeCents: number;
}>): DailyTransactionActivity[] {
  const days = new Map<string, DailyTransactionActivity>();
  for (const row of rows) {
    // Calendar boundaries are explicit and independent of the server timezone.
    const date = new Date(Number(row.date) + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const day = days.get(date) ?? { date, expenseCents: 0, incomeCents: 0, transactionCount: 0 };
    day.expenseCents += Number(row.expenseCents);
    day.incomeCents += Number(row.incomeCents);
    day.transactionCount += 1;
    days.set(date, day);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}
