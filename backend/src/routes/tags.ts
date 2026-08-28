import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { db } from "../db/client";
import { tags, transactionTags } from "../db/schema";

const tagIdParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const tagSchema = z.object({ id: z.number().int(), name: z.string(), color: z.string() }).passthrough();
const tagBodySchema = z.object({ name: z.string().trim().min(1).max(100), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/) }).passthrough();
const tagUpdateBodySchema = tagBodySchema.partial().passthrough();
const tagErrorSchema = z.object({ error: z.string() }).passthrough();

export default async function (fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook("onRequest", fastify.authenticate);

  // List all tags
  fastify.get("/api/tags", {
    schema: { operationId: "listTags", tags: ["categories"], response: { 200: z.array(tagSchema) } },
  }, async () => {
    const allTags = await db.select().from(tags);
    return allTags;
  });

  // Get single tag with usage count
  fastify.get("/api/tags/:id", {
    schema: { operationId: "getTag", tags: ["categories"], params: tagIdParamsSchema, response: { 200: tagSchema.extend({ usageCount: z.number().int() }).passthrough(), 404: tagErrorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [tag] = await db
      .select()
      .from(tags)
      .where(eq(tags.id, parseInt(id)))
      .limit(1);

    if (!tag) {
      reply.code(404).send({ error: "Tag not found" });
      return;
    }

    // Get usage count
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(transactionTags)
      .where(eq(transactionTags.tagId, parseInt(id)));

    const count = result[0]?.count ?? 0;

    return {
      ...tag,
      usageCount: count,
    };
  });

  // Create tag
  fastify.post("/api/tags", {
    schema: { operationId: "createTag", tags: ["categories"], body: tagBodySchema, response: { 201: tagSchema, 400: tagErrorSchema } },
  }, async (request, reply) => {
    const body = request.body as {
      name: string;
      color: string;
    };

    // Validate color format (hex color)
    const colorRegex = /^#[0-9A-Fa-f]{6}$/;
    if (!colorRegex.test(body.color)) {
      reply.code(400).send({ error: "Color must be a valid hex color (e.g., #FF5733)" });
      return;
    }

    const [tag] = await db
      .insert(tags)
      .values({
        name: body.name,
        color: body.color,
      })
      .returning();

    reply.code(201).send(tag);
  });

  // Update tag
  fastify.patch("/api/tags/:id", {
    schema: { operationId: "updateTag", tags: ["categories"], params: tagIdParamsSchema, body: tagUpdateBodySchema, response: { 200: tagSchema, 400: tagErrorSchema, 404: tagErrorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<{
      name: string;
      color: string;
    }>;

    const [existing] = await db
      .select()
      .from(tags)
      .where(eq(tags.id, parseInt(id)))
      .limit(1);

    if (!existing) {
      reply.code(404).send({ error: "Tag not found" });
      return;
    }

    // Validate color if provided
    if (body.color) {
      const colorRegex = /^#[0-9A-Fa-f]{6}$/;
      if (!colorRegex.test(body.color)) {
        reply.code(400).send({ error: "Color must be a valid hex color (e.g., #FF5733)" });
        return;
      }
    }

    const [updated] = await db
      .update(tags)
      .set({
        ...(body.name && { name: body.name }),
        ...(body.color && { color: body.color }),
      })
      .where(eq(tags.id, parseInt(id)))
      .returning();

    return updated;
  });

  // Delete tag
  fastify.delete("/api/tags/:id", {
    schema: { operationId: "deleteTag", tags: ["categories"], params: tagIdParamsSchema, response: { 204: z.null(), 404: tagErrorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [existing] = await db
      .select()
      .from(tags)
      .where(eq(tags.id, parseInt(id)))
      .limit(1);

    if (!existing) {
      reply.code(404).send({ error: "Tag not found" });
      return;
    }

    // Transaction tag associations will be cascade deleted
    await db.delete(tags).where(eq(tags.id, parseInt(id)));

    reply.code(204).send();
  });
}
