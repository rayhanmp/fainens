import { vi } from "vitest";

vi.mock("../src/db/client", async () => ({ db: (await import("./fixture")).evalDb }));
vi.mock("../src/lib/env", () => ({ env: {
  NODE_ENV: "test", ALLOWED_EMAIL: "agent-eval@example.invalid",
  SESSION_SECRET: "synthetic-evaluation-session-secret-only",
  OPENROUTER_API_KEY: process.env.EVAL_LIVE === "1" ? process.env.EVAL_OPENROUTER_API_KEY : "offline-replay",
  OPENROUTER_MODEL: process.env.EVAL_MODEL ?? "offline-replay",
  FRONTEND_URL: "http://localhost:8080", JOB_RUNNER_MODE: "interval",
} }));
vi.mock("../src/cache/redis", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  getRedisClient: () => { throw new Error("Redis is disabled in agent evaluations"); },
  cacheGet: async () => null, cacheSet: async () => {},
  cacheDelete: async () => {}, cacheDeletePattern: async () => {},
}));
vi.mock("../src/jobs/queue", () => ({ enqueueTask: async () => { throw new Error("Queues are disabled in evaluations"); } }));
// Storage must never fall back to writing attachments into the developer's data directory.
vi.mock("../src/services/r2", () => new Proxy({}, {
  get: (_target, key) => key === "then" ? undefined : () => { throw new Error("Storage is disabled in evaluations"); },
}));
vi.mock("../src/services/agent-llm", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/services/agent-llm")>();
  const { runProvider } = await import("./provider");
  return {
    ...original,
    callOpenRouterAgent: (input: Parameters<typeof original.callOpenRouterAgent>[0]) => runProvider(input, () => original.callOpenRouterAgent(input)),
    streamOpenRouterAgent: (input: Parameters<typeof original.streamOpenRouterAgent>[0]) => runProvider(input, () => original.streamOpenRouterAgent(input), input.onTextDelta),
  };
});
