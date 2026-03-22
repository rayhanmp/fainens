"use strict";
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
const migrate_1 = require("./db/migrate");
const redis_1 = require("./cache/redis");
const precompute_1 = require("./cache/precompute");
const env_1 = require("./lib/env");
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
// Import plugins
const auth_2 = __importDefault(require("./plugins/auth"));
const fastify = (0, fastify_1.default)({
    logger: true,
});
// Register CORS
fastify.register(cors_1.default, {
    origin: env_1.env.NODE_ENV === "production" ? false : ["http://localhost:8080", "http://localhost:3000"],
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
        // Precompute all analytics on startup
        fastify.log.info("Precomputing analytics...");
        await (0, precompute_1.precomputeEverything)();
        fastify.log.info("Analytics precomputed successfully");
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
        await fastify.listen({ port: 3000, host: "0.0.0.0" });
    }
    catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
start();
