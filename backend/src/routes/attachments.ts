import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client";
import { attachments, transactions } from "../db/schema";
import {
  uploadFile,
  deleteFile,
  generatePresignedDownloadUrl,
  generateAttachmentKey,
} from "../services/r2";

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

    // Generate key and upload to R2
    const key = generateAttachmentKey(body.transactionId, body.filename);

    try {
      await uploadFile(key, buffer, body.contentType);

      // Store metadata in database
      const [attachment] = await db
        .insert(attachments)
        .values({
          transactionId: body.transactionId,
          filename: body.filename,
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

    // Delete from R2
    try {
      await deleteFile(attachment.r2Key);
    } catch (err) {
      fastify.log.error(err);
      // Continue to delete from DB even if R2 delete fails
    }

    // Delete from database
    await db.delete(attachments).where(eq(attachments.id, parseInt(id)));

    reply.code(204).send();
  });
}
