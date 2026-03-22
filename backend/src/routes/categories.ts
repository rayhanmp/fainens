import { eq, like, and } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client";
import { categories } from "../db/schema";
import { auditCreate, auditUpdate, auditDelete } from "../services/audit";

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/categories", async (request) => {
    const { search } = request.query as { search?: string };

    const conditions = [];
    if (search) {
      conditions.push(like(categories.name, `%${search}%`));
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
    const body = request.body as {
      name: string;
      icon?: string | null;
      color?: string | null;
    };

    const [category] = await db
      .insert(categories)
      .values({
        name: body.name,
        icon: body.icon ?? null,
        color: body.color ?? null,
      })
      .returning();

    await auditCreate("category", category.id, { name: category.name, icon: category.icon, color: category.color });

    reply.code(201).send(category);
  });

  fastify.patch("/api/categories/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<{
      name: string;
      icon: string | null;
      color: string | null;
    }>;

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
