import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
const mocks = vi.hoisted(() => ({ list: vi.fn(), recap: vi.fn(), saved: vi.fn(), write: vi.fn(), seen: vi.fn(), markSeen: vi.fn() }));
vi.mock("../services/recap", () => ({ listRecapPeriods: mocks.list, getPeriodRecap: mocks.recap, RecapPeriodError: class extends Error { constructor(message: string, public status: number) { super(message); } } }));
vi.mock("../services/recap-story", () => ({ getSavedRecapStory: mocks.saved, ensureRecapStory: mocks.write, RecapGenerationError: class extends Error {} }));
vi.mock("../services/recap-highlight", () => ({ getRecapHighlightSeenAt: mocks.seen, markRecapHighlightSeen: mocks.markSeen }));
import recapRoutes from "./recaps";

describe("recap API", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.resetAllMocks();
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate("authenticate", async (request: any, reply: any) => {
      if (request.headers.authorization !== "Bearer test") return reply.code(401).send({ error: "Unauthorized" });
      request.user = { email: "owner@example.test" };
    });
    await app.register(recapRoutes);
  });
  afterEach(async () => { await app.close(); });
  const get = (url: string) => app.inject({ url, headers: { authorization: "Bearer test" } });
  it("protects the archive and private financial stories", async () => {
    expect((await app.inject({ url: "/api/recaps" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/recaps/12" })).statusCode).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.recap).not.toHaveBeenCalled();
    expect((await app.inject({ url: "/api/recaps/12/story" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/recaps/12/highlight-state" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/recaps/12/highlight-seen" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/recaps/12/story", payload: { regenerate: true } })).statusCode).toBe(401);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.seen).not.toHaveBeenCalled();
    expect(mocks.markSeen).not.toHaveBeenCalled();
  });
  it("returns and persists owner-scoped highlight seen state", async () => {
    mocks.seen.mockReturnValueOnce(null).mockReturnValue(123456);
    mocks.markSeen.mockReturnValue(123456);
    expect((await get("/api/recaps/12/highlight-state")).json()).toEqual({ seenAt: null });
    expect(mocks.seen).toHaveBeenCalledWith("owner@example.test", 12);
    expect((await app.inject({ method: "POST", url: "/api/recaps/12/highlight-seen", headers: { authorization: "Bearer test" } })).json()).toEqual({ seenAt: 123456 });
    expect(mocks.markSeen).toHaveBeenCalledWith("owner@example.test", 12);
  });
  it.each(["0", "-1", "1.5", "2026-08", "invalid", "9007199254740992"])("rejects malformed period ID %s", async periodId => {
    expect((await get(`/api/recaps/${periodId}`)).statusCode).toBe(400);
    expect(mocks.recap).not.toHaveBeenCalled();
  });
  it("returns an empty archive for a new account", async () => {
    mocks.list.mockResolvedValue([]);
    expect((await get("/api/recaps")).json()).toEqual([]);
  });
  it("reads an empty saved-story cache without generating anything", async () => {
    mocks.saved.mockReturnValue(null);
    expect((await get("/api/recaps/12/story")).json()).toEqual({ story: null });
    expect(mocks.saved).toHaveBeenCalledWith("owner@example.test", 12);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("validates the regenerate flag and passes the authenticated owner", async () => {
    mocks.write.mockRejectedValue(new Error("test failure"));
    await app.inject({ method: "POST", url: "/api/recaps/12/story", headers: { authorization: "Bearer test" }, payload: { regenerate: true } });
    expect(mocks.write).toHaveBeenCalledWith("owner@example.test", 12, true);
    const malformed = await app.inject({ method: "POST", url: "/api/recaps/12/story", headers: { authorization: "Bearer test" }, payload: { regenerate: "true" } });
    expect(malformed.statusCode).toBe(400);
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });
  it("returns the typed financial payload and hides internal errors", async () => {
    mocks.recap.mockResolvedValue({ period: { id: 12, name: "Salary period", startDate: 1, endDate: 2 }, startMs: 1, endMs: 2, generatedAt: 3, isPartial: false, coverageComplete: true,
      income: 100, expenses: 80, net: 20, activityCount: 2, purchaseCount: 1, spendingDays: 1, categories: [], largestPurchase: null, comparison: null });
    const response = await get("/api/recaps/12");
    expect(response.statusCode).toBe(200);
    expect(response.json().net).toBe(20);
    mocks.recap.mockRejectedValue(new Error("private database details"));
    const failed = await get("/api/recaps/12");
    expect(failed.statusCode).toBe(500);
    expect(failed.body).not.toContain("private database");
  });
});
