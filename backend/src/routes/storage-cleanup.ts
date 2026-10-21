import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { getStorageCleanupStatus, retryStuckStorageDeletions } from "../services/storage-cleanup";

const statusSchema = z.object({ stuck: z.number().int().nonnegative(), lastError: z.string().nullable() });
const retrySchema = statusSchema.extend({ processed: z.number().int().nonnegative(), failed: z.number().int().nonnegative() });

/** Deleted attachments and pictures that storage still holds after every retry, and a way to try again. */
export default async function storageCleanupRoutes(fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/settings/storage-cleanup", {
    schema: { operationId: "getStorageCleanupStatus", tags: ["settings"], response: { 200: statusSchema } },
  }, async () => statusSchema.parse(await getStorageCleanupStatus()));

  fastify.post("/api/settings/storage-cleanup/retry", {
    schema: { operationId: "retryStorageCleanup", tags: ["settings"], response: { 200: retrySchema } },
  }, async () => retrySchema.parse(await retryStuckStorageDeletions()));
}
