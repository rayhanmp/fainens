"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const migrate_1 = require("./db/migrate");
const redis_1 = require("./cache/redis");
const precompute_1 = require("./cache/precompute");
const cache_invalidation_outbox_1 = require("./services/cache-invalidation-outbox");
const storage_cleanup_1 = require("./services/storage-cleanup");
const background_tasks_1 = require("./services/background-tasks");
const subscription_renewals_1 = require("./services/subscription-renewals");
const client_1 = require("./db/client");
const env_1 = require("./lib/env");
const queue_1 = require("./jobs/queue");
const schedulers_1 = require("./jobs/schedulers");
async function start() {
    const app = await (0, app_1.buildApp)();
    const intervals = [];
    const stop = async () => {
        intervals.forEach(clearInterval);
        await app.close();
        await (0, redis_1.closeRedisConnection)();
    };
    process.once("SIGTERM", () => void stop().finally(() => process.exit(0)));
    process.once("SIGINT", () => void stop().finally(() => process.exit(0)));
    try {
        await (0, migrate_1.bootstrapDb)();
        (0, redis_1.getRedisClient)();
        if (env_1.env.JOB_RUNNER_MODE !== "queue") {
            app.log.info("Precomputing analytics...");
            try {
                await (0, precompute_1.precomputeEverything)();
                app.log.info("Analytics precomputed successfully");
            }
            catch (err) {
                app.log.warn({ err }, "Analytics precompute skipped; API will compute on demand");
            }
        }
        const runCacheOutbox = async () => {
            try {
                const result = await (0, cache_invalidation_outbox_1.processCacheInvalidationOutbox)();
                if (result.processed || result.failed)
                    app.log.info({ cacheInvalidations: result }, "cache invalidation outbox processed");
            }
            catch (err) {
                app.log.warn({ err }, "cache invalidation outbox failed");
            }
        };
        const runRenewals = async () => {
            try {
                const result = await (0, subscription_renewals_1.processDueSubscriptionRenewals)(client_1.db);
                if (result.processed || result.errors.length)
                    app.log.info({ renewals: result }, "subscription renewals processed");
            }
            catch (err) {
                app.log.warn({ err }, "subscription renewals failed");
            }
        };
        const runSalaryPosting = async () => {
            try {
                const { postSalaryIfPayrollDay } = await Promise.resolve().then(() => __importStar(require("./services/salary-posting")));
                const result = await postSalaryIfPayrollDay(client_1.db);
                if (result.posted)
                    app.log.info({ result }, "salary posted");
            }
            catch (err) {
                app.log.warn({ err }, "salary posting failed");
            }
        };
        const runStorageCleanup = async () => {
            try {
                const result = await (0, storage_cleanup_1.processStorageDeletionOutbox)();
                if (result.processed || result.failed)
                    app.log.info({ storageCleanup: result }, "storage deletion outbox processed");
            }
            catch (err) {
                app.log.warn({ err }, "storage deletion outbox failed");
            }
        };
        const runBackgroundTasks = async () => {
            try {
                const result = await (0, background_tasks_1.processDueBackgroundTasks)();
                if (result.processed || result.failed)
                    app.log.info({ backgroundTasks: result }, "agent background tasks processed");
            }
            catch (err) {
                app.log.warn({ err }, "agent background tasks failed");
            }
        };
        if (env_1.env.JOB_RUNNER_MODE === "queue") {
            app.log.info("BullMQ background mode enabled; scheduler and worker own background execution");
            try {
                await (0, schedulers_1.configureJobSchedulers)();
                await Promise.all([
                    (0, queue_1.enqueueMaintenance)("dispatch-background-tasks"),
                    (0, queue_1.enqueueMaintenance)("cache-invalidation-outbox"),
                    (0, queue_1.enqueueMaintenance)("storage-deletion-outbox"),
                    queue_1.maintenanceQueue.add("precompute-warmup", undefined, { jobId: "maintenance:precompute-warmup" }),
                    (0, queue_1.enqueueRecurring)("subscription-renewals"),
                    (0, queue_1.enqueueRecurring)("salary-posting"),
                ]);
            }
            catch (err) {
                // SQLite remains authoritative. If Redis is down, keep the API online
                // for normal financial reads/writes and let the worker/dispatcher
                // recover the durable outboxes and tasks once Redis returns.
                app.log.warn({ err }, "BullMQ unavailable; background work will be retried by the worker");
            }
        }
        else {
            await Promise.all([runCacheOutbox(), runStorageCleanup(), runRenewals(), runSalaryPosting(), runBackgroundTasks()]);
            intervals.push(setInterval(() => void runCacheOutbox(), 60000));
            intervals.push(setInterval(() => void runStorageCleanup(), 5 * 60000));
            intervals.push(setInterval(() => void runBackgroundTasks(), 30000));
            intervals.push(setInterval(() => void runRenewals(), 60 * 60 * 1000));
            intervals.push(setInterval(() => void runSalaryPosting(), 60 * 60 * 1000));
        }
        await app.listen({ port: 3000, host: "0.0.0.0" });
    }
    catch (err) {
        app.log.error(err);
        await stop();
        process.exit(1);
    }
}
void start();
