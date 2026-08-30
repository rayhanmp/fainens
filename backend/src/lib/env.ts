import { z } from "zod";
import { config } from "dotenv";
import { resolve } from "path";

// This file is also imported by workers, route/plugin tests, and contract
// generation, none of which necessarily execute the HTTP server bootstrap.
// Load the shared environment first, then apply ignored developer overrides so
// a standalone worker has the same validated configuration as the API.
config({ path: resolve(__dirname, "../../../.env") });
config({ path: resolve(__dirname, "../../../.env.local"), override: true });

const envSchema = z.object({
  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID is required"),
  GOOGLE_CLIENT_SECRET: z.string().min(1, "GOOGLE_CLIENT_SECRET is required"),
  GOOGLE_CALLBACK_URL: z.string().url("GOOGLE_CALLBACK_URL must be a valid URL"),
  ALLOWED_EMAIL: z.string().email("ALLOWED_EMAIL must be a valid email"),

  // Session
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),

  // Cloudflare R2 (optional - only required for attachment uploads)
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().default("fainens-attachments"),
  R2_PUBLIC_URL: z.string().url().optional(),

  // Redis — use redis://127.0.0.1:6379 for local dev; in Docker Compose use redis://redis:6379
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),

  // OpenRouter API for LLM insights
  OPENROUTER_API_KEY: z.string().optional(),
  // Model used by the interactive finance agent. Keep this configurable so a
  // provider/account can be changed without silently disagreeing with the UI.
  OPENROUTER_MODEL: z.string().min(1).default("google/gemini-3.7-flash"),

  // App
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  /**
   * Explicit local-only escape hatch for inspecting a dev database when OAuth
   * is configured for a production callback. The auth plugin refuses it in
   * production regardless of this value.
   */
  LOCAL_AUTH_BYPASS: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),

  // Intervals remain the compatibility default. Set queue only when the
  // standalone BullMQ worker is deployed and healthy.
  JOB_RUNNER_MODE: z.enum(["interval", "queue"]).default("interval"),
  WORKER_MAINTENANCE_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(2),
  WORKER_RECURRING_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  WORKER_AGENT_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(1),
  WORKER_AGENT_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(120_000).default(45_000),

  /**
   * Where to send the browser after successful Google OAuth (must match the origin you use in the browser).
   * e.g. http://localhost:8080 for Vite dev (see vite.config server.port).
   * If unset, callback uses reply.redirect("/") which stays on the API host — wrong when API is :3000 and UI is :8080.
   */
  FRONTEND_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    // eslint-disable-next-line no-console
    console.error("Environment validation failed:");
    for (const issue of result.error.issues) {
      // eslint-disable-next-line no-console
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();
