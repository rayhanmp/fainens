import { DAY_MS, type CommitmentLoan, type CommitmentPayLater, type UpcomingCommitments } from './commitments.ts';

export type Attention = {
  id: string;
  tone: 'danger' | 'warning' | 'info';
  title: string;
  detail: string;
  to: '/accounts' | '/budget' | '/loans' | '/paylater' | '/periods' | '/subscriptions' | '/transactions';
  action: string;
};

export type CoverageStatus = 'complete' | 'partial' | 'skipped' | 'unknown' | (string & {});

export type AttentionInput = {
  now: number;
  pendingTransactionCount: number;
  /** Null while the trial balance is still loading. */
  ledgerBalanced: boolean | null;
  /** The period containing `now`; budget and coverage notices always describe it, never the browsed period. */
  currentPeriod: { id: number; name: string; coverageStatus?: CoverageStatus | null; coverageReason?: string | null } | null;
  budgetRows: readonly { categoryName: string; actualAmount: number; plannedAmount: number }[];
  outlookCategories: readonly { categoryName: string; riskStatus: string }[];
  unallocatedSpentCents: number | null;
  /** Null while reconciliation history is still loading. */
  reconciliationSessions: readonly { id: number; asOfDate: number; lifecycleStatus: string }[] | null;
  loans: readonly CommitmentLoan[];
  payLaterObligations: readonly CommitmentPayLater[];
  subscriptionRenewals: readonly { dueAt: number; amount: number }[];
  commitments: UpcomingCommitments;
};

export type AttentionFormat = { amount: (cents: number) => string; date: (ms: number) => string };

export const ATTENTION_LIMIT = 8;
/** How many danger and warning items the inline strip under the hero shows. */
export const ATTENTION_STRIP_LIMIT = 3;
export const ATTENTION_READ_STORAGE_LIMIT = 200;
const RECONCILIATION_STALE_DAYS = 30;
const DUE_SOON_DAYS = 7;

const plural = (count: number, singular: string, pluralForm = `${singular}s`) => `${count} ${count === 1 ? singular : pluralForm}`;
const categories = (count: number) => `${count} categor${count === 1 ? 'y is' : 'ies are'}`;
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

export function coverageLabel(status: CoverageStatus | null | undefined): string {
  if (status === 'complete') return 'Complete coverage';
  if (status === 'partial') return 'Partially captured';
  if (status === 'skipped') return 'Skipped period';
  return 'Coverage needs review';
}

export function isTrackedCoverage(status: CoverageStatus | null | undefined): boolean {
  return status === 'complete' || status === 'partial';
}

/** Notifications for the dashboard bell, most severe first and capped at {@link ATTENTION_LIMIT}. */
export function buildAttentionItems(input: AttentionInput, format: AttentionFormat): Attention[] {
  const { now, currentPeriod, commitments } = input;
  const next: Attention[] = [];

  if (input.pendingTransactionCount > 0) {
    next.push({ id: 'pending-transactions', tone: 'warning', title: plural(input.pendingTransactionCount, 'pending transaction'), detail: 'Review imported or AI-parsed activity before it is posted to the ledger.', to: '/transactions', action: 'Review pending transactions' });
  }

  if (input.ledgerBalanced === false) {
    next.push({ id: 'trial-balance', tone: 'danger', title: 'Ledger needs review', detail: 'The trial balance is not currently balanced.', to: '/accounts', action: 'Review accounts' });
  }

  if (currentPeriod && currentPeriod.coverageStatus !== 'complete') {
    const detail = currentPeriod.coverageReason
      ?? (currentPeriod.coverageStatus === 'skipped' ? 'Recorded activity is not zero activity for this period.' : 'Review coverage before relying on trends or averages.');
    next.push({ id: `coverage:${currentPeriod.id}`, tone: currentPeriod.coverageStatus === 'partial' ? 'warning' : 'danger', title: `${coverageLabel(currentPeriod.coverageStatus)} · ${currentPeriod.name}`, detail, to: '/periods', action: 'Review period' });
  }

  if (input.reconciliationSessions) {
    const latest = input.reconciliationSessions.find((session) => session.lifecycleStatus === 'active');
    const ageDays = latest ? Math.floor((now - latest.asOfDate) / DAY_MS) : null;
    if (!latest || (ageDays != null && ageDays > RECONCILIATION_STALE_DAYS)) {
      next.push({
        id: `reconciliation:${latest?.id ?? 'none'}`, tone: 'warning', title: latest ? 'Accounts need a fresh check' : 'No account reconciliation yet',
        detail: latest ? `Last checked ${ageDays} days ago.` : 'Confirm your current balances so the position stays trustworthy.',
        to: '/accounts', action: 'Reconcile accounts',
      });
    }
  }

  const dueSoonCutoff = now + DUE_SOON_DAYS * DAY_MS;

  const overdueLoans = input.loans.filter((loan) => loan.isOverdue);
  const dueSoonLoans = commitments.loans.filter((loan) => loan.dueDate > now && loan.dueDate <= dueSoonCutoff);
  if (overdueLoans.length > 0) {
    next.push({ id: 'loans', tone: 'danger', title: `${plural(overdueLoans.length, 'loan')} overdue`, detail: 'Review repayment status and follow up with the counterparty.', to: '/loans', action: 'Open loans' });
  } else if (dueSoonLoans.length > 0) {
    next.push({ id: 'loans-soon', tone: 'warning', title: `${plural(dueSoonLoans.length, 'loan')} due in 7 days`, detail: `${format.amount(sum(dueSoonLoans.map((loan) => loan.remainingCents)))} due next, starting ${format.date(dueSoonLoans[0].dueDate)}`, to: '/loans', action: 'Open loans' });
  } else if (commitments.loans.length > 0) {
    next.push({ id: 'loans-upcoming', tone: 'info', title: `${plural(commitments.loans.length, 'loan')} due in 30 days`, detail: `${format.amount(commitments.loanTotal)} outstanding, next due ${format.date(commitments.loans[0].dueDate)}.`, to: '/loans', action: 'Open loans' });
  }

  const overduePayLater = input.payLaterObligations.filter((item) => item.status === 'overdue');
  const soonPayLater = input.payLaterObligations.filter((item) => item.status === 'due_soon');
  if (overduePayLater.length > 0 || soonPayLater.length > 0) {
    const flagged = overduePayLater.length ? overduePayLater : soonPayLater;
    next.push({
      id: 'paylater', tone: overduePayLater.length ? 'danger' : 'warning',
      title: overduePayLater.length ? `${plural(overduePayLater.length, 'PayLater payment')} overdue` : `${plural(soonPayLater.length, 'PayLater payment')} due soon`,
      detail: `${format.amount(sum(flagged.map((item) => item.outstandingCents)))} outstanding across these payments.`, to: '/paylater', action: 'Open PayLater',
    });
  } else if (commitments.payLater.length > 0) {
    next.push({ id: 'paylater-upcoming', tone: 'info', title: `${plural(commitments.payLater.length, 'PayLater payment')} due in 30 days`, detail: `${format.amount(commitments.payLaterTotal)} outstanding, review the next due dates.`, to: '/paylater', action: 'Open PayLater' });
  }

  const overdueRenewals = input.subscriptionRenewals.filter((occurrence) => occurrence.dueAt <= now);
  const dueSoonSubscriptions = commitments.subscriptions.filter((subscription) => subscription.nextRenewalAt > now && subscription.nextRenewalAt <= dueSoonCutoff);
  if (overdueRenewals.length > 0) {
    next.push({ id: 'subscriptions-overdue', tone: 'danger', title: `${plural(overdueRenewals.length, 'subscription renewal')} overdue`, detail: `${format.amount(sum(overdueRenewals.map((occurrence) => occurrence.amount)))} is waiting for review before it is posted.`, to: '/subscriptions', action: 'Review subscriptions' });
  } else if (dueSoonSubscriptions.length > 0) {
    next.push({ id: 'subscriptions-soon', tone: 'warning', title: `${plural(dueSoonSubscriptions.length, 'subscription')} due in 7 days`, detail: `${format.amount(sum(dueSoonSubscriptions.map((subscription) => subscription.amount)))} due next, starting ${format.date(dueSoonSubscriptions[0].nextRenewalAt)}.`, to: '/subscriptions', action: 'Review subscriptions' });
  } else if (commitments.subscriptions.length > 0) {
    next.push({ id: 'subscriptions-upcoming', tone: 'info', title: `${plural(commitments.subscriptions.length, 'subscription')} due in 30 days`, detail: `${format.amount(commitments.subscriptionTotal)} total, next due ${format.date(commitments.subscriptions[0].nextRenewalAt)}.`, to: '/subscriptions', action: 'Review subscriptions' });
  }

  if (currentPeriod && isTrackedCoverage(currentPeriod.coverageStatus)) {
    // Exactly on plan is not over budget.
    const overBudgetRows = input.budgetRows.filter((row) => row.actualAmount > row.plannedAmount);
    const atRiskRows = overBudgetRows.length === 0 ? input.outlookCategories.filter((row) => row.riskStatus === 'at_risk') : [];
    if (overBudgetRows.length > 0) {
      const overrun = sum(overBudgetRows.map((row) => row.actualAmount - row.plannedAmount));
      const leaders = overBudgetRows.slice(0, 2).map((row) => row.categoryName).join(' and ');
      next.push({ id: `budget-overrun:${currentPeriod.id}`, tone: 'danger', title: `${categories(overBudgetRows.length)} over budget`, detail: `${format.amount(overrun)} over plan, led by ${leaders}.`, to: '/budget', action: 'Review budget' });
    } else if (atRiskRows.length > 0) {
      const leaders = atRiskRows.slice(0, 2).map((row) => row.categoryName).join(' and ');
      next.push({ id: `budget-risk:${currentPeriod.id}`, tone: 'warning', title: `${categories(atRiskRows.length)} at risk`, detail: `${leaders} may exceed the plan based on the current outlook.`, to: '/budget', action: 'Review budget' });
    }
  }

  if (currentPeriod && input.unallocatedSpentCents != null && input.unallocatedSpentCents > 0) {
    next.push({ id: `unallocated:${currentPeriod.id}`, tone: 'info', title: 'Some spending is unallocated', detail: `${format.amount(input.unallocatedSpentCents)} cannot yet be attributed to a category.`, to: '/transactions', action: 'Classify activity' });
  }

  const priority = { danger: 0, warning: 1, info: 2 } as const;
  return next.sort((a, b) => priority[a.tone] - priority[b.tone]).slice(0, ATTENTION_LIMIT);
}

/** The unread danger and warning items for the inline strip, keeping {@link buildAttentionItems}' severity order; info items stay in the bell. */
export function attentionStripItems(items: readonly Attention[], isRead: (item: Attention) => boolean = () => false, limit = ATTENTION_STRIP_LIMIT): Attention[] {
  return items.filter((item) => item.tone !== 'info' && !isRead(item)).slice(0, limit);
}

// Details carry live amounts and day counts, so they stay out of the key; ids carry the period or session they describe.
export function attentionReadKey(item: Pick<Attention, 'id' | 'title'>): string {
  return `${item.id}|${item.title}`;
}

/** Parses stored read keys, trimming keys saved before details were dropped (they had a third `|detail` segment). Throws on malformed JSON. */
export function parseAttentionReadKeys(raw: string | null): string[] {
  const stored: unknown = JSON.parse(raw ?? '[]');
  if (!Array.isArray(stored)) return [];
  return stored.filter((item): item is string => typeof item === 'string').map((key) => key.split('|').slice(0, 2).join('|'));
}

/** The most recently read keys, newest last, capped for storage. */
export function serializeAttentionReadKeys(keys: Iterable<string>): string {
  return JSON.stringify([...keys].slice(-ATTENTION_READ_STORAGE_LIMIT));
}
