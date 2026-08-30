import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, lte, lt, sql } from "drizzle-orm";

import { db } from "../db/client";
import { backgroundTasks } from "../db/schema";
import { enqueueTask, type AgentJobName, type QueueName } from "../jobs/queue";
import { env } from "../lib/env";

export type BackgroundTaskStatus = "queued" | "running" | "retrying" | "completed" | "failed" | "cancelled";

export type BackgroundTask = typeof backgroundTasks.$inferSelect;

const MAX_PAYLOAD_BYTES = 32_000;
const STALE_RUNNING_MS = 15 * 60 * 1000;

function boundedJson(value: unknown): string {
  const encoded = JSON.stringify(value ?? {});
  if (encoded.length > MAX_PAYLOAD_BYTES) throw new Error("Background task payload is too large");
  return encoded;
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

/** Create a durable task receipt before attempting Redis enqueue. A unique
 * queue/dedupe key makes retries and duplicate HTTP requests return the same
 * task instead of creating parallel provider calls. */
export async function createBackgroundTask(input: {
  queueName: QueueName;
  jobName: AgentJobName;
  dedupeKey: string;
  ownerEmail?: string | null;
  subjectType?: string | null;
  subjectId?: string | number | null;
  payload?: unknown;
  maxAttempts?: number;
}): Promise<BackgroundTask> {
  const now = new Date();
  const maxAttempts = Math.max(1, Math.min(input.maxAttempts ?? 3, 10));
  const payloadJson = boundedJson(input.payload);
  const [created] = await db.insert(backgroundTasks).values({
    id: randomUUID(),
    queueName: input.queueName,
    jobName: input.jobName,
    dedupeKey: input.dedupeKey,
    ownerEmail: input.ownerEmail ?? null,
    subjectType: input.subjectType ?? null,
    subjectId: input.subjectId == null ? null : String(input.subjectId),
    payloadJson,
    status: "queued",
    attempts: 0,
    maxAttempts,
    availableAt: now,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing({ target: [backgroundTasks.queueName, backgroundTasks.dedupeKey] }).returning();

  const task = created ?? (await db.select().from(backgroundTasks).where(and(
    eq(backgroundTasks.queueName, input.queueName),
    eq(backgroundTasks.dedupeKey, input.dedupeKey),
  )).limit(1))[0];
  if (!task) throw new Error("Could not create background task");

  // Enqueue is best-effort. The maintenance dispatcher will find this row if
  // Redis is down or the process exits after the database commit.
  if (task.status === "queued" || task.status === "retrying") {
    try {
      await enqueueTask({ id: task.id, queueName: task.queueName as QueueName, jobName: task.jobName as AgentJobName, maxAttempts: task.maxAttempts });
    } catch (error) {
      console.warn("[jobs] task enqueue deferred", task.id, errorText(error));
    }
  }
  return task;
}

/** Claim is conditional and atomic. A duplicate BullMQ delivery, or a second
 * worker, observes zero changed rows and exits without calling the provider. */
export async function claimBackgroundTask(taskId: string): Promise<BackgroundTask | null> {
  const now = new Date();
  const changed = db.update(backgroundTasks).set({
    status: "running",
    attempts: sql`${backgroundTasks.attempts} + 1`,
    startedAt: now,
    updatedAt: now,
    lastError: null,
  }).where(and(
    eq(backgroundTasks.id, taskId),
    inArray(backgroundTasks.status, ["queued", "retrying"]),
    lte(backgroundTasks.availableAt, now),
  )).run();
  if (changed.changes !== 1) return null;
  return (await db.select().from(backgroundTasks).where(eq(backgroundTasks.id, taskId)).limit(1))[0] ?? null;
}

export async function completeBackgroundTask(taskId: string, result?: unknown): Promise<void> {
  const now = new Date();
  db.update(backgroundTasks).set({
    status: "completed",
    resultJson: result == null ? null : boundedJson(result),
    completedAt: now,
    updatedAt: now,
    lastError: null,
  }).where(eq(backgroundTasks.id, taskId)).run();
}

export async function failBackgroundTask(taskId: string, error: unknown, retryable = true): Promise<void> {
  const task = (await db.select({ attempts: backgroundTasks.attempts, maxAttempts: backgroundTasks.maxAttempts })
    .from(backgroundTasks).where(eq(backgroundTasks.id, taskId)).limit(1))[0];
  if (!task) return;
  const shouldRetry = retryable && task.attempts < task.maxAttempts;
  const now = new Date();
  db.update(backgroundTasks).set({
    status: shouldRetry ? "retrying" : "failed",
    availableAt: new Date(now.getTime() + (shouldRetry ? Math.min(15 * 60_000, 5_000 * 2 ** Math.max(0, task.attempts - 1)) : 0)),
    completedAt: shouldRetry ? null : now,
    lastError: errorText(error),
    updatedAt: now,
  }).where(eq(backgroundTasks.id, taskId)).run();
}

/** Repair tasks left in running by a crashed worker, then dispatch a bounded
 * batch. This is intentionally driven by SQLite state rather than queue scan
 * APIs, so Redis recovery cannot hide committed task intent. */
export async function dispatchDueBackgroundTasks(limit = 100): Promise<{ dispatched: number; deferred: number }> {
  const now = Date.now();
  db.update(backgroundTasks).set({ status: "retrying", availableAt: new Date(now), updatedAt: new Date(now), lastError: "Worker became unavailable before completion" })
    .where(and(eq(backgroundTasks.status, "running"), lt(backgroundTasks.startedAt, new Date(now - STALE_RUNNING_MS)))).run();

  const rows = await db.select().from(backgroundTasks).where(and(
    inArray(backgroundTasks.status, ["queued", "retrying"]),
    lte(backgroundTasks.availableAt, new Date(now)),
  )).orderBy(asc(backgroundTasks.createdAt)).limit(Math.min(Math.max(1, limit), 500));

  let dispatched = 0;
  let deferred = 0;
  for (const task of rows) {
    try {
      await enqueueTask({ id: task.id, queueName: task.queueName as QueueName, jobName: task.jobName as AgentJobName, maxAttempts: task.maxAttempts });
      dispatched += 1;
    } catch (error) {
      deferred += 1;
      console.warn("[jobs] task dispatch deferred", task.id, errorText(error));
    }
  }
  return { dispatched, deferred };
}

/** Compatibility runner for interval mode. Queue mode uses the standalone
 * worker, while development and older deployments can still drain task rows
 * in-process without losing the durable receipt semantics. */
export async function processDueBackgroundTasks(limit = 10): Promise<{ processed: number; failed: number }> {
  const now = Date.now();
  db.update(backgroundTasks).set({ status: "retrying", availableAt: new Date(now), updatedAt: new Date(now), lastError: "Worker became unavailable before completion" })
    .where(and(eq(backgroundTasks.status, "running"), lt(backgroundTasks.startedAt, new Date(now - STALE_RUNNING_MS)))).run();
  const rows = await db.select().from(backgroundTasks).where(and(
    inArray(backgroundTasks.status, ["queued", "retrying"]),
    lte(backgroundTasks.availableAt, new Date(now)),
  )).orderBy(asc(backgroundTasks.createdAt)).limit(Math.min(Math.max(1, limit), 100));
  const { processAgentTask } = await import("../jobs/agent-task-processor");
  let processed = 0;
  let failed = 0;
  for (const candidate of rows) {
    const task = await claimBackgroundTask(candidate.id);
    if (!task) continue;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.WORKER_AGENT_TIMEOUT_MS);
    try {
      const result = await processAgentTask(task, controller.signal);
      if (isStaleReviewResult(result)) {
        await cancelBackgroundTask(task.id, null, { allowRunning: true });
      } else {
        await completeBackgroundTask(task.id, result);
      }
      processed += 1;
    } catch (error) {
      await failBackgroundTask(task.id, error, true);
      failed += 1;
    } finally {
      clearTimeout(timeout);
    }
  }
  return { processed, failed };
}

function isStaleReviewResult(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && "reason" in value && (value as { reason?: unknown }).reason === "stale_revision");
}

export async function getBackgroundTask(taskId: string, ownerEmail?: string | null): Promise<BackgroundTask | null> {
  const rows = await db.select().from(backgroundTasks).where(and(
    eq(backgroundTasks.id, taskId),
    ownerEmail == null ? undefined : eq(backgroundTasks.ownerEmail, ownerEmail),
  )).limit(1);
  return rows[0] ?? null;
}

export async function listBackgroundTasks(filters: { status?: BackgroundTaskStatus; queueName?: string; ownerEmail?: string | null; limit?: number } = {}): Promise<BackgroundTask[]> {
  return db.select().from(backgroundTasks).where(and(
    filters.status == null ? undefined : eq(backgroundTasks.status, filters.status),
    filters.queueName == null ? undefined : eq(backgroundTasks.queueName, filters.queueName),
    filters.ownerEmail == null ? undefined : eq(backgroundTasks.ownerEmail, filters.ownerEmail),
  )).orderBy(desc(backgroundTasks.createdAt)).limit(Math.min(Math.max(filters.limit ?? 50, 1), 100));
}

export async function cancelBackgroundTask(taskId: string, ownerEmail?: string | null, options: { allowRunning?: boolean } = {}): Promise<boolean> {
  const changed = db.update(backgroundTasks).set({ status: "cancelled", completedAt: new Date(), updatedAt: new Date() }).where(and(
    eq(backgroundTasks.id, taskId),
    inArray(backgroundTasks.status, options.allowRunning ? ["queued", "running", "retrying"] : ["queued", "retrying"]),
    ownerEmail == null ? undefined : eq(backgroundTasks.ownerEmail, ownerEmail),
  )).run();
  return changed.changes === 1;
}

export async function retryBackgroundTask(taskId: string, ownerEmail?: string | null): Promise<BackgroundTask | null> {
  const task = await getBackgroundTask(taskId, ownerEmail);
  if (!task || !["failed", "cancelled"].includes(task.status)) return null;
  const changed = db.update(backgroundTasks).set({
    status: "queued",
    attempts: 0,
    availableAt: new Date(),
    startedAt: null,
    completedAt: null,
    lastError: null,
    updatedAt: new Date(),
  }).where(and(eq(backgroundTasks.id, taskId), inArray(backgroundTasks.status, ["failed", "cancelled"]))).run();
  if (changed.changes !== 1) return null;
  const updated = await getBackgroundTask(taskId, ownerEmail);
  if (!updated) return null;
  try {
    await enqueueTask({ id: updated.id, queueName: updated.queueName as QueueName, jobName: updated.jobName as AgentJobName, maxAttempts: updated.maxAttempts });
  } catch (error) {
    console.warn("[jobs] retry enqueue deferred", taskId, errorText(error));
  }
  return updated;
}
