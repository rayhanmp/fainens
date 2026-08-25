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
import { getOrCreateAutoExpenseAccount } from "./ledger";
import { findPeriodIdForDate } from "./transaction-mutations";
import { addOneMonth, addOneYear } from "./recurrence-calendar";
import { bumpFinancialRevisionSync } from "./financial-revision";

export { addOneMonth, addOneYear } from "./recurrence-calendar";

const MAX_CATCH_UP_OCCURRENCES = 120;

function ts(value: Date | number): number {
  return value instanceof Date ? value.getTime() : Number(value);
}

function nextOccurrence(dueAt: number, billingCycle: string): number {
  return billingCycle === "annual" ? addOneYear(dueAt) : addOneMonth(dueAt);
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
      dueAt = nextOccurrence(dueAt, subscription.billingCycle);
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
    .select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive })
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
  const periodByIdentity = new Map<string, number | null>();
  if (input.mode === "post") {
    await Promise.all(input.occurrences.map(async (occurrence) => {
      periodByIdentity.set(
        `${occurrence.subscriptionId}:${occurrence.dueAt}`,
        await findPeriodIdForDate(occurrence.dueAt),
      );
    }));
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
            const paymentAccount = accountRows.find((account) => account.id === subscription.linkedAccountId)!;
            const periodId = periodByIdentity.get(`${subscriptionId}:${occurrence.dueAt}`) ?? null;
            const transaction = tx.insert(transactions).values({
              date: new Date(occurrence.dueAt),
              description: `Subscription: ${subscription.name}`,
              notes: `Confirmed renewal · subscription #${subscription.id} · ${subscription.billingCycle}`,
              reference: `subscription:${subscription.id}:${occurrence.dueAt}`,
              txType: "subscription_renewal",
              periodId,
              categoryId: subscription.categoryId,
              subscriptionId: subscription.id,
            }).returning({ id: transactions.id }).all()[0];
            if (!transaction) throw new Error("Failed to post subscription renewal");
            const lines = [
              { transactionId: transaction.id, accountId: expenseAccount!.id, debit: subscription.amount, credit: 0 },
              { transactionId: transaction.id, accountId: paymentAccount.id, debit: 0, credit: subscription.amount },
            ];
            tx.insert(transactionLines).values(lines).run();
            tx.update(recurringOccurrences)
              .set({ status: "posted", transactionId: transaction.id, updatedAt: new Date() })
              .where(eq(recurringOccurrences.id, claimed.id)).run();
            tx.insert(auditLogs).values({
              entityType: "transaction",
              entityId: transaction.id,
              action: "create",
              afterSnapshot: Buffer.from(JSON.stringify({ occurrenceId: claimed.id, transaction, lines })),
            }).run();
            transactionIds.push(transaction.id);
            if (periodId != null) periodIds.push(periodId);
          }
          expectedDueAt = nextOccurrence(expectedDueAt, subscription.billingCycle);
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
