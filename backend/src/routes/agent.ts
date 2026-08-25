import type { FastifyInstance } from "fastify";

import { env } from "../lib/env";
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
import { callOpenRouterAgent, type AgentChatMessage, type AgentChatTool } from "../services/agent-llm";
import { getFinancialRevision } from "../services/financial-revision";

const MAX_TOOL_CALLS_PER_QUERY = 8;
const MAX_TOOL_ROUNDS = 4;

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
  "You are a cautious personal-finance analyst for a double-entry ledger.",
  "Use the read-only tools for every factual claim about the user's finances; do not infer missing values.",
  "Amounts are integer IDR units despite legacy field names ending in Cents.",
  "Distinguish posted actuals, drafts, forecasts, reconciliation evidence, and suggestions.",
  "Never claim to have written, deleted, reconciled, posted, skipped, or changed data.",
  "If the user requests a mutation, explain that a separate explicit confirmation action is required.",
  "State the scope, as-of date, and data revision when relevant. Mention an inconsistent revision if tools changed during retrieval.",
].join(" ");

async function answerWithTools(question: string, scopeInput: ReturnType<typeof parseAgentScopeInput>) {
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

export default async function agentRoutes(fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/agent/tools", async () => ({
    schemaVersion: 2,
    revision: await getFinancialRevision(),
    tools: agentToolDefinitions,
    policy: { readOnly: true, writesRequireExplicitConfirmation: true },
  }));

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
    const body = request.body as { question?: unknown; periodId?: unknown; startDate?: unknown; endDate?: unknown };
    if (typeof body?.question !== "string" || body.question.trim().length < 2 || body.question.length > 2000) {
      return reply.code(400).send({ error: "question must be between 2 and 2000 characters" });
    }
    try {
      return await answerWithTools(body.question.trim(), parseAgentScopeInput({
        periodId: body.periodId,
        startDate: body.startDate,
        endDate: body.endDate,
      }));
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: "Failed to answer agent query" });
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
