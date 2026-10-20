import { eq, desc, asc, inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { db } from "../db/client";
import { subscriptions, accounts, categories } from "../db/schema";
import { auditCreate, auditUpdate } from "../services/audit";
import {
  applySubscriptionOccurrences,
  correctSubscriptionOccurrence,
  findOccurrenceCandidates,
  getSubscriptionHistory,
  lastPaymentsBySubscription,
  lastResolvedDueAt,
  previewDueSubscriptionRenewals,
  resolveSubscriptionOccurrences,
  subscriptionChargesByMonth,
  subscriptionPaymentAccountProblem,
  unpaidRenewalsByMonth,
  unlinkSubscriptionOccurrence,
  voidSubscriptionOccurrence,
  type OccurrenceResolution,
} from "../services/subscription-renewals";
import { BILLING_CYCLES, monthlyEquivalent } from "../services/subscription-schedule";

type SubRow = typeof subscriptions.$inferSelect;

const ms = (v: Date | number) => (v instanceof Date ? v.getTime() : Number(v));
const msOrNull = (v: Date | number | null) => (v == null ? null : ms(v));

async function serializeSubscriptions(rows: SubRow[]) {
  const accountIds = [...new Set(rows.map((row) => row.linkedAccountId))];
  const accountRows = accountIds.length === 0 ? [] : await db.select({ id: accounts.id, name: accounts.name, type: accounts.type })
    .from(accounts).where(inArray(accounts.id, accountIds));
  const accountById = new Map(accountRows.map((row: { id: number; name: string; type: string }) => [row.id, row] as const));
  const lastPayments = await lastPaymentsBySubscription(rows.map((row) => row.id));
  return rows.map((row) => {
    const account = accountById.get(row.linkedAccountId) as { name: string; type: string } | undefined;
    return {
      id: row.id,
      name: row.name,
      linkedAccountId: row.linkedAccountId,
      linkedAccountName: account?.name ?? "Unknown",
      linkedAccountType: account?.type ?? null,
      categoryId: row.categoryId ?? null,
      amount: row.amount,
      billingCycle: row.billingCycle,
      intervalCount: row.intervalCount,
      monthlyEquivalent: Math.round(monthlyEquivalent(row.amount, row)),
      nextRenewalAt: ms(row.nextRenewalAt as Date | number),
      billingDay: row.billingDay ?? null,
      status: row.status,
      paymentMode: row.paymentMode,
      trialEndsAt: msOrNull(row.trialEndsAt as Date | null),
      endsAt: msOrNull(row.endsAt as Date | null),
      currency: row.currency ?? null,
      foreignAmount: row.foreignAmount ?? null,
      notes: row.notes ?? null,
      serviceType: row.serviceType ?? null,
      lastPayment: lastPayments.get(row.id) ?? null,
      iconKey: row.iconKey,
      sortOrder: row.sortOrder,
      createdAt: ms(row.createdAt as Date | number),
      updatedAt: ms(row.updatedAt as Date | number),
    };
  });
}

async function serializeSubscription(row: SubRow) {
  return (await serializeSubscriptions([row]))[0];
}

const ICON_KEYS = ["car", "film", "music", "signal", "sparkles", "default"] as const;

const subscriptionErrorSchema = z.object({ error: z.string() }).passthrough();
const subscriptionIdParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const subscriptionOccurrenceParamsSchema = subscriptionIdParamsSchema.extend({ dueAt: z.coerce.number().int().nonnegative() });
const subscriptionStatusSchema = z.enum(["active", "paused", "cancelled"]);
const subscriptionIconSchema = z.enum(ICON_KEYS);
const subscriptionBillingCycleSchema = z.enum(BILLING_CYCLES);
const subscriptionPaymentModeSchema = z.enum(["auto", "manual"]);
/** The kinds of service a subscription can be, for the by-type view; unset means guessed from its name. */
const subscriptionServiceTypeSchema = z.enum(["ai", "video", "music", "cloud", "hosting", "software", "mobile", "news", "fitness", "gaming", "other"]);
const timestampSchema = z.number().int().nonnegative();
const subscriptionSchema = z.object({
  id: z.number().int(), name: z.string(), linkedAccountId: z.number().int(), linkedAccountName: z.string(), linkedAccountType: z.string().nullable(),
  categoryId: z.number().int().nullable(), amount: z.number().int(), billingCycle: subscriptionBillingCycleSchema, intervalCount: z.number().int(),
  monthlyEquivalent: z.number().int(), nextRenewalAt: z.number(), billingDay: z.number().int().nullable(), status: z.string(), paymentMode: subscriptionPaymentModeSchema,
  trialEndsAt: z.number().nullable(), endsAt: z.number().nullable(), currency: z.string().nullable(), foreignAmount: z.number().int().nullable(), notes: z.string().nullable(), serviceType: subscriptionServiceTypeSchema.nullable(),
  lastPayment: z.object({ date: z.number(), amount: z.number().int() }).nullable(),
  iconKey: z.string(), sortOrder: z.number().int(), createdAt: z.number(), updatedAt: z.number(),
}).passthrough();
const subscriptionOccurrenceSchema = z.object({
  subscriptionId: z.number().int(), subscriptionName: z.string(), dueAt: z.number(), amount: z.number().int(), linkedAccountId: z.number().int(), billingCycle: z.string(),
  intervalCount: z.number().int(), paymentMode: z.string(), currency: z.string().nullable(), foreignAmount: z.number().int().nullable(),
}).passthrough();
const renewalPreviewSchema = z.object({ occurrences: z.array(subscriptionOccurrenceSchema), truncated: z.boolean() }).passthrough();
const subscriptionsListQuerySchema = z.object({ includeArchived: z.enum(["true", "false"]).optional() });
const monthlyChargesSchema = z.array(z.object({
  /** "YYYY-MM", oldest first. */
  month: z.string(),
  total: z.number().int(),
  items: z.array(z.object({ subscriptionId: z.number().int(), amount: z.number().int() })),
}));
const unpaidRenewalsSchema = z.array(z.object({
  subscriptionId: z.number().int(),
  dueAt: z.number(),
  kind: z.enum(["skipped", "voided"]),
}));
const subscriptionsListResponseSchema = z.object({ subscriptions: z.array(subscriptionSchema), renewalPreview: renewalPreviewSchema, monthlyCharges: monthlyChargesSchema, unpaidRenewals: unpaidRenewalsSchema }).passthrough();
const subscriptionCreateBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  linkedAccountId: z.number().int().positive(),
  categoryId: z.number().int().positive().nullable().optional(),
  amount: z.number().int().positive(),
  billingCycle: subscriptionBillingCycleSchema.optional(),
  intervalCount: z.number().int().min(1).max(366).optional(),
  nextRenewalAt: timestampSchema,
  status: subscriptionStatusSchema.optional(),
  paymentMode: subscriptionPaymentModeSchema.optional(),
  trialEndsAt: timestampSchema.nullable().optional(),
  endsAt: timestampSchema.nullable().optional(),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).nullable().optional(),
  foreignAmount: z.number().int().positive().nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  serviceType: subscriptionServiceTypeSchema.nullable().optional(),
  iconKey: subscriptionIconSchema.optional(),
  sortOrder: z.number().int().optional(),
}).passthrough();
const subscriptionUpdateBodySchema = subscriptionCreateBodySchema.partial().extend({
  /** Restores an archived subscription, or archives one, alongside the other statuses. */
  status: z.enum(["active", "paused", "cancelled", "archived"]).optional(),
}).passthrough();
const subscriptionRunRenewalsBodySchema = z.object({ mode: z.enum(["post", "skip"]), occurrences: z.array(z.object({ subscriptionId: z.number().int().positive(), dueAt: z.number().int().nonnegative() }).passthrough()).min(1).max(120) }).passthrough();
const subscriptionRunRenewalsResponseSchema = z.object({ posted: z.number().int().nonnegative(), skipped: z.number().int().nonnegative(), transactionIds: z.array(z.number().int()) }).passthrough();
const occurrenceIdentitySchema = { subscriptionId: z.number().int().positive(), dueAt: timestampSchema };
const subscriptionResolveBodySchema = z.object({
  items: z.array(z.discriminatedUnion("action", [
    z.object({ ...occurrenceIdentitySchema, action: z.literal("post"), amount: z.number().int().positive().optional(), paidAt: timestampSchema.optional(), accountId: z.number().int().positive().optional(), categoryId: z.number().int().positive().nullable().optional(), reanchor: z.boolean().optional() }),
    z.object({ ...occurrenceIdentitySchema, action: z.literal("link"), transactionId: z.number().int().positive(), reanchor: z.boolean().optional() }),
    z.object({ ...occurrenceIdentitySchema, action: z.literal("skip") }),
  ])).min(1).max(120),
}).passthrough();
const subscriptionResolveResponseSchema = z.object({
  posted: z.number().int().nonnegative(), linked: z.number().int().nonnegative(), skipped: z.number().int().nonnegative(), transactionIds: z.array(z.number().int()),
  nextRenewals: z.array(z.object({ subscriptionId: z.number().int(), nextRenewalAt: z.number() })),
}).passthrough();
const subscriptionCandidatesResponseSchema = z.object({
  candidates: z.array(z.object({ transactionId: z.number().int(), date: z.number(), description: z.string(), amount: z.number().int(), accountName: z.string().nullable() })),
}).passthrough();
const subscriptionHistoryResponseSchema = z.object({
  entries: z.array(z.object({
    dueAt: z.number().nullable(),
    status: z.enum(["paid", "linked", "corrected", "voided", "skipped"]),
    note: z.string().nullable(),
    transaction: z.object({ id: z.number().int(), date: z.number(), amount: z.number().int(), description: z.string(), accountName: z.string().nullable(), status: z.string(), txType: z.string() }).nullable(),
  })),
  totalPaid: z.number().int(),
  paidCount: z.number().int(),
  skippedCount: z.number().int(),
}).passthrough();
const subscriptionCorrectionBodySchema = z.object({ reason: z.string().trim().min(1).max(500), effectiveDate: z.number().int().nonnegative().optional(), amount: z.number().int().positive().optional(), linkedAccountId: z.number().int().positive().optional(), categoryId: z.number().int().positive().nullable().optional() }).passthrough();
const subscriptionCorrectionResponseSchema = z.object({ reversalTransactionId: z.number().int(), replacementTransactionId: z.number().int() }).passthrough();
const subscriptionVoidBodySchema = z.object({ reason: z.string().trim().min(1).max(500) }).passthrough();
const subscriptionVoidResponseSchema = z.object({ reversalTransactionId: z.number().int() }).passthrough();
const subscriptionUnlinkResponseSchema = z.object({ transactionId: z.number().int() }).passthrough();

type SubscriptionBody = z.infer<typeof subscriptionUpdateBodySchema>;

async function paymentAccountError(accountId: number): Promise<string | null> {
  const [account] = await db.select({ name: accounts.name, type: accounts.type, provider: accounts.provider, systemKey: accounts.systemKey, isActive: accounts.isActive })
    .from(accounts).where(eq(accounts.id, accountId)).limit(1);
  return subscriptionPaymentAccountProblem(account);
}

async function categoryError(categoryId: number | null | undefined): Promise<string | null> {
  if (categoryId == null) return null;
  const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId)).limit(1);
  return category ? null : "categoryId does not exist";
}

/** The currency fields as stored: IDR is the ledger currency, so it needs no foreign price. */
function normalizeCurrency(body: SubscriptionBody, existing?: SubRow): { currency: string | null; foreignAmount: number | null } | string {
  const currency = body.currency === undefined ? existing?.currency ?? null : body.currency?.toUpperCase() ?? null;
  const foreignAmount = body.foreignAmount === undefined ? existing?.foreignAmount ?? null : body.foreignAmount;
  if (currency == null || currency === "IDR") return { currency: null, foreignAmount: null };
  if (foreignAmount == null) return "Enter the price in " + currency;
  return { currency, foreignAmount };
}

function sendError(reply: FastifyReply, code: number, error: unknown, fallback: string) {
  return reply.code(code).send({ error: error instanceof Error ? error.message : fallback });
}

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/subscriptions", {
    schema: { operationId: "listSubscriptions", tags: ["subscriptions"], querystring: subscriptionsListQuerySchema, response: { 200: subscriptionsListResponseSchema } },
  }, async (request) => {
    const { includeArchived } = request.query as { includeArchived?: string };
    const rows = await db
      .select()
      .from(subscriptions)
      .orderBy(desc(subscriptions.sortOrder), asc(subscriptions.name));

    return {
      subscriptions: await serializeSubscriptions(includeArchived === "true" ? rows : rows.filter((row) => row.status !== "archived")),
      renewalPreview: await previewDueSubscriptionRenewals(),
      monthlyCharges: await subscriptionChargesByMonth(),
      unpaidRenewals: await unpaidRenewalsByMonth(),
    };
  });

  fastify.post("/api/subscriptions/run-renewals", { onRequest: [fastify.authenticate], schema: { operationId: "processSubscriptionRenewals", tags: ["subscriptions"], body: subscriptionRunRenewalsBodySchema, response: { 200: subscriptionRunRenewalsResponseSchema, 400: subscriptionErrorSchema, 409: subscriptionErrorSchema } } }, async (request, reply) => {
    const body = request.body as {
      mode?: "post" | "skip";
      occurrences?: Array<{ subscriptionId: number; dueAt: number }>;
    };
    if (!body || !["post", "skip"].includes(body.mode ?? "") || !Array.isArray(body.occurrences)) {
      return reply.code(400).send({ error: "mode and occurrences are required" });
    }
    try {
      return await applySubscriptionOccurrences({ mode: body.mode!, occurrences: body.occurrences });
    } catch (error) {
      request.log.error(error);
      return sendError(reply, 409, error, "Failed to process renewals");
    }
  });

  /** Resolve renewals one by one: post the charge as it happened, link one already entered, or skip. */
  fastify.post("/api/subscriptions/occurrences/resolve", {
    schema: { operationId: "resolveSubscriptionOccurrences", tags: ["subscriptions"], body: subscriptionResolveBodySchema, response: { 200: subscriptionResolveResponseSchema, 409: subscriptionErrorSchema } },
  }, async (request, reply) => {
    try {
      return await resolveSubscriptionOccurrences((request.body as { items: OccurrenceResolution[] }).items);
    } catch (error) {
      return sendError(reply, 409, error, "Failed to resolve renewals");
    }
  });

  fastify.get("/api/subscriptions/:id/history", {
    schema: { operationId: "getSubscriptionHistory", tags: ["subscriptions"], params: subscriptionIdParamsSchema, response: { 200: subscriptionHistoryResponseSchema } },
  }, async (request) => getSubscriptionHistory((request.params as { id: number }).id));

  /** Expenses already in the ledger that could be this renewal's charge. */
  fastify.get("/api/subscriptions/:id/occurrences/:dueAt/candidates", {
    schema: { operationId: "listSubscriptionOccurrenceCandidates", tags: ["subscriptions"], params: subscriptionOccurrenceParamsSchema, response: { 200: subscriptionCandidatesResponseSchema, 404: subscriptionErrorSchema } },
  }, async (request, reply) => {
    const { id, dueAt } = request.params as { id: number; dueAt: number };
    try {
      return { candidates: await findOccurrenceCandidates(id, dueAt) };
    } catch (error) {
      return sendError(reply, 404, error, "Subscription not found");
    }
  });

  fastify.post("/api/subscriptions/:id/occurrences/:dueAt/correct", {
    schema: { operationId: "correctSubscriptionOccurrence", tags: ["subscriptions"], params: subscriptionOccurrenceParamsSchema, body: subscriptionCorrectionBodySchema, response: { 201: subscriptionCorrectionResponseSchema, 409: subscriptionErrorSchema } },
  }, async (request, reply) => {
    const subscriptionId = Number((request.params as { id?: string }).id);
    const dueAt = Number((request.params as { dueAt?: string }).dueAt);
    const body = (request.body ?? {}) as {
      reason?: string;
      effectiveDate?: number;
      amount?: number;
      linkedAccountId?: number;
      categoryId?: number | null;
    };
    try {
      const result = await correctSubscriptionOccurrence({
        subscriptionId,
        dueAt,
        reason: body.reason ?? "",
        effectiveDate: body.effectiveDate,
        amount: body.amount,
        linkedAccountId: body.linkedAccountId,
        categoryId: body.categoryId,
      });
      return reply.code(201).send(result);
    } catch (error) {
      return sendError(reply, 409, error, "Failed to correct subscription occurrence");
    }
  });

  /** Withdraw a posted renewal that never charged: reversed on its own date, the occurrence skipped. */
  fastify.post("/api/subscriptions/:id/occurrences/:dueAt/void", {
    schema: { operationId: "voidSubscriptionOccurrence", tags: ["subscriptions"], params: subscriptionOccurrenceParamsSchema, body: subscriptionVoidBodySchema, response: { 201: subscriptionVoidResponseSchema, 409: subscriptionErrorSchema } },
  }, async (request, reply) => {
    const subscriptionId = Number((request.params as { id?: string }).id);
    const dueAt = Number((request.params as { dueAt?: string }).dueAt);
    try {
      const result = await voidSubscriptionOccurrence({ subscriptionId, dueAt, reason: (request.body as { reason: string }).reason });
      return reply.code(201).send(result);
    } catch (error) {
      return sendError(reply, 409, error, "Failed to void subscription occurrence");
    }
  });

  /** Release a transaction linked to a renewal by mistake; the transaction itself is unchanged. */
  fastify.post("/api/subscriptions/:id/occurrences/:dueAt/unlink", {
    schema: { operationId: "unlinkSubscriptionOccurrence", tags: ["subscriptions"], params: subscriptionOccurrenceParamsSchema, response: { 200: subscriptionUnlinkResponseSchema, 409: subscriptionErrorSchema } },
  }, async (request, reply) => {
    const { id, dueAt } = request.params as { id: number; dueAt: number };
    try {
      return await unlinkSubscriptionOccurrence({ subscriptionId: id, dueAt });
    } catch (error) {
      return sendError(reply, 409, error, "Failed to unlink renewal");
    }
  });

  fastify.get("/api/subscriptions/:id", {
    schema: { operationId: "getSubscription", tags: ["subscriptions"], params: subscriptionIdParamsSchema, response: { 200: subscriptionSchema, 404: subscriptionErrorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as { id: number };

    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);

    if (!row) {
      reply.code(404).send({ error: "Subscription not found" });
      return;
    }

    return serializeSubscription(row);
  });

  fastify.post("/api/subscriptions", {
    schema: { operationId: "createSubscription", tags: ["subscriptions"], body: subscriptionCreateBodySchema, response: { 201: subscriptionSchema, 400: subscriptionErrorSchema } },
  }, async (request, reply) => {
    const body = request.body as z.infer<typeof subscriptionCreateBodySchema>;

    if (!body.name?.trim()) return reply.code(400).send({ error: "name is required" });
    const accountProblem = await paymentAccountError(body.linkedAccountId);
    if (accountProblem) return reply.code(400).send({ error: accountProblem });
    const categoryProblem = await categoryError(body.categoryId);
    if (categoryProblem) return reply.code(400).send({ error: categoryProblem });
    const currency = normalizeCurrency(body);
    if (typeof currency === "string") return reply.code(400).send({ error: currency });
    const status = body.status ?? "active";
    const endsAt = body.endsAt ?? (status === "cancelled" ? Date.now() : null);

    const [row] = await db
      .insert(subscriptions)
      .values({
        name: body.name.trim(),
        linkedAccountId: body.linkedAccountId,
        categoryId: body.categoryId ?? null,
        amount: body.amount,
        billingCycle: body.billingCycle ?? "monthly",
        intervalCount: body.intervalCount ?? 1,
        nextRenewalAt: new Date(body.nextRenewalAt),
        billingDay: new Date(body.nextRenewalAt).getDate(),
        status,
        paymentMode: body.paymentMode ?? "auto",
        trialEndsAt: body.trialEndsAt == null ? null : new Date(body.trialEndsAt),
        endsAt: endsAt == null ? null : new Date(endsAt),
        ...currency,
        notes: body.notes?.trim() || null,
        serviceType: body.serviceType ?? null,
        iconKey: body.iconKey ?? "default",
        sortOrder: body.sortOrder ?? 0,
      })
      .returning();

    const serialized = await serializeSubscription(row);
    await auditCreate("subscription", row.id, serialized as Record<string, unknown>);
    reply.code(201).send(serialized);
  });

  fastify.patch("/api/subscriptions/:id", {
    schema: { operationId: "updateSubscription", tags: ["subscriptions"], params: subscriptionIdParamsSchema, body: subscriptionUpdateBodySchema, response: { 200: subscriptionSchema, 400: subscriptionErrorSchema, 404: subscriptionErrorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as { id: number };
    const body = request.body as SubscriptionBody;

    const [existing] = await db.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);
    if (!existing) return reply.code(404).send({ error: "Subscription not found" });

    if (body.linkedAccountId !== undefined && body.linkedAccountId !== existing.linkedAccountId) {
      const accountProblem = await paymentAccountError(body.linkedAccountId);
      if (accountProblem) return reply.code(400).send({ error: accountProblem });
    }
    const categoryProblem = await categoryError(body.categoryId);
    if (categoryProblem) return reply.code(400).send({ error: categoryProblem });
    const currency = normalizeCurrency(body, existing);
    if (typeof currency === "string") return reply.code(400).send({ error: currency });

    const patch: Partial<typeof subscriptions.$inferInsert> = { updatedAt: new Date(), ...currency };
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.linkedAccountId !== undefined) patch.linkedAccountId = body.linkedAccountId;
    if (body.categoryId !== undefined) patch.categoryId = body.categoryId;
    if (body.amount !== undefined) patch.amount = body.amount;
    if (body.billingCycle !== undefined) patch.billingCycle = body.billingCycle;
    if (body.intervalCount !== undefined) patch.intervalCount = body.intervalCount;
    if (body.paymentMode !== undefined) patch.paymentMode = body.paymentMode;
    if (body.trialEndsAt !== undefined) patch.trialEndsAt = body.trialEndsAt == null ? null : new Date(body.trialEndsAt);
    if (body.endsAt !== undefined) patch.endsAt = body.endsAt == null ? null : new Date(body.endsAt);
    if (body.notes !== undefined) patch.notes = body.notes?.trim() || null;
    if (body.serviceType !== undefined) patch.serviceType = body.serviceType;
    if (body.iconKey !== undefined) patch.iconKey = body.iconKey;
    if (body.sortOrder !== undefined) patch.sortOrder = body.sortOrder;
    if (body.status !== undefined) {
      patch.status = body.status;
      // Cancelling ends the subscription today unless a later last day is given; reactivating clears it.
      if (body.status === "cancelled" && body.endsAt == null && existing.endsAt == null) patch.endsAt = new Date();
      if (body.status === "active" && existing.status === "cancelled" && body.endsAt === undefined) patch.endsAt = null;
    }
    if (body.nextRenewalAt !== undefined) {
      // Renewals already posted, linked or skipped keep their dates; the schedule only moves past them.
      const resolved = await lastResolvedDueAt(id);
      if (resolved != null && body.nextRenewalAt <= resolved) {
        return reply.code(400).send({ error: "The next renewal must come after the last renewal already recorded" });
      }
      patch.nextRenewalAt = new Date(body.nextRenewalAt);
      // A user-chosen date resets the day the subscription bills on.
      patch.billingDay = new Date(body.nextRenewalAt).getDate();
    }

    const [updated] = await db
      .update(subscriptions)
      .set(patch)
      .where(eq(subscriptions.id, id))
      .returning();

    const [before, after] = await serializeSubscriptions([existing, updated]);
    await auditUpdate("subscription", id, before as Record<string, unknown>, after as Record<string, unknown>);
    return after;
  });

  // Advance subscription renewal (called when a transaction pays for the subscription)
  fastify.post("/api/subscriptions/:id/advance", {
    schema: { operationId: "advanceSubscription", tags: ["subscriptions"], params: subscriptionIdParamsSchema, response: { 410: subscriptionErrorSchema } },
  }, async (request, reply) => {
    return reply.code(410).send({
      error: "Direct schedule advancement is disabled; confirm or skip a concrete renewal occurrence",
    });
  });

  fastify.delete("/api/subscriptions/:id", {
    schema: { operationId: "archiveSubscription", tags: ["subscriptions"], params: subscriptionIdParamsSchema, response: { 204: z.null(), 404: subscriptionErrorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as { id: number };

    const [existing] = await db.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);
    if (!existing) return reply.code(404).send({ error: "Subscription not found" });

    const [archived] = await db.update(subscriptions).set({ status: "archived", updatedAt: new Date() })
      .where(eq(subscriptions.id, id)).returning();
    const [before, after] = await serializeSubscriptions([existing, archived]);
    await auditUpdate("subscription", id, before as Record<string, unknown>, after as Record<string, unknown>);

    reply.code(204).send();
  });
}
