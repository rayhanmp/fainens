import { z } from "zod";

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

  // App
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

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
