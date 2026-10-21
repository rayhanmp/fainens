import { DAY_MS, type CommitmentLoan, type CommitmentPayLater, type UpcomingCommitments } from './commitments.ts';
import { typeReminders, type TypeReminder, type TypeReminderGoal } from '../goals/types/type-math.ts';

export type Attention = {
  id: string;
  tone: 'danger' | 'warning' | 'info';
  title: string;
  detail: string;
  to: '/accounts' | '/budget' | '/goals' | '/loans' | '/paylater' | '/periods' | '/settings' | '/subscriptions' | '/transactions';
  /** Opens a section of the page, for Settings. */
  search?: { tab: 'data' };
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
  /** What goals need from you; null while loading or without goals. */
  goals?: GoalReminders | null;
  /** Deleted files storage still holds after every retry. */
  stuckStorageFiles?: number;
};

/** The goal facts the bell reminds you of. */
export type GoalReminders = {
  /** What this month's amounts still ask, and what's free to put in. */
  due: number;
  free: number;
  /** Goals that won't make their date at their monthly amount. */
  late: ReadonlyArray<{ id: number; name: string; months: number; byDate: number }>;
  /** Accounts holding less than the goals said to sit in them. */
  shortAccounts: ReadonlyArray<{ id: number; name: string; balance: number; goalsHold: number }>;
  /** Unticked checklist items in goals' notes, with the day they're due. */
  tasks?: ReadonlyArray<{ goalId: number; goalName: string; text: string; dueAt: number }>;
  /** What the server sees goals need soon: a trip's bookings and papers, parts due, a fund to refill, a THR. */
  kinds?: ReadonlyArray<KindReminder>;
  /** What each goal's kind asks, worked out from the overview: see {@link typeReminders}. */
  types?: ReadonlyArray<TypeReminder>;
};

export type KindReminder = {
  kind: 'cancel' | 'unpaid' | 'passport' | 'visa' | 'packing' | 'refill' | 'part-due' | 'thr';
  goalId: number;
  goalName: string;
  /** When it's about: free cancellation ending, leaving, a passport running out, a part due, money taken out, a THR. */
  at: number;
  /** Whose passport or visa, which booking or part, or why money came out. */
  name: string | null;
  count: number;
  amount: number | null;
  /** A part due while the goal holds less than it. */
  short: boolean;
};

const inDays = (at: number, now: number) => Math.round((new Date(at).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / DAY_MS);
const whenIn = (days: number) => (days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`);

/** A server reminder in words, for the bell. */
function kindAttention(reminder: KindReminder, now: number, format: AttentionFormat): Attention {
  const days = inDays(reminder.at, now);
  const when = whenIn(days);
  const base = { id: `goal-${reminder.kind}:${reminder.goalId}:${reminder.name ?? ''}:${reminder.at}`, to: '/goals' as const, action: 'Open goals' };
  switch (reminder.kind) {
    case 'refill':
      return { ...base, tone: 'warning', title: `Fill ${reminder.goalName} back up`, detail: `${format.amount(reminder.amount ?? 0)} short since money came out on ${format.date(reminder.at)}${reminder.name ? ` for ${reminder.name}` : ''}.` };
    case 'part-due':
      return {
        ...base,
        tone: days < 0 || reminder.short ? 'warning' : 'info',
        title: `${reminder.name}: ${days < 0 ? 'was due' : `due ${when}`}`,
        detail: `${format.amount(reminder.amount ?? 0)} on ${reminder.goalName}, by ${format.date(reminder.at)}.${reminder.short ? ` ${reminder.goalName} holds less than that so far.` : ''}`,
      };
    case 'thr':
      return { ...base, tone: 'info', title: `Put some THR into ${reminder.goalName}`, detail: `${format.amount(reminder.amount ?? 0)} came in on ${format.date(reminder.at)}, and nothing has gone into ${reminder.goalName} since.` };
    case 'cancel':
      return { ...base, tone: 'warning', title: `Free cancellation for ${reminder.name} ends ${when}`, detail: `On ${reminder.goalName}. Cancel by ${format.date(reminder.at)} if your plans change.` };
    case 'unpaid':
      return { ...base, tone: 'warning', title: `${plural(reminder.count, 'booking')} not paid yet`, detail: `${reminder.goalName} leaves ${when}, on ${format.date(reminder.at)}.` };
    case 'passport':
      return { ...base, tone: 'warning', title: `${reminder.name}’s passport runs out ${format.date(reminder.at)}`, detail: `That’s within six months of coming back from ${reminder.goalName}; some countries won’t let you in with less. Check the rule for where you’re going.` };
    case 'visa':
      return { ...base, tone: 'warning', title: `Apply for ${reminder.name}’s visa`, detail: `${reminder.goalName} leaves ${when}, on ${format.date(reminder.at)}.` };
    case 'packing':
      return { ...base, tone: 'info', title: `${plural(reminder.count, 'thing')} not packed yet`, detail: `${reminder.goalName} leaves ${when}.` };
  }
}

/** What a goal's kind asks, in words, for the bell. */
function typeAttention(reminder: TypeReminder, format: AttentionFormat): Attention {
  const base = { id: `goal-${reminder.kind}:${reminder.goalId}`, to: '/goals' as const, action: 'Open goals' };
  switch (reminder.kind) {
    case 'emergency-low':
      return { ...base, tone: 'warning', title: `${reminder.goalName} covers ${reminder.months.toLocaleString('id-ID', { maximumFractionDigits: 1 })} months of spending`, detail: 'An emergency fund is usually at least three months of what you spend.' };
    case 'kpr-limit':
      return { ...base, tone: 'warning', title: `${reminder.goalName}: the KPR payment is more than banks usually allow`, detail: `${format.amount(reminder.monthly)} a month, against about ${format.amount(reminder.allowed)} from your take-home pay. A bigger down payment or a longer loan brings it down.` };
    case 'umrah-papers':
      return { ...base, tone: 'info', title: `${reminder.goalName} leaves ${whenIn(reminder.days)}`, detail: 'Check the vaccines and documents your travel agent needs, and your passport.' };
    case 'price-drop':
      return { ...base, tone: 'info', title: `${reminder.goalName} got cheaper`, detail: `From ${format.amount(reminder.from)} to ${format.amount(reminder.to)}.` };
    case 'yearly-due':
      return reminder.short > 0
        ? { ...base, tone: 'warning', title: `${reminder.goalName} is due ${whenIn(reminder.days)}`, detail: `${format.amount(reminder.short)} still to put in by ${format.date(reminder.at)}.` }
        : { ...base, tone: 'info', title: `${reminder.goalName} is due ${whenIn(reminder.days)}`, detail: `It has all it needs; pay it by ${format.date(reminder.at)}.` };
  }
}

/**
 * The goal reminders from the Goals overview: this month's amounts not yet in, goals that won't
 * make their date at their pace (paused ones aside), accounts holding less than their goals, and
 * what each goal's kind asks (given your average spending for an emergency fund).
 */
export function goalReminders(overview: {
  unassigned: number;
  salary?: number | null;
  accounts: ReadonlyArray<{ id: number; name: string; balance: number }>;
  goals: ReadonlyArray<TypeReminderGoal & { paused: boolean; monthlyAmount: number; setAsideThisMonth: number; reachMonths: number | null; accountId: number | null }>;
}, now: number, spending: number | null = null): GoalReminders {
  const active = overview.goals.filter((goal) => goal.status === 'active');
  const today = new Date(now);
  const monthsUntil = (time: number) => {
    const date = new Date(time);
    return Math.max(1, (date.getFullYear() - today.getFullYear()) * 12 + date.getMonth() - today.getMonth());
  };
  const due = sum(active.filter((goal) => !goal.paused).map((goal) => Math.max(0, Math.min(goal.monthlyAmount - goal.setAsideThisMonth, goal.targetAmount - goal.setAside))));
  const late = active
    .filter((goal) => !goal.paused && goal.byDate !== null && goal.reachMonths !== null && goal.reachMonths > 0 && goal.byDate > now && goal.reachMonths > monthsUntil(goal.byDate))
    .map((goal) => ({ id: goal.id, name: goal.name, months: goal.reachMonths! - monthsUntil(goal.byDate!), byDate: goal.byDate! }));
  const shortAccounts = overview.accounts
    .map((account) => ({ ...account, goalsHold: sum(active.filter((goal) => goal.accountId === account.id).map((goal) => goal.setAside)) }))
    .filter((account) => account.goalsHold > 0 && account.balance < account.goalsHold);
  const types = typeReminders(overview.goals, { spending, salary: overview.salary ?? null, now });
  return { due, free: Math.max(0, overview.unassigned), late, shortAccounts, types };
}

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

  if (input.stuckStorageFiles) {
    next.push({
      id: `storage-cleanup:${input.stuckStorageFiles}`, tone: 'warning',
      title: `${plural(input.stuckStorageFiles, 'deleted file')} still in storage`,
      detail: 'Storage refused to remove them on every try.', to: '/settings', search: { tab: 'data' }, action: 'Try again in Settings',
    });
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

  const goals = input.goals;
  if (goals) {
    const month = new Date(now);
    const monthKey = `${month.getFullYear()}-${month.getMonth() + 1}`;
    for (const account of goals.shortAccounts.slice(0, 2)) {
      next.push({ id: `goal-account:${account.id}`, tone: 'warning', title: `${account.name} holds less than its goals`, detail: `It has ${format.amount(account.balance)}; the goals said to sit there have ${format.amount(account.goalsHold)}.`, to: '/goals', action: 'Review goals' });
    }
    if (goals.late.length > 0) {
      const first = goals.late[0];
      const others = goals.late.length - 1;
      next.push({
        id: `goals-late:${goals.late.map((goal) => goal.id).join(',')}`,
        tone: 'warning',
        title: others ? `${first.name} and ${plural(others, 'other goal')} won’t make their date` : `${first.name} won’t make its date`,
        detail: `At its monthly amount it gets there ${plural(first.months, 'month')} after ${format.date(first.byDate)}. Put in more each month, or move the date.`,
        to: '/goals',
        action: 'Review goals',
      });
    }
    // Dated checklist items in goals' notes: past their day, or due within three.
    const startOfToday = new Date(now).setHours(0, 0, 0, 0);
    const soonTasks = (goals.tasks ?? []).filter((task) => task.dueAt < startOfToday + 4 * DAY_MS);
    for (const task of soonTasks.slice(0, 3)) {
      const late = task.dueAt < startOfToday;
      const days = Math.round((new Date(task.dueAt).setHours(0, 0, 0, 0) - startOfToday) / DAY_MS);
      next.push({
        id: `goal-task:${task.goalId}:${task.text}:${task.dueAt}`,
        tone: late ? 'warning' : 'info',
        title: `${task.text}: ${late ? 'was due' : days === 0 ? 'due today' : days === 1 ? 'due tomorrow' : `due in ${days} days`}`,
        detail: `On ${task.goalName}’s checklist, for ${format.date(task.dueAt)}.`,
        to: '/goals',
        action: 'Open goals',
      });
    }
    for (const reminder of (goals.kinds ?? []).slice(0, 4)) next.push(kindAttention(reminder, now, format));
    for (const reminder of (goals.types ?? []).slice(0, 3)) next.push(typeAttention(reminder, format));
    if (goals.due > 0 && goals.free > 0) {
      next.push({ id: `goals-due:${monthKey}`, tone: 'info', title: `${format.amount(Math.min(goals.due, goals.free))} to put into goals`, detail: 'This month’s amounts aren’t in yet. One tap on Goals puts them in from your free money.', to: '/goals', action: 'Put it in' });
    }
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
