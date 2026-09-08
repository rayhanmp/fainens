export const AGENT_CONTEXT_FIELDS = [
  "fullName",
  "preferredName",
  "pronouns",
  "age",
  "country",
  "timezone",
  "language",
  "currency",
  "incomePattern",
  "primaryGoal",
  "agentTone",
  "agentVerbosity",
] as const;

export type AgentContextField = typeof AGENT_CONTEXT_FIELDS[number];
export type AgentContextPreferences = Record<AgentContextField, boolean>;

export const DEFAULT_AGENT_CONTEXT_PREFERENCES: AgentContextPreferences = {
  fullName: false,
  preferredName: true,
  pronouns: false,
  age: false,
  country: false,
  timezone: true,
  language: true,
  currency: true,
  incomePattern: false,
  primaryGoal: false,
  agentTone: true,
  agentVerbosity: true,
};

export function parseAgentContextPreferences(value: unknown): AgentContextPreferences {
  let source: Record<string, unknown> = {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) source = parsed as Record<string, unknown>;
    } catch {
      // Invalid legacy data falls back to privacy-first defaults.
    }
  } else if (value && typeof value === "object" && !Array.isArray(value)) {
    source = value as Record<string, unknown>;
  }

  return AGENT_CONTEXT_FIELDS.reduce((preferences, field) => {
    preferences[field] = typeof source[field] === "boolean"
      ? source[field] as boolean
      : DEFAULT_AGENT_CONTEXT_PREFERENCES[field];
    return preferences;
  }, { ...DEFAULT_AGENT_CONTEXT_PREFERENCES });
}
