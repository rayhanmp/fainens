import { describe, expect, it } from "vitest";

import { getIntrinsicTransactionProtectionReasons } from "./transaction-mutation-policy";

describe("generic transaction mutation policy", () => {
  it.each(["manual", "simple_expense", "simple_income", "simple_transfer"])(
    "allows an unlinked user-managed %s entry",
    (txType) => {
      expect(getIntrinsicTransactionProtectionReasons({ txType })).toEqual([]);
    },
  );

  it.each([
    "loan_creation",
    "loan_payment",
    "loan_writeoff",
    "paylater_recognition",
    "paylater_interest",
    "paylater_settlement",
    "salary_income",
    "subscription_renewal",
    "reconciliation_income",
    "reconciliation_expense",
    "split_bill_lent",
    "split_bill_borrowed",
  ])("protects domain-owned type %s", (txType) => {
    expect(getIntrinsicTransactionProtectionReasons({ txType })).toContain(`type ${txType}`);
  });

  it("protects subscription and linked relations even when their type looks manual", () => {
    expect(getIntrinsicTransactionProtectionReasons({
      txType: "manual",
      subscriptionId: 7,
      linkedTxId: 9,
    })).toEqual(["subscription occurrence", "linked transaction chain"]);
  });
});
