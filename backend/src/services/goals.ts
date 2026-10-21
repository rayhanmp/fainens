import { and, asc, eq, gt, gte, inArray, isNull, sql } from "drizzle-orm";

import { db as defaultDb } from "../db/client";
import { accounts, goalAllocations, goalAttachments, goalParts, goalSettings, savingsGoals, transactionCategoryAllocations, transactions, wishlist } from "../db/schema";
import { monthsToReach } from "./goal-progress";
import { computeAccountBalance } from "./ledger";
import { previewSalaryPosting } from "./salary-posting";

/**
 * Money set aside for goals. What you can set aside is the balance of your active cash, bank,
 * e-wallet and investment accounts (minus any you leave out); each goal holds the sum of its
 * allocations, like its own pot inside the app; the rest is unassigned. No money moves between accounts.
 */

export type GoalKind = "spend" | "keep";
export type GoalStatus = "active" | "done" | "archived";

export const GOAL_TYPES = ["emergency", "trip", "house", "wedding", "umrah", "education", "gadget", "vehicle-tax", "insurance", "lebaran"] as const;
export type GoalType = (typeof GOAL_TYPES)[number];
export const isGoalType = (value: unknown): value is GoalType => typeof value === "string" && (GOAL_TYPES as readonly string[]).includes(value);

/** A goal's type figures; anything that isn't a JSON object reads as none. */
export function parseTypeData(value: unknown): Record<string, unknown> {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

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
  /** What it gets each month: the fixed amount, or its share of your latest salary. */
  monthlyAmount: number;
  /** Set when the monthly amount is a share (%) of your latest salary. */
  monthlyPercent: number | null;
  status: GoalStatus;
  paused: boolean;
  wishlistId: number | null;
  spentTransactionId: number | null;
  doneAt: number | null;
  sortOrder: number;
  icon: string | null;
  description: string | null;
  linkUrl: string | null;
  linkTitle: string | null;
  linkImage: string | null;
  accountId: number | null;
  expectedReturn: number;
  recurrence: "none" | "yearly";
  categoryId: number | null;
  categorySince: number | null;
  /** What kind of goal it is, which shapes its page; null when started blank. */
  goalType: GoalType | null;
  /** That type's own figures, like a house's price or a wedding's guest count. */
  typeData: Record<string, unknown>;
  setAside: number;
  /** Set aside this calendar month; counts toward the monthly amount. */
  setAsideThisMonth: number;
  /** Months until it's reached at its monthly amount and return; 0 when it's there, null when never. */
  reachMonths: number | null;
  /** The cover picture among its files, if any. */
  coverAttachmentId: number | null;
};

const time = (value: unknown) => (value instanceof Date ? value.getTime() : value == null ? null : Number(value));

/** A goal's monthly amount: fixed, or its share of the latest salary (to the nearest Rp1.000). */
export function monthlyFor(row: Pick<typeof savingsGoals.$inferSelect, "monthlyAmount" | "monthlyPercent">, salary: number | null): number {
  if (row.monthlyPercent != null && row.monthlyPercent > 0) return salary ? Math.round((salary * row.monthlyPercent) / 100 / 1000) * 1000 : 0;
  return row.monthlyAmount;
}

export function goalView(row: typeof savingsGoals.$inferSelect, setAside: number, thisMonth = 0, extra: { salary?: number | null; coverAttachmentId?: number | null } = {}): GoalView {
  const monthlyAmount = monthlyFor(row, extra.salary ?? null);
  const paused = row.pausedAt != null;
  const expectedReturn = row.expectedReturn ?? 0;
  return {
    id: row.id,
    name: row.name,
    targetAmount: row.targetAmount,
    byDate: time(row.byDate),
    kind: row.kind === "keep" ? "keep" : "spend",
    monthlyAmount,
    monthlyPercent: row.monthlyPercent ?? null,
    status: row.status === "done" || row.status === "archived" ? row.status : "active",
    paused,
    wishlistId: row.wishlistId ?? null,
    spentTransactionId: row.spentTransactionId ?? null,
    doneAt: time(row.doneAt),
    sortOrder: row.sortOrder,
    icon: row.icon ?? null,
    description: row.description ?? null,
    linkUrl: row.linkUrl ?? null,
    linkTitle: row.linkTitle ?? null,
    linkImage: row.linkImage ?? null,
    accountId: row.accountId ?? null,
    expectedReturn,
    recurrence: row.recurrence === "yearly" ? "yearly" : "none",
    categoryId: row.categoryId ?? null,
    categorySince: time(row.categorySince),
    goalType: isGoalType(row.goalType) ? row.goalType : null,
    typeData: parseTypeData(row.typeData),
    setAside,
    setAsideThisMonth: thisMonth,
    reachMonths: monthsToReach(setAside, row.targetAmount, paused ? 0 : monthlyAmount, expectedReturn),
    coverAttachmentId: extra.coverAttachmentId ?? null,
  };
}

/** Your take-home pay as the salary settings work it out, or null when salary isn't set up. */
export async function latestSalary(_dbLike: any = defaultDb): Promise<number | null> {
  try {
    const preview = await previewSalaryPosting();
    return preview.netMonthly > 0 ? Math.round(preview.netMonthly) : null;
  } catch {
    return null;
  }
}

/**
 * Pays a goal's expenses in its chosen category out of it: each posted expense in that category
 * from `category_since` on gets one `category` entry, dated on the expense, taking up to what the
 * goal held on that day (oldest expense first), so money put in later doesn't pay for it and the
 * monthly report counts it in the right period. Entries whose expense was reversed, removed or no
 * longer counts are dropped, so the money comes back. Matched on read, by everything that reads a
 * goal's balance, because some ways of posting (CSV import, batch drafts) skip the shared hooks.
 */
export async function syncCategorySpending(dbLike: any = defaultDb) {
  const goals = await dbLike.select().from(savingsGoals).where(eq(savingsGoals.status, "active"));
  const existing = await dbLike
    .select({ id: goalAllocations.id, goalId: goalAllocations.goalId, transactionId: goalAllocations.transactionId })
    .from(goalAllocations)
    .where(eq(goalAllocations.kind, "category"));
  const active = new Map<number, typeof savingsGoals.$inferSelect>(goals.map((goal: typeof savingsGoals.$inferSelect) => [goal.id, goal]));
  const keep = new Set<string>();
  const wanted: Array<{ goalId: number; transactionId: number; amount: number; description: string; date: Date }> = [];
  for (const goal of goals as Array<typeof savingsGoals.$inferSelect>) {
    if (goal.categoryId == null || goal.categorySince == null) continue;
    const rows = await dbLike
      .select({ transactionId: transactionCategoryAllocations.transactionId, amount: transactionCategoryAllocations.amount, description: transactions.description, date: transactions.date })
      .from(transactionCategoryAllocations)
      .innerJoin(transactions, eq(transactionCategoryAllocations.transactionId, transactions.id))
      .where(and(eq(transactionCategoryAllocations.categoryId, goal.categoryId), eq(transactions.status, "posted"), gte(transactions.date, goal.categorySince), sql`${transactionCategoryAllocations.amount} > 0`));
    for (const row of rows) {
      keep.add(`${goal.id}:${row.transactionId}`);
      wanted.push({ goalId: goal.id, transactionId: row.transactionId, amount: row.amount, description: row.description, date: row.date });
    }
  }
  // Drop entries that no longer count; only for active goals, so a finished goal's history stays.
  const stale = existing.filter((row: { id: number; goalId: number; transactionId: number | null }) => active.has(row.goalId) && (row.transactionId == null || !keep.has(`${row.goalId}:${row.transactionId}`)));
  if (stale.length) await dbLike.delete(goalAllocations).where(inArray(goalAllocations.id, stale.map((row: { id: number }) => row.id)));
  const done = new Set(existing.filter((row: { transactionId: number | null }) => row.transactionId != null).map((row: { goalId: number; transactionId: number }) => `${row.goalId}:${row.transactionId}`));
  const fresh = wanted
    .filter((row) => !done.has(`${row.goalId}:${row.transactionId}`))
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.transactionId - b.transactionId);
  if (!fresh.length) return;
  // Every entry of the goals involved, to know what each held on an expense's day.
  const ledger = (await dbLike
    .select({ goalId: goalAllocations.goalId, amount: goalAllocations.amount, createdAt: goalAllocations.createdAt })
    .from(goalAllocations)
    .where(inArray(goalAllocations.goalId, [...new Set(fresh.map((row) => row.goalId))]))) as Array<{ goalId: number; amount: number; createdAt: Date }>;
  for (const row of fresh) {
    const holds = ledger
      .filter((entry) => entry.goalId === row.goalId && entry.createdAt.getTime() <= row.date.getTime())
      .reduce((sum, entry) => sum + entry.amount, 0);
    const taken = Math.max(0, Math.min(row.amount, holds));
    await dbLike.insert(goalAllocations).values({ goalId: row.goalId, amount: -taken, kind: "category", transactionId: row.transactionId, note: taken < row.amount ? `${row.description} (more than the goal had)` : row.description, createdAt: row.date });
    ledger.push({ goalId: row.goalId, amount: -taken, createdAt: row.date });
  }
}

/**
 * What happened to each goal over a period, for the monthly report: what went in, what was paid
 * from it, what was taken back out, what it held at the end, and whether it was finished then.
 * Goals with nothing in them and nothing happening are left out.
 */
export async function goalsForPeriod(startMs: number, endMs: number, dbLike: any = defaultDb) {
  await syncCategorySpending(dbLike);
  const goals =await dbLike.select().from(savingsGoals).orderBy(asc(savingsGoals.sortOrder), asc(savingsGoals.id));
  const entries = await dbLike
    .select({ goalId: goalAllocations.goalId, amount: goalAllocations.amount, kind: goalAllocations.kind, createdAt: goalAllocations.createdAt })
    .from(goalAllocations);
  return (goals as Array<typeof savingsGoals.$inferSelect>)
    .filter((goal) => goal.createdAt.getTime() <= endMs)
    .map((goal) => {
      const own = entries.filter((entry: { goalId: number; createdAt: Date }) => entry.goalId === goal.id && entry.createdAt.getTime() <= endMs);
      const inPeriod = own.filter((entry: { createdAt: Date }) => entry.createdAt.getTime() >= startMs);
      const total = (rows: Array<{ amount: number }>) => rows.reduce((sum, row) => sum + row.amount, 0);
      const doneAt = goal.doneAt ? goal.doneAt.getTime() : null;
      return {
        name: goal.name,
        icon: goal.icon ?? null,
        kind: goal.kind === "keep" ? "keep" : "spend",
        targetAmount: goal.targetAmount,
        putIn: total(inPeriod.filter((entry: { kind: string }) => entry.kind === "assign")),
        paid: -total(inPeriod.filter((entry: { kind: string }) => entry.kind === "spend" || entry.kind === "category")),
        takenOut: -total(inPeriod.filter((entry: { kind: string }) => entry.kind === "release")),
        heldAtEnd: total(own),
        finished: doneAt !== null && doneAt >= startMs && doneAt <= endMs,
      };
    })
    .filter((goal) => goal.heldAtEnd !== 0 || goal.putIn !== 0 || goal.paid !== 0 || goal.takenOut !== 0 || goal.finished);
}

/** After a salary posts: puts in every goal's monthly amount, when that's switched on. */
export async function autoFundAfterPayday(dbLike: any = defaultDb) {
  const settings = await goalSettingsRow(dbLike);
  if (!settings.autoFundOnPayday) return null;
  return fundMonthly(null, dbLike, "Payday");
}

/** Each goal's cover picture, by goal. */
async function coverIds(dbLike: any): Promise<Map<number, number>> {
  const rows = await dbLike.select({ id: goalAttachments.id, goalId: goalAttachments.goalId }).from(goalAttachments).where(eq(goalAttachments.isCover, true));
  return new Map(rows.map((row: { id: number; goalId: number }) => [row.goalId, row.id]));
}

export async function goalSettingsRow(dbLike: any = defaultDb) {
  const [row] = await dbLike.select().from(goalSettings).where(eq(goalSettings.id, 1)).limit(1);
  return { excludedAccountIds: parseIds(row?.excludedAccountIds), autoFundOnPayday: Boolean(row?.autoFundOnPayday) };
}

/** Everything the Goals page shows: what you can set aside, what's set aside where, and what's left. */
export async function goalsOverview(dbLike: any = defaultDb) {
  await syncCategorySpending(dbLike);
  const [accountRows, goalRows, held, thisMonth, covers, salary, settings] = await Promise.all([
    liquidAccounts(dbLike),
    dbLike.select().from(savingsGoals).orderBy(asc(savingsGoals.sortOrder), asc(savingsGoals.id)),
    setAsideByGoal(dbLike),
    setAsideThisMonth(dbLike),
    coverIds(dbLike),
    latestSalary(dbLike),
    goalSettingsRow(dbLike),
  ]);
  const goals = (goalRows as Array<typeof savingsGoals.$inferSelect>).map((row) => goalView(row, held.get(row.id) ?? 0, thisMonth.get(row.id) ?? 0, { salary, coverAttachmentId: covers.get(row.id) ?? null }));
  const available = accountRows.filter((account) => account.included).reduce((sum, account) => sum + account.balance, 0);
  const setAside = goals.filter((goal) => goal.status === "active").reduce((sum, goal) => sum + goal.setAside, 0);
  return { available, setAside, unassigned: available - setAside, accounts: accountRows, goals, salary, autoFundOnPayday: settings.autoFundOnPayday };
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
 * Pays part of a goal from its money, like the flights of a trip: the amount leaves the goal with a
 * `spend` entry, optionally with the expense that paid it, and a part of its breakdown is ticked off.
 */
export async function spendFromGoal(goalId: number, input: { amount: number; transactionId: number | null; partId: number | null; note: string | null }, dbLike: any = defaultDb) {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new GoalError("Enter an amount");
  await syncCategorySpending(dbLike);
  const [goal] = await dbLike.select().from(savingsGoals).where(eq(savingsGoals.id, goalId)).limit(1);
  if (!goal) throw new GoalError("Goal not found", 404);
  if (goal.status !== "active") throw new GoalError("Only an active goal can pay for something", 409);
  const holds = (await setAsideByGoal(dbLike)).get(goalId) ?? 0;
  if (input.amount > holds) throw new GoalError("A goal can't pay more than it holds", 409);
  let part: typeof goalParts.$inferSelect | undefined;
  if (input.partId != null) {
    [part] = await dbLike.select().from(goalParts).where(and(eq(goalParts.id, input.partId), eq(goalParts.goalId, goalId))).limit(1);
    if (!part) throw new GoalError("That part isn't on this goal");
  }
  const [created] = await dbLike.insert(goalAllocations).values({ goalId, amount: -input.amount, kind: "spend", transactionId: input.transactionId, partId: input.partId, note: input.note ?? (part ? `Paid: ${part.name}` : "Paid") }).returning();
  if (part) await dbLike.update(goalParts).set({ paidAt: new Date(), transactionId: input.transactionId ?? part.transactionId }).where(eq(goalParts.id, part.id));
  return created;
}

/**
 * Marks a goal bought or finished. Its money is released with a `spend` entry (for a spend goal
 * the purchase took it); a linked wishlist item is fulfilled with the same transaction. A yearly
 * goal isn't finished: it starts again for the same date next year, its parts unticked.
 */
export async function completeGoal(goalId: number, transactionId: number | null, dbLike: any = defaultDb) {
  await syncCategorySpending(dbLike);
  const [goal] =await dbLike.select().from(savingsGoals).where(eq(savingsGoals.id, goalId)).limit(1);
  if (!goal) throw new GoalError("Goal not found", 404);
  if (goal.status === "done") throw new GoalError("This goal is already done", 409);
  const holds = (await setAsideByGoal(dbLike)).get(goalId) ?? 0;
  const now = new Date();
  if (holds !== 0) {
    await dbLike.insert(goalAllocations).values({ goalId, amount: -holds, kind: "spend", transactionId, note: transactionId ? "Bought" : "Done" });
  }
  if (goal.recurrence === "yearly") {
    const due = goal.byDate ? new Date(goal.byDate) : now;
    // Next year's date, a year after this one (or after today, if this one is long past).
    let next = new Date(due.getFullYear() + 1, due.getMonth(), due.getDate(), 12);
    while (next.getTime() <= now.getTime()) next = new Date(next.getFullYear() + 1, next.getMonth(), next.getDate(), 12);
    // What this year's took, from what was paid out of it since it last started again (entries after
    // the last one counted then), is next year's guide.
    const data = parseTypeData(goal.typeData);
    const since = typeof data.paidThroughId === "number" ? data.paidThroughId : 0;
    const paidOut = await dbLike.select({ id: goalAllocations.id, amount: goalAllocations.amount, kind: goalAllocations.kind }).from(goalAllocations)
      .where(and(eq(goalAllocations.goalId, goalId), gt(goalAllocations.id, since)));
    const lastYear = -paidOut.filter((row: { kind: string }) => row.kind === "spend" || row.kind === "category").reduce((sum: number, row: { amount: number }) => sum + row.amount, 0);
    const paidThroughId = paidOut.reduce((max: number, row: { id: number }) => Math.max(max, row.id), since);
    const typeData = { ...data, ...(lastYear > 0 ? { lastYear } : {}), lastPaidAt: now.getTime(), paidThroughId };
    await dbLike.update(savingsGoals).set({ byDate: next, spentTransactionId: transactionId, typeData: JSON.stringify(typeData), updatedAt: now }).where(eq(savingsGoals.id, goalId));
    await dbLike.update(goalParts).set({ paidAt: null, transactionId: null }).where(eq(goalParts.goalId, goalId));
    return;
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
 * Sets aside each active, unpaused goal's monthly amount, less what it was already given this
 * month, as far as the unassigned money goes and no further than its target. Goals go in priority
 * order, the top of the list first.
 */
export async function fundMonthly(goalIds: number[] | null, dbLike: any = defaultDb, note = "Monthly amount") {
  const overview = await goalsOverview(dbLike);
  let left = Math.max(0, overview.unassigned);
  // The overview is already in priority order.
  const due = overview.goals.filter((goal) => goal.status === "active" && !goal.paused && goal.monthlyAmount > 0 && (!goalIds || goalIds.includes(goal.id)));
  const assigned: Array<{ goalId: number; amount: number }> = [];
  for (const goal of due) {
    const amount = Math.min(goal.monthlyAmount - goal.setAsideThisMonth, goal.targetAmount - goal.setAside, left);
    if (amount <= 0) continue;
    await dbLike.insert(goalAllocations).values({ goalId: goal.id, amount, kind: "assign", note });
    assigned.push({ goalId: goal.id, amount });
    left -= amount;
  }
  return { assigned, total: assigned.reduce((sum, item) => sum + item.amount, 0) };
}
