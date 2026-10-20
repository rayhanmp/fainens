import { and, desc, eq, gte, inArray, isNull, like, lte, or } from "drizzle-orm";

import { invalidateOnTransactionMutation } from "../cache";
import { db } from "../db/client";
import {
  accounts,
  auditLogs,
  recurringOccurrences,
  reimbursementClaimSources,
  subscriptions,
  transactionLines,
  transactions,
} from "../db/schema";
import { getOrCreateAutoExpenseAccount, insertPreparedJournalEntrySync, prepareJournalEntry, type PreparedJournalEntry } from "./ledger";
import { findPeriodIdForDate } from "./transaction-mutations";
import { DAY_MS, endOfLocalDay, localDayKey, startOfLocalDay } from "../lib/calendar";
import { bumpFinancialRevisionSync } from "./financial-revision";
import { insertDomainReversalSync, prepareDomainReversal } from "./domain-reversal";
import { nextRenewal, type SubscriptionSchedule } from "./subscription-schedule";

export { addOneMonth, addOneYear } from "./recurrence-calendar";

const MAX_CATCH_UP_OCCURRENCES = 120;

function ts(value: Date | number): number {
  return value instanceof Date ? value.getTime() : Number(value);
}

type SubscriptionRow = typeof subscriptions.$inferSelect;

/** The renewal after `dueAt`, back on the subscription's billing day after any shorter month. */
export function nextOccurrence(dueAt: number, schedule: SubscriptionSchedule): number {
  return nextRenewal(dueAt, schedule);
}

/** Last instant a renewal can fall due: the end of the subscription's final day, if it has one. */
function lastDueAt(subscription: Pick<SubscriptionRow, "endsAt">): number {
  return subscription.endsAt == null ? Number.POSITIVE_INFINITY : endOfLocalDay(ts(subscription.endsAt));
}

/** Active subscriptions renew; cancelled ones still owe the renewals up to their end date. */
function renews(subscription: Pick<SubscriptionRow, "status" | "endsAt">): boolean {
  return subscription.status === "active" || (subscription.status === "cancelled" && subscription.endsAt != null);
}

const PAYLATER_PATTERN = /pay\s*later|traveloka|kredivo|akulaku|split|defer|humm|afterpay/i;

/** PayLater credit lines track installments, so a renewal can't be charged straight to one. */
export function isPaylaterAccount(account: { type: string; name: string; provider?: string | null }): boolean {
  return account.type === "liability" && PAYLATER_PATTERN.test(`${account.name} ${account.provider ?? ""}`);
}

export type PaymentAccountCandidate = {
  type: string;
  name: string;
  provider?: string | null;
  systemKey?: string | null;
  isActive: boolean;
};

/** Why an account can't pay a subscription, or null when it can: wallets, banks and cards only. */
export function subscriptionPaymentAccountProblem(account: PaymentAccountCandidate | undefined): string | null {
  if (!account) return "Payment account not found";
  if (!account.isActive) return "Payment account is inactive";
  if (!["asset", "liability"].includes(account.type) || account.systemKey) return "Pay from a wallet, bank or card account";
  if (isPaylaterAccount(account)) return "PayLater accounts can't pay subscriptions; record the purchase on the Pay later page instead";
  return null;
}

async function loadPaymentAccounts(ids: number[]) {
  if (ids.length === 0) return new Map<number, { id: number; name: string; type: string; provider: string | null; systemKey: string | null; isActive: boolean; liquidityClass: string }>();
  const rows = await db
    .select({ id: accounts.id, name: accounts.name, type: accounts.type, provider: accounts.provider, systemKey: accounts.systemKey, isActive: accounts.isActive, liquidityClass: accounts.liquidityClass })
    .from(accounts)
    .where(inArray(accounts.id, ids));
  return new Map(rows.map((row: { id: number }) => [row.id, row] as const)) as Map<number, { id: number; name: string; type: string; provider: string | null; systemKey: string | null; isActive: boolean; liquidityClass: string }>;
}

export interface SubscriptionOccurrencePreview {
  subscriptionId: number;
  subscriptionName: string;
  dueAt: number;
  amount: number;
  linkedAccountId: number;
  billingCycle: string;
  intervalCount: number;
  paymentMode: string;
  currency: string | null;
  foreignAmount: number | null;
}

export async function previewDueSubscriptionRenewals(now = Date.now()): Promise<{
  occurrences: SubscriptionOccurrencePreview[];
  truncated: boolean;
}> {
  const rows = await db.select().from(subscriptions).where(inArray(subscriptions.status, ["active", "cancelled"]));
  const occurrences: SubscriptionOccurrencePreview[] = [];
  let truncated = false;
  for (const subscription of rows) {
    if (!renews(subscription)) continue;
    const limit = Math.min(now, lastDueAt(subscription));
    let dueAt = ts(subscription.nextRenewalAt);
    while (dueAt <= limit && occurrences.length < MAX_CATCH_UP_OCCURRENCES) {
      occurrences.push({
        subscriptionId: subscription.id,
        subscriptionName: subscription.name,
        dueAt,
        amount: subscription.amount,
        linkedAccountId: subscription.linkedAccountId,
        billingCycle: subscription.billingCycle,
        intervalCount: subscription.intervalCount,
        paymentMode: subscription.paymentMode,
        currency: subscription.currency,
        foreignAmount: subscription.foreignAmount,
      });
      dueAt = nextRenewal(dueAt, subscription);
    }
    if (dueAt <= limit) truncated = true;
  }
  occurrences.sort((a, b) => a.dueAt - b.dueAt);
  return { occurrences, truncated };
}

/** Compatibility for legacy scheduler callers: detection only, never posting. */
export async function processDueSubscriptionRenewals(_dbLike?: unknown): Promise<{
  processed: 0;
  skippedNoAccount: number;
  errors: string[];
}> {
  const preview = await previewDueSubscriptionRenewals();
  return { processed: 0, skippedNoAccount: preview.occurrences.length, errors: [] };
}

/**
 * What to do with one renewal. `post` records the charge (with the amount, date and account it
 * actually had), `link` claims a transaction already in the ledger, `skip` records that nothing was
 * charged. `reanchor` restarts the schedule from the payment date, e.g. after a late payment.
 */
export type OccurrenceResolution =
  | { subscriptionId: number; dueAt: number; action: "post"; amount?: number; paidAt?: number; accountId?: number; categoryId?: number | null; reanchor?: boolean }
  | { subscriptionId: number; dueAt: number; action: "link"; transactionId: number; reanchor?: boolean }
  | { subscriptionId: number; dueAt: number; action: "skip" };

export interface OccurrenceResolutionResult {
  posted: number;
  linked: number;
  skipped: number;
  transactionIds: number[];
  nextRenewals: Array<{ subscriptionId: number; nextRenewalAt: number }>;
}

/** The schedule restarted from a payment day: the next renewal one interval after it, on its day. */
function reanchoredNext(paidAt: number, subscription: SubscriptionRow): { nextRenewalAt: number; billingDay: number } {
  const anchor = new Date(startOfLocalDay(paidAt));
  anchor.setHours(12, 0, 0, 0);
  const billingDay = anchor.getDate();
  return { nextRenewalAt: nextRenewal(anchor.getTime(), { ...subscription, billingDay }), billingDay };
}

const LINKABLE_EXCLUDED_TYPES = ["domain_reversal", "subscription_renewal", "subscription_correction", "transfer", "opening_balance"];

export async function resolveSubscriptionOccurrences(
  items: OccurrenceResolution[],
  now = Date.now(),
): Promise<OccurrenceResolutionResult> {
  if (!Array.isArray(items) || items.length === 0) throw new Error("At least one occurrence is required");
  if (items.length > MAX_CATCH_UP_OCCURRENCES) {
    throw new Error(`At most ${MAX_CATCH_UP_OCCURRENCES} occurrences may be resolved at once`);
  }
  const identities = items.map((item) => `${item.subscriptionId}:${item.dueAt}`);
  if (
    new Set(identities).size !== identities.length ||
    items.some((item) => !Number.isInteger(item.subscriptionId) || item.subscriptionId <= 0 || !Number.isSafeInteger(item.dueAt) || item.dueAt < 0)
  ) throw new Error("Occurrence identities must be unique and valid");

  const subscriptionIds = [...new Set(items.map((item) => item.subscriptionId))];
  const subscriptionRows = await db.select().from(subscriptions).where(inArray(subscriptions.id, subscriptionIds));
  if (subscriptionRows.length !== subscriptionIds.length) throw new Error("Subscription not found");
  const subscriptionById = new Map(subscriptionRows.map((row) => [row.id, row] as const));

  // Each subscription's renewals are resolved in schedule order with no gaps; only the next one
  // may be resolved ahead of its date (paying early), and only the last may restart the schedule.
  const groups = new Map<number, OccurrenceResolution[]>();
  for (const subscriptionId of subscriptionIds) {
    const subscription = subscriptionById.get(subscriptionId)!;
    if (!renews(subscription)) throw new Error(`${subscription.name} is ${subscription.status}; resume it first`);
    if (!Number.isSafeInteger(subscription.amount) || subscription.amount <= 0) throw new Error(`${subscription.name} needs a positive amount`);
    const selected = items.filter((item) => item.subscriptionId === subscriptionId).sort((a, b) => a.dueAt - b.dueAt);
    let expected = ts(subscription.nextRenewalAt);
    selected.forEach((item, index) => {
      if (item.dueAt !== expected) throw new Error(`The ${localDayKey(item.dueAt)} renewal of ${subscription.name} is stale or leaves a gap`);
      if (item.dueAt > lastDueAt(subscription)) throw new Error(`${subscription.name} has ended before ${localDayKey(item.dueAt)}`);
      const last = index === selected.length - 1;
      if (item.dueAt > now && !last) throw new Error(`Only the next renewal of ${subscription.name} can be resolved ahead of its date`);
      if (item.action !== "skip" && item.reanchor && !last) throw new Error("Only the last renewal resolved can move the schedule");
      expected = nextRenewal(expected, subscription);
    });
    if (selected.filter((item) => item.dueAt > now).length > 1) throw new Error(`Only the next renewal of ${subscription.name} can be resolved ahead of its date`);
    groups.set(subscriptionId, selected);
  }

  const posts = items.filter((item): item is Extract<OccurrenceResolution, { action: "post" }> => item.action === "post");
  const links = items.filter((item): item is Extract<OccurrenceResolution, { action: "link" }> => item.action === "link");

  const paymentAccounts = await loadPaymentAccounts([...new Set(posts.map((item) => item.accountId ?? subscriptionById.get(item.subscriptionId)!.linkedAccountId))]);
  const latestPaidAt = endOfLocalDay(now);
  const expenseAccount = posts.length > 0 ? await getOrCreateAutoExpenseAccount(db) : null;
  // Prepared through the canonical journal path: validates lines, writes category allocations and
  // refuses closed periods (rechecked inside the write below).
  const prepared = new Map<string, { entry: PreparedJournalEntry; paidAt: number }>();
  for (const item of posts) {
    const subscription = subscriptionById.get(item.subscriptionId)!;
    const amount = item.amount ?? subscription.amount;
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("amount must be a positive integer rupiah value");
    const accountId = item.accountId ?? subscription.linkedAccountId;
    const paymentAccount = paymentAccounts.get(accountId);
    const problem = subscriptionPaymentAccountProblem(paymentAccount);
    if (problem) throw new Error(problem);
    const paidAt = item.paidAt ?? Math.min(item.dueAt, now);
    if (!Number.isSafeInteger(paidAt) || paidAt < 0 || paidAt > latestPaidAt) throw new Error("The payment date can't be in the future");
    const late = startOfLocalDay(paidAt) > startOfLocalDay(item.dueAt);
    prepared.set(`${item.subscriptionId}:${item.dueAt}`, {
      paidAt,
      entry: await prepareJournalEntry({
        date: paidAt,
        description: `Subscription: ${subscription.name}`,
        notes: `Renewal due ${localDayKey(item.dueAt)}${late ? `, paid ${localDayKey(paidAt)}` : ""} · subscription #${subscription.id}`,
        reference: `subscription:${subscription.id}:${item.dueAt}`,
        txType: "subscription_renewal",
        periodId: null,
        categoryId: item.categoryId === undefined ? subscription.categoryId : item.categoryId,
        subscriptionId: subscription.id,
        lines: [
          { accountId: expenseAccount!.id, debit: amount, credit: 0 },
          { accountId, debit: 0, credit: amount, cashFlowClass: paymentAccount!.liquidityClass === "cash_equivalent" ? "operating" : undefined },
        ],
      }, db),
    });
  }

  const linkedTransactions = new Map<number, { id: number; date: number }>();
  if (links.length > 0) {
    const transactionIds = links.map((item) => item.transactionId);
    if (new Set(transactionIds).size !== transactionIds.length) throw new Error("A transaction can pay only one renewal");
    const rows = await db.select().from(transactions).where(inArray(transactions.id, transactionIds));
    const claimed = await db.select({ transactionId: recurringOccurrences.transactionId }).from(recurringOccurrences)
      .where(inArray(recurringOccurrences.transactionId, transactionIds));
    for (const item of links) {
      const row = rows.find((candidate) => candidate.id === item.transactionId);
      if (!row || row.status !== "posted" || row.reversalOfTxId != null || LINKABLE_EXCLUDED_TYPES.includes(row.txType ?? "")) {
        throw new Error(`Transaction ${item.transactionId} can't be linked; pick a posted expense`);
      }
      if ((row.subscriptionId != null && row.subscriptionId !== item.subscriptionId) || claimed.some((c) => c.transactionId === row.id)) {
        throw new Error(`Transaction ${item.transactionId} already pays another renewal`);
      }
      linkedTransactions.set(row.id, { id: row.id, date: ts(row.date) });
    }
  }

  let result: OccurrenceResolutionResult & { periodIds: number[] };
  try {
    result = db.transaction((tx) => {
      const transactionIds: number[] = [];
      const periodIds: number[] = [];
      const nextRenewals: OccurrenceResolutionResult["nextRenewals"] = [];
      for (const [subscriptionId, selected] of groups) {
        const before = subscriptionById.get(subscriptionId)!;
        const subscription = tx.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1).all()[0];
        if (!subscription || !renews(subscription) || ts(subscription.nextRenewalAt) !== ts(before.nextRenewalAt) || subscription.amount !== before.amount) {
          throw new Error(`${before.name} changed; reload and retry`);
        }
        let expectedDueAt = ts(subscription.nextRenewalAt);
        let billingDay = subscription.billingDay;
        for (const item of selected) {
          const claimed = tx.insert(recurringOccurrences).values({
            jobType: "subscription",
            scheduleId: subscriptionId,
            occurrenceDate: new Date(item.dueAt),
            status: item.action === "skip" ? "skipped" : "pending",
          }).returning({ id: recurringOccurrences.id }).all()[0];
          if (!claimed) throw new Error("Failed to claim recurring occurrence");
          expectedDueAt = nextRenewal(expectedDueAt, subscription);

          if (item.action === "post") {
            const { entry, paidAt } = prepared.get(`${subscriptionId}:${item.dueAt}`)!;
            const transactionId = insertPreparedJournalEntrySync(tx, entry);
            tx.update(recurringOccurrences)
              .set({ status: "posted", transactionId, updatedAt: new Date() })
              .where(eq(recurringOccurrences.id, claimed.id)).run();
            transactionIds.push(transactionId);
            if (entry.periodId != null) periodIds.push(entry.periodId);
            if (item.reanchor) ({ nextRenewalAt: expectedDueAt, billingDay } = reanchoredNext(paidAt, subscription));
          } else if (item.action === "link") {
            const linked = linkedTransactions.get(item.transactionId)!;
            const current = tx.select({ subscriptionId: transactions.subscriptionId, status: transactions.status })
              .from(transactions).where(eq(transactions.id, linked.id)).limit(1).all()[0];
            if (!current || current.status !== "posted" || (current.subscriptionId != null && current.subscriptionId !== subscriptionId)) {
              throw new Error(`Transaction ${linked.id} changed; reload and retry`);
            }
            tx.update(transactions).set({ subscriptionId }).where(eq(transactions.id, linked.id)).run();
            const row = tx.update(recurringOccurrences)
              .set({ status: "posted", transactionId: linked.id, lastError: `Linked to existing transaction ${linked.id}`, updatedAt: new Date() })
              .where(eq(recurringOccurrences.id, claimed.id)).returning().all()[0];
            tx.insert(auditLogs).values({
              entityType: "recurring_occurrence",
              entityId: claimed.id,
              action: "link",
              beforeSnapshot: null,
              afterSnapshot: Buffer.from(JSON.stringify(row)),
            }).run();
            transactionIds.push(linked.id);
            if (item.reanchor) ({ nextRenewalAt: expectedDueAt, billingDay } = reanchoredNext(linked.date, subscription));
          }
          if (expectedDueAt <= item.dueAt) throw new Error("The payment date is too early to restart the schedule from");
        }
        tx.update(subscriptions)
          .set({ nextRenewalAt: new Date(expectedDueAt), billingDay, updatedAt: new Date() })
          .where(and(eq(subscriptions.id, subscription.id), eq(subscriptions.nextRenewalAt, subscription.nextRenewalAt)))
          .run();
        nextRenewals.push({ subscriptionId, nextRenewalAt: expectedDueAt });
      }
      bumpFinancialRevisionSync(tx);
      return {
        posted: posts.length,
        linked: links.length,
        skipped: items.length - posts.length - links.length,
        transactionIds,
        nextRenewals,
        periodIds: [...new Set(periodIds)],
      };
    });
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
      throw new Error("One or more occurrences were already processed");
    }
    throw error;
  }

  const affectedAccountIds = [expenseAccount?.id, ...posts.map((item) => item.accountId ?? subscriptionById.get(item.subscriptionId)!.linkedAccountId)]
    .filter((id): id is number => id != null);
  await invalidateOnTransactionMutation({
    transactionId: result.transactionIds[0] ?? subscriptionIds[0],
    affectedAccountIds: [...new Set(affectedAccountIds)],
    affectedPeriodIds: result.periodIds,
    revisionBumped: true,
  });
  const { periodIds: _periodIds, ...publicResult } = result;
  return publicResult;
}

/** Post or skip a batch of renewals that are already due, at their expected amount and date. */
export async function applySubscriptionOccurrences(input: {
  mode: "post" | "skip";
  occurrences: Array<{ subscriptionId: number; dueAt: number }>;
}): Promise<{ posted: number; skipped: number; transactionIds: number[] }> {
  if (!Array.isArray(input.occurrences) || input.occurrences.length === 0) {
    throw new Error("At least one occurrence is required");
  }
  const now = Date.now();
  if (input.occurrences.some((item) => !Number.isSafeInteger(item.dueAt) || item.dueAt > now)) {
    throw new Error("Occurrence identities must be unique, historical, and valid");
  }
  const result = await resolveSubscriptionOccurrences(
    input.occurrences.map((item) => ({ subscriptionId: item.subscriptionId, dueAt: item.dueAt, action: input.mode })),
    now,
  );
  return { posted: result.posted, skipped: result.skipped, transactionIds: result.transactionIds };
}

/** The amount a journal moved: the sum of its debits. */
async function journalAmounts(transactionIds: number[]): Promise<Map<number, { amount: number; paymentAccountName: string | null }>> {
  const result = new Map<number, { amount: number; paymentAccountName: string | null }>();
  if (transactionIds.length === 0) return result;
  const lines = await db
    .select({ transactionId: transactionLines.transactionId, debit: transactionLines.debit, credit: transactionLines.credit, accountType: accounts.type, accountName: accounts.name })
    .from(transactionLines)
    .innerJoin(accounts, eq(accounts.id, transactionLines.accountId))
    .where(inArray(transactionLines.transactionId, transactionIds));
  for (const line of lines as Array<{ transactionId: number; debit: number; credit: number; accountType: string; accountName: string }>) {
    const entry = result.get(line.transactionId) ?? { amount: 0, paymentAccountName: null };
    entry.amount += line.debit;
    if (line.credit > 0 && ["asset", "liability"].includes(line.accountType)) entry.paymentAccountName ??= line.accountName;
    result.set(line.transactionId, entry);
  }
  return result;
}

export interface OccurrenceCandidate {
  transactionId: number;
  date: number;
  description: string;
  amount: number;
  accountName: string | null;
}

/**
 * Posted expenses that could be this renewal's charge, entered by hand: unclaimed, dated from a
 * week before the due date to five weeks after (late payments), and close to the expected price.
 */
export async function findOccurrenceCandidates(subscriptionId: number, dueAt: number): Promise<OccurrenceCandidate[]> {
  const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1);
  if (!subscription) throw new Error("Subscription not found");
  const rows = await db.select({ id: transactions.id, date: transactions.date, description: transactions.description, txType: transactions.txType })
    .from(transactions)
    .where(and(
      eq(transactions.status, "posted"),
      isNull(transactions.subscriptionId),
      isNull(transactions.reversalOfTxId),
      gte(transactions.date, new Date(dueAt - 7 * DAY_MS)),
      lte(transactions.date, new Date(dueAt + 35 * DAY_MS)),
    ));
  const open = rows.filter((row) => !LINKABLE_EXCLUDED_TYPES.includes(row.txType ?? ""));
  if (open.length === 0) return [];
  const claimed = new Set((await db.select({ transactionId: recurringOccurrences.transactionId }).from(recurringOccurrences)
    .where(inArray(recurringOccurrences.transactionId, open.map((row) => row.id)))).map((row) => row.transactionId));
  const unclaimed = open.filter((row) => !claimed.has(row.id));
  const amounts = await journalAmounts(unclaimed.map((row) => row.id));
  const words = subscription.name.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3);
  return unclaimed
    .map((row) => {
      const journal = amounts.get(row.id);
      const amount = journal?.amount ?? 0;
      const nameMatch = words.some((word) => row.description.toLowerCase().includes(word));
      const score = Math.abs(amount - subscription.amount) / subscription.amount + Math.abs(ts(row.date) - dueAt) / (30 * DAY_MS) - (nameMatch ? 0.6 : 0);
      return { row, amount, accountName: journal?.paymentAccountName ?? null, nameMatch, score };
    })
    .filter((item) => item.accountName != null && (item.nameMatch || (item.amount >= subscription.amount * 0.5 && item.amount <= subscription.amount * 1.5)))
    .sort((a, b) => a.score - b.score)
    .slice(0, 8)
    .map((item) => ({ transactionId: item.row.id, date: ts(item.row.date), description: item.row.description, amount: item.amount, accountName: item.accountName }));
}

export interface SubscriptionHistoryEntry {
  dueAt: number | null;
  /** paid: posted by the subscription; linked: an existing transaction; corrected; voided: posted then reversed; skipped. */
  status: "paid" | "linked" | "corrected" | "voided" | "skipped";
  note: string | null;
  transaction: { id: number; date: number; amount: number; description: string; accountName: string | null; status: string; txType: string } | null;
}

/** Every renewal the subscription has resolved, newest first, with the charges actually made. */
export async function getSubscriptionHistory(subscriptionId: number): Promise<{
  entries: SubscriptionHistoryEntry[];
  totalPaid: number;
  paidCount: number;
  skippedCount: number;
}> {
  const occurrences = await db.select().from(recurringOccurrences).where(and(
    eq(recurringOccurrences.jobType, "subscription"),
    eq(recurringOccurrences.scheduleId, subscriptionId),
  ));
  const txRows = await db.select().from(transactions).where(or(
    eq(transactions.subscriptionId, subscriptionId),
    like(transactions.reference, `sub:${subscriptionId}:%`),
    occurrences.some((row) => row.transactionId != null)
      ? inArray(transactions.id, occurrences.map((row) => row.transactionId).filter((id): id is number => id != null))
      : undefined,
  )).orderBy(desc(transactions.date));
  const charges = txRows.filter((row) => row.txType !== "domain_reversal" && row.reversalOfTxId == null);
  const amounts = await journalAmounts(charges.map((row) => row.id));
  const describe = (row: typeof txRows[number]) => ({
    id: row.id,
    date: ts(row.date),
    amount: amounts.get(row.id)?.amount ?? 0,
    description: row.description,
    accountName: amounts.get(row.id)?.paymentAccountName ?? null,
    status: row.status,
    txType: row.txType ?? "manual",
  });
  const entries: SubscriptionHistoryEntry[] = [];
  const shown = new Set<number>();
  const references = (dueAt: number) => [`subscription:${subscriptionId}:${dueAt}`, `sub:${subscriptionId}:${dueAt}`];
  for (const occurrence of occurrences) {
    const dueAt = ts(occurrence.occurrenceDate);
    let row = charges.find((candidate) => candidate.id === occurrence.transactionId);
    // A voided renewal keeps no transaction; its reversed charge still names the renewal.
    const voided = !row && occurrence.status === "skipped"
      ? charges.find((candidate) => candidate.status === "reversed" && references(dueAt).includes(candidate.reference ?? ""))
      : undefined;
    row ??= voided;
    if (row) shown.add(row.id);
    const status: SubscriptionHistoryEntry["status"] = voided ? "voided"
      : occurrence.status === "corrected" ? "corrected"
      : occurrence.status === "skipped" || !row ? "skipped"
      : row.txType === "subscription_renewal" ? "paid" : "linked";
    entries.push({ dueAt, status, note: occurrence.lastError, transaction: row ? describe(row) : null });
  }
  // Charges from before renewals were recorded, or tagged with the subscription by hand.
  for (const row of charges) {
    if (shown.has(row.id)) continue;
    const legacyDue = /^sub:\d+:(\d+)$/.exec(row.reference ?? "")?.[1];
    entries.push({ dueAt: legacyDue ? Number(legacyDue) : null, status: row.txType === "subscription_renewal" ? "paid" : "linked", note: null, transaction: describe(row) });
  }
  entries.sort((a, b) => (b.dueAt ?? b.transaction?.date ?? 0) - (a.dueAt ?? a.transaction?.date ?? 0));
  const paid = entries.filter((entry) => entry.transaction && entry.transaction.status === "posted");
  return {
    entries,
    totalPaid: paid.reduce((sum, entry) => sum + entry.transaction!.amount, 0),
    paidCount: paid.length,
    skippedCount: entries.filter((entry) => entry.status === "skipped" || entry.status === "voided").length,
  };
}

/**
 * The subscription a charge belongs to. Renewals posted before transactions carried a
 * subscription id name it only in their "sub:<id>:<due>" reference.
 */
function chargeSubscriptionId(row: { subscriptionId: number | null; reference: string | null; txType: string | null }): number | null {
  if (row.subscriptionId != null) return row.subscriptionId;
  if (row.txType !== "subscription_renewal") return null;
  const legacy = /^sub:(\d+):\d+$/.exec(row.reference ?? "")?.[1];
  return legacy ? Number(legacy) : null;
}

/** The most recent charge of each subscription, for the list view. */
export async function lastPaymentsBySubscription(subscriptionIds: number[]): Promise<Map<number, { date: number; amount: number }>> {
  const result = new Map<number, { date: number; amount: number }>();
  if (subscriptionIds.length === 0) return result;
  const rows = await db.select({ id: transactions.id, subscriptionId: transactions.subscriptionId, reference: transactions.reference, date: transactions.date, txType: transactions.txType })
    .from(transactions)
    .where(and(
      or(inArray(transactions.subscriptionId, subscriptionIds), like(transactions.reference, "sub:%")),
      eq(transactions.status, "posted"),
      isNull(transactions.reversalOfTxId),
    ))
    .orderBy(desc(transactions.date));
  const wanted = new Set(subscriptionIds);
  const latest = new Map<number, { id: number; date: number }>();
  for (const row of rows) {
    const subscriptionId = chargeSubscriptionId(row);
    if (subscriptionId == null || !wanted.has(subscriptionId) || row.txType === "domain_reversal" || latest.has(subscriptionId)) continue;
    latest.set(subscriptionId, { id: row.id, date: ts(row.date) });
  }
  const amounts = await journalAmounts([...latest.values()].map((row) => row.id));
  for (const [subscriptionId, row] of latest) result.set(subscriptionId, { date: row.date, amount: amounts.get(row.id)?.amount ?? 0 });
  return result;
}

/**
 * What subscriptions actually charged in each of the last `months` calendar months (this one
 * included), by subscription. Reversed and voided charges are left out.
 */
export async function subscriptionChargesByMonth(months = 12, now = Date.now()): Promise<Array<{
  month: string;
  total: number;
  items: Array<{ subscriptionId: number; amount: number }>;
}>> {
  const today = new Date(now);
  const start = new Date(today.getFullYear(), today.getMonth() - (months - 1), 1).getTime();
  const rows = await db.select({ id: transactions.id, subscriptionId: transactions.subscriptionId, reference: transactions.reference, date: transactions.date, txType: transactions.txType })
    .from(transactions)
    .where(and(eq(transactions.status, "posted"), isNull(transactions.reversalOfTxId), gte(transactions.date, new Date(start))));
  const charges = rows
    .filter((row) => row.txType !== "domain_reversal")
    .map((row) => ({ ...row, subscriptionId: chargeSubscriptionId(row) }))
    .filter((row) => row.subscriptionId != null);
  const amounts = await journalAmounts(charges.map((row) => row.id));
  const byMonth = new Map<string, Map<number, number>>();
  for (let index = 0; index < months; index += 1) {
    byMonth.set(localDayKey(new Date(today.getFullYear(), today.getMonth() - (months - 1) + index, 1).getTime()).slice(0, 7), new Map());
  }
  for (const row of charges) {
    const items = byMonth.get(localDayKey(ts(row.date)).slice(0, 7));
    if (!items) continue;
    items.set(row.subscriptionId!, (items.get(row.subscriptionId!) ?? 0) + (amounts.get(row.id)?.amount ?? 0));
  }
  return [...byMonth].map(([month, items]) => ({
    month,
    total: [...items.values()].reduce((sum, amount) => sum + amount, 0),
    items: [...items].map(([subscriptionId, amount]) => ({ subscriptionId, amount })),
  }));
}

/**
 * Renewals in the last `months` calendar months that charged nothing: skipped, or posted and then
 * voided. Paid ones come from `subscriptionChargesByMonth`.
 */
export async function unpaidRenewalsByMonth(months = 12, now = Date.now()): Promise<Array<{
  subscriptionId: number;
  dueAt: number;
  kind: "skipped" | "voided";
}>> {
  const today = new Date(now);
  const start = new Date(today.getFullYear(), today.getMonth() - (months - 1), 1);
  const rows = await db.select({ scheduleId: recurringOccurrences.scheduleId, occurrenceDate: recurringOccurrences.occurrenceDate, lastError: recurringOccurrences.lastError })
    .from(recurringOccurrences)
    .where(and(
      eq(recurringOccurrences.jobType, "subscription"),
      eq(recurringOccurrences.status, "skipped"),
      gte(recurringOccurrences.occurrenceDate, start),
    ));
  return rows
    .map((row) => ({
      subscriptionId: row.scheduleId,
      dueAt: ts(row.occurrenceDate),
      kind: row.lastError?.startsWith("Voided") ? "voided" as const : "skipped" as const,
    }))
    .sort((a, b) => a.dueAt - b.dueAt);
}

/** The latest renewal already resolved; the schedule can't be moved back onto or before it. */
export async function lastResolvedDueAt(subscriptionId: number): Promise<number | null> {
  const [row] = await db.select({ occurrenceDate: recurringOccurrences.occurrenceDate }).from(recurringOccurrences)
    .where(and(eq(recurringOccurrences.jobType, "subscription"), eq(recurringOccurrences.scheduleId, subscriptionId)))
    .orderBy(desc(recurringOccurrences.occurrenceDate)).limit(1);
  return row ? ts(row.occurrenceDate) : null;
}

/**
 * Correct one posted renewal as an auditable reversal plus replacement.  The
 * schedule has already advanced, so this deliberately does not move
 * nextRenewalAt backward or create a second recurring identity.
 */
export async function correctSubscriptionOccurrence(input: {
  subscriptionId: number;
  dueAt: number;
  reason: string;
  effectiveDate?: number;
  amount?: number;
  linkedAccountId?: number;
  categoryId?: number | null;
}): Promise<{ reversalTransactionId: number; replacementTransactionId: number }> {
  if (!Number.isSafeInteger(input.subscriptionId) || input.subscriptionId <= 0) throw new Error("Invalid subscriptionId");
  if (!Number.isSafeInteger(input.dueAt) || input.dueAt < 0) throw new Error("dueAt must be a valid timestamp");
  const reason = input.reason.trim();
  if (!reason || reason.length > 500) throw new Error("reason is required and must be at most 500 characters");
  const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.id, input.subscriptionId)).limit(1);
  if (!subscription) throw new Error("Subscription not found");
  const [occurrence] = await db.select().from(recurringOccurrences).where(and(
    eq(recurringOccurrences.jobType, "subscription"),
    eq(recurringOccurrences.scheduleId, input.subscriptionId),
    eq(recurringOccurrences.occurrenceDate, new Date(input.dueAt)),
  )).limit(1);
  if (!occurrence?.transactionId || occurrence.status !== "posted") {
    throw new Error("A posted subscription occurrence is required for correction");
  }
  const amount = input.amount ?? subscription.amount;
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("amount must be a positive integer rupiah value");
  const linkedAccountId = input.linkedAccountId ?? subscription.linkedAccountId;
  const paymentAccount = (await loadPaymentAccounts([linkedAccountId])).get(linkedAccountId);
  const problem = subscriptionPaymentAccountProblem(paymentAccount);
  if (problem) throw new Error(problem);
  const effectiveDate = input.effectiveDate ?? Date.now();
  if (!Number.isSafeInteger(effectiveDate) || effectiveDate < 0) throw new Error("effectiveDate must be a valid timestamp");
  const expenseAccount = await getOrCreateAutoExpenseAccount(db);
  const reversal = await prepareDomainReversal(occurrence.transactionId, reason, db);
  const replacementPeriodId = await findPeriodIdForDate(effectiveDate);
  const replacement = await prepareJournalEntry({
    date: effectiveDate,
    description: `Subscription correction: ${subscription.name}`,
    reference: `subscription-correction:${subscription.id}:${input.dueAt}`,
    notes: `Corrects subscription occurrence ${input.dueAt}. Reason: ${reason}`,
    txType: "subscription_correction",
    periodId: replacementPeriodId,
    categoryId: input.categoryId === undefined ? subscription.categoryId : input.categoryId,
    subscriptionId: subscription.id,
    lines: [
      { accountId: expenseAccount.id, debit: amount, credit: 0 },
      { accountId: paymentAccount!.id, debit: 0, credit: amount, cashFlowClass: paymentAccount!.liquidityClass === "cash_equivalent" ? "operating" : undefined },
    ],
  }, db);
  const result = db.transaction((tx) => {
    const current = tx.select().from(recurringOccurrences).where(eq(recurringOccurrences.id, occurrence.id)).limit(1).all()[0];
    if (!current || current.status !== "posted" || current.transactionId !== occurrence.transactionId) {
      throw new Error("Subscription occurrence changed; retry correction");
    }
    const reversalTransactionId = insertDomainReversalSync(tx, occurrence.transactionId!, reversal.prepared, reason);
    const replacementTransactionId = insertPreparedJournalEntrySync(tx, replacement);
    tx.update(recurringOccurrences).set({
      status: "corrected",
      transactionId: replacementTransactionId,
      lastError: `Corrected from transaction ${occurrence.transactionId}: ${reason}`,
      updatedAt: new Date(),
    }).where(eq(recurringOccurrences.id, occurrence.id)).run();
    tx.insert(auditLogs).values({
      entityType: "recurring_occurrence",
      entityId: occurrence.id,
      action: "correct",
      beforeSnapshot: Buffer.from(JSON.stringify(current)),
      afterSnapshot: Buffer.from(JSON.stringify({ ...current, status: "corrected", transactionId: replacementTransactionId, reversalTransactionId, reason })),
    }).run();
    return { reversalTransactionId, replacementTransactionId };
  });
  await invalidateOnTransactionMutation({
    transactionId: result.replacementTransactionId,
    affectedAccountIds: [...new Set([...reversal.prepared.accountIds, ...replacement.accountIds])],
    affectedPeriodIds: [reversal.originalPeriodId, reversal.periodId, replacementPeriodId].filter((id): id is number => id != null),
    revisionBumped: true,
  });
  return result;
}

/**
 * Withdraw a renewal that never charged anything (a lapsed plan, or a duplicate of an entry made by
 * hand): its journal is reversed on its own date and the occurrence counts as skipped, so the
 * subscription won't post it again. When a different charge did happen, correct it instead.
 */
export async function voidSubscriptionOccurrence(input: {
  subscriptionId: number;
  dueAt: number;
  reason: string;
}): Promise<{ reversalTransactionId: number }> {
  if (!Number.isSafeInteger(input.subscriptionId) || input.subscriptionId <= 0) throw new Error("Invalid subscriptionId");
  if (!Number.isSafeInteger(input.dueAt) || input.dueAt < 0) throw new Error("dueAt must be a valid timestamp");
  const reason = input.reason.trim();
  if (!reason || reason.length > 500) throw new Error("reason is required and must be at most 500 characters");
  const identity = and(
    eq(recurringOccurrences.jobType, "subscription"),
    eq(recurringOccurrences.scheduleId, input.subscriptionId),
    eq(recurringOccurrences.occurrenceDate, new Date(input.dueAt)),
  );
  const [occurrence] = await db.select().from(recurringOccurrences).where(identity).limit(1);
  // Renewals posted before occurrences were recorded carry only their "sub:<id>:<due>" reference.
  const [legacy] = occurrence ? [] : await db.select({ id: transactions.id }).from(transactions).where(and(
    eq(transactions.reference, `sub:${input.subscriptionId}:${input.dueAt}`),
    eq(transactions.txType, "subscription_renewal"),
    eq(transactions.status, "posted"),
  )).limit(1);
  const originalTransactionId = occurrence?.status === "posted" ? occurrence.transactionId : legacy?.id;
  if (!originalTransactionId) throw new Error("Only a posted subscription occurrence can be voided");
  const reversal = await prepareDomainReversal(originalTransactionId, reason, db, { atOriginalDate: true });
  const reversalTransactionId = db.transaction((tx) => {
    const current = tx.select().from(recurringOccurrences).where(identity).limit(1).all()[0];
    if (occurrence ? (!current || current.status !== "posted" || current.transactionId !== originalTransactionId) : current) {
      throw new Error("Subscription occurrence changed; retry voiding it");
    }
    const id = insertDomainReversalSync(tx, originalTransactionId, reversal.prepared, reason);
    const voided = { status: "skipped", transactionId: null, lastError: `Voided: ${reason} (transaction ${originalTransactionId} reversed by ${id})`, updatedAt: new Date() };
    const row = current
      ? tx.update(recurringOccurrences).set(voided).where(eq(recurringOccurrences.id, current.id)).returning().all()[0]
      : tx.insert(recurringOccurrences).values({ jobType: "subscription", scheduleId: input.subscriptionId, occurrenceDate: new Date(input.dueAt), ...voided }).returning().all()[0];
    tx.insert(auditLogs).values({
      entityType: "recurring_occurrence",
      entityId: row.id,
      action: "void",
      beforeSnapshot: current ? Buffer.from(JSON.stringify(current)) : null,
      afterSnapshot: Buffer.from(JSON.stringify({ ...row, reversedTransactionId: originalTransactionId, reversalTransactionId: id, reason })),
    }).run();
    return id;
  });
  await invalidateOnTransactionMutation({
    transactionId: reversalTransactionId,
    affectedAccountIds: reversal.prepared.accountIds,
    affectedPeriodIds: [reversal.originalPeriodId, reversal.periodId].filter((id): id is number => id != null),
    revisionBumped: true,
  });
  return { reversalTransactionId };
}

/**
 * Release a transaction linked to a renewal by mistake: the transaction keeps its journal and stops
 * paying the subscription, and the renewal counts as skipped. Renewals the subscription posted
 * itself are voided or corrected instead.
 */
export async function unlinkSubscriptionOccurrence(input: { subscriptionId: number; dueAt: number }): Promise<{ transactionId: number }> {
  const identity = and(
    eq(recurringOccurrences.jobType, "subscription"),
    eq(recurringOccurrences.scheduleId, input.subscriptionId),
    eq(recurringOccurrences.occurrenceDate, new Date(input.dueAt)),
  );
  const [occurrence] = await db.select().from(recurringOccurrences).where(identity).limit(1);
  if (!occurrence?.transactionId || occurrence.status !== "posted") throw new Error("Only a linked renewal can be unlinked");
  const [linked] = await db.select({ id: transactions.id, txType: transactions.txType }).from(transactions).where(eq(transactions.id, occurrence.transactionId)).limit(1);
  if (!linked || linked.txType === "subscription_renewal") throw new Error("This renewal was posted by the subscription; void or correct it instead");
  db.transaction((tx) => {
    const current = tx.select().from(recurringOccurrences).where(eq(recurringOccurrences.id, occurrence.id)).limit(1).all()[0];
    if (!current || current.status !== "posted" || current.transactionId !== linked.id) throw new Error("Subscription occurrence changed; reload and retry");
    tx.update(transactions).set({ subscriptionId: null }).where(eq(transactions.id, linked.id)).run();
    const row = tx.update(recurringOccurrences)
      .set({ status: "skipped", transactionId: null, lastError: `Unlinked from transaction ${linked.id}`, updatedAt: new Date() })
      .where(eq(recurringOccurrences.id, occurrence.id)).returning().all()[0];
    tx.insert(auditLogs).values({
      entityType: "recurring_occurrence",
      entityId: occurrence.id,
      action: "unlink",
      beforeSnapshot: Buffer.from(JSON.stringify(current)),
      afterSnapshot: Buffer.from(JSON.stringify(row)),
    }).run();
    bumpFinancialRevisionSync(tx);
  });
  await invalidateOnTransactionMutation({ transactionId: linked.id, affectedAccountIds: [], affectedPeriodIds: [], revisionBumped: true });
  return { transactionId: linked.id };
}

/** Words too common in subscription names to say two charges are the same service. */
const NAME_STOPWORDS = new Set(["com", "one", "the", "and", "for", "plus", "pro", "premium", "personal", "storage", "subscription", "monthly", "yearly", "annual", "plan", "gmail", "100gb", "200gb", "2tb"]);

function nameWords(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3 && !NAME_STOPWORDS.has(word));
}

export interface PastPaymentCandidate {
  transactionId: number;
  date: number;
  description: string;
  amount: number;
  accountName: string | null;
  /** Why it was suggested: its description names the service, or it costs exactly the price. */
  reason: "name" | "amount" | "both";
  /** The skipped renewal it would fill, when one fell within five weeks of it. */
  skippedDueAt: number | null;
}

/**
 * Expenses from the last 13 months that look like this subscription but pay no renewal: their
 * description names the service, or they cost exactly its price. Anything already linked, claimed
 * by a renewal, or part of a reimbursement claim is left out.
 */
export async function findPastPaymentCandidates(subscriptionId: number, now = Date.now()): Promise<PastPaymentCandidate[]> {
  const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1);
  if (!subscription) throw new Error("Subscription not found");
  const since = new Date(new Date(now).getFullYear(), new Date(now).getMonth() - 12, 1);
  const rows = await db.select({ id: transactions.id, date: transactions.date, description: transactions.description, txType: transactions.txType, categoryId: transactions.categoryId })
    .from(transactions)
    .where(and(eq(transactions.status, "posted"), isNull(transactions.subscriptionId), isNull(transactions.reversalOfTxId), gte(transactions.date, since)));
  const open = rows.filter((row) => !LINKABLE_EXCLUDED_TYPES.includes(row.txType ?? "") && !(row.txType ?? "").startsWith("reimbursement"));
  if (open.length === 0) return [];
  const ids = open.map((row) => row.id);
  const claimed = new Set((await db.select({ transactionId: recurringOccurrences.transactionId }).from(recurringOccurrences)
    .where(inArray(recurringOccurrences.transactionId, ids))).map((row) => row.transactionId));
  const reimbursed = new Set((await db.select({ id: reimbursementClaimSources.sourceTransactionId }).from(reimbursementClaimSources)
    .where(inArray(reimbursementClaimSources.sourceTransactionId, ids))).map((row) => row.id));
  const unclaimed = open.filter((row) => !claimed.has(row.id) && !reimbursed.has(row.id));
  const amounts = await journalAmounts(unclaimed.map((row) => row.id));
  const words = nameWords(subscription.name);
  // Renewals skipped with nothing charged can take a payment; voided ones were checked and stay empty.
  const skipped = (await db.select({ occurrenceDate: recurringOccurrences.occurrenceDate, lastError: recurringOccurrences.lastError }).from(recurringOccurrences).where(and(
    eq(recurringOccurrences.jobType, "subscription"),
    eq(recurringOccurrences.scheduleId, subscriptionId),
    eq(recurringOccurrences.status, "skipped"),
  ))).filter((row) => !row.lastError?.startsWith("Voided")).map((row) => ts(row.occurrenceDate));
  return unclaimed
    .map((row): PastPaymentCandidate | null => {
      const journal = amounts.get(row.id);
      const amount = journal?.amount ?? 0;
      const tokens = new Set(row.description.toLowerCase().split(/[^a-z0-9]+/));
      // A name match is a whole word of the subscription's name; a price match alone also needs its category.
      const named = words.some((word) => tokens.has(word));
      const priced = amount === subscription.amount && (subscription.categoryId == null || row.categoryId === subscription.categoryId);
      if ((!named && !priced) || !journal?.paymentAccountName) return null;
      const date = ts(row.date);
      // The nearest skipped renewal up to a week before or five weeks after it was paid.
      const slot = skipped
        .filter((dueAt) => date >= dueAt - 7 * DAY_MS && date <= dueAt + 35 * DAY_MS)
        .sort((a, b) => Math.abs(a - date) - Math.abs(b - date))[0] ?? null;
      return { transactionId: row.id, date, description: row.description, amount, accountName: journal.paymentAccountName, reason: named && priced ? "both" as const : named ? "name" as const : "amount" as const, skippedDueAt: slot };
    })
    .filter((item): item is PastPaymentCandidate => item != null)
    .sort((a, b) => b.date - a.date);
}

/**
 * Attach a payment already in the ledger to a subscription. With `dueAt`, it fills that skipped
 * renewal (the renewal becomes paid by it); without, it is tagged to the subscription as one of its
 * payments. The transaction's journal is not touched.
 */
export async function attachPastPayment(input: { subscriptionId: number; transactionId: number; dueAt?: number | null }): Promise<{ transactionId: number; filledDueAt: number | null }> {
  const [subscription] = await db.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.id, input.subscriptionId)).limit(1);
  if (!subscription) throw new Error("Subscription not found");
  const [row] = await db.select().from(transactions).where(eq(transactions.id, input.transactionId)).limit(1);
  if (!row || row.status !== "posted" || row.reversalOfTxId != null || LINKABLE_EXCLUDED_TYPES.includes(row.txType ?? "")) {
    throw new Error("Only a posted expense can be attached");
  }
  if (row.subscriptionId != null) throw new Error("That transaction already belongs to a subscription");
  const [claimed] = await db.select({ id: recurringOccurrences.id }).from(recurringOccurrences).where(eq(recurringOccurrences.transactionId, row.id)).limit(1);
  if (claimed) throw new Error("That transaction already pays a renewal");
  const [reimbursed] = await db.select({ id: reimbursementClaimSources.id }).from(reimbursementClaimSources).where(eq(reimbursementClaimSources.sourceTransactionId, row.id)).limit(1);
  if (reimbursed) throw new Error("That transaction is part of a reimbursement claim");

  const filledDueAt = input.dueAt ?? null;
  const occurrence = filledDueAt == null ? null : (await db.select().from(recurringOccurrences).where(and(
    eq(recurringOccurrences.jobType, "subscription"),
    eq(recurringOccurrences.scheduleId, input.subscriptionId),
    eq(recurringOccurrences.occurrenceDate, new Date(filledDueAt)),
  )).limit(1))[0];
  if (filledDueAt != null && occurrence?.status !== "skipped") throw new Error("Only a skipped renewal can be filled by a past payment");

  db.transaction((tx) => {
    const current = tx.select({ subscriptionId: transactions.subscriptionId, status: transactions.status }).from(transactions).where(eq(transactions.id, row.id)).limit(1).all()[0];
    if (!current || current.status !== "posted" || current.subscriptionId != null) throw new Error("That transaction changed; reload and retry");
    tx.update(transactions).set({ subscriptionId: input.subscriptionId }).where(eq(transactions.id, row.id)).run();
    if (occurrence) {
      const now = tx.select().from(recurringOccurrences).where(eq(recurringOccurrences.id, occurrence.id)).limit(1).all()[0];
      if (!now || now.status !== "skipped") throw new Error("That renewal changed; reload and retry");
      const after = tx.update(recurringOccurrences)
        .set({ status: "posted", transactionId: row.id, lastError: `Paid by existing transaction ${row.id} (was skipped)`, updatedAt: new Date() })
        .where(eq(recurringOccurrences.id, occurrence.id)).returning().all()[0];
      tx.insert(auditLogs).values({
        entityType: "recurring_occurrence",
        entityId: occurrence.id,
        action: "link",
        beforeSnapshot: Buffer.from(JSON.stringify(now)),
        afterSnapshot: Buffer.from(JSON.stringify(after)),
      }).run();
    } else {
      tx.insert(auditLogs).values({
        entityType: "transaction",
        entityId: row.id,
        action: "update",
        beforeSnapshot: Buffer.from(JSON.stringify({ subscriptionId: null })),
        afterSnapshot: Buffer.from(JSON.stringify({ subscriptionId: input.subscriptionId, reason: "Attached as a past subscription payment" })),
      }).run();
    }
    bumpFinancialRevisionSync(tx);
  });
  await invalidateOnTransactionMutation({ transactionId: row.id, affectedAccountIds: [], affectedPeriodIds: [], revisionBumped: true });
  return { transactionId: row.id, filledDueAt };
}

/**
 * Undo `attachPastPayment` for a payment tagged without a renewal: the transaction stops belonging
 * to the subscription. One that pays a renewal is unlinked through that renewal instead.
 */
export async function detachPastPayment(input: { subscriptionId: number; transactionId: number }): Promise<{ transactionId: number }> {
  const [row] = await db.select({ id: transactions.id, subscriptionId: transactions.subscriptionId, txType: transactions.txType }).from(transactions).where(eq(transactions.id, input.transactionId)).limit(1);
  if (!row || row.subscriptionId !== input.subscriptionId) throw new Error("That transaction isn't attached to this subscription");
  if (row.txType === "subscription_renewal" || row.txType === "subscription_correction") throw new Error("Renewals the subscription posted are voided or corrected instead");
  const [claimed] = await db.select({ id: recurringOccurrences.id }).from(recurringOccurrences).where(eq(recurringOccurrences.transactionId, row.id)).limit(1);
  if (claimed) throw new Error("It pays a renewal; unlink it from that renewal instead");
  db.transaction((tx) => {
    tx.update(transactions).set({ subscriptionId: null }).where(eq(transactions.id, row.id)).run();
    tx.insert(auditLogs).values({
      entityType: "transaction",
      entityId: row.id,
      action: "update",
      beforeSnapshot: Buffer.from(JSON.stringify({ subscriptionId: input.subscriptionId })),
      afterSnapshot: Buffer.from(JSON.stringify({ subscriptionId: null, reason: "Detached from the subscription" })),
    }).run();
    bumpFinancialRevisionSync(tx);
  });
  await invalidateOnTransactionMutation({ transactionId: row.id, affectedAccountIds: [], affectedPeriodIds: [], revisionBumped: true });
  return { transactionId: row.id };
}
