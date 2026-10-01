import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getPeriodRecap, listRecapPeriods, RecapPeriodError } from "../services/recap";
import { recapPeriodIdSchema as periodIdSchema, recapPeriodSchema, recapSchema, savedRecapStorySchema } from "../services/recap-schemas";
import { ensureRecapStory, getSavedRecapStory, RecapGenerationError } from "../services/recap-story";
import { getRecapHighlightSeenAt, markRecapHighlightSeen } from "../services/recap-highlight";

const errorSchema = z.object({ error: z.string() });
const storyParams = z.object({ periodId: periodIdSchema });
const storyBody = z.object({ regenerate: z.boolean().default(false) });

export default async function recapRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);
  app.get("/api/recaps/:periodId/highlight-state", {
    schema: { operationId: "getRecapHighlightState", tags: ["reports"], params: storyParams,
      response: { 200: z.object({ seenAt: z.number().nullable() }), 400: errorSchema, 404: errorSchema, 500: errorSchema } },
  }, async (request, reply) => {
    const { periodId } = storyParams.parse(request.params);
    try { return { seenAt: getRecapHighlightSeenAt(request.user.email, periodId) }; }
    catch (error) { if (error instanceof RecapPeriodError) return reply.code(error.status).send({ error: error.message }); app.log.error(error); return reply.code(500).send({ error: "Unable to load this recap's visibility" }); }
  });
  app.post("/api/recaps/:periodId/highlight-seen", {
    schema: { operationId: "markRecapHighlightSeen", tags: ["reports"], params: storyParams,
      response: { 200: z.object({ seenAt: z.number() }), 400: errorSchema, 404: errorSchema, 500: errorSchema } },
  }, async (request, reply) => {
    const { periodId } = storyParams.parse(request.params);
    try { return { seenAt: markRecapHighlightSeen(request.user.email, periodId) }; }
    catch (error) { if (error instanceof RecapPeriodError) return reply.code(error.status).send({ error: error.message }); app.log.error(error); return reply.code(500).send({ error: "Unable to mark this recap as seen" }); }
  });
  app.get("/api/recaps/:periodId/story", {
    schema: { operationId: "getSavedRecapStory", tags: ["reports"], params: storyParams,
      response: { 200: z.object({ story: savedRecapStorySchema.nullable() }), 400: errorSchema, 404: errorSchema, 500: errorSchema } },
  }, async (request, reply) => {
    const { periodId } = storyParams.parse(request.params);
    try { return { story: getSavedRecapStory(request.user.email, periodId) }; }
    catch (error) { if (error instanceof RecapPeriodError) return reply.code(error.status).send({ error: error.message }); app.log.error(error); return reply.code(500).send({ error: "Unable to load your saved recap" }); }
  });
  app.post("/api/recaps/:periodId/story", {
    config: { rateLimit: { max: 5, timeWindow: "1 minute", groupId: "recap-writing" } },
    schema: { operationId: "writeRecapStory", tags: ["reports"], params: storyParams, body: storyBody,
      response: { 200: savedRecapStorySchema, 400: errorSchema, 404: errorSchema, 502: errorSchema, 500: errorSchema } },
  }, async (request, reply) => {
    const { periodId } = storyParams.parse(request.params);
    const { regenerate } = storyBody.parse(request.body);
    try { return await ensureRecapStory(request.user.email, periodId, regenerate); }
    catch (error) {
      if (error instanceof RecapPeriodError) return reply.code(error.status).send({ error: error.message });
      if (error instanceof RecapGenerationError) return reply.code(502).send({ error: error.message });
      app.log.error(error); return reply.code(500).send({ error: "Unable to prepare your recap" });
    }
  });
  app.get("/api/recaps", {
    schema: { operationId: "listRecapPeriods", tags: ["reports"], response: {
      200: z.array(recapPeriodSchema.extend({ isPartial: z.boolean() })), 500: errorSchema,
    } },
  }, async (_request, reply) => {
    try { return await listRecapPeriods(); }
    catch (error) { app.log.error(error); return reply.code(500).send({ error: "Unable to load recap archive" }); }
  });
  app.get("/api/recaps/:periodId", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute", groupId: "reports" } },
    schema: { operationId: "getPeriodRecap", tags: ["reports"], params: z.object({ periodId: periodIdSchema }), response: { 200: recapSchema, 400: errorSchema, 404: errorSchema, 500: errorSchema } },
  }, async (request, reply) => {
    const { periodId } = z.object({ periodId: periodIdSchema }).parse(request.params);
    try { return await getPeriodRecap(periodId); }
    catch (error) { if (error instanceof RecapPeriodError) return reply.code(error.status).send({ error: error.message }); app.log.error(error); return reply.code(500).send({ error: "Unable to load period recap" }); }
  });
}
