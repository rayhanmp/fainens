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
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  reportingAccountId: z.number().int().positive().nullable().optional(),
});

const CATEGORY_COLOR_PRESETS = [
  '#E4572E', '#F2A541', '#B08900', '#718E23', '#3A9D5D', '#008C70', '#168AAD', '#2878B5',
  '#3155A4', '#5E60CE', '#7950A1', '#A44A9C', '#D45087', '#D1495B', '#9C6644', '#577590',
  '#8AC926', '#FF006E', '#5B8E7D', '#6C757D',
];

function hslToHex(hue: number): string {
  const saturation = 0.68;
  const lightness = 0.46;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const segment = hue / 60;
  const secondary = chroma * (1 - Math.abs(segment % 2 - 1));
  const [red, green, blue] = segment < 1 ? [chroma, secondary, 0]
    : segment < 2 ? [secondary, chroma, 0]
      : segment < 3 ? [0, chroma, secondary]
        : segment < 4 ? [0, secondary, chroma]
          : segment < 5 ? [secondary, 0, chroma]
            : [chroma, 0, secondary];
  const offset = lightness - chroma / 2;
  return `#${[red, green, blue].map((value) => Math.round((value + offset) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function getAvailableCategoryColor(excludingId?: number): string {
  const rows = db.$client.prepare(
    "SELECT color FROM category WHERE color IS NOT NULL AND (? IS NULL OR id != ?)",
  ).all(excludingId ?? null, excludingId ?? null) as Array<{ color: string }>;
  const usedColors = new Set(rows.map(({ color }) => color.toUpperCase()));
  const preset = CATEGORY_COLOR_PRESETS.find((color) => !usedColors.has(color));
  if (preset) return preset;

  // Keep onboarding usable even after all visible swatches have been used.
  for (let index = 0; index < 360; index++) {
    const color = hslToHex((index * 137.508) % 360);
    if (!usedColors.has(color)) return color;
  }
  throw new Error("Unable to assign a unique category color");
}

function categoryColorConflict(color: string, excludingId?: number): boolean {
  const row = db.$client.prepare(
    "SELECT 1 AS found FROM category WHERE color IS NOT NULL AND upper(color) = upper(?) AND (? IS NULL OR id != ?) LIMIT 1",
  ).get(color, excludingId ?? null, excludingId ?? null);
  return Boolean(row);
}

function isCategoryColorUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error
    && error.message.includes("category_color_unique_idx");
}

// Keep input and output contracts separate. Database rows include identity and
// lifecycle fields which callers need for selections and cache reconciliation.
const categoryRecordSchema = categorySchema.extend({
  id: z.number().int().positive(),
  isActive: z.boolean(),
}).passthrough();

const categoryUpdateSchema = categorySchema.partial();
const categoryIdParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const categoryListQuerySchema = z.object({
  search: z.string().max(100).optional(),
  includeInactive: z.enum(["true", "false"]).optional(),
});
const categoryErrorSchema = z.object({ error: z.string() }).passthrough();
const categoryListResponse = { 200: z.array(categoryRecordSchema), 400: categoryErrorSchema };
const categoryRecordResponse = { 200: categoryRecordSchema, 400: categoryErrorSchema, 404: categoryErrorSchema };
const categoryCreateResponse = { 201: categoryRecordSchema, 400: categoryErrorSchema, 409: categoryErrorSchema, 500: categoryErrorSchema };
const categoryUpdateResponse = { 200: categoryRecordSchema, 400: categoryErrorSchema, 404: categoryErrorSchema, 409: categoryErrorSchema, 500: categoryErrorSchema };
const categoryDeleteResponse = { 204: z.void(), 400: categoryErrorSchema, 404: categoryErrorSchema, 409: categoryErrorSchema };
const categoryDependencyResponse = {
  200: z.object({
    category: categoryRecordSchema,
    canArchive: z.boolean(),
    canRestore: z.boolean(),
    dependencies: z.object({
      transactions: z.number().int(),
      allocations: z.number().int(),
      budgetPlans: z.number().int(),
      budgetTemplates: z.number().int(),
    }).passthrough(),
    consequence: z.string(),
  }).passthrough(),
  400: categoryErrorSchema,
  404: categoryErrorSchema,
};

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/categories", {
    schema: { operationId: "listCategories", tags: ["categories"], querystring: categoryListQuerySchema, response: categoryListResponse },
  }, async (request) => {
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

  fastify.get("/api/categories/:id", {
    schema: { operationId: "getCategory", tags: ["categories"], params: categoryIdParamsSchema, response: categoryRecordResponse },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [category] = await db.select().from(categories).where(eq(categories.id, parseInt(id))).limit(1);

    if (!category) {
      reply.code(404).send({ error: "Category not found" });
      return;
    }

    return category;
  });

  fastify.post("/api/categories", {
    schema: { operationId: "createCategory", tags: ["categories"], body: categorySchema, response: categoryCreateResponse },
  }, async (request, reply) => {
    const parseResult = categorySchema.safeParse(request.body);
    
    if (!parseResult.success) {
      reply.code(400).send({ 
        error: "Validation failed", 
        details: parseResult.error.issues 
      });
      return;
    }

    const body = parseResult.data;
    const color = body.color?.toUpperCase() ?? getAvailableCategoryColor();
    if (categoryColorConflict(color)) {
      return reply.code(409).send({ error: "That color is already assigned to another category. Choose a different color." });
    }

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
          color,
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
      if (isCategoryColorUniqueConstraintError(error)) {
        return reply.code(409).send({ error: "That color is already assigned to another category. Choose a different color." });
      }
      fastify.log.error(error);
      reply.code(500).send({ error: error instanceof Error ? error.message : 'Failed to create category' });
    }
  });

  fastify.patch("/api/categories/:id", {
    schema: { operationId: "updateCategory", tags: ["categories"], params: categoryIdParamsSchema, body: categoryUpdateSchema, response: categoryUpdateResponse },
  }, async (request, reply) => {
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
    const categoryId = Number(id);
    const color = body.color === undefined
      ? undefined
      : body.color?.toUpperCase() ?? getAvailableCategoryColor(categoryId);
    if (color && categoryColorConflict(color, categoryId)) {
      return reply.code(409).send({ error: "That color is already assigned to another category. Choose a different color." });
    }

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

    try {
      const updated = db.transaction((tx) => {
        const row = (tx.update(categories).set({
          ...(body.name !== undefined && { name: body.name.trim() }),
          ...(body.icon !== undefined && { icon: body.icon }),
          ...(color !== undefined && { color }),
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
    } catch (error) {
      if (isCategoryColorUniqueConstraintError(error)) {
        return reply.code(409).send({ error: "That color is already assigned to another category. Choose a different color." });
      }
      throw error;
    }
  });

  fastify.delete("/api/categories/:id", {
    schema: { operationId: "archiveCategory", tags: ["categories"], params: categoryIdParamsSchema, response: categoryDeleteResponse },
  }, async (request, reply) => {
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

  fastify.get("/api/categories/:id/dependency-preview", {
    schema: { operationId: "getCategoryDependencyPreview", tags: ["categories"], params: categoryIdParamsSchema, response: categoryDependencyResponse },
  }, async (request, reply) => {
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

  fastify.post("/api/categories/:id/restore", {
    schema: { operationId: "restoreCategory", tags: ["categories"], params: categoryIdParamsSchema, response: categoryRecordResponse },
  }, async (request, reply) => {
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
