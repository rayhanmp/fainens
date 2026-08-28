import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createReadStream } from "fs";
import { promises as fs } from "fs";

import { db } from "../db/client";
import { attachments, auditLogs, storageDeletionOutbox, transactions } from "../db/schema";
import {
  uploadFile,
  generatePresignedDownloadUrl,
  generateAttachmentKey,
  getLocalFilePath,
} from "../services/r2";
import { processStorageDeletionOutbox } from "../services/storage-cleanup";

// Allowed MIME types for file uploads
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls
];

// Maximum file size: 5MB
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB in bytes

const attachmentErrorSchema = z.object({ error: z.string() }).passthrough();
const attachmentIdParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const attachmentMimeTypeSchema = z.enum([
  "image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf", "text/plain", "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel",
]);
const attachmentSchema = z.object({
  id: z.number().int(), transactionId: z.number().int(), filename: z.string(), r2Key: z.string(), mimetype: z.string(), fileSize: z.number().int(),
}).passthrough();
const attachmentWithUrlSchema = attachmentSchema.extend({ downloadUrl: z.string().url().nullable(), expiresIn: z.number().int().nonnegative() }).passthrough();
const attachmentListQuerySchema = z.object({ transactionId: z.string().regex(/^\d+$/).optional() });
const attachmentUrlQuerySchema = z.object({ expiresIn: z.string().regex(/^\d+$/).optional() });
const attachmentUploadBodySchema = z.object({
  transactionId: z.number().int().positive(), filename: z.string().trim().min(1).max(255), contentType: attachmentMimeTypeSchema, data: z.string().min(1),
}).passthrough();
const attachmentCleanupPendingSchema = z.object({ success: z.literal(true), cleanupPending: z.literal(true), message: z.string() }).passthrough();

export default async function (fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook("onRequest", fastify.authenticate);

  // List attachments for a transaction
  fastify.get("/api/attachments", {
    schema: { operationId: "listAttachments", tags: ["attachments"], querystring: attachmentListQuerySchema, response: { 200: z.array(attachmentSchema) } },
  }, async (request) => {
    const { transactionId } = request.query as { transactionId?: string };

    // Build query
    let query = db.select().from(attachments);

    if (transactionId) {
      query = query.where(eq(attachments.transactionId, parseInt(transactionId))) as any;
    }

    const allAttachments = await query;
    return allAttachments;
  });

  // Get single attachment with presigned URL
  fastify.get("/api/attachments/:id", {
    schema: { operationId: "getAttachment", tags: ["attachments"], params: attachmentIdParamsSchema, response: { 200: attachmentWithUrlSchema, 404: attachmentErrorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [attachment] = await db
      .select()
      .from(attachments)
      .where(eq(attachments.id, parseInt(id)))
      .limit(1);

    if (!attachment) {
      reply.code(404).send({ error: "Attachment not found" });
      return;
    }

    // Generate presigned URL for download
    const downloadUrl = await generatePresignedDownloadUrl(attachment.r2Key, 3600);

    return {
      ...attachment,
      downloadUrl,
      expiresIn: 3600,
    };
  });

  // Get presigned URL for direct download
  fastify.get("/api/attachments/:id/url", {
    schema: { operationId: "getAttachmentDownloadUrl", tags: ["attachments"], params: attachmentIdParamsSchema, querystring: attachmentUrlQuerySchema, response: { 200: z.object({ url: z.string().url(), expiresIn: z.number().int().nonnegative() }).passthrough(), 404: attachmentErrorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { expiresIn = "3600" } = request.query as { expiresIn?: string };

    const [attachment] = await db
      .select()
      .from(attachments)
      .where(eq(attachments.id, parseInt(id)))
      .limit(1);

    if (!attachment) {
      reply.code(404).send({ error: "Attachment not found" });
      return;
    }

    const url = await generatePresignedDownloadUrl(attachment.r2Key, parseInt(expiresIn));

    return { url, expiresIn: parseInt(expiresIn) };
  });

  // Upload attachment
  fastify.post("/api/attachments/upload", {
    config: { rateLimit: { max: 20, timeWindow: "1 minute", groupId: "attachment-upload" } },
    schema: { operationId: "uploadAttachment", tags: ["attachments"], body: attachmentUploadBodySchema, response: { 201: attachmentWithUrlSchema, 400: attachmentErrorSchema, 404: attachmentErrorSchema, 500: attachmentErrorSchema } },
  }, async (request, reply) => {
    const body = request.body as {
      transactionId: number;
      filename: string;
      contentType: string;
      data: string; // base64 encoded file data
    };

    // Validate required fields
    if (!body.transactionId || !body.filename || !body.contentType || !body.data) {
      reply.code(400).send({ error: "Missing required fields: transactionId, filename, contentType, data" });
      return;
    }

    // Validate file type
    if (!ALLOWED_MIME_TYPES.includes(body.contentType)) {
      reply.code(400).send({ 
        error: "Invalid file type",
        allowedTypes: ALLOWED_MIME_TYPES 
      });
      return;
    }

    // Validate transaction exists
    const [transaction] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, body.transactionId))
      .limit(1);

    if (!transaction) {
      reply.code(404).send({ error: "Transaction not found" });
      return;
    }

    // Decode base64 data
    const encoded = body.data.trim();
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
      reply.code(400).send({ error: "Invalid base64 data" });
      return;
    }
    const buffer = Buffer.from(encoded, "base64");
    if (buffer.length === 0) {
      reply.code(400).send({ error: "Attachment data cannot be empty" });
      return;
    }

    // Validate file size
    if (buffer.length > MAX_FILE_SIZE) {
      reply.code(400).send({ 
        error: "File too large", 
        maxSize: `${MAX_FILE_SIZE / (1024 * 1024)}MB`,
        actualSize: `${(buffer.length / (1024 * 1024)).toFixed(2)}MB`
      });
      return;
    }

    // Validate filename (prevent path traversal)
    const sanitizedFilename = body.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    if (!sanitizedFilename || sanitizedFilename.length === 0) {
      reply.code(400).send({ error: "Invalid filename" });
      return;
    }

    // Generate key and upload to R2
    const key = generateAttachmentKey(body.transactionId, sanitizedFilename);

    try {
      await uploadFile(key, buffer, body.contentType);
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: "Failed to store uploaded file" });
    }

    let attachment: any;
    try {
      attachment = db.transaction((tx) => {
        const inserted = tx
          .insert(attachments)
          .values({
            transactionId: body.transactionId,
            filename: sanitizedFilename,
            r2Key: key,
            mimetype: body.contentType,
            fileSize: buffer.length,
          })
          .returning()
          .all()[0];
        if (!inserted) throw new Error("Failed to store attachment metadata");
        tx.insert(auditLogs).values({
          entityType: "attachment",
          entityId: inserted.id,
          action: "create",
          afterSnapshot: Buffer.from(JSON.stringify(inserted)),
        }).run();
        return inserted;
      });
    } catch (err) {
      fastify.log.error(err);
      // The object already exists. Preserve a durable retry key even though
      // its metadata transaction failed.
      try {
        const queued = await db
          .insert(storageDeletionOutbox)
          .values({ r2Key: key, entityType: "orphan_upload", entityId: body.transactionId })
          .returning({ id: storageDeletionOutbox.id });
        if (queued[0]) void processStorageDeletionOutbox([queued[0].id]);
      } catch (queueError) {
        fastify.log.error(queueError, "Failed to enqueue orphan upload cleanup");
      }
      return reply.code(500).send({ error: "Failed to save attachment metadata" });
    }

    try {
      const downloadUrl = await generatePresignedDownloadUrl(key, 3600);
      return reply.code(201).send({ ...attachment, downloadUrl, expiresIn: 3600 });
    } catch (err) {
      // The upload is valid even if a temporary signing operation fails.
      fastify.log.error(err, "Attachment stored but download URL generation failed");
      return reply.code(201).send({ ...attachment, downloadUrl: null, expiresIn: 0 });
    }
  });

  // Delete attachment
  fastify.delete("/api/attachments/:id", {
    schema: { operationId: "deleteAttachment", tags: ["attachments"], params: attachmentIdParamsSchema, response: { 202: attachmentCleanupPendingSchema, 204: z.null(), 400: attachmentErrorSchema, 404: attachmentErrorSchema, 500: attachmentErrorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const attachmentId = parseInt(id, 10);
      if (!Number.isInteger(attachmentId) || attachmentId <= 0) {
        return reply.code(400).send({ error: "Invalid attachment ID" });
      }
      const outboxId = db.transaction((tx) => {
        const attachment = tx
          .select()
          .from(attachments)
          .where(eq(attachments.id, attachmentId))
          .limit(1)
          .all()[0];
        if (!attachment) return null;
        const queued = tx
          .insert(storageDeletionOutbox)
          .values({
            r2Key: attachment.r2Key,
            entityType: "attachment",
            entityId: attachment.id,
          })
          .returning({ id: storageDeletionOutbox.id })
          .all()[0];
        if (!queued) throw new Error("Failed to enqueue attachment cleanup");
        tx.insert(auditLogs).values({
          entityType: "attachment",
          entityId: attachment.id,
          action: "delete",
          beforeSnapshot: Buffer.from(JSON.stringify(attachment)),
        }).run();
        tx.delete(attachments).where(eq(attachments.id, attachment.id)).run();
        return queued.id;
      });
      if (outboxId === null) return reply.code(404).send({ error: "Attachment not found" });

      const cleanup = await processStorageDeletionOutbox([outboxId]);
      if (cleanup.failed > 0) {
        return reply.code(202).send({
          success: true,
          cleanupPending: true,
          message: "Attachment removed; storage cleanup is queued for retry",
        });
      }
      return reply.code(204).send();
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: "Failed to delete attachment" });
    }
  });

  // Serve local files (when R2 is not configured)
  fastify.get("/api/attachments/local/*", {
    schema: { operationId: "serveLocalAttachment", tags: ["attachments"], response: { 404: attachmentErrorSchema } },
  }, async (request, reply) => {
    try {
      const key = request.url.replace('/api/attachments/local/', '');
      const decodedKey = decodeURIComponent(key);
      const filePath = getLocalFilePath(decodedKey);
      const [attachment] = await db
        .select()
        .from(attachments)
        .where(eq(attachments.r2Key, decodedKey))
        .limit(1);
      if (!attachment) return reply.code(404).send({ error: "File not found" });

      // Check if file exists
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        reply.code(404).send({ error: "File not found" });
        return;
      }

      reply.header("Content-Type", attachment.mimetype);
      reply.header("X-Content-Type-Options", "nosniff");
      const safeDownloadName = attachment.filename.replace(/["\r\n]/g, "_");
      reply.header("Content-Disposition", `inline; filename="${safeDownloadName}"`);

      // Stream the file
      const stream = createReadStream(filePath);
      reply.send(stream);
    } catch {
      reply.code(404).send({ error: "File not found" });
    }
  });

  // Serve wishlist images (when R2 is not configured)
  fastify.get("/api/wishlist-images/*", {
    schema: { operationId: "serveWishlistImage", tags: ["attachments"], response: { 404: attachmentErrorSchema } },
  }, async (request, reply) => {
    try {
      const key = request.url.replace('/api/wishlist-images/', '');
      const decodedKey = decodeURIComponent(key);
      const filePath = getLocalFilePath(decodedKey);
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        reply.code(404).send({ error: "Image not found" });
        return;
      }

      reply.header("Content-Type", "image/jpeg");
      const stream = createReadStream(filePath);
      reply.send(stream);
    } catch {
      reply.code(404).send({ error: "Image not found" });
    }
  });
}
