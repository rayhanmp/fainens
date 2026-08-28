import { Queue } from "bullmq";
import { env } from "../lib/env";

export type MaintenanceJobName = "cache-invalidation-outbox" | "subscription-renewals" | "salary-posting";
const connection = { url: env.REDIS_URL, maxRetriesPerRequest: null };

export const maintenanceQueue = new Queue<undefined, void, MaintenanceJobName>("fainens-maintenance", { connection });

export async function enqueueMaintenance(name: MaintenanceJobName) {
  return maintenanceQueue.add(name, undefined, {
    // Jobs are idempotent and short. Removing completed jobs lets the stable
    // id be reused while retaining failed jobs for inspection.
    jobId: name,
    attempts: 4,
    backoff: { type: "exponential", delay: 1_000 },
    removeOnComplete: true,
    removeOnFail: { age: 7 * 24 * 60 * 60, count: 500 },
  });
}

export async function getJobQueueHealth() {
  const counts = await maintenanceQueue.getJobCounts("active", "completed", "delayed", "failed", "waiting");
  return { queue: "fainens-maintenance", counts };
}
