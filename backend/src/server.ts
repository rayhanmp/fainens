import { buildApp } from "./app";
import { bootstrapDb } from "./db/migrate";
import { closeRedisConnection, getRedisClient } from "./cache/redis";
import { precomputeEverything } from "./cache/precompute";
import { processCacheInvalidationOutbox } from "./services/cache-invalidation-outbox";
import { processDueSubscriptionRenewals } from "./services/subscription-renewals";
import { db } from "./db/client";
import { env } from "./lib/env";
import { enqueueMaintenance } from "./jobs/queue";

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
    app.log.info("Precomputing analytics...");
    try {
      await precomputeEverything();
      app.log.info("Analytics precomputed successfully");
    } catch (err) {
      app.log.warn({ err }, "Analytics precompute skipped; API will compute on demand");
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
    if (env.JOB_RUNNER_MODE === "queue") {
      app.log.info("BullMQ background mode enabled; start `pnpm --filter backend worker` separately");
      await Promise.all([enqueueMaintenance("cache-invalidation-outbox"), enqueueMaintenance("subscription-renewals"), enqueueMaintenance("salary-posting")]);
      intervals.push(setInterval(() => void enqueueMaintenance("cache-invalidation-outbox"), 60_000));
      intervals.push(setInterval(() => void enqueueMaintenance("subscription-renewals"), 60 * 60 * 1000));
      intervals.push(setInterval(() => void enqueueMaintenance("salary-posting"), 60 * 60 * 1000));
    } else {
      await Promise.all([runCacheOutbox(), runRenewals(), runSalaryPosting()]);
      intervals.push(setInterval(() => void runCacheOutbox(), 60_000));
      intervals.push(setInterval(() => void runRenewals(), 60 * 60 * 1000));
      intervals.push(setInterval(() => void runSalaryPosting(), 60 * 60 * 1000));
    }
    await app.listen({ port: 3000, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    await stop();
    process.exit(1);
  }
}

void start();
