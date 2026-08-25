import { describe, expect, it } from "vitest";

import { validateJournalLines } from "./journal-validation";

describe("validateJournalLines", () => {
  it("accepts an explicit balanced journal", () => {
    const result = validateJournalLines([
      { accountId: 1, debit: 12_500, credit: 0 },
      { accountId: 2, debit: 0, credit: 12_500 },
    ]);

    expect(result.totalDebit).toBe(12_500);
    expect(result.totalCredit).toBe(12_500);
  });

  it("rejects an unbalanced journal instead of inferring a plug", () => {
    expect(() => validateJournalLines([
      { accountId: 1, debit: 12_500, credit: 0 },
      { accountId: 2, debit: 0, credit: 10_000 },
    ])).toThrow("Journal entry is not balanced");
  });

  it("rejects one-line, zero, double-sided, negative, and fractional lines", () => {
    expect(() => validateJournalLines([
      { accountId: 1, debit: 100, credit: 0 },
    ])).toThrow("At least two lines required");

    expect(() => validateJournalLines([
      { accountId: 1, debit: 0, credit: 0 },
      { accountId: 2, debit: 0, credit: 0 },
    ])).toThrow("exactly one positive debit or credit");

    expect(() => validateJournalLines([
      { accountId: 1, debit: 100, credit: 100 },
      { accountId: 2, debit: 0, credit: 100 },
    ])).toThrow("exactly one positive debit or credit");

    expect(() => validateJournalLines([
      { accountId: 1, debit: -100, credit: 0 },
      { accountId: 2, debit: 0, credit: 100 },
    ])).toThrow("non-negative integer");

    expect(() => validateJournalLines([
      { accountId: 1, debit: 100.5, credit: 0 },
      { accountId: 2, debit: 0, credit: 100.5 },
    ])).toThrow("non-negative integer");
  });

  it("does not mutate the caller's lines", () => {
    const source = [
      { accountId: 1, debit: 100, credit: 0 },
      { accountId: 2, debit: 0, credit: 100 },
    ];
    const result = validateJournalLines(source);

    expect(result.lines).not.toBe(source);
    expect(result.lines[0]).not.toBe(source[0]);
    expect(source).toEqual([
      { accountId: 1, debit: 100, credit: 0 },
      { accountId: 2, debit: 0, credit: 100 },
    ]);
  });
});
