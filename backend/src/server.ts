import { config } from "dotenv";
import { resolve } from "path";

// Load .env from project root (parent of backend directory)
config({ path: resolve(__dirname, "../../.env") });

import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import helmet from "@fastify/helmet";

import { bootstrapDb } from "./db/migrate";
import { getRedisClient, closeRedisConnection } from "./cache/redis";
import { precomputeEverything } from "./cache/precompute";
import { env } from "./lib/env";
import { processDueSubscriptionRenewals } from "./services/subscription-renewals";
import { processCacheInvalidationOutbox } from "./services/cache-invalidation-outbox";
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
import loanRoutes from "./routes/loans";
import contactRoutes from "./routes/contacts";
import insightsRoutes from "./routes/insights";
import pendingTransactionsRoutes from "./routes/pending-transactions";
import splitbillRoutes from "./routes/splitbill";
import agentRoutes from "./routes/agent";
import moneyAnomalyRoutes from "./routes/money-anomalies";

// Import plugins
import authPlugin from "./plugins/auth";

const fastify = Fastify({
  logger: true,
  // Allow larger body size for file uploads (10MB)
  bodyLimit: 15 * 1024 * 1024, // 15MB to be safe with base64 encoding overhead
});

// Register CORS
const ALLOWED_ORIGINS = env.NODE_ENV === "production"
  ? ["https://fins.rayhan.id"]
  : ["http://localhost:8080", "http://localhost:3000"];

fastify.register(cors, {
  origin: ALLOWED_ORIGINS,
  credentials: true,
});

// Register security headers
fastify.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", "https://openrouter.ai"],
    },
  },
});

// Register rate limiting
fastify.register(rateLimit, {
  max: 1000,
  timeWindow: '1 minute',
  redis: getRedisClient(),
  keyGenerator: (req) => {
    // Use email if authenticated, otherwise IP address
    return (req.user as { email?: string })?.email || req.ip;
  },
  errorResponseBuilder: (req, context) => {
    return {
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Try again in ${context.after}`,
      retryAfter: context.after
    };
  }
});

// Stricter rate limit for auth endpoints
fastify.register(async function (fastify) {
  fastify.register(rateLimit, {
    max: 10,
    timeWindow: '5 minutes',
    redis: getRedisClient(),
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: (req, context) => {
      return {
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'Too many authentication attempts. Please try again later.',
        retryAfter: context.after
      };
    }
  });
}, { prefix: '/auth' });

// Rate limit for expensive operations (import/export)
fastify.register(async function (fastify) {
  fastify.register(rateLimit, {
    max: 10,
    timeWindow: '1 minute',
    redis: getRedisClient(),
    keyGenerator: (req) => {
      return (req.user as { email?: string })?.email || req.ip;
    },
    errorResponseBuilder: (req, context) => {
      return {
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'Import/Export rate limit exceeded. Please try again later.',
        retryAfter: context.after
      };
    }
  });
}, { prefix: '/transactions/import' });

// Rate limit for attachment uploads
fastify.register(async function (fastify) {
  fastify.register(rateLimit, {
    max: 20,
    timeWindow: '1 minute',
    redis: getRedisClient(),
    keyGenerator: (req) => {
      return (req.user as { email?: string })?.email || req.ip;
    },
    errorResponseBuilder: (req, context) => {
      return {
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'Upload rate limit exceeded. Please try again later.',
        retryAfter: context.after
      };
    }
  });
}, { prefix: '/attachments' });

// Rate limit for expensive analytics/reporting endpoints
fastify.register(async function (fastify) {
  fastify.register(rateLimit, {
    max: 30,
    timeWindow: '1 minute',
    redis: getRedisClient(),
    keyGenerator: (req) => {
      return (req.user as { email?: string })?.email || req.ip;
    },
    errorResponseBuilder: (req, context) => {
      return {
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'Analytics rate limit exceeded. Please try again later.',
        retryAfter: context.after
      };
    }
  });
}, { prefix: '/reports' });

// Rate limit for wishlist scraper (external calls)
fastify.register(async function (fastify) {
  fastify.register(rateLimit, {
    max: 10,
    timeWindow: '1 minute',
    redis: getRedisClient(),
    keyGenerator: (req) => {
      return (req.user as { email?: string })?.email || req.ip;
    },
    errorResponseBuilder: (req, context) => {
      return {
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'Scraper rate limit exceeded. Please try again later.',
        retryAfter: context.after
      };
    }
  });
}, { prefix: '/wishlist' });

// Health check (public) - minimal info
fastify.get("/health", async () => {
  return { status: "ok", timestamp: Date.now() };
});

// Public root - minimal info
fastify.get("/", async () => {
  return { ok: true };
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

    // Replay durable cache invalidation intents after startup and periodically
    // thereafter. Redis is an optimization; committed writes remain correct
    // when it is down because these rows are retried without data loss.
    const runCacheInvalidationOutbox = async () => {
      try {
        const result = await processCacheInvalidationOutbox();
        if (result.processed > 0 || result.failed > 0) {
          fastify.log.info({ cacheInvalidations: result }, "cache invalidation outbox processed");
        }
      } catch (err) {
        fastify.log.warn({ err }, "cache invalidation outbox failed");
      }
    };
    await runCacheInvalidationOutbox();
    setInterval(() => {
      void runCacheInvalidationOutbox();
    }, 60_000);

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
    await fastify.register(loanRoutes);
    await fastify.register(contactRoutes);
    await fastify.register(insightsRoutes);
    await fastify.register(pendingTransactionsRoutes);
    await fastify.register(splitbillRoutes);
    await fastify.register(agentRoutes);
    await fastify.register(moneyAnomalyRoutes);

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

    // Salary posting scheduled job - runs every hour to check if it's payroll day
    const runSalaryPosting = async () => {
      try {
        const { postSalaryIfPayrollDay } = await import("./services/salary-posting");
        const result = await postSalaryIfPayrollDay(db);
        if (result.posted) {
          fastify.log.info({ result }, "salary posted (scheduled)");
        }
      } catch (e) {
        fastify.log.warn({ err: e }, "salary posting failed");
      }
    };
    await runSalaryPosting();
    setInterval(() => {
      void runSalaryPosting();
    }, renewalIntervalMs);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
