export type LoanActivity = {
  role: 'origin' | 'payment';
  loans: Array<{ id: number; contactName: string; direction: string; amountCents: number; remainingCents: number; status: string }>;
  payment?: { amountCents: number; status: string };
};

export type SplitBillDisplayPart = 'expense' | 'loan';

// Two allocations of one payment, not two additional journal postings.
export function splitBillActivityRows<T extends { txType: string; expenseCents: number; creditCents: number; displayPart?: SplitBillDisplayPart }>(
  transactions: readonly T[], filter = '',
): Array<T & { displayPart?: SplitBillDisplayPart }> {
  return transactions.flatMap((transaction) => {
    if (transaction.txType !== 'split_bill_lent') return [transaction];
    const rows: Array<T & { displayPart?: SplitBillDisplayPart }> = [];
    if ((!filter || filter === 'expense') && transaction.expenseCents > 0) rows.push({ ...transaction, displayPart: 'expense' });
    if ((!filter || filter === 'loan') && transaction.creditCents > transaction.expenseCents) rows.push({ ...transaction, displayPart: 'loan' });
    return rows;
  });
}

export function loanPaymentState(loan: LoanActivity['loans'][number]) {
  if (loan.status === 'cancelled') return 'Cancelled';
  if (loan.status === 'written_off') return 'Written off';
  if (loan.status === 'defaulted') return 'Defaulted';
  if (loan.status === 'repaid' || loan.remainingCents === 0) return 'Paid';
  return loan.remainingCents < loan.amountCents ? 'Partially paid' : 'Unpaid';
}

export function compactLoanActivityLabel(transaction: { txType: string; loanActivity?: LoanActivity | null }) {
  const activity = transaction.loanActivity;
  const isRepayment = activity?.role === 'payment' || transaction.txType === 'loan_payment';
  const kind = isRepayment ? 'Repayment' : transaction.txType.startsWith('split_bill_') ? 'Split bill' : 'Loan';
  if (activity?.payment?.status === 'reversed') return 'Repayment reversed';
  if (!activity?.loans.length) return kind;
  const states = activity.loans.map(loanPaymentState);
  if (states.every((state) => state === states[0])) return `${kind} · ${states[0]}`;
  if (states.some((state) => ['Cancelled', 'Written off', 'Defaulted'].includes(state))) return `${kind} · Mixed status`;
  const paid = states.filter((state) => state === 'Paid').length;
  return paid > 0 ? `${kind} · ${paid}/${states.length} paid` : `${kind} · Partially paid`;
}

export function transactionActivityAmount(transaction: {
  txType: string; expenseCents: number; incomeCents: number; debitCents: number; creditCents: number;
  loanActivity?: LoanActivity | null;
  displayPart?: SplitBillDisplayPart;
}) {
  if (transaction.displayPart === 'expense') return -transaction.expenseCents;
  if (transaction.displayPart === 'loan') return -Math.max(0, transaction.creditCents - transaction.expenseCents);
  if (transaction.txType === 'split_bill_lent') return -transaction.creditCents;
  const activity = transaction.loanActivity;
  if (activity?.role === 'payment' && activity.payment) {
    return activity.payment.amountCents * (activity.loans[0]?.direction === 'lent' ? 1 : -1);
  }
  if (activity?.role === 'origin' && transaction.txType.includes('loan')) {
    return Math.max(transaction.debitCents, transaction.creditCents) * (activity.loans[0]?.direction === 'borrowed' ? 1 : -1);
  }
  if (transaction.expenseCents > 0) return -transaction.expenseCents;
  if (transaction.incomeCents > 0) return transaction.incomeCents;
  return Math.max(transaction.debitCents, transaction.creditCents);
}
