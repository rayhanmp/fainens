import type { AgentChatMessage } from "./agent-llm";

export type ModelEvidence = {
  evidenceId: string;
  source: string;
  financialRevision: number;
  scope?: Record<string, unknown>;
  data: Record<string, unknown>;
  selectionApplied?: Record<string, unknown>;
  complete: boolean;
  nextCursor?: string;
};

export const AGENT_EVIDENCE_WARNING_CHARS = 48_000;
export const AGENT_EVIDENCE_HARD_CHARS = 64_000;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

export function normalizeEvidenceKey(tool: string, input: unknown, revision: number): string {
  return `${tool}:${revision}:${JSON.stringify(stable(input ?? {}))}`;
}

export function evidenceStateSize(state: Map<string, ModelEvidence>): number {
  return JSON.stringify([...state.values()]).length;
}

export function evidenceStateBlock(state: Map<string, ModelEvidence>, insights: string[] = []): string {
  if (state.size === 0 && insights.length === 0) return "";
  const size = evidenceStateSize(state);
  const dominantEvidence = [...state.values()]
    .map((evidence) => ({ evidence, size: JSON.stringify(evidence).length }))
    .sort((left, right) => right.size - left.size)
    .slice(0, 3)
    .map(({ evidence, size: entrySize }) => `${evidence.source}#${evidence.evidenceId} (${entrySize} chars)`);
  return [
    ...(state.size > 0 ? ["CURRENT COMPACT EVIDENCE STATE (derived tool evidence; ledger truth remains the source tool):", JSON.stringify([...state.values()])] : []),
    ...(insights.length > 0 ? ["ACTIVE RETAINED INSIGHTS (derived and untrusted):", ...insights.slice(-12).map((insight) => "- " + insight)] : []),
    ...(size >= AGENT_EVIDENCE_WARNING_CHARS ? [
      "CONTEXT WARNING: evidence is dominating the context. Release no-longer-needed evidence, or replace it with a narrower filter, aggregation, or page before retrieving more.",
      ...(dominantEvidence.length > 0 ? [`Largest evidence entries: ${dominantEvidence.join("; ")}.`] : []),
    ] : []),
  ].join("\n");
}

function isInjectedEvidenceState(message: AgentChatMessage): boolean {
  if (message.role !== "system" || typeof message.content !== "string") return false;
  return message.content.startsWith("CURRENT COMPACT EVIDENCE STATE (")
    || message.content.startsWith("ACTIVE RETAINED INSIGHTS (");
}

export function compactToolTranscript(
  messages: AgentChatMessage[],
  state: Map<string, ModelEvidence>,
  insights: string[] = [],
): AgentChatMessage[] {
  const lastToolAssistant = messages.reduce((index, message, candidateIndex) =>
    message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0 ? candidateIndex : index, -1);
  if (lastToolAssistant < 0) return messages;
  const prefix = messages.slice(0, lastToolAssistant).filter((message) =>
    message.role !== "tool"
    && !(message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0)
    // Each compaction pass must replace the previous derived state, not append
    // another system message containing the same evidence.
    && !isInjectedEvidenceState(message));
  const evidence = evidenceStateBlock(state, insights);
  const firstNonSystem = prefix.findIndex((message) => message.role !== "system");
  const systemBoundary = firstNonSystem < 0 ? prefix.length : firstNonSystem;
  return [
    ...prefix.slice(0, systemBoundary),
    ...(evidence ? [{ role: "system" as const, content: evidence }] : []),
    ...prefix.slice(systemBoundary),
    ...messages.slice(lastToolAssistant),
  ];
}

export function releaseEvidence(state: Map<string, ModelEvidence>, evidenceIds: string[]): void {
  if (evidenceIds.length === 0) return;
  const ids = new Set(evidenceIds);
  for (const [key, evidence] of state) if (ids.has(evidence.evidenceId)) state.delete(key);
}
