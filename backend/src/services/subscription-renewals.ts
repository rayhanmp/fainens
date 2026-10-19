import { and, eq, inArray } from "drizzle-orm";

import { invalidateOnTransactionMutation } from "../cache";
import { db } from "../db/client";
import {
  accounts,
  auditLogs,
  recurringOccurrences,
  subscriptions,
  transactionLines,
  transactions,
} from "../db/schema";
import { getOrCreateAutoExpenseAccount, insertPreparedJournalEntrySync, prepareJournalEntry, type PreparedJournalEntry } from "./ledger";
import { findPeriodIdForDate } from "./transaction-mutations";
import { addMonthsOnDay } from "../lib/calendar";
import { bumpFinancialRevisionSync } from "./financial-revision";
import { insertDomainReversalSync, prepareDomainReversal } from "./domain-reversal";

export { addOneMonth, addOneYear } from "./recurrence-calendar";

const MAX_CATCH_UP_OCCURRENCES = 120;

function ts(value: Date | number): number {
  return value instanceof Date ? value.getTime() : Number(value);
}

/** The renewal after `dueAt`, back on the subscription's billing day after any shorter month. */
export function nextOccurrence(dueAt: number, billingCycle: string, billingDay?: number | null): number {
  return addMonthsOnDay(dueAt, billingCycle === "annual" ? 12 : 1, billingDay ?? new Date(dueAt).getDate());
}

export interface SubscriptionOccurrencePreview {
  subscriptionId: number;
  subscriptionName: string;
  dueAt: number;
  amount: number;
  linkedAccountId: number;
  billingCycle: string;
}

export async function previewDueSubscriptionRenewals(now = Date.now()): Promise<{
  occurrences: SubscriptionOccurrencePreview[];
  truncated: boolean;
}> {
  const active = await db.select().from(subscriptions).where(eq(subscriptions.status, "active"));
  const occurrences: SubscriptionOccurrencePreview[] = [];
  let truncated = false;
  for (const subscription of active) {
    let dueAt = ts(subscription.nextRenewalAt);
    while (dueAt <= now && occurrences.length < MAX_CATCH_UP_OCCURRENCES) {
      occurrences.push({
        subscriptionId: subscription.id,
        subscriptionName: subscription.name,
        dueAt,
        amount: subscription.amount,
        linkedAccountId: subscription.linkedAccountId,
        billingCycle: subscription.billingCycle,
      });
      dueAt = nextOccurrence(dueAt, subscription.billingCycle, subscription.billingDay);
    }
    if (dueAt <= now) truncated = true;
  }
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

export async function applySubscriptionOccurrences(input: {
  mode: "post" | "skip";
  occurrences: Array<{ subscriptionId: number; dueAt: number }>;
}): Promise<{ posted: number; skipped: number; transactionIds: number[] }> {
  if (!Array.isArray(input.occurrences) || input.occurrences.length === 0) {
    throw new Error("At least one occurrence is required");
  }
  if (input.occurrences.length > MAX_CATCH_UP_OCCURRENCES) {
    throw new Error(`At most ${MAX_CATCH_UP_OCCURRENCES} occurrences may be confirmed at once`);
  }
  const identities = input.occurrences.map((item) => `${item.subscriptionId}:${item.dueAt}`);
  if (
    new Set(identities).size !== identities.length ||
    input.occurrences.some((item) =>
      !Number.isInteger(item.subscriptionId) || item.subscriptionId <= 0 ||
      !Number.isSafeInteger(item.dueAt) || item.dueAt < 0 || item.dueAt > Date.now()
    )
  ) throw new Error("Occurrence identities must be unique, historical, and valid");

  const subscriptionIds = [...new Set(input.occurrences.map((item) => item.subscriptionId))];
  const subscriptionRows = await db.select().from(subscriptions).where(inArray(subscriptions.id, subscriptionIds));
  if (subscriptionRows.length !== subscriptionIds.length) throw new Error("Subscription not found");
  const accountIds = [...new Set(subscriptionRows.map((row) => row.linkedAccountId))];
  const accountRows = await db
    .select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive, liquidityClass: accounts.liquidityClass })
    .from(accounts)
    .where(inArray(accounts.id, accountIds));
  const invalidAccount = accountRows.find(
    (account) => !account.isActive || !["asset", "liability"].includes(account.type),
  );
  if (accountRows.length !== accountIds.length || invalidAccount) {
    throw new Error("Every renewal requires an active asset or liability account");
  }
  if (subscriptionRows.some((row) => row.status !== "active" || !Number.isSafeInteger(row.amount) || row.amount <= 0)) {
    throw new Error("Every renewal requires an active subscription with a positive integer-rupiah amount");
  }

  const expenseAccount = input.mode === "post" ? await getOrCreateAutoExpenseAccount(db) : null;
  // Prepared through the canonical journal path: validates lines, writes category allocations and
  // refuses closed periods (rechecked inside the write below).
  const preparedByIdentity = new Map<string, PreparedJournalEntry>();
  if (input.mode === "post") {
    for (const occurrence of input.occurrences) {
      const subscription = subscriptionRows.find((row) => row.id === occurrence.subscriptionId)!;
      const paymentAccount = accountRows.find((account) => account.id === subscription.linkedAccountId)!;
      preparedByIdentity.set(`${occurrence.subscriptionId}:${occurrence.dueAt}`, await prepareJournalEntry({
        date: occurrence.dueAt,
        description: `Subscription: ${subscription.name}`,
        notes: `Confirmed renewal · subscription #${subscription.id} · ${subscription.billingCycle}`,
        reference: `subscription:${subscription.id}:${occurrence.dueAt}`,
        txType: "subscription_renewal",
        periodId: null,
        categoryId: subscription.categoryId,
        subscriptionId: subscription.id,
        lines: [
          { accountId: expenseAccount!.id, debit: subscription.amount, credit: 0 },
          { accountId: paymentAccount.id, debit: 0, credit: subscription.amount, cashFlowClass: paymentAccount.liquidityClass === "cash_equivalent" ? "operating" : undefined },
        ],
      }, db));
    }
  }

  let result: { posted: number; skipped: number; transactionIds: number[]; periodIds: number[] };
  try {
    result = db.transaction((tx) => {
      const transactionIds: number[] = [];
      const periodIds: number[] = [];
      for (const subscriptionId of subscriptionIds) {
        const subscription = tx.select().from(subscriptions)
          .where(eq(subscriptions.id, subscriptionId)).limit(1).all()[0];
        if (!subscription || subscription.status !== "active") {
          throw new Error(`Subscription ${subscriptionId} is not active`);
        }
        const selected = input.occurrences
          .filter((item) => item.subscriptionId === subscriptionId)
          .sort((a, b) => a.dueAt - b.dueAt);
        let expectedDueAt = ts(subscription.nextRenewalAt);
        for (const occurrence of selected) {
          if (occurrence.dueAt !== expectedDueAt) {
            throw new Error(`Occurrence ${subscriptionId}:${occurrence.dueAt} is stale or leaves a gap`);
          }
          const claimed = tx.insert(recurringOccurrences).values({
            jobType: "subscription",
            scheduleId: subscriptionId,
            occurrenceDate: new Date(occurrence.dueAt),
            status: input.mode === "post" ? "pending" : "skipped",
          }).returning({ id: recurringOccurrences.id }).all()[0];
          if (!claimed) throw new Error("Failed to claim recurring occurrence");

          if (input.mode === "post") {
            const prepared = preparedByIdentity.get(`${subscriptionId}:${occurrence.dueAt}`)!;
            if (subscription.amount !== subscriptionRows.find((row) => row.id === subscriptionId)!.amount) {
              throw new Error(`Subscription ${subscriptionId} changed; retry`);
            }
            const transactionId = insertPreparedJournalEntrySync(tx, prepared);
            tx.update(recurringOccurrences)
              .set({ status: "posted", transactionId, updatedAt: new Date() })
              .where(eq(recurringOccurrences.id, claimed.id)).run();
            transactionIds.push(transactionId);
            if (prepared.periodId != null) periodIds.push(prepared.periodId);
          }
          expectedDueAt = nextOccurrence(expectedDueAt, subscription.billingCycle, subscription.billingDay);
        }
        tx.update(subscriptions)
          .set({ nextRenewalAt: new Date(expectedDueAt), updatedAt: new Date() })
          .where(and(
            eq(subscriptions.id, subscription.id),
            eq(subscriptions.nextRenewalAt, subscription.nextRenewalAt),
        )).run();
      }
      bumpFinancialRevisionSync(tx);
      return {
        posted: input.mode === "post" ? input.occurrences.length : 0,
        skipped: input.mode === "skip" ? input.occurrences.length : 0,
        transactionIds,
        periodIds: [...new Set(periodIds)],
      };
    });
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
      throw new Error("One or more occurrences were already processed");
    }
    throw error;
  }

  if (result.transactionIds.length > 0 || result.skipped > 0) {
    await invalidateOnTransactionMutation({
      transactionId: result.transactionIds[0] ?? subscriptionIds[0],
      affectedAccountIds: [expenseAccount?.id, ...accountIds].filter((id): id is number => id != null),
      affectedPeriodIds: result.periodIds,
      revisionBumped: true,
    });
  }
  return { posted: result.posted, skipped: result.skipped, transactionIds: result.transactionIds };
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
  const [paymentAccount] = await db.select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive, liquidityClass: accounts.liquidityClass })
    .from(accounts).where(eq(accounts.id, linkedAccountId)).limit(1);
  if (!paymentAccount || !paymentAccount.isActive || !["asset", "liability"].includes(paymentAccount.type)) {
    throw new Error("Replacement payment account must be an active asset or liability account");
  }
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
      { accountId: paymentAccount.id, debit: 0, credit: amount, cashFlowClass: paymentAccount.liquidityClass === "cash_equivalent" ? "operating" : undefined },
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
