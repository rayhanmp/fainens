import { describe, expect, it } from "vitest";

import { compactToolTranscript, evidenceStateSize, normalizeEvidenceKey, releaseEvidence, type ModelEvidence } from "./agent-evidence";

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
    ], state);
    const recompressed = compactToolTranscript(messages, state);
    expect(messages.filter((message) => message.role === "assistant" && message.tool_calls?.[0]?.id === "old")).toHaveLength(0);
    expect(messages.some((message) => message.role === "system" && String(message.content).includes("evidenceId"))).toBe(true);
    expect(messages.some((message) => message.role === "assistant" && message.tool_calls?.[0]?.id === "new")).toBe(true);
    expect(messages.some((message) => message.role === "tool" && message.tool_call_id === "new")).toBe(true);
    const compactEvidenceMessages = recompressed.filter((message) =>
      message.role === "system" && String(message.content).startsWith("CURRENT COMPACT EVIDENCE STATE ("));
    expect(compactEvidenceMessages).toHaveLength(1);
  });
});
