import { and, eq, lte, gte } from "drizzle-orm";

import { db as defaultDb } from "../db/client";
import { subscriptions, salaryPeriods } from "../db/schema";
import { createSubscriptionRenewalExpense } from "./ledger";

export type RenewalResult = {
  processed: number;
  skippedNoAccount: number;
  errors: string[];
};

function ts(v: Date | number): number {
  return v instanceof Date ? v.getTime() : Number(v);
}

/** Add one calendar month to a timestamp (local date components). */
export function addOneMonth(ms: number): number {
  const d = new Date(ms);
  d.setMonth(d.getMonth() + 1);
  return d.getTime();
}

/** Add one calendar year to a timestamp (local date components). */
export function addOneYear(ms: number): number {
  const d = new Date(ms);
  d.setFullYear(d.getFullYear() + 1);
  return d.getTime();
}

export async function findSalaryPeriodIdForDate(
  txDateMs: number,
  dbLike: typeof defaultDb = defaultDb,
): Promise<number | null> {
  const rows = await dbLike
    .select({ id: salaryPeriods.id })
    .from(salaryPeriods)
    .where(and(lte(salaryPeriods.startDate, txDateMs), gte(salaryPeriods.endDate, txDateMs)))
    .limit(1);

  return rows[0]?.id ?? null;
}

/**
 * For each active subscription whose next renewal is due (<= now), post an expense transaction
 * and advance nextRenewalAt by billing cycle period. Repeats until caught up or error.
 */
export async function processDueSubscriptionRenewals(dbLike: typeof defaultDb = defaultDb): Promise<RenewalResult> {
  const now = Date.now();
  const errors: string[] = [];
  let processed = 0;
  let skippedNoAccount = 0;

  const activeRows = await dbLike.select().from(subscriptions).where(eq(subscriptions.status, "active"));

  for (const sub of activeRows) {
    let current = sub;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (current.status !== "active") break;
      const dueMs = ts(current.nextRenewalAt as Date | number);
      if (dueMs > now) break;

      const amt = current.amount;
      if (!Number.isInteger(amt) || amt <= 0) {
        errors.push(`Subscription #${current.id}: invalid amount`);
        break;
      }

      try {
        const periodId = await findSalaryPeriodIdForDate(dueMs, dbLike);

        await createSubscriptionRenewalExpense(
          {
            amountCents: amt,
            description: `Subscription: ${current.name}`,
            notes: `Auto-renewal · subscription #${current.id} · ${current.billingCycle}`,
            date: dueMs,
            periodId,
            categoryId: current.categoryId ?? null,
            payingAccountId: current.linkedAccountId,
            reference: `sub:${current.id}:${dueMs}`,
          },
          dbLike,
        );

        // Advance by billing cycle
        const nextMs = current.billingCycle === "annual" ? addOneYear(dueMs) : addOneMonth(dueMs);

        await dbLike
          .update(subscriptions)
          .set({
            nextRenewalAt: new Date(nextMs),
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.id, current.id));

        processed++;

        const [updated] = await dbLike.select().from(subscriptions).where(eq(subscriptions.id, current.id)).limit(1);
        if (!updated) break;
        current = updated;
      } catch (e) {
        errors.push(`${current.name}: ${(e as Error).message}`);
        break;
      }
    }
  }

  return { processed, skippedNoAccount, errors };
}
