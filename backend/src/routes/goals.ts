import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { db } from "../db/client";
import { accounts, categories, goalAllocations, goalAttachments, goalParts, goalSettings, savingsGoals, storageDeletionOutbox, transactions, wishlist } from "../db/schema";
import { milestones, streak } from "../services/goal-progress";
import { allocate, completeGoal, fundMonthly, GoalError, goalsOverview, setAsideByGoal, setExcludedAccountIds, spendFromGoal } from "../services/goals";
import { processStorageDeletionOutbox } from "../services/storage-cleanup";
import { queueFileCleanup } from "./goal-files";

const MAX_AMOUNT = 10_000_000_000_000;
const amount = z.number().int().min(0).max(MAX_AMOUNT);
const idParams = z.object({ id: z.coerce.number().int().positive() });
const errorSchema = z.object({ error: z.string() }).passthrough();
const kindSchema = z.enum(["spend", "keep"]);
const statusSchema = z.enum(["active", "done", "archived"]);
const recurrenceSchema = z.enum(["none", "yearly"]);

const goalSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  targetAmount: z.number(),
  byDate: z.number().nullable(),
  kind: kindSchema,
  monthlyAmount: z.number(),
  monthlyPercent: z.number().nullable(),
  status: statusSchema,
  paused: z.boolean(),
  wishlistId: z.number().int().nullable(),
  spentTransactionId: z.number().int().nullable(),
  doneAt: z.number().nullable(),
  sortOrder: z.number().int(),
  icon: z.string().nullable(),
  description: z.string().nullable(),
  linkUrl: z.string().nullable(),
  linkTitle: z.string().nullable(),
  linkImage: z.string().nullable(),
  accountId: z.number().int().nullable(),
  expectedReturn: z.number(),
  recurrence: recurrenceSchema,
  categoryId: z.number().int().nullable(),
  categorySince: z.number().nullable(),
  setAside: z.number(),
  setAsideThisMonth: z.number(),
  reachMonths: z.number().int().nullable(),
  coverAttachmentId: z.number().int().nullable(),
});
const overviewSchema = z.object({
  available: z.number(),
  setAside: z.number(),
  unassigned: z.number(),
  accounts: z.array(z.object({ id: z.number().int(), name: z.string(), liquidityClass: z.string(), balance: z.number(), included: z.boolean() })),
  goals: z.array(goalSchema),
  /** Your latest take-home pay, which a goal's monthly share is worked out from. */
  salary: z.number().nullable(),
  autoFundOnPayday: z.boolean(),
});
const allocationSchema = z.object({
  id: z.number().int(),
  goalId: z.number().int(),
  amount: z.number(),
  kind: z.string(),
  note: z.string().nullable(),
  transactionId: z.number().int().nullable(),
  transactionDescription: z.string().nullable(),
  partId: z.number().int().nullable(),
  createdAt: z.number(),
});
const partSchema = z.object({
  id: z.number().int(),
  goalId: z.number().int(),
  name: z.string(),
  amount: z.number(),
  paidAt: z.number().nullable(),
  transactionId: z.number().int().nullable(),
  sortOrder: z.number().int(),
});
const attachmentSchema = z.object({
  id: z.number().int(),
  goalId: z.number().int(),
  filename: z.string(),
  mimetype: z.string(),
  fileSize: z.number().int(),
  isCover: z.boolean(),
  createdAt: z.number(),
});
const detailSchema = z.object({
  goal: goalSchema,
  parts: z.array(partSchema),
  attachments: z.array(attachmentSchema),
  milestones: z.array(z.object({ share: z.number().int(), at: z.number() })),
  /** Months in a row it got its monthly amount. */
  streak: z.number().int(),
  /** What the account it sits in holds, and what all goals in that account hold together. */
  account: z.object({ id: z.number().int(), name: z.string(), balance: z.number(), goalsHold: z.number() }).nullable(),
  categoryName: z.string().nullable(),
});

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();
const goalFields = {
  name: z.string().trim().min(1).max(120),
  targetAmount: amount.refine((value) => value > 0, "Enter what it costs"),
  byDate: z.number().int().positive().nullable().optional(),
  kind: kindSchema.optional(),
  monthlyAmount: amount.optional(),
  monthlyPercent: z.number().gt(0).max(100).nullable().optional(),
  wishlistId: z.number().int().positive().nullable().optional(),
  icon: nullableText(16),
  description: nullableText(20_000),
  linkUrl: z.string().trim().url().max(2000).refine((value) => /^https?:\/\//i.test(value), "Use a web address").nullable().optional(),
  linkTitle: nullableText(300),
  /** A picture the link preview stored. */
  linkImage: z.string().trim().max(300).regex(/^wishlist-images\/[A-Za-z0-9._-]+$/).nullable().optional(),
  accountId: z.number().int().positive().nullable().optional(),
  expectedReturn: z.number().min(-20).max(50).optional(),
  recurrence: recurrenceSchema.optional(),
  categoryId: z.number().int().positive().nullable().optional(),
  categorySince: z.number().int().positive().nullable().optional(),
};
const goalBody = z.object({
  ...goalFields,
  /** Money to set aside for it straight away, from what's unassigned. */
  setAside: amount.optional(),
}).strict();
const goalPatch = z.object(goalFields).partial().extend({
  status: z.enum(["active", "archived"]).optional(),
  paused: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
}).strict();
const partBody = z.object({ name: z.string().trim().min(1).max(120), amount }).strict();

async function checkWishlist(wishlistId: number | null | undefined) {
  if (wishlistId == null) return;
  const [row] = await db.select({ id: wishlist.id }).from(wishlist).where(eq(wishlist.id, wishlistId)).limit(1);
  if (!row) throw new GoalError("Wishlist item not found");
}

async function checkAccounts(ids: number[], message = "Only your own asset accounts can be left out") {
  if (!ids.length) return;
  const rows = await db.select({ id: accounts.id }).from(accounts).where(and(inArray(accounts.id, ids), eq(accounts.type, "asset"), isNull(accounts.systemKey)));
  if (rows.length !== new Set(ids).size) throw new GoalError(message);
}

async function checkCategory(categoryId: number | null | undefined) {
  if (categoryId == null) return;
  const [row] = await db.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId)).limit(1);
  if (!row) throw new GoalError("Category not found");
}

async function checkTransaction(transactionId: number | null | undefined) {
  if (transactionId == null) return;
  const [row] = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.id, transactionId)).limit(1);
  if (!row) throw new GoalError("Transaction not found");
}

/** Checks a goal's links to other records before it's saved. */
async function checkLinks(body: { wishlistId?: number | null; accountId?: number | null; categoryId?: number | null }) {
  await checkWishlist(body.wishlistId);
  if (body.accountId != null) await checkAccounts([body.accountId], "Pick one of your own asset accounts");
  await checkCategory(body.categoryId);
}

/** Turns the body's fields into column values: dates become dates, and a category starts counting today. */
function columns(body: Partial<z.infer<typeof goalPatch>>, existing?: typeof savingsGoals.$inferSelect) {
  const { byDate, categorySince, paused, ...rest } = body;
  const values: Record<string, unknown> = { ...rest };
  if (byDate !== undefined) values.byDate = byDate ? new Date(byDate) : null;
  if (body.categoryId !== undefined) {
    // Expenses count from when the category is chosen, unless you say from when.
    const since = categorySince ?? (body.categoryId && body.categoryId !== existing?.categoryId ? Date.now() : existing?.categorySince?.getTime() ?? null);
    values.categorySince = body.categoryId ? new Date(since ?? Date.now()) : null;
  } else if (categorySince !== undefined) {
    values.categorySince = categorySince ? new Date(categorySince) : null;
  }
  if (paused !== undefined) values.pausedAt = paused ? (existing?.pausedAt ?? new Date()) : null;
  // A share of salary replaces the fixed amount, and the other way round.
  if (body.monthlyPercent != null) values.monthlyAmount = 0;
  if (body.monthlyAmount !== undefined && body.monthlyPercent === undefined) values.monthlyPercent = null;
  return values;
}

async function oneGoal(id: number) {
  const goal = (await goalsOverview()).goals.find((item) => item.id === id);
  if (!goal) throw new GoalError("Goal not found", 404);
  return goal;
}

const partView = (row: typeof goalParts.$inferSelect) => ({
  id: row.id,
  goalId: row.goalId,
  name: row.name,
  amount: row.amount,
  paidAt: row.paidAt ? row.paidAt.getTime() : null,
  transactionId: row.transactionId ?? null,
  sortOrder: row.sortOrder,
});

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
    await checkLinks(body);
    if (body.setAside && body.setAside > (await goalsOverview()).unassigned) throw new GoalError("That's more than is unassigned", 409);
    const [{ next }] = await db.select({ next: sql<number>`coalesce(max(${savingsGoals.sortOrder}), -1) + 1` }).from(savingsGoals);
    const { setAside, ...fields } = body;
    const [created] = await db.insert(savingsGoals).values({
      kind: "spend",
      monthlyAmount: 0,
      ...columns(fields),
      name: body.name,
      targetAmount: body.targetAmount,
      sortOrder: Number(next),
    } as typeof savingsGoals.$inferInsert).returning();
    if (setAside) await allocate(created.id, setAside, "Already saved when added");
    return reply.code(201).send(await oneGoal(created.id));
  }));

  // Static paths before `/api/goals/:id`, so they aren't read as an id.
  fastify.put("/api/goals/order", {
    schema: {
      operationId: "reorderGoals",
      tags: ["goals"],
      body: z.object({ ids: z.array(z.number().int().positive()).min(1).max(500) }).strict(),
      response: { 200: overviewSchema, 400: errorSchema },
    },
  }, async (request, reply) => guarded(reply, async () => {
    const ids = [...new Set((request.body as { ids: number[] }).ids)];
    // The order given first, then any goals it left out, in their old order.
    const rows = await db.select({ id: savingsGoals.id }).from(savingsGoals).orderBy(asc(savingsGoals.sortOrder), asc(savingsGoals.id));
    const known = new Set(rows.map((row: { id: number }) => row.id));
    const ordered = [...ids.filter((id) => known.has(id)), ...rows.map((row: { id: number }) => row.id).filter((id: number) => !ids.includes(id))];
    for (const [index, id] of ordered.entries()) await db.update(savingsGoals).set({ sortOrder: index }).where(eq(savingsGoals.id, id));
    return goalsOverview();
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
      body: z.object({ excludedAccountIds: z.array(z.number().int().positive()).max(200).optional(), autoFundOnPayday: z.boolean().optional() }).strict(),
      response: { 200: overviewSchema, 400: errorSchema },
    },
  }, async (request, reply) => guarded(reply, async () => {
    const body = request.body as { excludedAccountIds?: number[]; autoFundOnPayday?: boolean };
    if (body.excludedAccountIds) {
      await checkAccounts(body.excludedAccountIds);
      await setExcludedAccountIds(body.excludedAccountIds);
    }
    if (body.autoFundOnPayday !== undefined) {
      await db.insert(goalSettings).values({ id: 1, autoFundOnPayday: body.autoFundOnPayday })
        .onConflictDoUpdate({ target: goalSettings.id, set: { autoFundOnPayday: body.autoFundOnPayday } });
    }
    return goalsOverview();
  }));

  fastify.get("/api/goals/:id", {
    schema: { operationId: "getGoal", tags: ["goals"], params: idParams, response: { 200: detailSchema, 404: errorSchema } },
  }, async (request, reply) => guarded(reply, async () => {
    const { id } = request.params as z.infer<typeof idParams>;
    const overview = await goalsOverview();
    const goal = overview.goals.find((item) => item.id === id);
    if (!goal) throw new GoalError("Goal not found", 404);
    const [parts, files, history] = await Promise.all([
      db.select().from(goalParts).where(eq(goalParts.goalId, id)).orderBy(asc(goalParts.sortOrder), asc(goalParts.id)),
      db.select().from(goalAttachments).where(eq(goalAttachments.goalId, id)).orderBy(asc(goalAttachments.createdAt), asc(goalAttachments.id)),
      db.select({ amount: goalAllocations.amount, kind: goalAllocations.kind, createdAt: goalAllocations.createdAt }).from(goalAllocations).where(eq(goalAllocations.goalId, id)),
    ]);
    const entries = history.map((row: { amount: number; kind: string; createdAt: Date }) => ({ amount: row.amount, kind: row.kind, createdAt: row.createdAt.getTime() }));
    let account = null;
    if (goal.accountId != null) {
      const [row] = await db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(eq(accounts.id, goal.accountId)).limit(1);
      const listed = overview.accounts.find((item) => item.id === goal.accountId);
      const { computeAccountBalance } = await import("../services/ledger");
      if (row) {
        account = {
          id: row.id,
          name: row.name,
          balance: listed?.balance ?? await computeAccountBalance(row.id),
          goalsHold: overview.goals.filter((item) => item.status === "active" && item.accountId === row.id).reduce((sum, item) => sum + item.setAside, 0),
        };
      }
    }
    let categoryName = null;
    if (goal.categoryId != null) {
      const [row] = await db.select({ name: categories.name }).from(categories).where(eq(categories.id, goal.categoryId)).limit(1);
      categoryName = row?.name ?? null;
    }
    return {
      goal,
      parts: parts.map(partView),
      attachments: files.map((row: typeof goalAttachments.$inferSelect) => ({ id: row.id, goalId: row.goalId, filename: row.filename, mimetype: row.mimetype, fileSize: row.fileSize, isCover: Boolean(row.isCover), createdAt: row.createdAt.getTime() })),
      milestones: milestones(entries, goal.targetAmount),
      streak: goal.paused ? 0 : streak(entries, goal.monthlyAmount),
      account,
      categoryName,
    };
  }));

  fastify.patch("/api/goals/:id", {
    schema: { operationId: "updateGoal", tags: ["goals"], params: idParams, body: goalPatch, response: { 200: goalSchema, 400: errorSchema, 404: errorSchema } },
  }, async (request, reply) => guarded(reply, async () => {
    const { id } = request.params as z.infer<typeof idParams>;
    const body = request.body as z.infer<typeof goalPatch>;
    const [existing] = await db.select().from(savingsGoals).where(eq(savingsGoals.id, id)).limit(1);
    if (!existing) throw new GoalError("Goal not found", 404);
    await checkLinks(body);
    await db.update(savingsGoals).set({ ...columns(body, existing), updatedAt: new Date() }).where(eq(savingsGoals.id, id));
    // A replaced link picture is deleted from storage.
    if (body.linkImage !== undefined && existing.linkImage && existing.linkImage !== body.linkImage) {
      await queueFileCleanup([{ r2Key: existing.linkImage, entityType: "goal_link_image", entityId: id }]);
    }
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
    // Its files and link picture are queued for deletion with the goal, so storage never keeps them.
    const outboxIds = db.transaction((tx: any) => {
      const goal = tx.select({ linkImage: savingsGoals.linkImage }).from(savingsGoals).where(eq(savingsGoals.id, id)).limit(1).all()[0];
      if (!goal) return null;
      const files = tx.select({ id: goalAttachments.id, r2Key: goalAttachments.r2Key }).from(goalAttachments).where(eq(goalAttachments.goalId, id)).all();
      const keys = [
        ...files.map((file: { id: number; r2Key: string }) => ({ r2Key: file.r2Key, entityType: "goal_attachment", entityId: file.id })),
        ...(goal.linkImage ? [{ r2Key: goal.linkImage, entityType: "goal_link_image", entityId: id }] : []),
      ];
      const queued = keys.length ? tx.insert(storageDeletionOutbox).values(keys).returning({ id: storageDeletionOutbox.id }).all() : [];
      tx.delete(savingsGoals).where(eq(savingsGoals.id, id)).run();
      return queued.map((row: { id: number }) => row.id);
    });
    if (outboxIds === null) return reply.code(404).send({ error: "Goal not found" });
    if (outboxIds.length) void processStorageDeletionOutbox(outboxIds);
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
      partId: allocation.partId ?? null,
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

  fastify.post("/api/goals/:id/spend", {
    schema: {
      operationId: "spendFromGoal",
      tags: ["goals"],
      params: idParams,
      body: z.object({
        amount: amount.refine((value) => value > 0, "Enter an amount"),
        transactionId: z.number().int().positive().nullable().optional(),
        partId: z.number().int().positive().nullable().optional(),
        note: z.string().trim().max(200).nullable().optional(),
      }).strict(),
      response: { 200: goalSchema, 400: errorSchema, 404: errorSchema, 409: errorSchema },
    },
  }, async (request, reply) => guarded(reply, async () => {
    const { id } = request.params as z.infer<typeof idParams>;
    const body = request.body as { amount: number; transactionId?: number | null; partId?: number | null; note?: string | null };
    await checkTransaction(body.transactionId);
    await spendFromGoal(id, { amount: body.amount, transactionId: body.transactionId ?? null, partId: body.partId ?? null, note: body.note ?? null });
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
    await checkTransaction(transactionId);
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

  fastify.post("/api/goals/:id/parts", {
    schema: { operationId: "addGoalPart", tags: ["goals"], params: idParams, body: partBody, response: { 201: partSchema, 400: errorSchema, 404: errorSchema } },
  }, async (request, reply) => guarded(reply, async () => {
    const { id } = request.params as z.infer<typeof idParams>;
    await oneGoal(id);
    const body = request.body as z.infer<typeof partBody>;
    const [{ next }] = await db.select({ next: sql<number>`coalesce(max(${goalParts.sortOrder}), -1) + 1` }).from(goalParts).where(eq(goalParts.goalId, id));
    const [created] = await db.insert(goalParts).values({ goalId: id, name: body.name, amount: body.amount, sortOrder: Number(next) }).returning();
    return reply.code(201).send(partView(created));
  }));

  fastify.patch("/api/goal-parts/:id", {
    schema: {
      operationId: "updateGoalPart",
      tags: ["goals"],
      params: idParams,
      body: partBody.partial().extend({ paid: z.boolean().optional(), sortOrder: z.number().int().optional() }).strict(),
      response: { 200: partSchema, 400: errorSchema, 404: errorSchema },
    },
  }, async (request, reply) => guarded(reply, async () => {
    const { id } = request.params as z.infer<typeof idParams>;
    const { paid, ...rest } = request.body as Partial<z.infer<typeof partBody>> & { paid?: boolean; sortOrder?: number };
    const [existing] = await db.select().from(goalParts).where(eq(goalParts.id, id)).limit(1);
    if (!existing) throw new GoalError("Part not found", 404);
    const [updated] = await db.update(goalParts).set({ ...rest, ...(paid !== undefined ? { paidAt: paid ? (existing.paidAt ?? new Date()) : null } : {}) }).where(eq(goalParts.id, id)).returning();
    return partView(updated);
  }));

  fastify.delete("/api/goal-parts/:id", {
    schema: { operationId: "deleteGoalPart", tags: ["goals"], params: idParams, response: { 204: z.null(), 404: errorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof idParams>;
    const result = await db.delete(goalParts).where(eq(goalParts.id, id)).run();
    if (result.changes === 0) return reply.code(404).send({ error: "Part not found" });
    return reply.code(204).send();
  });
}
