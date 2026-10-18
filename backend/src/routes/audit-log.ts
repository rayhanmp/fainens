import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  getAuditLogs,
  getEntityAuditHistory,
  type AuditLogFilters,
  type EntityType,
} from "../services/audit";

const auditLogErrorSchema = z.object({ error: z.string() }).passthrough();
// Every workflow writes its own entity types and actions (loan, reimbursement_claim, close, set_coverage,
// approve, ...). A fixed list made the whole log fail response validation as soon as one appeared.
const auditEntityTypeSchema = z.string().trim().min(1).max(60);
const auditActionSchema = z.string().trim().min(1).max(60);
const auditLogEntrySchema = z.object({ id: z.number().int(), entityType: auditEntityTypeSchema, entityId: z.number().int(), action: auditActionSchema, beforeSnapshot: z.record(z.string(), z.unknown()).nullable(), afterSnapshot: z.record(z.string(), z.unknown()).nullable(), createdAt: z.number() }).passthrough();
const auditLogQuerySchema = z.object({ entityType: auditEntityTypeSchema.optional(), entityId: z.string().regex(/^\d+$/).optional(), action: auditActionSchema.optional(), search: z.string().max(120).optional(), page: z.string().regex(/^\d+$/).optional(), pageSize: z.string().regex(/^\d+$/).optional(), startDate: z.string().regex(/^\d+$/).optional(), endDate: z.string().regex(/^\d+$/).optional() });
const auditEntityParamsSchema = z.object({ entityType: auditEntityTypeSchema, entityId: z.coerce.number().int().positive() });
const auditLogListResponseSchema = z.object({ entries: z.array(auditLogEntrySchema), total: z.number().int().nonnegative(), page: z.number().int().positive(), pageSize: z.number().int().positive() }).passthrough();

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/audit-log", {
    schema: { operationId: "listAuditLogs", tags: ["audit"], querystring: auditLogQuerySchema, response: { 200: auditLogListResponseSchema } },
  }, async (request) => {
    const query = request.query as {
      entityType?: string;
      entityId?: string;
      action?: string;
      search?: string;
      page?: string;
      pageSize?: string;
    };

    const filters: AuditLogFilters = {};
    if (query.entityType) filters.entityType = query.entityType as EntityType;
    if (query.entityId) filters.entityId = parseInt(query.entityId);
    if (query.action) filters.action = query.action as AuditLogFilters["action"];
    if (query.search?.trim()) filters.search = query.search.trim();

    const page = parseInt(query.page || "1");
    const pageSize = parseInt(query.pageSize || "50");

    return await getAuditLogs(filters, page, pageSize);
  });

  fastify.get("/api/audit-log/:entityType/:entityId", {
    schema: { operationId: "getEntityAuditHistory", tags: ["audit"], params: auditEntityParamsSchema, response: { 200: z.object({ entityType: auditEntityTypeSchema, entityId: z.number().int().positive(), history: z.array(auditLogEntrySchema) }).passthrough(), 400: auditLogErrorSchema } },
  }, async (request, reply) => {
    try {
      const { entityType, entityId } = request.params as {
        entityType: string;
        entityId: string;
      };

      const history = await getEntityAuditHistory(entityType as EntityType, parseInt(entityId));
      return { entityType, entityId: parseInt(entityId), history };
    } catch (err) {
      reply.code(400).send({ error: "Failed to get audit history" });
    }
  });
}
