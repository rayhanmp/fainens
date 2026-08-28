import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { listMoneyAnomalyReviews, reviewMoneyAnomaly, scanMoneyAnomalies } from "../services/money-anomaly-review";

const anomalyErrorSchema = z.object({ error: z.string() }).passthrough();
const anomalyIdParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const anomalyStatusSchema = z.enum(["open", "resolved", "dismissed"]);
const anomalyReviewStatusSchema = z.enum(["resolved", "dismissed"]);
const anomalyTransactionSchema = z.object({ id: z.number().int(), date: z.union([z.date(), z.string(), z.number()]), description: z.string(), txType: z.string(), status: z.string() }).passthrough();
const anomalyReviewSchema = z.object({ id: z.number().int(), fingerprint: z.string(), kind: z.enum(["possible_100x_pair", "legacy_reconciliation_plug"]), transactionId: z.number().int(), relatedTransactionId: z.number().int().nullable(), detectedAmount: z.number().int(), reason: z.string(), status: anomalyStatusSchema, reviewedAt: z.union([z.date(), z.string(), z.number()]).nullable(), reviewNote: z.string().nullable(), createdAt: z.union([z.date(), z.string(), z.number()]), transaction: anomalyTransactionSchema.nullable().optional(), relatedTransaction: anomalyTransactionSchema.nullable().optional() }).passthrough();
const anomalyReviewQuerySchema = z.object({ status: anomalyStatusSchema.optional() });
const anomalyReviewBodySchema = z.object({ status: anomalyReviewStatusSchema, reviewNote: z.string().trim().min(1).max(1000) }).passthrough();

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/anomalies/money", {
    schema: { operationId: "listMoneyAnomalyReviews", tags: ["anomalies"], querystring: anomalyReviewQuerySchema, response: { 200: z.object({ reviews: z.array(anomalyReviewSchema) }).passthrough(), 400: anomalyErrorSchema } },
  }, async (request, reply) => {
    const { status } = request.query as { status?: string };
    if (status !== undefined && !["open", "resolved", "dismissed"].includes(status)) {
      return reply.code(400).send({ error: "status must be open, resolved, or dismissed" });
    }
    return { reviews: await listMoneyAnomalyReviews(status as "open" | "resolved" | "dismissed" | undefined) };
  });

  fastify.post("/api/anomalies/money/scan", {
    schema: { operationId: "scanMoneyAnomalies", tags: ["anomalies"], response: { 200: z.object({ created: z.number().int().nonnegative(), candidates: z.number().int().nonnegative() }).passthrough() } },
  }, async () => scanMoneyAnomalies());

  fastify.post("/api/anomalies/money/:id/review", {
    schema: { operationId: "reviewMoneyAnomaly", tags: ["anomalies"], params: anomalyIdParamsSchema, body: anomalyReviewBodySchema, response: { 200: anomalyReviewSchema, 400: anomalyErrorSchema, 404: anomalyErrorSchema, 409: anomalyErrorSchema } },
  }, async (request, reply) => {
    const id = Number((request.params as { id?: string }).id);
    const body = request.body as { status?: string; reviewNote?: string };
    if (!Number.isSafeInteger(id) || id <= 0) return reply.code(400).send({ error: "Invalid review ID" });
    if (body.status !== "resolved" && body.status !== "dismissed") {
      return reply.code(400).send({ error: "status must be resolved or dismissed" });
    }
    try {
      return await reviewMoneyAnomaly(id, body.status, body.reviewNote ?? "");
    } catch (error) {
      return reply.code((error as Error).message.includes("not found") ? 404 : 409).send({ error: (error as Error).message });
    }
  });
}
