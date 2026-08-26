import type { FastifyInstance } from "fastify";

import { listMoneyAnomalyReviews, reviewMoneyAnomaly, scanMoneyAnomalies } from "../services/money-anomaly-review";

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/anomalies/money", async (request, reply) => {
    const { status } = request.query as { status?: string };
    if (status !== undefined && !["open", "resolved", "dismissed"].includes(status)) {
      return reply.code(400).send({ error: "status must be open, resolved, or dismissed" });
    }
    return { reviews: await listMoneyAnomalyReviews(status as "open" | "resolved" | "dismissed" | undefined) };
  });

  fastify.post("/api/anomalies/money/scan", async () => scanMoneyAnomalies());

  fastify.post("/api/anomalies/money/:id/review", async (request, reply) => {
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
