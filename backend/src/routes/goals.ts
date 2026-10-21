import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { db } from "../db/client";
import { accounts, goalAllocations, savingsGoals, transactions, wishlist } from "../db/schema";
import { allocate, completeGoal, fundMonthly, GoalError, goalsOverview, goalView, setAsideByGoal, setAsideThisMonth, setExcludedAccountIds } from "../services/goals";

const MAX_AMOUNT = 10_000_000_000_000;
const amount = z.number().int().min(0).max(MAX_AMOUNT);
const idParams = z.object({ id: z.coerce.number().int().positive() });
const errorSchema = z.object({ error: z.string() }).passthrough();
const kindSchema = z.enum(["spend", "keep"]);
const statusSchema = z.enum(["active", "done", "archived"]);

const goalSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  targetAmount: z.number(),
  byDate: z.number().nullable(),
  kind: kindSchema,
  monthlyAmount: z.number(),
  status: statusSchema,
  wishlistId: z.number().int().nullable(),
  spentTransactionId: z.number().int().nullable(),
  doneAt: z.number().nullable(),
  sortOrder: z.number().int(),
  setAside: z.number(),
  setAsideThisMonth: z.number(),
});
const overviewSchema = z.object({
  available: z.number(),
  setAside: z.number(),
  unassigned: z.number(),
  accounts: z.array(z.object({ id: z.number().int(), name: z.string(), liquidityClass: z.string(), balance: z.number(), included: z.boolean() })),
  goals: z.array(goalSchema),
});
const allocationSchema = z.object({
  id: z.number().int(),
  goalId: z.number().int(),
  amount: z.number(),
  kind: z.string(),
  note: z.string().nullable(),
  transactionId: z.number().int().nullable(),
  transactionDescription: z.string().nullable(),
  createdAt: z.number(),
});

const goalBody = z.object({
  name: z.string().trim().min(1).max(120),
  targetAmount: amount.refine((value) => value > 0, "Enter what it costs"),
  byDate: z.number().int().positive().nullable().optional(),
  kind: kindSchema.optional(),
  monthlyAmount: amount.optional(),
  wishlistId: z.number().int().positive().nullable().optional(),
  /** Money to set aside for it straight away, from what's unassigned. */
  setAside: amount.optional(),
}).strict();
const goalPatch = goalBody.omit({ setAside: true }).partial().extend({ status: z.enum(["active", "archived"]).optional(), sortOrder: z.number().int().optional() }).strict();
async function checkWishlist(wishlistId: number | null | undefined) {
  if (wishlistId == null) return;
  const [row] = await db.select({ id: wishlist.id }).from(wishlist).where(eq(wishlist.id, wishlistId)).limit(1);
  if (!row) throw new GoalError("Wishlist item not found");
}

async function checkAccounts(ids: number[]) {
  if (!ids.length) return;
  const rows = await db.select({ id: accounts.id }).from(accounts).where(and(inArray(accounts.id, ids), eq(accounts.type, "asset"), isNull(accounts.systemKey)));
  if (rows.length !== new Set(ids).size) throw new GoalError("Only your own asset accounts can be left out");
}

async function oneGoal(id: number) {
  const [row] = await db.select().from(savingsGoals).where(eq(savingsGoals.id, id)).limit(1);
  if (!row) throw new GoalError("Goal not found", 404);
  return goalView(row, (await setAsideByGoal()).get(id) ?? 0, (await setAsideThisMonth()).get(id) ?? 0);
}

/** Runs a handler, turning goal errors into their status and others into a 400. */
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

  fastify.get("/api/goals", {
    schema: { operationId: "getGoalsOverview", tags: ["goals"], response: { 200: overviewSchema } },
  }, async () => goalsOverview());

  fastify.post("/api/goals", {
    schema: { operationId: "createGoal", tags: ["goals"], body: goalBody, response: { 201: goalSchema, 400: errorSchema, 409: errorSchema } },
  }, async (request, reply) => guarded(reply, async () => {
    const body = request.body as z.infer<typeof goalBody>;
    await checkWishlist(body.wishlistId);
    if (body.setAside && body.setAside > (await goalsOverview()).unassigned) throw new GoalError("That's more than is unassigned", 409);
    const [{ next }] = await db.select({ next: sql<number>`coalesce(max(${savingsGoals.sortOrder}), -1) + 1` }).from(savingsGoals);
    const [created] = await db.insert(savingsGoals).values({
      name: body.name,
      targetAmount: body.targetAmount,
      byDate: body.byDate ? new Date(body.byDate) : null,
      kind: body.kind ?? "spend",
      monthlyAmount: body.monthlyAmount ?? 0,
      wishlistId: body.wishlistId ?? null,
      sortOrder: Number(next),
    }).returning();
    if (body.setAside) await allocate(created.id, body.setAside, "Set aside when created");
    return reply.code(201).send(await oneGoal(created.id));
  }));

  fastify.patch("/api/goals/:id", {
    schema: { operationId: "updateGoal", tags: ["goals"], params: idParams, body: goalPatch, response: { 200: goalSchema, 400: errorSchema, 404: errorSchema } },
  }, async (request, reply) => guarded(reply, async () => {
    const { id } = request.params as z.infer<typeof idParams>;
    const body = request.body as z.infer<typeof goalPatch>;
    await oneGoal(id);
    await checkWishlist(body.wishlistId);
    const { byDate, ...rest } = body;
    await db.update(savingsGoals).set({ ...rest, ...(byDate !== undefined ? { byDate: byDate ? new Date(byDate) : null } : {}), updatedAt: new Date() }).where(eq(savingsGoals.id, id));
    // An archived goal lets its money go back to unassigned.
    if (body.status === "archived") {
      const holds = (await setAsideByGoal()).get(id) ?? 0;
      if (holds) await db.insert(goalAllocations).values({ goalId: id, amount: -holds, kind: "release", note: "Archived" });
    }
    return oneGoal(id);
  }));

  fastify.delete("/api/goals/:id", {
    schema: { operationId: "deleteGoal", tags: ["goals"], params: idParams, response: { 204: z.null(), 404: errorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof idParams>;
    const result = await db.delete(savingsGoals).where(eq(savingsGoals.id, id)).run();
    if (result.changes === 0) return reply.code(404).send({ error: "Goal not found" });
    return reply.code(204).send();
  });

  fastify.get("/api/goals/:id/allocations", {
    schema: { operationId: "listGoalAllocations", tags: ["goals"], params: idParams, response: { 200: z.array(allocationSchema) } },
  }, async (request) => {
    const { id } = request.params as z.infer<typeof idParams>;
    const rows = await db
      .select({ allocation: goalAllocations, description: transactions.description })
      .from(goalAllocations)
      .leftJoin(transactions, eq(goalAllocations.transactionId, transactions.id))
      .where(eq(goalAllocations.goalId, id))
      .orderBy(desc(goalAllocations.createdAt), desc(goalAllocations.id));
    return rows.map(({ allocation, description }: { allocation: typeof goalAllocations.$inferSelect; description: string | null }) => ({
      id: allocation.id,
      goalId: allocation.goalId,
      amount: allocation.amount,
      kind: allocation.kind,
      note: allocation.note ?? null,
      transactionId: allocation.transactionId ?? null,
      transactionDescription: description ?? null,
      createdAt: allocation.createdAt.getTime(),
    }));
  });

  fastify.post("/api/goals/:id/allocations", {
    schema: {
      operationId: "allocateToGoal",
      tags: ["goals"],
      params: idParams,
      body: z.object({ amount: z.number().int().min(-MAX_AMOUNT).max(MAX_AMOUNT), note: z.string().trim().max(200).nullable().optional() }).strict(),
      response: { 200: goalSchema, 400: errorSchema, 404: errorSchema, 409: errorSchema },
    },
  }, async (request, reply) => guarded(reply, async () => {
    const { id } = request.params as z.infer<typeof idParams>;
    const body = request.body as { amount: number; note?: string | null };
    await allocate(id, body.amount, body.note ?? null);
    return oneGoal(id);
  }));

  fastify.post("/api/goals/:id/complete", {
    schema: {
      operationId: "completeGoal",
      tags: ["goals"],
      params: idParams,
      body: z.object({ transactionId: z.number().int().positive().nullable().optional() }).strict(),
      response: { 200: goalSchema, 400: errorSchema, 404: errorSchema, 409: errorSchema },
    },
  }, async (request, reply) => guarded(reply, async () => {
    const { id } = request.params as z.infer<typeof idParams>;
    const transactionId = (request.body as { transactionId?: number | null }).transactionId ?? null;
    if (transactionId) {
      const [row] = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.id, transactionId)).limit(1);
      if (!row) throw new GoalError("Transaction not found");
    }
    await completeGoal(id, transactionId);
    return oneGoal(id);
  }));

  fastify.post("/api/goals/:id/reopen", {
    schema: { operationId: "reopenGoal", tags: ["goals"], params: idParams, response: { 200: goalSchema, 404: errorSchema } },
  }, async (request, reply) => guarded(reply, async () => {
    const { id } = request.params as z.infer<typeof idParams>;
    await oneGoal(id);
    await db.update(savingsGoals).set({ status: "active", doneAt: null, spentTransactionId: null, updatedAt: new Date() }).where(eq(savingsGoals.id, id));
    return oneGoal(id);
  }));

  fastify.post("/api/goals/fund-monthly", {
    schema: {
      operationId: "fundGoalsMonthly",
      tags: ["goals"],
      body: z.object({ goalIds: z.array(z.number().int().positive()).max(200).nullable().optional() }).strict(),
      response: { 200: z.object({ assigned: z.array(z.object({ goalId: z.number().int(), amount: z.number() })), total: z.number() }) },
    },
  }, async (request) => fundMonthly((request.body as { goalIds?: number[] | null }).goalIds ?? null));

  fastify.put("/api/goals/settings", {
    schema: {
      operationId: "updateGoalSettings",
      tags: ["goals"],
      body: z.object({ excludedAccountIds: z.array(z.number().int().positive()).max(200) }).strict(),
      response: { 200: overviewSchema, 400: errorSchema },
    },
  }, async (request, reply) => guarded(reply, async () => {
    const ids = (request.body as { excludedAccountIds: number[] }).excludedAccountIds;
    await checkAccounts(ids);
    await setExcludedAccountIds(ids);
    return goalsOverview();
  }));
}
