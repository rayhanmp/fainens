import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { db } from "../db/client";
import { env } from "../lib/env";
import {
  agentConversations,
  agentMessageAttachments,
  attachments,
  auditLogs,
  storageDeletionOutbox,
  transactions,
  wishlist,
} from "../db/schema";
import { downloadFile, generatePresignedDownloadUrl, isObjectStorageConfigured } from "../services/r2";
import { processStorageDeletionOutbox } from "../services/storage-cleanup";

const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/svg+xml"];
const AGENT_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_AGENT_IMAGE_BYTES = 4 * 1024 * 1024;
const gallerySourceSchema = z.enum(["transaction", "agent", "wishlist"]);
const galleryQuerySchema = z.object({
  source: gallerySourceSchema.optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  offset: z.string().regex(/^\d+$/).optional(),
});
const galleryParamsSchema = z.object({ source: gallerySourceSchema, id: z.coerce.number().int().positive() });
const galleryImageSchema = z.object({
  id: z.number().int().positive(),
  source: gallerySourceSchema,
  filename: z.string(),
  mimetype: z.string(),
  fileSize: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative().nullable(),
  downloadUrl: z.string().nullable(),
  context: z.string().nullable(),
  relatedId: z.number().int().positive().nullable(),
  relatedLabel: z.string().nullable(),
  storageManaged: z.boolean(),
});
const galleryErrorSchema = z.object({ error: z.string() }).passthrough();
const galleryCleanupPendingSchema = z.object({ success: z.literal(true), cleanupPending: z.literal(true), message: z.string() }).passthrough();
const galleryAttachResponseSchema = z.object({
  filename: z.string(),
  mimeType: z.string(),
  fileSize: z.number().int().positive(),
  data: z.string(),
});

type GallerySource = z.infer<typeof gallerySourceSchema>;
type GalleryImage = z.infer<typeof galleryImageSchema>;

function currentOwnerEmail(request: { user?: unknown }): string {
  const user = request.user as { email?: unknown } | undefined;
  return typeof user?.email === "string" && user.email.trim() ? user.email : env.LOCAL_AUTH_EMAIL;
}

function timestamp(value: Date | number | null | undefined): number | null {
  if (value instanceof Date) return value.getTime();
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isExternalUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function filenameFromKey(key: string): string {
  const segment = key.split("/").pop() || key;
  return segment;
}

function safeFilename(value: string, fallback = "gallery-image"): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || fallback;
}

async function imageUrl(source: GallerySource, id: number, key: string): Promise<string | null> {
  if (isExternalUrl(key)) return key;
  try {
    if (isObjectStorageConfigured()) return await generatePresignedDownloadUrl(key, 3600);
    if (source === "transaction") return `/api/attachments/local/${encodeURIComponent(key)}`;
    if (source === "agent") return `/api/agent/attachments/${id}`;
    return `/api/wishlist-images/${encodeURIComponent(key)}`;
  } catch {
    return null;
  }
}

async function withUrl(item: Omit<GalleryImage, "downloadUrl"> & { r2Key: string }): Promise<GalleryImage> {
  const { r2Key, ...publicItem } = item;
  return { ...publicItem, downloadUrl: await imageUrl(item.source, item.id, r2Key) };
}

function matchesSearch(item: GalleryImage, search: string | undefined): boolean {
  if (!search) return true;
  const needle = search.toLocaleLowerCase();
  return [item.filename, item.context, item.relatedLabel, item.source].some((value) => value?.toLocaleLowerCase().includes(needle));
}

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/gallery/images", {
    schema: {
      operationId: "listGalleryImages",
      tags: ["gallery"],
      querystring: galleryQuerySchema,
      response: { 200: z.array(galleryImageSchema) },
    },
  }, async (request) => {
    const query = request.query as { source?: GallerySource; search?: string; limit?: string; offset?: string };
    const ownerEmail = currentOwnerEmail(request);
    const source = query.source;
    const imageMimeTypes = IMAGE_MIME_TYPES as string[];
    const [transactionRows, agentRows, wishlistRows] = await Promise.all([
      source && source !== "transaction"
        ? Promise.resolve([])
        : db.select({
          id: attachments.id,
          transactionId: attachments.transactionId,
          filename: attachments.filename,
          mimetype: attachments.mimetype,
          fileSize: attachments.fileSize,
          r2Key: attachments.r2Key,
          createdAt: transactions.createdAt,
          context: transactions.description,
        }).from(attachments)
          .innerJoin(transactions, eq(attachments.transactionId, transactions.id))
          .where(inArray(attachments.mimetype, imageMimeTypes))
          .orderBy(desc(transactions.createdAt)),
      source && source !== "agent"
        ? Promise.resolve([])
        : db.select({
          id: agentMessageAttachments.id,
          conversationId: agentMessageAttachments.conversationId,
          filename: agentMessageAttachments.filename,
          mimetype: agentMessageAttachments.mimetype,
          fileSize: agentMessageAttachments.fileSize,
          r2Key: agentMessageAttachments.r2Key,
          createdAt: agentMessageAttachments.createdAt,
          context: agentConversations.title,
        }).from(agentMessageAttachments)
          .innerJoin(agentConversations, eq(agentMessageAttachments.conversationId, agentConversations.id))
          .where(and(eq(agentConversations.ownerEmail, ownerEmail), inArray(agentMessageAttachments.mimetype, imageMimeTypes)))
          .orderBy(desc(agentMessageAttachments.createdAt)),
      source && source !== "wishlist"
        ? Promise.resolve([])
        : db.select({
          id: wishlist.id,
          name: wishlist.name,
          imageUrl: wishlist.imageUrl,
          createdAt: wishlist.createdAt,
        }).from(wishlist)
          .where(isNotNull(wishlist.imageUrl))
          .orderBy(desc(wishlist.createdAt)),
    ]);

    const items: GalleryImage[] = [];
    for (const row of transactionRows) {
      items.push(await withUrl({
        id: row.id,
        source: "transaction",
        filename: row.filename,
        mimetype: row.mimetype,
        fileSize: row.fileSize,
        createdAt: timestamp(row.createdAt),
        context: row.context,
        relatedId: row.transactionId,
        relatedLabel: `Transaction #${row.transactionId}`,
        storageManaged: true,
        r2Key: row.r2Key,
      }));
    }
    for (const row of agentRows) {
      items.push(await withUrl({
        id: row.id,
        source: "agent",
        filename: row.filename,
        mimetype: row.mimetype,
        fileSize: row.fileSize,
        createdAt: timestamp(row.createdAt),
        context: row.context,
        relatedId: row.conversationId,
        relatedLabel: "Agent conversation",
        storageManaged: true,
        r2Key: row.r2Key,
      }));
    }
    for (const row of wishlistRows) {
      if (!row.imageUrl) continue;
      items.push(await withUrl({
        id: row.id,
        source: "wishlist",
        filename: filenameFromKey(row.imageUrl),
        mimetype: "image/jpeg",
        fileSize: 0,
        createdAt: timestamp(row.createdAt),
        context: row.name,
        relatedId: row.id,
        relatedLabel: "Wishlist",
        storageManaged: !isExternalUrl(row.imageUrl),
        r2Key: row.imageUrl,
      }));
    }

    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 60)));
    const offset = Math.max(0, Number(query.offset ?? 0));
    return items
      .filter((item) => matchesSearch(item, query.search))
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || a.source.localeCompare(b.source) || a.id - b.id)
      .slice(offset, offset + limit);
  });

  // Resolve a gallery record into the same data URL shape accepted by the
  // Agent image input. The lookup is always performed server-side so the
  // browser cannot select another user's conversation attachment or submit a
  // raw R2 key. External wishlist URLs intentionally remain preview-only:
  // fetching arbitrary remote URLs here would turn this endpoint into an SSRF
  // primitive and they are not images stored in the managed gallery.
  fastify.post("/api/gallery/images/:source/:id/attach", {
    schema: {
      operationId: "attachGalleryImageToAgent",
      tags: ["gallery"],
      params: galleryParamsSchema,
      response: {
        200: galleryAttachResponseSchema,
        400: galleryErrorSchema,
        404: galleryErrorSchema,
        413: galleryErrorSchema,
        500: galleryErrorSchema,
      },
    },
  }, async (request, reply) => {
    const { source, id } = request.params as { source: GallerySource; id: number };
    const ownerEmail = currentOwnerEmail(request);

    try {
      let filename: string | null = null;
      let mimeType: string | null = null;
      let fileSize: number | null = null;
      let r2Key: string | null = null;

      if (source === "transaction") {
        const row = db.select({ filename: attachments.filename, mimetype: attachments.mimetype, fileSize: attachments.fileSize, r2Key: attachments.r2Key })
          .from(attachments)
          .where(eq(attachments.id, id))
          .limit(1).all()[0];
        if (row) ({ filename, mimeType, fileSize, r2Key } = { filename: row.filename, mimeType: row.mimetype, fileSize: row.fileSize, r2Key: row.r2Key });
      } else if (source === "agent") {
        const row = db.select({ filename: agentMessageAttachments.filename, mimetype: agentMessageAttachments.mimetype, fileSize: agentMessageAttachments.fileSize, r2Key: agentMessageAttachments.r2Key })
          .from(agentMessageAttachments)
          .innerJoin(agentConversations, eq(agentMessageAttachments.conversationId, agentConversations.id))
          .where(and(eq(agentMessageAttachments.id, id), eq(agentConversations.ownerEmail, ownerEmail)))
          .limit(1).all()[0];
        if (row) ({ filename, mimeType, fileSize, r2Key } = { filename: row.filename, mimeType: row.mimetype, fileSize: row.fileSize, r2Key: row.r2Key });
      } else {
        const row = db.select({ imageUrl: wishlist.imageUrl })
          .from(wishlist)
          .where(eq(wishlist.id, id))
          .limit(1).all()[0];
        if (row?.imageUrl && !isExternalUrl(row.imageUrl)) {
          filename = filenameFromKey(row.imageUrl);
          mimeType = "image/jpeg";
          r2Key = row.imageUrl;
        }
      }

      if (!r2Key || !filename || !mimeType) return reply.code(404).send({ error: "Image not found" });
      mimeType = mimeType.toLowerCase();
      if (!AGENT_IMAGE_MIME_TYPES.has(mimeType)) {
        return reply.code(400).send({ error: "Only JPEG, PNG, WebP, and GIF images can be attached to Agent" });
      }
      if (fileSize != null && (fileSize <= 0 || fileSize > MAX_AGENT_IMAGE_BYTES)) {
        return reply.code(413).send({ error: `Each image must be smaller than ${MAX_AGENT_IMAGE_BYTES / (1024 * 1024)}MB` });
      }

      const buffer = await downloadFile(r2Key);
      if (buffer.length === 0 || buffer.length > MAX_AGENT_IMAGE_BYTES) {
        return reply.code(413).send({ error: `Each image must be smaller than ${MAX_AGENT_IMAGE_BYTES / (1024 * 1024)}MB` });
      }
      return {
        filename: safeFilename(filename),
        mimeType,
        fileSize: buffer.length,
        data: `data:${mimeType};base64,${buffer.toString("base64")}`,
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: "Could not read the selected gallery image" });
    }
  });

  fastify.delete("/api/gallery/images/:source/:id", {
    schema: {
      operationId: "deleteGalleryImage",
      tags: ["gallery"],
      params: galleryParamsSchema,
      response: { 202: galleryCleanupPendingSchema, 204: z.null(), 404: galleryErrorSchema, 500: galleryErrorSchema },
    },
  }, async (request, reply) => {
    const { source, id } = request.params as { source: GallerySource; id: number };
    const ownerEmail = currentOwnerEmail(request);
    try {
      let outboxId: number | null = null;

      if (source === "transaction") {
        const result = db.transaction((tx) => {
          const row = tx.select().from(attachments).where(eq(attachments.id, id)).limit(1).all()[0];
          if (!row || !IMAGE_MIME_TYPES.includes(row.mimetype)) return false;
          const queued = tx.insert(storageDeletionOutbox).values({ r2Key: row.r2Key, entityType: "attachment", entityId: row.id }).returning({ id: storageDeletionOutbox.id }).all()[0];
          if (!queued) throw new Error("Failed to enqueue image cleanup");
          tx.insert(auditLogs).values({ entityType: "attachment", entityId: row.id, action: "delete", beforeSnapshot: Buffer.from(JSON.stringify(row)) }).run();
          tx.delete(attachments).where(eq(attachments.id, row.id)).run();
          outboxId = queued.id;
          return true;
        });
        if (!result) return reply.code(404).send({ error: "Image not found" });
      } else if (source === "agent") {
        const result = db.transaction((tx) => {
          const row = tx.select({ id: agentMessageAttachments.id, r2Key: agentMessageAttachments.r2Key, filename: agentMessageAttachments.filename, mimetype: agentMessageAttachments.mimetype, fileSize: agentMessageAttachments.fileSize, messageId: agentMessageAttachments.messageId, conversationId: agentMessageAttachments.conversationId })
            .from(agentMessageAttachments)
            .innerJoin(agentConversations, eq(agentMessageAttachments.conversationId, agentConversations.id))
            .where(and(eq(agentMessageAttachments.id, id), eq(agentConversations.ownerEmail, ownerEmail)))
            .limit(1).all()[0];
          if (!row || !IMAGE_MIME_TYPES.includes(row.mimetype)) return false;
          const queued = tx.insert(storageDeletionOutbox).values({ r2Key: row.r2Key, entityType: "agent_message_attachment", entityId: row.id }).returning({ id: storageDeletionOutbox.id }).all()[0];
          if (!queued) throw new Error("Failed to enqueue image cleanup");
          tx.insert(auditLogs).values({ entityType: "attachment", entityId: row.id, action: "delete", beforeSnapshot: Buffer.from(JSON.stringify(row)) }).run();
          tx.delete(agentMessageAttachments).where(eq(agentMessageAttachments.id, row.id)).run();
          outboxId = queued.id;
          return true;
        });
        if (!result) return reply.code(404).send({ error: "Image not found" });
      } else {
        const result = db.transaction((tx) => {
          const row = tx.select().from(wishlist).where(eq(wishlist.id, id)).limit(1).all()[0];
          if (!row?.imageUrl) return false;
          const updated = tx.update(wishlist).set({ imageUrl: null, updatedAt: new Date() }).where(eq(wishlist.id, row.id)).returning().all()[0];
          if (!updated) throw new Error("Failed to remove wishlist image");
          tx.insert(auditLogs).values({ entityType: "wishlist", entityId: row.id, action: "update", beforeSnapshot: Buffer.from(JSON.stringify(row)), afterSnapshot: Buffer.from(JSON.stringify(updated)) }).run();
          if (!isExternalUrl(row.imageUrl)) {
            const queued = tx.insert(storageDeletionOutbox).values({ r2Key: row.imageUrl, entityType: "wishlist_image", entityId: row.id }).returning({ id: storageDeletionOutbox.id }).all()[0];
            if (!queued) throw new Error("Failed to enqueue image cleanup");
            outboxId = queued.id;
          }
          return true;
        });
        if (!result) return reply.code(404).send({ error: "Image not found" });
      }

      if (outboxId != null) {
        const cleanup = await processStorageDeletionOutbox([outboxId]);
        if (cleanup.failed > 0) return reply.code(202).send({ success: true, cleanupPending: true, message: "Image removed; storage cleanup is queued for retry" });
      }
      return reply.code(204).send();
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: "Failed to delete image" });
    }
  });
}
