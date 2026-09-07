import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { createAgentModel, deleteAgentModel, getAgentProviderConfig, listAgentModels, setDefaultAgentModel, updateAgentModel, updateAgentProviderConfig } from "../services/agent-provider-config";

const responseSchema = z.object({
  id: z.number().int().optional(),
  name: z.string().optional(),
  model: z.string(),
  baseUrl: z.string(),
  apiKeyConfigured: z.boolean(),
  apiKeySource: z.enum(["database", "environment", "none"]),
}).passthrough();

const bodySchema = z.object({
  model: z.string().trim().min(1).max(200).optional(),
  apiKey: z.string().max(500).optional(),
  clearApiKey: z.boolean().optional(),
}).passthrough();

const modelResponseSchema = z.object({
  id: z.number().int(), name: z.string(), model: z.string(), baseUrl: z.string(), isDefault: z.boolean(),
  apiKeyConfigured: z.boolean(), apiKeySource: z.enum(["database", "environment", "none"]),
  createdAt: z.union([z.date(), z.string(), z.number()]), updatedAt: z.union([z.date(), z.string(), z.number()]),
}).passthrough();

const modelBodySchema = z.object({ name: z.string().trim().min(1).max(120), model: z.string().trim().min(2).max(200), baseUrl: z.string().trim().url().max(500), apiKey: z.string().max(500).optional(), isDefault: z.boolean().optional() }).passthrough();
const modelPatchSchema = modelBodySchema.partial().extend({ clearApiKey: z.boolean().optional() }).passthrough();

function publicConfig(config: Awaited<ReturnType<typeof getAgentProviderConfig>>) {
  return {
    id: config.id,
    name: config.name,
    model: config.model,
    baseUrl: config.baseUrl,
    apiKeyConfigured: config.apiKeyConfigured,
    apiKeySource: config.apiKeySource,
  };
}

export default async function agentProviderSettingsRoutes(fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/settings/agent-provider", {
    schema: { operationId: "getAgentProviderSettings", tags: ["agent"], response: { 200: responseSchema } },
  }, async () => responseSchema.parse(publicConfig(await getAgentProviderConfig())));

  fastify.put("/api/settings/agent-provider", {
    schema: { operationId: "updateAgentProviderSettings", tags: ["agent"], body: bodySchema, response: { 200: responseSchema, 400: z.object({ error: z.string() }).passthrough() } },
  }, async (request, reply) => {
    try {
      const result = await updateAgentProviderConfig(bodySchema.parse(request.body));
      return reply.send(responseSchema.parse(publicConfig(result)));
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not update agent provider settings" });
    }
  });

  fastify.post("/api/settings/agent-provider/test", {
    schema: { operationId: "testAgentProviderSettings", tags: ["agent"], response: { 200: z.object({ ok: z.literal(true), model: z.string(), modelAvailable: z.boolean().nullable() }).passthrough(), 400: z.object({ error: z.string() }).passthrough(), 502: z.object({ error: z.string() }).passthrough() } },
  }, async (request, reply) => {
    const config = await getAgentProviderConfig();
    if (!config.apiKey) return reply.code(400).send({ error: "No API key is configured. Add one or set the server environment key before testing the provider." });
    try {
      const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/models`, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
        signal: request.raw.signal,
      });
      if (!response.ok) return reply.code(502).send({ error: "The configured provider rejected the API key or models request." });
      const payload = await response.json() as { data?: Array<{ id?: string }> };
      const modelAvailable = Array.isArray(payload.data) ? payload.data.some((model) => model.id === config.model) : null;
      return reply.send({ ok: true as const, model: config.model, modelAvailable });
    } catch {
      return reply.code(502).send({ error: "Could not reach the configured provider. Try again shortly." });
    }
  });

  fastify.get("/api/settings/agent-models", {
    schema: { operationId: "listAgentModels", tags: ["agent"], response: { 200: z.array(modelResponseSchema) } },
  }, async () => (await listAgentModels()).map((model) => modelResponseSchema.parse(model)));

  fastify.post("/api/settings/agent-models", {
    schema: { operationId: "createAgentModel", tags: ["agent"], body: modelBodySchema, response: { 201: modelResponseSchema, 400: z.object({ error: z.string() }).passthrough() } },
  }, async (request, reply) => {
    try { return reply.code(201).send(modelResponseSchema.parse(await createAgentModel(modelBodySchema.parse(request.body)))); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not create Agent model" }); }
  });

  fastify.patch("/api/settings/agent-models/:id", {
    schema: { operationId: "updateAgentModel", tags: ["agent"], body: modelPatchSchema, response: { 200: modelResponseSchema, 400: z.object({ error: z.string() }).passthrough() } },
  }, async (request, reply) => {
    try {
      const id = Number((request.params as { id: string }).id);
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid model ID");
      return reply.send(modelResponseSchema.parse(await updateAgentModel(id, modelPatchSchema.parse(request.body))));
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not update Agent model" }); }
  });

  fastify.post("/api/settings/agent-models/:id/default", {
    schema: { operationId: "setDefaultAgentModel", tags: ["agent"], response: { 200: modelResponseSchema, 400: z.object({ error: z.string() }).passthrough() } },
  }, async (request, reply) => {
    try {
      const id = Number((request.params as { id: string }).id);
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid model ID");
      return reply.send(modelResponseSchema.parse(await setDefaultAgentModel(id)));
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not set default Agent model" }); }
  });

  fastify.delete("/api/settings/agent-models/:id", {
    schema: { operationId: "deleteAgentModel", tags: ["agent"], response: { 204: z.null(), 400: z.object({ error: z.string() }).passthrough() } },
  }, async (request, reply) => {
    try {
      const id = Number((request.params as { id: string }).id);
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid model ID");
      await deleteAgentModel(id);
      return reply.code(204).send();
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not delete Agent model" }); }
  });
}
