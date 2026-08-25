import { describe, expect, it } from "vitest";

import { calculateReconciliationItem } from "./reconciliation";

describe("reconciliation control semantics", () => {
  it("matches an asset without creating an economic adjustment", () => {
    expect(calculateReconciliationItem({
      accountType: "asset",
      debit: 150_000,
      credit: 50_000,
      actualBalance: 100_000,
    })).toEqual({ ledgerBalance: 100_000, difference: 0, status: "matched" });
  });

  it("uses the normal credit balance for liabilities", () => {
    expect(calculateReconciliationItem({
      accountType: "liability",
      debit: 25_000,
      credit: 100_000,
      actualBalance: 70_000,
    })).toEqual({ ledgerBalance: 75_000, difference: -5_000, status: "needs_classification" });
  });

  it("preserves negative asset balances", () => {
    expect(calculateReconciliationItem({
      accountType: "asset",
      debit: 5_000,
      credit: 10_000,
      actualBalance: -6_000,
    })).toEqual({ ledgerBalance: -5_000, difference: -1_000, status: "needs_classification" });
  });
});
