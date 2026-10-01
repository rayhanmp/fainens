import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";

const mocks = vi.hoisted(() => ({ select: vi.fn(), call: vi.fn(), config: vi.fn() }));
vi.mock("../db/client", () => ({ db: { select: mocks.select } }));
vi.mock("../services/openrouter", () => ({ callOpenRouter: mocks.call }));
vi.mock("../services/agent-provider-config", () => ({ getAgentProviderConfig: mocks.config }));
import transactionsRoute from "./transactions";

const tags = [1, 2, 3, 4].map(id => ({ id, name: `Tag ${id}`, color: "#64748B" }));
const url = "/api/transactions/recommend-tags";

describe("transaction tag suggestions API", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.select.mockReturnValue({ from: () => ({ orderBy: async () => tags }) });
    mocks.config.mockResolvedValue({ apiKey: "test-key", model: "test-model", baseUrl: "https://provider.example/v1" });
    mocks.call.mockResolvedValue('{"tagIds":[2,999,2,1]}');
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate("authenticate", async (request: any, reply: any) => {
      if (request.headers.authorization !== "Bearer test") return reply.code(401).send({ error: "Unauthorized" });
    });
    await app.register(transactionsRoute);
  });
  afterEach(async () => { await app.close(); });

  function suggest(payload: Record<string, unknown> = { description: "Lunch with friends" }) {
    return app.inject({ method: "POST", url, headers: { authorization: "Bearer test" }, payload });
  }

  it("requires authentication before accessing tags or calling AI", async () => {
    const response = await app.inject({ method: "POST", url, payload: { description: "Lunch" } });
    expect(response.statusCode).toBe(401);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it.each([{ description: " " }, { description: "a" }, { description: "x".repeat(501) }, { description: "Lunch", notes: "x".repeat(5001) }])("validates transaction context before calling AI: %j", async payload => {
    expect((await suggest(payload)).statusCode).toBe(400);
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it("returns only existing tags, without selecting or creating anything", async () => {
    const response = await suggest();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ tags: [tags[1], tags[0]] });
    expect(mocks.select).toHaveBeenCalledTimes(1);
  });
  it("sends only current context and tag names when no category is selected", async () => {
    await suggest({ description: "  Lunch  ", notes: "with friends", place: "Campus", amount: 25000, history: "do not send" });
    const [system, prompt, key, model, baseUrl, options] = mocks.call.mock.calls[0];
    expect(system).toContain("Never invent tags");
    expect(JSON.parse(prompt)).toEqual({ existingTags: tags.map(({ id, name }) => ({ id, name })), transaction: { description: "Lunch", notes: "with friends", place: "Campus" } });
    expect([key, model, baseUrl]).toEqual(["test-key", "test-model", "https://provider.example/v1"]);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(mocks.select).toHaveBeenCalledTimes(1); // No historical transaction query.
  });
  it("does not call AI when there are no existing tags", async () => {
    mocks.select.mockReturnValue({ from: () => ({ orderBy: async () => [] }) });
    expect((await suggest()).json()).toEqual({ tags: [] });
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it("explains how to enable suggestions when the provider is unconfigured", async () => {
    mocks.config.mockResolvedValue({ apiKey: undefined });
    const response = await suggest();
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toContain("Settings");
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it("reports malformed provider output without returning a fabricated suggestion", async () => {
    mocks.call.mockResolvedValue("new tag");
    expect((await suggest()).statusCode).toBe(502);
  });
  it("reports provider failures without exposing upstream secrets", async () => {
    mocks.call.mockRejectedValue(new Error("secret upstream details"));
    const response = await suggest();
    expect(response.statusCode).toBe(502);
    expect(response.body).not.toContain("secret");
  });
  it("enforces the maximum of three recommendations", async () => {
    mocks.call.mockResolvedValue('{"tagIds":[4,3,2,1]}');
    expect((await suggest()).json()).toEqual({ tags: [tags[3], tags[2], tags[1]] });
  });
});
