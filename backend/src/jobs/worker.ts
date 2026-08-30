import { Worker, type Job } from "bullmq";

import { db } from "../db/client";
import { bootstrapDb } from "../db/migrate";
import { closeRedisConnection, getRedisClient } from "../cache/redis";
import { precomputeEverything } from "../cache/precompute";
import { processCacheInvalidationOutbox } from "../services/cache-invalidation-outbox";
import { processStorageDeletionOutbox } from "../services/storage-cleanup";
import { processDueSubscriptionRenewals } from "../services/subscription-renewals";
import { postSalaryIfPayrollDay } from "../services/salary-posting";
import { cancelBackgroundTask, claimBackgroundTask, completeBackgroundTask, dispatchDueBackgroundTasks, failBackgroundTask } from "../services/background-tasks";
import { configureJobSchedulers } from "./schedulers";
import { agentQueue, maintenanceQueue, recurringQueue, type AgentJobName, type MaintenanceJobName, type RecurringJobName } from "./queue";
import { processAgentTask } from "./agent-task-processor";
import { env } from "../lib/env";
import { parseTaskJobData } from "./contracts";

const connection = { url: env.REDIS_URL, maxRetriesPerRequest: null } as const;
let closing = false;

async function processMaintenance(job: Job<undefined, void, MaintenanceJobName>): Promise<void> {
  switch (job.name) {
    case "dispatch-background-tasks":
      await dispatchDueBackgroundTasks();
      return;
    case "cache-invalidation-outbox":
      await processCacheInvalidationOutbox();
      return;
    case "storage-deletion-outbox":
      await processStorageDeletionOutbox();
      return;
    case "precompute-warmup":
      await precomputeEverything();
      return;
  }
}

async function processRecurring(job: Job<undefined, void, RecurringJobName>): Promise<void> {
  switch (job.name) {
    case "subscription-renewals":
      await processDueSubscriptionRenewals(db);
      return;
    case "salary-posting":
      await postSalaryIfPayrollDay(db);
      return;
  }
}

async function processAgent(job: Job<{ taskId: string }, void, AgentJobName>): Promise<void> {
  const { taskId } = parseTaskJobData(job.data);
  const task = await claimBackgroundTask(taskId);
  if (!task) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.WORKER_AGENT_TIMEOUT_MS);
  try {
    const result = await processAgentTask(task, controller.signal);
    if (isStaleReviewResult(result)) {
      // A financial mutation superseded this revision while the provider was
      // working. Mark the receipt cancelled so the dashboard cannot present a
      // successful-looking review for obsolete facts.
      await cancelBackgroundTask(task.id, null, { allowRunning: true });
    } else {
      await completeBackgroundTask(task.id, result);
    }
  } catch (error) {
    // BullMQ provides delivery retry; the SQLite receipt makes the retry
    // visible and also lets the dispatcher recover a job lost before delivery.
    const message = error instanceof Error ? error.message : String(error);
    const retryable = !/(\b401\b|\b403\b|invalid|not found|missing taskid|unsupported)/i.test(message);
    await failBackgroundTask(task.id, error, retryable);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isStaleReviewResult(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && "reason" in value && (value as { reason?: unknown }).reason === "stale_revision");
}

async function main(): Promise<void> {
  await bootstrapDb();
  getRedisClient();
  await configureJobSchedulers();

  // Kick the first pass immediately after boot. The scheduler then keeps the
  // queues warm without any API-process setInterval timers.
  await Promise.all([
    maintenanceQueue.add("dispatch-background-tasks", undefined, { jobId: "maintenance:dispatch-background-tasks" }),
    maintenanceQueue.add("cache-invalidation-outbox", undefined, { jobId: "maintenance:cache-invalidation-outbox" }),
    maintenanceQueue.add("storage-deletion-outbox", undefined, { jobId: "maintenance:storage-deletion-outbox" }),
    recurringQueue.add("subscription-renewals", undefined, { jobId: "recurring:subscription-renewals" }),
    recurringQueue.add("salary-posting", undefined, { jobId: "recurring:salary-posting" }),
  ]);

  const workers = [
    new Worker(maintenanceQueue.name, processMaintenance, { connection, concurrency: env.WORKER_MAINTENANCE_CONCURRENCY }),
    new Worker(recurringQueue.name, processRecurring, { connection, concurrency: env.WORKER_RECURRING_CONCURRENCY }),
    new Worker(agentQueue.name, processAgent, { connection, concurrency: env.WORKER_AGENT_CONCURRENCY }),
  ];
  for (const worker of workers) {
    worker.on("completed", (job) => console.info(`[worker] ${worker.name} ${job.name} completed`));
    worker.on("failed", (job, error) => console.error(`[worker] ${worker.name} ${job?.name ?? "unknown"} failed`, error));
    worker.on("error", (error) => console.error(`[worker] ${worker.name} connection error`, error));
  }

  const heartbeatKey = `fainens:worker:heartbeat:${process.pid}`;
  const heartbeat = setInterval(() => {
    void getRedisClient().set(heartbeatKey, JSON.stringify({ pid: process.pid, at: Date.now() }), "EX", 45).catch((error) => {
      console.warn("[worker] heartbeat failed", error instanceof Error ? error.message : error);
    });
  }, 15_000);
  await getRedisClient().set(heartbeatKey, JSON.stringify({ pid: process.pid, at: Date.now() }), "EX", 45);

  const stop = async () => {
    if (closing) return;
    closing = true;
    clearInterval(heartbeat);
    await Promise.all(workers.map((worker) => worker.close()));
    await getRedisClient().del(heartbeatKey).catch(() => undefined);
    await closeRedisConnection();
  };
  process.once("SIGTERM", () => void stop().finally(() => process.exit(0)));
  process.once("SIGINT", () => void stop().finally(() => process.exit(0)));
  console.info(`[worker] ready: ${workers.map((worker) => worker.name).join(", ")}`);
}

void main().catch((error) => {
  console.error("[worker] failed to start", error);
  process.exitCode = 1;
});
