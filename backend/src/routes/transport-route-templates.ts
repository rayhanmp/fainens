import { and, asc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { accounts, categories, tags, transportRouteTemplates } from "../db/schema";
import { db } from "../db/client";

function textValue(value: unknown, field: string, maxLength: number, nullable = true): string | null | undefined {
  if (value == null) return nullable ? null : undefined;
  if (typeof value !== "string" || value.length > maxLength) throw new Error(`${field} must be a string of at most ${maxLength} characters`);
  const trimmed = value.trim();
  if (!trimmed && !nullable) throw new Error(`${field} is required`);
  return trimmed || null;
}

function idValue(value: unknown, field: string): number | null | undefined {
  if (value == null || value === "") return null;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${field} must be a positive integer or null`);
  return id;
}

function coordinateValue(value: unknown, field: string): number | null | undefined {
  if (value == null || value === "") return null;
  const max = field.toLowerCase().includes("lat") ? 90 : 180;
  if (typeof value !== "number" || !Number.isFinite(value) || value < -max || value > max) throw new Error(`${field} must be a valid coordinate or null`);
  return value;
}

async function validateReferences(categoryId: number | null | undefined, defaultAccountId: number | null | undefined, tagIds: number[]) {
  if (categoryId != null) {
    const [row] = await db.select({ id: categories.id }).from(categories).where(and(eq(categories.id, categoryId), eq(categories.isActive, true))).limit(1);
    if (!row) throw new Error("Category not found or inactive");
  }
  if (defaultAccountId != null) {
    const [row] = await db.select({ id: accounts.id }).from(accounts).where(and(
      eq(accounts.id, defaultAccountId),
      eq(accounts.isActive, true),
      eq(accounts.type, "asset"),
      eq(accounts.liquidityClass, "cash_equivalent"),
    )).limit(1);
    if (!row) throw new Error("Default account must be an active cash-equivalent asset");
  }
  if (tagIds.length > 0) {
    const rows = await db.select({ id: tags.id }).from(tags).where(inArray(tags.id, tagIds));
    if (rows.length !== tagIds.length) throw new Error("One or more tags do not exist");
  }
}

function parseTagIds(value: unknown): number[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 100 || value.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error("tagIds must contain at most 100 positive integer IDs");
  return [...new Set(value as number[])].sort((a, b) => a - b);
}

function view(row: typeof transportRouteTemplates.$inferSelect) {
  let tagIds: number[] = [];
  try {
    const parsed = JSON.parse(row.tagIds);
    if (Array.isArray(parsed)) tagIds = parsed.filter((id): id is number => Number.isSafeInteger(id) && id > 0);
  } catch { /* legacy malformed metadata is treated as empty */ }
  return { ...row, tagIds };
}

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/transport-route-templates", async () => {
    const rows = await db.select().from(transportRouteTemplates).orderBy(asc(transportRouteTemplates.name));
    return { templates: rows.map(view) };
  });

  fastify.post("/api/transport-route-templates", async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown>;
      const name = textValue(body?.name, "name", 150, false) as string;
      const provider = textValue(body?.provider, "provider", 80);
      const service = textValue(body?.service, "service", 100);
      const originName = textValue(body?.originName, "originName", 200);
      const originLat = coordinateValue(body?.originLat, "originLat");
      const originLng = coordinateValue(body?.originLng, "originLng");
      const destName = textValue(body?.destName, "destName", 200);
      const destLat = coordinateValue(body?.destLat, "destLat");
      const destLng = coordinateValue(body?.destLng, "destLng");
      const categoryId = idValue(body?.categoryId, "categoryId");
      const defaultAccountId = idValue(body?.defaultAccountId, "defaultAccountId");
      const notes = textValue(body?.notes, "notes", 2000);
      const tagIds = parseTagIds(body?.tagIds);
      await validateReferences(categoryId, defaultAccountId, tagIds);
      const [created] = await db.insert(transportRouteTemplates).values({ name, provider, service, originName, originLat, originLng, destName, destLat, destLng, categoryId, defaultAccountId, notes, tagIds: JSON.stringify(tagIds) }).returning();
      return reply.code(201).send({ template: created ? view(created) : null });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not create route template" });
    }
  });

  fastify.patch("/api/transport-route-templates/:id", async (request, reply) => {
    try {
      const id = Number((request.params as { id?: string }).id);
      if (!Number.isSafeInteger(id) || id <= 0) return reply.code(400).send({ error: "Invalid template ID" });
      const [existing] = await db.select().from(transportRouteTemplates).where(eq(transportRouteTemplates.id, id)).limit(1);
      if (!existing) return reply.code(404).send({ error: "Route template not found" });
      const body = request.body as Record<string, unknown>;
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (Object.prototype.hasOwnProperty.call(body, "name")) updates.name = textValue(body.name, "name", 150, false);
      if (Object.prototype.hasOwnProperty.call(body, "provider")) updates.provider = textValue(body.provider, "provider", 80);
      if (Object.prototype.hasOwnProperty.call(body, "service")) updates.service = textValue(body.service, "service", 100);
      if (Object.prototype.hasOwnProperty.call(body, "originName")) updates.originName = textValue(body.originName, "originName", 200);
      if (Object.prototype.hasOwnProperty.call(body, "originLat")) updates.originLat = coordinateValue(body.originLat, "originLat");
      if (Object.prototype.hasOwnProperty.call(body, "originLng")) updates.originLng = coordinateValue(body.originLng, "originLng");
      if (Object.prototype.hasOwnProperty.call(body, "destName")) updates.destName = textValue(body.destName, "destName", 200);
      if (Object.prototype.hasOwnProperty.call(body, "destLat")) updates.destLat = coordinateValue(body.destLat, "destLat");
      if (Object.prototype.hasOwnProperty.call(body, "destLng")) updates.destLng = coordinateValue(body.destLng, "destLng");
      if (Object.prototype.hasOwnProperty.call(body, "categoryId")) updates.categoryId = idValue(body.categoryId, "categoryId");
      if (Object.prototype.hasOwnProperty.call(body, "defaultAccountId")) updates.defaultAccountId = idValue(body.defaultAccountId, "defaultAccountId");
      if (Object.prototype.hasOwnProperty.call(body, "notes")) updates.notes = textValue(body.notes, "notes", 2000);
      if (Object.prototype.hasOwnProperty.call(body, "tagIds")) updates.tagIds = JSON.stringify(parseTagIds(body.tagIds));
      const categoryId = updates.categoryId === undefined ? existing.categoryId : updates.categoryId as number | null;
      const defaultAccountId = updates.defaultAccountId === undefined ? existing.defaultAccountId : updates.defaultAccountId as number | null;
      const tagIds = updates.tagIds === undefined ? parseTagIds(existing.tagIds ? JSON.parse(existing.tagIds) : []) : parseTagIds(JSON.parse(updates.tagIds as string));
      await validateReferences(categoryId, defaultAccountId, tagIds);
      const [updated] = await db.update(transportRouteTemplates).set(updates).where(eq(transportRouteTemplates.id, id)).returning();
      return { template: updated ? view(updated) : null };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not update route template" });
    }
  });

  fastify.delete("/api/transport-route-templates/:id", async (request, reply) => {
    const id = Number((request.params as { id?: string }).id);
    if (!Number.isSafeInteger(id) || id <= 0) return reply.code(400).send({ error: "Invalid template ID" });
    const result = await db.delete(transportRouteTemplates).where(eq(transportRouteTemplates.id, id)).run();
    if (result.changes === 0) return reply.code(404).send({ error: "Route template not found" });
    return reply.code(204).send();
  });
}
