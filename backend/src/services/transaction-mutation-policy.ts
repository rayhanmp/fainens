const USER_MANAGED_TRANSACTION_TYPES = new Set([
  "manual",
  "simple_expense",
  "simple_income",
  "simple_transfer",
]);

export function getIntrinsicTransactionProtectionReasons(tx: {
  txType: string;
  status?: string | null;
  subscriptionId?: number | null;
  linkedTxId?: number | null;
}): string[] {
  const reasons: string[] = [];
  if (tx.status === "posted") reasons.push("posted journal (use reversal)");
  if (!USER_MANAGED_TRANSACTION_TYPES.has(tx.txType)) reasons.push(`type ${tx.txType}`);
  if (tx.subscriptionId != null) reasons.push("subscription occurrence");
  if (tx.linkedTxId != null) reasons.push("linked transaction chain");
  return reasons;
}
