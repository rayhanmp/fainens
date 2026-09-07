import { env } from "../lib/env";

export interface AgentChatTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export type AgentChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface AgentChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | AgentChatContentPart[] | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export interface AgentChatResponse {
  message: AgentChatMessage;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    /** OpenRouter includes this when the provider exposes request pricing. */
    cost?: number;
  };
}

type StreamDelta = {
  content?: string | null;
  tool_calls?: Array<{
    index?: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
};

const DEFAULT_MODEL = "z-ai/glm-5.3-flash";
// Completion budget for each provider request. Tool-assisted turns can make
// several requests, so this is per model response rather than per chat.
const MAX_AGENT_OUTPUT_TOKENS = 4096;

function providerFailure(operation: "request" | "stream", status: number, providerDetail?: string): Error {
  const reason = status === 401
    ? "The configured provider rejected the API key. Check the saved model credentials."
    : status === 403
      ? "OpenRouter denied this request. Check account credits, model access, and API key permissions."
            : status === 404
            ? "The configured model or endpoint was not found. Check the saved model ID and base URL."
        : status === 429
          ? "OpenRouter rate-limited the request. Try again shortly."
          : status >= 500
            ? "OpenRouter is temporarily unavailable. Try again shortly."
            : "The configured provider returned an unexpected error.";
  return new Error(`Agent model ${operation} failed (${status}): ${reason}${providerDetail ? ` (${providerDetail})` : ""}`);
}

const PROVIDER_RETRY_ATTEMPTS = 2;
const RETRYABLE_PROVIDER_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function retryDelay(attempt: number): Promise<void> {
  // Keep the retry short enough that a chat still feels responsive while
  // allowing a provider's first cold/overloaded endpoint selection to settle.
  await new Promise<void>((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
}

async function openRouterFetch(input: RequestInit, signal: AbortSignal | undefined, baseUrl = "https://openrouter.ai/api/v1"): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < PROVIDER_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, { ...input, signal });
      if (response.ok || !RETRYABLE_PROVIDER_STATUSES.has(response.status) || attempt === PROVIDER_RETRY_ATTEMPTS - 1) {
        return response;
      }
      // The body is not needed for a retry. Releasing it avoids keeping the
      // failed provider connection alive while the next attempt starts.
      await response.body?.cancel();
    } catch (error) {
      if (isAbortError(error) || attempt === PROVIDER_RETRY_ATTEMPTS - 1) throw error;
      lastError = error;
    }
    await retryDelay(attempt);
  }
  throw lastError instanceof Error ? lastError : new Error("OpenRouter request failed");
}

async function providerErrorDetail(response: Response): Promise<string | undefined> {
  try {
    const payload = await response.clone().json() as { error?: { message?: unknown } | string; message?: unknown };
    const raw = typeof payload.error === "string"
      ? payload.error
      : payload.error && typeof payload.error === "object" && typeof payload.error.message === "string"
        ? payload.error.message
        : typeof payload.message === "string" ? payload.message : undefined;
    if (!raw) return undefined;
    return raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 240) || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Small OpenRouter adapter for the agent loop. The normal insight adapter only
 * returns text; this one intentionally preserves function calls so the route
 * can execute the application's read-only tool registry between model turns.
 */
export async function callOpenRouterAgent(input: {
  apiKey: string;
  messages: AgentChatMessage[];
  tools: AgentChatTool[];
  model?: string;
  baseUrl?: string;
  signal?: AbortSignal;
}): Promise<AgentChatResponse> {
  const response = await openRouterFetch({
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
      "HTTP-Referer": env.OPENROUTER_HTTP_REFERER ?? env.FRONTEND_URL ?? "http://localhost:8080",
    },
    body: JSON.stringify({
      model: input.model ?? DEFAULT_MODEL,
      messages: input.messages,
      ...(input.tools.length > 0 ? { tools: input.tools, tool_choice: "auto" } : {}),
      temperature: 0.2,
      max_tokens: MAX_AGENT_OUTPUT_TOKENS,
    }),
  }, input.signal, input.baseUrl);

  if (!response.ok) {
    throw providerFailure("request", response.status, await providerErrorDetail(response));
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: AgentChatMessage }>;
    usage?: AgentChatResponse["usage"];
  };
  const message = payload.choices?.[0]?.message;
  if (!message || (message.role !== "assistant" && message.role !== "tool")) {
    throw new Error("Agent model returned an invalid message");
  }
  return { message, usage: payload.usage };
}

/**
 * OpenRouter's chat-completions stream is OpenAI-compatible SSE. Accumulate
 * fragmented function-call arguments for the ledger loop while forwarding text
 * deltas immediately to the caller.
 */
export async function streamOpenRouterAgent(input: {
  apiKey: string;
  messages: AgentChatMessage[];
  tools: AgentChatTool[];
  model?: string;
  baseUrl?: string;
  onTextDelta: (text: string) => void;
  signal?: AbortSignal;
}): Promise<AgentChatResponse> {
  const response = await openRouterFetch({
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
      "HTTP-Referer": env.OPENROUTER_HTTP_REFERER ?? env.FRONTEND_URL ?? "http://localhost:8080",
    },
    body: JSON.stringify({
      model: input.model ?? DEFAULT_MODEL,
      messages: input.messages,
      tools: input.tools,
      ...(input.tools.length > 0 ? { tool_choice: "auto" } : {}),
      stream: true,
      // Ask OpenRouter to include the final usage chunk. Without this,
      // streaming responses have no reliable token accounting.
      stream_options: { include_usage: true },
      temperature: 0.2,
      max_tokens: MAX_AGENT_OUTPUT_TOKENS,
    }),
  }, input.signal, input.baseUrl);
  if (!response.ok || !response.body) {
    throw providerFailure("stream", response.status, await providerErrorDetail(response));
  }

  const decoder = new TextDecoder();
  const calls = new Map<number, NonNullable<AgentChatMessage["tool_calls"]>[number]>();
  let buffer = "";
  let content = "";
  let usage: AgentChatResponse["usage"];

  const consumeEvent = (event: string) => {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;
    let payload: { choices?: Array<{ delta?: StreamDelta }>; usage?: AgentChatResponse["usage"] };
    try {
      payload = JSON.parse(data) as { choices?: Array<{ delta?: StreamDelta }>; usage?: AgentChatResponse["usage"] };
    } catch {
      return;
    }
    if (payload.usage) usage = payload.usage;
    const delta = payload.choices?.[0]?.delta;
    if (!delta) return;
    if (typeof delta.content === "string" && delta.content) {
      content += delta.content;
      input.onTextDelta(delta.content);
    }
    for (const part of delta.tool_calls ?? []) {
      const index = part.index ?? calls.size;
      const current = calls.get(index) ?? {
        id: part.id ?? `stream-tool-${index}`,
        type: "function",
        function: { name: "", arguments: "" },
      };
      if (part.id) current.id = part.id;
      if (part.function?.name) current.function.name = part.function.name;
      if (part.function?.arguments) current.function.arguments += part.function.arguments;
      calls.set(index, current);
    }
  };

  for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";
    for (const event of events) consumeEvent(event);
  }
  buffer += decoder.decode();
  if (buffer) consumeEvent(buffer);

  return {
    message: {
      role: "assistant",
      content,
      ...(calls.size > 0 ? { tool_calls: [...calls.values()] } : {}),
    },
    ...(usage ? { usage } : {}),
  };
}
