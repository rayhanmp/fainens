import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { asc, desc, eq } from "drizzle-orm";

import { db } from "../db/client";
import { agentModels, agentProviderSettings } from "../db/schema";
import { env } from "../lib/env";

const SINGLETON_ID = 1;
const DEFAULT_MODEL = "z-ai/glm-5.3-flash";
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const MODEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,199}$/;

function encryptionKey(): Buffer {
  return createHash("sha256").update(env.SESSION_SECRET).digest();
}

function encryptApiKey(apiKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`;
}

function decryptApiKey(value: string): string | undefined {
  try {
    const [version, ivText, tagText, ciphertextText] = value.split(":");
    if (version !== "v1" || !ivText || !tagText || !ciphertextText) return undefined;
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return undefined;
  }
}

function validateModel(model: string): string {
  const normalized = model.trim();
  if (!MODEL_PATTERN.test(normalized)) throw new Error("Model must be a valid provider model id.");
  return normalized;
}

function validateBaseUrl(baseUrl: string): string {
  let parsed: URL;
  try { parsed = new URL(baseUrl.trim()); } catch { throw new Error("Base URL must be a valid HTTP(S) URL."); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Base URL must use HTTP or HTTPS.");
  if (parsed.username || parsed.password) throw new Error("Base URL cannot contain credentials.");
  return parsed.toString().replace(/\/$/, "");
}

export type AgentModel = {
  id: number;
  name: string;
  model: string;
  baseUrl: string;
  isDefault: boolean;
  apiKeyConfigured: boolean;
  apiKeySource: "database" | "environment" | "none";
  createdAt: Date;
  updatedAt: Date;
};

function publicModel(row: typeof agentModels.$inferSelect): AgentModel {
  const databaseKey = row.apiKeyCiphertext ? decryptApiKey(row.apiKeyCiphertext) : undefined;
  return {
    id: row.id,
    name: row.name,
    model: validateModel(row.model),
    baseUrl: validateBaseUrl(row.baseUrl),
    isDefault: row.isDefault,
    apiKeyConfigured: Boolean(databaseKey ?? env.OPENROUTER_API_KEY),
    apiKeySource: databaseKey ? "database" : env.OPENROUTER_API_KEY ? "environment" : "none",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type AgentProviderConfig = {
  id?: number;
  name?: string;
  model: string;
  baseUrl: string;
  apiKey: string | undefined;
  apiKeyConfigured: boolean;
  apiKeySource: "database" | "environment" | "none";
};

export async function getAgentProviderConfig(): Promise<AgentProviderConfig> {
  try {
    const [defaultRow] = await db.select().from(agentModels).where(eq(agentModels.isDefault, true)).orderBy(desc(agentModels.updatedAt)).limit(1);
    const row = defaultRow ?? (await db.select().from(agentModels).orderBy(desc(agentModels.updatedAt)).limit(1))[0];
    if (row) {
      const databaseKey = row.apiKeyCiphertext ? decryptApiKey(row.apiKeyCiphertext) : undefined;
      return {
        id: row.id,
        name: row.name,
        model: validateModel(row.model),
        baseUrl: validateBaseUrl(row.baseUrl),
        apiKey: databaseKey ?? env.OPENROUTER_API_KEY,
        apiKeyConfigured: Boolean(databaseKey ?? env.OPENROUTER_API_KEY),
        apiKeySource: databaseKey ? "database" : env.OPENROUTER_API_KEY ? "environment" : "none",
      };
    }
    const [legacyRow] = await db.select().from(agentProviderSettings).where(eq(agentProviderSettings.id, SINGLETON_ID)).limit(1);
    const databaseKey = legacyRow?.apiKeyCiphertext ? decryptApiKey(legacyRow.apiKeyCiphertext) : undefined;
    const apiKey = databaseKey ?? env.OPENROUTER_API_KEY;
    return {
      model: legacyRow?.model ? validateModel(legacyRow.model) : env.OPENROUTER_MODEL || DEFAULT_MODEL,
      baseUrl: DEFAULT_BASE_URL,
      apiKey,
      apiKeyConfigured: Boolean(apiKey),
      apiKeySource: databaseKey ? "database" : env.OPENROUTER_API_KEY ? "environment" : "none",
    };
  } catch {
    // Contract tests and pre-migration processes should retain the environment
    // fallback rather than failing unrelated agent requests.
    return {
      model: env.OPENROUTER_MODEL || DEFAULT_MODEL,
      baseUrl: DEFAULT_BASE_URL,
      apiKey: env.OPENROUTER_API_KEY,
      apiKeyConfigured: Boolean(env.OPENROUTER_API_KEY),
      apiKeySource: env.OPENROUTER_API_KEY ? "environment" : "none",
    };
  }
}

export async function updateAgentProviderConfig(input: { model?: string; apiKey?: string; clearApiKey?: boolean }) {
  const existingModel = input.model ? (await db.select().from(agentModels).where(eq(agentModels.model, validateModel(input.model))).limit(1))[0] : undefined;
  if (existingModel) {
    if (input.clearApiKey || input.apiKey?.trim()) await updateAgentModel(existingModel.id, { apiKey: input.apiKey, clearApiKey: input.clearApiKey });
    await setDefaultAgentModel(existingModel.id);
    return getAgentProviderConfig();
  }
  const model = input.model === undefined ? (await getAgentProviderConfig()).model : validateModel(input.model);
  const trimmedKey = input.apiKey?.trim();
  if (trimmedKey !== undefined && trimmedKey.length > 500) throw new Error("API key is too long.");

  const existing = (await db.select().from(agentProviderSettings).where(eq(agentProviderSettings.id, SINGLETON_ID)).limit(1))[0];
  let apiKeyCiphertext = existing?.apiKeyCiphertext ?? null;
  let apiKeyUpdatedAt = existing?.apiKeyUpdatedAt ?? null;
  if (input.clearApiKey) {
    apiKeyCiphertext = null;
    apiKeyUpdatedAt = new Date();
  } else if (trimmedKey) {
    apiKeyCiphertext = encryptApiKey(trimmedKey);
    apiKeyUpdatedAt = new Date();
  }

  await db.insert(agentProviderSettings).values({ id: SINGLETON_ID, model, apiKeyCiphertext, apiKeyUpdatedAt })
    .onConflictDoUpdate({ target: agentProviderSettings.id, set: { model, apiKeyCiphertext, apiKeyUpdatedAt } });
  return getAgentProviderConfig();
}

export async function listAgentModels(): Promise<AgentModel[]> {
  const rows = await db.select().from(agentModels).orderBy(desc(agentModels.isDefault), asc(agentModels.name));
  return rows.map(publicModel);
}

export async function createAgentModel(input: { name: string; model: string; baseUrl: string; apiKey?: string; isDefault?: boolean }): Promise<AgentModel> {
  const name = input.name.trim();
  if (!name || name.length > 120) throw new Error("Model name must be between 1 and 120 characters.");
  const model = validateModel(input.model);
  const baseUrl = validateBaseUrl(input.baseUrl);
  const key = input.apiKey?.trim();
  if (key && key.length > 500) throw new Error("API key is too long.");
  const existing = await db.select({ id: agentModels.id }).from(agentModels).limit(1);
  const isDefault = input.isDefault === true || existing.length === 0;
  const now = new Date();
  let created: typeof agentModels.$inferSelect;
  if (isDefault) await db.update(agentModels).set({ isDefault: false, updatedAt: now });
  [created] = await db.insert(agentModels).values({ name, model, baseUrl, apiKeyCiphertext: key ? encryptApiKey(key) : null, apiKeyUpdatedAt: key ? now : null, isDefault, createdAt: now, updatedAt: now }).returning();
  return publicModel(created);
}

export async function updateAgentModel(id: number, input: { name?: string; model?: string; baseUrl?: string; apiKey?: string; clearApiKey?: boolean }): Promise<AgentModel> {
  const existing = (await db.select().from(agentModels).where(eq(agentModels.id, id)).limit(1))[0];
  if (!existing) throw new Error("Agent model not found.");
  const name = input.name === undefined ? existing.name : input.name.trim();
  if (!name || name.length > 120) throw new Error("Model name must be between 1 and 120 characters.");
  const model = input.model === undefined ? existing.model : validateModel(input.model);
  const baseUrl = input.baseUrl === undefined ? existing.baseUrl : validateBaseUrl(input.baseUrl);
  let apiKeyCiphertext = existing.apiKeyCiphertext;
  let apiKeyUpdatedAt = existing.apiKeyUpdatedAt;
  const key = input.apiKey?.trim();
  if (input.clearApiKey) { apiKeyCiphertext = null; apiKeyUpdatedAt = new Date(); }
  else if (key) { if (key.length > 500) throw new Error("API key is too long."); apiKeyCiphertext = encryptApiKey(key); apiKeyUpdatedAt = new Date(); }
  const [updated] = await db.update(agentModels).set({ name, model, baseUrl, apiKeyCiphertext, apiKeyUpdatedAt, updatedAt: new Date() }).where(eq(agentModels.id, id)).returning();
  return publicModel(updated);
}

export async function setDefaultAgentModel(id: number): Promise<AgentModel> {
  const target = (await db.select().from(agentModels).where(eq(agentModels.id, id)).limit(1))[0];
  if (!target) throw new Error("Agent model not found.");
  const now = new Date();
  db.transaction((tx) => {
    tx.update(agentModels).set({ isDefault: false, updatedAt: now }).run();
    tx.update(agentModels).set({ isDefault: true, updatedAt: now }).where(eq(agentModels.id, id)).run();
  });
  return publicModel({ ...target, isDefault: true, updatedAt: now });
}

export async function deleteAgentModel(id: number): Promise<void> {
  const target = (await db.select().from(agentModels).where(eq(agentModels.id, id)).limit(1))[0];
  if (!target) throw new Error("Agent model not found.");
  const count = (await db.select({ id: agentModels.id }).from(agentModels)).length;
  if (count <= 1) throw new Error("Keep at least one Agent model configured.");
  await db.delete(agentModels).where(eq(agentModels.id, id));
  if (target.isDefault) {
    const next = (await db.select({ id: agentModels.id }).from(agentModels).orderBy(asc(agentModels.name)).limit(1))[0];
    if (next) await setDefaultAgentModel(next.id);
  }
}
