import { buildApp } from "./app";
import { bootstrapDb } from "./db/migrate";
import { closeRedisConnection, getRedisClient } from "./cache/redis";
import { precomputeEverything } from "./cache/precompute";
import { processCacheInvalidationOutbox } from "./services/cache-invalidation-outbox";
import { processStorageDeletionOutbox } from "./services/storage-cleanup";
import { processDueBackgroundTasks } from "./services/background-tasks";
import { processDueSubscriptionRenewals } from "./services/subscription-renewals";
import { db } from "./db/client";
import { env } from "./lib/env";
import { enqueueMaintenance, enqueueRecurring, maintenanceQueue } from "./jobs/queue";
import { configureJobSchedulers } from "./jobs/schedulers";

async function start() {
  const app = await buildApp();
  const intervals: NodeJS.Timeout[] = [];
  const stop = async () => {
    intervals.forEach(clearInterval);
    await app.close();
    await closeRedisConnection();
  };
  process.once("SIGTERM", () => void stop().finally(() => process.exit(0)));
  process.once("SIGINT", () => void stop().finally(() => process.exit(0)));
  try {
    await bootstrapDb();
    getRedisClient();
    if (env.JOB_RUNNER_MODE !== "queue") {
      app.log.info("Precomputing analytics...");
      try {
        await precomputeEverything();
        app.log.info("Analytics precomputed successfully");
      } catch (err) {
        app.log.warn({ err }, "Analytics precompute skipped; API will compute on demand");
      }
    }
    const runCacheOutbox = async () => {
      try {
        const result = await processCacheInvalidationOutbox();
        if (result.processed || result.failed) app.log.info({ cacheInvalidations: result }, "cache invalidation outbox processed");
      } catch (err) { app.log.warn({ err }, "cache invalidation outbox failed"); }
    };
    const runRenewals = async () => {
      try {
        const result = await processDueSubscriptionRenewals(db);
        if (result.processed || result.errors.length) app.log.info({ renewals: result }, "subscription renewals processed");
      } catch (err) { app.log.warn({ err }, "subscription renewals failed"); }
    };
    const runSalaryPosting = async () => {
      try {
        const { postSalaryIfPayrollDay } = await import("./services/salary-posting");
        const result = await postSalaryIfPayrollDay(db);
        if (result.posted) app.log.info({ result }, "salary posted");
      } catch (err) { app.log.warn({ err }, "salary posting failed"); }
    };
    const runStorageCleanup = async () => {
      try {
        const result = await processStorageDeletionOutbox();
        if (result.processed || result.failed) app.log.info({ storageCleanup: result }, "storage deletion outbox processed");
      } catch (err) { app.log.warn({ err }, "storage deletion outbox failed"); }
    };
    const runBackgroundTasks = async () => {
      try {
        const result = await processDueBackgroundTasks();
        if (result.processed || result.failed) app.log.info({ backgroundTasks: result }, "agent background tasks processed");
      } catch (err) { app.log.warn({ err }, "agent background tasks failed"); }
    };
    if (env.JOB_RUNNER_MODE === "queue") {
      app.log.info("BullMQ background mode enabled; scheduler and worker own background execution");
      try {
        await configureJobSchedulers();
        await Promise.all([
          enqueueMaintenance("dispatch-background-tasks"),
          enqueueMaintenance("cache-invalidation-outbox"),
          enqueueMaintenance("storage-deletion-outbox"),
          maintenanceQueue.add("precompute-warmup", undefined, { jobId: "maintenance:precompute-warmup" }),
          enqueueRecurring("subscription-renewals"),
          enqueueRecurring("salary-posting"),
        ]);
      } catch (err) {
        // SQLite remains authoritative. If Redis is down, keep the API online
        // for normal financial reads/writes and let the worker/dispatcher
        // recover the durable outboxes and tasks once Redis returns.
        app.log.warn({ err }, "BullMQ unavailable; background work will be retried by the worker");
      }
    } else {
      await Promise.all([runCacheOutbox(), runStorageCleanup(), runRenewals(), runSalaryPosting(), runBackgroundTasks()]);
      intervals.push(setInterval(() => void runCacheOutbox(), 60_000));
      intervals.push(setInterval(() => void runStorageCleanup(), 5 * 60_000));
      intervals.push(setInterval(() => void runBackgroundTasks(), 30_000));
      intervals.push(setInterval(() => void runRenewals(), 60 * 60 * 1000));
      intervals.push(setInterval(() => void runSalaryPosting(), 60 * 60 * 1000));
    }
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (err) {
    app.log.error(err);
    await stop();
    process.exit(1);
  }
}

void start();
