type DisplayLine = {
  debit: number;
  credit: number;
  accountType?: string | null;
};

// Expense/income are the net reporting effect, not the largest wallet movement.
// A split-bill payment also includes money advanced to other participants.
export function transactionDisplayAmounts(lines: readonly DisplayLine[]) {
  let expenseCents = 0;
  let incomeCents = 0;
  let totalPaidCents = 0;
  let journalAmount = 0;
  for (const line of lines) {
    if (line.accountType === 'expense') expenseCents += line.debit - line.credit;
    if (line.accountType === 'revenue') incomeCents += line.credit - line.debit;
    totalPaidCents += line.credit;
    journalAmount = Math.max(journalAmount, line.debit, line.credit);
  }
  return { expenseCents, incomeCents, totalPaidCents, journalAmount };
}
