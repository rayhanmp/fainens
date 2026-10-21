import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";

import { db as defaultDb } from "../db/client";
import { accounts, goalAllocations, goalParts, savingsGoals, transactionLines, transactions } from "../db/schema";
import { setAsideByGoal } from "./goals";
import { daysBetween, startOfDay, tripReminders, type TripReminder } from "./goal-trips";

/**
 * What goals need from you soon, for the Dashboard's bell, beyond what the Goals overview already
 * shows: a holiday's bookings, passports, visas and packing; an emergency fund to refill after money
 * came out of it; parts of a goal due soon, like a wedding vendor's deposit or a school fee (a month
 * ahead when the goal holds less than it); and a THR that came in but went into no Lebaran goal.
 */

const DAY = 86_400_000;
export const PART_DUE_DAYS = 14;
export const PART_SHORT_DAYS = 30;
export const REFILL_DAYS = 90;
export const THR_DAYS = 30;

export type GoalReminder = Omit<TripReminder, "kind"> & {
  kind: TripReminder["kind"] | "refill" | "part-due" | "thr";
  /** The money it's about: what a part costs, what's missing from the fund, or the THR. */
  amount: number | null;
  /** A part due while the goal holds less than it. */
  short: boolean;
};

/** Parts not paid yet that fall due soon, or a month ahead when the goal can't cover them. */
export function partReminders(goal: { id: number; name: string; holds: number }, parts: ReadonlyArray<{ name: string; amount: number; dueAt: number | null; paidAt: number | null }>, now: number): GoalReminder[] {
  return parts
    .filter((part) => part.paidAt === null && part.dueAt !== null)
    .flatMap((part) => {
      const days = daysBetween(now, part.dueAt!);
      const short = goal.holds < part.amount;
      if (days < -30 || days > (short ? PART_SHORT_DAYS : PART_DUE_DAYS)) return [];
      return [{ kind: "part-due" as const, goalId: goal.id, goalName: goal.name, at: part.dueAt!, name: part.name, count: 1, amount: part.amount, short }];
    });
}

export async function goalReminders(now = Date.now(), dbLike: any = defaultDb): Promise<GoalReminder[]> {
  const out: GoalReminder[] = (await tripReminders(now, dbLike)).map((item) => ({ ...item, amount: null, short: false }));
  const goals = (await dbLike.select().from(savingsGoals).where(eq(savingsGoals.status, "active"))) as Array<typeof savingsGoals.$inferSelect>;
  if (!goals.length) return out;
  const held = await setAsideByGoal(dbLike);
  const ids = goals.map((goal) => goal.id);

  const parts = await dbLike.select().from(goalParts).where(and(inArray(goalParts.goalId, ids), isNull(goalParts.paidAt)));
  for (const goal of goals) {
    const own = parts.filter((part: typeof goalParts.$inferSelect) => part.goalId === goal.id)
      .map((part: typeof goalParts.$inferSelect) => ({ name: part.name, amount: part.amount, dueAt: part.dueAt ? part.dueAt.getTime() : null, paidAt: null }));
    out.push(...partReminders({ id: goal.id, name: goal.name, holds: held.get(goal.id) ?? 0 }, own, now));
  }

  // An emergency fund that money came out of lately, and that hasn't been filled back up.
  for (const goal of goals.filter((item) => item.goalType === "emergency")) {
    const holds = held.get(goal.id) ?? 0;
    if (holds >= goal.targetAmount) continue;
    const [taken] = await dbLike.select().from(goalAllocations)
      .where(and(eq(goalAllocations.goalId, goal.id), eq(goalAllocations.kind, "release"), gte(goalAllocations.createdAt, new Date(now - REFILL_DAYS * DAY))))
      .orderBy(sql`${goalAllocations.createdAt} desc`).limit(1);
    if (taken) out.push({ kind: "refill", goalId: goal.id, goalName: goal.name, at: taken.createdAt.getTime(), name: taken.note ?? null, count: 1, amount: goal.targetAmount - holds, short: false });
  }

  // A THR posted lately that no Lebaran goal got anything from since.
  const lebaran = goals.filter((item) => item.goalType === "lebaran");
  if (lebaran.length) {
    const thr = await dbLike
      .select({ id: transactions.id, date: transactions.date, amount: sql<number>`sum(${transactionLines.credit})` })
      .from(transactions)
      .innerJoin(transactionLines, eq(transactionLines.transactionId, transactions.id))
      .innerJoin(accounts, eq(accounts.id, transactionLines.accountId))
      .where(and(eq(transactions.status, "posted"), eq(accounts.type, "revenue"), gte(transactions.date, new Date(startOfDay(now) - THR_DAYS * DAY)), sql`upper(${transactions.description}) like '%THR%'`))
      .groupBy(transactions.id)
      .orderBy(sql`${transactions.date} desc`)
      .limit(1);
    const latest = thr[0] as { id: number; date: Date; amount: number } | undefined;
    if (latest && Number(latest.amount) > 0) {
      for (const goal of lebaran) {
        const [putIn] = await dbLike.select({ id: goalAllocations.id }).from(goalAllocations)
          .where(and(eq(goalAllocations.goalId, goal.id), eq(goalAllocations.kind, "assign"), gte(goalAllocations.createdAt, latest.date))).limit(1);
        if (!putIn) out.push({ kind: "thr", goalId: goal.id, goalName: goal.name, at: latest.date.getTime(), name: null, count: 1, amount: Number(latest.amount), short: false });
      }
    }
  }
  return out;
}
