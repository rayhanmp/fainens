import { Worker } from "bullmq";
import { db } from "../db/client";
import { env } from "../lib/env";
import { processCacheInvalidationOutbox } from "../services/cache-invalidation-outbox";
import { processDueSubscriptionRenewals } from "../services/subscription-renewals";
import { postSalaryIfPayrollDay } from "../services/salary-posting";
import type { MaintenanceJobName } from "./queue";

const worker = new Worker<undefined, void, MaintenanceJobName>("fainens-maintenance", async (job) => {
  switch (job.name) {
    case "cache-invalidation-outbox":
      await processCacheInvalidationOutbox();
      return;
    case "subscription-renewals":
      await processDueSubscriptionRenewals(db);
      return;
    case "salary-posting":
      await postSalaryIfPayrollDay(db);
      return;
  }
}, { connection: { url: env.REDIS_URL, maxRetriesPerRequest: null }, concurrency: 2 });

worker.on("completed", (job) => console.info(`[worker] ${job.name} completed`));
worker.on("failed", (job, error) => console.error(`[worker] ${job?.name ?? "unknown"} failed`, error));
worker.on("error", (error) => console.error("[worker] connection error", error));

async function stop() {
  await worker.close();
}
process.once("SIGTERM", () => void stop().finally(() => process.exit(0)));
process.once("SIGINT", () => void stop().finally(() => process.exit(0)));
