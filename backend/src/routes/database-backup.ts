import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { env } from "../lib/env";
import {
  BACKUP_FREQUENCIES,
  getDatabaseBackupSettings,
  readDatabaseBackup,
  restoreDatabaseBackup,
  restoreDatabaseBuffer,
  RestoreError,
  runDatabaseBackupNow,
  updateDatabaseBackupSettings,
} from "../services/database-backup";

/** A database file sent as it is, for restoring; snapshots outgrow the JSON body limit. */
const BACKUP_FILE_TYPE = "application/vnd.sqlite3";
const MAX_BACKUP_FILE = 500 * 1024 * 1024;

const errorSchema = z.object({ error: z.string() }).passthrough();
const frequencySchema = z.enum(BACKUP_FREQUENCIES);
const backupSchema = z.object({ key: z.string(), size: z.number().int().nonnegative(), createdAt: z.number().int().nonnegative() }).passthrough();
const responseSchema = z.object({
  enabled: z.boolean(),
  frequency: frequencySchema,
  lastBackupAt: z.number().int().nonnegative().nullable(),
  nextBackupAt: z.number().int().nonnegative().nullable(),
  backups: z.array(backupSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    hasNext: z.boolean(),
  }),
});
const updateSchema = z.object({ enabled: z.boolean().optional(), frequency: frequencySchema.optional() }).passthrough();
const querySchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(10) }).passthrough();
const runResponseSchema = z.object({ backup: z.object({ key: z.string(), size: z.number().int().nonnegative(), createdAt: z.string() }).passthrough(), settings: responseSchema });
const keyQuerySchema = z.object({ key: z.string().min(1).max(200) });
const restoreBodySchema = z.object({ key: z.string().min(1).max(200) });
const restoreResponseSchema = z.object({ restoredAt: z.string(), undoBackupKey: z.string().nullable() });

/** A restore's own refusals are told as they are; anything else stays generic. */
const restoreFailure = (error: unknown) => (error instanceof RestoreError ? error.message : `Could not restore the backup${error instanceof Error ? `: ${error.message}` : ""}`);

function ownerEmail(request: FastifyRequest): string {
  const email = (request.user as { email?: unknown } | undefined)?.email;
  if (typeof email !== "string" || !email.includes("@")) throw new Error("Authenticated user email is unavailable");
  return env.LOCAL_AUTH_BYPASS ? env.ALLOWED_EMAIL.toLowerCase() : email.trim().toLowerCase();
}

export default async function databaseBackupRoutes(fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/settings/database-backup", {
    schema: { operationId: "getDatabaseBackupSettings", tags: ["settings"], querystring: querySchema, response: { 200: responseSchema, 401: errorSchema } },
  }, async (request, reply) => {
    try {
      const query = querySchema.parse(request.query);
      return reply.send(responseSchema.parse(await getDatabaseBackupSettings(ownerEmail(request), query.page, query.pageSize)));
    }
    catch (error) { return reply.code(401).send({ error: error instanceof Error ? error.message : "Could not load database backup settings" }); }
  });

  fastify.put("/api/settings/database-backup", {
    schema: { operationId: "updateDatabaseBackupSettings", tags: ["settings"], body: updateSchema, response: { 200: responseSchema, 400: errorSchema, 401: errorSchema } },
  }, async (request, reply) => {
    try {
      return reply.send(responseSchema.parse(await updateDatabaseBackupSettings(ownerEmail(request), updateSchema.parse(request.body))));
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not update database backup settings" }); }
  });

  fastify.post("/api/settings/database-backup/run", {
    schema: { operationId: "runDatabaseBackup", tags: ["settings"], response: { 200: runResponseSchema, 400: errorSchema, 401: errorSchema } },
  }, async (request, reply) => {
    try {
      const backup = await runDatabaseBackupNow(ownerEmail(request));
      const settings = await getDatabaseBackupSettings(ownerEmail(request));
      return reply.send(runResponseSchema.parse({ backup, settings }));
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not create database backup" }); }
  });

  // One of the backups in storage, to keep a copy of it.
  fastify.get("/api/settings/database-backup/file", {
    schema: { operationId: "downloadDatabaseBackup", tags: ["settings"], querystring: keyQuerySchema, response: { 400: errorSchema, 401: errorSchema } },
  }, async (request, reply) => {
    try {
      ownerEmail(request);
      const { key } = keyQuerySchema.parse(request.query);
      const data = await readDatabaseBackup(key);
      return reply
        .header("Content-Type", BACKUP_FILE_TYPE)
        .header("Content-Disposition", `attachment; filename="${key.split("/").pop()}"`)
        .send(data);
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not download the backup" }); }
  });

  fastify.post("/api/settings/database-backup/restore", {
    schema: { operationId: "restoreDatabaseBackup", tags: ["settings"], body: restoreBodySchema, response: { 200: restoreResponseSchema, 400: errorSchema, 401: errorSchema } },
  }, async (request, reply) => {
    try {
      ownerEmail(request);
      const { key } = restoreBodySchema.parse(request.body);
      return reply.send(await restoreDatabaseBackup(key));
    } catch (error) { return reply.code(400).send({ error: restoreFailure(error) }); }
  });

  // A backup file from this computer, sent as it is.
  fastify.addContentTypeParser(BACKUP_FILE_TYPE, { parseAs: "buffer", bodyLimit: MAX_BACKUP_FILE }, (_request, body, done) => done(null, body));
  fastify.post("/api/settings/database-backup/restore-file", {
    bodyLimit: MAX_BACKUP_FILE,
    schema: { operationId: "restoreDatabaseBackupFile", tags: ["settings"], response: { 200: restoreResponseSchema, 400: errorSchema, 401: errorSchema } },
  }, async (request, reply) => {
    try {
      ownerEmail(request);
      if (!Buffer.isBuffer(request.body) || request.body.length === 0) throw new RestoreError("Choose a backup file to restore");
      return reply.send(await restoreDatabaseBuffer(request.body));
    } catch (error) { return reply.code(400).send({ error: restoreFailure(error) }); }
  });
}
