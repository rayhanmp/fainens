import { describe, expect, it } from "vitest";

import { compactToolTranscript, evidenceStateSize, normalizeEvidenceKey, releaseEvidence, trimEvidenceState, type ModelEvidence } from "./agent-evidence";

describe("agent evidence state", () => {
  const evidence = (id: string, source: string): ModelEvidence => ({
    evidenceId: id,
    source,
    financialRevision: 4,
    data: { value: id },
    complete: true,
  });

  it("replaces the same normalized evidence key while retaining distinct evidence", () => {
    const state = new Map<string, ModelEvidence>();
    state.set(normalizeEvidenceKey("get_account_balance", { accountName: "BNI" }, 4), evidence("one", "get_account_balance"));
    state.set(normalizeEvidenceKey("get_account_balance", { accountName: "BNI" }, 4), evidence("two", "get_account_balance"));
    state.set(normalizeEvidenceKey("get_period_summary", { periodId: 7 }, 4), evidence("three", "get_period_summary"));
    expect([...state.values()].map((item) => item.evidenceId)).toEqual(["two", "three"]);
    expect(evidenceStateSize(state)).toBeGreaterThan(0);
    releaseEvidence(state, ["two"]);
    expect([...state.values()].map((item) => item.evidenceId)).toEqual(["three"]);
  });

  it("folds old tool pairs into one evidence block but keeps the current protocol pair", () => {
    const state = new Map([["key", evidence("one", "get_period_summary")]]);
    const messages = compactToolTranscript([
      { role: "system", content: "policy" },
      { role: "user", content: "old" },
      { role: "assistant", content: null, tool_calls: [{ id: "old", type: "function", function: { name: "get_period_summary", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "old", content: '{"old":true}' },
      { role: "user", content: "new" },
      { role: "assistant", content: null, tool_calls: [{ id: "new", type: "function", function: { name: "get_account_balance", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "new", content: '{"new":true}' },
    ], state, [], 0);
    const recompressed = compactToolTranscript(messages, state);
    expect(messages.filter((message) => message.role === "assistant" && message.tool_calls?.[0]?.id === "old")).toHaveLength(0);
    expect(messages.some((message) => message.role === "system" && String(message.content).includes("evidenceId"))).toBe(true);
    expect(messages.some((message) => message.role === "assistant" && message.tool_calls?.[0]?.id === "new")).toBe(true);
    expect(messages.some((message) => message.role === "tool" && message.tool_call_id === "new")).toBe(true);
    const compactEvidenceMessages = recompressed.filter((message) =>
      message.role === "system" && String(message.content).startsWith("CURRENT COMPACT EVIDENCE STATE ("));
    expect(compactEvidenceMessages).toHaveLength(1);
    expect(messages.slice(0, 3)).toEqual([
      { role: "system", content: "policy" },
      { role: "user", content: "old" },
      { role: "user", content: "new" },
    ]);
  });

  it("preserves the exact previous request prefix during small tool workflows", () => {
    const messages = [
      { role: "system" as const, content: "policy and catalog" },
      { role: "user" as const, content: "budget?" },
      { role: "assistant" as const, content: null, tool_calls: [{ id: "one", type: "function" as const, function: { name: "invoke_read_tool", arguments: "{}" } }] },
      { role: "tool" as const, tool_call_id: "one", content: '{"complete":true}' },
    ];
    const state = new Map([["one", evidence("one", "get_budget_breakdown")]]);
    expect(compactToolTranscript(messages, state)).toBe(messages);
    const nextRound = [...messages,
      { role: "assistant" as const, content: null, tool_calls: [{ id: "two", type: "function" as const, function: { name: "load_tool_schemas", arguments: "{}" } }] },
      { role: "tool" as const, tool_call_id: "two", content: '{}' },
    ];
    expect(compactToolTranscript(nextRound, state).slice(0, messages.length)).toEqual(messages);
  });

  it("keeps backend-retained historical evidence while replacing current-run evidence", () => {
    const historical = { role: "system" as const, content: "CURRENT COMPACT EVIDENCE STATE (backend-retained read-only context): historical budget" };
    const messages = compactToolTranscript([
      { role: "system", content: "policy" },
      { role: "user", content: "earlier question" },
      historical,
      { role: "user", content: "new question" },
      { role: "assistant", content: null, tool_calls: [{ id: "one", type: "function", function: { name: "update_context", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "one", content: '{}' },
    ], new Map([["one", evidence("one", "get_account_balance")]]));
    expect(messages.slice(0, 4)).toEqual([
      { role: "system", content: "policy" },
      { role: "user", content: "earlier question" }, historical,
      { role: "user", content: "new question" },
    ]);
    expect(messages[4]?.content).toContain("get_account_balance");
  });

  it("evicts the oldest evidence entry when the backend context budget is reached", () => {
    const state = new Map<string, ModelEvidence>([
      ["old", { ...evidence("old", "first"), data: { value: "x".repeat(80) } }],
      ["new", { ...evidence("new", "second"), data: { value: "y".repeat(80) } }],
    ]);
    trimEvidenceState(state, 100);
    expect([...state.keys()]).toEqual(["new"]);
  });
});
