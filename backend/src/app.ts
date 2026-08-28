import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../../.env") });

import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getRedisClient } from "./cache/redis";
import { env } from "./lib/env";
import authPlugin from "./plugins/auth";
import authRoutes from "./routes/auth";
import accountRoutes from "./routes/accounts";
import transactionRoutes from "./routes/transactions";
import categoryRoutes from "./routes/categories";
import tagRoutes from "./routes/tags";
import transportRouteTemplateRoutes from "./routes/transport-route-templates";
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

export type AppRuntime = "server" | "contract";

/** Registers HTTP concerns only: no database migration, timers, worker, or listener. */
export async function buildApp({ runtime = "server" }: { runtime?: AppRuntime } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: runtime === "server", bodyLimit: 15 * 1024 * 1024 }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.register(swagger, {
    openapi: {
      info: { title: "Fainens API", version: "1.0.0", description: "Personal finance ledger API" },
      tags: ["accounts", "transactions", "categories", "periods", "budgets", "analytics", "agent"].map((name) => ({ name })),
    },
    transform: jsonSchemaTransform,
  });
  const allowedOrigins = env.NODE_ENV === "production" ? ["https://fins.rayhan.id"] : ["http://localhost:8080", "http://localhost:3000"];
  app.register(cors, { origin: allowedOrigins, credentials: true });
  app.register(helmet, { contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", "data:", "https:"], scriptSrc: ["'self'"], connectSrc: ["'self'", "https://openrouter.ai"],
  } } });
  const errorResponse = (message: string) => (_request: unknown, context: { after: string | number }) => ({ statusCode: 429, error: "Too Many Requests", message: `${message} Try again in ${context.after}`, retryAfter: context.after });
  const keyGenerator = (request: { user?: { email?: string }; ip: string }) => request.user?.email || request.ip;
  const redis = runtime === "server" ? getRedisClient() : undefined;
  app.register(rateLimit, { max: 1000, timeWindow: "1 minute", redis, keyGenerator, errorResponseBuilder: errorResponse("Rate limit exceeded.") });
  const limitScope = (instance: FastifyInstance, max: number, timeWindow: string, message: string) => {
    instance.register(rateLimit, { max, timeWindow, redis, keyGenerator, errorResponseBuilder: errorResponse(message) });
  };
  app.register((instance) => limitScope(instance, 10, "5 minutes", "Too many authentication attempts."), { prefix: "/auth" });
  app.register((instance) => limitScope(instance, 10, "1 minute", "Import/export rate limit exceeded."), { prefix: "/transactions/import" });
  app.register((instance) => limitScope(instance, 20, "1 minute", "Upload rate limit exceeded."), { prefix: "/attachments" });
  app.register((instance) => limitScope(instance, 30, "1 minute", "Analytics rate limit exceeded."), { prefix: "/reports" });
  app.register((instance) => limitScope(instance, 10, "1 minute", "Scraper rate limit exceeded."), { prefix: "/wishlist" });

  app.get("/health", { schema: { tags: ["system"], response: { 200: z.object({ status: z.literal("ok"), timestamp: z.number() }) } } }, async () => ({ status: "ok" as const, timestamp: Date.now() }));
  app.get("/", { schema: { tags: ["system"], response: { 200: z.object({ ok: z.literal(true) }) } } }, async () => ({ ok: true as const }));
  app.register(authPlugin);
  app.register(authRoutes);
  app.register(transactionRoutes);
  app.register(accountRoutes);
  app.register(categoryRoutes);
  app.register(tagRoutes);
  app.register(transportRouteTemplateRoutes);
  app.register(periodRoutes);
  app.register(budgetRoutes);
  app.register(attachmentRoutes);
  app.register(analyticsRoutes);
  app.register(paylaterRoutes);
  app.register(auditLogRoutes);
  app.register(reportsRoutes);
  app.register(salarySettingsRoutes);
  app.register(subscriptionRoutes);
  app.register(wishlistRoutes);
  app.register(loanRoutes);
  app.register(contactRoutes);
  app.register(insightsRoutes);
  app.register(pendingTransactionsRoutes);
  app.register(splitbillRoutes);
  app.register(agentRoutes);
  app.register(moneyAnomalyRoutes);
  return app;
}
