export function calculateReconciliationItem(input: {
  accountType: "asset" | "liability";
  debit: number;
  credit: number;
  actualBalance: number;
}): {
  ledgerBalance: number;
  difference: number;
  status: "matched" | "needs_classification";
} {
  const ledgerBalance = input.accountType === "asset"
    ? input.debit - input.credit
    : input.credit - input.debit;
  const difference = input.actualBalance - ledgerBalance;
  return {
    ledgerBalance,
    difference,
    status: difference === 0 ? "matched" : "needs_classification",
  };
}
