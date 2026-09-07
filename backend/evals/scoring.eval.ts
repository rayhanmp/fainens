import { describe, expect, it, vi } from "vitest";
import { workflows, hasAmount } from "./cases";
import { protocolErrors } from "./provider";
import { judgeCase, redact, summarize, usageTotals, type CaseReport } from "./report";

describe("evaluation negative controls", () => {
  it("rejects a plausible answer with the wrong balance or missing ledger evidence", () => {
    expect(hasAmount({ answer: "BNI has Rp3.970.000." }, 3_960_000)).toBe(false);
    expect(hasAmount({ answer: "BNI has Rp13.960.000." }, 3_960_000)).toBe(false);
    const checks = workflows.find((w) => w.id === "named-balance")!.turns[0].checks({
      answer: "BNI has Rp3.960.000.", toolCalls: [], toolResults: [],
    }, []);
    expect(checks.some((c) => !c.passed)).toBe(true);
  });

  it("detects orphaned and unanswered provider tool calls", () => {
    expect(protocolErrors([{ role: "tool", tool_call_id: "missing", content: "{}" }])).not.toEqual([]);
    expect(protocolErrors([{ role: "assistant", tool_calls: [{ id: "one", type: "function", function: { name: "calculate", arguments: "{}" } }] }])).not.toEqual([]);
  });

  it("redacts bearer fields even in nested serialized JSON", () => {
    const redacted = redact({ responseJson: JSON.stringify({ pendingActions: [{ approvalToken: "synthetic-secret" }] }) });
    expect(JSON.stringify(redacted)).not.toContain("synthetic-secret");
  });

  it("reports missing pricing and usage as unknown, not zero", () => {
    expect(usageTotals([undefined])).toMatchObject({ promptTokens: null, costUsd: null, missingTokenUsage: 1, missingCostUsage: 1 });
  });

  it("does not let excellent judge scores override a hard failure", () => {
    const report: CaseReport = { caseId: "wrong-money", repetition: 1, transport: "query", passed: false,
      checks: [{ name: "correct amount", passed: false }], turns: [], rounds: [], latencyMs: 1, errors: [],
      judge: { grades: Object.fromEntries(["groundedness", "relevance", "clarity", "toolEfficiency"].map((key) => [key, { score: 4, reason: "Excellent" }])) },
    };
    expect(summarize([report]).passed).toBe(0);
  });

  it("rejects malformed judge output without silently granting a score", async () => {
    vi.stubEnv("EVAL_JUDGE_MODEL", "synthetic-judge");
    const report: CaseReport = { caseId: "judge-validation", repetition: 1, transport: "query", passed: true,
      checks: [], turns: [], rounds: [], latencyMs: 1, errors: [] };
    try {
      await expect(judgeCase(report, async () => ({ message: { role: "assistant", content: '{"overall":100}' } }))).rejects.toThrow();
    } finally { vi.unstubAllEnvs(); }
  });
});
