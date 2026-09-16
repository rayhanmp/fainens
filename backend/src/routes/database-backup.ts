import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { env } from "../lib/env";
import {
  BACKUP_FREQUENCIES,
  getDatabaseBackupSettings,
  runDatabaseBackupNow,
  updateDatabaseBackupSettings,
} from "../services/database-backup";

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
}
