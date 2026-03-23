import { config } from "dotenv";
import { resolve } from "path";

// Load .env from project root (parent of backend directory)
config({ path: resolve(__dirname, "../../.env") });

import Fastify from "fastify";
import cors from "@fastify/cors";

import { bootstrapDb } from "./db/migrate";
import { getRedisClient, closeRedisConnection } from "./cache/redis";
import { precomputeEverything } from "./cache/precompute";
import { env } from "./lib/env";
import { processDueSubscriptionRenewals } from "./services/subscription-renewals";
import { db } from "./db/client";

// Import routes
import authRoutes from "./routes/auth";
import accountRoutes from "./routes/accounts";
import transactionRoutes from "./routes/transactions";
import categoryRoutes from "./routes/categories";
import tagRoutes from "./routes/tags";
import periodRoutes from "./routes/periods";
import budgetRoutes from "./routes/budget";
import attachmentRoutes from "./routes/attachments";
import analyticsRoutes from "./routes/analytics";
import paylaterRoutes from "./routes/paylater";
import auditLogRoutes from "./routes/audit-log";
import reportsRoutes from "./routes/reports";
import salarySettingsRoutes from "./routes/salary-settings";
import subscriptionRoutes from "./routes/subscriptions";
import wishlistRoutes from "./routes/wishlist";

// Import plugins
import authPlugin from "./plugins/auth";

const fastify = Fastify({
  logger: true,
  // Allow larger body size for file uploads (10MB)
  bodyLimit: 15 * 1024 * 1024, // 15MB to be safe with base64 encoding overhead
});

// Register CORS
fastify.register(cors, {
  origin: env.NODE_ENV === "production" ? false : ["http://localhost:8080", "http://localhost:3000"],
  credentials: true,
});

// Health check (public)
fastify.get("/health", async () => {
  return { status: "ok" };
});

// Public root
fastify.get("/", async () => {
  return { message: "Fainens backend running" };
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  fastify.log.info("SIGTERM received, closing server...");
  await fastify.close();
  await closeRedisConnection();
  process.exit(0);
});

process.on("SIGINT", async () => {
  fastify.log.info("SIGINT received, closing server...");
  await fastify.close();
  await closeRedisConnection();
  process.exit(0);
});

const start = async () => {
  try {
    // Initialize database (schema + seed)
    await bootstrapDb();

    // Initialize Redis connection
    getRedisClient();

    // Precompute all analytics on startup (Redis optional — failures are logged, not fatal)
    fastify.log.info("Precomputing analytics...");
    try {
      await precomputeEverything();
      fastify.log.info("Analytics precomputed successfully");
    } catch (err) {
      fastify.log.warn({ err }, "Analytics precompute skipped (Redis or DB); API will compute on demand");
    }

    // Register auth plugin (provides JWT and OAuth2)
    await fastify.register(authPlugin);

    // Register routes
    await fastify.register(authRoutes);
    await fastify.register(accountRoutes);
    await fastify.register(transactionRoutes);
    await fastify.register(categoryRoutes);
    await fastify.register(tagRoutes);
    await fastify.register(periodRoutes);
    await fastify.register(budgetRoutes);
    await fastify.register(attachmentRoutes);
    await fastify.register(analyticsRoutes);
    await fastify.register(paylaterRoutes);
    await fastify.register(auditLogRoutes);
    await fastify.register(reportsRoutes);
    await fastify.register(salarySettingsRoutes);
    await fastify.register(subscriptionRoutes);
    await fastify.register(wishlistRoutes);

    await fastify.listen({ port: 3000, host: "0.0.0.0" });

    const runRenewals = async () => {
      try {
        const r = await processDueSubscriptionRenewals(db);
        if (r.processed > 0 || r.errors.length > 0) {
          fastify.log.info({ renewals: r }, "subscription renewals (scheduled)");
        }
      } catch (e) {
        fastify.log.warn({ err: e }, "subscription renewals failed");
      }
    };
    await runRenewals();
    const renewalIntervalMs = 60 * 60 * 1000;
    setInterval(() => {
      void runRenewals();
    }, renewalIntervalMs);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

