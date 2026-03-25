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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = require("dotenv");
const path_1 = require("path");
// Load .env from project root (parent of backend directory)
(0, dotenv_1.config)({ path: (0, path_1.resolve)(__dirname, "../../.env") });
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const rate_limit_1 = __importDefault(require("@fastify/rate-limit"));
const migrate_1 = require("./db/migrate");
const redis_1 = require("./cache/redis");
const precompute_1 = require("./cache/precompute");
const env_1 = require("./lib/env");
const subscription_renewals_1 = require("./services/subscription-renewals");
const client_1 = require("./db/client");
// Import routes
const auth_1 = __importDefault(require("./routes/auth"));
const accounts_1 = __importDefault(require("./routes/accounts"));
const transactions_1 = __importDefault(require("./routes/transactions"));
const categories_1 = __importDefault(require("./routes/categories"));
const tags_1 = __importDefault(require("./routes/tags"));
const periods_1 = __importDefault(require("./routes/periods"));
const budget_1 = __importDefault(require("./routes/budget"));
const attachments_1 = __importDefault(require("./routes/attachments"));
const analytics_1 = __importDefault(require("./routes/analytics"));
const paylater_1 = __importDefault(require("./routes/paylater"));
const audit_log_1 = __importDefault(require("./routes/audit-log"));
const reports_1 = __importDefault(require("./routes/reports"));
const salary_settings_1 = __importDefault(require("./routes/salary-settings"));
const subscriptions_1 = __importDefault(require("./routes/subscriptions"));
const wishlist_1 = __importDefault(require("./routes/wishlist"));
const loans_1 = __importDefault(require("./routes/loans"));
const contacts_1 = __importDefault(require("./routes/contacts"));
const insights_1 = __importDefault(require("./routes/insights"));
const pending_transactions_1 = __importDefault(require("./routes/pending-transactions"));
// Import plugins
const auth_2 = __importDefault(require("./plugins/auth"));
const fastify = (0, fastify_1.default)({
    logger: true,
    // Allow larger body size for file uploads (10MB)
    bodyLimit: 15 * 1024 * 1024, // 15MB to be safe with base64 encoding overhead
});
// Register CORS
fastify.register(cors_1.default, {
    origin: env_1.env.NODE_ENV === "production" ? false : ["http://localhost:8080", "http://localhost:3000"],
    credentials: true,
});
// Register rate limiting
fastify.register(rate_limit_1.default, {
    max: 1000,
    timeWindow: '1 minute',
    redis: (0, redis_1.getRedisClient)(),
    keyGenerator: (req) => {
        // Use user ID if authenticated, otherwise IP address
        return req.user?.id || req.ip;
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
    fastify.register(rate_limit_1.default, {
        max: 10,
        timeWindow: '5 minutes',
        redis: (0, redis_1.getRedisClient)(),
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
    fastify.register(rate_limit_1.default, {
        max: 10,
        timeWindow: '1 minute',
        redis: (0, redis_1.getRedisClient)(),
        keyGenerator: (req) => {
            return req.user?.id || req.ip;
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
    fastify.register(rate_limit_1.default, {
        max: 20,
        timeWindow: '1 minute',
        redis: (0, redis_1.getRedisClient)(),
        keyGenerator: (req) => {
            return req.user?.id || req.ip;
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
    fastify.register(rate_limit_1.default, {
        max: 30,
        timeWindow: '1 minute',
        redis: (0, redis_1.getRedisClient)(),
        keyGenerator: (req) => {
            return req.user?.id || req.ip;
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
    fastify.register(rate_limit_1.default, {
        max: 10,
        timeWindow: '1 minute',
        redis: (0, redis_1.getRedisClient)(),
        keyGenerator: (req) => {
            return req.user?.id || req.ip;
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
    await (0, redis_1.closeRedisConnection)();
    process.exit(0);
});
process.on("SIGINT", async () => {
    fastify.log.info("SIGINT received, closing server...");
    await fastify.close();
    await (0, redis_1.closeRedisConnection)();
    process.exit(0);
});
const start = async () => {
    try {
        // Initialize database (schema + seed)
        await (0, migrate_1.bootstrapDb)();
        // Initialize Redis connection
        (0, redis_1.getRedisClient)();
        // Precompute all analytics on startup (Redis optional — failures are logged, not fatal)
        fastify.log.info("Precomputing analytics...");
        try {
            await (0, precompute_1.precomputeEverything)();
            fastify.log.info("Analytics precomputed successfully");
        }
        catch (err) {
            fastify.log.warn({ err }, "Analytics precompute skipped (Redis or DB); API will compute on demand");
        }
        // Register auth plugin (provides JWT and OAuth2)
        await fastify.register(auth_2.default);
        // Register routes
        await fastify.register(auth_1.default);
        await fastify.register(accounts_1.default);
        await fastify.register(transactions_1.default);
        await fastify.register(categories_1.default);
        await fastify.register(tags_1.default);
        await fastify.register(periods_1.default);
        await fastify.register(budget_1.default);
        await fastify.register(attachments_1.default);
        await fastify.register(analytics_1.default);
        await fastify.register(paylater_1.default);
        await fastify.register(audit_log_1.default);
        await fastify.register(reports_1.default);
        await fastify.register(salary_settings_1.default);
        await fastify.register(subscriptions_1.default);
        await fastify.register(wishlist_1.default);
        await fastify.register(loans_1.default);
        await fastify.register(contacts_1.default);
        await fastify.register(insights_1.default);
        await fastify.register(pending_transactions_1.default);
        await fastify.listen({ port: 3000, host: "0.0.0.0" });
        const runRenewals = async () => {
            try {
                const r = await (0, subscription_renewals_1.processDueSubscriptionRenewals)(client_1.db);
                if (r.processed > 0 || r.errors.length > 0) {
                    fastify.log.info({ renewals: r }, "subscription renewals (scheduled)");
                }
            }
            catch (e) {
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
                const { postSalaryIfPayrollDay } = await Promise.resolve().then(() => __importStar(require("./services/salary-posting")));
                const result = await postSalaryIfPayrollDay(client_1.db);
                if (result.posted) {
                    fastify.log.info({ result }, "salary posted (scheduled)");
                }
            }
            catch (e) {
                fastify.log.warn({ err: e }, "salary posting failed");
            }
        };
        await runSalaryPosting();
        setInterval(() => {
            void runSalaryPosting();
        }, renewalIntervalMs);
    }
    catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
start();
