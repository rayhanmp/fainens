import { Queue } from "bullmq";

import { env } from "../lib/env";
import { getRedisClient } from "../cache/redis";
import { taskJobDataSchema } from "./contracts";

export const QUEUE_NAMES = {
  maintenance: "fainens-maintenance",
  recurring: "fainens-recurring",
  agent: "fainens-agent",
} as const;

export type QueueName = typeof QUEUE_NAMES[keyof typeof QUEUE_NAMES];

export type MaintenanceJobName =
  | "dispatch-background-tasks"
  | "cache-invalidation-outbox"
  | "storage-deletion-outbox"
  | "precompute-warmup";
export type RecurringJobName = "subscription-renewals" | "salary-posting";
export type AgentJobName = "conversation-title" | "budget-outlier-review";
export type JobName = MaintenanceJobName | RecurringJobName | AgentJobName;

export type TaskJobData = { taskId: string };
export type EmptyJobData = undefined;

// API producers must fail quickly when Redis is unavailable. The dedicated
// worker owns blocking Redis consumers and supplies its own
// `maxRetriesPerRequest: null` connection in worker.ts.
const connection = { url: env.REDIS_URL, maxRetriesPerRequest: 3, enableOfflineQueue: false } as const;

export const maintenanceQueue = new Queue<EmptyJobData, void, MaintenanceJobName>(QUEUE_NAMES.maintenance, { connection });
export const recurringQueue = new Queue<EmptyJobData, void, RecurringJobName>(QUEUE_NAMES.recurring, { connection });
export const agentQueue = new Queue<TaskJobData, void, AgentJobName>(QUEUE_NAMES.agent, { connection });

/** The queue instances are intentionally kept in one place so API code cannot
 * accidentally enqueue a job with a different name or Redis configuration. */
export function queueFor(name: QueueName): Queue<any, any, any> {
  switch (name) {
    case QUEUE_NAMES.maintenance: return maintenanceQueue;
    case QUEUE_NAMES.recurring: return recurringQueue;
    case QUEUE_NAMES.agent: return agentQueue;
  }
  throw new Error(`Unknown queue: ${name}`);
}

const maintenanceJobOptions = {
  attempts: 4,
  backoff: { type: "exponential" as const, delay: 1_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 100 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 500 },
};

function optionsForMaintenance(name: MaintenanceJobName) {
  if (name === "cache-invalidation-outbox") return { ...maintenanceJobOptions, attempts: 8, backoff: { type: "exponential" as const, delay: 5_000 }, removeOnFail: { age: 14 * 24 * 60 * 60, count: 1_000 } };
  if (name === "storage-deletion-outbox") return { ...maintenanceJobOptions, attempts: 5, backoff: { type: "exponential" as const, delay: 30_000 }, removeOnComplete: { age: 7 * 24 * 60 * 60, count: 500 }, removeOnFail: { age: 30 * 24 * 60 * 60, count: 1_000 } };
  return maintenanceJobOptions;
}

/** Compatibility helper for maintenance jobs. Stable IDs make concurrent API
 * processes harmless; the durable outbox/task rows provide the real replay
 * guarantee when a process dies between enqueue attempts. */
export async function enqueueMaintenance(name: MaintenanceJobName) {
  return maintenanceQueue.add(name, undefined, {
    ...optionsForMaintenance(name),
    jobId: `maintenance:${name}`,
  });
}

export async function enqueueRecurring(name: RecurringJobName) {
  return recurringQueue.add(name, undefined, {
    ...maintenanceJobOptions,
    jobId: `recurring:${name}`,
  });
}

export async function enqueueTask(task: {
  id: string;
  queueName: QueueName;
  jobName: AgentJobName;
  maxAttempts: number;
}) {
  if (task.queueName !== QUEUE_NAMES.agent) {
    throw new Error(`Task queue ${task.queueName} cannot carry an agent job`);
  }
  const data = taskJobDataSchema.parse({ taskId: task.id });
  return agentQueue.add(task.jobName, data, {
    jobId: `task:${task.id}`,
    attempts: Math.max(1, Math.min(task.maxAttempts, 10)),
    backoff: { type: "exponential", delay: task.jobName === "budget-outlier-review" ? 30_000 : 5_000 },
    removeOnComplete: { age: task.jobName === "budget-outlier-review" ? 7 * 24 * 60 * 60 : 24 * 60 * 60, count: 1_000 },
    removeOnFail: { age: task.jobName === "budget-outlier-review" ? 14 * 24 * 60 * 60 : 7 * 24 * 60 * 60, count: 1_000 },
  });
}

export async function getJobQueueHealth() {
  const queues = [maintenanceQueue, recurringQueue, agentQueue];
  const entries = await Promise.all(queues.map(async (queue) => ({
    queue: queue.name,
    counts: await queue.getJobCounts("active", "completed", "delayed", "failed", "waiting"),
  })));
  const redis = getRedisClient();
  let cursor = "0";
  let workerCount = 0;
  do {
    const [nextCursor, heartbeatKeys] = await redis.scan(cursor, "MATCH", "fainens:worker:heartbeat:*", "COUNT", 100);
    cursor = nextCursor;
    workerCount += heartbeatKeys.length;
  } while (cursor !== "0");
  return { queues: entries, workerCount };
}

export async function closeQueues(): Promise<void> {
  await Promise.all([maintenanceQueue.close(), recurringQueue.close(), agentQueue.close()]);
}
