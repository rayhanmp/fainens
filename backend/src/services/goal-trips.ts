import { and, asc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";

import { db as defaultDb } from "../db/client";
import {
  categories,
  goalAllocations,
  goalBookings,
  goalNotePages,
  goalPacking,
  goalParts,
  goalPlans,
  goalTravellers,
  savingsGoals,
  transactionCategoryAllocations,
  transactions,
} from "../db/schema";
import { GoalError, parseTypeData } from "./goals";

/**
 * A holiday goal's trip. Where, when, the currency and the daily spending money are in the goal's
 * type data; travellers, bookings, plans for each day and the packing list have their own tables.
 * A booking with a cost keeps a part of the goal's breakdown in step, in rupiah, so paying it from
 * the goal ticks it off.
 */

export const BOOKING_KINDS = ["flight", "stay", "transport", "ticket", "other"] as const;
export type BookingKind = (typeof BOOKING_KINDS)[number];
export const VISA_STATUSES = ["not-needed", "to-apply", "applied", "approved"] as const;
export const CLIMATES = ["cold", "warm", "mixed"] as const;

const DAY = 86_400_000;

export type TripBasics = {
  places: string[];
  startDate: number | null;
  endDate: number | null;
  /** The currency spent there, like JPY; null when it's rupiah. */
  currency: string | null;
  /** Rupiah for one unit of that currency. */
  rate: number | null;
  /** Spending money per person per day, in rupiah. */
  dailyBudget: number;
  climate: (typeof CLIMATES)[number] | null;
};

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** The trip read from a goal's type data; anything missing or malformed reads as not set. */
export function tripBasics(typeData: unknown): TripBasics {
  const data = parseTypeData(typeData);
  const currency = typeof data.currency === "string" && /^[A-Z]{3}$/.test(data.currency) && data.currency !== "IDR" ? data.currency : null;
  const rate = num(data.rate);
  return {
    places: Array.isArray(data.places) ? data.places.filter((place): place is string => typeof place === "string" && place.trim() !== "").slice(0, 20) : [],
    startDate: num(data.startDate),
    endDate: num(data.endDate),
    currency,
    rate: currency && rate && rate > 0 ? rate : null,
    dailyBudget: Math.max(0, Math.round(num(data.dailyBudget) ?? 0)),
    climate: (CLIMATES as readonly unknown[]).includes(data.climate) ? data.climate as TripBasics["climate"] : null,
  };
}

/** A cost in rupiah: as it is, or at the trip's rate; 0 while the rate isn't known. */
export function toRupiah(cost: number, currency: string, basics: Pick<TripBasics, "currency" | "rate">): number {
  if (currency === "IDR") return Math.round(cost);
  return currency === basics.currency && basics.rate ? Math.round(cost * basics.rate) : 0;
}

/** A day as `YYYY-MM-DD`, on the server's (the app's) calendar. */
export function dayKey(time: number): string {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export const startOfDay = (time: number) => new Date(time).setHours(0, 0, 0, 0);

/** Days from one date to another, by the calendar. */
export const daysBetween = (from: number, to: number) => Math.round((startOfDay(to) - startOfDay(from)) / DAY);

/** How many days the trip lasts, counting both ends; 0 without both dates. */
export function tripDays(basics: Pick<TripBasics, "startDate" | "endDate">): number {
  if (basics.startDate === null || basics.endDate === null || basics.endDate < basics.startDate) return 0;
  return daysBetween(basics.startDate, basics.endDate) + 1;
}

export async function tripGoal(goalId: number, dbLike: any = defaultDb) {
  const [goal] = await dbLike.select().from(savingsGoals).where(eq(savingsGoals.id, goalId)).limit(1);
  if (!goal) throw new GoalError("Goal not found", 404);
  return goal as typeof savingsGoals.$inferSelect;
}

/**
 * Keeps a booking's part of the breakdown in step: named after it, costing what it costs in
 * rupiah. A paid part only takes the new name, since its amount is what was paid for; a booking
 * that costs nothing (or whose rate isn't known yet) has no part.
 */
export async function syncBookingPart(booking: typeof goalBookings.$inferSelect, basics: TripBasics, dbLike: any = defaultDb) {
  const amount = toRupiah(booking.cost, booking.costCurrency, basics);
  const [part] = booking.partId != null ? await dbLike.select().from(goalParts).where(eq(goalParts.id, booking.partId)).limit(1) : [];
  if (part?.paidAt) {
    if (part.name !== booking.title) await dbLike.update(goalParts).set({ name: booking.title }).where(eq(goalParts.id, part.id));
    return;
  }
  if (amount <= 0) {
    if (part) await dbLike.delete(goalParts).where(eq(goalParts.id, part.id));
    if (booking.partId != null) await dbLike.update(goalBookings).set({ partId: null }).where(eq(goalBookings.id, booking.id));
    return;
  }
  if (part) {
    await dbLike.update(goalParts).set({ name: booking.title, amount }).where(eq(goalParts.id, part.id));
    return;
  }
  const [{ next }] = await dbLike.select({ next: sql<number>`coalesce(max(${goalParts.sortOrder}), -1) + 1` }).from(goalParts).where(eq(goalParts.goalId, booking.goalId));
  const [created] = await dbLike.insert(goalParts).values({ goalId: booking.goalId, name: booking.title, amount, sortOrder: Number(next) }).returning();
  await dbLike.update(goalBookings).set({ partId: created.id }).where(eq(goalBookings.id, booking.id));
}

/** After the rate or currency changes: every booking's part costs what it now costs in rupiah. */
export async function syncAllBookingParts(goalId: number, basics: TripBasics, dbLike: any = defaultDb) {
  const rows = await dbLike.select().from(goalBookings).where(eq(goalBookings.goalId, goalId));
  for (const booking of rows) await syncBookingPart(booking, basics, dbLike);
}

/** Removes a booking; its part goes too unless it was paid, which stays as a record of the payment. */
export async function deleteBooking(id: number, dbLike: any = defaultDb) {
  const [booking] = await dbLike.select().from(goalBookings).where(eq(goalBookings.id, id)).limit(1);
  if (!booking) return false;
  await dbLike.delete(goalBookings).where(eq(goalBookings.id, id));
  if (booking.partId != null) await dbLike.delete(goalParts).where(and(eq(goalParts.id, booking.partId), isNull(goalParts.paidAt)));
  return true;
}

const parseJson = <T>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export const travellerView = (row: typeof goalTravellers.$inferSelect) => ({
  id: row.id,
  goalId: row.goalId,
  name: row.name,
  paying: Boolean(row.paying),
  passportNumber: row.passportNumber ?? null,
  passportExpiry: row.passportExpiry ? row.passportExpiry.getTime() : null,
  visaStatus: (VISA_STATUSES as readonly string[]).includes(row.visaStatus) ? row.visaStatus as (typeof VISA_STATUSES)[number] : "not-needed",
  visaDate: row.visaDate ? row.visaDate.getTime() : null,
  insurance: row.insurance ?? null,
  sortOrder: row.sortOrder,
});

export const planView = (row: typeof goalPlans.$inferSelect, basics: TripBasics) => ({
  id: row.id,
  goalId: row.goalId,
  day: row.day,
  time: row.time ?? null,
  endTime: row.time ? row.endTime ?? null : null,
  title: row.title,
  place: row.place ?? null,
  cost: row.cost,
  costCurrency: row.costCurrency,
  rupiah: toRupiah(row.cost, row.costCurrency, basics),
  sortOrder: row.sortOrder,
});

export const PACKING_CATEGORIES = ["clothes", "toiletries", "documents", "electronics", "medicine", "other"] as const;
export const PACKING_BAGS = ["carry-on", "checked", "personal"] as const;

export const packingView = (row: typeof goalPacking.$inferSelect) => ({
  id: row.id,
  goalId: row.goalId,
  travellerId: row.travellerId ?? null,
  text: row.text,
  category: (PACKING_CATEGORIES as readonly string[]).includes(row.category) ? row.category as (typeof PACKING_CATEGORIES)[number] : "other",
  quantity: row.quantity,
  bag: (PACKING_BAGS as readonly string[]).includes(row.bag ?? "") ? row.bag as (typeof PACKING_BAGS)[number] : null,
  done: Boolean(row.done),
  sortOrder: row.sortOrder,
});

/** A booking with what it costs in rupiah and, from its part, whether and for how much it was paid. */
export async function bookingViews(goalId: number, basics: TripBasics, dbLike: any = defaultDb) {
  const rows = await dbLike.select().from(goalBookings).where(eq(goalBookings.goalId, goalId)).orderBy(asc(goalBookings.startAt), asc(goalBookings.sortOrder), asc(goalBookings.id));
  const partIds = rows.map((row: typeof goalBookings.$inferSelect) => row.partId).filter((id: number | null): id is number => id != null);
  const parts = partIds.length ? await dbLike.select().from(goalParts).where(inArray(goalParts.id, partIds)) : [];
  const paid = partIds.length
    ? await dbLike.select({ partId: goalAllocations.partId, total: sql<number>`coalesce(sum(${goalAllocations.amount}), 0)` }).from(goalAllocations).where(and(eq(goalAllocations.kind, "spend"), inArray(goalAllocations.partId, partIds))).groupBy(goalAllocations.partId)
    : [];
  return rows.map((row: typeof goalBookings.$inferSelect) => {
    const part = parts.find((item: typeof goalParts.$inferSelect) => item.id === row.partId);
    const paidFromGoal = -Number(paid.find((item: { partId: number }) => item.partId === row.partId)?.total ?? 0);
    const rupiah = toRupiah(row.cost, row.costCurrency, basics);
    return {
      id: row.id,
      goalId: row.goalId,
      kind: (BOOKING_KINDS as readonly string[]).includes(row.kind) ? row.kind as BookingKind : "other",
      title: row.title,
      startAt: row.startAt ? row.startAt.getTime() : null,
      endAt: row.endAt ? row.endAt.getTime() : null,
      place: row.place ?? null,
      address: row.address ?? null,
      code: row.code ?? null,
      cost: row.cost,
      costCurrency: row.costCurrency,
      rupiah,
      cancelBy: row.cancelBy ? row.cancelBy.getTime() : null,
      details: parseTypeData(row.details) as Record<string, string | number | null>,
      fileIds: parseJson<number[]>(row.fileIds, []).filter((id) => Number.isSafeInteger(id)),
      partId: row.partId ?? null,
      paidAt: part?.paidAt ? part.paidAt.getTime() : null,
      /** What was paid for it from the goal; its cost when it was ticked off without paying from the goal. */
      paid: part?.paidAt ? (paidFromGoal || part.amount) : 0,
      sortOrder: row.sortOrder,
    };
  });
}

/**
 * What was spent on the trip's days: posted expenses dated from the first day to the last,
 * by day and by category. Renewals of subscriptions and bookings paid from the goal are left
 * out, since they aren't spending money. Null until the trip has both dates.
 */
export async function tripSpending(goalId: number, basics: TripBasics, dbLike: any = defaultDb) {
  if (basics.startDate === null || basics.endDate === null || basics.endDate < basics.startDate) return null;
  const from = startOfDay(basics.startDate);
  const to = startOfDay(basics.endDate) + DAY;
  const bookingPayments = await dbLike.select({ transactionId: goalAllocations.transactionId }).from(goalAllocations)
    .where(and(eq(goalAllocations.goalId, goalId), eq(goalAllocations.kind, "spend")));
  const skip = new Set(bookingPayments.map((row: { transactionId: number | null }) => row.transactionId).filter(Boolean));
  const rows = await dbLike
    .select({ transactionId: transactions.id, date: transactions.date, amount: transactionCategoryAllocations.amount, categoryId: categories.id, categoryName: categories.name })
    .from(transactionCategoryAllocations)
    .innerJoin(transactions, eq(transactionCategoryAllocations.transactionId, transactions.id))
    .innerJoin(categories, eq(transactionCategoryAllocations.categoryId, categories.id))
    .where(and(eq(transactions.status, "posted"), isNull(transactions.subscriptionId), gte(transactions.date, new Date(from)), lt(transactions.date, new Date(to))));
  const byDay = new Map<string, number>();
  const byCategory = new Map<number, { categoryId: number; name: string; total: number }>();
  let total = 0;
  for (const row of rows as Array<{ transactionId: number; date: Date; amount: number; categoryId: number; categoryName: string }>) {
    if (skip.has(row.transactionId)) continue;
    total += row.amount;
    const day = dayKey(row.date.getTime());
    byDay.set(day, (byDay.get(day) ?? 0) + row.amount);
    const category = byCategory.get(row.categoryId) ?? { categoryId: row.categoryId, name: row.categoryName, total: 0 };
    category.total += row.amount;
    byCategory.set(row.categoryId, category);
  }
  return {
    total,
    byDay: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, amount]) => ({ day, total: amount })),
    byCategory: [...byCategory.values()].filter((row) => row.total !== 0).sort((a, b) => b.total - a.total),
  };
}

export async function tripDetail(goalId: number, dbLike: any = defaultDb) {
  const goal = await tripGoal(goalId, dbLike);
  const basics = tripBasics(goal.typeData);
  const [travellers, plans, packing] = await Promise.all([
    dbLike.select().from(goalTravellers).where(eq(goalTravellers.goalId, goalId)).orderBy(asc(goalTravellers.sortOrder), asc(goalTravellers.id)),
    dbLike.select().from(goalPlans).where(eq(goalPlans.goalId, goalId)).orderBy(asc(goalPlans.day), asc(goalPlans.sortOrder), asc(goalPlans.id)),
    dbLike.select().from(goalPacking).where(eq(goalPacking.goalId, goalId)).orderBy(asc(goalPacking.sortOrder), asc(goalPacking.id)),
  ]);
  return {
    basics,
    travellers: travellers.map(travellerView),
    bookings: await bookingViews(goalId, basics, dbLike),
    plans: plans.map((row: typeof goalPlans.$inferSelect) => planView(row, basics)),
    packing: packing.map(packingView),
    spending: await tripSpending(goalId, basics, dbLike),
  };
}

export type TripReminder = {
  kind: "cancel" | "unpaid" | "passport" | "visa" | "packing";
  goalId: number;
  goalName: string;
  /** The date it's about: when free cancellation ends, when you leave, or when a passport expires. */
  at: number;
  /** Whose passport or visa, or which booking. */
  name: string | null;
  count: number;
};

/** Many countries want a passport valid for six months after you arrive or leave. */
export const PASSPORT_MONTHS = 6;

/**
 * What a trip needs from you soon: free cancellation ending within three days, bookings not paid
 * two weeks before leaving, passports that expire too soon after the trip, visas not applied for
 * 45 days out, and things not packed two days before.
 */
export function remindersFor(trip: {
  goalId: number;
  goalName: string;
  basics: TripBasics;
  bookings: ReadonlyArray<{ title: string; cancelBy: number | null; partId: number | null; paidAt: number | null; rupiah: number }>;
  travellers: ReadonlyArray<{ name: string; passportExpiry: number | null; visaStatus: string }>;
  unpacked: number;
}, now: number): TripReminder[] {
  const { basics } = trip;
  const base = { goalId: trip.goalId, goalName: trip.goalName };
  const out: TripReminder[] = [];
  for (const booking of trip.bookings) {
    if (booking.cancelBy === null) continue;
    const days = daysBetween(now, booking.cancelBy);
    if (booking.cancelBy >= now && days <= 3) out.push({ ...base, kind: "cancel", at: booking.cancelBy, name: booking.title, count: 1 });
  }
  if (basics.startDate === null) return out;
  const untilLeaving = daysBetween(now, basics.startDate);
  const over = (basics.endDate ?? basics.startDate) < startOfDay(now);
  if (over) return out;
  if (untilLeaving >= 0 && untilLeaving <= 14) {
    const unpaid = trip.bookings.filter((booking) => booking.partId !== null && booking.paidAt === null && booking.rupiah > 0).length;
    if (unpaid) out.push({ ...base, kind: "unpaid", at: basics.startDate, name: null, count: unpaid });
  }
  const back = basics.endDate ?? basics.startDate;
  const needed = new Date(back);
  needed.setMonth(needed.getMonth() + PASSPORT_MONTHS);
  for (const traveller of trip.travellers) {
    if (traveller.passportExpiry !== null && traveller.passportExpiry < needed.getTime()) out.push({ ...base, kind: "passport", at: traveller.passportExpiry, name: traveller.name, count: 1 });
    if (traveller.visaStatus === "to-apply" && untilLeaving >= 0 && untilLeaving <= 45) out.push({ ...base, kind: "visa", at: basics.startDate, name: traveller.name, count: 1 });
  }
  if (trip.unpacked > 0 && untilLeaving >= 0 && untilLeaving <= 2) out.push({ ...base, kind: "packing", at: basics.startDate, name: null, count: trip.unpacked });
  return out;
}

/** Every active trip's reminders. */
export async function tripReminders(now = Date.now(), dbLike: any = defaultDb): Promise<TripReminder[]> {
  const goals = await dbLike.select().from(savingsGoals).where(and(eq(savingsGoals.status, "active"), eq(savingsGoals.goalType, "trip")));
  const out: TripReminder[] = [];
  for (const goal of goals as Array<typeof savingsGoals.$inferSelect>) {
    const basics = tripBasics(goal.typeData);
    const [travellers, unpacked] = await Promise.all([
      dbLike.select().from(goalTravellers).where(eq(goalTravellers.goalId, goal.id)),
      dbLike.select({ count: sql<number>`count(*)` }).from(goalPacking).where(and(eq(goalPacking.goalId, goal.id), eq(goalPacking.done, false))),
    ]);
    out.push(...remindersFor({
      goalId: goal.id,
      goalName: goal.name,
      basics,
      bookings: await bookingViews(goal.id, basics, dbLike),
      travellers: travellers.map(travellerView),
      unpacked: Number(unpacked[0]?.count ?? 0),
    }, now));
  }
  return out;
}

/**
 * Starts the same trip again as a new goal: its places, currency, budget, travellers (visas to
 * check again), packing list (nothing ticked), notes and the parts that weren't bookings, but no
 * dates, bookings or day plans.
 */
export async function planAgain(goalId: number, dbLike: any = defaultDb) {
  const goal = await tripGoal(goalId, dbLike);
  if (goal.goalType !== "trip") throw new GoalError("Only a holiday can be planned again");
  const { startDate: _start, endDate: _end, ...keep } = parseTypeData(goal.typeData);
  const [{ next }] = await dbLike.select({ next: sql<number>`coalesce(max(${savingsGoals.sortOrder}), -1) + 1` }).from(savingsGoals);
  const [created] = await dbLike.insert(savingsGoals).values({
    name: `${goal.name} again`.slice(0, 120),
    targetAmount: goal.targetAmount,
    kind: goal.kind,
    monthlyAmount: goal.monthlyAmount,
    monthlyPercent: goal.monthlyPercent,
    icon: goal.icon,
    accountId: goal.accountId,
    expectedReturn: goal.expectedReturn,
    goalType: "trip",
    typeData: JSON.stringify(keep),
    sortOrder: Number(next),
  }).returning();
  const travellers = await dbLike.select().from(goalTravellers).where(eq(goalTravellers.goalId, goalId)).orderBy(asc(goalTravellers.sortOrder), asc(goalTravellers.id));
  const travellerIds = new Map<number, number>();
  for (const traveller of travellers as Array<typeof goalTravellers.$inferSelect>) {
    const [copy] = await dbLike.insert(goalTravellers).values({
      goalId: created.id,
      name: traveller.name,
      paying: traveller.paying,
      passportNumber: traveller.passportNumber,
      passportExpiry: traveller.passportExpiry,
      visaStatus: traveller.visaStatus === "not-needed" ? "not-needed" : "to-apply",
      insurance: null,
      sortOrder: traveller.sortOrder,
    }).returning();
    travellerIds.set(traveller.id, copy.id);
  }
  const packing = await dbLike.select().from(goalPacking).where(eq(goalPacking.goalId, goalId));
  if (packing.length) {
    await dbLike.insert(goalPacking).values(packing.map((item: typeof goalPacking.$inferSelect) => ({
      goalId: created.id,
      travellerId: item.travellerId != null ? travellerIds.get(item.travellerId) ?? null : null,
      text: item.text,
      category: item.category,
      quantity: item.quantity,
      bag: item.bag,
      done: false,
      sortOrder: item.sortOrder,
    })));
  }
  const bookingParts = new Set((await dbLike.select({ partId: goalBookings.partId }).from(goalBookings).where(eq(goalBookings.goalId, goalId))).map((row: { partId: number | null }) => row.partId));
  const parts = (await dbLike.select().from(goalParts).where(eq(goalParts.goalId, goalId))).filter((part: typeof goalParts.$inferSelect) => !bookingParts.has(part.id));
  if (parts.length) {
    await dbLike.insert(goalParts).values(parts.map((part: typeof goalParts.$inferSelect) => ({ goalId: created.id, name: part.name, amount: part.amount, sortOrder: part.sortOrder })));
  }
  const pages = await dbLike.select().from(goalNotePages).where(eq(goalNotePages.goalId, goalId));
  if (pages.length) {
    await dbLike.insert(goalNotePages).values(pages.map((page: typeof goalNotePages.$inferSelect) => ({ goalId: created.id, title: page.title, content: page.content, sortOrder: page.sortOrder })));
  }
  return created.id as number;
}
