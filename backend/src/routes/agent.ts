import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq } from "drizzle-orm";

import { env } from "../lib/env";
import { db } from "../db/client";
import { agentConversations, agentMessages } from "../db/schema";
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
} from "../services/agent-tools";
import { callOpenRouterAgent, streamOpenRouterAgent, type AgentChatMessage, type AgentChatTool } from "../services/agent-llm";
import { getFinancialRevision } from "../services/financial-revision";

const MAX_TOOL_CALLS_PER_QUERY = 8;
const MAX_TOOL_ROUNDS = 4;
const HISTORY_MESSAGE_LIMIT = 12;

const toolDefinitionMap = new Map(agentToolDefinitions.map((definition) => [definition.name, definition]));
const modelTools: AgentChatTool[] = agentToolDefinitions.map((definition) => ({
  type: "function",
  function: {
    name: definition.name,
    description: definition.description,
    parameters: definition.inputSchema,
  },
}));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestampMs(value: unknown): number {
  return value instanceof Date ? value.getTime() : Number(value);
}

function currentOwnerEmail(request: { user?: unknown }): string {
  const email = isRecord(request.user) ? request.user.email : undefined;
  if (typeof email !== "string" || email.trim() === "") {
    throw new Error("Authenticated user email is unavailable");
  }
  return email;
}

function conversationSummary(row: typeof agentConversations.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    createdAt: timestampMs(row.createdAt),
    updatedAt: timestampMs(row.updatedAt),
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

function conversationMessage(row: typeof agentMessages.$inferSelect) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    response: parseStoredResponse(row.responseJson),
    createdAt: timestampMs(row.createdAt),
  };
}

function conversationTitle(question: string): string {
  const compact = question.replace(/\s+/g, " ").trim();
  return compact.length > 72 ? `${compact.slice(0, 69)}…` : compact || "New conversation";
}

async function ownedConversation(conversationId: number, ownerEmail: string) {
  const [conversation] = await db
    .select()
    .from(agentConversations)
    .where(and(eq(agentConversations.id, conversationId), eq(agentConversations.ownerEmail, ownerEmail)))
    .limit(1);
  return conversation;
}

async function conversationHistory(conversationId: number): Promise<AgentChatMessage[]> {
  const newestFirst = await db
    .select({ role: agentMessages.role, content: agentMessages.content })
    .from(agentMessages)
    .where(eq(agentMessages.conversationId, conversationId))
    .orderBy(desc(agentMessages.createdAt), desc(agentMessages.id))
    .limit(HISTORY_MESSAGE_LIMIT);
  return newestFirst.reverse().flatMap((message): AgentChatMessage[] =>
    message.role === "user" || message.role === "assistant"
      ? [{ role: message.role, content: message.content }]
      : [],
  );
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
    schemaVersion: 3,
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

function safeToolResult(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    return serialized.length > 120_000 ? `${serialized.slice(0, 120_000)}…` : serialized;
  } catch {
    return JSON.stringify({ error: "Tool result could not be serialized" });
  }
}

const AGENT_SYSTEM_PROMPT = [
  "You are a warm, concise personal-finance assistant for a double-entry ledger.",
  "Talk naturally. For greetings, thanks, casual conversation, explanations of how the app works, or requests that do not depend on the user's recorded finances, answer directly without calling a tool.",
  "Use the read-only tools before every factual claim about the user's finances, including balances, transactions, spending, budgets, obligations, trends, or comparisons. Do not infer missing values.",
  "Do not call tools merely to greet the user or to make small talk. If a request is ambiguous about whether it refers to their data, ask one short clarifying question instead of retrieving broadly.",
  "Amounts are integer IDR units despite legacy field names ending in Cents.",
  "Distinguish posted actuals, drafts, forecasts, reconciliation evidence, and suggestions.",
  "Never claim to have written, deleted, reconciled, posted, skipped, or changed data.",
  "If the user requests a mutation, explain that a separate explicit confirmation action is required.",
  "State the scope, as-of date, and data revision when relevant. Mention an inconsistent revision if tools changed during retrieval.",
].join(" ");

async function answerWithTools(
  question: string,
  scopeInput: ReturnType<typeof parseAgentScopeInput>,
  history: AgentChatMessage[] = [],
) {
  if (!env.OPENROUTER_API_KEY) {
    const context = await composeContext(scopeInput);
    return {
      answer: null,
      llmAvailable: false,
      context,
      toolCalls: [],
      toolResults: [],
      message: "LLM is not configured; use the structured read-only context to answer locally.",
    };
  }

  const scope = await resolveAgentScope(scopeInput);
  const messages: AgentChatMessage[] = [
    { role: "system", content: AGENT_SYSTEM_PROMPT },
    ...history,
    {
      role: "user",
      content: `Question: ${question}\nRequested scope (the tools may refine this): ${JSON.stringify(scope)}`,
    },
  ];
  const toolCalls: Array<{ id: string; name: string; input: unknown }> = [];
  const toolResults: Array<{ id: string; name: string; result: unknown }> = [];
  let lastContent = "";
  let callsUsed = 0;
  let completedWithAnswer = false;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await callOpenRouterAgent({
      apiKey: env.OPENROUTER_API_KEY,
      messages,
      tools: modelTools,
    });
    const assistantMessage = response.message;
    lastContent = typeof assistantMessage.content === "string" ? assistantMessage.content : lastContent;
    const requestedCalls = assistantMessage.tool_calls ?? [];
    if (requestedCalls.length === 0) {
      completedWithAnswer = true;
      break;
    }
    if (callsUsed + requestedCalls.length > MAX_TOOL_CALLS_PER_QUERY) {
      throw new Error(`Agent tool-call limit exceeded (maximum ${MAX_TOOL_CALLS_PER_QUERY})`);
    }

    messages.push(assistantMessage);
    for (const requested of requestedCalls) {
      const definition = toolDefinitionMap.get(requested.function.name);
      const input = parseToolArguments(requested.function.arguments);
      toolCalls.push({ id: requested.id, name: requested.function.name, input });
      let result: unknown;
      if (!definition) {
        result = { error: "Unknown or unavailable agent tool" };
      } else {
        try {
          result = await executeAgentTool(requested.function.name, input);
        } catch (error) {
          result = { error: error instanceof Error ? error.message : "Tool execution failed" };
        }
      }
      toolResults.push({ id: requested.id, name: requested.function.name, result });
      messages.push({
        role: "tool",
        tool_call_id: requested.id,
        content: safeToolResult(result),
      });
      callsUsed += 1;
    }
  }

  // If the model spent the final allowed round retrieving data, give it one
  // synthesis turn with tools disabled so the response cannot end as an
  // unexplained empty tool-call transcript.
  if (!completedWithAnswer) {
    const finalResponse = await callOpenRouterAgent({
      apiKey: env.OPENROUTER_API_KEY,
      messages: [
        ...messages,
        {
          role: "user",
          content: "Synthesize the answer from the tool results already provided. Do not request another tool.",
        },
      ],
      tools: [],
    });
    if (typeof finalResponse.message.content === "string") lastContent = finalResponse.message.content;
  }

  return {
    answer: lastContent || "I could not complete the analysis from the available ledger tools.",
    llmAvailable: true,
    context: null,
    scope,
    toolCalls,
    toolResults,
    revision: await getFinancialRevision(),
  };
}

async function answerWithToolsStreaming(
  question: string,
  scopeInput: ReturnType<typeof parseAgentScopeInput>,
  history: AgentChatMessage[],
  onTextDelta: (text: string) => void,
  onTool: (name: string) => void,
) {
  if (!env.OPENROUTER_API_KEY) {
    const result = await answerWithTools(question, scopeInput, history);
    const text = result.answer ?? result.message ?? "I could not complete the analysis from the available ledger tools.";
    onTextDelta(text);
    return result;
  }

  const scope = await resolveAgentScope(scopeInput);
  const messages: AgentChatMessage[] = [
    { role: "system", content: AGENT_SYSTEM_PROMPT },
    ...history,
    { role: "user", content: `Question: ${question}\nRequested scope (the tools may refine this): ${JSON.stringify(scope)}` },
  ];
  const toolCalls: Array<{ id: string; name: string; input: unknown }> = [];
  const toolResults: Array<{ id: string; name: string; result: unknown }> = [];
  let lastContent = "";
  let callsUsed = 0;
  let completedWithAnswer = false;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await streamOpenRouterAgent({
      apiKey: env.OPENROUTER_API_KEY,
      messages,
      tools: modelTools,
      onTextDelta: (text) => { lastContent += text; onTextDelta(text); },
    });
    const assistantMessage = response.message;
    const requestedCalls = assistantMessage.tool_calls ?? [];
    if (requestedCalls.length === 0) {
      completedWithAnswer = true;
      break;
    }
    if (callsUsed + requestedCalls.length > MAX_TOOL_CALLS_PER_QUERY) {
      throw new Error(`Agent tool-call limit exceeded (maximum ${MAX_TOOL_CALLS_PER_QUERY})`);
    }

    messages.push(assistantMessage);
    for (const requested of requestedCalls) {
      const definition = toolDefinitionMap.get(requested.function.name);
      const input = parseToolArguments(requested.function.arguments);
      toolCalls.push({ id: requested.id, name: requested.function.name, input });
      onTool(requested.function.name);
      let result: unknown;
      if (!definition) {
        result = { error: "Unknown or unavailable agent tool" };
      } else {
        try {
          result = await executeAgentTool(requested.function.name, input);
        } catch (error) {
          result = { error: error instanceof Error ? error.message : "Tool execution failed" };
        }
      }
      toolResults.push({ id: requested.id, name: requested.function.name, result });
      messages.push({ role: "tool", tool_call_id: requested.id, content: safeToolResult(result) });
      callsUsed += 1;
    }
  }

  if (!completedWithAnswer) {
    const finalResponse = await streamOpenRouterAgent({
      apiKey: env.OPENROUTER_API_KEY,
      messages: [...messages, { role: "user", content: "Synthesize the answer from the tool results already provided. Do not request another tool." }],
      tools: [],
      onTextDelta: (text) => { lastContent += text; onTextDelta(text); },
    });
    if (typeof finalResponse.message.content === "string" && !lastContent) lastContent = finalResponse.message.content;
  }

  return {
    answer: lastContent || "I could not complete the analysis from the available ledger tools.",
    llmAvailable: true,
    context: null,
    scope,
    toolCalls,
    toolResults,
    revision: await getFinancialRevision(),
  };
}

type AgentQueryBody = { question?: unknown; periodId?: unknown; startDate?: unknown; endDate?: unknown; conversationId?: unknown };
type AgentQueryResult = Awaited<ReturnType<typeof answerWithTools>>;

async function executeAgentQuery(
  request: { user?: unknown },
  body: AgentQueryBody,
  answer: (question: string, scopeInput: ReturnType<typeof parseAgentScopeInput>, history: AgentChatMessage[]) => Promise<AgentQueryResult>,
) {
  const question = (body.question as string).trim();
  const scopeInput = parseAgentScopeInput({ periodId: body.periodId, startDate: body.startDate, endDate: body.endDate });
  const conversationId = body.conversationId == null ? null : Number(body.conversationId);
  if (conversationId != null && (!Number.isSafeInteger(conversationId) || conversationId <= 0)) {
    throw new Error("Invalid conversation ID");
  }

  let history: AgentChatMessage[] = [];
  let conversation: typeof agentConversations.$inferSelect | undefined;
  if (conversationId != null) {
    conversation = await ownedConversation(conversationId, currentOwnerEmail(request));
    if (!conversation) throw new Error("Conversation not found");
    history = await conversationHistory(conversationId);
    await db.insert(agentMessages).values({ conversationId, role: "user", content: question });
    await db.update(agentConversations)
      .set({ title: conversation.title === "New conversation" ? conversationTitle(question) : conversation.title, updatedAt: new Date() })
      .where(eq(agentConversations.id, conversationId));
  }

  const result = await answer(question, scopeInput, history);
  if (conversationId != null) {
    const displayText = result.answer ?? result.message ?? "I could not complete the analysis from the available ledger tools.";
    await db.insert(agentMessages).values({ conversationId, role: "assistant", content: displayText, responseJson: JSON.stringify(result) });
    await db.update(agentConversations).set({ updatedAt: new Date() }).where(eq(agentConversations.id, conversationId));
  }
  return { ...result, conversationId: conversation?.id ?? null };
}

export default async function agentRoutes(fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/agent/tools", async () => ({
    schemaVersion: 2,
    revision: await getFinancialRevision(),
    tools: agentToolDefinitions,
    policy: { readOnly: true, writesRequireExplicitConfirmation: true },
  }));

  fastify.get("/api/agent/conversations", async (request, reply) => {
    try {
      const ownerEmail = currentOwnerEmail(request);
      const conversations = await db
        .select()
        .from(agentConversations)
        .where(eq(agentConversations.ownerEmail, ownerEmail))
        .orderBy(desc(agentConversations.updatedAt), desc(agentConversations.id))
        .limit(100);
      return { conversations: conversations.map(conversationSummary) };
    } catch (error) {
      return reply.code(401).send({ error: error instanceof Error ? error.message : "Could not list conversations" });
    }
  });

  fastify.post("/api/agent/conversations", async (request, reply) => {
    try {
      const ownerEmail = currentOwnerEmail(request);
      const body = request.body as { title?: unknown };
      const title = typeof body?.title === "string" && body.title.trim()
        ? conversationTitle(body.title)
        : "New conversation";
      const [created] = await db.insert(agentConversations).values({ ownerEmail, title }).returning();
      return reply.code(201).send({ conversation: conversationSummary(created) });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not create conversation" });
    }
  });

  fastify.get("/api/agent/conversations/:id", async (request, reply) => {
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
      return { conversation: conversationSummary(conversation), messages: messages.map(conversationMessage) };
    } catch (error) {
      return reply.code(401).send({ error: error instanceof Error ? error.message : "Could not load conversation" });
    }
  });

  fastify.delete("/api/agent/conversations/:id", async (request, reply) => {
    const conversationId = Number((request.params as { id?: string }).id);
    if (!Number.isSafeInteger(conversationId) || conversationId <= 0) {
      return reply.code(400).send({ error: "Invalid conversation ID" });
    }
    try {
      const conversation = await ownedConversation(conversationId, currentOwnerEmail(request));
      if (!conversation) return reply.code(404).send({ error: "Conversation not found" });
      await db.delete(agentConversations).where(eq(agentConversations.id, conversationId));
      return reply.code(204).send();
    } catch (error) {
      return reply.code(401).send({ error: error instanceof Error ? error.message : "Could not delete conversation" });
    }
  });

  fastify.post("/api/agent/tool-call", async (request, reply) => {
    const body = request.body as { name?: unknown; input?: unknown };
    if (typeof body?.name !== "string") return reply.code(400).send({ error: "name is required" });
    try {
      return await executeAgentTool(body.name, body.input ?? {});
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Tool execution failed" });
    }
  });

  fastify.get("/api/agent/context", async (request, reply) => {
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

  fastify.post("/api/agent/query", async (request, reply) => {
    const body = request.body as AgentQueryBody;
    if (typeof body?.question !== "string" || body.question.trim().length < 2 || body.question.length > 2000) {
      return reply.code(400).send({ error: "question must be between 2 and 2000 characters" });
    }
    try {
      return await executeAgentQuery(request, body, answerWithTools);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: "Failed to answer agent query" });
    }
  });

  fastify.post("/api/agent/query/stream", async (request, reply) => {
    const body = request.body as AgentQueryBody;
    if (typeof body?.question !== "string" || body.question.trim().length < 2 || body.question.length > 2000) {
      return reply.code(400).send({ error: "question must be between 2 and 2000 characters" });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (event: unknown) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    try {
      const result = await executeAgentQuery(
        request,
        body,
        (question, scopeInput, history) => answerWithToolsStreaming(
          question,
          scopeInput,
          history,
          (text) => send({ type: "delta", text }),
          (name) => send({ type: "tool", name }),
        ),
      );
      send({ type: "complete", response: result });
    } catch (error) {
      fastify.log.error(error);
      send({ type: "error", error: error instanceof Error ? error.message : "Failed to answer agent query" });
    } finally {
      reply.raw.end();
    }
  });

  fastify.post("/api/agent/plan-budget", async (request, reply) => {
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
