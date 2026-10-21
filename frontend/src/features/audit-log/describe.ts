/**
 * Turns audit entries into plain sentences and field-by-field changes. Every workflow writes its
 * own snapshot shape (a transaction with its lines, a loan wrapped as `{ loan }`, a period as is), so
 * this reads them generously and falls back to readable words for anything it doesn't know.
 */

export type AuditEntry = {
  id: number;
  entityType: string;
  entityId: number;
  action: string;
  beforeSnapshot: Record<string, unknown> | null;
  afterSnapshot: Record<string, unknown> | null;
  createdAt: number;
};

export type AuditKind = 'added' | 'changed' | 'removed' | 'step';

/** How to show ids, money and dates; the page supplies its own (balances can be hidden). */
export type AuditFormat = {
  amount: (value: number) => string;
  date: (ms: number) => string;
  dateTime: (ms: number) => string;
  category: (id: number) => string | null;
  account: (id: number) => string | null;
  period: (id: number) => string | null;
  tag: (id: number) => string | null;
};

export type AuditChange = { key: string; label: string; before: string; after: string; color?: { before: string | null; after: string | null } };

export const ENTITY_LABELS: Record<string, string> = {
  transaction: 'Transaction',
  transaction_line: 'Transaction line',
  transaction_batch: 'Import batch',
  transaction_reallocation: 'Reallocation',
  account: 'Account',
  category: 'Category',
  tag: 'Tag',
  salary_period: 'Period',
  budget_plan: 'Budget',
  attachment: 'Attachment',
  subscription: 'Subscription',
  wishlist: 'Wishlist item',
  reconciliation_session: 'Balance check',
  recurring_occurrence: 'Recurring payment',
  loan: 'Loan',
  loan_payment: 'Loan payment',
  reimbursement_claim: 'Reimbursement',
  reimbursement_receipt: 'Reimbursement payment',
  contact: 'Contact',
  splitbill_session: 'Split bill',
};

const ACTION_LABELS: Record<string, string> = {
  create: 'Added',
  update: 'Changed',
  delete: 'Deleted',
  post: 'Posted',
  close: 'Closed',
  reopen: 'Reopened',
  set_coverage: 'Marked how complete',
  update_budget_plan: 'Changed the budget',
  void: 'Voided',
  link: 'Linked',
  submit: 'Submitted',
  approve: 'Approved',
  cancel: 'Cancelled',
  correct: 'Corrected',
  archive: 'Archived',
  restore: 'Restored',
  agent_update: 'Changed by Agent',
  discard: 'Discarded',
  create_opening_balance: 'Set opening balances',
  create_recovery: 'Recovered balances',
  create_complete_return_current_period: 'Marked complete on return',
  link_split_bill: 'Linked to a split bill',
  attach_matching_salary_period: 'Moved into its period',
};

/** Snapshot keys that only wrap the record itself. */
const WRAPPERS = new Set(['transaction', 'loan', 'session', 'claim', 'payment', 'receipt', 'item']);

/** Bookkeeping the person never sees or set. */
const IGNORED = new Set([
  'id', 'createdAt', 'updatedAt', 'version', 'sortOrder', 'transactionId', 'linkedAccountName', 'linkedAccountType',
  'monthlyEquivalent', 'lastPayment', 'originLat', 'originLng', 'destLat', 'destLng', 'reason', 'lines', 'tagIds',
  'recognitionIds', 'items', 'sources', 'allocations', 'acknowledgement', 'iconKey', 'reference',
]);

const FIELD_LABELS: Record<string, string> = {
  description: 'Description',
  place: 'Place',
  notes: 'Notes',
  date: 'Date',
  dueDate: 'Due date',
  categoryId: 'Category',
  periodId: 'Period',
  status: 'Status',
  txType: 'Type',
  amount: 'Amount',
  amountCents: 'Amount',
  amountMonthly: 'Monthly amount',
  plannedAmount: 'Planned',
  remainingCents: 'Still owed',
  savingsTargetAmount: 'Savings target',
  adminFeeCents: 'Admin fee',
  creditLimit: 'Credit limit',
  name: 'Name',
  title: 'Title',
  color: 'Colour',
  icon: 'Icon',
  isActive: 'In use',
  coverageStatus: 'How complete',
  coverageReason: 'Why',
  budgetNote: 'Budget note',
  billingCycle: 'Billing',
  billingDay: 'Billing day',
  nextRenewalAt: 'Next renewal',
  endsAt: 'Ends',
  trialEndsAt: 'Trial ends',
  subscriptionId: 'Subscription',
  batchId: 'Import batch',
  accountId: 'Account',
  linkedAccountId: 'Paid from',
  walletAccountId: 'Wallet',
  contactId: 'Contact',
  direction: 'Direction',
  paymentMode: 'Payment',
  startDate: 'Starts',
  endDate: 'Ends',
  closedAt: 'Closed',
  reopenedAt: 'Reopened',
  submittedAt: 'Submitted',
  approvedAt: 'Approved',
  archivedAt: 'Archived',
  writtenOffAt: 'Written off',
  fromAccounts: 'From',
  toAccounts: 'To',
  linkedTxId: 'Linked transaction',
  reversalOfTxId: 'Reverses',
  installmentMonths: 'Instalments',
  interestRatePercent: 'Interest',
  liquidityClass: 'Liquidity',
  type: 'Type',
  kind: 'Kind',
  relationshipType: 'Relationship',
  occurrenceDate: 'Due on',
  tags: 'Tags',
  tagId: 'Tag',
  lastError: 'Error',
};

const MONEY = /^(amount|amountCents|amountMonthly|plannedAmount|remainingCents|savingsTargetAmount|adminFeeCents|creditLimit|foreignAmount)$/;
const WITH_TIME = /At$/;
const DAY = /^(date|dueDate|startDate|endDate|occurrenceDate)$/;
const CODES = new Set(['status', 'txType', 'coverageStatus', 'direction', 'billingCycle', 'paymentMode', 'type', 'kind', 'liquidityClass']);

export function entityLabel(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? words(entityType);
}

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? words(action);
}

export function auditKind(action: string): AuditKind {
  if (action === 'create') return 'added';
  if (action === 'update' || action === 'agent_update') return 'changed';
  if (action === 'delete' || action === 'discard') return 'removed';
  return 'step';
}

/** "simple_expense" → "Simple expense", "remainingCents" → "Remaining cents". */
function words(value: string): string {
  const spaced = value.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** The record's own fields: wrappers unwrapped, a transaction's lines read as amount, from and to. */
export function auditFields(snapshot: Record<string, unknown> | null): Record<string, unknown> {
  if (!snapshot) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (WRAPPERS.has(key) && isRecord(value)) Object.assign(out, value);
    else if (!(key in out)) out[key] = value;
  }
  const lines = snapshot.lines;
  if (Array.isArray(lines) && lines.every(isRecord)) {
    const debit = lines.reduce((sum, line) => sum + (typeof line.debit === 'number' ? line.debit : 0), 0);
    if (debit > 0) out.amount = debit;
    const accounts = (side: 'debit' | 'credit') => lines.filter((line) => typeof line[side] === 'number' && (line[side] as number) > 0 && typeof line.accountId === 'number').map((line) => line.accountId as number);
    out.fromAccounts = accounts('credit');
    out.toAccounts = accounts('debit');
  }
  return out;
}

/** What the entry is about, by its own name: "Chateraise 23 Paskal 72", "April 2026". */
export function auditName(entry: AuditEntry): string | null {
  for (const snapshot of [entry.afterSnapshot, entry.beforeSnapshot]) {
    const fields = auditFields(snapshot);
    for (const key of ['name', 'title', 'description', 'place']) {
      const value = fields[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return null;
}

function idName(key: string, id: number, format: AuditFormat): string {
  if (key === 'categoryId') return format.category(id) ?? `Category #${id}`;
  if (key === 'periodId') return format.period(id) ?? `Period #${id}`;
  if (key === 'accountId' || key === 'linkedAccountId' || key === 'walletAccountId') return format.account(id) ?? `Account #${id}`;
  return `#${id}`;
}

/** A field's value in words. Empty values read as an em dash. */
export function formatAuditValue(key: string, value: unknown, format: AuditFormat): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (key === 'fromAccounts' || key === 'toAccounts') {
    const ids = Array.isArray(value) ? value.filter((id): id is number => typeof id === 'number') : [];
    return ids.length ? ids.map((id) => format.account(id) ?? `Account #${id}`).join(', ') : '—';
  }
  // Tags are kept as [{ tagId }] (or plain ids): show their names.
  if (Array.isArray(value) && /^tag/.test(key)) {
    const ids = value.map((item) => (isRecord(item) ? item.tagId : item)).filter((id): id is number => typeof id === 'number');
    if (ids.length === value.length) return ids.length ? ids.map((id) => format.tag(id) ?? `Tag #${id}`).join(', ') : '—';
  }
  if (typeof value === 'number' && MONEY.test(key)) return format.amount(value);
  if (typeof value === 'number' && /Id$/.test(key)) return idName(key, value, format);
  if (WITH_TIME.test(key) || DAY.test(key)) {
    const ms = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
    if (Number.isFinite(ms)) return WITH_TIME.test(key) ? format.dateTime(ms) : format.date(ms);
  }
  if (key === 'interestRatePercent' && typeof value === 'number') return `${value}%`;
  if (typeof value === 'string') {
    // Stored codes ("simple_expense", "open") read as words; free text stays as typed.
    if (/^[a-z]+(_[a-z]+)+$/.test(value) || (/^[a-z]+$/.test(value) && CODES.has(key))) return words(value);
    return value.length > 120 ? `${value.slice(0, 117)}…` : value;
  }
  if (typeof value === 'number') return value.toLocaleString('id-ID');
  const json = JSON.stringify(value);
  return json.length > 120 ? `${json.slice(0, 117)}…` : json;
}

export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? words(key.replace(/(Cents|Id)$/, ''));
}

/**
 * The fields that differ between before and after, in the record's own order. For an add or a
 * removal there's nothing to compare, so this lists what the record held instead (before or after
 * is then an em dash).
 */
export function auditChanges(entry: AuditEntry, format: AuditFormat): AuditChange[] {
  const before = auditFields(entry.beforeSnapshot);
  const after = auditFields(entry.afterSnapshot);
  const compare = Boolean(entry.beforeSnapshot && entry.afterSnapshot);
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => !IGNORED.has(key));
  const changes: AuditChange[] = [];
  for (const key of keys) {
    const was = before[key];
    const now = after[key];
    if (compare && JSON.stringify(was ?? null) === JSON.stringify(now ?? null)) continue;
    const held = now ?? was;
    if (!compare && (held == null || held === '' || (Array.isArray(held) && held.length === 0))) continue;
    changes.push({
      key,
      label: fieldLabel(key),
      before: compare || !entry.afterSnapshot ? formatAuditValue(key, was, format) : '—',
      after: entry.afterSnapshot ? formatAuditValue(key, now, format) : '—',
      ...(key === 'color' ? { color: { before: typeof was === 'string' ? was : null, after: typeof now === 'string' ? now : null } } : {}),
    });
  }
  return changes;
}

/** The reason a workflow gave for the step, when it saved one. */
export function auditReason(entry: AuditEntry): string | null {
  const reason = entry.afterSnapshot?.reason ?? entry.beforeSnapshot?.reason;
  return typeof reason === 'string' && reason.trim() ? reason.trim() : null;
}

/** The amount the record is about, for the list's second line. */
export function auditAmount(entry: AuditEntry): number | null {
  const fields = { ...auditFields(entry.beforeSnapshot), ...auditFields(entry.afterSnapshot) };
  for (const key of ['amount', 'amountCents', 'amountMonthly', 'plannedAmount']) {
    const value = fields[key];
    if (typeof value === 'number' && value > 0) return value;
  }
  return null;
}
