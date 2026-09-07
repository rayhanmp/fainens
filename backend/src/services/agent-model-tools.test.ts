import { describe, expect, it } from "vitest";

import { agentModelTools, agentModelToolMap, agentReadToolNames, agentToolCatalog, ModelToolInputValidationError, modelToolsForNames, projectModelToolResult, validateModelToolInput } from "./agent-model-tools";
import { getAgentProviderSchemaMetrics, normalizeLeasedToolInput, normalizeOptimisticReadInput, parseOptimisticReadBatchInvocation, requestedToolCost, retainEvidenceBatch } from "../routes/agent";
import type { ModelEvidence } from "./agent-evidence";

describe("model-driven tool registry", () => {
  it("publishes a compact complete catalog without parameter schemas", () => {
    expect(agentToolCatalog.length).toBeGreaterThan(20);
    expect(new Set(agentToolCatalog.map((tool) => tool.name)).size).toBe(agentToolCatalog.length);
    expect(agentToolCatalog.every((tool) => tool.summary.length <= 120)).toBe(true);
    expect(JSON.stringify(agentToolCatalog).length).toBeLessThanOrEqual(6_000);
    expect(agentToolCatalog.every((tool) => !Object.prototype.hasOwnProperty.call(tool, "inputSchema"))).toBe(true);
  });

  it("loads exactly the requested model schemas", () => {
    const tools = modelToolsForNames(["get_account_balance", "show_metric", "get_account_balance"]);
    expect(tools.map((tool) => tool.function.name)).toEqual(["get_account_balance", "show_metric"]);
    expect(tools.every((tool) => tool.function.parameters != null)).toBe(true);
  });

  it("has an explicit projection implementation for every registered tool", () => {
    for (const tool of agentModelTools) {
      expect(() => projectModelToolResult(tool, {}, {}, `projection-${tool.name}`, 1), tool.name).not.toThrow();
    }
  });

  it("keeps the initial runtime schemas and catalog within their budgets", () => {
    const metrics = getAgentProviderSchemaMetrics();
    expect(metrics.runtimeSchemaSize).toBeLessThanOrEqual(3_000);
    expect(metrics.catalogSize).toBeLessThanOrEqual(6_000);
  });

  it("allows the optimistic gateway to validate a read tool against its canonical schema", () => {
    const tool = agentModelToolMap.get("find_transactions");
    expect(tool?.kind).toBe("read");
    expect(agentReadToolNames.has("find_transactions")).toBe(true);
    expect(tool).toBeDefined();
    validateModelToolInput(tool!, { pageSize: 20, filters: { minAmount: 150_000 } });
    expect(() => validateModelToolInput(tool!, { filters: { minAmount: 150_000 } })).toThrow(ModelToolInputValidationError);
    const accountBalances = agentModelToolMap.get("get_account_balances");
    expect(accountBalances).toBeDefined();
    validateModelToolInput(accountBalances!, { selection: { mode: "total" } });
  });

  it("does not admit actions through the optimistic read gateway allowlist", () => {
    expect(agentReadToolNames.has("prepare_expense")).toBe(false);
    expect(agentReadToolNames.has("show_metric")).toBe(false);
  });

  it("validates read batches, rejects duplicate calls, actions, and more than four children", () => {
    expect(parseOptimisticReadBatchInvocation({ calls: [
      { key: "balance", name: "get_account_balances", arguments: { selection: "total" } },
      { key: "math", name: "calculate", arguments: { expression: "2 + 2" } },
    ] }).calls).toHaveLength(2);
    expect(() => parseOptimisticReadBatchInvocation({ calls: [
      { key: "x", name: "calculate", arguments: { expression: "2 + 2" } },
      { key: "x", name: "calculate", arguments: { expression: "3 + 3" } },
    ] })).toThrow(/duplicate batch key/);
    expect(() => parseOptimisticReadBatchInvocation({ calls: [
      { key: "a", name: "calculate", arguments: { expression: "2 + 2" } },
      { key: "b", name: "calculate", arguments: { expression: "2 + 2" } },
    ] })).toThrow(/identical normalized calls/);
    expect(() => parseOptimisticReadBatchInvocation({ calls: [
      { key: "a", name: "prepare_expense", arguments: {} },
      { key: "b", name: "calculate", arguments: { expression: "1" } },
    ] })).toThrow(/read-only/);
    expect(() => parseOptimisticReadBatchInvocation({ calls: Array.from({ length: 5 }, (_, index) => ({ key: `k${index}`, name: "calculate", arguments: { expression: String(index) } })) })).toThrow(/2-4/);
  });

  it("counts each declared batch child against the existing tool budget", () => {
    expect(requestedToolCost("invoke_read_tools", { calls: [{}, {}, {}, {}] })).toBe(4);
    expect(requestedToolCost("invoke_read_tools", { calls: [{}, {}] })).toBe(2);
    expect(requestedToolCost("invoke_read_tools", { calls: "malformed" })).toBe(1);
    expect(requestedToolCost("invoke_read_tool", {})).toBe(1);
  });

  it("retains stable batch evidence atomically and leaves prior state intact on overflow", () => {
    const existing = new Map<string, ModelEvidence>([["old", { evidenceId: "old-id", source: "calculate", financialRevision: 1, data: { result: 1 }, complete: true }]]);
    const byId = new Map<string, ModelEvidence>([["old-id", existing.get("old")!]]);
    const oversized: ModelEvidence = { evidenceId: "new-id", source: "find_transactions", financialRevision: 1, data: { transactions: [{ description: "x".repeat(70_000) }] }, complete: true };
    const error = retainEvidenceBatch(existing, byId, [{ key: "new", evidence: oversized }]);
    expect(error?.code).toBe("scope_too_large");
    expect([...existing.keys()]).toEqual(["old"]);
    expect([...byId.keys()]).toEqual(["old-id"]);
    const compact: ModelEvidence = { evidenceId: "new-id", source: "calculate", financialRevision: 1, data: { result: 2 }, complete: true };
    expect(retainEvidenceBatch(existing, byId, [{ key: "new", evidence: compact }])).toBeNull();
    expect([...existing.keys()]).toEqual(["old", "new"]);
    expect(byId.has("new-id")).toBe(true);
  });

  it("projects transaction searches to an exact minimal contract and reduces size by at least 40%", () => {
    const tool = agentModelToolMap.get("find_transactions")!;
    const raw = { data: { scope: { periodId: 2 }, pageSize: 10, complete: true, transactions: [{
      id: 31, date: "2026-08-01", description: "Lunch", reference: "secret-ref", notes: "private note", txType: "expense", status: "posted", periodId: 2, categoryId: 4, category: "Food", debitCents: 12500, creditCents: 12500, expenseCents: 12500, incomeCents: 0,
    }] } };
    const evidence = projectModelToolResult(tool, raw, { pageSize: 10, filters: { transactionType: "expense" } }, "e", 7);
    expect(evidence.data).toEqual({ transactions: [{ id: 31, date: "2026-08-01", description: "Lunch", amountCents: 12500, type: "expense", category: "Food" }] });
    expect(JSON.stringify(evidence.data)).not.toContain("secret-ref");
    expect(JSON.stringify(evidence.data).length).toBeLessThanOrEqual(JSON.stringify(raw.data).length * 0.6);
  });

  it("keeps notes and references only on exact transaction detail", () => {
    const tool = agentModelToolMap.get("get_transaction")!;
    const evidence = projectModelToolResult(tool, { data: {
      transaction: { id: 31, date: "2026-08-01", description: "Lunch", reference: "receipt-1", notes: "with Inas", txType: "expense", expenseCents: 12500, incomeCents: 0 },
      lines: [{ id: 1, accountId: 2, account: "Cash", debitCents: 0, creditCents: 12500 }],
      categoryAllocations: [{ categoryId: 4, category: "Food", amountCents: 12500 }], tags: [{ id: 8, name: "shared" }],
    } }, { transactionId: 31 }, "e", 7);
    expect(evidence.data).toMatchObject({ transaction: { id: 31, reference: "receipt-1", notes: "with Inas" }, tags: [{ id: 8, name: "shared" }] });
  });

  it("removes duplicate summary group keys and irrelevant zero measures", () => {
    const tool = agentModelToolMap.get("summarize_transactions")!;
    const evidence = projectModelToolResult(tool, { data: { scope: { periodId: 2 }, groupBy: "category", transactionCount: 3, groups: [{ key: "food", label: "Food", transactionCount: 3, expenseCents: 30000, incomeCents: 0, netCents: -30000 }], totals: { expenseCents: 30000, incomeCents: 0, netCents: -30000 } } }, { groupBy: "category", filters: { transactionType: "expense" } }, "e", 7);
    expect(evidence.data).toEqual({ groupBy: "category", groups: [{ label: "Food", count: 3, amountCents: 30000 }], totals: { count: 3, amountCents: 30000 } });
  });

  it("projects period rows and action results through strict allowlists", () => {
    const periods = projectModelToolResult(agentModelToolMap.get("list_periods")!, { data: { periods: [{ id: 2, name: "Aug", startDate: 1, endDate: 2, status: "open", coverageStatus: "complete", plannedCents: 1, closedAt: null, reopenedAt: null }] } }, { selection: { mode: "all" } }, "p", 1);
    expect(periods.data).toEqual({ periods: [{ id: 2, name: "Aug", startDate: 1, endDate: 2, status: "open", coverageStatus: "complete" }] });
    const action = projectModelToolResult(agentModelToolMap.get("prepare_expense")!, { data: { status: "pending", pendingActionId: 9, approvalId: 10, kind: "transaction_journal_create", input: { notes: "hidden" }, details: { intent: "expense", description: "Lunch", totalDebit: 1000, lines: [{ secret: true }] }, createdAt: 1, expiresAt: 2 } }, {}, "a", 1);
    expect(action.data).toEqual({ status: "pending", pendingActionId: 9, approvalId: 10, kind: "transaction_journal_create", details: { intent: "expense", description: "Lunch", totalDebit: 1000 } });
  });

  it("projects budget, loan, recurring, anomaly, and cash-flow rows without internal fields", () => {
    const budget = projectModelToolResult(agentModelToolMap.get("get_budget_breakdown")!, { data: { period: { periodId: 2, name: "Sep", startMs: 1, endMs: 2, secret: true }, budgets: [{ categoryId: 1, category: "Food", plannedCents: 300000, spentCents: 200000, varianceCents: 100000, isTracked: true, internalId: 9 }], coverage: { status: "complete", rawRows: [1] } } }, { periodId: 2, selection: { mode: "all" } }, "b", 1);
    expect(budget.data).toEqual({ period: { periodId: 2, name: "Sep", startMs: 1, endMs: 2 }, budgets: [{ categoryId: 1, category: "Food", plannedCents: 300000, spentCents: 200000, varianceCents: 100000, isTracked: true }], coverage: { status: "complete" } });
    const loans = projectModelToolResult(agentModelToolMap.get("find_loans")!, { data: { loans: [{ id: 1, contactId: 2, contactName: "Inas", direction: "borrowed", amountCents: 1000, remainingCents: 500, startDate: 1, dueDate: 2, status: "active", description: "Dinner", sourceType: "secret" }], totalPayableCents: 500 } }, { status: "active" }, "l", 1);
    expect(loans.data).toEqual({ loans: [{ id: 1, contactId: 2, contactName: "Inas", direction: "borrowed", amountCents: 1000, remainingCents: 500, startDate: 1, dueDate: 2, status: "active", description: "Dinner" }], totalPayableCents: 500 });
    const recurring = projectModelToolResult(agentModelToolMap.get("find_due_recurring")!, { data: { asOfMs: 2, occurrences: [{ subscriptionId: 1, subscriptionName: "Gym", dueAt: 2, amountCents: 5000, accountId: 3, accountName: "BNI", categoryId: 4, categoryName: "Health", secret: true }], truncated: false } }, { asOfDate: 2, pageSize: 10 }, "r", 1);
    expect(recurring.data).toEqual({ asOfMs: 2, pageSize: 10, truncated: false, occurrences: [{ subscriptionId: 1, subscriptionName: "Gym", dueAt: 2, amountCents: 5000, accountId: 3, accountName: "BNI", categoryId: 4, categoryName: "Health" }] });
    const anomalies = projectModelToolResult(agentModelToolMap.get("find_anomalies")!, { data: { status: "open", availableCount: 1, reviews: [{ id: 1, transactionId: 2, status: "open", severity: "high", type: "duplicate", description: "Possible duplicate", amountCents: 1000, createdAt: 1, secret: true }] } }, { status: "open", pageSize: 10 }, "n", 1);
    expect(anomalies.data).toEqual({ status: "open", availableCount: 1, reviews: [{ id: 1, transactionId: 2, status: "open", severity: "high", type: "duplicate", description: "Possible duplicate", amountCents: 1000, createdAt: 1 }] });
  });

  it("flattens an exact account balance into one compact account", () => {
    const tool = agentModelToolMap.get("get_account_balance");
    expect(tool).toBeDefined();

    const evidence = projectModelToolResult(
      tool!,
      {
        data: {
          asOfMs: 1,
          accountName: "BNI",
          accountId: null,
          accounts: [{
            id: 3,
            name: "BNI",
            type: "asset",
            liquidityClass: "cash_equivalent",
            balanceCents: 32_522_792,
          }],
        },
      },
      { accountName: "BNI" },
      "evidence-1",
      223,
    );

    expect(evidence).toEqual({
      evidenceId: "evidence-1",
      source: "get_account_balance",
      financialRevision: 223,
      scope: { asOfMs: 1 },
      data: {
        account: {
          id: 3,
          name: "BNI",
          type: "asset",
          liquidityClass: "cash_equivalent",
          balanceCents: 32_522_792,
        },
      },
      complete: true,
    });
  });

  it("normalizes unambiguous optimistic-read aliases before validation", () => {
    expect(normalizeOptimisticReadInput("list_periods", { selection: { mode: "all" }, pageSize: 20 }))
      .toEqual({ selection: { mode: "all" } });
    expect(normalizeOptimisticReadInput("find_transactions", { filters: { query: "shayi" }, pageSize: 50 }))
      .toEqual({ filters: { text: "shayi" }, pageSize: 50 });
    expect(normalizeOptimisticReadInput("get_tags", { name: "shayi" }))
      .toEqual({ search: "shayi" });
    expect(normalizeOptimisticReadInput("get_account_balances", {}))
      .toEqual({});
    expect(normalizeOptimisticReadInput("get_account_balances", { selection: "all" }))
      .toEqual({ selection: { mode: "all" } });
    expect(normalizeOptimisticReadInput("get_account_balances", { selection: "total" }))
      .toEqual({ selection: { mode: "total" } });
    expect(normalizeOptimisticReadInput("get_spending_breakdown", { periodId: 2, selection: "top:7" }))
      .toEqual({ periodId: 2, selection: { mode: "top", count: 7 } });
    expect(normalizeOptimisticReadInput("find_transactions", {
      filter: { type: "expense", dateRange: { startDate: "2026-08-01", endDate: "2026-08-31" }, minAmountCents: 10_000 },
      selection: { mode: "page", limit: 25 },
      order: "DESC",
    })).toEqual({
      startDate: Date.parse("2026-08-01T00:00:00.000+07:00"),
      endDate: Date.parse("2026-08-31T23:59:59.999+07:00"),
      filters: { transactionType: "expense", minAmount: 10_000 },
      pageSize: 25,
    });
    expect(normalizeOptimisticReadInput("summarize_transactions", { filter: { accountName: "BNI" } }))
      .toEqual({ filters: { accountName: "BNI" }, groupBy: "account" });
    expect(normalizeOptimisticReadInput("find_similar_transactions", { referenceTransactionId: 310, selection: '{"mode":"top","count":2}' }))
      .toEqual({ transactionId: 310, selection: { mode: "top", count: 2 } });
    expect(normalizeOptimisticReadInput("list_periods", { periodId: 2 }))
      .toEqual({ selection: { mode: "ids", ids: [2] } });
    expect(normalizeOptimisticReadInput("get_category_spending", { periodId: 2, categoryName: "Food" }))
      .toEqual({ periodId: 2, categoryName: "Food", selection: { mode: "all" } });
    expect(normalizeOptimisticReadInput("find_transactions", { filters: { periodId: 2, amountMin: 150_000, amountMax: 300_000 }, pageSize: 20, orderBy: "date desc" }))
      .toEqual({ periodId: 2, filters: { minAmount: 150_000, maxAmount: 300_000 }, pageSize: 20 });
    expect(normalizeOptimisticReadInput("get_category_spending", { periodId: 2, name: "Food", limit: 5 }))
      .toEqual({ periodId: 2, categoryName: "Food", selection: { mode: "top", count: 5 } });
    expect(normalizeOptimisticReadInput("get_account_balance", { name: "BNI", orderBy: { field: "date", direction: "desc" } }))
      .toEqual({ accountName: "BNI" });
    expect(normalizeOptimisticReadInput("get_transaction", { transaction_id: 31 }))
      .toEqual({ transactionId: 31 });
  });

  it("does not silently translate offset pagination into the first page", () => {
    const normalized = normalizeOptimisticReadInput("find_transactions", { page: { pageSize: 3, offset: 3 } });
    expect(normalized).toEqual({ page: { pageSize: 3, offset: 3 } });
    const tool = agentModelToolMap.get("find_transactions");
    expect(() => validateModelToolInput(tool!, normalized)).toThrow(ModelToolInputValidationError);
  });

  it("normalizes Jakarta action dates without changing an explicit instant", () => {
    expect(normalizeLeasedToolInput("prepare_expense", { date: "2026-08-30", amountCents: 1 }))
      .toMatchObject({ date: "2026-08-30T12:00:00+07:00" });
    expect(normalizeLeasedToolInput("prepare_transfer", { date: "2026-08-30T09:15", amountCents: 1 }))
      .toMatchObject({ date: "2026-08-30T09:15+07:00" });
    expect(normalizeLeasedToolInput("prepare_income", { date: "2026-08-30", dateMs: 1_787_999_400_000 }))
      .toMatchObject({ date: new Date(1_787_999_400_000).toISOString(), dateMs: 1_787_999_400_000 });
  });

  it("keeps presentation type discriminators out of the leased split schema", async () => {
    const tool = agentModelToolMap.get("show_split_bill");
    expect(tool).toBeDefined();
    const input = {
      title: "Dinner",
      payerId: "ray",
      participants: [{ id: "ray", name: "Ray" }, { id: "inas", name: "Inas" }],
      items: [{ id: "meal", name: "Meal", quantity: 1, amount: 20_000, participantIds: ["ray", "inas"] }],
      charges: { tax: 0, service: 0, discount: 0, tip: 0 },
    };
    validateModelToolInput(tool!, input);
    const result = await tool!.execute(input);
    expect(result).toMatchObject({ type: "split_bill", title: "Dinner" });
    const evidence = projectModelToolResult(tool!, result, input, "split", 1);
    expect(Object.keys((evidence.data as { calculation: object }).calculation).sort()).toEqual(expect.arrayContaining(["settlements", "total"]));
    expect(JSON.stringify(evidence.data)).not.toContain("itemAllocations");
  });
});
