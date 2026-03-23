import { eq, like, and } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { db } from "../db/client";
import { categories } from "../db/schema";
import { auditCreate, auditUpdate, auditDelete } from "../services/audit";

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
});

const categoryUpdateSchema = categorySchema.partial();

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/categories", async (request) => {
    const { search } = request.query as { search?: string };

    const conditions = [];
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

    try {
      const [category] = await db
        .insert(categories)
        .values({
          name: body.name.trim(),
          icon: body.icon ?? null,
          color: body.color ?? null,
        })
        .returning();

      await auditCreate("category", category.id, { name: category.name, icon: category.icon, color: category.color });

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

    const [existing] = await db.select().from(categories).where(eq(categories.id, parseInt(id))).limit(1);

    if (!existing) {
      reply.code(404).send({ error: "Category not found" });
      return;
    }

    const [updated] = await db
      .update(categories)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.icon !== undefined && { icon: body.icon }),
        ...(body.color !== undefined && { color: body.color }),
      })
      .where(eq(categories.id, parseInt(id)))
      .returning();

    await auditUpdate("category", parseInt(id), existing, updated);

    return updated;
  });

  fastify.delete("/api/categories/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const [existing] = await db.select().from(categories).where(eq(categories.id, parseInt(id))).limit(1);

    if (!existing) {
      reply.code(404).send({ error: "Category not found" });
      return;
    }

    await db.delete(categories).where(eq(categories.id, parseInt(id)));

    await auditDelete("category", parseInt(id), existing);

    reply.code(204).send();
  });
}
