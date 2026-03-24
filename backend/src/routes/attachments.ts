import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { createReadStream } from "fs";
import { promises as fs } from "fs";

import { db } from "../db/client";
import { attachments, transactions } from "../db/schema";
import {
  uploadFile,
  deleteFile,
  generatePresignedDownloadUrl,
  generateAttachmentKey,
  getLocalFilePath,
} from "../services/r2";

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

export default async function (fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook("onRequest", fastify.authenticate);

  // List attachments for a transaction
  fastify.get("/api/attachments", async (request) => {
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
  fastify.get("/api/attachments/:id", async (request, reply) => {
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
  fastify.get("/api/attachments/:id/url", async (request, reply) => {
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
  fastify.post("/api/attachments/upload", async (request, reply) => {
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
    let buffer: Buffer;
    try {
      buffer = Buffer.from(body.data, "base64");
    } catch {
      reply.code(400).send({ error: "Invalid base64 data" });
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

      // Store metadata in database
      const [attachment] = await db
        .insert(attachments)
        .values({
          transactionId: body.transactionId,
          filename: sanitizedFilename,
          r2Key: key,
          mimetype: body.contentType,
          fileSize: buffer.length,
        })
        .returning();

      // Generate download URL
      const downloadUrl = await generatePresignedDownloadUrl(key, 3600);

      reply.code(201).send({
        ...attachment,
        downloadUrl,
        expiresIn: 3600,
      });
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: "Failed to upload file" });
    }
  });

  // Delete attachment
  fastify.delete("/api/attachments/:id", async (request, reply) => {
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

    let storageDeleted = true;
    let storageError: string | null = null;

    // Delete from R2
    try {
      await deleteFile(attachment.r2Key);
    } catch (err) {
      storageDeleted = false;
      storageError = (err as Error).message;
      fastify.log.error(err);
    }

    // Delete from database
    await db.delete(attachments).where(eq(attachments.id, parseInt(id)));

    // Report partial failure if storage delete failed
    if (!storageDeleted) {
      reply.code(200).send({ 
        success: true, 
        warning: "Attachment metadata deleted but file storage cleanup failed",
        storageError 
      });
      return;
    }

    reply.code(204).send();
  });

  // Serve local files (when R2 is not configured)
  fastify.get("/api/attachments/local/*", async (request, reply) => {
    const url = request.url;
    const key = url.replace('/api/attachments/local/', '');
    const decodedKey = decodeURIComponent(key);
    const filePath = getLocalFilePath(decodedKey);

    try {
      // Check if file exists
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        reply.code(404).send({ error: "File not found" });
        return;
      }

      // Get the attachment record to determine content type
      const [attachment] = await db
        .select()
        .from(attachments)
        .where(eq(attachments.r2Key, decodedKey))
        .limit(1);

      if (attachment) {
        reply.header("Content-Type", attachment.mimetype);
        reply.header("Content-Disposition", `inline; filename="${attachment.filename}"`);
      }

      // Stream the file
      const stream = createReadStream(filePath);
      reply.send(stream);
    } catch {
      reply.code(404).send({ error: "File not found" });
    }
  });

  // Serve wishlist images (when R2 is not configured)
  fastify.get("/api/wishlist-images/*", async (request, reply) => {
    const url = request.url;
    const key = url.replace('/api/wishlist-images/', '');
    const decodedKey = decodeURIComponent(key);
    const filePath = getLocalFilePath(decodedKey);

    try {
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
