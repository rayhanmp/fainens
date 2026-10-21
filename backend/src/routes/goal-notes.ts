import { asc, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { db } from "../db/client";
import { goalNotePages, goalNoteVersions, savingsGoals } from "../db/schema";
import { goalDueTasks, savePageContent, searchNotes } from "../services/goal-notes";

/** A goal's note pages, their saved copies, search across all notes, and dated checklist items. */

const MAX_CONTENT = 100_000;
const idParams = z.object({ id: z.coerce.number().int().positive() });
const errorSchema = z.object({ error: z.string() }).passthrough();
const pageSchema = z.object({
  id: z.number().int(),
  goalId: z.number().int(),
  title: z.string(),
  content: z.string(),
  sortOrder: z.number().int(),
  updatedAt: z.number(),
});
const versionSchema = z.object({ id: z.number().int(), pageId: z.number().int(), createdAt: z.number(), preview: z.string(), length: z.number().int() });
const title = z.string().trim().min(1).max(80);

const pageView = (row: typeof goalNotePages.$inferSelect) => ({
  id: row.id,
  goalId: row.goalId,
  title: row.title,
  content: row.content,
  sortOrder: row.sortOrder,
  updatedAt: row.updatedAt.getTime(),
});

async function onePage(id: number) {
  const [row] = await db.select().from(goalNotePages).where(eq(goalNotePages.id, id)).limit(1);
  return row as typeof goalNotePages.$inferSelect | undefined;
}

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/goals/notes/search", {
    schema: {
      operationId: "searchGoalNotes",
      tags: ["goals"],
      querystring: z.object({ q: z.string().max(100) }),
      response: { 200: z.array(z.object({ goalId: z.number().int(), goalName: z.string(), goalIcon: z.string().nullable(), pageId: z.number().int(), pageTitle: z.string(), snippet: z.string() })) },
    },
  }, async (request) => searchNotes((request.query as { q: string }).q));

  fastify.get("/api/goals/notes/tasks", {
    schema: {
      operationId: "listGoalDueTasks",
      tags: ["goals"],
      response: { 200: z.array(z.object({ goalId: z.number().int(), goalName: z.string(), pageId: z.number().int(), text: z.string(), dueAt: z.number() })) },
    },
  }, async () => goalDueTasks());

  fastify.get("/api/goals/:id/pages", {
    schema: { operationId: "listGoalPages", tags: ["goals"], params: idParams, response: { 200: z.array(pageSchema) } },
  }, async (request) => {
    const { id } = request.params as z.infer<typeof idParams>;
    const rows = await db.select().from(goalNotePages).where(eq(goalNotePages.goalId, id)).orderBy(asc(goalNotePages.sortOrder), asc(goalNotePages.id));
    return rows.map(pageView);
  });

  fastify.post("/api/goals/:id/pages", {
    schema: {
      operationId: "addGoalPage",
      tags: ["goals"],
      params: idParams,
      body: z.object({ title, content: z.string().max(MAX_CONTENT).optional() }).strict(),
      response: { 201: pageSchema, 404: errorSchema },
    },
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof idParams>;
    const body = request.body as { title: string; content?: string };
    const [goal] = await db.select({ id: savingsGoals.id }).from(savingsGoals).where(eq(savingsGoals.id, id)).limit(1);
    if (!goal) return reply.code(404).send({ error: "Goal not found" });
    const [{ next }] = await db.select({ next: sql<number>`coalesce(max(${goalNotePages.sortOrder}), -1) + 1` }).from(goalNotePages).where(eq(goalNotePages.goalId, id));
    const [created] = await db.insert(goalNotePages).values({ goalId: id, title: body.title, content: body.content ?? "", sortOrder: Number(next) }).returning();
    return reply.code(201).send(pageView(created));
  });

  fastify.put("/api/goals/:id/pages/order", {
    schema: { operationId: "reorderGoalPages", tags: ["goals"], params: idParams, body: z.object({ ids: z.array(z.number().int().positive()).max(100) }).strict(), response: { 200: z.array(pageSchema) } },
  }, async (request) => {
    const { id } = request.params as z.infer<typeof idParams>;
    const { ids } = request.body as { ids: number[] };
    const rows = await db.select().from(goalNotePages).where(eq(goalNotePages.goalId, id)).orderBy(asc(goalNotePages.sortOrder), asc(goalNotePages.id));
    const ordered = [...ids.filter((pageId) => rows.some((row: { id: number }) => row.id === pageId)), ...rows.map((row: { id: number }) => row.id).filter((pageId: number) => !ids.includes(pageId))];
    for (const [index, pageId] of ordered.entries()) await db.update(goalNotePages).set({ sortOrder: index }).where(eq(goalNotePages.id, pageId));
    const after = await db.select().from(goalNotePages).where(eq(goalNotePages.goalId, id)).orderBy(asc(goalNotePages.sortOrder), asc(goalNotePages.id));
    return after.map(pageView);
  });

  fastify.patch("/api/goal-pages/:id", {
    schema: {
      operationId: "updateGoalPage",
      tags: ["goals"],
      params: idParams,
      body: z.object({ title: title.optional(), content: z.string().max(MAX_CONTENT).optional() }).strict(),
      response: { 200: pageSchema, 404: errorSchema },
    },
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof idParams>;
    const body = request.body as { title?: string; content?: string };
    const page = await onePage(id);
    if (!page) return reply.code(404).send({ error: "Page not found" });
    if (body.title !== undefined) await db.update(goalNotePages).set({ title: body.title, updatedAt: new Date() }).where(eq(goalNotePages.id, id));
    if (body.content !== undefined) await savePageContent(page, body.content);
    return pageView((await onePage(id))!);
  });

  fastify.delete("/api/goal-pages/:id", {
    schema: { operationId: "deleteGoalPage", tags: ["goals"], params: idParams, response: { 204: z.null(), 404: errorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof idParams>;
    const result = await db.delete(goalNotePages).where(eq(goalNotePages.id, id)).run();
    if (result.changes === 0) return reply.code(404).send({ error: "Page not found" });
    return reply.code(204).send();
  });

  fastify.get("/api/goal-pages/:id/versions", {
    schema: { operationId: "listGoalPageVersions", tags: ["goals"], params: idParams, response: { 200: z.array(versionSchema) } },
  }, async (request) => {
    const { id } = request.params as z.infer<typeof idParams>;
    const rows = await db.select().from(goalNoteVersions).where(eq(goalNoteVersions.pageId, id)).orderBy(desc(goalNoteVersions.createdAt), desc(goalNoteVersions.id));
    return rows.map((row: typeof goalNoteVersions.$inferSelect) => ({
      id: row.id,
      pageId: row.pageId,
      createdAt: row.createdAt.getTime(),
      preview: row.content.replace(/\s+/g, " ").trim().slice(0, 140),
      length: row.content.length,
    }));
  });

  fastify.get("/api/goal-page-versions/:id", {
    schema: { operationId: "getGoalPageVersion", tags: ["goals"], params: idParams, response: { 200: z.object({ id: z.number().int(), pageId: z.number().int(), content: z.string(), createdAt: z.number() }), 404: errorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof idParams>;
    const [row] = await db.select().from(goalNoteVersions).where(eq(goalNoteVersions.id, id)).limit(1);
    if (!row) return reply.code(404).send({ error: "Copy not found" });
    return { id: row.id, pageId: row.pageId, content: row.content, createdAt: row.createdAt.getTime() };
  });

  fastify.post("/api/goal-page-versions/:id/restore", {
    schema: { operationId: "restoreGoalPageVersion", tags: ["goals"], params: idParams, response: { 200: pageSchema, 404: errorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof idParams>;
    const [version] = await db.select().from(goalNoteVersions).where(eq(goalNoteVersions.id, id)).limit(1);
    if (!version) return reply.code(404).send({ error: "Copy not found" });
    const page = await onePage(version.pageId);
    if (!page) return reply.code(404).send({ error: "Page not found" });
    // What's there now is kept too, so restoring can itself be undone.
    await savePageContent(page, version.content, db, true);
    return pageView((await onePage(page.id))!);
  });
}
