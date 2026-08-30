import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { cancelBackgroundTask, getBackgroundTask, listBackgroundTasks, retryBackgroundTask, type BackgroundTask, type BackgroundTaskStatus } from "../services/background-tasks";

const taskParams = z.object({ id: z.string().uuid() });
const taskStatus = z.enum(["queued", "running", "retrying", "completed", "failed", "cancelled"]);
const taskQueue = z.enum(["fainens-maintenance", "fainens-recurring", "fainens-agent"]);
const taskJob = z.enum(["dispatch-background-tasks", "cache-invalidation-outbox", "storage-deletion-outbox", "precompute-warmup", "subscription-renewals", "salary-posting", "conversation-title", "budget-outlier-review"]);
const taskQuery = z.object({ status: taskStatus.optional(), queue: taskQueue.optional(), limit: z.coerce.number().int().min(1).max(100).optional() });
const taskSchema = z.object({
  id: z.string().uuid(), queueName: taskQueue, jobName: taskJob, dedupeKey: z.string(),
  ownerEmail: z.string().nullable(), subjectType: z.string().nullable(), subjectId: z.string().nullable(),
  status: taskStatus, attempts: z.number().int(), maxAttempts: z.number().int(),
  availableAt: z.number(), startedAt: z.number().nullable(), completedAt: z.number().nullable(),
  lastError: z.string().nullable(), resultJson: z.string().nullable(), createdAt: z.number(), updatedAt: z.number(),
});
const errorSchema = z.object({ error: z.string() });

function taskView(task: BackgroundTask) {
  const ms = (value: Date | number | null): number | null => value == null ? null : value instanceof Date ? value.getTime() : Number(value);
  return {
    // Keep the task API metadata-only. In particular, never return payloadJson
    // because task payloads may later contain provider-facing context.
    id: task.id,
    queueName: task.queueName,
    jobName: task.jobName,
    dedupeKey: task.dedupeKey,
    ownerEmail: task.ownerEmail,
    subjectType: task.subjectType,
    subjectId: task.subjectId,
    status: task.status,
    attempts: task.attempts,
    maxAttempts: task.maxAttempts,
    resultJson: task.resultJson,
    lastError: task.lastError,
    availableAt: ms(task.availableAt) ?? 0,
    startedAt: ms(task.startedAt),
    completedAt: ms(task.completedAt),
    createdAt: ms(task.createdAt) ?? 0,
    updatedAt: ms(task.updatedAt) ?? 0,
  };
}

export default async function jobsRoutes(fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/internal/jobs", {
    schema: { operationId: "listBackgroundTasks", tags: ["system"], querystring: taskQuery, response: { 200: z.object({ tasks: z.array(taskSchema) }) } },
  }, async (request) => {
    const query = request.query as { status?: BackgroundTaskStatus; queue?: string; limit?: number };
    const ownerEmail = (request.user as { email?: string } | undefined)?.email ?? null;
    const tasks = await listBackgroundTasks({ status: query.status, queueName: query.queue, ownerEmail, limit: query.limit });
    return { tasks: tasks.map(taskView) };
  });

  fastify.get("/api/internal/jobs/:id", {
    schema: { operationId: "getBackgroundTask", tags: ["system"], params: taskParams, response: { 200: taskSchema, 404: errorSchema } },
  }, async (request, reply) => {
    const ownerEmail = (request.user as { email?: string } | undefined)?.email ?? null;
    const task = await getBackgroundTask((request.params as { id: string }).id, ownerEmail);
    return task ? reply.send(taskView(task)) : reply.code(404).send({ error: "Background task not found" });
  });

  fastify.post("/api/internal/jobs/:id/retry", {
    schema: { operationId: "retryBackgroundTask", tags: ["system"], params: taskParams, response: { 200: taskSchema, 404: errorSchema, 409: errorSchema } },
  }, async (request, reply) => {
    const ownerEmail = (request.user as { email?: string } | undefined)?.email ?? null;
    const task = await retryBackgroundTask((request.params as { id: string }).id, ownerEmail);
    if (task) return reply.send(taskView(task));
    const existing = await getBackgroundTask((request.params as { id: string }).id, ownerEmail);
    return existing ? reply.code(409).send({ error: "Only failed or cancelled tasks can be retried" }) : reply.code(404).send({ error: "Background task not found" });
  });

  fastify.post("/api/internal/jobs/:id/cancel", {
    schema: { operationId: "cancelBackgroundTask", tags: ["system"], params: taskParams, response: { 200: taskSchema, 404: errorSchema, 409: errorSchema } },
  }, async (request, reply) => {
    const ownerEmail = (request.user as { email?: string } | undefined)?.email ?? null;
    const taskId = (request.params as { id: string }).id;
    const cancelled = await cancelBackgroundTask(taskId, ownerEmail);
    const task = await getBackgroundTask(taskId, ownerEmail);
    if (cancelled && task) return reply.send(taskView(task));
    return task ? reply.code(409).send({ error: "Only queued or retrying tasks can be cancelled" }) : reply.code(404).send({ error: "Background task not found" });
  });
}
