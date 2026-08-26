export interface AgentChatTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AgentChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
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
