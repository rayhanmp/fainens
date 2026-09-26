export type ReallocationInfo = {
  id: number;
  counterpartTransactionId: number;
  counterpartDescription: string;
  amount: number;
  reason: string;
  role: 'incoming' | 'outgoing';
};

export type ReallocationTransaction = {
  id: number;
  date: number | string | Date;
  description: string;
  expenseCents?: number;
  incomeCents?: number;
  personalExpenseCents?: number;
  personalIncomeCents?: number;
  reallocationEligibleRole?: 'incoming' | 'outgoing' | null;
  reallocation?: ReallocationInfo | null;
  lines?: Array<{ accountName?: string | null; accountType?: string | null; cashFlowClass?: string | null; debit: number; credit: number }>;
};

export function reallocationPreview(first: ReallocationTransaction, second: ReallocationTransaction) {
  const incoming = first.reallocationEligibleRole === 'incoming' ? first : second;
  const outgoing = first.reallocationEligibleRole === 'outgoing' ? first : second;
  const incomingAmount = Math.abs(incoming.expenseCents || incoming.incomeCents || 0);
  const outgoingAmount = Math.abs(outgoing.expenseCents || 0);
  const matchedAmount = Math.min(incomingAmount, outgoingAmount);
  return { matchedAmount, newSpending: outgoingAmount - matchedAmount, incomingRemainder: incomingAmount - matchedAmount };
}

export function personalActivityKind(transaction: ReallocationTransaction): 'expense' | 'income' | 'other' {
  if ((transaction.personalExpenseCents ?? transaction.expenseCents ?? 0) > 0) return 'expense';
  if ((transaction.personalIncomeCents ?? transaction.incomeCents ?? 0) > 0) return 'income';
  return 'other';
}

export function reallocationCashAmount(transaction: ReallocationTransaction): number | null {
  if (!transaction.reallocation) return null;
  const amount = Math.abs(transaction.expenseCents || transaction.incomeCents || 0);
  return transaction.reallocation.role === 'incoming' ? amount : -amount;
}
