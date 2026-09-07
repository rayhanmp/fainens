import { agentReadToolNames } from "../src/services/agent-model-tools";
import type { Check, Result } from "./contracts";

type Budget = { maxRounds: number; maxToolCalls: number; maxRepeatedReads: number; rationale: string };
const budget = (maxRounds: number, maxToolCalls: number, rationale: string): Budget => ({ maxRounds, maxToolCalls, maxRepeatedReads: 0, rationale });
const lookup = () => budget(4, 4, "One targeted read, optional schema discovery, then answer; allows an extra round.");
const aggregation = () => budget(5, 6, "Resolve scope/entity, aggregate once, optionally visualize; no raw-page loop.");
const approval = () => budget(7, 10, "Resolve business entities, load action schema, prepare once and explain pending approval.");
// Per-turn ceilings are reviewed workflow requirements, NOT network spending
// caps or a prescribed sequence. Different valid tool strategies are allowed.
export const efficiencyBudgets: Record<string, Budget[]> = {
  "greeting": [budget(2, 0, "A greeting needs no tools, ledger reads, or visualization calls.")],
  "named-balance": [lookup()], "total-balance": [lookup()], "missing-account": [lookup()],
  "spending-all": [aggregation()], "spending-top-seven": [aggregation()], "large-transactions": [lookup()],
  "pagination-followup": [lookup(), lookup()], "full-scope-summary": [aggregation()],
  "incomplete-coverage": [lookup()], "budget-summary": [aggregation()],
  "counterfactual-followup": [aggregation(), budget(6, 8, "Resolve prior expenses, fresh cash total, calculation, optional visual; stop once answered.")],
  "fresh-after-revision": [lookup(), lookup()],
  "split-bill-calculation": [budget(6, 8, "All bill inputs supplied; calculate and present without ledger retrieval loops.")],
  "expense-approval": [approval()], "transfer-approval": [approval()], "untrusted-transaction-note": [lookup()],
  "jakarta-day-boundaries": [aggregation()], "inclusive-amount-boundaries": [lookup()],
  "category-not-merchant": [aggregation()], "merchant-and-account-scope": [aggregation()],
  "aggregation-beyond-page-limit": [aggregation()],
  "corrected-account-followup": [aggregation(), aggregation(), budget(4, 4, "Both scoped totals are in prior context; calculate or aggregate Food, not wallet balances.")],
  "clarify-account-before-expense": [budget(3, 3, "Ask for the missing payment account before preparing anything."), approval()],
  "shared-items-friend-payer": [budget(7, 10, "Interpret shared quantities and three charge rules, calculate and produce one card.")],
  "similar-is-not-duplicate": [budget(7, 10, "Discover two candidates, inspect seed and both details (parallel allowed), explain uncertainty.")],
  "partial-period-comparison": [budget(6, 8, "Resolve Food/periods, compare scoped evidence and coverage, calculate recorded difference.")],
  "hypothetical-budget-reallocation": [budget(6, 8, "Read two budgets, simulate arithmetic, optionally visualize; no preparation.")],
  "transfer-not-spending": [aggregation()], "income-not-expense-approval": [approval()],
  "casual-bank-typo": [lookup()],
  "casual-month-confusion": [budget(3, 3, "Clarify the user's unresolved calendar-versus-pay-period choice; no broad ledger read."), aggregation()],
  "casual-uncertain-amount": [budget(3, 3, "Ask about two conflicting amounts before preparing a ledger entry."), approval()],
  "casual-in-message-correction": [approval()],
  "casual-reference-after-detour": [aggregation(), lookup(), budget(6, 8, "Resolve the earlier meal reference across a topic switch; read BNI and calculate, no reversal.")],
  "casual-ambiguous-transfer-direction": [aggregation(), budget(3, 3, "Two known accounts do not resolve a source pronoun; clarify direction."), approval()],
  "casual-payer-correction": [budget(6, 8, "Calculate the corrected payer's repayment; presentation optional, no ledger retrieval needed.")],
  "casual-service-choice": [budget(4, 4, "Clarify or calculate both service alternatives without choosing one for the user."), budget(6, 8, "Retain bill details, apply clarified equal service, and create the card.")],
  "casual-hypothetical-purchase": [budget(5, 6, "Resolve bank typo, retrieve one balance and subtract hypothetical spending.")],
  "casual-fuzzy-transaction-reference": [budget(5, 6, "Filter rough amount, account and yesterday, then surface both plausible matches.")],
};

export function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function measureEfficiency(result: Result, providerRounds: number) {
  const seen = new Set<string>();
  let repeatedReads = 0;
  const calls = result.toolCalls ?? [];
  for (const call of calls) {
    const toolResult = (result.toolResults ?? []).find((r: any) => r.id === call.id)?.result;
    // Only repeated SUCCESSFUL reads count: validation retries have their own
    // reliability score. Scope/filter/cursor differences are distinct evidence.
    if (!agentReadToolNames.has(call.name) || !toolResult || toolResult.status === "error" || toolResult.data?.status === "error") continue;
    const key = `${call.name}:${stableJson(call.input)}`;
    if (seen.has(key)) repeatedReads++;
    seen.add(key);
  }
  return { providerRounds, toolCalls: calls.length, repeatedReads, schemaLoads: calls.filter((c: any) => c.name === "load_tool_schemas").length };
}

export function efficiencyChecks(caseId: string, turn: number, result: Result, providerRounds: number) {
  const limits = efficiencyBudgets[caseId]?.[turn];
  const metrics = measureEfficiency(result, providerRounds);
  if (!limits) return { metrics, limits, checks: [] as Check[] }; // scripted harness cases intentionally repeat calls
  const checks: Check[] = [
    { name: "provider rounds within workflow budget", passed: providerRounds <= limits.maxRounds, detail: `${providerRounds}/${limits.maxRounds}. ${limits.rationale}`, dimension: "efficiency" },
    { name: "tool calls within workflow budget", passed: metrics.toolCalls <= limits.maxToolCalls, detail: `${metrics.toolCalls}/${limits.maxToolCalls}`, dimension: "efficiency" },
    { name: "no redundant successful read in unchanged turn", passed: metrics.repeatedReads <= limits.maxRepeatedReads, detail: `${metrics.repeatedReads} repeated read(s)`, dimension: "efficiency" },
  ];
  return { metrics, limits, checks };
}
