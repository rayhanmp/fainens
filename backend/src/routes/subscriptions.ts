import { eq, desc, asc } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client";
import { subscriptions, accounts } from "../db/schema";
import { auditCreate, auditUpdate, auditDelete } from "../services/audit";
import { processDueSubscriptionRenewals, addOneMonth, addOneYear } from "../services/subscription-renewals";

type SubRow = typeof subscriptions.$inferSelect;

async function serializeSubscription(row: SubRow) {
  const ms = (v: Date | number) => (v instanceof Date ? v.getTime() : Number(v));
  // Fetch account name for display
  const [account] = await db.select({ name: accounts.name }).from(accounts).where(eq(accounts.id, row.linkedAccountId)).limit(1);
  return {
    id: row.id,
    name: row.name,
    linkedAccountId: row.linkedAccountId,
    linkedAccountName: account?.name ?? 'Unknown',
    categoryId: row.categoryId ?? null,
    amount: row.amount,
    billingCycle: row.billingCycle,
    nextRenewalAt: ms(row.nextRenewalAt as Date | number),
    status: row.status,
    iconKey: row.iconKey,
    sortOrder: row.sortOrder,
    createdAt: ms(row.createdAt as Date | number),
    updatedAt: ms(row.updatedAt as Date | number),
  };
}

const STATUS = ["active", "paused"] as const;
const ICON_KEYS = ["car", "film", "music", "signal", "sparkles", "default"] as const;
const BILLING_CYCLES = ["monthly", "annual"] as const;

function isStatus(s: string): s is (typeof STATUS)[number] {
  return (STATUS as readonly string[]).includes(s);
}

function isIconKey(s: string): s is (typeof ICON_KEYS)[number] {
  return (ICON_KEYS as readonly string[]).includes(s);
}

function isBillingCycle(s: string): s is (typeof BILLING_CYCLES)[number] {
  return (BILLING_CYCLES as readonly string[]).includes(s);
}

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/subscriptions", async (request) => {
    const renewal = await processDueSubscriptionRenewals(db);
    if (renewal.processed > 0 || renewal.errors.length > 0) {
      request.log.info(
        { processed: renewal.processed, skipped: renewal.skippedNoAccount, errors: renewal.errors },
        "subscription renewals",
      );
    }

    const rows = await db
      .select()
      .from(subscriptions)
      .orderBy(desc(subscriptions.sortOrder), asc(subscriptions.name));

    return {
      subscriptions: await Promise.all(rows.map(serializeSubscription)),
      renewal,
    };
  });

  fastify.post("/api/subscriptions/run-renewals", async () => {
    const result = await processDueSubscriptionRenewals(db);
    return result;
  });

  fastify.get("/api/subscriptions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.id, parseInt(id, 10))).limit(1);

    if (!row) {
      reply.code(404).send({ error: "Subscription not found" });
      return;
    }

    return serializeSubscription(row);
  });

  fastify.post("/api/subscriptions", async (request, reply) => {
    const body = request.body as {
      name: string;
      linkedAccountId: number;
      categoryId?: number | null;
      amount: number;
      billingCycle?: string;
      nextRenewalAt: number;
      status?: string;
      iconKey?: string;
      sortOrder?: number;
    };

    if (!body.name?.trim()) {
      reply.code(400).send({ error: "name is required" });
      return;
    }
    if (typeof body.linkedAccountId !== "number" || !Number.isInteger(body.linkedAccountId) || body.linkedAccountId <= 0) {
      reply.code(400).send({ error: "linkedAccountId is required and must be a valid account ID" });
      return;
    }
    // Validate the account exists
    const [account] = await db.select().from(accounts).where(eq(accounts.id, body.linkedAccountId)).limit(1);
    if (!account) {
      reply.code(400).send({ error: "linkedAccountId must reference a valid account" });
      return;
    }
    if (typeof body.amount !== "number" || !Number.isFinite(body.amount) || body.amount < 0) {
      reply.code(400).send({ error: "amount must be a non-negative number" });
      return;
    }
    if (typeof body.nextRenewalAt !== "number" || !Number.isFinite(body.nextRenewalAt)) {
      reply.code(400).send({ error: "nextRenewalAt must be a valid timestamp (ms)" });
      return;
    }

    const status = body.status ?? "active";
    if (!isStatus(status)) {
      reply.code(400).send({ error: "status must be active or paused" });
      return;
    }

    const iconKey = body.iconKey ?? "default";
    if (!isIconKey(iconKey)) {
      reply.code(400).send({ error: "invalid iconKey" });
      return;
    }

    const billingCycle = body.billingCycle ?? "monthly";
    if (!isBillingCycle(billingCycle)) {
      reply.code(400).send({ error: "billingCycle must be monthly or annual" });
      return;
    }

    const [row] = await db
      .insert(subscriptions)
      .values({
        name: body.name.trim(),
        linkedAccountId: body.linkedAccountId,
        categoryId: body.categoryId ?? null,
        amount: Math.round(body.amount),
        billingCycle,
        nextRenewalAt: new Date(body.nextRenewalAt),
        status,
        iconKey,
        sortOrder: body.sortOrder ?? 0,
      })
      .returning();

    await auditCreate("subscription", row.id, await serializeSubscription(row) as Record<string, unknown>);

    reply.code(201).send(await serializeSubscription(row));
  });

  fastify.patch("/api/subscriptions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<{
      name: string;
      linkedAccountId: number;
      categoryId: number | null;
      amount: number;
      billingCycle: string;
      nextRenewalAt: number;
      status: string;
      iconKey: string;
      sortOrder: number;
    }>;

    const [existing] = await db.select().from(subscriptions).where(eq(subscriptions.id, parseInt(id, 10))).limit(1);

    if (!existing) {
      reply.code(404).send({ error: "Subscription not found" });
      return;
    }

    if (body.status !== undefined && !isStatus(body.status)) {
      reply.code(400).send({ error: "status must be active or paused" });
      return;
    }
    if (body.iconKey !== undefined && !isIconKey(body.iconKey)) {
      reply.code(400).send({ error: "invalid iconKey" });
      return;
    }
    if (body.billingCycle !== undefined && !isBillingCycle(body.billingCycle)) {
      reply.code(400).send({ error: "billingCycle must be monthly or annual" });
      return;
    }

    // Validate linkedAccountId if provided
    if (body.linkedAccountId !== undefined) {
      if (typeof body.linkedAccountId !== "number" || !Number.isInteger(body.linkedAccountId) || body.linkedAccountId <= 0) {
        reply.code(400).send({ error: "linkedAccountId must be a valid account ID" });
        return;
      }
      const [account] = await db.select().from(accounts).where(eq(accounts.id, body.linkedAccountId)).limit(1);
      if (!account) {
        reply.code(400).send({ error: "linkedAccountId must reference a valid account" });
        return;
      }
    }

    const patch: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.linkedAccountId !== undefined) patch.linkedAccountId = body.linkedAccountId;
    if (body.categoryId !== undefined) patch.categoryId = body.categoryId;
    if (body.amount !== undefined) {
      if (typeof body.amount !== "number" || !Number.isFinite(body.amount) || body.amount < 0) {
        reply.code(400).send({ error: "amount must be a non-negative number" });
        return;
      }
      patch.amount = Math.round(body.amount);
    }
    if (body.billingCycle !== undefined) patch.billingCycle = body.billingCycle;
    if (body.nextRenewalAt !== undefined) {
      if (typeof body.nextRenewalAt !== "number" || !Number.isFinite(body.nextRenewalAt)) {
        reply.code(400).send({ error: "nextRenewalAt must be a valid timestamp (ms)" });
        return;
      }
      patch.nextRenewalAt = new Date(body.nextRenewalAt);
    }
    if (body.status !== undefined) patch.status = body.status;
    if (body.iconKey !== undefined) patch.iconKey = body.iconKey;
    if (body.sortOrder !== undefined) patch.sortOrder = body.sortOrder;

    const [updated] = await db
      .update(subscriptions)
      .set(patch as any)
      .where(eq(subscriptions.id, parseInt(id, 10)))
      .returning();

    await auditUpdate(
      "subscription",
      parseInt(id, 10),
      await serializeSubscription(existing) as Record<string, unknown>,
      await serializeSubscription(updated) as Record<string, unknown>,
    );

    return serializeSubscription(updated);
  });

  // Advance subscription renewal (called when a transaction pays for the subscription)
  fastify.post("/api/subscriptions/:id/advance", async (request, reply) => {
    const { id } = request.params as { id: string };
    const subId = parseInt(id, 10);

    const [existing] = await db.select().from(subscriptions).where(eq(subscriptions.id, subId)).limit(1);

    if (!existing) {
      reply.code(404).send({ error: "Subscription not found" });
      return;
    }

    if (existing.status !== "active") {
      reply.code(400).send({ error: "Can only advance active subscriptions" });
      return;
    }

    const currentRenewal = existing.nextRenewalAt.getTime();
    const newRenewal = existing.billingCycle === "annual"
      ? addOneYear(currentRenewal)
      : addOneMonth(currentRenewal);

    const [updated] = await db
      .update(subscriptions)
      .set({
        nextRenewalAt: new Date(newRenewal),
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, subId))
      .returning();

    await auditUpdate(
      "subscription",
      subId,
      await serializeSubscription(existing) as Record<string, unknown>,
      await serializeSubscription(updated) as Record<string, unknown>,
    );

    return serializeSubscription(updated);
  });

  fastify.delete("/api/subscriptions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const [existing] = await db.select().from(subscriptions).where(eq(subscriptions.id, parseInt(id, 10))).limit(1);

    if (!existing) {
      reply.code(404).send({ error: "Subscription not found" });
      return;
    }

    await db.delete(subscriptions).where(eq(subscriptions.id, parseInt(id, 10)));

    await auditDelete("subscription", parseInt(id, 10), await serializeSubscription(existing) as Record<string, unknown>);

    reply.code(204).send();
  });
}
