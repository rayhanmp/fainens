import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { db } from "../db/client";
import { goalAttachments, goalBookings, goalPacking, goalPlans, goalTravellers, savingsGoals } from "../db/schema";
import { GoalError, parseTypeData } from "../services/goals";
import {
  BOOKING_KINDS,
  bookingViews,
  CLIMATES,
  deleteBooking,
  packingView,
  planAgain,
  planView,
  syncAllBookingParts,
  syncBookingPart,
  travellerView,
  tripBasics,
  tripDetail,
  PACKING_BAGS,
  PACKING_CATEGORIES,
  tripGoal,
  VISA_STATUSES,
} from "../services/goal-trips";
import { goalReminders } from "../services/goal-reminders";

/**
 * A holiday goal's trip: where and when, who's going, bookings, plans for each day and packing.
 * Also every goal's reminders for the bell, which start with the trips'.
 */

const MAX_COST = 10_000_000_000_000;
const idParams = z.object({ id: z.coerce.number().int().positive() });
const errorSchema = z.object({ error: z.string() }).passthrough();
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const date = z.number().int().positive().nullable().optional();
const currency = z.string().regex(/^[A-Z]{3}$/, "Use a currency code like JPY");
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a day like 2027-03-14");
const cost = z.number().min(0).max(MAX_COST);

const basicsSchema = z.object({
  places: z.array(z.string()),
  startDate: z.number().nullable(),
  endDate: z.number().nullable(),
  currency: z.string().nullable(),
  rate: z.number().nullable(),
  dailyBudget: z.number(),
  climate: z.enum(CLIMATES).nullable(),
});
const travellerSchema = z.object({
  id: z.number().int(),
  goalId: z.number().int(),
  name: z.string(),
  paying: z.boolean(),
  passportNumber: z.string().nullable(),
  passportExpiry: z.number().nullable(),
  visaStatus: z.enum(VISA_STATUSES),
  visaDate: z.number().nullable(),
  insurance: z.string().nullable(),
  sortOrder: z.number().int(),
});
const bookingSchema = z.object({
  id: z.number().int(),
  goalId: z.number().int(),
  kind: z.enum(BOOKING_KINDS),
  title: z.string(),
  startAt: z.number().nullable(),
  endAt: z.number().nullable(),
  place: z.string().nullable(),
  address: z.string().nullable(),
  code: z.string().nullable(),
  cost: z.number(),
  costCurrency: z.string(),
  rupiah: z.number(),
  cancelBy: z.number().nullable(),
  details: z.record(z.string(), z.union([z.string(), z.number()]).nullable()),
  fileIds: z.array(z.number().int()),
  partId: z.number().int().nullable(),
  paidAt: z.number().nullable(),
  paid: z.number(),
  sortOrder: z.number().int(),
});
const planSchema = z.object({
  id: z.number().int(),
  goalId: z.number().int(),
  day: z.string(),
  time: z.string().nullable(),
  title: z.string(),
  place: z.string().nullable(),
  cost: z.number(),
  costCurrency: z.string(),
  rupiah: z.number(),
  sortOrder: z.number().int(),
});
const packingSchema = z.object({
  id: z.number().int(),
  goalId: z.number().int(),
  travellerId: z.number().int().nullable(),
  text: z.string(),
  category: z.enum(PACKING_CATEGORIES),
  quantity: z.number().int(),
  bag: z.enum(PACKING_BAGS).nullable(),
  done: z.boolean(),
  sortOrder: z.number().int(),
});
const tripSchema = z.object({
  basics: basicsSchema,
  travellers: z.array(travellerSchema),
  bookings: z.array(bookingSchema),
  plans: z.array(planSchema),
  packing: z.array(packingSchema),
  spending: z.object({
    total: z.number(),
    byDay: z.array(z.object({ day: z.string(), total: z.number() })),
    byCategory: z.array(z.object({ categoryId: z.number().int(), name: z.string(), total: z.number() })),
  }).nullable(),
});

const basicsBody = z.object({
  places: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  startDate: date,
  endDate: date,
  currency: currency.nullable().optional(),
  rate: z.number().positive().max(1_000_000).nullable().optional(),
  dailyBudget: z.number().int().min(0).max(MAX_COST).optional(),
  climate: z.enum(CLIMATES).nullable().optional(),
}).strict().refine((body) => body.startDate == null || body.endDate == null || body.endDate >= body.startDate, "The trip can't end before it starts");
const travellerBody = z.object({
  name: text(80),
  paying: z.boolean().optional(),
  passportNumber: optionalText(30),
  passportExpiry: date,
  visaStatus: z.enum(VISA_STATUSES).optional(),
  visaDate: date,
  insurance: optionalText(200),
}).strict();
const detailsBody = z.record(z.string().max(40), z.union([z.string().max(200), z.number()]).nullable()).refine((value) => Object.keys(value).length <= 20, "Too many details");
const bookingBody = z.object({
  kind: z.enum(BOOKING_KINDS),
  title: text(120),
  startAt: date,
  endAt: date,
  place: optionalText(200),
  address: optionalText(300),
  code: optionalText(60),
  cost: cost.optional(),
  costCurrency: currency.optional(),
  cancelBy: date,
  details: detailsBody.optional(),
  fileIds: z.array(z.number().int().positive()).max(20).optional(),
}).strict();
const planBody = z.object({
  day: dayKey,
  time: z.string().regex(/^\d{2}:\d{2}$/, "Use a time like 09:30").nullable().optional(),
  title: text(120),
  place: optionalText(200),
  cost: cost.optional(),
  costCurrency: currency.optional(),
}).strict();
const packingBody = z.object({
  text: text(120),
  travellerId: z.number().int().positive().nullable().optional(),
  category: z.enum(PACKING_CATEGORIES).optional(),
  quantity: z.number().int().min(1).max(99).optional(),
  bag: z.enum(PACKING_BAGS).nullable().optional(),
}).strict();

const toDate = (value: number | null | undefined) => (value === undefined ? undefined : value ? new Date(value) : null);

/** Turns date fields into dates, leaving out the ones not given. */
function dated<T extends Record<string, unknown>>(body: T, keys: string[]) {
  const values: Record<string, unknown> = { ...body };
  for (const key of keys) if (key in body) values[key] = toDate(body[key] as number | null | undefined);
  return values;
}

async function checkTraveller(goalId: number, travellerId: number | null | undefined) {
  if (travellerId == null) return;
  const [row] = await db.select({ id: goalTravellers.id }).from(goalTravellers).where(and(eq(goalTravellers.id, travellerId), eq(goalTravellers.goalId, goalId))).limit(1);
  if (!row) throw new GoalError("That person isn't on this trip");
}

async function checkFiles(goalId: number, fileIds: number[] | undefined) {
  if (!fileIds?.length) return;
  const rows = await db.select({ id: goalAttachments.id }).from(goalAttachments).where(and(eq(goalAttachments.goalId, goalId), inArray(goalAttachments.id, fileIds)));
  if (rows.length !== new Set(fileIds).size) throw new GoalError("Those files aren't on this goal");
}

async function nextOrder(table: typeof goalTravellers | typeof goalBookings | typeof goalPlans | typeof goalPacking, goalId: number) {
  const [{ next }] = await db.select({ next: sql<number>`coalesce(max(${table.sortOrder}), -1) + 1` }).from(table).where(eq(table.goalId, goalId));
  return Number(next);
}

async function oneBooking(id: number) {
  const [row] = await db.select().from(goalBookings).where(eq(goalBookings.id, id)).limit(1);
  if (!row) throw new GoalError("Booking not found", 404);
  return row as typeof goalBookings.$inferSelect;
}

async function bookingView(row: typeof goalBookings.$inferSelect) {
  const goal = await tripGoal(row.goalId);
  return (await bookingViews(row.goalId, tripBasics(goal.typeData))).find((item: { id: number }) => item.id === row.id)!;
}

async function guarded<T>(reply: any, run: () => Promise<T>): Promise<T | undefined> {
  try {
    return await run();
  } catch (error) {
    const status = error instanceof GoalError ? error.status : 400;
    reply.code(status).send({ error: error instanceof Error ? error.message : "Something went wrong" });
    return undefined;
  }
}

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/goals/reminders", {
    schema: {
      operationId: "listGoalReminders",
      tags: ["goals"],
      response: {
        200: z.array(z.object({
          kind: z.enum(["cancel", "unpaid", "passport", "visa", "packing", "refill", "part-due", "thr"]),
          goalId: z.number().int(),
          goalName: z.string(),
          at: z.number(),
          name: z.string().nullable(),
          count: z.number().int(),
          amount: z.number().nullable(),
          short: z.boolean(),
        })),
      },
    },
  }, async () => goalReminders());

  fastify.get("/api/goals/:id/trip", {
    schema: { operationId: "getGoalTrip", tags: ["goals"], params: idParams, response: { 200: tripSchema, 404: errorSchema } },
  }, async (request, reply) => guarded(reply, async () => tripDetail((request.params as z.infer<typeof idParams>).id)));

  fastify.put("/api/goals/:id/trip", {
    schema: { operationId: "updateGoalTrip", tags: ["goals"], params: idParams, body: basicsBody, response: { 200: tripSchema, 400: errorSchema, 404: errorSchema } },
  }, async (request, reply) => guarded(reply, async () => {
    const { id } = request.params as z.infer<typeof idParams>;
    const body = request.body as z.infer<typeof basicsBody>;
    const goal = await tripGoal(id);
    const before = tripBasics(goal.typeData);
    const data: Record<string, unknown> = { ...parseTypeData(goal.typeData), ...body };
    if (body.currency === null) data.rate = null;
    const after = tripBasics(data);
    if (after.startDate !== null && after.endDate !== null && after.endDate < after.startDate) throw new GoalError("The trip can't end before it starts");
    await db.update(savingsGoals).set({ typeData: JSON.stringify(data), updatedAt: new Date() }).where(eq(savingsGoals.id, id));
    if (before.currency !== after.currency || before.rate !== after.rate) await syncAllBookingParts(id, after);
    return tripDetail(id);
  }));

  fastify.post("/api/goals/:id/trip/again", {
    schema: { operationId: "planTripAgain", tags: ["goals"], params: idParams, response: { 201: z.object({ id: z.number().int() }), 400: errorSchema, 404: errorSchema } },
  }, async (request, reply) => guarded(reply, async () => reply.code(201).send({ id: await planAgain((request.params as z.infer<typeof idParams>).id) })));

  fastify.post("/api/goals/:id/travellers", {
    schema: { operationId: "addTripTraveller", tags: ["goals"], params: idParams, body: travellerBody, response: { 201: travellerSchema, 400: errorSchema, 404: errorSchema } },
  }, async (request, reply) => guarded(reply, async () => {
    const { id } = request.params as z.infer<typeof idParams>;
    await tripGoal(id);
    const body = request.body as z.infer<typeof travellerBody>;
    const [created] = await db.insert(goalTravellers).values({ ...dated(body, ["passportExpiry", "visaDate"]), goalId: id, name: body.name, sortOrder: await nextOrder(goalTravellers, id) } as typeof goalTravellers.$inferInsert).returning();
    return reply.code(201).send(travellerView(created));
  }));

  fastify.patch("/api/goal-travellers/:id", {
    schema: { operationId: "updateTripTraveller", tags: ["goals"], params: idParams, body: travellerBody.partial().strict(), response: { 200: travellerSchema, 400: errorSchema, 404: errorSchema } },
  }, async (request, reply) => guarded(reply, async () => {
    const { id } = request.params as z.infer<typeof idParams>;
    const [updated] = await db.update(goalTravellers).set(dated(request.body as Record<string, unknown>, ["passportExpiry", "visaDate"])).where(eq(goalTravellers.id, id)).returning();
    if (!updated) throw new GoalError("Traveller not found", 404);
    return travellerView(updated);
  }));

  fastify.delete("/api/goal-travellers/:id", {
    schema: { operationId: "deleteTripTraveller", tags: ["goals"], params: idParams, response: { 204: z.null(), 404: errorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof idParams>;
    // Their own packing list goes with them.
    await db.delete(goalPacking).where(eq(goalPacking.travellerId, id));
    const result = await db.delete(goalTravellers).where(eq(goalTravellers.id, id)).run();
    if (result.changes === 0) return reply.code(404).send({ error: "Traveller not found" });
    return reply.code(204).send();
  });

  fastify.post("/api/goals/:id/bookings", {
    schema: { operationId: "addTripBooking", tags: ["goals"], params: idParams, body: bookingBody, response: { 201: bookingSchema, 400: errorSchema, 404: errorSchema } },
  }, async (request, reply) => guarded(reply, async () => {
    const { id } = request.params as z.infer<typeof idParams>;
    const goal = await tripGoal(id);
    const body = request.body as z.infer<typeof bookingBody>;
    await checkFiles(id, body.fileIds);
    const { details, fileIds, ...rest } = body;
    const [created] = await db.insert(goalBookings).values({
      ...dated(rest, ["startAt", "endAt", "cancelBy"]),
      goalId: id,
      title: body.title,
      details: JSON.stringify(details ?? {}),
      fileIds: JSON.stringify(fileIds ?? []),
      sortOrder: await nextOrder(goalBookings, id),
    } as typeof goalBookings.$inferInsert).returning();
    await syncBookingPart(created, tripBasics(goal.typeData));
    return reply.code(201).send(await bookingView(created));
  }));

  fastify.patch("/api/goal-bookings/:id", {
    schema: { operationId: "updateTripBooking", tags: ["goals"], params: idParams, body: bookingBody.partial().strict(), response: { 200: bookingSchema, 400: errorSchema, 404: errorSchema } },
  }, async (request, reply) => guarded(reply, async () => {
    const { id } = request.params as z.infer<typeof idParams>;
    const existing = await oneBooking(id);
    const body = request.body as Partial<z.infer<typeof bookingBody>>;
    await checkFiles(existing.goalId, body.fileIds);
    const { details, fileIds, ...rest } = body;
    const [updated] = await db.update(goalBookings).set({
      ...dated(rest, ["startAt", "endAt", "cancelBy"]),
      ...(details !== undefined ? { details: JSON.stringify(details) } : {}),
      ...(fileIds !== undefined ? { fileIds: JSON.stringify(fileIds) } : {}),
    }).where(eq(goalBookings.id, id)).returning();
    await syncBookingPart(updated, tripBasics((await tripGoal(updated.goalId)).typeData));
    return bookingView(await oneBooking(id));
  }));

  fastify.delete("/api/goal-bookings/:id", {
    schema: { operationId: "deleteTripBooking", tags: ["goals"], params: idParams, response: { 204: z.null(), 404: errorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof idParams>;
    if (!(await deleteBooking(id))) return reply.code(404).send({ error: "Booking not found" });
    return reply.code(204).send();
  });

  fastify.post("/api/goals/:id/plans", {
    schema: { operationId: "addTripPlan", tags: ["goals"], params: idParams, body: planBody, response: { 201: planSchema, 400: errorSchema, 404: errorSchema } },
  }, async (request, reply) => guarded(reply, async () => {
    const { id } = request.params as z.infer<typeof idParams>;
    const goal = await tripGoal(id);
    const body = request.body as z.infer<typeof planBody>;
    const [{ next }] = await db.select({ next: sql<number>`coalesce(max(${goalPlans.sortOrder}), -1) + 1` }).from(goalPlans).where(and(eq(goalPlans.goalId, id), eq(goalPlans.day, body.day)));
    const [created] = await db.insert(goalPlans).values({ ...body, goalId: id, sortOrder: Number(next) }).returning();
    return reply.code(201).send(planView(created, tripBasics(goal.typeData)));
  }));

  fastify.patch("/api/goal-plans/:id", {
    schema: { operationId: "updateTripPlan", tags: ["goals"], params: idParams, body: planBody.partial().strict(), response: { 200: planSchema, 400: errorSchema, 404: errorSchema } },
  }, async (request, reply) => guarded(reply, async () => {
    const { id } = request.params as z.infer<typeof idParams>;
    const [updated] = await db.update(goalPlans).set(request.body as Partial<z.infer<typeof planBody>>).where(eq(goalPlans.id, id)).returning();
    if (!updated) throw new GoalError("Plan not found", 404);
    return planView(updated, tripBasics((await tripGoal(updated.goalId)).typeData));
  }));

  fastify.put("/api/goals/:id/plans/order", {
    schema: {
      operationId: "moveTripPlans",
      tags: ["goals"],
      params: idParams,
      body: z.object({ day: dayKey, ids: z.array(z.number().int().positive()).max(200) }).strict(),
      response: { 200: z.array(planSchema), 400: errorSchema, 404: errorSchema },
    },
  }, async (request, reply) => guarded(reply, async () => {
    // A day's plans in the order given; a plan from another day moves to this one.
    const { id } = request.params as z.infer<typeof idParams>;
    const { day, ids } = request.body as { day: string; ids: number[] };
    const goal = await tripGoal(id);
    const own = await db.select({ id: goalPlans.id }).from(goalPlans).where(and(eq(goalPlans.goalId, id), inArray(goalPlans.id, ids.length ? ids : [0])));
    const known = new Set(own.map((row: { id: number }) => row.id));
    for (const [index, planId] of ids.filter((planId) => known.has(planId)).entries()) {
      await db.update(goalPlans).set({ day, sortOrder: index }).where(eq(goalPlans.id, planId));
    }
    const rows = await db.select().from(goalPlans).where(eq(goalPlans.goalId, id)).orderBy(asc(goalPlans.day), asc(goalPlans.sortOrder), asc(goalPlans.id));
    return rows.map((row: typeof goalPlans.$inferSelect) => planView(row, tripBasics(goal.typeData)));
  }));

  fastify.delete("/api/goal-plans/:id", {
    schema: { operationId: "deleteTripPlan", tags: ["goals"], params: idParams, response: { 204: z.null(), 404: errorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof idParams>;
    const result = await db.delete(goalPlans).where(eq(goalPlans.id, id)).run();
    if (result.changes === 0) return reply.code(404).send({ error: "Plan not found" });
    return reply.code(204).send();
  });

  fastify.post("/api/goals/:id/packing", {
    schema: {
      operationId: "addTripPacking",
      tags: ["goals"],
      params: idParams,
      body: z.object({ items: z.array(packingBody).min(1).max(100) }).strict(),
      response: { 201: z.array(packingSchema), 400: errorSchema, 404: errorSchema },
    },
  }, async (request, reply) => guarded(reply, async () => {
    const { id } = request.params as z.infer<typeof idParams>;
    await tripGoal(id);
    const { items } = request.body as { items: Array<z.infer<typeof packingBody>> };
    for (const travellerId of new Set(items.map((item) => item.travellerId))) await checkTraveller(id, travellerId);
    const start = await nextOrder(goalPacking, id);
    const created = await db.insert(goalPacking).values(items.map((item, index) => ({
      goalId: id,
      text: item.text,
      travellerId: item.travellerId ?? null,
      category: item.category ?? "other",
      quantity: item.quantity ?? 1,
      bag: item.bag ?? null,
      sortOrder: start + index,
    }))).returning();
    return reply.code(201).send(created.map(packingView));
  }));

  fastify.put("/api/goals/:id/packing/order", {
    schema: {
      operationId: "moveTripPacking",
      tags: ["goals"],
      params: idParams,
      body: z.object({ bag: z.enum(PACKING_BAGS).nullable(), ids: z.array(z.number().int().positive()).max(300) }).strict(),
      response: { 200: z.array(packingSchema), 404: errorSchema },
    },
  }, async (request, reply) => guarded(reply, async () => {
    // A bag's items in the order given; an item from another bag moves into this one.
    const { id } = request.params as z.infer<typeof idParams>;
    const { bag, ids } = request.body as { bag: (typeof PACKING_BAGS)[number] | null; ids: number[] };
    await tripGoal(id);
    const own = await db.select({ id: goalPacking.id }).from(goalPacking).where(and(eq(goalPacking.goalId, id), inArray(goalPacking.id, ids.length ? ids : [0])));
    const known = new Set(own.map((row: { id: number }) => row.id));
    for (const [index, itemId] of ids.filter((itemId) => known.has(itemId)).entries()) {
      await db.update(goalPacking).set({ bag, sortOrder: index }).where(eq(goalPacking.id, itemId));
    }
    const rows = await db.select().from(goalPacking).where(eq(goalPacking.goalId, id)).orderBy(asc(goalPacking.sortOrder), asc(goalPacking.id));
    return rows.map(packingView);
  }));

  fastify.patch("/api/goal-packing/:id", {
    schema: {
      operationId: "updateTripPacking",
      tags: ["goals"],
      params: idParams,
      body: packingBody.partial().extend({ done: z.boolean().optional() }).strict(),
      response: { 200: packingSchema, 400: errorSchema, 404: errorSchema },
    },
  }, async (request, reply) => guarded(reply, async () => {
    const { id } = request.params as z.infer<typeof idParams>;
    const body = request.body as Partial<z.infer<typeof packingBody>> & { done?: boolean };
    const [existing] = await db.select().from(goalPacking).where(eq(goalPacking.id, id)).limit(1);
    if (!existing) throw new GoalError("Item not found", 404);
    await checkTraveller(existing.goalId, body.travellerId);
    const [updated] = await db.update(goalPacking).set(body).where(eq(goalPacking.id, id)).returning();
    return packingView(updated);
  }));

  fastify.delete("/api/goal-packing/:id", {
    schema: { operationId: "deleteTripPacking", tags: ["goals"], params: idParams, response: { 204: z.null(), 404: errorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof idParams>;
    const result = await db.delete(goalPacking).where(eq(goalPacking.id, id)).run();
    if (result.changes === 0) return reply.code(404).send({ error: "Item not found" });
    return reply.code(204).send();
  });
}
