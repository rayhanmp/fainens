import type { FastifyInstance } from "fastify";

import {
  getAuditLogs,
  getEntityAuditHistory,
  type AuditLogFilters,
  type EntityType,
} from "../services/audit";

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/audit-log", async (request) => {
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

  fastify.get("/api/audit-log/:entityType/:entityId", async (request, reply) => {
    try {
      const { entityType, entityId } = request.params as {
        entityType: string;
        entityId: string;
      };

      const history = await getEntityAuditHistory(entityType as EntityType, parseInt(entityId));
      return { entityType, entityId: parseInt(entityId), history };
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message });
    }
  });
}
