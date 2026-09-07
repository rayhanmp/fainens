import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, ne } from "drizzle-orm";
import { z } from "zod";
import { createReadStream } from "fs";
import { promises as fs } from "fs";
import { randomUUID } from "node:crypto";

import { db } from "../db/client";
import { accounts, agentApprovals, agentConversations, agentConversationInsights, agentMemories, agentMessageAttachments, agentMessages, agentPendingActions, agentProfiles, storageDeletionOutbox } from "../db/schema";
import {
  agentToolDefinitions,
  executeAgentTool,
  getFinancialFactsTool,
  getAccountBalancesTool,
  getBudgetFactsTool,
  getDueRecurringTool,
  getSalaryCatchUpTool,
  getLoanBalancesTool,
  getPaylaterObligationsTool,
  parseAgentScopeInput,
  resolveAgentScope,
  type AgentToolExecutionContext,
} from "../services/agent-tools";
import { callOpenRouterAgent, streamOpenRouterAgent, type AgentChatContentPart, type AgentChatMessage, type AgentChatResponse, type AgentChatTool } from "../services/agent-llm";
import { buildAgentSystemPrompt } from "../services/agent-prompt";
import { presentationTools, type AgentPresentation } from "../services/agent-presentations";
import {
  agentToolGroups,
} from "../services/agent-tool-routing";
import {
  agentModelToolMap,
  agentReadToolNames,
  agentToolCatalog,
  ModelToolInputValidationError,
  modelPresentationToolNames,
  modelToolsForNames,
  projectModelToolResult,
  validateModelToolInput,
} from "../services/agent-model-tools";
import {
  AGENT_EVIDENCE_HARD_CHARS,
  compactToolTranscript,
  evidenceStateSize,
  normalizeEvidenceKey,
  releaseEvidence,
  type ModelEvidence,
} from "../services/agent-evidence";
import { getFinancialRevision } from "../services/financial-revision";
import { getAgentProviderConfig } from "../services/agent-provider-config";
import { createBackgroundTask } from "../services/background-tasks";
import { processStorageDeletionOutbox } from "../services/storage-cleanup";
import { deleteFile, downloadFile, generateAgentAttachmentKey, generatePresignedDownloadUrl, getLocalFilePath, isObjectStorageConfigured, uploadFile } from "../services/r2";
import {
  AgentActionError,
  executeAgentApproval,
  listAgentActions,
  prepareAgentAction,
  reissueAgentApproval,
  rejectAgentApproval,
} from "../services/agent-actions";

const MAX_TOOL_CALLS_PER_QUERY = 30;
// A model may make dependent calls one at a time, so rounds must not reduce
// the advertised 30-call budget below that number.
const MAX_TOOL_ROUNDS = 30;
const HISTORY_RECENT_MESSAGE_LIMIT = 6;
const HISTORY_SUMMARY_MAX_CHARS = 1_600;
const MAX_PRESENTATIONS_PER_RESPONSE = 2;
const MAX_SINGLE_MODEL_EVIDENCE_CHARS = 32_000;
const MAX_AGENT_IMAGE_COUNT = 3;
const MAX_AGENT_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_AGENT_IMAGE_TOTAL_BYTES = 8 * 1024 * 1024;
const AGENT_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_AGENT_MEMORIES = 50;
const MAX_AGENT_MEMORY_LABEL_LENGTH = 80;
const MAX_AGENT_MEMORY_CONTENT_LENGTH = 1000;
const MAX_AGENT_NICKNAME_LENGTH = 80;

const agentErrorSchema = z.object({ error: z.string() }).passthrough();
const agentMessageAttachmentSchema = z.object({ id: z.number().int(), filename: z.string(), mimetype: z.string(), fileSize: z.number().int(), downloadUrl: z.string() }).passthrough();
const agentProfileSchema = z.object({ nickname: z.string().nullable() }).passthrough();
const agentMemorySchema = z.object({ id: z.number().int(), label: z.string(), content: z.string(), createdAt: z.number(), updatedAt: z.number() }).passthrough();
const agentMemoryLimitsSchema = z.object({ maxItems: z.number().int(), maxLabelLength: z.number().int(), maxContentLength: z.number().int() }).passthrough();
const agentUsageSchema = z.object({ promptTokens: z.number().int().nonnegative(), completionTokens: z.number().int().nonnegative(), totalTokens: z.number().int().nonnegative(), estimatedCostUsd: z.number().nonnegative().nullable(), calls: z.number().int().positive() }).passthrough();
const agentConversationSchema = z.object({ id: z.number().int(), title: z.string(), titleSource: z.enum(["auto", "manual"]), createdAt: z.number(), updatedAt: z.number(), isPinned: z.boolean(), archivedAt: z.number().nullable(), usage: agentUsageSchema.optional() }).passthrough();
const agentMessageSchema = z.object({ id: z.number().int(), role: z.enum(["user", "assistant"]), content: z.string(), response: z.unknown().optional(), usage: agentUsageSchema.optional(), attachments: z.array(agentMessageAttachmentSchema).optional(), createdAt: z.number() }).passthrough();
const agentConversationListSchema = z.object({ conversations: z.array(agentConversationSchema), includeArchived: z.boolean(), dailyUsage: agentUsageSchema.nullable() }).passthrough();
const agentConversationDetailSchema = z.object({ conversation: agentConversationSchema, messages: z.array(agentMessageSchema) }).passthrough();
const agentActionIdParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const agentActionKindSchema = z.enum(["budget_plan_upsert", "transaction_journal_create"]);
const agentActionViewSchema = z.object({
  pendingActionId: z.number().int(), approvalId: z.number().int(), kind: agentActionKindSchema, status: z.string(), input: z.unknown(),
  assumptions: z.array(z.string()), missingFields: z.array(z.string()), details: z.unknown(), baseFinancialRevision: z.number().int(),
  createdAt: z.number(), expiresAt: z.number(), approvalToken: z.string().nullable().optional(), tokenAlreadyIssued: z.boolean(),
}).passthrough();
const agentActionListItemSchema = agentActionViewSchema.omit({ details: true, approvalToken: true, tokenAlreadyIssued: true }).extend({ conversationId: z.number().int().nullable() }).passthrough();
const agentQueryResponseSchema = z.object({
  answer: z.string().nullable().optional(), llmAvailable: z.boolean(), context: z.unknown().nullable().optional(), scope: z.unknown().optional(), revision: z.number().int().optional(),
  conversationId: z.number().int().nullable().optional(), userMessageId: z.number().int().nullable().optional(), toolCalls: z.array(z.unknown()), toolResults: z.array(z.unknown()),
  pendingActions: z.array(z.unknown()).optional(), clarifications: z.array(z.unknown()).optional(), presentations: z.array(z.unknown()).optional(), message: z.string().optional(),
  usage: agentUsageSchema.optional(),
}).passthrough();
const agentActionPrepareBodySchema = z.object({
  conversationId: z.number().int().positive().nullable().optional(), kind: agentActionKindSchema, input: z.unknown(),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(20).optional(), missingFields: z.array(z.string().trim().min(1).max(500)).max(20).optional(), idempotencyKey: z.string().trim().min(8).max(200).optional(),
}).passthrough();
const agentQueryBodySchema = z.object({
  question: z.string().trim().min(2).max(2000), periodId: z.union([z.string(), z.number()]).optional(), startDate: z.union([z.string(), z.number()]).optional(), endDate: z.union([z.string(), z.number()]).optional(),
  conversationId: z.union([z.string(), z.number()]).optional(), replaceMessageId: z.union([z.string(), z.number()]).optional(),
  images: z.array(z.object({ filename: z.string(), mimeType: z.string(), data: z.string() }).passthrough()).max(MAX_AGENT_IMAGE_COUNT).optional(),
}).passthrough();
const agentApprovalBodySchema = z.object({ token: z.string().min(20).max(200) }).passthrough();
const agentStatusSchema = z.object({ status: z.string(), approvalId: z.number().int().optional(), receipt: z.unknown().optional(), replay: z.boolean().optional(), restored: z.boolean().optional(), approval: z.unknown().optional(), action: z.unknown().optional() }).passthrough();
const agentBudgetPlanBodySchema = z.object({
  periodId: z.union([z.string(), z.number()]).optional(),
  targetSavingsRate: z.union([z.string(), z.number()]).optional(),
}).passthrough();
const agentBudgetPlanResponseSchema = z.object({
  revision: z.number().int(), period: z.unknown(), targetSavingsRate: z.number(), incomeCents: z.number().int(), targetSpendCents: z.number().int(),
  recommendations: z.array(z.object({ categoryId: z.number().int().nullable(), category: z.string(), suggestedAmountCents: z.number().int(), basis: z.string() }).passthrough()),
  requiresConfirmation: z.boolean(), writesPerformed: z.boolean(),
}).passthrough();
type AgentRouteErrorStatus = 400 | 401 | 404 | 409 | 410 | 500;
function agentRouteErrorStatus(status: number): AgentRouteErrorStatus {
  return status === 400 || status === 401 || status === 404 || status === 409 || status === 410 || status === 500 ? status : 500;
}


type AgentClarificationChoice = {
  id: string;
  label: string;
  description?: string;
  freeText?: boolean;
};

type AgentClarification = {
  id: string;
  question: string;
  choices: AgentClarificationChoice[];
};

/**
 * This is deliberately a model tool rather than a convention hidden in
 * prose. The client can render a reliable decision card and the user's click
 * becomes an ordinary follow-up turn in the same conversation.
 */
const clarificationTool: AgentChatTool = {
  type: "function",
  function: {
    name: "ask_clarification",
    description: "Ask one focused question when two or more materially different interpretations are genuinely plausible. Provide 2-4 concise choices. Use a choice with freeText=true for Neither/Other when the user may need to type their own option. Do not use this for casual conversation, obvious defaults, or facts that a read-only tool can retrieve.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["question", "choices"],
      properties: {
        id: { type: "string", description: "Stable short identifier for this question; optional in practice." },
        question: { type: "string", minLength: 1, maxLength: 400 },
        choices: {
          type: "array",
          minItems: 2,
          maxItems: 4,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "label"],
            properties: {
              id: { type: "string", minLength: 1, maxLength: 40 },
              label: { type: "string", minLength: 1, maxLength: 80 },
              description: { type: "string", maxLength: 160 },
              freeText: { type: "boolean" },
            },
          },
        },
      },
    },
  },
};

const loadToolSchemasTool: AgentChatTool = {
  type: "function",
  function: {
    name: "load_tool_schemas",
    description: "Load the exact schemas for the capability names you need. The catalog is metadata only. Loaded schemas are available for the next assistant turn and then expire.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["names"],
      properties: {
        names: { type: "array", minItems: 1, maxItems: 12, items: { type: "string", minLength: 1, maxLength: 80 } },
      },
    },
  },
};

/**
 * Read tools are safe to dispatch through one small, stable provider schema.
 * This removes the otherwise mandatory discovery round for ordinary lookups,
 * while the backend still validates the selected tool's canonical schema.
 */
const invokeReadTool: AgentChatTool = {
  type: "function",
  function: {
    name: "invoke_read_tool",
    description: "Run one catalogued read with backend validation.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["name", "arguments"],
      properties: {
        name: { type: "string", minLength: 1, maxLength: 80 },
        arguments: { type: "object", additionalProperties: true },
      },
    },
  },
};

const invokeReadTools: AgentChatTool = {
  type: "function",
  function: {
    name: "invoke_read_tools",
    description: "Run 2-4 independent reads concurrently with unique keys; no sibling dependencies.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["calls"],
      properties: {
        calls: {
          type: "array", minItems: 2, maxItems: 4,
          items: {
            type: "object", additionalProperties: false, required: ["key", "name", "arguments"],
            properties: {
              key: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_-]{0,39}$" },
              name: { type: "string", minLength: 1, maxLength: 80 },
              arguments: { type: "object", additionalProperties: true },
            },
          },
        },
      },
    },
  },
};

const updateContextTool: AgentChatTool = {
  type: "function",
  function: {
    name: "update_context",
    description: "Retain a concise non-obvious insight with evidence IDs, or release evidence you no longer need. Evidence IDs must come from the current run.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        retainInsights: {
          type: "array", maxItems: 3,
          items: {
            type: "object", additionalProperties: false, required: ["claim", "evidenceIds"],
            properties: { claim: { type: "string", minLength: 1, maxLength: 400 }, evidenceIds: { type: "array", minItems: 1, maxItems: 12, items: { type: "string", minLength: 1, maxLength: 100 } } },
          },
        },
        releaseEvidenceIds: { type: "array", maxItems: 100, items: { type: "string", minLength: 1, maxLength: 100 } },
      },
    },
  },
};

const runtimeTools: AgentChatTool[] = [clarificationTool, invokeReadTool, invokeReadTools, loadToolSchemasTool, updateContextTool];

export function getAgentProviderSchemaMetrics() {
  return {
    runtimeSchemaSize: JSON.stringify(runtimeTools.map((tool) => tool.function)).length,
    catalogSize: JSON.stringify(agentToolCatalog).length,
  };
}

function modelToolsForLease(names: Iterable<string>): AgentChatTool[] {
  return [...runtimeTools, ...modelToolsForNames(names)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestampMs(value: unknown): number {
  return value instanceof Date ? value.getTime() : Number(value);
}

type AgentUsageSummary = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  calls: number;
};

type AgentUsageAccumulator = AgentUsageSummary & {
  hasProviderUsage: boolean;
  allCallsPriced: boolean;
  costUsd: number;
};

function newAgentUsageAccumulator(): AgentUsageAccumulator {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: null, calls: 0, hasProviderUsage: false, allCallsPriced: true, costUsd: 0 };
}

function nonNegativeInteger(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

function addProviderUsage(accumulator: AgentUsageAccumulator, usage: AgentChatResponse["usage"] | undefined): void {
  if (!usage) return;
  const promptTokens = nonNegativeInteger(usage.prompt_tokens);
  const completionTokens = nonNegativeInteger(usage.completion_tokens);
  const totalTokens = usage.total_tokens == null
    ? promptTokens + completionTokens
    : nonNegativeInteger(usage.total_tokens);
  accumulator.promptTokens += promptTokens;
  accumulator.completionTokens += completionTokens;
  accumulator.totalTokens += totalTokens;
  accumulator.calls += 1;
  accumulator.hasProviderUsage = true;
  const cost = Number(usage.cost);
  if (Number.isFinite(cost) && cost >= 0) accumulator.costUsd += cost;
  else accumulator.allCallsPriced = false;
}

function addStoredUsage(accumulator: AgentUsageAccumulator, row: { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null; estimatedCostUsd: number | null }): void {
  if (row.promptTokens == null && row.completionTokens == null && row.totalTokens == null) return;
  accumulator.promptTokens += nonNegativeInteger(row.promptTokens);
  accumulator.completionTokens += nonNegativeInteger(row.completionTokens);
  accumulator.totalTokens += nonNegativeInteger(row.totalTokens ?? (row.promptTokens ?? 0) + (row.completionTokens ?? 0));
  accumulator.calls += 1;
  accumulator.hasProviderUsage = true;
  if (row.estimatedCostUsd == null) accumulator.allCallsPriced = false;
  else accumulator.costUsd += nonNegativeInteger(row.estimatedCostUsd * 100_000_000) / 100_000_000;
}

function finishAgentUsage(accumulator: AgentUsageAccumulator): AgentUsageSummary | undefined {
  if (!accumulator.hasProviderUsage || accumulator.calls === 0) return undefined;
  return {
    promptTokens: accumulator.promptTokens,
    completionTokens: accumulator.completionTokens,
    totalTokens: accumulator.totalTokens,
    estimatedCostUsd: accumulator.allCallsPriced ? Math.round(accumulator.costUsd * 100_000_000) / 100_000_000 : null,
    calls: accumulator.calls,
  };
}

function currentOwnerEmail(request: { user?: unknown }): string {
  const email = isRecord(request.user) ? request.user.email : undefined;
  if (typeof email !== "string" || email.trim() === "") {
    throw new Error("Authenticated user email is unavailable");
  }
  return email;
}

function conversationSummary(row: typeof agentConversations.$inferSelect, usage?: AgentUsageSummary) {
  return {
    id: row.id,
    title: row.title,
    titleSource: row.titleSource,
    createdAt: timestampMs(row.createdAt),
    updatedAt: timestampMs(row.updatedAt),
    isPinned: Boolean(row.isPinned),
    archivedAt: row.archivedAt == null ? null : timestampMs(row.archivedAt),
    ...(usage ? { usage } : {}),
  };
}

function parseStoredResponse(value: string | null): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

type AgentMessageAttachmentView = {
  id: number;
  filename: string;
  mimetype: string;
  fileSize: number;
  downloadUrl: string;
};

function conversationMessage(row: typeof agentMessages.$inferSelect, attachments: AgentMessageAttachmentView[] = []) {
  const usage = finishAgentUsage((() => {
    const accumulator = newAgentUsageAccumulator();
    addStoredUsage(accumulator, row);
    return accumulator;
  })());
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    response: parseStoredResponse(row.responseJson),
    ...(usage ? { usage } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    createdAt: timestampMs(row.createdAt),
  };
}

async function retainAgentImageAttachments(
  conversationId: number,
  messageId: number,
  images: AgentImageAttachment[],
): Promise<void> {
  const uploadedKeys: string[] = [];
  try {
    const records = [];
    for (const image of images) {
      const key = generateAgentAttachmentKey(conversationId, messageId, image.filename);
      const base64 = image.dataUrl.slice(image.dataUrl.indexOf(",") + 1);
      await uploadFile(key, Buffer.from(base64, "base64"), image.mimeType);
      uploadedKeys.push(key);
      records.push({
        messageId,
        conversationId,
        filename: image.filename,
        mimetype: image.mimeType,
        r2Key: key,
        fileSize: image.byteSize,
      });
    }
    if (records.length > 0) db.insert(agentMessageAttachments).values(records).run();
  } catch (error) {
    await Promise.all(uploadedKeys.map(async (key) => {
      try {
        await deleteFile(key);
      } catch {
        // Keep the original upload/metadata error as the request failure.
      }
    }));
    throw error;
  }
}

function referencesStoredImage(question: string): boolean {
  return /\b(image|photo|picture|receipt|screenshot|attachment|gambar|foto|struk)\b/i.test(question);
}

async function rehydrateRecentAgentImages(conversationId: number): Promise<AgentImageAttachment[]> {
  const attachments = await db.select({
    filename: agentMessageAttachments.filename,
    mimeType: agentMessageAttachments.mimetype,
    r2Key: agentMessageAttachments.r2Key,
    byteSize: agentMessageAttachments.fileSize,
  }).from(agentMessageAttachments)
    .where(eq(agentMessageAttachments.conversationId, conversationId))
    .orderBy(desc(agentMessageAttachments.id))
    .limit(MAX_AGENT_IMAGE_COUNT);
  const images: AgentImageAttachment[] = [];
  let totalBytes = 0;
  for (const attachment of attachments.reverse()) {
    if (!AGENT_IMAGE_MIME_TYPES.has(attachment.mimeType) || attachment.byteSize <= 0 || attachment.byteSize > MAX_AGENT_IMAGE_BYTES) continue;
    if (totalBytes + attachment.byteSize > MAX_AGENT_IMAGE_TOTAL_BYTES) continue;
    try {
      const buffer = await downloadFile(attachment.r2Key);
      if (buffer.length === 0 || buffer.length > MAX_AGENT_IMAGE_BYTES) continue;
      totalBytes += buffer.length;
      images.push({ filename: attachment.filename, mimeType: attachment.mimeType, byteSize: buffer.length, dataUrl: `data:${attachment.mimeType};base64,${buffer.toString("base64")}` });
    } catch {
      // A missing retained image should not make an otherwise valid follow-up
      // fail; the model will answer from text context and disclose uncertainty.
    }
  }
  return images;
}

function conversationTitle(question: string): string {
  const compact = question.replace(/\s+/g, " ").trim();
  return compact.length > 72 ? `${compact.slice(0, 69)}…` : compact || "New conversation";
}

type AgentMemoryContext = { label: string; content: string };

function memoryResponse(row: typeof agentMemories.$inferSelect) {
  return {
    id: row.id,
    label: row.label,
    content: row.content,
    createdAt: timestampMs(row.createdAt),
    updatedAt: timestampMs(row.updatedAt),
  };
}

function parseMemoryField(value: unknown, field: "label" | "content", maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${field} is required`);
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${field} must not be empty`);
  if (trimmed.length > maxLength) throw new Error(`${field} must be at most ${maxLength} characters`);
  return trimmed;
}

function parseNickname(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new Error("nickname must be a string");
  // A nickname is user-provided display data, not an instruction. Strip
  // control characters and keep it short before it can enter a prompt.
  const normalized = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, "").trim();
  if (normalized.length > MAX_AGENT_NICKNAME_LENGTH) {
    throw new Error(`nickname must be at most ${MAX_AGENT_NICKNAME_LENGTH} characters`);
  }
  return normalized || null;
}

async function ownerMemories(ownerEmail: string): Promise<AgentMemoryContext[]> {
  return db
    .select({ label: agentMemories.label, content: agentMemories.content })
    .from(agentMemories)
    .where(eq(agentMemories.ownerEmail, ownerEmail))
    .orderBy(asc(agentMemories.id))
    .limit(MAX_AGENT_MEMORIES);
}

async function ownerNickname(ownerEmail: string): Promise<string | null> {
  const [profile] = await db
    .select({ nickname: agentProfiles.nickname })
    .from(agentProfiles)
    .where(eq(agentProfiles.ownerEmail, ownerEmail))
    .limit(1);
  return parseNickname(profile?.nickname);
}

/**
 * Tiny routing reference for the model. Account values remain tool-only; the
 * prompt receives names solely so it can make an exact, targeted lookup.
 */
async function activeAccountNamesForAgent(): Promise<string[]> {
  const rows = await db.select({ name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.isActive, true), isNull(accounts.systemKey)))
    .orderBy(asc(accounts.sortOrder), asc(accounts.name));
  return rows.map((row) => row.name).filter((name): name is string => typeof name === "string" && name.trim() !== "");
}

async function ownedConversation(conversationId: number, ownerEmail: string) {
  const [conversation] = await db
    .select()
    .from(agentConversations)
    .where(and(eq(agentConversations.id, conversationId), eq(agentConversations.ownerEmail, ownerEmail)))
    .limit(1);
  return conversation;
}

async function conversationInsightPrompt(conversationId: number, revision: number, question: string): Promise<string[]> {
  await db.update(agentConversationInsights)
    .set({ status: "stale", updatedAt: new Date() })
    .where(and(eq(agentConversationInsights.conversationId, conversationId), eq(agentConversationInsights.status, "active"), ne(agentConversationInsights.financialRevision, revision)));
  const rows = await db.select({ claim: agentConversationInsights.claim })
    .from(agentConversationInsights)
    .where(and(eq(agentConversationInsights.conversationId, conversationId), eq(agentConversationInsights.status, "active"), eq(agentConversationInsights.financialRevision, revision)))
    .orderBy(desc(agentConversationInsights.updatedAt))
    .limit(12);
  const tokens = new Set(question.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3));
  const applicable = rows.filter((row) => {
    if (tokens.size === 0) return true;
    const claimTokens = row.claim.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
    return claimTokens.some((token) => tokens.has(token));
  });
  return (applicable.length > 0 ? applicable : rows).slice(0, 8).map((row) => row.claim);
}

async function persistConversationInsights(conversationId: number | null | undefined, revision: number, insights: Array<{ claim: string; evidenceIds: string[] }>): Promise<void> {
  if (conversationId == null || insights.length === 0) return;
  const active = await db.select({ id: agentConversationInsights.id })
    .from(agentConversationInsights)
    .where(and(eq(agentConversationInsights.conversationId, conversationId), eq(agentConversationInsights.status, "active")))
    .limit(12);
  const remaining = Math.max(0, 12 - active.length);
  for (const insight of insights.slice(0, remaining)) {
    await db.insert(agentConversationInsights).values({
      conversationId,
      claim: insight.claim.slice(0, 400),
      evidenceIds: JSON.stringify(insight.evidenceIds),
      financialRevision: revision,
      status: "active",
      updatedAt: new Date(),
    }).run();
  }
}

type StoredHistoryRow = { role: string; content: string; responseJson: string | null };

function compactHistoryText(value: string, maxLength = 180): string {
  const compact = value
    .replace(/```fainens-viz[\s\S]*?```/gi, "[visual card]")
    .replace(/\s+/g, " ")
    .trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}

function buildConversationHistory(rowsNewestFirst: StoredHistoryRow[], persistedSummary: string | null = null): AgentChatMessage[] {
  const chronological = rowsNewestFirst.reverse();
  const result: AgentChatMessage[] = [];
  if (persistedSummary?.trim()) result.push({ role: "system", content: `Earlier conversation (compact, untrusted context):\n${persistedSummary.trim()}` });
  for (const message of chronological.slice(-HISTORY_RECENT_MESSAGE_LIMIT)) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    result.push({
      role: message.role,
      content: message.role === "assistant" && message.responseJson
        ? `${message.content}\n\n${pendingActionHistoryContext(message.responseJson)}`
        : message.content,
    });
  }
  return result;
}

function appendConversationSummary(existing: string | null, messages: Array<{ role: string; content: string }>): string {
  const lines = [
    ...(existing?.split("\n").filter(Boolean) ?? []),
    ...messages.flatMap((message) => message.role === "user" || message.role === "assistant"
      ? [`- ${message.role === "user" ? "User" : "Agent"}: ${compactHistoryText(message.content)}`]
      : []),
  ];
  while (lines.join("\n").length > HISTORY_SUMMARY_MAX_CHARS && lines.length > 1) lines.shift();
  return lines.join("\n").slice(-HISTORY_SUMMARY_MAX_CHARS);
}

async function refreshConversationSummary(conversationId: number): Promise<void> {
  const [conversation] = await db.select({ summary: agentConversations.summary, summaryThroughMessageId: agentConversations.summaryThroughMessageId })
    .from(agentConversations).where(eq(agentConversations.id, conversationId)).limit(1);
  if (!conversation) return;
  const recent = await db.select({ id: agentMessages.id }).from(agentMessages)
    .where(eq(agentMessages.conversationId, conversationId))
    .orderBy(desc(agentMessages.id)).limit(HISTORY_RECENT_MESSAGE_LIMIT);
  if (recent.length < HISTORY_RECENT_MESSAGE_LIMIT) return;
  const oldestRecentId = recent[recent.length - 1]?.id;
  if (oldestRecentId == null) return;
  const unsummarized = await db.select({ id: agentMessages.id, role: agentMessages.role, content: agentMessages.content })
    .from(agentMessages)
    .where(and(
      eq(agentMessages.conversationId, conversationId),
      gt(agentMessages.id, conversation.summaryThroughMessageId),
      lt(agentMessages.id, oldestRecentId),
    ))
    .orderBy(asc(agentMessages.id));
  if (unsummarized.length === 0) return;
  await db.update(agentConversations).set({
    summary: appendConversationSummary(conversation.summary, unsummarized),
    summaryThroughMessageId: unsummarized[unsummarized.length - 1]?.id ?? conversation.summaryThroughMessageId,
  }).where(eq(agentConversations.id, conversationId));
}

async function conversationHistory(conversationId: number): Promise<AgentChatMessage[]> {
  await refreshConversationSummary(conversationId);
  const [newestFirst, conversationRows] = await Promise.all([db
    .select({ role: agentMessages.role, content: agentMessages.content, responseJson: agentMessages.responseJson })
    .from(agentMessages)
    .where(eq(agentMessages.conversationId, conversationId))
    .orderBy(desc(agentMessages.createdAt), desc(agentMessages.id))
    .limit(HISTORY_RECENT_MESSAGE_LIMIT), db.select({ summary: agentConversations.summary }).from(agentConversations).where(eq(agentConversations.id, conversationId)).limit(1)]);
  return buildConversationHistory(newestFirst, conversationRows[0]?.summary ?? null);
}

/** History before a saved user turn, used when that turn is edited or retried. */
async function conversationHistoryBefore(conversationId: number, messageId: number): Promise<AgentChatMessage[]> {
  await refreshConversationSummary(conversationId);
  const [newestFirst, conversationRows] = await Promise.all([db
    .select({ role: agentMessages.role, content: agentMessages.content, responseJson: agentMessages.responseJson })
    .from(agentMessages)
    .where(and(eq(agentMessages.conversationId, conversationId), lt(agentMessages.id, messageId)))
    .orderBy(desc(agentMessages.createdAt), desc(agentMessages.id))
    .limit(HISTORY_RECENT_MESSAGE_LIMIT), db.select({ summary: agentConversations.summary }).from(agentConversations).where(eq(agentConversations.id, conversationId)).limit(1)]);
  return buildConversationHistory(newestFirst, conversationRows[0]?.summary ?? null);
}

/** Keep enough proposal context for a follow-up such as “change that to
 * Tuesday and groceries”, without ever putting the bearer approval token in
 * the model history. */
function pendingActionHistoryContext(responseJson: string): string {
  try {
    const parsed = redactApprovalTokens(JSON.parse(responseJson));
    if (!isRecord(parsed)) return "";
    const context: string[] = [];
    if (Array.isArray(parsed.clarifications) && parsed.clarifications.length > 0) {
      context.push(`[PENDING CLARIFICATION — the user may answer this next]\n${safeToolResult(parsed.clarifications).slice(0, 3_000)}`);
    }
    if (Array.isArray(parsed.pendingActions) && parsed.pendingActions.length > 0) {
      const proposals = parsed.pendingActions.filter((item) => isRecord(item) && item.kind === "transaction_journal_create");
      if (proposals.length > 0) context.push(`[PENDING TRANSACTION PROPOSALS — not posted; use when the user asks to edit them]\n${safeToolResult(proposals).slice(0, 12_000)}`);
    }
    return context.join("\n\n");
  } catch {
    return "";
  }
}

/**
 * Compatibility context endpoint composed from the same modular read tools
 * exposed to the model. New consumers should call /api/agent/tools and
 * /api/agent/tool-call instead of relying on one opaque context payload.
 */
async function composeContext(scopeInput: ReturnType<typeof parseAgentScopeInput>) {
  const resolved = await resolveAgentScope(scopeInput);
  const asOfDate = Math.min(Date.now(), resolved.endMs);
  const calls = await Promise.all([
    executeAgentTool("get_financial_facts", scopeInput),
    executeAgentTool("get_account_balances", { asOfDate }),
    executeAgentTool("get_loan_balances", { status: "active" }),
    executeAgentTool("get_paylater_obligations", {}),
    executeAgentTool("get_due_recurring", { asOfDate: Date.now() }),
    resolved.periodId == null
      ? Promise.resolve(null)
      : executeAgentTool("get_budget_facts", { periodId: resolved.periodId }),
    executeAgentTool("get_salary_catch_up", {}),
  ]);
  const revisions = calls.filter((call): call is NonNullable<typeof call> => call != null).map((call) => call.revision);
  const revision = revisions.length > 0 ? Math.max(...revisions) : await getFinancialRevision();
  const consistent = revisions.every((value) => value === revisions[0]);
  const factsResult = calls[0]?.data as Awaited<ReturnType<typeof getFinancialFactsTool>>;
  const accountResult = calls[1]?.data as Awaited<ReturnType<typeof getAccountBalancesTool>>;
  const loanResult = calls[2]?.data as Awaited<ReturnType<typeof getLoanBalancesTool>>;
  const paylaterResult = calls[3]?.data as Awaited<ReturnType<typeof getPaylaterObligationsTool>>;
  const recurringResult = calls[4]?.data as Awaited<ReturnType<typeof getDueRecurringTool>>;
  const budgetResult = calls[5]?.data as Awaited<ReturnType<typeof getBudgetFactsTool>> | undefined;
  const salaryCatchUpResult = calls[6]?.data as Awaited<ReturnType<typeof getSalaryCatchUpTool>>;
  return {
    schemaVersion: 4,
    revision,
    consistent,
    scope: factsResult.scope,
    facts: factsResult.facts,
    budgets: budgetResult?.budgets ?? [],
    accounts: accountResult.accounts,
    activeLoans: loanResult.loans,
    recurring: {
      dueSubscriptionOccurrences: recurringResult.occurrences,
      truncated: recurringResult.truncated,
      asOfMs: recurringResult.asOfMs,
    },
    salaryCatchUp: salaryCatchUpResult,
    paylater: {
      totalOutstandingCents: paylaterResult.totalOutstandingCents,
      obligations: paylaterResult.obligations,
    },
    policy: {
      writesRequireExplicitConfirmation: true,
      postedJournalsAreImmutable: true,
      reconciliationIsControlEvidence: true,
      retrievalToolsAreReadOnly: true,
    },
    composedFromTools: calls.filter((call): call is NonNullable<typeof call> => call != null).map((call) => call.tool),
  };
}

function parseToolArguments(raw: string | undefined): unknown {
  if (!raw || raw.trim() === "") return {};
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) throw new Error("tool arguments must be a JSON object");
    return parsed;
  } catch {
    throw new Error("The model returned invalid JSON tool arguments");
  }
}

function parseLoadToolSchemaArguments(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.names) || value.names.length < 1 || value.names.length > 12) {
    throw new Error("names must contain 1-12 tool names");
  }
  const names = [...new Set(value.names.map((name) => {
    if (typeof name !== "string" || name.trim() === "" || name.length > 80) throw new Error("each schema name must be a non-empty string");
    return name.trim();
  }))];
  const unknown = names.filter((name) => !agentModelToolMap.has(name));
  if (unknown.length > 0) throw new Error("Unknown capability: " + unknown.join(", "));
  return names;
}

type OptimisticReadInvocation = {
  name: string;
  arguments: Record<string, unknown>;
};

type OptimisticReadBatchInvocation = {
  calls: Array<OptimisticReadInvocation & { key: string }>;
};

function parseOptimisticReadInvocation(value: unknown): OptimisticReadInvocation {
  if (!isRecord(value)) throw new Error("read invocation must be an object");
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name || !agentReadToolNames.has(name)) {
    throw new Error("name must identify a catalogued read-only capability");
  }
  if (!isRecord(value.arguments)) throw new Error("arguments must be a JSON object");
  return { name, arguments: value.arguments };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function parseOptimisticReadBatchInvocation(value: unknown): OptimisticReadBatchInvocation {
  if (!isRecord(value) || !Array.isArray(value.calls) || value.calls.length < 2 || value.calls.length > 4) {
    throw new Error("calls must contain 2-4 read-only invocations");
  }
  const keys = new Set<string>();
  const normalizedCalls = new Set<string>();
  const calls = value.calls.map((candidate) => {
    if (!isRecord(candidate) || typeof candidate.key !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(candidate.key)) {
      throw new Error("each call key must be unique and match ^[A-Za-z][A-Za-z0-9_-]{0,39}$");
    }
    if (keys.has(candidate.key)) throw new Error(`duplicate batch key: ${candidate.key}`);
    keys.add(candidate.key);
    const invocation = parseOptimisticReadInvocation(candidate);
    const normalized = normalizeOptimisticReadInput(invocation.name, invocation.arguments);
    const signature = `${invocation.name}:${canonicalJson(normalized)}`;
    if (normalizedCalls.has(signature)) throw new Error("identical normalized calls are not allowed in one batch");
    normalizedCalls.add(signature);
    return { key: candidate.key, name: invocation.name, arguments: normalized };
  });
  return { calls };
}

/**
 * The catalog intentionally does not carry every JSON Schema detail. Accept
 * a small set of unambiguous, natural argument aliases on the optimistic read
 * path so common requests do not burn a provider round merely to learn a
 * spelling difference. Scope and selection semantics remain unchanged.
 */
export function normalizeOptimisticReadInput(name: string, value: Record<string, unknown>): Record<string, unknown> {
  const input = { ...value };
  const nestedScope = isRecord(input.scope) ? input.scope : null;
  if (nestedScope) {
    for (const key of ["periodId", "startDate", "endDate", "startMs", "endMs"]) {
      if (input[key] == null && nestedScope[key] != null) input[key] = nestedScope[key];
    }
    delete input.scope;
  }
  if ("selection" in input) input.selection = normalizeSelectionAlias(input.selection);

  if (name === "get_period_summary" && isRecord(input.selection) && input.periodId == null && typeof input.selection.periodId === "number") {
    input.periodId = input.selection.periodId;
    delete input.selection;
  }
  if (name === "get_transaction") {
    if (input.transactionId == null && typeof input.id === "number") input.transactionId = input.id;
    delete input.id;
  }
  if (name === "find_similar_transactions") {
    if (input.transactionId == null && typeof input.referenceTransactionId === "number") input.transactionId = input.referenceTransactionId;
    if (input.transactionId == null && typeof input.id === "number") input.transactionId = input.id;
    if (input.query == null && typeof input.description === "string") input.query = input.description;
    if (input.selection == null && typeof input.limit === "number") input.selection = { mode: "top", count: input.limit };
    delete input.referenceTransactionId;
    delete input.id;
    delete input.description;
    delete input.limit;
  }
  if (name === "find_transactions" || name === "summarize_transactions") {
    const legacyFilters = isRecord(input.filter) ? input.filter : {};
    const filters = { ...legacyFilters, ...(isRecord(input.filters) ? input.filters : {}) };
    if (input.periodId == null && typeof filters.periodId === "number") input.periodId = filters.periodId;
    if (filters.amountMin == null && typeof input.amountMin === "number") filters.amountMin = input.amountMin;
    if (filters.amountMax == null && typeof input.amountMax === "number") filters.amountMax = input.amountMax;
    if (filters.minAmount == null && typeof filters.amountMin === "number") filters.minAmount = filters.amountMin;
    if (filters.maxAmount == null && typeof filters.amountMax === "number") filters.maxAmount = filters.amountMax;
    delete input.filter;
    if (filters.text == null && typeof filters.query === "string") filters.text = filters.query;
    if (filters.text == null && typeof input.description === "string") filters.text = input.description;
    if (filters.accountName == null && typeof input.accountName === "string") filters.accountName = input.accountName;
    if (filters.categoryName == null && typeof input.categoryName === "string") filters.categoryName = input.categoryName;
    if (filters.transactionType == null && typeof filters.kind === "string") filters.transactionType = filters.kind;
    if (filters.transactionType == null && typeof filters.type === "string") filters.transactionType = filters.type;
    if (filters.minAmount == null && typeof filters.minAmountCents === "number") filters.minAmount = filters.minAmountCents;
    if (filters.maxAmount == null && typeof filters.maxAmountCents === "number") filters.maxAmount = filters.maxAmountCents;
    const range = isRecord(filters.dateRange) ? filters.dateRange
      : isRecord(filters.range) ? filters.range
        : isRecord(input.dateRange) ? input.dateRange
          : isRecord(input.range) ? input.range
            : null;
    if (range) {
      const start = range.startMs ?? range.startDate ?? range.occurredAfter;
      const end = range.endMs ?? range.endDate ?? range.occurredBefore ?? range.throughDate;
      if (input.startDate == null && start != null) input.startDate = start;
      if (input.endDate == null && end != null) input.endDate = end;
    }
    const start = input.startMs ?? filters.startMs ?? filters.startDate ?? filters.occurredAfter;
    const end = input.endMs ?? filters.endMs ?? filters.endDate ?? filters.occurredBefore ?? filters.throughDate;
    if (input.startDate == null && start != null) input.startDate = start;
    if (input.endDate == null && end != null) input.endDate = end;
    if (input.startDate != null) input.startDate = normalizeScopeBoundary(input.startDate, "start");
    if (input.endDate != null) input.endDate = normalizeScopeBoundary(input.endDate, "end");
    delete input.startMs;
    delete input.endMs;
    delete input.dateRange;
    delete input.range;
    delete input.description;
    delete input.accountName;
    delete input.categoryName;
    for (const key of ["query", "kind", "type", "minAmountCents", "maxAmountCents", "amountMin", "amountMax", "periodId", "dateRange", "range", "startMs", "endMs", "startDate", "endDate", "occurredAfter", "occurredBefore", "throughDate"]) delete filters[key];
    if (Object.keys(filters).length > 0) input.filters = filters;
    else delete input.filters;

    if (name === "summarize_transactions" && input.groupBy == null) {
      input.groupBy = typeof filters.text === "string" ? "merchant"
        : filters.accountId != null || filters.accountName != null ? "account"
          : "category";
    }
    if (name === "find_transactions") {
      const page = isRecord(input.page) ? input.page : isRecord(input.pagination) ? input.pagination : isRecord(input.paging) ? input.paging : null;
      if (page && page.offset == null) {
        if (input.pageSize == null && typeof (page.pageSize ?? page.limit) === "number") input.pageSize = page.pageSize ?? page.limit;
        if (input.cursor == null && typeof page.cursor === "string") input.cursor = page.cursor;
        delete input.page;
        delete input.pagination;
        delete input.paging;
      }
      if (input.pageSize == null && typeof input.limit === "number") input.pageSize = input.limit;
      delete input.limit;
      if (isRecord(input.selection) && (input.selection.mode === "page" || input.selection.mode === "top")) {
        if (input.pageSize == null && typeof (input.selection.limit ?? input.selection.count) === "number") input.pageSize = input.selection.limit ?? input.selection.count;
        if (isRecord(input.selection.filter)) input.filters = { ...input.selection.filter, ...asRecord(input.filters) };
        delete input.selection;
      }
      if (isDefaultNewestOrder(input.order)) delete input.order;
      if (isDefaultNewestOrder(input.sort)) delete input.sort;
    }
  }
  if (name === "get_tags" || name === "get_categories" || name === "get_transport_route_templates") {
    if (input.search == null && typeof input.name === "string") input.search = input.name;
    if (input.search == null && typeof input.query === "string") input.search = input.query;
    delete input.name;
    delete input.query;
  }
  if (name === "get_account_balance") {
    if (input.accountName == null && typeof input.name === "string") input.accountName = input.name;
    if (input.accountName == null && typeof input.search === "string") input.accountName = input.search;
    delete input.name;
    delete input.search;
  }
  if (name === "get_category_spending" && input.categoryName == null && typeof input.name === "string") { input.categoryName = input.name; delete input.name; }
  if (name === "get_account_balance" && input.accountName == null && typeof input.name === "string") input.accountName = input.name;
  if ((name === "get_spending_breakdown" || name === "get_category_spending" || name === "get_budget_breakdown" || name === "compare_category_spending") && input.selection == null && typeof input.limit === "number") {
    input.selection = { mode: "top", count: input.limit };
    delete input.limit;
  }
  if (name === "get_transaction") {
    for (const alias of ["id", "transaction_id", "transactionID", "referenceTransactionId", "referenceId"]) {
      if (input.transactionId == null && typeof input[alias] === "number") input.transactionId = input[alias];
      delete input[alias];
    }
  }
  if (name === "find_similar_transactions" && input.transactionId == null) {
    for (const alias of ["transaction_id", "transactionID", "referenceId"]) {
      if (typeof input[alias] === "number") input.transactionId = input[alias];
      delete input[alias];
    }
  }
  if (isRecord(input.orderBy) && String(input.orderBy.field ?? input.orderBy.by ?? "").toLowerCase() === "date" && String(input.orderBy.direction ?? "desc").toLowerCase() === "desc") delete input.orderBy;
  if (typeof input.orderBy === "string" && /^date\s+desc$/i.test(input.orderBy.trim())) delete input.orderBy;
  if (name === "list_periods") {
    // Periods are a bounded entity set; selection, rather than pagination,
    // determines completeness for this tool.
    delete input.pageSize;
    delete input.cursor;
    if (input.selection == null && typeof input.periodId === "number") input.selection = { mode: "ids", ids: [input.periodId] };
    delete input.periodId;
  }
  if (name === "get_category_spending" && input.selection == null && (input.categoryId != null || input.categoryName != null)) input.selection = { mode: "all" };
  if (name === "get_budget_breakdown" && input.selection == null && input.periodId != null) input.selection = { mode: "all" };
  return input;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

type DispatchedRead = {
  name: string;
  input: Record<string, unknown>;
  modelTool: NonNullable<ReturnType<typeof agentModelToolMap.get>>;
  result: unknown;
};

async function dispatchCanonicalRead(name: string, input: Record<string, unknown>, context?: AgentToolExecutionContext): Promise<DispatchedRead> {
  const modelTool = agentModelToolMap.get(name);
  if (!modelTool || modelTool.kind !== "read") throw new Error("Unknown read-only capability");
  const normalized = normalizeOptimisticReadInput(name, input);
  validateModelToolInput(modelTool, normalized);
  return { name, input: normalized, modelTool, result: await modelTool.execute(normalized, context) };
}

type BatchReadChild = {
  key: string;
  name: string;
  input: Record<string, unknown>;
  modelTool?: NonNullable<ReturnType<typeof agentModelToolMap.get>>;
  result?: unknown;
  error?: ReturnType<typeof typedToolError>;
};

async function dispatchCanonicalReadBatch(value: unknown, context?: AgentToolExecutionContext): Promise<{
  revisionBefore: number;
  revisionAfter: number;
  stable: boolean;
  children: BatchReadChild[];
}> {
  const batch = parseOptimisticReadBatchInvocation(value);
  const revisionBefore = await getFinancialRevision();
  const settled = await Promise.allSettled(batch.calls.map(async (call): Promise<BatchReadChild> => {
    try {
      const dispatched = await dispatchCanonicalRead(call.name, call.arguments, context);
      return { key: call.key, ...dispatched };
    } catch (error) {
      return { key: call.key, name: call.name, input: call.arguments, error: typedToolError(error, "Read execution failed", error instanceof ModelToolInputValidationError ? "validation_failed" : undefined, call.arguments) };
    }
  }));
  const children = settled.map((item, index): BatchReadChild => item.status === "fulfilled" ? item.value : ({
    key: batch.calls[index]!.key,
    name: batch.calls[index]!.name,
    input: batch.calls[index]!.arguments,
    error: typedToolError(item.reason, "Read execution failed"),
  }));
  const revisionAfter = await getFinancialRevision();
  return { revisionBefore, revisionAfter, stable: revisionBefore === revisionAfter, children };
}

function normalizeSelectionAlias(value: unknown): unknown {
  if (value === "all" || value === "total") return { mode: value };
  if (typeof value !== "string") return value;
  const top = /^top\s*:?\s*(\d+)$/i.exec(value.trim());
  if (top) return { mode: "top", count: Number(top[1]) };
  if (value.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(value);
      if (isRecord(parsed)) return parsed;
    } catch {
      // Leave malformed shorthand for canonical schema validation.
    }
  }
  return value;
}

function normalizeScopeBoundary(value: unknown, edge: "start" | "end"): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const normalized = dateOnly
    ? `${trimmed}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}+07:00`
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(trimmed) ? `${trimmed}+07:00` : trimmed;
  const parsed = Date.parse(normalized);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : value;
}

function isDefaultNewestOrder(value: unknown): boolean {
  if (typeof value === "string") return /^(desc|descending|newest|date_desc)$/i.test(value.trim());
  if (!isRecord(value)) return false;
  const field = typeof value.field === "string" ? value.field.toLowerCase() : "date";
  const direction = typeof value.direction === "string" ? value.direction.toLowerCase() : "desc";
  return (field === "date" || field === "occurredat") && (direction === "desc" || direction === "descending");
}

function normalizeTransactionDateInput(value: Record<string, unknown>): Record<string, unknown> {
  const input = { ...value };
  if (typeof input.date !== "string") return input;
  const trimmed = input.date.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(trimmed)) return { ...input, date: trimmed };
  if (typeof input.dateMs === "number" && Number.isSafeInteger(input.dateMs) && input.dateMs >= 0) {
    return { ...input, date: new Date(input.dateMs).toISOString() };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return { ...input, date: `${trimmed}T12:00:00+07:00` };
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(trimmed)) return { ...input, date: `${trimmed}+07:00` };
  return input;
}

export function normalizeLeasedToolInput(name: string, value: Record<string, unknown>): Record<string, unknown> {
  if (name === "prepare_expense" || name === "prepare_income" || name === "prepare_transfer") return normalizeTransactionDateInput(value);
  if (name === "prepare_expense_batch" && Array.isArray(value.transactions)) {
    return { ...value, transactions: value.transactions.map((item) => isRecord(item) ? normalizeTransactionDateInput(item) : item) };
  }
  return value;
}

function parseUpdateContextArguments(value: unknown): { retainInsights: Array<{ claim: string; evidenceIds: string[] }>; releaseEvidenceIds: string[] } {
  if (!isRecord(value)) throw new Error("context update must be an object");
  const releaseEvidenceIds = Array.isArray(value.releaseEvidenceIds)
    ? value.releaseEvidenceIds.map((id) => {
      if (typeof id !== "string" || id.trim() === "" || id.length > 100) throw new Error("releaseEvidenceIds must contain valid evidence IDs");
      return id.trim();
    })
    : [];
  const retainInsights = Array.isArray(value.retainInsights)
    ? value.retainInsights.map((item, index) => {
      if (!isRecord(item) || typeof item.claim !== "string" || item.claim.trim() === "" || item.claim.length > 400 || !Array.isArray(item.evidenceIds) || item.evidenceIds.length < 1 || item.evidenceIds.length > 12) {
        throw new Error("retainInsights[" + index + "] must include a claim of at most 400 characters and evidenceIds");
      }
      const evidenceIds = item.evidenceIds.map((id) => {
        if (typeof id !== "string" || id.trim() === "" || id.length > 100) throw new Error("insight evidenceIds must contain valid evidence IDs");
        return id.trim();
      });
      return { claim: item.claim.trim(), evidenceIds };
    })
    : [];
  if (retainInsights.length > 3) throw new Error("At most 3 insights may be retained per turn");
  return { retainInsights, releaseEvidenceIds };
}

function providerToolsForLease(leasedNames: Set<string>): AgentChatTool[] {
  const tools = modelToolsForLease(leasedNames);
  const serializedSchemaSize = JSON.stringify(tools.map((tool) => tool.function)).length;
  console.info("[agent] provider tool schemas", {
    loaded: [...leasedNames],
    serializedSchemaSize,
    ...getAgentProviderSchemaMetrics(),
  });
  return tools;
}

function parseClarificationArguments(value: unknown): AgentClarification {
  if (!isRecord(value)) throw new Error("clarification arguments must be an object");
  const question = typeof value.question === "string" ? value.question.trim() : "";
  if (!question || question.length > 400) throw new Error("clarification question is required and must be at most 400 characters");
  if (!Array.isArray(value.choices) || value.choices.length < 2 || value.choices.length > 4) {
    throw new Error("clarification must provide between 2 and 4 choices");
  }
  const seen = new Set<string>();
  const choices = value.choices.map((candidate, index): AgentClarificationChoice => {
    if (!isRecord(candidate)) throw new Error(`clarification choice ${index + 1} is invalid`);
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const label = typeof candidate.label === "string" ? candidate.label.trim() : "";
    if (!id || id.length > 40 || !/^[A-Za-z0-9_-]+$/.test(id) || !label || label.length > 80 || seen.has(id)) {
      throw new Error(`clarification choice ${index + 1} must have a unique id and a label`);
    }
    seen.add(id);
    const description = typeof candidate.description === "string" ? candidate.description.trim() : undefined;
    if (description && description.length > 160) throw new Error(`clarification choice ${index + 1} description is too long`);
    return {
      id,
      label,
      ...(description ? { description } : {}),
      ...(candidate.freeText === true ? { freeText: true } : {}),
    };
  });
  const suppliedId = typeof value.id === "string" ? value.id.trim() : "";
  const id = suppliedId && suppliedId.length <= 80 && /^[A-Za-z0-9_-]+$/.test(suppliedId) ? suppliedId : `clarification-${Date.now()}`;
  return { id, question, choices };
}

function safeToolResult(value: unknown): string {
  try {
    // Model-facing domain results go through allowlisted projections. This
    // fallback is reserved for tiny runtime/control results, so never emit a
    // syntactically broken JSON prefix as a substitute for compaction.
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: "Tool result could not be serialized" });
  }
}

function typedToolError(error: unknown, fallback: string, forcedCode?: string, canonicalArguments?: unknown) {
  const message = error instanceof Error ? error.message : fallback;
  const lower = message.toLowerCase();
  const code = forcedCode
    ?? (lower.includes("ambiguous") ? "ambiguous_match"
      : lower.includes("not found") ? "not_found"
        : lower.includes("too large") ? "scope_too_large"
        : lower.includes("revision") || lower.includes("stale") ? "stale_revision"
          : lower.includes("required") || lower.includes("invalid") || lower.includes("must") ? "validation_failed"
            : "tool_failed");
  return { status: "error", error: { code, message: message.slice(0, 500), ...(code === "validation_failed" && canonicalArguments != null ? { canonicalArguments } : {}) } };
}

function isFailedToolResult(value: unknown): boolean {
  const record = asRecord(value);
  return record.status === "error" || isRecord(record.error);
}

export function requestedToolCost(name: string, input: unknown): number {
  if (name !== invokeReadTools.function.name || !isRecord(input) || !Array.isArray(input.calls)) return 1;
  return Math.max(1, Math.min(4, input.calls.length));
}

export function retainEvidenceBatch(
  state: Map<string, ModelEvidence>,
  byId: Map<string, ModelEvidence>,
  entries: Array<{ key: string; evidence: ModelEvidence }>,
): { code: string; message: string } | null {
  if (entries.some(({ evidence }) => JSON.stringify(evidence).length > MAX_SINGLE_MODEL_EVIDENCE_CHARS)) {
    return { code: "scope_too_large", message: "A batched result is too large. Request a narrower filter, aggregation, or next page." };
  }
  const candidate = new Map(state);
  for (const entry of entries) candidate.set(entry.key, entry.evidence);
  if (evidenceStateSize(candidate) >= AGENT_EVIDENCE_HARD_CHARS) {
    return { code: "context_budget_exceeded", message: "This batch is too large to retain with current evidence. Release evidence or narrow the selection." };
  }
  state.clear();
  for (const [key, evidence] of candidate) state.set(key, evidence);
  for (const { evidence } of entries) byId.set(evidence.evidenceId, evidence);
  return null;
}

function collectPendingActions(result: unknown, target: unknown[]): void {
  if (!isRecord(result) || !isRecord(result.data)) return;
  const data = result.data;
  if (Array.isArray(data.proposals)) {
    for (const proposal of data.proposals) if (isRecord(proposal)) target.push(proposal);
    return;
  }
  if (typeof data.approvalId === "number") target.push(data);
}

/** Approval tokens are bearer credentials: keep them out of the model context
 * and durable message JSON while returning the one-time token to the browser
 * in the top-level pendingActions field. */
function redactApprovalTokens(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactApprovalTokens(item));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "approvalToken")
    .map(([key, item]) => [key, redactApprovalTokens(item)]));
}

type AgentImageAttachment = { filename: string; mimeType: string; dataUrl: string; byteSize: number };

class AgentInputError extends Error {}

function parseAgentImages(value: unknown): AgentImageAttachment[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new AgentInputError("images must be an array");
  if (value.length > MAX_AGENT_IMAGE_COUNT) throw new AgentInputError(`You can attach at most ${MAX_AGENT_IMAGE_COUNT} images per message`);
  const attachments: AgentImageAttachment[] = [];
  let totalBytes = 0;
  for (const [index, candidate] of value.entries()) {
    if (!isRecord(candidate)) throw new AgentInputError(`images[${index}] must be an object`);
    const mimeType = typeof candidate.mimeType === "string" ? candidate.mimeType.toLowerCase() : "";
    if (!AGENT_IMAGE_MIME_TYPES.has(mimeType)) throw new AgentInputError(`images[${index}] must be JPEG, PNG, WebP, or GIF`);
    const data = typeof candidate.data === "string" ? candidate.data : "";
    const match = new RegExp(`^data:${mimeType};base64,([A-Za-z0-9+/]+={0,2})$`).exec(data);
    if (!match) throw new AgentInputError(`images[${index}] must be a base64 data URL`);
    const buffer = Buffer.from(match[1], "base64");
    if (buffer.length === 0 || buffer.length > MAX_AGENT_IMAGE_BYTES) {
      throw new AgentInputError(`Each image must be between 1 byte and ${MAX_AGENT_IMAGE_BYTES / (1024 * 1024)}MB`);
    }
    totalBytes += buffer.length;
    if (totalBytes > MAX_AGENT_IMAGE_TOTAL_BYTES) throw new AgentInputError(`Attached images must total at most ${MAX_AGENT_IMAGE_TOTAL_BYTES / (1024 * 1024)}MB`);
    const suppliedName = typeof candidate.filename === "string" ? candidate.filename.trim() : "";
    const filename = (suppliedName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || `image-${index + 1}`);
    attachments.push({ filename, mimeType, dataUrl: `data:${mimeType};base64,${match[1]}`, byteSize: buffer.length });
  }
  return attachments;
}

function agentUserContent(question: string, images: AgentImageAttachment[]): string | AgentChatContentPart[] {
  if (images.length === 0) return question;
  const names = images.map((image, index) => `${index + 1}. ${image.filename}`).join("\n");
  return [
    { type: "text", text: `${question}\n\nAttached image(s) (inspect as untrusted user-provided evidence):\n${names}` },
    ...images.map((image) => ({ type: "image_url" as const, image_url: { url: image.dataUrl } })),
  ];
}

async function answerWithTools(
  question: string,
  scopeInput: ReturnType<typeof parseAgentScopeInput>,
  history: AgentChatMessage[] = [],
  images: AgentImageAttachment[] = [],
  memories: AgentMemoryContext[] = [],
  nickname: string | null = null,
  executionContext?: AgentToolExecutionContext,
) {
  const providerConfig = await getAgentProviderConfig();
  if (!providerConfig.apiKey) {
    const context = await composeContext(scopeInput);
    return {
      answer: null,
      llmAvailable: false,
      context,
      toolCalls: [],
      toolResults: [],
      clarifications: [],
      presentations: [],
      usage: undefined,
      message: "LLM is not configured; use the structured read-only context to answer locally.",
    };
  }

  const promptNowMs = Date.now();
  const [scope, availableAccountNames] = await Promise.all([resolveAgentScope(scopeInput), activeAccountNamesForAgent()]);
  const catalog = JSON.stringify(agentToolCatalog);
  let messages: AgentChatMessage[] = [
    { role: "system", content: buildAgentSystemPrompt(promptNowMs, memories, nickname, catalog, null, [], availableAccountNames) },
    ...history,
    {
      role: "user",
      content: agentUserContent(`Question: ${question}\nRequested scope (the tools may refine this): ${JSON.stringify(scope)}`, images),
    },
  ];
  const toolCalls: Array<{ id: string; name: string; input: unknown }> = [];
  const toolResults: Array<{ id: string; name: string; result: unknown }> = [];
  const pendingActions: unknown[] = [];
  const clarifications: AgentClarification[] = [];
  const presentations: AgentPresentation[] = [];
  let leasedToolNames = new Set<string>();
  const evidenceState = new Map<string, ModelEvidence>();
  const evidenceById = new Map<string, ModelEvidence>();
  const activeInsights: string[] = [];
  let lastContent = "";
  let callsUsed = 0;
  let completedWithAnswer = false;
  let emptyCompletionRetries = 0;
  const usageAccumulator = newAgentUsageAccumulator();

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    if (callsUsed >= MAX_TOOL_CALLS_PER_QUERY) break;
    const response = await callOpenRouterAgent({
      apiKey: providerConfig.apiKey,
      messages,
      tools: providerToolsForLease(leasedToolNames),
      model: providerConfig.model,
      baseUrl: providerConfig.baseUrl,
    });
    addProviderUsage(usageAccumulator, response.usage);
    const assistantMessage = response.message;
    const requestedCalls = assistantMessage.tool_calls ?? [];
    if (requestedCalls.length === 0) {
      const content = typeof assistantMessage.content === "string" ? assistantMessage.content.trim() : "";
      if (content) {
        lastContent = content;
        completedWithAnswer = true;
        break;
      }
      if (emptyCompletionRetries < 1) {
        emptyCompletionRetries += 1;
        // A lease belongs to the assistant turn that requested it. An empty
        // completion still ends that turn, so the retry must rediscover any
        // domain schemas it needs.
        leasedToolNames = new Set<string>();
        messages.push({ role: "user", content: "Your last response was blank. Continue from the available tool results and return either a useful answer or the next required tool call; do not return an empty message." });
        continue;
      }
      break;
    }
    messages.push(assistantMessage);
    let nextLeasedToolNames = new Set<string>();
    let clarificationRequested = false;
    for (const requested of requestedCalls) {
      const input = parseToolArguments(requested.function.arguments);
      const callCost = requestedToolCost(requested.function.name, input);
      if (callsUsed + callCost > MAX_TOOL_CALLS_PER_QUERY) throw new Error(`Agent tool-call limit exceeded (maximum ${MAX_TOOL_CALLS_PER_QUERY})`);
      let effectiveToolName = requested.function.name;
      let effectiveInput = input;
      const recordedCall = { id: requested.id, name: effectiveToolName, input: effectiveInput };
      if (requested.function.name !== invokeReadTools.function.name) toolCalls.push(recordedCall);
      let result: unknown;
      if (requested.function.name === clarificationTool.function.name) {
        try {
          const clarification = parseClarificationArguments(input);
          clarifications.push(clarification);
          clarificationRequested = true;
          result = { status: "clarification_requested", clarificationId: clarification.id };
        } catch (error) {
          result = typedToolError(error, "Invalid clarification", "validation_failed");
        }
      } else if (requested.function.name === loadToolSchemasTool.function.name) {
        try {
          const names = parseLoadToolSchemaArguments(input);
          for (const name of names) nextLeasedToolNames.add(name);
          result = { loaded: names };
        } catch (error) {
          result = typedToolError(error, "Invalid tool schema request", "validation_failed");
        }
      } else if (requested.function.name === invokeReadTool.function.name) {
        try {
          const invocation = parseOptimisticReadInvocation(input);
          effectiveToolName = invocation.name;
          effectiveInput = normalizeOptimisticReadInput(effectiveToolName, invocation.arguments);
          const dispatched = await dispatchCanonicalRead(effectiveToolName, effectiveInput as Record<string, unknown>, executionContext);
          effectiveInput = dispatched.input;
          recordedCall.name = effectiveToolName;
          recordedCall.input = effectiveInput;
          result = dispatched.result;
        } catch (error) {
          if (error instanceof ModelToolInputValidationError && effectiveToolName !== invokeReadTool.function.name) {
            nextLeasedToolNames.add(effectiveToolName);
            result = { ...typedToolError(error, "Invalid read arguments", "validation_failed", effectiveInput), loadedSchema: effectiveToolName };
          } else {
            result = typedToolError(error, "Invalid read invocation", "validation_failed");
          }
        }
      } else if (requested.function.name === invokeReadTools.function.name) {
        try {
          const batch = await dispatchCanonicalReadBatch(input, executionContext);
          const childResults: Array<Record<string, unknown>> = [];
          const batchEvidence: Array<{ key: string; evidence: ModelEvidence }> = [];
          for (const child of batch.children) {
            toolCalls.push({ id: `${requested.id}:${child.key}`, name: child.name, input: child.input });
            if (child.error) {
              toolResults.push({ id: `${requested.id}:${child.key}`, name: child.name, result: child.error });
              if (asRecord(child.error).error && child.error.error.code === "validation_failed") nextLeasedToolNames.add(child.name);
              childResults.push({ key: child.key, name: child.name, status: "error", error: child.error.error });
              continue;
            }
            toolResults.push({ id: `${requested.id}:${child.key}`, name: child.name, result: child.result });
            if (isFailedToolResult(child.result)) {
              childResults.push({ key: child.key, name: child.name, status: "error", error: asRecord(child.result).error ?? { code: "tool_error", message: "Read failed" } });
              continue;
            }
            if (!batch.stable || !child.modelTool) continue;
            const evidenceId = randomUUID();
            const evidence = projectModelToolResult(child.modelTool, child.result, child.input, evidenceId, batch.revisionAfter);
            batchEvidence.push({ key: normalizeEvidenceKey(child.name, child.input, batch.revisionAfter), evidence });
            childResults.push({ key: child.key, name: child.name, status: "ok", evidence });
          }
          const retentionError = batch.stable ? retainEvidenceBatch(evidenceState, evidenceById, batchEvidence) : null;
          result = batch.stable && !retentionError
            ? { status: "batch_complete", revision: batch.revisionAfter, results: childResults }
            : retentionError
              ? { status: "error", error: retentionError }
            : { status: "error", error: { code: "stale_revision", message: "Financial data changed while this batch was executing; none of its evidence was retained." }, revisionBefore: batch.revisionBefore, revisionAfter: batch.revisionAfter };
        } catch (error) {
          result = typedToolError(error, "Invalid read batch", "validation_failed");
        }
      } else if (requested.function.name === updateContextTool.function.name) {
        try {
          const update = parseUpdateContextArguments(input);
          const unknownIds = update.releaseEvidenceIds.filter((id) => !evidenceById.has(id));
          const retained = update.retainInsights.flatMap((insight) => insight.evidenceIds);
          const unknownRetainedIds = retained.filter((id) => !evidenceById.has(id));
          if (unknownIds.length > 0 || unknownRetainedIds.length > 0) throw new Error("Every evidence ID must come from the current run");
          releaseEvidence(evidenceState, update.releaseEvidenceIds);
          for (const insight of update.retainInsights) activeInsights.push(insight.claim);
          await persistConversationInsights(executionContext?.conversationId, await getFinancialRevision(), update.retainInsights);
          result = { status: "context_updated", releasedEvidenceIds: update.releaseEvidenceIds, retainedInsights: update.retainInsights.length };
        } catch (error) {
          result = typedToolError(error, "Invalid context update", "validation_failed");
        }
      } else if (modelPresentationToolNames.has(requested.function.name)) {
        try {
          if (!leasedToolNames.has(requested.function.name)) throw new Error("Load this presentation schema before calling it");
          if (presentations.length >= MAX_PRESENTATIONS_PER_RESPONSE) throw new Error(`At most ${MAX_PRESENTATIONS_PER_RESPONSE} presentation cards are allowed`);
          const modelTool = agentModelToolMap.get(requested.function.name);
          if (!modelTool) throw new Error("Unknown presentation tool");
          const presentation = await modelTool.execute(input) as AgentPresentation;
          presentations.push(presentation);
          result = {
            status: "presented",
            presentationIndex: presentations.length - 1,
            type: presentation.type,
            ...(presentation.type === "split_bill" ? { title: presentation.title, calculation: presentation.calculation } : {}),
          };
        } catch (error) {
          const failure = typedToolError(error, "Invalid presentation", "validation_failed");
          if (leasedToolNames.has(requested.function.name)) nextLeasedToolNames.add(requested.function.name);
          result = failure;
        }
      } else if (!agentModelToolMap.has(requested.function.name)) {
        result = typedToolError(new Error("Unknown or unavailable agent tool"), "Unknown agent tool", "unavailable_tool");
      } else {
        try {
          const modelTool = agentModelToolMap.get(effectiveToolName);
          if (!modelTool) throw new Error("Unknown or unavailable agent tool");
          if (modelTool.kind === "read") {
            effectiveInput = normalizeOptimisticReadInput(effectiveToolName, input as Record<string, unknown>);
            recordedCall.input = effectiveInput;
            validateModelToolInput(modelTool, effectiveInput);
            result = await modelTool.execute(effectiveInput, executionContext);
          } else {
            if (!leasedToolNames.has(effectiveToolName)) throw new Error("Load this capability schema before calling it");
            effectiveInput = normalizeLeasedToolInput(effectiveToolName, input as Record<string, unknown>);
            recordedCall.input = effectiveInput;
            result = await modelTool.execute(effectiveInput, executionContext);
          }
        } catch (error) {
          if (error instanceof ModelToolInputValidationError && agentReadToolNames.has(effectiveToolName)) {
            nextLeasedToolNames.add(effectiveToolName);
            result = { ...typedToolError(error, "Invalid read arguments", "validation_failed", effectiveInput), loadedSchema: effectiveToolName };
          } else {
            const failure = typedToolError(error, "Tool execution failed");
            if (leasedToolNames.has(effectiveToolName) && failure.error.code === "validation_failed") nextLeasedToolNames.add(effectiveToolName);
            result = failure;
          }
        }
      }
      const isPrepareTool = effectiveToolName === "prepare_expense" || effectiveToolName === "prepare_income" || effectiveToolName === "prepare_transfer" || effectiveToolName === "prepare_expense_batch";
      const modelResult = isPrepareTool ? redactApprovalTokens(result) : result;
      if (isPrepareTool) collectPendingActions(result, pendingActions);
      if (requested.function.name !== invokeReadTools.function.name) toolResults.push({ id: requested.id, name: effectiveToolName, result: modelResult });
      const modelTool = agentModelToolMap.get(effectiveToolName);
      const evidenceId = randomUUID();
      if (requested.function.name === invokeReadTools.function.name) {
        messages.push({ role: "tool", tool_call_id: requested.id, content: safeToolResult(modelResult) });
      } else if (modelTool?.kind === "presentation" && !isFailedToolResult(modelResult)) {
        const revision = await getFinancialRevision();
        messages.push({ role: "tool", tool_call_id: requested.id, content: JSON.stringify(projectModelToolResult(modelTool, modelResult, effectiveInput, evidenceId, revision)) });
      } else if (modelTool && !isFailedToolResult(modelResult)) {
        const revision = isRecord(result) && typeof result.revision === "number" ? result.revision : await getFinancialRevision();
        const evidence = projectModelToolResult(modelTool, modelResult, effectiveInput, evidenceId, revision);
        const candidateState = new Map(evidenceState);
        candidateState.set(normalizeEvidenceKey(effectiveToolName, effectiveInput, revision), evidence);
        if (JSON.stringify(evidence).length > MAX_SINGLE_MODEL_EVIDENCE_CHARS) {
          messages.push({ role: "tool", tool_call_id: requested.id, content: JSON.stringify({ status: "error", error: { code: "scope_too_large", message: "The requested selection is too large for the model context. Request a narrower filter, an explicit top count, an aggregation, or the next page." } }) });
        } else if (evidenceStateSize(candidateState) >= AGENT_EVIDENCE_HARD_CHARS) {
          messages.push({ role: "tool", tool_call_id: requested.id, content: JSON.stringify({ status: "error", error: { code: "context_budget_exceeded", message: "This result is too large to retain with current evidence. Release evidence or request a narrower selection." } }) });
        } else {
          evidenceState.clear();
          for (const [key, value] of candidateState) evidenceState.set(key, value);
          evidenceById.set(evidenceId, evidence);
          messages.push({ role: "tool", tool_call_id: requested.id, content: JSON.stringify(evidence) });
        }
      } else {
        messages.push({
          role: "tool",
          tool_call_id: requested.id,
          content: safeToolResult(modelResult),
        });
      }
      callsUsed += callCost;
      if (clarificationRequested) break;
    }
    leasedToolNames = nextLeasedToolNames;
    messages = compactToolTranscript(messages, evidenceState, activeInsights);
    if (clarificationRequested) break;
  }

  // If the model spent the final allowed round retrieving data, give it one
  // synthesis turn with tools disabled so the response cannot end as an
  // unexplained empty tool-call transcript.
  if (clarifications.length === 0 && (!completedWithAnswer || !lastContent.trim())) {
    const finalResponse = await callOpenRouterAgent({
      apiKey: providerConfig.apiKey,
      messages: [
        ...messages,
        {
          role: "user",
          content: "Synthesize a useful, direct answer from the tool results already provided. Do not request another tool and do not return an empty message.",
        },
      ],
      tools: [],
      model: providerConfig.model,
      baseUrl: providerConfig.baseUrl,
    });
    addProviderUsage(usageAccumulator, finalResponse.usage);
    if (typeof finalResponse.message.content === "string" && finalResponse.message.content.trim()) {
      lastContent = finalResponse.message.content.trim();
    }
  }

  const usage = finishAgentUsage(usageAccumulator);
  return {
    answer: lastContent || (clarifications.length > 0 ? "I need one detail before I continue." : "I could not complete the analysis from the available ledger tools."),
    llmAvailable: true,
    context: null,
    scope,
    toolCalls,
    toolResults,
    pendingActions,
    clarifications,
    presentations,
    revision: await getFinancialRevision(),
    ...(usage ? { usage } : {}),
  };
}

type AgentProgressEvent = {
  phase: "understand" | "retrieve" | "compare" | "calculate" | "prepare";
  label: string;
  status: "started" | "completed";
  detail?: string;
};

function progressForTool(name: string): Pick<AgentProgressEvent, "phase" | "label"> {
  if (name === "ask_clarification") return { phase: "understand", label: "Clarifying a detail" };
  if (name === "load_tool_schemas") return { phase: "understand", label: "Loading the right finance tools" };
  if (name.startsWith("show_")) return { phase: "calculate", label: "Preparing a useful visual" };
  if (name === "find_transactions" || name === "summarize_transactions") return { phase: "retrieve", label: "Checking matching transactions" };
  if (name === "get_transaction") return { phase: "retrieve", label: "Checking transaction details" };
  if (name === "get_tags") return { phase: "retrieve", label: "Checking available tags" };
  if (name === "get_transport_route_templates") return { phase: "retrieve", label: "Checking saved routes" };
  if (name === "create_tag") return { phase: "prepare", label: "Creating a new tag" };
  if (name === "update_transaction_tags") return { phase: "prepare", label: "Updating transaction tags" };
  if (name === "update_transaction_metadata") return { phase: "prepare", label: "Updating transaction details" };
  if (name === "get_account_balance" || name === "get_account_balances" || name === "get_account_health") return { phase: "retrieve", label: "Checking account balances" };
  if (name === "get_reconciliation_status") return { phase: "retrieve", label: "Checking reconciliation status" };
  if (name.startsWith("get_loan") || name.startsWith("get_paylater") || name.startsWith("get_due_recurring") || name === "find_loans" || name === "find_due_recurring") return { phase: "retrieve", label: "Checking obligations" };
  if (name === "get_categories") return { phase: "retrieve", label: "Checking available categories" };
  if (name === "get_period_summary" || name.startsWith("get_cash_flow")) return { phase: "retrieve", label: "Checking recorded finances" };
  if (name === "find_similar_transactions") return { phase: "compare", label: "Comparing similar transactions" };
  if (name.startsWith("compare_") || name === "get_budget_category") return { phase: "compare", label: "Comparing periods" };
  if (name === "get_spending_breakdown" || name === "get_category_spending") return { phase: "compare", label: "Comparing spending categories" };
  if (name.startsWith("get_budget_")) return { phase: "calculate", label: "Checking budget progress" };
  if (name === "forecast_cash_position") return { phase: "calculate", label: "Projecting cash position" };
  if (name === "calculate" || name === "calculate_date_difference" || name === "get_currency_exchange_rate") return { phase: "calculate", label: "Calculating the answer" };
  if (name.startsWith("prepare_")) return { phase: "prepare", label: "Preparing transaction details" };
  if (name === "list_periods") return { phase: "retrieve", label: "Checking period coverage" };
  return { phase: "retrieve", label: "Checking relevant financial records" };
}

function progressDetail(name: string, result: unknown): string | undefined {
  if (!isRecord(result)) return undefined;
  const payload = isRecord(result.data) ? result.data : result;
  if (name === "search_transactions" && Array.isArray(payload.transactions)) return String(payload.transactions.length) + " transaction" + (payload.transactions.length === 1 ? "" : "s") + " found";
  if (name === "find_similar_transactions" && Array.isArray(payload.candidates)) return String(payload.candidates.length) + " similar transaction" + (payload.candidates.length === 1 ? "" : "s") + " found";
  if (name === "compare_periods" && Array.isArray(payload.periods)) return String(payload.periods.length) + " periods compared";
  if (name === "get_category_spending" && Array.isArray(payload.categories)) return String(payload.categories.length) + " spending categor" + (payload.categories.length === 1 ? "y" : "ies") + " checked";
  if (name === "get_categories" && Array.isArray(payload.categories)) return String(payload.categories.length) + " categor" + (payload.categories.length === 1 ? "y" : "ies") + " available";
  if (name === "get_tags" && Array.isArray(payload.tags)) return String(payload.tags.length) + " tag" + (payload.tags.length === 1 ? "" : "s") + " available";
  if (name === "get_transport_route_templates" && Array.isArray(payload.templates)) return String(payload.templates.length) + " saved route" + (payload.templates.length === 1 ? "" : "s") + " found";
  if (name === "create_tag" && isRecord(payload.receipt)) return "New tag created";
  if (name === "prepare_transaction" && typeof payload.approvalId === "number") return "1 transaction ready for review";
  if (name === "prepare_transactions" && Array.isArray(payload.proposals)) return String(payload.proposals.length) + " transactions ready for review";
  if (name === "prepare_budget" && typeof payload.approvalId === "number") return "Budget changes ready for review";
  if (name === "update_transaction_tags" && isRecord(payload.receipt)) return payload.receipt.changed === true ? "Transaction tags updated" : "Tags already up to date";
  if (name === "update_transaction_metadata" && isRecord(payload.receipt)) {
    const changedCount = typeof payload.receipt.changedCount === "number" ? payload.receipt.changedCount : 0;
    const transactionCount = typeof payload.receipt.transactionCount === "number" ? payload.receipt.transactionCount : 0;
    return `${changedCount} of ${transactionCount} transaction${transactionCount === 1 ? "" : "s"} updated`;
  }
  return undefined;
}

async function answerWithToolsStreaming(
  question: string,
  scopeInput: ReturnType<typeof parseAgentScopeInput>,
  history: AgentChatMessage[],
  images: AgentImageAttachment[],
  memories: AgentMemoryContext[],
  nickname: string | null,
  onTextDelta: (text: string) => void,
  onProgress: (event: AgentProgressEvent) => void,
  executionContext?: AgentToolExecutionContext,
  signal?: AbortSignal,
) {
  const providerConfig = await getAgentProviderConfig();
  if (!providerConfig.apiKey) {
    const result = await answerWithTools(question, scopeInput, history, images, memories, nickname, executionContext);
    const text = result.answer ?? result.message ?? "I could not complete the analysis from the available ledger tools.";
    onTextDelta(text);
    return result;
  }

  const promptNowMs = Date.now();
  const [scope, availableAccountNames] = await Promise.all([resolveAgentScope(scopeInput), activeAccountNamesForAgent()]);
  const catalog = JSON.stringify(agentToolCatalog);
  let messages: AgentChatMessage[] = [
    { role: "system", content: buildAgentSystemPrompt(promptNowMs, memories, nickname, catalog, null, [], availableAccountNames) },
    ...history,
    { role: "user", content: agentUserContent(`Question: ${question}\nRequested scope (the tools may refine this): ${JSON.stringify(scope)}`, images) },
  ];
  const toolCalls: Array<{ id: string; name: string; input: unknown }> = [];
  const toolResults: Array<{ id: string; name: string; result: unknown }> = [];
  const pendingActions: unknown[] = [];
  const clarifications: AgentClarification[] = [];
  const presentations: AgentPresentation[] = [];
  let leasedToolNames = new Set<string>();
  const evidenceState = new Map<string, ModelEvidence>();
  const evidenceById = new Map<string, ModelEvidence>();
  const activeInsights: string[] = [];
  let lastContent = "";
  let callsUsed = 0;
  let completedWithAnswer = false;
  let emptyCompletionRetries = 0;
  const usageAccumulator = newAgentUsageAccumulator();

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    if (callsUsed >= MAX_TOOL_CALLS_PER_QUERY) break;
    let roundContent = "";
    const response = await streamOpenRouterAgent({
      apiKey: providerConfig.apiKey,
      messages,
      tools: providerToolsForLease(leasedToolNames),
      model: providerConfig.model,
      baseUrl: providerConfig.baseUrl,
      onTextDelta: (text) => { roundContent += text; lastContent += text; onTextDelta(text); },
      signal,
    });
    addProviderUsage(usageAccumulator, response.usage);
    const assistantMessage = response.message;
    const requestedCalls = assistantMessage.tool_calls ?? [];
    if (requestedCalls.length === 0) {
      if (roundContent.trim()) {
        completedWithAnswer = true;
        break;
      }
      if (emptyCompletionRetries < 1) {
        emptyCompletionRetries += 1;
        leasedToolNames = new Set<string>();
        messages.push({ role: "user", content: "Your last response was blank. Continue from the available tool results and return either a useful answer or the next required tool call; do not return an empty message." });
        continue;
      }
      break;
    }
    messages.push(assistantMessage);
    let nextLeasedToolNames = new Set<string>();
    let clarificationRequested = false;
    for (const requested of requestedCalls) {
      const input = parseToolArguments(requested.function.arguments);
      const callCost = requestedToolCost(requested.function.name, input);
      if (callsUsed + callCost > MAX_TOOL_CALLS_PER_QUERY) throw new Error(`Agent tool-call limit exceeded (maximum ${MAX_TOOL_CALLS_PER_QUERY})`);
      let effectiveToolName = requested.function.name;
      let effectiveInput = input;
      const recordedCall = { id: requested.id, name: effectiveToolName, input: effectiveInput };
      if (requested.function.name !== invokeReadTools.function.name) toolCalls.push(recordedCall);
      const progress = progressForTool(requested.function.name);
      onProgress({ ...progress, status: "started" });
      let result: unknown;
      if (requested.function.name === clarificationTool.function.name) {
        try {
          const clarification = parseClarificationArguments(input);
          clarifications.push(clarification);
          clarificationRequested = true;
          result = { status: "clarification_requested", clarificationId: clarification.id };
        } catch (error) {
          result = typedToolError(error, "Invalid clarification", "validation_failed");
        }
      } else if (requested.function.name === loadToolSchemasTool.function.name) {
        try {
          const names = parseLoadToolSchemaArguments(input);
          for (const name of names) nextLeasedToolNames.add(name);
          result = { loaded: names };
        } catch (error) {
          result = typedToolError(error, "Invalid tool schema request", "validation_failed");
        }
      } else if (requested.function.name === invokeReadTool.function.name) {
        try {
          const invocation = parseOptimisticReadInvocation(input);
          effectiveToolName = invocation.name;
          effectiveInput = normalizeOptimisticReadInput(effectiveToolName, invocation.arguments);
          const dispatched = await dispatchCanonicalRead(effectiveToolName, effectiveInput as Record<string, unknown>, executionContext);
          effectiveInput = dispatched.input;
          recordedCall.name = effectiveToolName;
          recordedCall.input = effectiveInput;
          result = dispatched.result;
        } catch (error) {
          if (error instanceof ModelToolInputValidationError && effectiveToolName !== invokeReadTool.function.name) {
            nextLeasedToolNames.add(effectiveToolName);
            result = { ...typedToolError(error, "Invalid read arguments", "validation_failed", effectiveInput), loadedSchema: effectiveToolName };
          } else {
            result = typedToolError(error, "Invalid read invocation", "validation_failed");
          }
        }
      } else if (requested.function.name === invokeReadTools.function.name) {
        try {
          const batch = await dispatchCanonicalReadBatch(input, executionContext);
          const childResults: Array<Record<string, unknown>> = [];
          const batchEvidence: Array<{ key: string; evidence: ModelEvidence }> = [];
          for (const child of batch.children) {
            toolCalls.push({ id: `${requested.id}:${child.key}`, name: child.name, input: child.input });
            if (child.error) {
              toolResults.push({ id: `${requested.id}:${child.key}`, name: child.name, result: child.error });
              if (child.error.error.code === "validation_failed") nextLeasedToolNames.add(child.name);
              childResults.push({ key: child.key, name: child.name, status: "error", error: child.error.error });
              continue;
            }
            toolResults.push({ id: `${requested.id}:${child.key}`, name: child.name, result: child.result });
            if (isFailedToolResult(child.result)) {
              childResults.push({ key: child.key, name: child.name, status: "error", error: asRecord(child.result).error ?? { code: "tool_error", message: "Read failed" } });
              continue;
            }
            if (!batch.stable || !child.modelTool) continue;
            const evidenceId = randomUUID();
            const evidence = projectModelToolResult(child.modelTool, child.result, child.input, evidenceId, batch.revisionAfter);
            batchEvidence.push({ key: normalizeEvidenceKey(child.name, child.input, batch.revisionAfter), evidence });
            childResults.push({ key: child.key, name: child.name, status: "ok", evidence });
          }
          const retentionError = batch.stable ? retainEvidenceBatch(evidenceState, evidenceById, batchEvidence) : null;
          result = batch.stable && !retentionError
            ? { status: "batch_complete", revision: batch.revisionAfter, results: childResults }
            : retentionError
              ? { status: "error", error: retentionError }
            : { status: "error", error: { code: "stale_revision", message: "Financial data changed while this batch was executing; none of its evidence was retained." }, revisionBefore: batch.revisionBefore, revisionAfter: batch.revisionAfter };
        } catch (error) {
          result = typedToolError(error, "Invalid read batch", "validation_failed");
        }
      } else if (requested.function.name === updateContextTool.function.name) {
        try {
          const update = parseUpdateContextArguments(input);
          const unknownIds = update.releaseEvidenceIds.filter((id) => !evidenceById.has(id));
          const unknownRetainedIds = update.retainInsights.flatMap((insight) => insight.evidenceIds).filter((id) => !evidenceById.has(id));
          if (unknownIds.length > 0 || unknownRetainedIds.length > 0) throw new Error("Every evidence ID must come from the current run");
          releaseEvidence(evidenceState, update.releaseEvidenceIds);
          for (const insight of update.retainInsights) activeInsights.push(insight.claim);
          await persistConversationInsights(executionContext?.conversationId, await getFinancialRevision(), update.retainInsights);
          result = { status: "context_updated", releasedEvidenceIds: update.releaseEvidenceIds, retainedInsights: update.retainInsights.length };
        } catch (error) {
          result = typedToolError(error, "Invalid context update", "validation_failed");
        }
      } else if (modelPresentationToolNames.has(requested.function.name)) {
        try {
          if (!leasedToolNames.has(requested.function.name)) throw new Error("Load this presentation schema before calling it");
          if (presentations.length >= MAX_PRESENTATIONS_PER_RESPONSE) throw new Error(`At most ${MAX_PRESENTATIONS_PER_RESPONSE} presentation cards are allowed`);
          const modelTool = agentModelToolMap.get(requested.function.name);
          if (!modelTool) throw new Error("Unknown presentation tool");
          const presentation = await modelTool.execute(input) as AgentPresentation;
          presentations.push(presentation);
          result = {
            status: "presented",
            presentationIndex: presentations.length - 1,
            type: presentation.type,
            ...(presentation.type === "split_bill" ? { title: presentation.title, calculation: presentation.calculation } : {}),
          };
        } catch (error) {
          const failure = typedToolError(error, "Invalid presentation", "validation_failed");
          if (leasedToolNames.has(requested.function.name)) nextLeasedToolNames.add(requested.function.name);
          result = failure;
        }
      } else if (!agentModelToolMap.has(requested.function.name)) {
        result = typedToolError(new Error("Unknown or unavailable agent tool"), "Unknown agent tool", "unavailable_tool");
      } else {
        try {
          const modelTool = agentModelToolMap.get(effectiveToolName);
          if (!modelTool) throw new Error("Unknown or unavailable agent tool");
          if (modelTool.kind === "read") {
            effectiveInput = normalizeOptimisticReadInput(effectiveToolName, input as Record<string, unknown>);
            recordedCall.input = effectiveInput;
            validateModelToolInput(modelTool, effectiveInput);
            result = await modelTool.execute(effectiveInput, executionContext);
          } else {
            if (!leasedToolNames.has(effectiveToolName)) throw new Error("Load this capability schema before calling it");
            effectiveInput = normalizeLeasedToolInput(effectiveToolName, input as Record<string, unknown>);
            recordedCall.input = effectiveInput;
            result = await modelTool.execute(effectiveInput, executionContext);
          }
        } catch (error) {
          if (error instanceof ModelToolInputValidationError && agentReadToolNames.has(effectiveToolName)) {
            nextLeasedToolNames.add(effectiveToolName);
            result = { ...typedToolError(error, "Invalid read arguments", "validation_failed", effectiveInput), loadedSchema: effectiveToolName };
          } else {
            const failure = typedToolError(error, "Tool execution failed");
            if (leasedToolNames.has(effectiveToolName) && failure.error.code === "validation_failed") nextLeasedToolNames.add(effectiveToolName);
            result = failure;
          }
        }
      }
      const detail = progressDetail(effectiveToolName, result);
      onProgress({ ...progress, status: "completed", ...(detail ? { detail } : {}) });
      const isPrepareTool = effectiveToolName === "prepare_expense" || effectiveToolName === "prepare_income" || effectiveToolName === "prepare_transfer" || effectiveToolName === "prepare_expense_batch";
      const modelResult = isPrepareTool ? redactApprovalTokens(result) : result;
      if (isPrepareTool) collectPendingActions(result, pendingActions);
      if (requested.function.name !== invokeReadTools.function.name) toolResults.push({ id: requested.id, name: effectiveToolName, result: modelResult });
      const modelTool = agentModelToolMap.get(effectiveToolName);
      const evidenceId = randomUUID();
      if (requested.function.name === invokeReadTools.function.name) {
        messages.push({ role: "tool", tool_call_id: requested.id, content: safeToolResult(modelResult) });
      } else if (modelTool?.kind === "presentation" && !isFailedToolResult(modelResult)) {
        const revision = await getFinancialRevision();
        messages.push({ role: "tool", tool_call_id: requested.id, content: JSON.stringify(projectModelToolResult(modelTool, modelResult, effectiveInput, evidenceId, revision)) });
      } else if (modelTool && !isFailedToolResult(modelResult)) {
        const revision = isRecord(result) && typeof result.revision === "number" ? result.revision : await getFinancialRevision();
        const evidence = projectModelToolResult(modelTool, modelResult, effectiveInput, evidenceId, revision);
        const candidateState = new Map(evidenceState);
        candidateState.set(normalizeEvidenceKey(effectiveToolName, effectiveInput, revision), evidence);
        if (JSON.stringify(evidence).length > MAX_SINGLE_MODEL_EVIDENCE_CHARS) {
          messages.push({ role: "tool", tool_call_id: requested.id, content: JSON.stringify({ status: "error", error: { code: "scope_too_large", message: "The requested selection is too large for the model context. Request a narrower filter, an explicit top count, an aggregation, or the next page." } }) });
        } else if (evidenceStateSize(candidateState) >= AGENT_EVIDENCE_HARD_CHARS) {
          messages.push({ role: "tool", tool_call_id: requested.id, content: JSON.stringify({ status: "error", error: { code: "context_budget_exceeded", message: "This result is too large to retain with current evidence. Release evidence or request a narrower selection." } }) });
        } else {
          evidenceState.clear();
          for (const [key, value] of candidateState) evidenceState.set(key, value);
          evidenceById.set(evidenceId, evidence);
          messages.push({ role: "tool", tool_call_id: requested.id, content: JSON.stringify(evidence) });
        }
      } else {
        messages.push({ role: "tool", tool_call_id: requested.id, content: safeToolResult(modelResult) });
      }
      callsUsed += callCost;
      if (clarificationRequested) break;
    }
    leasedToolNames = nextLeasedToolNames;
    messages = compactToolTranscript(messages, evidenceState, activeInsights);
    if (clarificationRequested) break;
  }

  if (clarifications.length === 0 && (!completedWithAnswer || !lastContent.trim())) {
    const finalResponse = await streamOpenRouterAgent({
      apiKey: providerConfig.apiKey,
      messages: [...messages, { role: "user", content: "Synthesize a useful, direct answer from the tool results already provided. Do not request another tool and do not return an empty message." }],
      tools: [],
      model: providerConfig.model,
      baseUrl: providerConfig.baseUrl,
      onTextDelta: (text) => { lastContent += text; onTextDelta(text); },
      signal,
    });
    addProviderUsage(usageAccumulator, finalResponse.usage);
    if (typeof finalResponse.message.content === "string" && !lastContent) lastContent = finalResponse.message.content;
  }

  const usage = finishAgentUsage(usageAccumulator);
  return {
    answer: lastContent || (clarifications.length > 0 ? "I need one detail before I continue." : "I could not complete the analysis from the available ledger tools."),
    llmAvailable: true,
    context: null,
    scope,
    toolCalls,
    toolResults,
    pendingActions,
    clarifications,
    presentations,
    revision: await getFinancialRevision(),
    ...(usage ? { usage } : {}),
  };
}

type AgentQueryBody = { question?: unknown; periodId?: unknown; startDate?: unknown; endDate?: unknown; conversationId?: unknown; replaceMessageId?: unknown; images?: unknown };
type AgentQueryResult = Awaited<ReturnType<typeof answerWithTools>>;

async function executeAgentQuery(
  request: { user?: unknown },
  body: AgentQueryBody,
  answer: (question: string, scopeInput: ReturnType<typeof parseAgentScopeInput>, history: AgentChatMessage[], images: AgentImageAttachment[], memories: AgentMemoryContext[], nickname: string | null, executionContext: AgentToolExecutionContext) => Promise<AgentQueryResult>,
) {
  const question = (body.question as string).trim();
  const ownerEmail = currentOwnerEmail(request);
  const [memories, nickname] = await Promise.all([ownerMemories(ownerEmail), ownerNickname(ownerEmail)]);
  const suppliedImages = parseAgentImages(body.images);
  let images = suppliedImages;
  const scopeInput = parseAgentScopeInput({ periodId: body.periodId, startDate: body.startDate, endDate: body.endDate });
  const conversationId = body.conversationId == null ? null : Number(body.conversationId);
  const replaceMessageId = body.replaceMessageId == null ? null : Number(body.replaceMessageId);
  if (conversationId != null && (!Number.isSafeInteger(conversationId) || conversationId <= 0)) {
    throw new Error("Invalid conversation ID");
  }
  if (replaceMessageId != null && (!Number.isSafeInteger(replaceMessageId) || replaceMessageId <= 0)) {
    throw new Error("Invalid message to retry");
  }
  if (replaceMessageId != null && conversationId == null) throw new Error("A saved conversation is required to retry a message");
  if (replaceMessageId != null && suppliedImages.length > 0) throw new Error("Retrying a message with new image attachments is not supported");

  let history: AgentChatMessage[] = [];
  let conversation: typeof agentConversations.$inferSelect | undefined;
  let userMessageId: number | null = null;
  if (conversationId != null) {
    conversation = await ownedConversation(conversationId, ownerEmail);
    if (!conversation) throw new Error("Conversation not found");
    if (suppliedImages.length === 0 && (replaceMessageId != null || referencesStoredImage(question))) {
      images = await rehydrateRecentAgentImages(conversationId);
    }
    if (replaceMessageId != null) {
      const [target] = await db.select({ id: agentMessages.id, role: agentMessages.role, createdAt: agentMessages.createdAt })
        .from(agentMessages)
        .where(and(eq(agentMessages.id, replaceMessageId), eq(agentMessages.conversationId, conversationId)))
        .limit(1);
      const [latestUser] = await db.select({ id: agentMessages.id })
        .from(agentMessages)
        .where(and(eq(agentMessages.conversationId, conversationId), eq(agentMessages.role, "user")))
        .orderBy(desc(agentMessages.id))
        .limit(1);
      if (!target || target.role !== "user" || latestUser?.id !== target.id) {
        throw new Error("Only the latest user message can be edited or retried");
      }
      // Replacing a turn also abandons unconfirmed proposals made in that
      // turn. Otherwise an old card could remain postable after its source
      // instruction was edited or retried.
      db.transaction((tx) => {
        const pendingActions = tx.select({ id: agentPendingActions.id })
          .from(agentPendingActions)
          .where(and(
            eq(agentPendingActions.conversationId, conversationId),
            eq(agentPendingActions.status, "pending"),
            gte(agentPendingActions.createdAt, target.createdAt),
          )).all();
        const pendingActionIds = pendingActions.map((action) => action.id);
        if (pendingActionIds.length > 0) {
          tx.update(agentApprovals).set({ status: "rejected" })
            .where(and(inArray(agentApprovals.pendingActionId, pendingActionIds), eq(agentApprovals.status, "pending"))).run();
          tx.update(agentPendingActions).set({ status: "rejected", updatedAt: new Date() })
            .where(inArray(agentPendingActions.id, pendingActionIds)).run();
        }
        tx.delete(agentMessages).where(and(eq(agentMessages.conversationId, conversationId), gt(agentMessages.id, target.id))).run();
        tx.update(agentMessages).set({ content: question }).where(eq(agentMessages.id, target.id)).run();
      });
      history = await conversationHistoryBefore(conversationId, replaceMessageId);
      userMessageId = replaceMessageId;
    } else {
      history = await conversationHistory(conversationId);
      const storedQuestion = suppliedImages.length > 0
        ? `${question}\n\n[${suppliedImages.length} image attachment${suppliedImages.length === 1 ? "" : "s"} provided for this turn; attachments are retained for conversation display.]`
        : question;
      const [stored] = await db.insert(agentMessages).values({ conversationId, role: "user", content: storedQuestion }).returning({ id: agentMessages.id });
      userMessageId = stored?.id ?? null;
      if (userMessageId != null && suppliedImages.length > 0) {
        try {
          await retainAgentImageAttachments(conversationId, userMessageId, suppliedImages);
        } catch (error) {
          await db.delete(agentMessages).where(eq(agentMessages.id, userMessageId));
          throw new Error(`Failed to store image attachments: ${error instanceof Error ? error.message : "storage unavailable"}`);
        }
      }
    }
    const currentRevision = await getFinancialRevision();
    const insights = await conversationInsightPrompt(conversationId, currentRevision, question);
    if (insights.length > 0) {
      history = [{ role: "system", content: "Active conversation insights (derived and revision-bound; verify with fresh tools):\n" + insights.map((claim) => "- " + claim).join("\n") }, ...history];
    }
    await db.update(agentConversations)
      .set({ updatedAt: new Date() })
      .where(eq(agentConversations.id, conversationId));
  }

  let result: AgentQueryResult;
  try {
    result = await answer(question, scopeInput, history, images, memories, nickname, { ownerEmail, conversationId });
  } catch (error) {
    // Do not leave a failed first turn stuck as an untitled skeleton. This is
    // only a fallback; successful turns get an LLM summary below.
    if (conversationId != null) {
      await db.update(agentConversations)
        .set({ title: conversationTitle(question), titleSource: "auto", updatedAt: new Date() })
        .where(and(
          eq(agentConversations.id, conversationId),
          eq(agentConversations.ownerEmail, ownerEmail),
          eq(agentConversations.titleSource, "auto"),
          eq(agentConversations.title, "New conversation"),
        ));
    }
    throw error;
  }
  if (conversationId != null) {
    const displayText = result.answer ?? result.message ?? "I could not complete the analysis from the available ledger tools.";
    const [assistantMessage] = await db.insert(agentMessages).values({
      conversationId,
      role: "assistant",
      content: displayText,
      responseJson: JSON.stringify(redactApprovalTokens(result)),
      ...(result.usage ? {
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        estimatedCostUsd: result.usage.estimatedCostUsd,
      } : {}),
    }).returning({ id: agentMessages.id });
    if (conversation?.titleSource === "auto" && conversation.title === "New conversation") {
      // Title generation is convenience work. Persist a small durable task so
      // it can finish after the response, retry on provider failure, and never
      // overwrite a manual rename made while the model is working.
      try {
        await createBackgroundTask({
          queueName: "fainens-agent",
          jobName: "conversation-title",
          dedupeKey: `conversation-title:${conversationId}:${userMessageId ?? question}`,
          ownerEmail,
          subjectType: "agent_conversation",
          subjectId: conversationId,
          payload: { conversationId, assistantMessageId: assistantMessage?.id ?? null },
          maxAttempts: 3,
        });
      } catch (error) {
        // Title generation must not turn a successful agent response into a
        // failed request if the optional task table/queue is unavailable.
        console.warn("Conversation title task was not queued", error instanceof Error ? error.message : error);
      }
    } else {
      await db.update(agentConversations).set({ updatedAt: new Date() }).where(eq(agentConversations.id, conversationId));
    }
    await refreshConversationSummary(conversationId);
  }
  return { ...result, conversationId: conversation?.id ?? null, userMessageId };
}

export default async function agentRoutes(fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/agent/tools", {
    schema: { operationId: "listAgentTools", tags: ["agent"], response: { 200: z.object({ schemaVersion: z.number().int(), revision: z.number().int(), tools: z.array(z.unknown()), presentationTools: z.array(z.unknown()), toolGroups: z.record(z.string(), z.array(z.string())), policy: z.object({ readOnly: z.boolean(), writesRequireExplicitConfirmation: z.boolean(), guardedActions: z.array(z.string()) }).passthrough() }).passthrough() } },
  }, async () => ({
    schemaVersion: 8,
    revision: await getFinancialRevision(),
    tools: agentToolDefinitions,
    presentationTools,
    toolGroups: agentToolGroups,
    policy: {
      readOnly: true,
      writesRequireExplicitConfirmation: true,
      guardedActions: ["budget_plan_upsert", "transaction_journal_create"],
    },
  }));

  fastify.get("/api/agent/profile", {
    schema: { operationId: "getAgentProfile", tags: ["agent"], response: { 200: agentProfileSchema, 400: agentErrorSchema } },
  }, async (request, reply) => {
    try {
      const ownerEmail = currentOwnerEmail(request);
      const [profile] = await db.select({ nickname: agentProfiles.nickname })
        .from(agentProfiles)
        .where(eq(agentProfiles.ownerEmail, ownerEmail))
        .limit(1);
      return { nickname: parseNickname(profile?.nickname) };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not load agent profile" });
    }
  });

  fastify.put("/api/agent/profile", {
    schema: { operationId: "updateAgentProfile", tags: ["agent"], body: z.object({ nickname: z.string().max(MAX_AGENT_NICKNAME_LENGTH).nullable().optional() }).passthrough(), response: { 200: agentProfileSchema, 400: agentErrorSchema } },
  }, async (request, reply) => {
    try {
      const ownerEmail = currentOwnerEmail(request);
      const body = request.body as { nickname?: unknown };
      const nickname = parseNickname(body?.nickname);
      const [existing] = await db.select({ ownerEmail: agentProfiles.ownerEmail })
        .from(agentProfiles)
        .where(eq(agentProfiles.ownerEmail, ownerEmail))
        .limit(1);
      if (existing) {
        await db.update(agentProfiles)
          .set({ nickname, updatedAt: new Date() })
          .where(eq(agentProfiles.ownerEmail, ownerEmail));
      } else {
        await db.insert(agentProfiles).values({ ownerEmail, nickname });
      }
      return { nickname };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not save agent profile" });
    }
  });

  fastify.get("/api/agent/memories", {
    schema: { operationId: "listAgentMemories", tags: ["agent"], response: { 200: z.object({ memories: z.array(agentMemorySchema), limits: agentMemoryLimitsSchema }).passthrough(), 401: agentErrorSchema } },
  }, async (request, reply) => {
    try {
      const ownerEmail = currentOwnerEmail(request);
      const memories = await db.select().from(agentMemories)
        .where(eq(agentMemories.ownerEmail, ownerEmail))
        .orderBy(asc(agentMemories.updatedAt), asc(agentMemories.id));
      return { memories: memories.map(memoryResponse), limits: { maxItems: MAX_AGENT_MEMORIES, maxLabelLength: MAX_AGENT_MEMORY_LABEL_LENGTH, maxContentLength: MAX_AGENT_MEMORY_CONTENT_LENGTH } };
    } catch (error) {
      return reply.code(401).send({ error: error instanceof Error ? error.message : "Could not list personal memories" });
    }
  });

  fastify.post("/api/agent/memories", {
    schema: { operationId: "createAgentMemory", tags: ["agent"], body: z.object({ label: z.string().trim().min(1).max(MAX_AGENT_MEMORY_LABEL_LENGTH), content: z.string().trim().min(1).max(MAX_AGENT_MEMORY_CONTENT_LENGTH) }).passthrough(), response: { 201: z.object({ memory: agentMemorySchema }).passthrough(), 400: agentErrorSchema, 409: agentErrorSchema } },
  }, async (request, reply) => {
    try {
      const ownerEmail = currentOwnerEmail(request);
      const body = request.body as { label?: unknown; content?: unknown };
      const label = parseMemoryField(body?.label, "label", MAX_AGENT_MEMORY_LABEL_LENGTH);
      const content = parseMemoryField(body?.content, "content", MAX_AGENT_MEMORY_CONTENT_LENGTH);
      const existing = await db.select({ id: agentMemories.id }).from(agentMemories)
        .where(eq(agentMemories.ownerEmail, ownerEmail)).limit(MAX_AGENT_MEMORIES);
      if (existing.length >= MAX_AGENT_MEMORIES) return reply.code(409).send({ error: `You can save at most ${MAX_AGENT_MEMORIES} memories` });
      const [created] = await db.insert(agentMemories).values({ ownerEmail, label, content }).returning();
      return reply.code(201).send({ memory: memoryResponse(created) });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not create personal memory" });
    }
  });

  fastify.patch("/api/agent/memories/:id", {
    schema: { operationId: "updateAgentMemory", tags: ["agent"], params: agentActionIdParamsSchema, body: z.object({ label: z.string().trim().min(1).max(MAX_AGENT_MEMORY_LABEL_LENGTH).optional(), content: z.string().trim().min(1).max(MAX_AGENT_MEMORY_CONTENT_LENGTH).optional() }).passthrough(), response: { 200: z.object({ memory: agentMemorySchema }).passthrough(), 400: agentErrorSchema, 404: agentErrorSchema } },
  }, async (request, reply) => {
    const memoryId = Number((request.params as { id?: string }).id);
    if (!Number.isSafeInteger(memoryId) || memoryId <= 0) return reply.code(400).send({ error: "Invalid memory ID" });
    try {
      const ownerEmail = currentOwnerEmail(request);
      const body = request.body as { label?: unknown; content?: unknown };
      const hasLabel = Object.prototype.hasOwnProperty.call(body ?? {}, "label");
      const hasContent = Object.prototype.hasOwnProperty.call(body ?? {}, "content");
      if (!hasLabel && !hasContent) return reply.code(400).send({ error: "Provide label or content" });
      const updates: { label?: string; content?: string; updatedAt: Date } = { updatedAt: new Date() };
      if (hasLabel) updates.label = parseMemoryField(body?.label, "label", MAX_AGENT_MEMORY_LABEL_LENGTH);
      if (hasContent) updates.content = parseMemoryField(body?.content, "content", MAX_AGENT_MEMORY_CONTENT_LENGTH);
      const [updated] = await db.update(agentMemories).set(updates)
        .where(and(eq(agentMemories.id, memoryId), eq(agentMemories.ownerEmail, ownerEmail))).returning();
      if (!updated) return reply.code(404).send({ error: "Personal memory not found" });
      return { memory: memoryResponse(updated) };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not update personal memory" });
    }
  });

  fastify.delete("/api/agent/memories/:id", {
    schema: { operationId: "deleteAgentMemory", tags: ["agent"], params: agentActionIdParamsSchema, response: { 204: z.null(), 400: agentErrorSchema, 404: agentErrorSchema } },
  }, async (request, reply) => {
    const memoryId = Number((request.params as { id?: string }).id);
    if (!Number.isSafeInteger(memoryId) || memoryId <= 0) return reply.code(400).send({ error: "Invalid memory ID" });
    try {
      const ownerEmail = currentOwnerEmail(request);
      const result = await db.delete(agentMemories)
        .where(and(eq(agentMemories.id, memoryId), eq(agentMemories.ownerEmail, ownerEmail)));
      if (result.changes !== 1) return reply.code(404).send({ error: "Personal memory not found" });
      return reply.code(204).send();
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not delete personal memory" });
    }
  });

  fastify.get("/api/agent/conversations", {
    schema: { operationId: "listAgentConversations", tags: ["agent"], querystring: z.object({ includeArchived: z.enum(["true", "false"]).optional(), timezoneOffsetMinutes: z.coerce.number().int().min(-840).max(840).optional() }), response: { 200: agentConversationListSchema, 401: agentErrorSchema } },
  }, async (request, reply) => {
    try {
      const ownerEmail = currentOwnerEmail(request);
      const query = request.query as { includeArchived?: string };
      const includeArchived = String(query?.includeArchived ?? "").toLowerCase() === "true";
      const conversations = await db
        .select()
        .from(agentConversations)
        .where(includeArchived
          ? eq(agentConversations.ownerEmail, ownerEmail)
          : and(eq(agentConversations.ownerEmail, ownerEmail), isNull(agentConversations.archivedAt)))
        .orderBy(asc(agentConversations.archivedAt), desc(agentConversations.isPinned), desc(agentConversations.updatedAt), desc(agentConversations.id))
        .limit(100);
      const conversationIds = conversations.map((conversation) => conversation.id);
      const usageRows = conversationIds.length === 0 ? [] : await db
        .select({ conversationId: agentMessages.conversationId, promptTokens: agentMessages.promptTokens, completionTokens: agentMessages.completionTokens, totalTokens: agentMessages.totalTokens, estimatedCostUsd: agentMessages.estimatedCostUsd })
        .from(agentMessages)
        .where(and(eq(agentMessages.role, "assistant"), inArray(agentMessages.conversationId, conversationIds)));
      const usageByConversation = new Map<number, AgentUsageAccumulator>();
      for (const row of usageRows) {
        const accumulator = usageByConversation.get(row.conversationId) ?? newAgentUsageAccumulator();
        addStoredUsage(accumulator, row);
        usageByConversation.set(row.conversationId, accumulator);
      }
      const timezoneOffsetMinutes = Number((query as { timezoneOffsetMinutes?: string }).timezoneOffsetMinutes ?? 0);
      const localNow = new Date(Date.now() - timezoneOffsetMinutes * 60_000);
      const dayStart = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate()) + timezoneOffsetMinutes * 60_000;
      const dailyRows = await db
        .select({ promptTokens: agentMessages.promptTokens, completionTokens: agentMessages.completionTokens, totalTokens: agentMessages.totalTokens, estimatedCostUsd: agentMessages.estimatedCostUsd })
        .from(agentMessages)
        .innerJoin(agentConversations, eq(agentMessages.conversationId, agentConversations.id))
        .where(and(eq(agentConversations.ownerEmail, ownerEmail), eq(agentMessages.role, "assistant"), gte(agentMessages.createdAt, new Date(dayStart)), lt(agentMessages.createdAt, new Date(dayStart + 86_400_000))));
      const dailyAccumulator = newAgentUsageAccumulator();
      for (const row of dailyRows) addStoredUsage(dailyAccumulator, row);
      const dailyUsage = finishAgentUsage(dailyAccumulator) ?? null;
      return { conversations: conversations.map((conversation) => conversationSummary(conversation, finishAgentUsage(usageByConversation.get(conversation.id) ?? newAgentUsageAccumulator()))), includeArchived, dailyUsage };
    } catch (error) {
      return reply.code(401).send({ error: error instanceof Error ? error.message : "Could not list conversations" });
    }
  });

  fastify.post("/api/agent/conversations", {
    schema: { operationId: "createAgentConversation", tags: ["agent"], body: z.object({ title: z.string().trim().max(200).optional() }).passthrough(), response: { 201: z.object({ conversation: agentConversationSchema }).passthrough(), 400: agentErrorSchema } },
  }, async (request, reply) => {
    try {
      const ownerEmail = currentOwnerEmail(request);
      const body = request.body as { title?: unknown };
      const hasCustomTitle = typeof body?.title === "string" && body.title.trim().length > 0;
      const title = hasCustomTitle ? conversationTitle(body.title as string) : "New conversation";
      const [created] = await db.insert(agentConversations).values({ ownerEmail, title, titleSource: hasCustomTitle ? "manual" : "auto" }).returning();
      return reply.code(201).send({ conversation: conversationSummary(created) });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not create conversation" });
    }
  });

  fastify.get("/api/agent/conversations/:id", {
    schema: { operationId: "getAgentConversation", tags: ["agent"], params: agentActionIdParamsSchema, response: { 200: agentConversationDetailSchema, 400: agentErrorSchema, 401: agentErrorSchema, 404: agentErrorSchema } },
  }, async (request, reply) => {
    const conversationId = Number((request.params as { id?: string }).id);
    if (!Number.isSafeInteger(conversationId) || conversationId <= 0) {
      return reply.code(400).send({ error: "Invalid conversation ID" });
    }
    try {
      const conversation = await ownedConversation(conversationId, currentOwnerEmail(request));
      if (!conversation) return reply.code(404).send({ error: "Conversation not found" });
      const messages = await db
        .select()
        .from(agentMessages)
        .where(eq(agentMessages.conversationId, conversationId))
        .orderBy(asc(agentMessages.createdAt), asc(agentMessages.id));
      const attachmentRows = messages.length === 0
        ? []
        : await db
          .select()
          .from(agentMessageAttachments)
          .where(inArray(agentMessageAttachments.messageId, messages.map((message) => message.id)));
      const attachmentViews = await Promise.all(attachmentRows.map(async (attachment) => {
        try {
          const downloadUrl = isObjectStorageConfigured()
            ? await generatePresignedDownloadUrl(attachment.r2Key, 3600)
            : `/api/agent/attachments/${attachment.id}`;
          return {
            id: attachment.id,
            messageId: attachment.messageId,
            filename: attachment.filename,
            mimetype: attachment.mimetype,
            fileSize: attachment.fileSize,
            downloadUrl,
          };
        } catch {
          return null;
        }
      }));
      const attachmentsByMessage = new Map<number, AgentMessageAttachmentView[]>();
      for (const attachment of attachmentViews) {
        if (!attachment) continue;
        const current = attachmentsByMessage.get(attachment.messageId) ?? [];
        current.push({
          id: attachment.id,
          filename: attachment.filename,
          mimetype: attachment.mimetype,
          fileSize: attachment.fileSize,
          downloadUrl: attachment.downloadUrl,
        });
        attachmentsByMessage.set(attachment.messageId, current);
      }
      const conversationUsageAccumulator = newAgentUsageAccumulator();
      for (const message of messages) {
        if (message.role === "assistant") addStoredUsage(conversationUsageAccumulator, message);
      }
      return {
        conversation: conversationSummary(conversation, finishAgentUsage(conversationUsageAccumulator)),
        messages: messages.map((message) => conversationMessage(message, attachmentsByMessage.get(message.id))),
      };
    } catch (error) {
      return reply.code(401).send({ error: error instanceof Error ? error.message : "Could not load conversation" });
    }
  });

  fastify.patch("/api/agent/conversations/:id", {
    schema: { operationId: "updateAgentConversation", tags: ["agent"], params: agentActionIdParamsSchema, body: z.object({ title: z.string().trim().min(1).max(200).optional(), isPinned: z.boolean().optional(), archived: z.boolean().optional() }).passthrough(), response: { 200: z.object({ conversation: agentConversationSchema }).passthrough(), 400: agentErrorSchema, 404: agentErrorSchema } },
  }, async (request, reply) => {
    const conversationId = Number((request.params as { id?: string }).id);
    if (!Number.isSafeInteger(conversationId) || conversationId <= 0) {
      return reply.code(400).send({ error: "Invalid conversation ID" });
    }
    try {
      const ownerEmail = currentOwnerEmail(request);
      const conversation = await ownedConversation(conversationId, ownerEmail);
      if (!conversation) return reply.code(404).send({ error: "Conversation not found" });
      const body = request.body as { title?: unknown; isPinned?: unknown; archived?: unknown };
      const hasTitle = Object.prototype.hasOwnProperty.call(body ?? {}, "title");
      const hasPinned = Object.prototype.hasOwnProperty.call(body ?? {}, "isPinned");
      const hasArchived = Object.prototype.hasOwnProperty.call(body ?? {}, "archived");
      if (!hasTitle && !hasPinned && !hasArchived) return reply.code(400).send({ error: "Provide title, isPinned, or archived" });

      const updates: {
        title?: string;
        titleSource?: string;
        isPinned?: boolean;
        archivedAt?: Date | null;
        updatedAt: Date;
      } = { updatedAt: new Date() };
      if (hasTitle) {
        if (typeof body?.title !== "string" || body.title.trim().length === 0) {
          return reply.code(400).send({ error: "title must not be empty" });
        }
        updates.title = conversationTitle(body.title);
        updates.titleSource = "manual";
      }
      if (hasPinned) {
        if (typeof body?.isPinned !== "boolean") return reply.code(400).send({ error: "isPinned must be a boolean" });
        updates.isPinned = body.isPinned;
      }
      if (hasArchived) {
        if (typeof body?.archived !== "boolean") return reply.code(400).send({ error: "archived must be a boolean" });
        updates.archivedAt = body.archived ? new Date() : null;
      }
      const [updated] = await db.update(agentConversations)
        .set(updates)
        .where(and(eq(agentConversations.id, conversationId), eq(agentConversations.ownerEmail, ownerEmail)))
        .returning();
      return { conversation: conversationSummary(updated) };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not update conversation" });
    }
  });

  // Development fallback for environments without R2. Production responses
  // use short-lived R2 URLs; this route keeps local conversation images
  // private and owner-scoped as well.
  fastify.get("/api/agent/attachments/:id", {
    schema: { operationId: "serveLocalAgentAttachment", tags: ["agent"], params: agentActionIdParamsSchema, response: { 404: agentErrorSchema } },
  }, async (request, reply) => {
    const attachmentId = Number((request.params as { id?: string }).id);
    if (!Number.isSafeInteger(attachmentId) || attachmentId <= 0) return reply.code(404).send({ error: "Image not found" });
    try {
      const [attachment] = await db
        .select({ id: agentMessageAttachments.id, filename: agentMessageAttachments.filename, mimetype: agentMessageAttachments.mimetype, r2Key: agentMessageAttachments.r2Key })
        .from(agentMessageAttachments)
        .innerJoin(agentConversations, eq(agentMessageAttachments.conversationId, agentConversations.id))
        .where(and(
          eq(agentMessageAttachments.id, attachmentId),
          eq(agentConversations.ownerEmail, currentOwnerEmail(request)),
        ))
        .limit(1);
      if (!attachment) return reply.code(404).send({ error: "Image not found" });
      const filePath = getLocalFilePath(attachment.r2Key);
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) return reply.code(404).send({ error: "Image not found" });
      reply.header("Content-Type", attachment.mimetype);
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Content-Disposition", `inline; filename="${attachment.filename.replace(/["\r\n]/g, "_")}"`);
      return reply.send(createReadStream(filePath));
    } catch {
      return reply.code(404).send({ error: "Image not found" });
    }
  });

  fastify.delete("/api/agent/conversations/:id", {
    schema: { operationId: "deleteAgentConversation", tags: ["agent"], params: agentActionIdParamsSchema, response: { 204: z.null(), 400: agentErrorSchema, 401: agentErrorSchema, 404: agentErrorSchema } },
  }, async (request, reply) => {
    const conversationId = Number((request.params as { id?: string }).id);
    if (!Number.isSafeInteger(conversationId) || conversationId <= 0) {
      return reply.code(400).send({ error: "Invalid conversation ID" });
    }
    try {
      const conversation = await ownedConversation(conversationId, currentOwnerEmail(request));
      if (!conversation) return reply.code(404).send({ error: "Conversation not found" });
      const imageRows = await db
        .select({ id: agentMessageAttachments.id, r2Key: agentMessageAttachments.r2Key })
        .from(agentMessageAttachments)
        .where(eq(agentMessageAttachments.conversationId, conversationId));
      const cleanupIds = db.transaction((tx) => {
        const ids: number[] = [];
        for (const image of imageRows) {
          const [queued] = tx.insert(storageDeletionOutbox).values({
            r2Key: image.r2Key,
            entityType: "agent_message_attachment",
            entityId: image.id,
          }).returning({ id: storageDeletionOutbox.id }).all();
          if (queued) ids.push(queued.id);
        }
        tx.delete(agentConversations).where(eq(agentConversations.id, conversationId)).run();
        return ids;
      });
      if (cleanupIds.length > 0) void processStorageDeletionOutbox(cleanupIds);
      return reply.code(204).send();
    } catch (error) {
      return reply.code(401).send({ error: error instanceof Error ? error.message : "Could not delete conversation" });
    }
  });

  fastify.post("/api/agent/tool-call", {
    schema: { operationId: "executeAgentTool", tags: ["agent"], body: z.object({ name: z.string().min(1), input: z.unknown().optional() }).passthrough(), response: { 200: z.object({ tool: z.string(), revision: z.number().int(), readOnly: z.boolean(), data: z.unknown() }).passthrough(), 400: agentErrorSchema } },
  }, async (request, reply) => {
    const body = request.body as { name?: unknown; input?: unknown };
    if (typeof body?.name !== "string") return reply.code(400).send({ error: "name is required" });
    try {
      return await executeAgentTool(body.name, body.input ?? {});
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Tool execution failed" });
    }
  });

  /**
   * Prepare a mutation without changing financial data. The response contains
   * a one-time bearer token; the UI must show the normalized proposal and send
   * that token back only after the user explicitly confirms it.
   */
  fastify.post("/api/agent/actions/prepare", {
    schema: { operationId: "prepareAgentAction", tags: ["agent"], body: agentActionPrepareBodySchema, response: { 201: agentActionViewSchema, 400: agentErrorSchema, 401: agentErrorSchema, 404: agentErrorSchema, 409: agentErrorSchema, 410: agentErrorSchema, 500: agentErrorSchema } },
  }, async (request, reply) => {
    const body = request.body as {
      conversationId?: unknown;
      kind?: unknown;
      input?: unknown;
      assumptions?: unknown;
      missingFields?: unknown;
      idempotencyKey?: unknown;
    };
    try {
      const ownerEmail = currentOwnerEmail(request);
      const conversationId = body?.conversationId == null ? null : Number(body.conversationId);
      return reply.code(201).send(await prepareAgentAction({
        ownerEmail,
        conversationId,
        kind: body?.kind,
        input: body?.input,
        assumptions: body?.assumptions,
        missingFields: body?.missingFields,
        idempotencyKey: body?.idempotencyKey,
      }));
    } catch (error) {
      const status = agentRouteErrorStatus(error instanceof AgentActionError ? error.statusCode : 400);
      return reply.code(status).send({ error: error instanceof Error ? error.message : "Could not prepare agent action" });
    }
  });

  fastify.get("/api/agent/actions", {
    schema: { operationId: "listAgentActions", tags: ["agent"], querystring: z.object({ conversationId: z.string().regex(/^\d+$/).optional() }), response: { 200: z.object({ actions: z.array(agentActionListItemSchema) }).passthrough(), 400: agentErrorSchema, 401: agentErrorSchema, 404: agentErrorSchema, 409: agentErrorSchema, 410: agentErrorSchema, 500: agentErrorSchema } },
  }, async (request, reply) => {
    try {
      const ownerEmail = currentOwnerEmail(request);
      const query = request.query as { conversationId?: string };
      const conversationId = query?.conversationId == null ? undefined : Number(query.conversationId);
      if (conversationId != null && (!Number.isSafeInteger(conversationId) || conversationId <= 0)) {
        return reply.code(400).send({ error: "Invalid conversation ID" });
      }
      return { actions: await listAgentActions(ownerEmail, conversationId) };
    } catch (error) {
      const status = agentRouteErrorStatus(error instanceof AgentActionError ? error.statusCode : 400);
      return reply.code(status).send({ error: error instanceof Error ? error.message : "Could not list agent actions" });
    }
  });

  fastify.post("/api/agent/approvals/:id/execute", {
    schema: { operationId: "executeAgentApproval", tags: ["agent"], params: agentActionIdParamsSchema, body: agentApprovalBodySchema, response: { 200: agentStatusSchema, 400: agentErrorSchema, 401: agentErrorSchema, 404: agentErrorSchema, 409: agentErrorSchema, 410: agentErrorSchema, 500: agentErrorSchema } },
  }, async (request, reply) => {
    const approvalId = Number((request.params as { id?: string }).id);
    const body = request.body as { token?: unknown };
    try {
      const ownerEmail = currentOwnerEmail(request);
      return reply.send(await executeAgentApproval({ ownerEmail, approvalId, token: body?.token }));
    } catch (error) {
      const status = agentRouteErrorStatus(error instanceof AgentActionError ? error.statusCode : 409);
      return reply.code(status).send({ error: error instanceof Error ? error.message : "Could not execute agent approval" });
    }
  });

  fastify.post("/api/agent/approvals/:id/reissue", {
    schema: { operationId: "reissueAgentApproval", tags: ["agent"], params: agentActionIdParamsSchema, response: { 200: agentStatusSchema, 400: agentErrorSchema, 401: agentErrorSchema, 404: agentErrorSchema, 409: agentErrorSchema, 410: agentErrorSchema, 500: agentErrorSchema } },
  }, async (request, reply) => {
    const approvalId = Number((request.params as { id?: string }).id);
    try {
      const ownerEmail = currentOwnerEmail(request);
      return reply.send(await reissueAgentApproval({ ownerEmail, approvalId }));
    } catch (error) {
      const status = agentRouteErrorStatus(error instanceof AgentActionError ? error.statusCode : 409);
      return reply.code(status).send({ error: error instanceof Error ? error.message : "Could not restore agent approval" });
    }
  });

  fastify.post("/api/agent/approvals/:id/reject", {
    schema: { operationId: "rejectAgentApproval", tags: ["agent"], params: agentActionIdParamsSchema, body: agentApprovalBodySchema, response: { 200: agentStatusSchema, 400: agentErrorSchema, 401: agentErrorSchema, 404: agentErrorSchema, 409: agentErrorSchema, 410: agentErrorSchema, 500: agentErrorSchema } },
  }, async (request, reply) => {
    const approvalId = Number((request.params as { id?: string }).id);
    const body = request.body as { token?: unknown };
    try {
      const ownerEmail = currentOwnerEmail(request);
      return reply.send(await rejectAgentApproval({ ownerEmail, approvalId, token: body?.token }));
    } catch (error) {
      const status = agentRouteErrorStatus(error instanceof AgentActionError ? error.statusCode : 409);
      return reply.code(status).send({ error: error instanceof Error ? error.message : "Could not reject agent approval" });
    }
  });

  fastify.get("/api/agent/context", {
    schema: { operationId: "getAgentContext", tags: ["agent"], querystring: z.object({ periodId: z.string().regex(/^\d+$/).optional(), startDate: z.string().regex(/^\d+$/).optional(), endDate: z.string().regex(/^\d+$/).optional() }), response: { 200: z.unknown(), 400: agentErrorSchema } },
  }, async (request, reply) => {
    try {
      const query = request.query as { periodId?: string; startDate?: string; endDate?: string };
      const context = await composeContext(parseAgentScopeInput({
        periodId: query.periodId == null ? undefined : Number(query.periodId),
        startDate: query.startDate == null ? undefined : Number(query.startDate),
        endDate: query.endDate == null ? undefined : Number(query.endDate),
      }));
      return context;
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Failed to build agent context" });
    }
  });

  fastify.post("/api/agent/query", {
    schema: { operationId: "queryAgent", tags: ["agent"], body: agentQueryBodySchema, response: { 200: agentQueryResponseSchema, 400: agentErrorSchema, 500: agentErrorSchema } },
  }, async (request, reply) => {
    const body = request.body as AgentQueryBody;
    if (typeof body?.question !== "string" || body.question.trim().length < 2 || body.question.length > 2000) {
      return reply.code(400).send({ error: "question must be between 2 and 2000 characters" });
    }
    try {
      return await executeAgentQuery(request, body, answerWithTools);
    } catch (error) {
      fastify.log.error(error);
      if (error instanceof AgentInputError) return reply.code(400).send({ error: error.message });
      return reply.code(500).send({ error: "Failed to answer agent query" });
    }
  });

  fastify.post("/api/agent/query/stream", {
    schema: { operationId: "streamAgentQuery", tags: ["agent"], body: agentQueryBodySchema, response: { 400: agentErrorSchema, 500: agentErrorSchema } },
  }, async (request, reply) => {
    const body = request.body as AgentQueryBody;
    if (typeof body?.question !== "string" || body.question.trim().length < 2 || body.question.length > 2000) {
      return reply.code(400).send({ error: "question must be between 2 and 2000 characters" });
    }
    try {
      parseAgentImages(body.images);
    } catch (error) {
      if (error instanceof AgentInputError) return reply.code(400).send({ error: error.message });
      return reply.code(400).send({ error: "Invalid image attachment" });
    }

    reply.hijack();
    const providerAbortController = new AbortController();
    let responseFinished = false;
    const abortIfClientDisconnects = () => {
      if (!responseFinished) providerAbortController.abort();
    };
    reply.raw.once("close", abortIfClientDisconnects);
    request.raw.once("aborted", abortIfClientDisconnects);
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (event: unknown) => {
      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    // A new conversation can spend a few seconds in scope resolution or the
    // provider's first request. Send an immediate progress event and periodic
    // heartbeats so browser/proxy idle timers do not mistake a healthy first
    // turn for a dead stream.
    reply.raw.flushHeaders();
    send({ type: "progress", phase: "understand", label: "Reading your request", status: "started" });
    const heartbeat = setInterval(() => send({ type: "heartbeat" }), 15_000);
    try {
      const result = await executeAgentQuery(
        request,
        body,
        (question, scopeInput, history, images, memories, nickname, executionContext) => answerWithToolsStreaming(
          question,
          scopeInput,
          history,
          images,
          memories,
          nickname,
          (text) => send({ type: "delta", text }),
          (progress) => send({ type: "progress", ...progress }),
          executionContext,
          providerAbortController.signal,
        ),
      );
      send({ type: "complete", response: result });
    } catch (error) {
      fastify.log.error(error);
      send({ type: "error", error: error instanceof Error ? error.message : "Failed to answer agent query" });
    } finally {
      clearInterval(heartbeat);
      responseFinished = true;
      reply.raw.off("close", abortIfClientDisconnects);
      request.raw.off("aborted", abortIfClientDisconnects);
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  });

  fastify.post("/api/agent/plan-budget", {
    schema: { operationId: "previewAgentBudgetPlan", tags: ["agent"], body: agentBudgetPlanBodySchema, response: { 200: agentBudgetPlanResponseSchema, 400: agentErrorSchema } },
  }, async (request, reply) => {
    const body = request.body as { periodId?: unknown; targetSavingsRate?: unknown };
    try {
      const result = await executeAgentTool("preview_budget_plan", {
        periodId: body?.periodId,
        targetSavingsRate: body?.targetSavingsRate,
      });
      return reply.send({ revision: result.revision, ...(result.data as object) });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Failed to plan budget" });
    }
  });
}
