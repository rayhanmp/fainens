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
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
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

const DEFAULT_MODEL = "google/gemini-3.7-flash";

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
}): Promise<AgentChatResponse> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
      "HTTP-Referer": process.env.FRONTEND_URL || "http://localhost:8080",
    },
    body: JSON.stringify({
      model: input.model ?? DEFAULT_MODEL,
      messages: input.messages,
      tools: input.tools,
      ...(input.tools.length > 0 ? { tool_choice: "auto" } : {}),
      temperature: 0.2,
      max_tokens: 1200,
    }),
  });

  if (!response.ok) {
    // Do not echo provider response bodies into the API; they can contain
    // request metadata or provider-specific details that are not user-safe.
    throw new Error(`Agent model request failed (${response.status})`);
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
  onTextDelta: (text: string) => void;
  signal?: AbortSignal;
}): Promise<AgentChatResponse> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
      "HTTP-Referer": process.env.FRONTEND_URL || "http://localhost:8080",
    },
    body: JSON.stringify({
      model: input.model ?? DEFAULT_MODEL,
      messages: input.messages,
      tools: input.tools,
      ...(input.tools.length > 0 ? { tool_choice: "auto" } : {}),
      stream: true,
      temperature: 0.2,
      max_tokens: 1200,
    }),
    signal: input.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`Agent model stream failed (${response.status})`);
  }

  const decoder = new TextDecoder();
  const calls = new Map<number, NonNullable<AgentChatMessage["tool_calls"]>[number]>();
  let buffer = "";
  let content = "";

  const consumeEvent = (event: string) => {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;
    let payload: { choices?: Array<{ delta?: StreamDelta }> };
    try {
      payload = JSON.parse(data) as { choices?: Array<{ delta?: StreamDelta }> };
    } catch {
      return;
    }
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
  };
}
