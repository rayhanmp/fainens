import { and, asc, eq, gte, inArray, isNull, sql } from "drizzle-orm";

import { db as defaultDb } from "../db/client";
import { accounts, goalAllocations, goalSettings, savingsGoals, wishlist } from "../db/schema";
import { computeAccountBalance } from "./ledger";

/**
 * Money set aside for goals. What you can set aside is the balance of your active cash, bank,
 * e-wallet and investment accounts (minus any you leave out); each goal holds the sum of its
 * allocations, like its own pot inside the app; the rest is unassigned. No money moves between accounts.
 */

export type GoalKind = "spend" | "keep";
export type GoalStatus = "active" | "done" | "archived";

function parseIds(value: unknown): number[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? [...new Set(parsed.filter((id): id is number => Number.isSafeInteger(id) && id > 0))] : [];
  } catch {
    return [];
  }
}

export async function excludedAccountIds(dbLike: any = defaultDb): Promise<number[]> {
  const [row] = await dbLike.select().from(goalSettings).where(eq(goalSettings.id, 1)).limit(1);
  return parseIds(row?.excludedAccountIds);
}

export async function setExcludedAccountIds(ids: number[], dbLike: any = defaultDb): Promise<void> {
  const value = JSON.stringify([...new Set(ids)]);
  await dbLike.insert(goalSettings).values({ id: 1, excludedAccountIds: value })
    .onConflictDoUpdate({ target: goalSettings.id, set: { excludedAccountIds: value } });
}

/** Each goal's set-aside money: the sum of its allocations. */
export async function setAsideByGoal(dbLike: any = defaultDb): Promise<Map<number, number>> {
  const rows = await dbLike
    .select({ goalId: goalAllocations.goalId, total: sql<number>`coalesce(sum(${goalAllocations.amount}), 0)` })
    .from(goalAllocations)
    .groupBy(goalAllocations.goalId);
  return new Map(rows.map((row: { goalId: number; total: number }) => [row.goalId, Number(row.total)]));
}

/** What each goal has been given this calendar month, so its monthly amount isn't set aside twice. */
export async function setAsideThisMonth(dbLike: any = defaultDb, now = new Date()): Promise<Map<number, number>> {
  const since = new Date(now.getFullYear(), now.getMonth(), 1);
  const rows = await dbLike
    .select({ goalId: goalAllocations.goalId, total: sql<number>`coalesce(sum(${goalAllocations.amount}), 0)` })
    .from(goalAllocations)
    .where(and(eq(goalAllocations.kind, "assign"), gte(goalAllocations.createdAt, since)))
    .groupBy(goalAllocations.goalId);
  return new Map(rows.map((row: { goalId: number; total: number }) => [row.goalId, Number(row.total)]));
}

/** Active, user-facing cash and investment accounts with their balances, and whether they count. */
export async function liquidAccounts(dbLike: any = defaultDb) {
  const rows = await dbLike
    .select({ id: accounts.id, name: accounts.name, liquidityClass: accounts.liquidityClass })
    .from(accounts)
    .where(and(eq(accounts.type, "asset"), eq(accounts.isActive, true), isNull(accounts.systemKey), inArray(accounts.liquidityClass, ["cash_equivalent", "investment"])))
    .orderBy(asc(accounts.sortOrder), asc(accounts.id));
  const excluded = new Set(await excludedAccountIds(dbLike));
  return Promise.all(rows.map(async (row: { id: number; name: string; liquidityClass: string }) => ({
    id: row.id,
    name: row.name,
    liquidityClass: row.liquidityClass,
    balance: await computeAccountBalance(row.id, dbLike),
    included: !excluded.has(row.id),
  })));
}

export type GoalView = {
  id: number;
  name: string;
  targetAmount: number;
  byDate: number | null;
  kind: GoalKind;
  monthlyAmount: number;
  status: GoalStatus;
  wishlistId: number | null;
  spentTransactionId: number | null;
  doneAt: number | null;
  sortOrder: number;
  setAside: number;
  /** Set aside this calendar month; counts toward the monthly amount. */
  setAsideThisMonth: number;
};

const time = (value: unknown) => (value instanceof Date ? value.getTime() : value == null ? null : Number(value));

export function goalView(row: typeof savingsGoals.$inferSelect, setAside: number, thisMonth = 0): GoalView {
  return {
    id: row.id,
    name: row.name,
    targetAmount: row.targetAmount,
    byDate: time(row.byDate),
    kind: row.kind === "keep" ? "keep" : "spend",
    monthlyAmount: row.monthlyAmount,
    status: row.status === "done" || row.status === "archived" ? row.status : "active",
    wishlistId: row.wishlistId ?? null,
    spentTransactionId: row.spentTransactionId ?? null,
    doneAt: time(row.doneAt),
    sortOrder: row.sortOrder,
    setAside,
    setAsideThisMonth: thisMonth,
  };
}

/** Everything the Goals page shows: what you can set aside, what's set aside where, and what's left. */
export async function goalsOverview(dbLike: any = defaultDb) {
  const [accountRows, goalRows, held, thisMonth] = await Promise.all([
    liquidAccounts(dbLike),
    dbLike.select().from(savingsGoals).orderBy(asc(savingsGoals.sortOrder), asc(savingsGoals.id)),
    setAsideByGoal(dbLike),
    setAsideThisMonth(dbLike),
  ]);
  const goals = (goalRows as Array<typeof savingsGoals.$inferSelect>).map((row) => goalView(row, held.get(row.id) ?? 0, thisMonth.get(row.id) ?? 0));
  const available = accountRows.filter((account) => account.included).reduce((sum, account) => sum + account.balance, 0);
  const setAside = goals.filter((goal) => goal.status === "active").reduce((sum, goal) => sum + goal.setAside, 0);
  return { available, setAside, unassigned: available - setAside, accounts: accountRows, goals };
}

export class GoalError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
  }
}

/**
 * Moves money onto (positive) or off (negative) a goal. Setting aside needs that much unassigned;
 * releasing can't take more than the goal holds.
 */
export async function allocate(goalId: number, amount: number, note: string | null, dbLike: any = defaultDb) {
  if (!Number.isSafeInteger(amount) || amount === 0) throw new GoalError("Enter an amount");
  const [goal] = await dbLike.select().from(savingsGoals).where(eq(savingsGoals.id, goalId)).limit(1);
  if (!goal) throw new GoalError("Goal not found", 404);
  if (goal.status !== "active") throw new GoalError("Only an active goal can hold money", 409);
  const overview = await goalsOverview(dbLike);
  const holds = overview.goals.find((item) => item.id === goalId)?.setAside ?? 0;
  if (amount > 0 && amount > overview.unassigned) throw new GoalError(`Only ${Math.max(0, overview.unassigned)} is unassigned`, 409);
  if (amount < 0 && -amount > holds) throw new GoalError("A goal can't release more than it holds", 409);
  const [created] = await dbLike.insert(goalAllocations).values({ goalId, amount, kind: amount > 0 ? "assign" : "release", note }).returning();
  return created;
}

/**
 * Marks a goal bought or finished. Its money is released with a `spend` entry (for a spend goal
 * the purchase took it); a linked wishlist item is fulfilled with the same transaction.
 */
export async function completeGoal(goalId: number, transactionId: number | null, dbLike: any = defaultDb) {
  const [goal] = await dbLike.select().from(savingsGoals).where(eq(savingsGoals.id, goalId)).limit(1);
  if (!goal) throw new GoalError("Goal not found", 404);
  if (goal.status === "done") throw new GoalError("This goal is already done", 409);
  const holds = (await setAsideByGoal(dbLike)).get(goalId) ?? 0;
  const now = new Date();
  if (holds !== 0) {
    await dbLike.insert(goalAllocations).values({ goalId, amount: -holds, kind: "spend", transactionId, note: transactionId ? "Bought" : "Done" });
  }
  await dbLike.update(savingsGoals).set({ status: "done", doneAt: now, spentTransactionId: transactionId, updatedAt: now }).where(eq(savingsGoals.id, goalId));
  if (goal.wishlistId && transactionId) {
    await dbLike.update(wishlist).set({ status: "fulfilled", fulfilledAt: now, fulfilledTransactionId: transactionId, updatedAt: now })
      .where(and(eq(wishlist.id, goal.wishlistId), eq(wishlist.status, "active")));
  }
}

/** When a wishlist item is bought, the goal saving for it is done too, with the same purchase. */
export async function completeGoalsForWishlist(wishlistId: number, transactionId: number | null, dbLike: any = defaultDb) {
  const rows = await dbLike.select({ id: savingsGoals.id }).from(savingsGoals)
    .where(and(eq(savingsGoals.wishlistId, wishlistId), eq(savingsGoals.status, "active")));
  for (const row of rows) await completeGoal(row.id, transactionId, dbLike);
}

/**
 * Sets aside each active goal's planned monthly amount, less what it was already given this month,
 * as far as the unassigned money goes and no further than its target. Dated goals first, soonest first.
 */
export async function fundMonthly(goalIds: number[] | null, dbLike: any = defaultDb) {
  const overview = await goalsOverview(dbLike);
  let left = Math.max(0, overview.unassigned);
  const due = overview.goals
    .filter((goal) => goal.status === "active" && goal.monthlyAmount > 0 && (!goalIds || goalIds.includes(goal.id)))
    .sort((a, b) => (a.byDate ?? Infinity) - (b.byDate ?? Infinity) || a.sortOrder - b.sortOrder);
  const assigned: Array<{ goalId: number; amount: number }> = [];
  for (const goal of due) {
    const amount = Math.min(goal.monthlyAmount - goal.setAsideThisMonth, goal.targetAmount - goal.setAside, left);
    if (amount <= 0) continue;
    await dbLike.insert(goalAllocations).values({ goalId: goal.id, amount, kind: "assign", note: "Monthly amount" });
    assigned.push({ goalId: goal.id, amount });
    left -= amount;
  }
  return { assigned, total: assigned.reduce((sum, item) => sum + item.amount, 0) };
}
