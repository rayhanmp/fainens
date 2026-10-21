import { and, eq, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createReadStream } from "fs";
import { promises as fs } from "fs";

import { db } from "../db/client";
import { goalAttachments, savingsGoals, storageDeletionOutbox } from "../db/schema";
import { generatePresignedDownloadUrl, getLocalFilePath, isObjectStorageConfigured, uploadFile } from "../services/r2";
import { scrapeProduct } from "../services/scraper-enhanced";
import { processStorageDeletionOutbox } from "../services/storage-cleanup";
import { validateScrapeUrl } from "./wishlist";

/**
 * A goal's files (quotes, brochures, bookings, photos; one can be its cover) and the preview of a
 * product link. Files are stored like transaction attachments and served only to their goal.
 */

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf", "text/plain"] as const;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_FILES_PER_GOAL = 30;

const idParams = z.object({ id: z.coerce.number().int().positive() });
const errorSchema = z.object({ error: z.string() }).passthrough();
const attachmentSchema = z.object({
  id: z.number().int(),
  goalId: z.number().int(),
  filename: z.string(),
  mimetype: z.string(),
  fileSize: z.number().int(),
  isCover: z.boolean(),
  createdAt: z.number(),
});

const view = (row: typeof goalAttachments.$inferSelect) => ({
  id: row.id,
  goalId: row.goalId,
  filename: row.filename,
  mimetype: row.mimetype,
  fileSize: row.fileSize,
  isCover: Boolean(row.isCover),
  createdAt: row.createdAt.getTime(),
});

/** Keys a link preview just stored, so the picture shows before the goal is saved; kept an hour. */
const previewed = new Map<string, number>();
function rememberPreview(key: string) {
  const now = Date.now();
  for (const [stored, at] of previewed) if (now - at > 3_600_000) previewed.delete(stored);
  previewed.set(key, now);
}

/** Queues storage keys for deletion and runs the cleanup straight away; retried later if it fails. */
export async function queueFileCleanup(keys: Array<{ r2Key: string; entityType: string; entityId: number }>) {
  if (!keys.length) return;
  const queued = await db.insert(storageDeletionOutbox).values(keys).returning({ id: storageDeletionOutbox.id });
  void processStorageDeletionOutbox(queued.map((row: { id: number }) => row.id));
}

/** Streams a stored file, or redirects to it when it lives in object storage. */
async function sendStored(reply: any, key: string, mimetype: string, filename?: string) {
  if (isObjectStorageConfigured()) return reply.redirect(await generatePresignedDownloadUrl(key, 3600));
  const filePath = getLocalFilePath(key);
  const stats = await fs.stat(filePath);
  if (!stats.isFile()) return reply.code(404).send({ error: "File not found" });
  reply.header("Content-Type", mimetype);
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Cache-Control", "private, max-age=3600");
  if (filename) reply.header("Content-Disposition", `inline; filename="${filename.replace(/["\r\n]/g, "_")}"`);
  return reply.send(createReadStream(filePath));
}

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.post("/api/goals/:id/attachments", {
    config: { rateLimit: { max: 20, timeWindow: "1 minute", groupId: "goal-file-upload" } },
    schema: {
      operationId: "uploadGoalAttachment",
      tags: ["goals"],
      params: idParams,
      body: z.object({ filename: z.string().trim().min(1).max(200), contentType: z.enum(ALLOWED_MIME_TYPES), data: z.string().min(1) }).strict(),
      response: { 201: attachmentSchema, 400: errorSchema, 404: errorSchema, 500: errorSchema },
    },
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof idParams>;
    const body = request.body as { filename: string; contentType: (typeof ALLOWED_MIME_TYPES)[number]; data: string };
    const [goal] = await db.select({ id: savingsGoals.id }).from(savingsGoals).where(eq(savingsGoals.id, id)).limit(1);
    if (!goal) return reply.code(404).send({ error: "Goal not found" });
    const existing = await db.select({ id: goalAttachments.id, isCover: goalAttachments.isCover }).from(goalAttachments).where(eq(goalAttachments.goalId, id));
    if (existing.length >= MAX_FILES_PER_GOAL) return reply.code(400).send({ error: `A goal holds up to ${MAX_FILES_PER_GOAL} files` });
    const encoded = body.data.trim();
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return reply.code(400).send({ error: "Invalid file data" });
    const buffer = Buffer.from(encoded, "base64");
    if (buffer.length === 0) return reply.code(400).send({ error: "The file is empty" });
    if (buffer.length > MAX_FILE_SIZE) return reply.code(400).send({ error: "Files can be up to 5 MB" });
    const filename = body.filename.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 200) || "file";
    const key = `goal-files/${id}/${Date.now()}_${filename.replace(/\s+/g, "_")}`;
    try {
      await uploadFile(key, buffer, body.contentType);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: "Could not store the file" });
    }
    try {
      // The first picture becomes the cover.
      const isCover = body.contentType.startsWith("image/") && !existing.some((row: { isCover: boolean }) => row.isCover);
      const [created] = await db.insert(goalAttachments).values({ goalId: id, filename, r2Key: key, mimetype: body.contentType, fileSize: buffer.length, isCover }).returning();
      return reply.code(201).send(view(created));
    } catch (error) {
      fastify.log.error(error);
      await queueFileCleanup([{ r2Key: key, entityType: "orphan_upload", entityId: id }]);
      return reply.code(500).send({ error: "Could not save the file" });
    }
  });

  fastify.get("/api/goal-attachments/:id/file", {
    schema: { operationId: "serveGoalAttachment", tags: ["goals"], params: idParams, response: { 404: errorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof idParams>;
    const [row] = await db.select().from(goalAttachments).where(eq(goalAttachments.id, id)).limit(1);
    if (!row) return reply.code(404).send({ error: "File not found" });
    try {
      return await sendStored(reply, row.r2Key, row.mimetype, row.filename);
    } catch {
      return reply.code(404).send({ error: "File not found" });
    }
  });

  fastify.patch("/api/goal-attachments/:id", {
    schema: {
      operationId: "updateGoalAttachment",
      tags: ["goals"],
      params: idParams,
      body: z.object({ isCover: z.boolean().optional(), filename: z.string().trim().min(1).max(200).optional() }).strict(),
      response: { 200: attachmentSchema, 400: errorSchema, 404: errorSchema },
    },
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof idParams>;
    const body = request.body as { isCover?: boolean; filename?: string };
    const [row] = await db.select().from(goalAttachments).where(eq(goalAttachments.id, id)).limit(1);
    if (!row) return reply.code(404).send({ error: "File not found" });
    if (body.isCover && !row.mimetype.startsWith("image/")) return reply.code(400).send({ error: "Only a picture can be the cover" });
    // One cover per goal.
    if (body.isCover) await db.update(goalAttachments).set({ isCover: false }).where(and(eq(goalAttachments.goalId, row.goalId), ne(goalAttachments.id, id)));
    const [updated] = await db.update(goalAttachments).set({
      ...(body.isCover !== undefined ? { isCover: body.isCover } : {}),
      ...(body.filename ? { filename: body.filename.replace(/[^a-zA-Z0-9._ -]/g, "_") } : {}),
    }).where(eq(goalAttachments.id, id)).returning();
    return view(updated);
  });

  fastify.delete("/api/goal-attachments/:id", {
    schema: { operationId: "deleteGoalAttachment", tags: ["goals"], params: idParams, response: { 204: z.null(), 404: errorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof idParams>;
    const outboxId = db.transaction((tx: any) => {
      const row = tx.select().from(goalAttachments).where(eq(goalAttachments.id, id)).limit(1).all()[0];
      if (!row) return null;
      const queued = tx.insert(storageDeletionOutbox).values({ r2Key: row.r2Key, entityType: "goal_attachment", entityId: row.id }).returning({ id: storageDeletionOutbox.id }).all()[0];
      tx.delete(goalAttachments).where(eq(goalAttachments.id, id)).run();
      return queued?.id ?? null;
    });
    if (outboxId === null) return reply.code(404).send({ error: "File not found" });
    void processStorageDeletionOutbox([outboxId]);
    return reply.code(204).send();
  });

  fastify.post("/api/goals/link-preview", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute", groupId: "goal-link-preview" } },
    schema: {
      operationId: "previewGoalLink",
      tags: ["goals"],
      body: z.object({ url: z.string().trim().url().max(2000) }).strict(),
      response: {
        200: z.object({ title: z.string().nullable(), price: z.number().nullable(), image: z.string().nullable(), source: z.string().nullable() }),
        400: errorSchema,
      },
    },
  }, async (request, reply) => {
    const { url } = request.body as { url: string };
    const check = validateScrapeUrl(url);
    if (!check.valid) return reply.code(400).send({ error: check.error ?? "This shop can't be read; the link is still saved" });
    const result = await scrapeProduct(url);
    if (!result.success || !result.data) return reply.code(400).send({ error: result.error?.message ?? "Couldn't read that page; the link is still saved" });
    const image = result.data.imageUrl && /^wishlist-images\//.test(result.data.imageUrl) ? result.data.imageUrl : null;
    if (image) rememberPreview(image);
    return {
      title: result.data.name?.slice(0, 300) || null,
      price: Number.isFinite(result.data.price) && result.data.price > 0 ? Math.round(result.data.price) : null,
      image,
      source: result.data.source ?? null,
    };
  });

  fastify.get("/api/goal-link-images/*", {
    schema: { operationId: "serveGoalLinkImage", tags: ["goals"], response: { 404: errorSchema } },
  }, async (request, reply) => {
    const key = decodeURIComponent(request.url.replace("/api/goal-link-images/", "").split("?")[0] ?? "");
    if (!/^wishlist-images\/[A-Za-z0-9._-]+$/.test(key)) return reply.code(404).send({ error: "Image not found" });
    const [owner] = await db.select({ id: savingsGoals.id }).from(savingsGoals).where(eq(savingsGoals.linkImage, key)).limit(1);
    if (!owner && !previewed.has(key)) return reply.code(404).send({ error: "Image not found" });
    try {
      return await sendStored(reply, key, "image/jpeg");
    } catch {
      return reply.code(404).send({ error: "Image not found" });
    }
  });
}
