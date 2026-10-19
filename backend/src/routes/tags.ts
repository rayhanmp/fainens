import { asc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { db } from "../db/client";
import { tagGroups, tags, transactionTags } from "../db/schema";

const tagIdParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const tagSchema = z.object({ id: z.number().int(), name: z.string(), color: z.string(), groupId: z.number().int().nullable().optional() }).passthrough();
const tagBodySchema = z.object({ name: z.string().trim().min(1).max(100), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/) }).passthrough();
const tagUpdateBodySchema = tagBodySchema.partial().extend({ groupId: z.number().int().positive().nullable().optional() }).passthrough();
const tagGroupSchema = z.object({ id: z.number().int(), name: z.string(), sortOrder: z.number().int() }).passthrough();
const tagGroupBodySchema = z.object({ name: z.string().trim().min(1).max(60) }).passthrough();
const tagGroupUpdateBodySchema = z.object({ name: z.string().trim().min(1).max(60).optional(), sortOrder: z.number().int().optional() }).passthrough();
const tagErrorSchema = z.object({ error: z.string() }).passthrough();

export default async function (fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook("onRequest", fastify.authenticate);

  // List all tags
  fastify.get("/api/tags", {
    schema: { operationId: "listTags", tags: ["categories"], response: { 200: z.array(tagSchema) } },
  }, async () => {
    const allTags = await db
      .select({
        id: tags.id,
        name: tags.name,
        color: tags.color,
        groupId: tags.groupId,
        usageCount: sql<number>`count(${transactionTags.transactionId})`,
      })
      .from(tags)
      .leftJoin(transactionTags, eq(tags.id, transactionTags.tagId))
      .groupBy(tags.id, tags.name, tags.color, tags.groupId);
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
      groupId: number | null;
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

    if (body.groupId != null) {
      const [group] = await db.select({ id: tagGroups.id }).from(tagGroups).where(eq(tagGroups.id, body.groupId)).limit(1);
      if (!group) {
        reply.code(400).send({ error: "Tag group not found" });
        return;
      }
    }

    const [updated] = await db
      .update(tags)
      .set({
        ...(body.name && { name: body.name }),
        ...(body.color && { color: body.color }),
        ...(body.groupId !== undefined && { groupId: body.groupId }),
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

  // Tag groups: folders for the tag list only; reports never look at them.
  fastify.get("/api/tag-groups", {
    schema: { operationId: "listTagGroups", tags: ["categories"], response: { 200: z.array(tagGroupSchema) } },
  }, async () => db.select({ id: tagGroups.id, name: tagGroups.name, sortOrder: tagGroups.sortOrder }).from(tagGroups).orderBy(asc(tagGroups.sortOrder), asc(tagGroups.id)));

  fastify.post("/api/tag-groups", {
    schema: { operationId: "createTagGroup", tags: ["categories"], body: tagGroupBodySchema, response: { 201: tagGroupSchema } },
  }, async (request, reply) => {
    const { name } = request.body as { name: string };
    const [{ next }] = await db.select({ next: sql<number>`coalesce(max(${tagGroups.sortOrder}), -1) + 1` }).from(tagGroups);
    const [group] = await db.insert(tagGroups).values({ name: name.trim(), sortOrder: Number(next) })
      .returning({ id: tagGroups.id, name: tagGroups.name, sortOrder: tagGroups.sortOrder });
    reply.code(201).send(group);
  });

  fastify.patch("/api/tag-groups/:id", {
    schema: { operationId: "updateTagGroup", tags: ["categories"], params: tagIdParamsSchema, body: tagGroupUpdateBodySchema, response: { 200: tagGroupSchema, 404: tagErrorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as { id: number };
    const body = request.body as { name?: string; sortOrder?: number };
    const [group] = await db.update(tagGroups)
      .set({ ...(body.name !== undefined && { name: body.name.trim() }), ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }) })
      .where(eq(tagGroups.id, id))
      .returning({ id: tagGroups.id, name: tagGroups.name, sortOrder: tagGroups.sortOrder });
    if (!group) return reply.code(404).send({ error: "Tag group not found" });
    return group;
  });

  /** Deleting a group keeps its tags; they just become ungrouped. */
  fastify.delete("/api/tag-groups/:id", {
    schema: { operationId: "deleteTagGroup", tags: ["categories"], params: tagIdParamsSchema, response: { 204: z.null(), 404: tagErrorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as { id: number };
    const deleted = db.transaction((tx) => {
      tx.update(tags).set({ groupId: null }).where(eq(tags.groupId, id)).run();
      return tx.delete(tagGroups).where(eq(tagGroups.id, id)).run().changes;
    });
    if (deleted === 0) return reply.code(404).send({ error: "Tag group not found" });
    return reply.code(204).send();
  });
}
