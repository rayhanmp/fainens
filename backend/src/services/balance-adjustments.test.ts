import { describe, expect, it } from "vitest";

import { buildBalanceAdjustmentLines } from "./balance-adjustments";

describe("balance adjustment journals", () => {
  it("balances a positive asset correction against equity without P&L", () => {
    expect(buildBalanceAdjustmentLines([
      { accountId: 1, accountName: "Transit card", accountType: "asset", liquidityClass: "cash_equivalent", difference: 159_000 },
    ], 99)).toEqual([
      { accountId: 1, debit: 159_000, credit: 0, description: "Balance reconciliation adjustment", cashFlowClass: "recovery" },
      { accountId: 99, debit: 0, credit: 159_000, description: "Balance reconciliation adjustment" },
    ]);
  });

  it("handles a lower asset and a higher liability in the proper directions", () => {
    const lines = buildBalanceAdjustmentLines([
      { accountId: 1, accountName: "Cash", accountType: "asset", liquidityClass: "cash_equivalent", difference: -11_485 },
      { accountId: 2, accountName: "Card debt", accountType: "liability", liquidityClass: "non_cash", difference: 20_000 },
    ], 99);
    expect(lines).toEqual([
      { accountId: 1, debit: 0, credit: 11_485, description: "Balance reconciliation adjustment", cashFlowClass: "recovery" },
      { accountId: 2, debit: 0, credit: 20_000, description: "Balance reconciliation adjustment", cashFlowClass: null },
      { accountId: 99, debit: 31_485, credit: 0, description: "Balance reconciliation adjustment" },
    ]);
  });

  it("does not create a journal when every balance already matches", () => {
    expect(buildBalanceAdjustmentLines([
      { accountId: 1, accountName: "Cash", accountType: "asset", liquidityClass: "cash_equivalent", difference: 0 },
    ], 99)).toEqual([]);
  });
});
