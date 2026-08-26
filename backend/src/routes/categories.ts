import { eq, like, and, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { db } from "../db/client";
import { accounts, auditLogs, budgetPlans, budgetTemplateItems, categories, transactionCategoryAllocations, transactions } from "../db/schema";
import { bumpFinancialRevisionSync } from "../services/financial-revision";

// Sanitize search input to prevent SQL injection
function sanitizeSearchInput(input: string): string {
  // Remove SQL special characters that could be used for injection
  return input.replace(/[%_\[\]]/g, '');
}

// Validation schemas
const categorySchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().max(10).nullable().optional(),
  color: z.string().max(20).nullable().optional(),
  reportingAccountId: z.number().int().positive().nullable().optional(),
});

const categoryUpdateSchema = categorySchema.partial();

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/categories", async (request) => {
    const { search, includeInactive } = request.query as { search?: string; includeInactive?: string };

    const conditions = includeInactive === "true" ? [] : [eq(categories.isActive, true)];
    if (search) {
      const sanitized = sanitizeSearchInput(search);
      if (sanitized) {
        conditions.push(like(categories.name, `%${sanitized}%`));
      }
    }

    const allCategories =
      conditions.length > 0
        ? await db.select().from(categories).where(and(...conditions))
        : await db.select().from(categories);

    return allCategories;
  });

  fastify.get("/api/categories/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const [category] = await db.select().from(categories).where(eq(categories.id, parseInt(id))).limit(1);

    if (!category) {
      reply.code(404).send({ error: "Category not found" });
      return;
    }

    return category;
  });

  fastify.post("/api/categories", async (request, reply) => {
    const parseResult = categorySchema.safeParse(request.body);
    
    if (!parseResult.success) {
      reply.code(400).send({ 
        error: "Validation failed", 
        details: parseResult.error.issues 
      });
      return;
    }

    const body = parseResult.data;

    if (body.reportingAccountId != null) {
      const [account] = await db.select({ type: accounts.type, isActive: accounts.isActive }).from(accounts)
        .where(eq(accounts.id, body.reportingAccountId)).limit(1);
      if (!account || !account.isActive || account.type !== "expense") {
        return reply.code(400).send({ error: "reportingAccountId must reference an active expense account" });
      }
    }

    try {
      const category = db.transaction((tx) => {
        const inserted = (tx.insert(categories).values({
          name: body.name.trim(),
          icon: body.icon ?? null,
          color: body.color ?? null,
          isActive: true,
          reportingAccountId: body.reportingAccountId ?? null,
        }).returning().all() as any[])[0];
        if (!inserted) throw new Error("Failed to create category");
        tx.insert(auditLogs).values({
          entityType: "category",
          entityId: inserted.id,
          action: "create",
          afterSnapshot: Buffer.from(JSON.stringify(inserted)),
        }).run();
        bumpFinancialRevisionSync(tx);
        return inserted;
      });
      reply.code(201).send(category);
    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({ error: error instanceof Error ? error.message : 'Failed to create category' });
    }
  });

  fastify.patch("/api/categories/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    
    const parseResult = categoryUpdateSchema.safeParse(request.body);
    if (!parseResult.success) {
      reply.code(400).send({ 
        error: "Validation failed", 
        details: parseResult.error.issues 
      });
      return;
    }
    
    const body = parseResult.data;

    if (body.reportingAccountId != null) {
      const [account] = await db.select({ type: accounts.type, isActive: accounts.isActive }).from(accounts)
        .where(eq(accounts.id, body.reportingAccountId)).limit(1);
      if (!account || !account.isActive || account.type !== "expense") {
        return reply.code(400).send({ error: "reportingAccountId must reference an active expense account" });
      }
    }

    const [existing] = await db.select().from(categories).where(eq(categories.id, parseInt(id))).limit(1);

    if (!existing) {
      reply.code(404).send({ error: "Category not found" });
      return;
    }

    const updated = db.transaction((tx) => {
      const row = (tx.update(categories).set({
        ...(body.name !== undefined && { name: body.name.trim() }),
        ...(body.icon !== undefined && { icon: body.icon }),
        ...(body.color !== undefined && { color: body.color }),
        ...(body.reportingAccountId !== undefined && { reportingAccountId: body.reportingAccountId }),
      }).where(eq(categories.id, parseInt(id))).returning().all() as any[])[0];
      if (!row) throw new Error("Category update failed");
      tx.insert(auditLogs).values({
        entityType: "category",
        entityId: parseInt(id),
        action: "update",
        beforeSnapshot: Buffer.from(JSON.stringify(existing)),
        afterSnapshot: Buffer.from(JSON.stringify(row)),
      }).run();
      bumpFinancialRevisionSync(tx);
      return row;
    });

    return updated;
  });

  fastify.delete("/api/categories/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const [existing] = await db.select().from(categories).where(eq(categories.id, parseInt(id))).limit(1);

    if (!existing) {
      reply.code(404).send({ error: "Category not found" });
      return;
    }
    if (!existing.isActive) {
      reply.code(204).send();
      return;
    }

    const categoryId = parseInt(id);
    db.transaction((tx) => {
      tx.update(categories).set({ isActive: false }).where(eq(categories.id, categoryId)).run();
      tx.insert(auditLogs).values({
        entityType: "category",
        entityId: categoryId,
        action: "archive",
        beforeSnapshot: Buffer.from(JSON.stringify(existing)),
        afterSnapshot: Buffer.from(JSON.stringify({ ...existing, isActive: false })),
      }).run();
      bumpFinancialRevisionSync(tx);
    });

    reply.code(204).send();
  });

  fastify.get("/api/categories/:id/dependency-preview", async (request, reply) => {
    const categoryId = Number((request.params as { id: string }).id);
    if (!Number.isSafeInteger(categoryId) || categoryId <= 0) return reply.code(400).send({ error: "Invalid category id" });
    const [category] = await db.select().from(categories).where(eq(categories.id, categoryId)).limit(1);
    if (!category) return reply.code(404).send({ error: "Category not found" });
    const [transactionRefs, allocationRefs, budgetRefs, templateRefs] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(transactions).where(eq(transactions.categoryId, categoryId)),
      db.select({ count: sql<number>`count(*)` }).from(transactionCategoryAllocations).where(eq(transactionCategoryAllocations.categoryId, categoryId)),
      db.select({ count: sql<number>`count(*)` }).from(budgetPlans).where(eq(budgetPlans.categoryId, categoryId)),
      db.select({ count: sql<number>`count(*)` }).from(budgetTemplateItems).where(eq(budgetTemplateItems.categoryId, categoryId)),
    ]);
    return {
      category,
      canArchive: category.isActive,
      canRestore: !category.isActive,
      dependencies: {
        transactions: Number(transactionRefs[0]?.count ?? 0),
        allocations: Number(allocationRefs[0]?.count ?? 0),
        budgetPlans: Number(budgetRefs[0]?.count ?? 0),
        budgetTemplates: Number(templateRefs[0]?.count ?? 0),
      },
      consequence: "Archiving hides the category from new entries but preserves historical allocations, budgets, and reports.",
    };
  });

  fastify.post("/api/categories/:id/restore", async (request, reply) => {
    const categoryId = Number((request.params as { id: string }).id);
    if (!Number.isSafeInteger(categoryId) || categoryId <= 0) return reply.code(400).send({ error: "Invalid category id" });
    const [existing] = await db.select().from(categories).where(eq(categories.id, categoryId)).limit(1);
    if (!existing) return reply.code(404).send({ error: "Category not found" });
    if (existing.isActive) return existing;
    const restored = db.transaction((tx) => {
      const [row] = tx.update(categories).set({ isActive: true }).where(eq(categories.id, categoryId)).returning().all() as any[];
      if (!row) throw new Error("Category restore failed");
      tx.insert(auditLogs).values({
        entityType: "category",
        entityId: categoryId,
        action: "restore",
        beforeSnapshot: Buffer.from(JSON.stringify(existing)),
        afterSnapshot: Buffer.from(JSON.stringify(row)),
      }).run();
      bumpFinancialRevisionSync(tx);
      return row;
    });
    return restored;
  });
}
