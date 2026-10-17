export const DAY_MS = 86_400_000;
export const COMMITMENT_WINDOW_DAYS = 30;

export type CommitmentSubscription = { id: number; name: string; amount: number; status: string; nextRenewalAt: number };
export type CommitmentPayLater = { recognitionTxId: number; description: string; outstandingCents: number; dueDateMs: number | null; status: string };
export type CommitmentLoan = { id: number; direction: string; status: string; remainingCents: number; dueDate: number | null; isOverdue: boolean; contact: { name: string } };

export type PaymentRow = {
  id: string;
  name: string;
  amount: number;
  date: number;
  kind: 'Subscription' | 'Pay later' | 'Loan repayment';
  to: '/subscriptions' | '/paylater' | '/loans';
};

export type UpcomingCommitments<
  S extends CommitmentSubscription = CommitmentSubscription,
  P extends CommitmentPayLater = CommitmentPayLater,
  L extends CommitmentLoan = CommitmentLoan,
> = {
  subscriptions: S[];
  payLater: (P & { dueDateMs: number })[];
  loans: (L & { dueDate: number })[];
  subscriptionTotal: number;
  payLaterTotal: number;
  loanTotal: number;
  total: number;
  count: number;
  /** Every commitment in due-date order, overdue items first. */
  rows: PaymentRow[];
};

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** Outstanding subscriptions, PayLater and borrowed loans due within the window, including anything already overdue. */
export function upcomingCommitments<S extends CommitmentSubscription, P extends CommitmentPayLater, L extends CommitmentLoan>(
  input: { subscriptions: readonly S[]; payLater: readonly P[]; loans: readonly L[] },
  now: number,
): UpcomingCommitments<S, P, L> {
  const cutoff = now + COMMITMENT_WINDOW_DAYS * DAY_MS;
  const subscriptions = input.subscriptions
    .filter((item) => item.status === 'active' && item.nextRenewalAt <= cutoff)
    .sort((a, b) => a.nextRenewalAt - b.nextRenewalAt);
  const payLater = input.payLater.filter((item): item is P & { dueDateMs: number } => item.outstandingCents > 0 && item.dueDateMs != null && item.dueDateMs <= cutoff);
  const loans = input.loans.filter((loan): loan is L & { dueDate: number } => loan.direction === 'borrowed' && loan.status === 'active' && loan.remainingCents > 0 && loan.dueDate != null && loan.dueDate <= cutoff);
  const subscriptionTotal = sum(subscriptions.map((item) => item.amount));
  const payLaterTotal = sum(payLater.map((item) => item.outstandingCents));
  const loanTotal = sum(loans.map((item) => item.remainingCents));
  const rows: PaymentRow[] = [
    ...subscriptions.map((item) => ({ id: `subscription-${item.id}`, name: item.name, amount: item.amount, date: item.nextRenewalAt, kind: 'Subscription' as const, to: '/subscriptions' as const })),
    ...payLater.map((item) => ({ id: `paylater-${item.recognitionTxId}`, name: item.description, amount: item.outstandingCents, date: item.dueDateMs, kind: 'Pay later' as const, to: '/paylater' as const })),
    ...loans.map((item) => ({ id: `loan-${item.id}`, name: item.contact.name, amount: item.remainingCents, date: item.dueDate, kind: 'Loan repayment' as const, to: '/loans' as const })),
  ].sort((a, b) => a.date - b.date);
  return {
    subscriptions,
    payLater,
    loans,
    subscriptionTotal,
    payLaterTotal,
    loanTotal,
    total: subscriptionTotal + payLaterTotal + loanTotal,
    count: subscriptions.length + payLater.length + loans.length,
    rows,
  };
}
