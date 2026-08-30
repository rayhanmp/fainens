import { agentQueue, maintenanceQueue, recurringQueue } from "./queue";

type SchedulerQueue = { upsertJobScheduler?: (...args: any[]) => Promise<unknown> };

async function upsert(queue: SchedulerQueue, id: string, every: number, name: string, options: { attempts?: number; delay?: number; completeAge?: number; completeCount?: number; failAge?: number; failCount?: number } = {}): Promise<void> {
  // BullMQ 6's scheduler API replaces the older repeatable-job helpers. Keep
  // this runtime check explicit so queue mode fails at startup instead of
  // silently losing recurring work after a dependency downgrade.
  if (typeof queue.upsertJobScheduler !== "function") {
    throw new Error("BullMQ 6 upsertJobScheduler is unavailable");
  }
  await queue.upsertJobScheduler(id, { every }, {
    name,
    data: undefined,
    opts: {
      attempts: options.attempts ?? 4,
      backoff: { type: "exponential", delay: options.delay ?? 1_000 },
      removeOnComplete: { age: options.completeAge ?? 24 * 60 * 60, count: options.completeCount ?? 100 },
      removeOnFail: { age: options.failAge ?? 7 * 24 * 60 * 60, count: options.failCount ?? 500 },
    },
  });
}

/** Configure all repeatable work in one idempotent operation. Scheduler IDs
 * are stable across deploys, so multiple API/worker processes do not multiply
 * recurring jobs. */
export async function configureJobSchedulers(): Promise<void> {
  await Promise.all([
    upsert(maintenanceQueue, "maintenance-dispatch-tasks", 30_000, "dispatch-background-tasks"),
    upsert(maintenanceQueue, "maintenance-cache-invalidation", 60_000, "cache-invalidation-outbox", { attempts: 8, delay: 5_000, failAge: 14 * 24 * 60 * 60, failCount: 1_000 }),
    upsert(maintenanceQueue, "maintenance-storage-cleanup", 5 * 60_000, "storage-deletion-outbox", { attempts: 5, delay: 30_000, completeAge: 7 * 24 * 60 * 60, completeCount: 500, failAge: 30 * 24 * 60 * 60, failCount: 1_000 }),
    upsert(recurringQueue, "recurring-subscriptions", 60 * 60_000, "subscription-renewals"),
    upsert(recurringQueue, "recurring-salary", 60 * 60_000, "salary-posting"),
  ]);
}
