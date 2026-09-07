import { performance } from "node:perf_hooks";
import type { AgentChatMessage, AgentChatResponse, AgentChatTool, callOpenRouterAgent } from "../src/services/agent-llm";

export type ProviderInput = Parameters<typeof callOpenRouterAgent>[0];
export type ScriptStep = AgentChatResponse | ((input: ProviderInput) => AgentChatResponse);
export type Round = {
  messages: AgentChatMessage[]; tools: AgentChatTool[]; model?: string;
  requestChars: number; schemaChars: number; evidenceBlocks: number;
  protocolErrors: string[]; latencyMs: number; response?: AgentChatResponse; error?: string; blockedLocally?: boolean;
};
export const rounds: Round[] = [];
let script: ScriptStep[] = [];
let caseCalls = 0;
let observedCostUsd = 0;
let networkAttempts = 0;
const nativeFetch = globalThis.fetch;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export function protocolErrors(messages: AgentChatMessage[]): string[] {
  const errors: string[] = [];
  const pending = new Set<string>();
  for (const message of messages) {
    if (message.role === "tool") {
      if (!message.tool_call_id || !pending.delete(message.tool_call_id)) errors.push("orphan or duplicate tool result");
    } else {
      if (pending.size) errors.push("assistant tool calls missing results before next message");
      for (const call of message.tool_calls ?? []) {
        if (pending.has(call.id)) errors.push("duplicate tool call ID");
        pending.add(call.id);
      }
    }
  }
  if (pending.size) errors.push("unresolved tool calls at provider boundary");
  return errors;
}

export function beginCase() { rounds.length = 0; caseCalls = 0; script = []; }
export function setReplay(steps: ScriptStep[]) { script = [...steps]; }
export function remainingReplay() { return script.length; }
export function networkUsage() { return { networkAttempts, observedCostUsd }; }

export function installNetworkGuard() {
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (process.env.EVAL_LIVE !== "1" || url !== "https://openrouter.ai/api/v1/chat/completions" || init?.method !== "POST") {
      throw new Error("Evaluation blocked an unexpected network request");
    }
    if (networkAttempts >= Number(process.env.EVAL_MAX_REQUESTS ?? 100)) throw new Error("Evaluation request budget exhausted");
    if (observedCostUsd >= Number(process.env.EVAL_MAX_COST_USD ?? 2)) throw new Error("Evaluation observed-cost budget exhausted");
    networkAttempts += 1;
    return nativeFetch(input, {
      ...init,
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(45_000)])
        : AbortSignal.timeout(45_000),
    });
  };
}

export function restoreNetwork() { globalThis.fetch = nativeFetch; }
export function accountUsage(usage?: AgentChatResponse["usage"]) {
  if (typeof usage?.cost === "number") observedCostUsd += usage.cost;
}

export async function runProvider(input: ProviderInput, live: () => Promise<AgentChatResponse>, onTextDelta?: (text: string) => void) {
  const record: Round = {
    messages: clone(input.messages), tools: clone(input.tools), model: input.model,
    requestChars: JSON.stringify({ messages: input.messages, tools: input.tools }).length,
    schemaChars: JSON.stringify(input.tools).length,
    evidenceBlocks: input.messages.filter((m) => m.role === "system" && typeof m.content === "string"
      && m.content.startsWith("CURRENT COMPACT EVIDENCE STATE (")).length,
    protocolErrors: protocolErrors(input.messages), latencyMs: 0,
  };
  rounds.push(record);
  const start = performance.now();
  try {
    caseCalls += 1;
    if (caseCalls > Number(process.env.EVAL_MAX_CASE_CALLS ?? 16)) {
      record.blockedLocally = true;
      throw new Error("Evaluation case provider-call budget exhausted");
    }
    let response: AgentChatResponse;
    if (process.env.EVAL_LIVE === "1") {
      response = await live();
      accountUsage(response.usage);
    } else {
      const step = script.shift();
      if (!step) throw new Error("Replay exhausted: runtime requested an unexpected provider round");
      response = typeof step === "function" ? step(input) : clone(step);
      // Explicitly synthetic usage lets replay check route persistence; it is
      // never reported as measured model tokens or price.
      response.usage = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };
      if (onTextDelta && typeof response.message.content === "string") onTextDelta(response.message.content);
    }
    record.response = clone(response);
    return response;
  } catch (error) {
    record.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    record.latencyMs = performance.now() - start;
  }
}

let nextId = 0;
export function calls(...items: Array<[string, Record<string, unknown>]>): AgentChatResponse {
  return { message: { role: "assistant", content: null, tool_calls: items.map(([name, args]) => ({
    id: `eval-call-${++nextId}`, type: "function", function: { name, arguments: JSON.stringify(args) },
  })) } };
}
export const read = (name: string, args: Record<string, unknown> = {}) => calls(["invoke_read_tool", { name, arguments: args }]);
export const load = (...names: string[]) => calls(["load_tool_schemas", { names }]);
export const answer = (content: string): AgentChatResponse => ({ message: { role: "assistant", content } });
export function lastEvidence(input: ProviderInput, source: string): any {
  for (const message of [...input.messages].reverse()) {
    if (message.role !== "tool" || typeof message.content !== "string") continue;
    const value = JSON.parse(message.content);
    if (value.source === source) return value;
  }
  throw new Error(`Replay expected evidence from ${source}`);
}
