import { describe, expect, it, vi } from "vitest";
import { workflows } from "./cases";
import { efficiencyBudgets, efficiencyChecks, measureEfficiency } from "./efficiency";
import { dimensionOutcome, observedToolFailures, summarize, type CaseReport } from "./report";
import { aggregateEquals, hasAmount, type Result } from "./contracts";
import type { Round } from "./provider";

const evaluate = (id: string, result: Result, turn = 0) => workflows.find((w) => w.id === id)!.turns[turn].checks(result, []);
const fails = (id: string, name: string, result: Result, turn = 0) => expect(evaluate(id, result, turn).find((c) => c.name === name)?.passed).toBe(false);
const result = (name: string, input: any, data: any, answer = "") => ({ answer,
  toolCalls: [{ id: "one", name, input }], toolResults: [{ id: "one", name, result: { status: "ok", data } }],
});
const fakeReport = (values: Partial<CaseReport> = {}): CaseReport => ({ caseId: "control", repetition: 1, transport: "query", passed: true, checks: [], turns: [], rounds: [], latencyMs: 1, errors: [], ...values });

describe("scenario quality and efficiency controls", () => {
  it("has exactly 40 distinct live workflows, with a justified budget for every turn", () => {
    const live = workflows.filter((w) => !w.offlineOnly);
    expect(live).toHaveLength(40);
    expect(new Set(workflows.map((w) => w.id)).size).toBe(workflows.length);
    expect(Object.keys(efficiencyBudgets).sort()).toEqual(live.map((w) => w.id).sort());
    for (const w of live) {
      expect(efficiencyBudgets[w.id]).toHaveLength(w.turns.length);
      for (const t of w.turns) { expect(t.truth, w.id).toMatch(/\S/); expect(t.script.length).toBeGreaterThan(0); }
      for (const b of efficiencyBudgets[w.id]) expect(b.rationale, w.id).toMatch(/\S/);
    }
  });

  it("does not require an unrequested total when the correct three expenses are listed", () => {
    expect(evaluate("counterfactual-followup", { answer: "Food Rp200.000, Travel Rp180.000, Shopping Rp160.000." }).every((c) => c.passed)).toBe(true);
  });

  it("accepts common money abbreviations without matching parts of larger numbers", () => {
    expect(hasAmount({ answer: "Rp1,5 juta" }, 1_500_000)).toBe(true);
    expect(hasAmount({ answer: "150rb" }, 150_000)).toBe(true);
    expect(hasAmount({ answer: "Rp1.040.000." }, 1_040_000)).toBe(true);
    expect(hasAmount({ answer: "128.000" }, 128)).toBe(false);
    expect(hasAmount({ answer: "1.5 million" }, 1)).toBe(false);
    expect(hasAmount({ answer: "15 juta" }, 1_500_000)).toBe(false);
  });

  it("scores both raw and wrapped aggregation contracts without a scorer crash", () => {
    const data = { groups: [{ expenseCents: 1160000 }], transactionCount: 128 };
    const r = result("summarize_transactions", {}, data);
    expect(aggregateEquals(r, 1160000, 128)).toBe(true);
    const raw = { toolResults: [{ name: "summarize_transactions", result: data }] };
    expect(aggregateEquals(raw, 1160000, 128)).toBe(true);
    expect(aggregateEquals({ toolResults: [{ name: "summarize_transactions", result: { status: "error" } }] }, 0)).toBe(false);
  });

  it("rejects correct-looking day totals obtained from the salary-period scope", () => {
    fails("jakarta-day-boundaries", "calendar range, not inherited salary-period range", result("get_period_summary", { periodId: 2 }, { facts: { totalSpentCents: 1070000 } }, "Rp1.070.000"));
  });

  it("rejects exclusive lower bounds and decoy transactions even if money is mentioned", () => {
    const r = result("find_transactions", { periodId: 2, pageSize: 10, filters: { minAmount: 150001, maxAmount: 200000 } }, { transactions: [100, 101, 102, 303].map((id) => ({ id })) }, "200000 180000 160000 150000");
    fails("inclusive-amount-boundaries", "both inclusive boundaries in backend filter", r);
    fails("inclusive-amount-boundaries", "exact qualifying rows, including the boundary", r);
  });

  it("rejects merchant search as evidence for a category total", () => {
    fails("category-not-merchant", "uses category semantics, not text search", result("summarize_transactions", { filters: { text: "Travel" } }, { groups: [{ expenseCents: 90000 }], transactionCount: 1 }, "Travel Rp180.000"));
  });

  it("rejects a partial merchant page as proof of a full total", () => {
    fails("merchant-and-account-scope", "complete scoped evidence, not a partial page sum", result("find_transactions", { filters: { accountId: 1, text: "Shayi" } }, { complete: false, transactions: [{ id: 300 }, { id: 301 }], nextCursor: "more" }, "Rp100.000"));
  });

  it("rejects a capped 100-row aggregation disguised as all activity", () => {
    fails("aggregation-beyond-page-limit", "SQL aggregation covers all 128 expenses", result("summarize_transactions", {}, { groups: [{ expenseCents: 1160000 }], transactionCount: 100 }, "128 expenses total Rp1.160.000"));
  });

  it("rejects stale account selection after an explicit correction", () => {
    fails("corrected-account-followup", "corrected account retains prior category and period", result("summarize_transactions", { periodId: 2, filters: { accountId: 2, categoryId: 1 } }, { groups: [] }, "Rp200.000"), 1);
  });

  it("rejects a proposal made before the payment account is supplied", () => {
    fails("clarify-account-before-expense", "no proposal before account is supplied", { answer: "Which account?", pendingActions: [{ approvalId: "premature" }] });
  });

  it("rejects the wrong payer and unit-price mistaken for a line total", () => {
    const r = { answer: "Ray owes Inas Rp44.080", presentations: [{ type: "split_bill", payerId: "ray", participants: [{ id: "ray", name: "Ray" }, { id: "inas", name: "Inas" }], items: [{ name: "Tea", quantity: 2, amount: 10000, participantIds: ["ray", "inas"] }], charges: {} }] };
    fails("shared-items-friend-payer", "friend is payer, user resolved to Ray", r);
    fails("shared-items-friend-payer", "line totals, quantities and item ownership preserved", r);
  });

  it("does not accept similarity scores without the reference-bearing details", () => {
    fails("similar-is-not-duplicate", "reference-bearing details read for all three", result("find_similar_transactions", { transactionId: 310, selection: { mode: "top", count: 2 } }, { candidates: [{ id: 311 }, { id: 312 }] }, "Possible duplicate CAFE-A vs CAFE-B"));
  });

  it("rejects a partial-period comparison with no coverage caveat", () => {
    fails("partial-period-comparison", "discloses incomplete comparison", { answer: "Food went from Rp40.000 to Rp200.000, up Rp160.000." });
  });

  it("rejects a correct hypothetical answer that also prepares a budget mutation", () => {
    fails("hypothetical-budget-reallocation", "does not invoke preparation for a hypothetical", { answer: "350000 150000 250000 70000", toolCalls: [{ name: "prepare_budget" }] });
  });

  it("rejects counting internal transfers as expenses, and a positive net", () => {
    const r = result("get_period_summary", { periodId: 2 }, { facts: { totalSpentCents: 1290000, totalIncomeCents: 1000000 } }, "Spending Rp1.040.000, income Rp1.000.000. Net surplus Rp40.000.");
    fails("transfer-not-spending", "ledger excludes transfer from both totals", r);
    fails("transfer-not-spending", "net direction is negative", r);
  });

  it("rejects interpreting a freelance receipt as an expense", () => {
    fails("income-not-expense-approval", "one correctly interpreted income proposal", { ...result("prepare_expense", { amountCents: 1500000, accountId: 1 }, {}), pendingActions: [{}] });
  });

  it("separates excessive rounds from correct answers; identical reads canonicalize key order", () => {
    const first = result("get_account_balance", { accountId: 1, asOfDate: 123 }, { balance: 10 });
    const second = result("get_account_balance", { asOfDate: 123, accountId: 1 }, { balance: 10 });
    second.toolCalls[0].id = "two"; second.toolResults[0].id = "two";
    const combined = { toolCalls: [...first.toolCalls, ...second.toolCalls], toolResults: [...first.toolResults, ...second.toolResults] };
    expect(measureEfficiency(combined, 2).repeatedReads).toBe(1);
    expect(efficiencyChecks("named-balance", 0, first, 9).checks.some((c) => !c.passed && c.dimension === "efficiency")).toBe(true);
    second.toolCalls[0].input.accountId = 2;
    expect(measureEfficiency({ ...combined, toolCalls: [...first.toolCalls, ...second.toolCalls] }, 2).repeatedReads).toBe(0);
  });

  it("counts tool failures from an aborted turn exactly once", () => {
    const round: Round = { tools: [], requestChars: 100, schemaChars: 50, evidenceBlocks: 0, protocolErrors: [], latencyMs: 1, messages: [{ role: "tool", tool_call_id: "bad", content: JSON.stringify({ status: "error", error: { code: "validation_failed" } }) }], response: { message: { role: "assistant", tool_calls: [{ id: "bad", type: "function", function: { name: "invoke_read_tool", arguments: '{"name":"find_transactions"}' } }] } } };
    const r = fakeReport({ rounds: [round, round], turns: [{ question: "Next?", truth: "More rows", response: {}, completed: false }], errors: ["call budget"] });
    expect(observedToolFailures(r)).toHaveLength(1);
    expect(observedToolFailures(r)[0].name).toBe("find_transactions");
    expect(dimensionOutcome(r, "correctness")).toBe("incomplete");
    expect(dimensionOutcome(r, "reliability")).toBe("fail");
    expect(summarize([r]).toolFailures).toBe(1);
  });

  it("does not mark measured provider usage unknown for a locally blocked call", () => {
    const actual: Round = { tools: [], messages: [], requestChars: 100, schemaChars: 50, evidenceBlocks: 0, protocolErrors: [], latencyMs: 1,
      response: { message: { role: "assistant", content: "done" }, usage: { prompt_tokens: 50, completion_tokens: 10, cost: 0.01 } } };
    const blocked: Round = { ...actual, response: undefined, blockedLocally: true, error: "local budget" };
    vi.stubEnv("EVAL_LIVE", "1");
    try {
      expect(summarize([fakeReport({ rounds: [actual, blocked] })])).toMatchObject({ providerCalls: 2, locallyBlockedCalls: 1, measuredUsage: { promptTokens: 50, completionTokens: 10, costUsd: 0.01, missingTokenUsage: 0 } });
      expect(summarize([fakeReport({ rounds: [{ ...blocked, blockedLocally: false }] })]).measuredUsage?.missingTokenUsage).toBe(1);
    } finally { vi.unstubAllEnvs(); }
  });
});
