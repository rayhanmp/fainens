import { describe, expect, it } from 'vitest';
import { aggregateTransactionActivity } from './transaction-activity';

describe('transaction activity', () => {
  it('groups journals by Jakarta calendar date and retains signed corrections', () => {
    const result = aggregateTransactionActivity([
      { date: new Date('2026-09-04T16:59:00Z'), expenseCents: 100, incomeCents: 0 },
      { date: new Date('2026-09-04T17:00:00Z'), expenseCents: 200, incomeCents: 0 },
      { date: new Date('2026-09-05T04:00:00Z'), expenseCents: -50, incomeCents: 500 },
      // A wallet transfer has no expense or revenue effect.
      { date: new Date('2026-09-05T05:00:00Z'), expenseCents: 0, incomeCents: 0 },
    ]);
    expect(result).toEqual([
      { date: '2026-09-04', expenseCents: 100, incomeCents: 0, transactionCount: 1 },
      { date: '2026-09-05', expenseCents: 150, incomeCents: 500, transactionCount: 3 },
    ]);
  });

  it('includes more than one page of transactions and orders days chronologically', () => {
    const rows = Array.from({ length: 70 }, (_, index) => ({
      date: new Date(index % 2 ? '2026-09-01T00:00:00Z' : '2026-09-02T00:00:00Z'),
      expenseCents: 10, incomeCents: 0,
    }));
    expect(aggregateTransactionActivity(rows).map((day) => [day.date, day.transactionCount, day.expenseCents]))
      .toEqual([['2026-09-01', 35, 350], ['2026-09-02', 35, 350]]);
    expect(aggregateTransactionActivity([])).toEqual([]);
  });
});
