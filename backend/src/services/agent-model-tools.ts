import { and, eq } from "drizzle-orm";

import type { AgentChatTool } from "./agent-llm";
import {
  executeAgentTool,
  findMoneyAnomaliesTool,
  findDueRecurringTool,
  getDueRecurringSummaryTool,
  getMoneyAnomalySummaryTool,
  summarizeTransactionsTool,
  type AgentToolExecutionContext,
} from "./agent-tools";
import { accounts, categories } from "../db/schema";
import { db } from "../db/client";
import { getOrCreateAutoExpenseAccount, getOrCreateAutoIncomeAccount } from "./ledger";
import { parseAgentPresentation, type AgentPresentation } from "./agent-presentations";
import type { ModelEvidence } from "./agent-evidence";

export type JsonSchema = Record<string, unknown>;
export type AgentModelToolKind = "read" | "action" | "presentation";

export type AgentModelTool = {
  name: string;
  kind: AgentModelToolKind;
  summary: string;
  description: string;
  inputSchema: JsonSchema;
  execute: (input: unknown, context?: AgentToolExecutionContext) => Promise<unknown>;
  projectResult: (result: unknown, input: unknown, evidenceId: string, revision: number) => ModelEvidence;
};

const scopeProperties: JsonSchema = {
  periodId: { type: "integer", minimum: 1, description: "Salary-period ID." },
  startDate: { type: "integer", minimum: 0, description: "Inclusive UTC epoch milliseconds for a custom range." },
  endDate: { type: "integer", minimum: 0, description: "Inclusive UTC epoch milliseconds for a custom range." },
};

const scopeSchema = (extra: JsonSchema = {}, required: string[] = []): JsonSchema => ({
  type: "object",
  additionalProperties: false,
  properties: { ...scopeProperties, ...extra },
  ...(required.length > 0 ? { required } : {}),
});

const selectionSchema = (mode: "all" | "top" | "filter" | "ids" | "status" | "total"): JsonSchema => {
  if (mode === "top") return {
    type: "object", additionalProperties: false, required: ["mode", "count"],
    properties: { mode: { type: "string", enum: ["top"] }, count: { type: "integer", minimum: 1, maximum: 200 } },
  };
  if (mode === "filter") return {
    type: "object", additionalProperties: false, required: ["mode"],
    properties: { mode: { type: "string", enum: ["filter"] }, type: { type: "string", maxLength: 60 }, liquidityClass: { type: "string", maxLength: 60 } },
  };
  if (mode === "ids") return {
    type: "object", additionalProperties: false, required: ["mode", "ids"],
    properties: { mode: { type: "string", enum: ["ids"] }, ids: { type: "array", minItems: 1, maxItems: 100, items: { type: "integer", minimum: 1 } } },
  };
  if (mode === "status") return {
    type: "object", additionalProperties: false, required: ["mode"],
    properties: { mode: { type: "string", enum: ["status"] }, status: { type: "string", maxLength: 40 } },
  };
  if (mode === "total") return {
    type: "object", additionalProperties: false, required: ["mode"],
    properties: { mode: { type: "string", enum: ["total"] } },
  };
  return { type: "object", additionalProperties: false, required: ["mode"], properties: { mode: { type: "string", enum: ["all"] } } };
};

const allOrTopSchema = {
  oneOf: [
    { type: "object", additionalProperties: false, required: ["mode"], properties: { mode: { type: "string", enum: ["all"] } } },
    { type: "object", additionalProperties: false, required: ["mode", "count"], properties: { mode: { type: "string", enum: ["top"] }, count: { type: "integer", minimum: 1, maximum: 200 } } },
  ],
};

const transactionFilters = {
  type: "object", additionalProperties: false,
  properties: {
    text: { type: "string", maxLength: 200 },
    accountId: { type: "integer", minimum: 1 },
    accountName: { type: "string", minLength: 1, maxLength: 120, description: "Exact active account name; resolved to an ID before querying." },
    categoryId: { type: "integer", minimum: 1 },
    categoryName: { type: "string", minLength: 1, maxLength: 120, description: "Exact active category name; resolved to an ID before querying." },
    minAmount: { type: "integer", minimum: 0 },
    maxAmount: { type: "integer", minimum: 0 },
    transactionType: { type: "string", maxLength: 80 },
    direction: { type: "string", enum: ["inflow", "outflow"] },
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unwrap(result: unknown): unknown {
  return isRecord(result) && "data" in result ? result.data : result;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

async function resolveTransactionFilterNames(input: unknown): Promise<Record<string, unknown>> {
  const value = { ...asRecord(input) };
  const filters = { ...asRecord(value.filters) };
  if (filters.accountId == null && typeof filters.accountName === "string") {
    const requested = filters.accountName.trim().toLocaleLowerCase("en-US");
    const activeAccounts = await db.select({ id: accounts.id, name: accounts.name })
      .from(accounts).where(eq(accounts.isActive, true));
    const matches = activeAccounts.filter((account) => account.name.trim().toLocaleLowerCase("en-US") === requested);
    if (matches.length === 0) throw new Error(`Account not found: ${filters.accountName}`);
    if (matches.length > 1) throw new Error(`Ambiguous account name: ${filters.accountName}`);
    filters.accountId = matches[0]!.id;
  }
  if (filters.categoryId == null && typeof filters.categoryName === "string") {
    const requested = filters.categoryName.trim().toLocaleLowerCase("en-US");
    const activeCategories = await db.select({ id: categories.id, name: categories.name })
      .from(categories).where(eq(categories.isActive, true));
    const matches = activeCategories.filter((category) => category.name.trim().toLocaleLowerCase("en-US") === requested);
    if (matches.length === 0) throw new Error(`Category not found: ${filters.categoryName}`);
    if (matches.length > 1) throw new Error(`Ambiguous category name: ${filters.categoryName}`);
    filters.categoryId = matches[0]!.id;
  }
  delete filters.accountName;
  delete filters.categoryName;
  if (Object.keys(filters).length > 0) value.filters = filters;
  else delete value.filters;
  return value;
}

function compactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const source = asRecord(value);
  return Object.fromEntries(keys
    .filter((key) => {
      const candidate = source[key];
      return candidate !== undefined && candidate !== null
        && (!Array.isArray(candidate) || candidate.length > 0)
        && (!isRecord(candidate) || Object.keys(candidate).length > 0);
    })
    .map((key) => [key, source[key]]));
}

function compactRows(value: unknown, keys: readonly string[]): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord).map((row) => compactObject(row, keys)) : [];
}

function projectCoverage(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return compactObject(value, ["status", "coverageStatus", "complete", "isComplete", "warnings", "missing", "reason"]);
}

function projectBudgetPeriod(value: unknown): Record<string, unknown> {
  return compactObject(value, ["periodId", "id", "name", "startMs", "endMs"]);
}

function projectBudgetRows(value: unknown): Array<Record<string, unknown>> {
  return compactRows(value, ["categoryId", "category", "plannedCents", "spentCents", "varianceCents", "isTracked"]);
}

function projectLoanRows(value: unknown): Array<Record<string, unknown>> {
  return compactRows(value, ["id", "contactId", "contactName", "direction", "amountCents", "remainingCents", "startDate", "dueDate", "status", "description"]);
}

function projectRecurringRows(value: unknown): Array<Record<string, unknown>> {
  return compactRows(value, ["subscriptionId", "subscriptionName", "dueAt", "amountCents", "accountId", "accountName", "categoryId", "categoryName"]);
}

function projectAnomalyRows(value: unknown): Array<Record<string, unknown>> {
  return compactRows(value, ["id", "anomalyId", "transactionId", "status", "severity", "type", "description", "amountCents", "createdAt", "resolvedAt"]);
}

function projectTransactionRow(value: unknown): Record<string, unknown> {
  const row = asRecord(value);
  const expense = Number(row.expenseCents ?? 0);
  const income = Number(row.incomeCents ?? 0);
  const debit = Number(row.debitCents ?? 0);
  const credit = Number(row.creditCents ?? 0);
  const type = typeof row.txType === "string" ? row.txType : undefined;
  const direction = expense !== 0 ? "expense" : income !== 0 ? "income" : type;
  const amountCents = Math.abs(expense || income || (Math.abs(debit) >= Math.abs(credit) ? debit : credit));
  return {
    ...compactObject(row, ["id", "date", "description"]),
    amountCents,
    ...(direction ? { type: direction } : {}),
    ...(typeof row.category === "string" && row.category.length > 0 ? { category: row.category } : {}),
  };
}

function projectTransactionDetail(value: unknown): Record<string, unknown> {
  const row = asRecord(value);
  return {
    ...projectTransactionRow(row),
    ...compactObject(row, ["reference", "notes", "status", "periodId", "categoryId"]),
  };
}

function projectSummary(raw: Record<string, unknown>, input: unknown): Record<string, unknown> {
  const transactionType = asRecord(asRecord(input).filters).transactionType;
  const groups = Array.isArray(raw.groups) ? raw.groups.filter(isRecord).map((group) => {
    const label = group.label ?? group.key;
    const count = group.transactionCount ?? group.count;
    if (transactionType === "expense") return { label, count, amountCents: group.expenseCents ?? 0 };
    if (transactionType === "income") return { label, count, amountCents: group.incomeCents ?? 0 };
    return { label, count, ...compactObject(group, ["expenseCents", "incomeCents", "netCents"]) };
  }) : [];
  const totals = asRecord(raw.totals);
  const count = raw.transactionCount ?? totals.transactionCount ?? totals.count;
  if (transactionType === "expense") return { groupBy: raw.groupBy, groups, totals: { count, amountCents: totals.expenseCents ?? 0 } };
  if (transactionType === "income") return { groupBy: raw.groupBy, groups, totals: { count, amountCents: totals.incomeCents ?? 0 } };
  return { groupBy: raw.groupBy, groups, totals: { count, ...compactObject(totals, ["expenseCents", "incomeCents", "netCents"]) } };
}

function projectAction(raw: Record<string, unknown>): Record<string, unknown> {
  const details = asRecord(raw.details);
  const compactDetails = compactObject(details, ["intent", "date", "description", "periodId", "totalDebit", "totalCredit", "amountCents", "accountName", "toAccountName", "categoryAllocations", "transactionCount"]);
  return {
    ...compactObject(raw, ["status", "pendingActionId", "approvalId", "kind", "receipt", "writesPerformed", "requiresConfirmation"]),
    ...(Object.keys(compactDetails).length > 0 ? { details: compactDetails } : {}),
    ...compactObject(raw, ["assumptions", "missingFields", "errors"]),
  };
}

function compactResultData(name: string, result: unknown, input: unknown): { data: Record<string, unknown>; scope?: Record<string, unknown>; selectionApplied?: Record<string, unknown>; complete: boolean; nextCursor?: string } {
  const raw = unwrap(result);
  if (!isRecord(raw)) return { data: { value: raw }, complete: true };
  if (raw.status === "error") return { data: compactObject(raw, ["status", "error"]), complete: true };

  switch (name) {
    case "get_period_summary": {
      const facts = asRecord(raw.facts);
      return {
        scope: asRecord(raw.scope),
        data: { facts: { ...compactObject(facts, ["totalIncomeCents", "totalSpentCents", "walletBalanceCents"]), netCents: Number(facts.totalIncomeCents ?? 0) - Number(facts.totalSpentCents ?? 0) }, coverage: projectCoverage(raw.coverage) },
        complete: true,
      };
    }
    case "get_spending_breakdown":
    case "get_category_spending":
      return {
        scope: asRecord(raw.scope),
        data: compactObject(raw, ["totalSpentCents", "categories", "categoryCount", "otherSpentCents"]),
        selectionApplied: asRecord(raw.selectionApplied),
        complete: raw.complete !== false,
      };
    case "get_account_balance":
    case "get_account_balances":
      if (name === "get_account_balance" && typeof asRecord(input).accountName === "string" && Array.isArray(raw.accounts) && raw.accounts.length === 0) {
        return { data: { status: "not_found", accountName: asRecord(input).accountName }, complete: true };
      }
      if (name === "get_account_balance") {
        const account = Array.isArray(raw.accounts) && isRecord(raw.accounts[0])
          ? compactObject(raw.accounts[0], ["id", "name", "type", "liquidityClass", "balanceCents"])
          : null;
        return {
          scope: compactObject(raw, ["asOfMs"]),
          data: account ? { account } : { status: "not_found" },
          complete: true,
        };
      }
      if (name === "get_account_balances" && asRecord(asRecord(input).selection).mode === "total") {
        return {
          data: compactObject(raw, ["asOfMs", "totalBalanceCents", "accountCount", "basis"]),
          selectionApplied: { mode: "total" },
          complete: true,
        };
      }
      return {
        scope: compactObject(raw, ["asOfMs"]),
        data: { accounts: compactRows(raw.accounts, ["id", "name", "type", "liquidityClass", "balanceCents"]) },
        selectionApplied: asRecord(raw.selection ?? input),
        complete: true,
      };
    case "find_transactions":
      return {
        scope: asRecord(raw.scope),
        data: {
          transactions: Array.isArray(raw.transactions) ? raw.transactions.map(projectTransactionRow) : [],
          ...compactObject(raw, ["matchedCount", "totalAmountCents", "appliedFilters"]),
          ...(isRecord(raw.scope) && (raw.scope.startMs != null || raw.scope.endMs != null) ? { inclusiveBoundary: true } : {}),
        },
        selectionApplied: { pageSize: raw.pageSize ?? raw.limit, filters: asRecord(asRecord(input).filters) },
        complete: raw.complete !== false,
        ...(typeof raw.nextCursor === "string" ? { nextCursor: raw.nextCursor } : {}),
      };
    case "get_transaction":
      return { data: {
        ...(isRecord(raw.transaction) ? { transaction: projectTransactionDetail(raw.transaction) } : {}),
        lines: compactRows(raw.lines, ["id", "accountId", "account", "debitCents", "creditCents", "description", "cashFlowClass"]),
        categoryAllocations: compactRows(raw.categoryAllocations, ["categoryId", "category", "amountCents"]),
        tags: compactRows(raw.tags, ["id", "name"]),
      }, complete: true };
    case "find_similar_transactions":
      return { data: {
        ...(isRecord(raw.seed) ? { seed: projectTransactionRow(raw.seed) } : {}),
        candidates: Array.isArray(raw.candidates) ? raw.candidates.map(projectTransactionRow) : [],
        ...compactObject(raw, ["deterministic", "availableCount"]),
      }, selectionApplied: asRecord(raw.selectionApplied), complete: raw.complete !== false };
    case "summarize_transactions":
      return { scope: asRecord(raw.scope), data: {
        ...projectSummary(raw, input),
        ...compactObject(raw, ["matchedCount", "totalAmountCents", "appliedFilters"]),
        ...(isRecord(raw.scope) && (raw.scope.startMs != null || raw.scope.endMs != null) ? { inclusiveBoundary: true } : {}),
      }, complete: true };
    case "get_budget_summary":
      {
        const budgets = Array.isArray(raw.budgets) ? raw.budgets.filter(isRecord) : [];
        const plannedCents = budgets.reduce((sum, row) => sum + Number(row.plannedCents ?? 0), 0);
        const spentCents = budgets.reduce((sum, row) => sum + Number(row.spentCents ?? 0), 0);
        return { data: { period: raw.period, plannedCents, spentCents, varianceCents: plannedCents - spentCents, coverage: projectCoverage(raw.coverage) }, complete: true };
      }
    case "get_budget_breakdown":
      return { data: { period: projectBudgetPeriod(raw.period), budgets: projectBudgetRows(raw.budgets), coverage: projectCoverage(raw.coverage) }, selectionApplied: asRecord(raw.selectionApplied), complete: raw.complete !== false };
    case "get_budget_category":
      return { data: { period: projectBudgetPeriod(raw.period), rows: projectBudgetRows(raw.rows), coverage: projectCoverage(raw.coverage) }, complete: true };
    case "compare_period_totals":
      {
        const periods = compactRows(raw.periods, ["period", "incomeCents", "spentCents", "netCents", "coverage"]);
        const first = asRecord(periods[0]);
        const last = asRecord(periods[periods.length - 1]);
        return { data: {
          periods, comparable: raw.comparable,
          delta: periods.length >= 2 ? { incomeCents: Number(last.incomeCents ?? 0) - Number(first.incomeCents ?? 0), spentCents: Number(last.spentCents ?? 0) - Number(first.spentCents ?? 0), netCents: Number(last.netCents ?? 0) - Number(first.netCents ?? 0) } : undefined,
          coverageWarning: raw.warnings,
        }, complete: true };
      }
    case "compare_category_spending":
      return {
        data: {
          periods: Array.isArray(raw.periods) ? raw.periods.filter(isRecord).map((period) => ({
            ...compactObject(period, ["period", "incomeCents", "spentCents", "netCents", "coverage"]),
            byCategory: compactRows(period.byCategory, ["categoryId", "category", "spentCents"]),
          })) : [],
          comparable: raw.comparable,
          warnings: raw.warnings,
        },
        selectionApplied: asRecord(raw.selectionApplied),
        complete: raw.complete !== false,
      };
    case "get_cash_flow_summary": {
      const statement = asRecord(raw.statement);
      return {
        scope: asRecord(raw.scope),
        data: { ...compactObject(statement, ["periodName", "netOperating", "netInvesting", "netFinancing", "netChange", "historicalRecoveryBridge", "beginningCash", "endingCash"]), coverage: projectCoverage(raw.coverage ?? statement.coverage) },
        complete: true,
      };
    }
    case "get_cash_flow_section": {
      const statement = asRecord(raw.statement);
      const section = asRecord(input).section;
      const netKey = section === "operating" ? "netOperating" : section === "investing" ? "netInvesting" : section === "financing" ? "netFinancing" : null;
      return {
        scope: asRecord(raw.scope),
        data: { section, items: compactRows(statement[section as string], ["label", "description", "category", "accountName", "amountCents", "netCents"]), ...(netKey ? { netCents: statement[netKey] } : {}), coverage: projectCoverage(raw.coverage ?? statement.coverage) },
        complete: true,
      };
    }
    case "forecast_cash_position":
      return { data: compactObject(raw, ["horizonMonths", "currentCashCents", "monthlyBurnCents", "projectedCashCents", "assumptions"]), complete: true };
    case "get_loan_summary":
      return { data: compactObject(raw, ["totalReceivableCents", "totalPayableCents"]), complete: true };
    case "find_loans":
    case "get_loan":
      return { data: { loans: projectLoanRows(raw.loans), ...compactObject(raw, ["loanId", "totalReceivableCents", "totalPayableCents"]) }, complete: true };
    case "get_paylater_summary":
      return { data: compactObject(raw, ["totalOutstandingCents", "providerExposure"]), complete: true };
    case "get_paylater_account":
      return { data: { ...compactObject(raw, ["totalOutstandingCents"]), obligations: compactRows(raw.obligations, ["id", "provider", "description", "principalCents", "remainingCents", "dueDate", "status"]), scheduleItems: compactRows(raw.scheduleItems, ["id", "obligationId", "dateMs", "amountCents", "status"]), providerExposure: compactRows(raw.providerExposure, ["provider", "totalOutstandingCents", "nextDueDateMs", "daysUntilNextDue"]) }, complete: true };
    case "get_due_recurring_summary":
      return { data: { asOfMs: raw.asOfMs, occurrenceCount: Array.isArray(raw.occurrences) ? raw.occurrences.length : 0, truncated: raw.truncated === true }, complete: raw.truncated !== true };
    case "find_due_recurring":
      return { data: { ...compactObject({ ...raw, pageSize: raw.pageSize ?? asRecord(input).pageSize, subscriptionId: raw.subscriptionId ?? asRecord(input).subscriptionId }, ["asOfMs", "pageSize", "subscriptionId", "availableCount", "truncated"]), occurrences: projectRecurringRows(raw.occurrences) }, complete: raw.truncated !== true };
    case "get_account_health":
    case "get_account_reconciliation":
    case "list_reconciliation_history":
      return { data: compactObject(raw, ["account", "asOfMs", "balanceCents", "latestReconciliation", "sessions", "warnings"]), complete: true };
    case "get_anomaly_summary":
      return { data: { status: raw.status, reviewCount: Array.isArray(raw.reviews) ? raw.reviews.length : 0 }, complete: true };
    case "find_anomalies":
      return { data: { ...compactObject(raw, ["status", "availableCount"]), reviews: projectAnomalyRows(raw.reviews) }, complete: raw.complete !== false };
    case "get_anomaly":
      return { data: { ...compactObject(raw, ["status"]), reviews: projectAnomalyRows(raw.reviews), ...(isRecord(raw.review) ? { review: compactObject(raw.review, ["id", "anomalyId", "transactionId", "status", "severity", "type", "description", "amountCents", "createdAt", "resolvedAt"]) } : {}) }, complete: raw.complete !== false };
    case "list_periods":
      return { data: {
        periods: compactRows(raw.periods, ["id", "name", "startDate", "endDate", "status", "coverageStatus", "coverageWarning"]),
        ...compactObject(raw, ["availableCount"]),
      }, selectionApplied: asRecord(raw.selectionApplied ?? asRecord(input).selection), complete: raw.complete !== false };
    case "get_categories":
      return { data: { categories: compactRows(raw.categories, ["id", "name"]), search: raw.search }, complete: true };
    case "get_tags":
      return { data: { tags: compactRows(raw.tags, ["id", "name"]), search: raw.search }, complete: true };
    case "get_transport_route_templates":
      return { data: { routes: compactRows(raw.templates, ["id", "name", "provider", "service", "originName", "destName", "categoryId", "defaultAccountId", "tagIds"]), search: raw.search }, complete: true };
    case "get_salary_catch_up":
      return { data: compactObject(raw, ["status", "occurrenceCount", "occurrences", "truncated", "warnings"]), complete: raw.truncated !== true };
    case "review_budget_patterns":
    case "prepare_budget":
    case "prepare_expense":
    case "prepare_income":
    case "prepare_transfer":
    case "prepare_expense_batch":
    case "set_transaction_note":
    case "set_transaction_tags":
    case "create_tag":
      return { data: projectAction(raw), complete: true };
    case "calculate":
      return { data: compactObject(raw, ["result"]), complete: true };
    case "get_current_datetime":
      return { data: compactObject(raw, ["nowMs", "asiaJakarta"]), complete: true };
    case "calculate_date_difference":
      return { data: compactObject(raw, ["startDate", "endDate", "milliseconds", "days", "hours"]), complete: true };
    case "get_currency_exchange_rate":
      return { data: compactObject(raw, ["from", "to", "amount", "rate", "convertedAmount", "date"]), complete: true };
    default:
      throw new Error(`No model projection is registered for ${name}`);
  }
}

function projectResult(name: string, result: unknown, input: unknown, evidenceId: string, revision: number): ModelEvidence {
  const compact = compactResultData(name, result, input);
  return {
    evidenceId,
    source: name,
    financialRevision: revision,
    ...(compact.scope && Object.keys(compact.scope).length > 0 ? { scope: compact.scope } : {}),
    data: compact.data,
    ...(compact.selectionApplied && Object.keys(compact.selectionApplied).length > 0 ? { selectionApplied: compact.selectionApplied } : {}),
    complete: compact.complete,
    ...(compact.nextCursor ? { nextCursor: compact.nextCursor } : {}),
  };
}

async function oldTool(name: string, input: unknown, context?: AgentToolExecutionContext): Promise<unknown> {
  return executeAgentTool(name, input, context);
}

async function prepareBusinessTransaction(input: unknown, intent: "expense" | "income" | "transfer"): Promise<unknown> {
  if (!isRecord(input)) throw new Error("Transaction input must be an object");
  const amountCents = input.amountCents;
  const accountId = input.accountId;
  const description = input.description;
  if (typeof amountCents !== "number" || !Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error("amountCents must be a positive integer");
  if (typeof accountId !== "number" || !Number.isSafeInteger(accountId) || accountId <= 0) throw new Error("accountId must be a positive wallet account ID");
  if (typeof description !== "string" || description.trim() === "") throw new Error("description is required");
  const [wallet] = await db.select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive, liquidityClass: accounts.liquidityClass })
    .from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!wallet || !wallet.isActive || wallet.type !== "asset") throw new Error("accountId must identify an active asset wallet");
  const base = {
    intent,
    date: input.date,
    dateMs: input.dateMs,
    description: description.trim(),
    reference: input.reference ?? null,
    notes: input.notes ?? null,
    place: input.place ?? null,
    periodId: input.periodId ?? null,
    tagIds: Array.isArray(input.tagIds) ? input.tagIds : [],
  } as Record<string, unknown>;
  if (intent === "expense") {
    let expenseAccountId: number;
    const categoryId = typeof input.categoryId === "number" ? input.categoryId : null;
    if (categoryId != null) {
      const [category] = await db.select({ reportingAccountId: categories.reportingAccountId })
        .from(categories).where(and(eq(categories.id, categoryId), eq(categories.isActive, true))).limit(1);
      if (!category) throw new Error("categoryId does not identify an active category");
      if (category.reportingAccountId != null) expenseAccountId = category.reportingAccountId;
      else expenseAccountId = (await getOrCreateAutoExpenseAccount(db)).id;
    } else {
      expenseAccountId = (await getOrCreateAutoExpenseAccount(db)).id;
    }
    return {
      ...base,
      categoryId,
      ...(categoryId != null ? { categoryAllocations: [{ categoryId, amount: amountCents }] } : {}),
      lines: [
        { accountId: expenseAccountId, debit: amountCents, credit: 0, description: description.trim() },
        { accountId: wallet.id, debit: 0, credit: amountCents, description: description.trim(), cashFlowClass: wallet.liquidityClass === "cash_equivalent" ? "operating" : null },
      ],
    };
  }
  if (intent === "income") {
    const incomeAccountId = (await getOrCreateAutoIncomeAccount(db)).id;
    return {
      ...base,
      lines: [
        { accountId: wallet.id, debit: amountCents, credit: 0, description: description.trim(), cashFlowClass: wallet.liquidityClass === "cash_equivalent" ? "operating" : null },
        { accountId: incomeAccountId, debit: 0, credit: amountCents, description: description.trim() },
      ],
    };
  }
  const toAccountId = input.toAccountId;
  if (typeof toAccountId !== "number" || !Number.isSafeInteger(toAccountId) || toAccountId <= 0) throw new Error("toAccountId is required for a transfer");
  const [destination] = await db.select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive, liquidityClass: accounts.liquidityClass })
    .from(accounts).where(eq(accounts.id, toAccountId)).limit(1);
  if (!destination || !destination.isActive || destination.type !== "asset" || destination.id === wallet.id) throw new Error("toAccountId must identify a different active asset wallet");
  return {
    ...base,
    lines: [
      { accountId: destination.id, debit: amountCents, credit: 0, description: description.trim(), cashFlowClass: destination.liquidityClass === "cash_equivalent" && wallet.liquidityClass === "cash_equivalent" ? "transfer" : null },
      { accountId: wallet.id, debit: 0, credit: amountCents, description: description.trim(), cashFlowClass: destination.liquidityClass === "cash_equivalent" && wallet.liquidityClass === "cash_equivalent" ? "transfer" : null },
    ],
  };
}

async function executePreparation(input: unknown, intent: "expense" | "income" | "transfer", context?: AgentToolExecutionContext): Promise<unknown> {
  return oldTool("prepare_transaction", await prepareBusinessTransaction(input, intent), context);
}

function presentationSchema(type: string, properties: JsonSchema, required: string[] = ["title"]): JsonSchema {
  return { type: "object", additionalProperties: false, required, properties: { type: { type: "string", enum: [type] }, ...properties } };
}

function presentationTool(name: string, summary: string, schema: JsonSchema, parser: (input: unknown) => AgentPresentation): AgentModelTool {
  return {
    name, kind: "presentation", summary, description: summary,
    inputSchema: schema,
    execute: async (input) => parser(input),
    projectResult: (result, input, evidenceId, revision) => projectResultForPresentation(name, result, evidenceId, revision),
  };
}

function projectResultForPresentation(name: string, result: unknown, evidenceId: string, revision: number): ModelEvidence {
  const presentation = isRecord(result) ? result : {};
  if (name === "show_split_bill") {
    const calculation = asRecord(presentation.calculation);
    return { evidenceId, source: name, financialRevision: revision, data: {
      ...compactObject(presentation, ["type", "title"]),
      calculation: compactObject(calculation, ["total", "participantTotals", "totals", "settlements", "unassignedItems", "chargeNeedsPayer", "warnings"]),
    }, complete: true };
  }
  return { evidenceId, source: name, financialRevision: revision, data: compactObject(presentation, ["type", "title"]), complete: true };
}

const metricProperties = {
  title: { type: "string", minLength: 1, maxLength: 120 },
  value: { type: "number" }, unit: { type: "string", enum: ["IDR", "number", "percent", "months"] },
  subtitle: { type: "string", maxLength: 240 }, tone: { type: "string", enum: ["positive", "negative", "neutral"] },
};

const modelTools: AgentModelTool[] = [
  {
    name: "get_period_summary", kind: "read", summary: "Get totals and coverage for one period or date range.", description: "Return income, spending, net, wallet balance, and coverage only; use targeted tools for categories or transactions.", inputSchema: scopeSchema(), execute: (input, context) => oldTool("get_financial_facts", input, context), projectResult: (r, i, id, rev) => projectResult("get_period_summary", r, i, id, rev),
  },
  {
    name: "get_spending_breakdown", kind: "read", summary: "Get every category or an explicitly requested top category count.", description: "Choose selection mode all or top with an explicit count; the backend preserves that choice and never assumes an arbitrary top count.", inputSchema: scopeSchema({ selection: allOrTopSchema }, ["selection"]), execute: (input, context) => oldTool("get_category_spending", input, context), projectResult: (r, i, id, rev) => projectResult("get_spending_breakdown", r, i, id, rev),
  },
  {
    name: "get_category_spending", kind: "read", summary: "Get spending for a named or identified category.", description: "Use categoryId or categoryName to filter in the backend, with explicit all or top selection.", inputSchema: scopeSchema({ categoryId: { type: "integer", minimum: 1 }, categoryName: { type: "string", maxLength: 120 }, selection: allOrTopSchema }, ["selection"]), execute: (input, context) => oldTool("get_category_spending", input, context), projectResult: (r, i, id, rev) => projectResult("get_category_spending", r, i, id, rev),
  },
  {
    name: "get_account_balance", kind: "read", summary: "Get one account balance by ID or exact name.", description: "Use this for a named account such as BNI. No match returns no account and never falls back to all accounts.", inputSchema: { type: "object", additionalProperties: false, anyOf: [{ required: ["accountId"] }, { required: ["accountName"] }], properties: { accountId: { type: "integer", minimum: 1 }, accountName: { type: "string", minLength: 1, maxLength: 120 }, asOfDate: { type: "integer", minimum: 0 } } }, execute: (input, context) => { const value = asRecord(input); if (value.accountId == null && value.accountName == null) throw new Error("accountId or accountName is required"); return oldTool("get_account_balances", input, context); }, projectResult: (r, i, id, rev) => projectResult("get_account_balance", r, i, id, rev),
  },
  {
    name: "get_account_balances", kind: "read", summary: "Get a total, all, or filtered account balances.", description: "Use selection total when only the aggregate available balance is needed; it returns no account rows. Use all only for an explicit multi-account overview, or filter by type/liquidity class.", inputSchema: { type: "object", additionalProperties: false, required: ["selection"], properties: { selection: { oneOf: [selectionSchema("total"), selectionSchema("all"), selectionSchema("filter")] }, asOfDate: { type: "integer", minimum: 0 } } }, execute: (input, context) => oldTool("get_account_balances", input, context), projectResult: (r, i, id, rev) => projectResult("get_account_balances", r, i, id, rev),
  },
  {
    name: "find_transactions", kind: "read", summary: "Find one page: pageSize required; optional cursor, period/range, and filters.", description: "Supply pageSize and optional cursor. Use summarize_transactions when the question needs all activity. Filters accept text, exact account/category ID or name, amount boundaries, and transactionType.", inputSchema: { type: "object", additionalProperties: false, required: ["pageSize"], properties: { ...scopeProperties, filters: transactionFilters, pageSize: { type: "integer", minimum: 1, maximum: 100 }, cursor: { type: "string", maxLength: 300 } } }, execute: async (input, context) => oldTool("search_transactions", await resolveTransactionFilterNames(input), context), projectResult: (r, i, id, rev) => projectResult("find_transactions", r, i, id, rev),
  },
  {
    name: "summarize_transactions", kind: "read", summary: "Aggregate all matches; groupBy category/account/merchant/day/month is required.", description: "Use category, account, merchant, day, or month instead of fetching unbounded raw rows. Filters accept text, exact account/category ID or name, amount boundaries, and transactionType.", inputSchema: { type: "object", additionalProperties: false, required: ["groupBy"], properties: { ...scopeProperties, filters: transactionFilters, groupBy: { type: "string", enum: ["category", "account", "merchant", "day", "month"] } } }, execute: async (input) => summarizeTransactionsTool(await resolveTransactionFilterNames(input)), projectResult: (r, i, id, rev) => projectResult("summarize_transactions", r, i, id, rev),
  },
  {
    name: "get_transaction", kind: "read", summary: "Get exact journal, note, tags, and allocations for one transaction.", description: "Use only after finding the exact transaction ID.", inputSchema: { type: "object", additionalProperties: false, required: ["transactionId"], properties: { transactionId: { type: "integer", minimum: 1 } } }, execute: (input, context) => oldTool("get_transaction_details", input, context), projectResult: (r, i, id, rev) => projectResult("get_transaction", r, i, id, rev),
  },
  {
    name: "find_similar_transactions", kind: "read", summary: "Find similar posted transactions with explicit all or top selection.", description: "Use a transaction ID, query, or amount and choose how many candidates are needed.", inputSchema: { type: "object", additionalProperties: false, required: ["selection"], properties: { transactionId: { type: "integer", minimum: 1 }, query: { type: "string", maxLength: 200 }, amount: { type: "integer", minimum: 1 }, selection: allOrTopSchema } }, execute: async (input, context) => oldTool("find_similar_transactions", { ...asRecord(input), amountCents: asRecord(input).amount }, context), projectResult: (r, i, id, rev) => projectResult("find_similar_transactions", r, i, id, rev),
  },
  {
    name: "list_periods", kind: "read", summary: "List explicitly selected salary periods.", description: "Choose all, IDs, or a status filter; do not infer missing periods.", inputSchema: { type: "object", additionalProperties: false, required: ["selection"], properties: { selection: { oneOf: [selectionSchema("all"), selectionSchema("ids"), selectionSchema("status")] } } }, execute: (input, context) => oldTool("list_periods", input, context), projectResult: (r, i, id, rev) => projectResult("list_periods", r, i, id, rev),
  },
  {
    name: "get_budget_summary", kind: "read", summary: "Get planned, actual, variance, and coverage totals for a period.", description: "Use for a budget overview without category rows.", inputSchema: { type: "object", additionalProperties: false, required: ["periodId"], properties: { periodId: { type: "integer", minimum: 1 } } }, execute: (input, context) => oldTool("get_budget_facts", input, context), projectResult: (r, i, id, rev) => projectResult("get_budget_summary", r, i, id, rev),
  },
  {
    name: "get_budget_breakdown", kind: "read", summary: "Get all or an explicit top count of budget categories.", description: "Choose all or top with an explicit count.", inputSchema: { type: "object", additionalProperties: false, required: ["periodId", "selection"], properties: { periodId: { type: "integer", minimum: 1 }, selection: allOrTopSchema } }, execute: (input, context) => oldTool("get_budget_facts", input, context), projectResult: (r, i, id, rev) => projectResult("get_budget_breakdown", r, i, id, rev),
  },
  {
    name: "get_budget_category", kind: "read", summary: "Get one budget category's planned, actual, and variance values.", description: "Use a specific period and category ID.", inputSchema: { type: "object", additionalProperties: false, required: ["periodId", "categoryId"], properties: { periodId: { type: "integer", minimum: 1 }, categoryId: { type: "integer", minimum: 1 } } }, execute: (input, context) => oldTool("get_category_variance", input, context), projectResult: (r, i, id, rev) => projectResult("get_budget_category", r, i, id, rev),
  },
  {
    name: "compare_period_totals", kind: "read", summary: "Compare income, spending, and net totals across periods.", description: "Use when only period totals are needed.", inputSchema: { type: "object", additionalProperties: false, required: ["periodIds"], properties: { periodIds: { type: "array", minItems: 2, maxItems: 12, items: { type: "integer", minimum: 1 } } } }, execute: (input, context) => oldTool("compare_periods", input, context), projectResult: (r, i, id, rev) => projectResult("compare_period_totals", r, i, id, rev),
  },
  {
    name: "compare_category_spending", kind: "read", summary: "Compare selected category spending across periods.", description: "Choose all, top count, or category IDs explicitly.", inputSchema: { type: "object", additionalProperties: false, required: ["periodIds", "selection"], properties: { periodIds: { type: "array", minItems: 2, maxItems: 12, items: { type: "integer", minimum: 1 } }, selection: { oneOf: [selectionSchema("all"), selectionSchema("top"), selectionSchema("ids")] } } }, execute: (input, context) => oldTool("compare_periods", input, context), projectResult: (r, i, id, rev) => projectResult("compare_category_spending", r, i, id, rev),
  },
  {
    name: "get_cash_flow_summary", kind: "read", summary: "Get cash-flow totals and coverage for a scope.", description: "Use for cash-flow totals; use the section tool for one section.", inputSchema: scopeSchema(), execute: (input, context) => oldTool("get_cash_flow", input, context), projectResult: (r, i, id, rev) => projectResult("get_cash_flow_summary", r, i, id, rev),
  },
  {
    name: "get_cash_flow_section", kind: "read", summary: "Get one cash-flow section for a scope.", description: "Request operating, investing, or financing detail; internal wallet transfers are excluded from the cash-flow statement.", inputSchema: scopeSchema({ section: { type: "string", enum: ["operating", "investing", "financing"] } }, ["section"]), execute: (input, context) => oldTool("get_cash_flow", input, context), projectResult: (r, i, id, rev) => projectResult("get_cash_flow_section", r, i, id, rev),
  },
  {
    name: "forecast_cash_position", kind: "read", summary: "Project cash position from recorded balance and burn.", description: "This is a forecast with explicit assumptions, not a ledger fact.", inputSchema: { type: "object", additionalProperties: false, properties: { horizonMonths: { type: "integer", minimum: 1, maximum: 60 } } }, execute: (input, context) => oldTool("forecast_cash_position", input, context), projectResult: (r, i, id, rev) => projectResult("forecast_cash_position", r, i, id, rev),
  },
  {
    name: "get_loan_summary", kind: "read", summary: "Get loan totals by active, closed, or all status.", description: "Loans are separate from ordinary spending and income.", inputSchema: { type: "object", additionalProperties: false, properties: { status: { type: "string", enum: ["active", "closed", "all"] } } }, execute: (input, context) => oldTool("get_loan_balances", input, context), projectResult: (r, i, id, rev) => projectResult("get_loan_summary", r, i, id, rev),
  },
  {
    name: "find_loans", kind: "read", summary: "Find loans using an explicit status filter.", description: "Use for filtered loan rows.", inputSchema: { type: "object", additionalProperties: false, required: ["status"], properties: { status: { type: "string", enum: ["active", "closed", "all"] } } }, execute: (input, context) => oldTool("get_loan_balances", input, context), projectResult: (r, i, id, rev) => projectResult("find_loans", r, i, id, rev),
  },
  {
    name: "get_loan", kind: "read", summary: "Get exact loan detail by loan ID.", description: "Use after finding the exact loan.", inputSchema: { type: "object", additionalProperties: false, required: ["loanId"], properties: { loanId: { type: "integer", minimum: 1 } } }, execute: (input, context) => oldTool("get_loan_balances", { ...asRecord(input), status: "all" }, context), projectResult: (r, i, id, rev) => projectResult("get_loan", r, i, id, rev),
  },
  {
    name: "get_paylater_summary", kind: "read", summary: "Get aggregate pay-later outstanding amounts.", description: "Use for a pay-later overview.", inputSchema: { type: "object", additionalProperties: false, properties: {} }, execute: (input, context) => oldTool("get_paylater_obligations", input, context), projectResult: (r, i, id, rev) => projectResult("get_paylater_summary", r, i, id, rev),
  },
  {
    name: "get_paylater_account", kind: "read", summary: "Get exact pay-later account detail.", description: "Use after the liability account ID is known.", inputSchema: { type: "object", additionalProperties: false, required: ["accountId"], properties: { accountId: { type: "integer", minimum: 1 } } }, execute: (input, context) => oldTool("get_paylater_obligations", input, context), projectResult: (r, i, id, rev) => projectResult("get_paylater_account", r, i, id, rev),
  },
  {
    name: "get_due_recurring_summary", kind: "read", summary: "Get a count of recurring items due by a timestamp.", description: "Use for an overview; preview only and never posts or changes an occurrence.", inputSchema: { type: "object", additionalProperties: false, properties: { asOfDate: { type: "integer", minimum: 0 } } }, execute: (input) => getDueRecurringSummaryTool(input), projectResult: (r, i, id, rev) => projectResult("get_due_recurring_summary", r, i, id, rev),
  },
  {
    name: "find_due_recurring", kind: "read", summary: "Find a page of recurring occurrences due by a timestamp.", description: "Supply pageSize and use nextCursor for more; optionally filter by subscription ID.", inputSchema: { type: "object", additionalProperties: false, required: ["asOfDate", "pageSize"], properties: { asOfDate: { type: "integer", minimum: 0 }, subscriptionId: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1, maximum: 100 }, cursor: { type: "string", maxLength: 200 } } }, execute: (input) => findDueRecurringTool(input), projectResult: (r, i, id, rev) => projectResult("find_due_recurring", r, i, id, rev),
  },
  {
    name: "get_account_health", kind: "read", summary: "Get exact account balance and latest reconciliation health.", description: "Use with a known account ID.", inputSchema: { type: "object", additionalProperties: false, required: ["accountId"], properties: { accountId: { type: "integer", minimum: 1 }, asOfDate: { type: "integer", minimum: 0 } } }, execute: (input, context) => oldTool("get_account_health", input, context), projectResult: (r, i, id, rev) => projectResult("get_account_health", r, i, id, rev),
  },
  {
    name: "get_account_reconciliation", kind: "read", summary: "Get exact reconciliation status for an account.", description: "Use for control evidence, not spending or income.", inputSchema: { type: "object", additionalProperties: false, required: ["accountId"], properties: { accountId: { type: "integer", minimum: 1 } } }, execute: (input, context) => oldTool("get_reconciliation_status", input, context), projectResult: (r, i, id, rev) => projectResult("get_account_reconciliation", r, i, id, rev),
  },
  {
    name: "list_reconciliation_history", kind: "read", summary: "List reconciliation history with an explicit account filter.", description: "Use only when audit history is requested.", inputSchema: { type: "object", additionalProperties: false, required: ["accountId"], properties: { accountId: { type: "integer", minimum: 1 } } }, execute: (input, context) => oldTool("get_reconciliation_status", input, context), projectResult: (r, i, id, rev) => projectResult("list_reconciliation_history", r, i, id, rev),
  },
  {
    name: "get_anomaly_summary", kind: "read", summary: "Get anomaly counts for an explicit status.", description: "Use for a compact anomaly overview.", inputSchema: { type: "object", additionalProperties: false, properties: { status: { type: "string", enum: ["open", "resolved", "dismissed"] } } }, execute: (input) => getMoneyAnomalySummaryTool(input), projectResult: (r, i, id, rev) => projectResult("get_anomaly_summary", r, i, id, rev),
  },
  {
    name: "find_anomalies", kind: "read", summary: "Find anomalies with an explicit status and page size.", description: "Use when anomaly rows are needed; request the next cursor for more.", inputSchema: { type: "object", additionalProperties: false, required: ["status", "pageSize"], properties: { status: { type: "string", enum: ["open", "resolved", "dismissed"] }, pageSize: { type: "integer", minimum: 1, maximum: 100 }, cursor: { type: "string", maxLength: 200 } } }, execute: (input) => findMoneyAnomaliesTool(input), projectResult: (r, i, id, rev) => projectResult("find_anomalies", r, i, id, rev),
  },
  {
    name: "get_anomaly", kind: "read", summary: "Get exact anomaly detail by review ID.", description: "Use after finding an anomaly ID.", inputSchema: { type: "object", additionalProperties: false, required: ["anomalyId"], properties: { anomalyId: { type: "integer", minimum: 1 }, status: { type: "string", enum: ["open", "resolved", "dismissed", "all"] } } }, execute: (input, context) => oldTool("get_money_anomalies", { ...asRecord(input), status: asRecord(input).status ?? "all" }, context), projectResult: (r, i, id, rev) => projectResult("get_anomaly", r, i, id, rev),
  },
  {
    name: "get_categories", kind: "read", summary: "Find active expense categories by name.", description: "Use search for a named category before preparing an expense or budget. Results are metadata, not spending facts.", inputSchema: { type: "object", additionalProperties: false, properties: { search: { type: "string", maxLength: 100 }, limit: { type: "integer", minimum: 1, maximum: 200 } } }, execute: (input, context) => oldTool("get_categories", input, context), projectResult: (r, i, id, rev) => projectResult("get_categories", r, i, id, rev),
  },
  {
    name: "get_tags", kind: "read", summary: "Find existing transaction tags by name.", description: "Use search for a named tag before changing transaction metadata.", inputSchema: { type: "object", additionalProperties: false, properties: { search: { type: "string", maxLength: 100 }, limit: { type: "integer", minimum: 1, maximum: 200 } } }, execute: (input, context) => oldTool("get_tags", input, context), projectResult: (r, i, id, rev) => projectResult("get_tags", r, i, id, rev),
  },
  {
    name: "get_transport_route_templates", kind: "read", summary: "Find saved transport routes by name or location.", description: "Use when a familiar route supplies reusable account, category, or tag defaults.", inputSchema: { type: "object", additionalProperties: false, properties: { search: { type: "string", maxLength: 120 }, limit: { type: "integer", minimum: 1, maximum: 100 } } }, execute: (input, context) => oldTool("get_transport_route_templates", input, context), projectResult: (r, i, id, rev) => projectResult("get_transport_route_templates", r, i, id, rev),
  },
  {
    name: "get_salary_catch_up", kind: "read", summary: "Preview unprocessed salary occurrences after an absence.", description: "Preview only; it never posts or skips salary occurrences.", inputSchema: { type: "object", additionalProperties: false, properties: {} }, execute: (input, context) => oldTool("get_salary_catch_up", input, context), projectResult: (r, i, id, rev) => projectResult("get_salary_catch_up", r, i, id, rev),
  },
  {
    name: "review_budget_patterns", kind: "action", summary: "Queue a review of unusual budget patterns.", description: "Use only when the user asks to review budget patterns; this creates analytical metadata and does not change ledger facts.", inputSchema: { type: "object", additionalProperties: false, required: ["periodId"], properties: { periodId: { type: "integer", minimum: 1 } } }, execute: (input, context) => oldTool("review_budget_patterns", input, context), projectResult: (r, i, id, rev) => projectResult("review_budget_patterns", r, i, id, rev),
  },
  {
    name: "prepare_budget", kind: "action", summary: "Prepare a budget proposal for one open period.", description: "Prepare only after reading the target period and relevant category IDs. It creates a review proposal and never applies changes.", inputSchema: { type: "object", additionalProperties: false, required: ["periodId", "plans"], properties: { periodId: { type: "integer", minimum: 1 }, plans: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", additionalProperties: false, required: ["categoryId", "plannedAmountCents"], properties: { categoryId: { type: "integer", minimum: 1 }, plannedAmountCents: { type: "integer", minimum: 0 } } } }, assumptions: { type: "array", maxItems: 20, items: { type: "string", maxLength: 500 } } } }, execute: (input, context) => oldTool("prepare_budget", input, context), projectResult: (r, i, id, rev) => projectResult("prepare_budget", r, i, id, rev),
  },
  {
    name: "prepare_expense", kind: "action", summary: "Prepare an expense proposal from business fields.", description: "Backend builds balanced journal lines; this creates a review proposal and never posts.", inputSchema: { type: "object", additionalProperties: false, required: ["amountCents", "accountId", "description", "date"], properties: { amountCents: { type: "integer", minimum: 1 }, accountId: { type: "integer", minimum: 1 }, categoryId: { type: "integer", minimum: 1 }, description: { type: "string", minLength: 1, maxLength: 500 }, date: { type: "string", maxLength: 64 }, dateMs: { type: "integer", minimum: 0 }, notes: { type: "string", maxLength: 2000 }, reference: { type: "string", maxLength: 500 }, periodId: { type: "integer", minimum: 1 }, tagIds: { type: "array", items: { type: "integer", minimum: 1 }, maxItems: 100 } } }, execute: (input, context) => executePreparation(input, "expense", context), projectResult: (r, i, id, rev) => projectResult("prepare_expense", r, i, id, rev),
  },
  {
    name: "prepare_income", kind: "action", summary: "Prepare an income proposal from business fields.", description: "Backend builds balanced journal lines; this creates a review proposal and never posts.", inputSchema: { type: "object", additionalProperties: false, required: ["amountCents", "accountId", "description", "date"], properties: { amountCents: { type: "integer", minimum: 1 }, accountId: { type: "integer", minimum: 1 }, description: { type: "string", minLength: 1, maxLength: 500 }, date: { type: "string", maxLength: 64 }, dateMs: { type: "integer", minimum: 0 }, notes: { type: "string", maxLength: 2000 }, reference: { type: "string", maxLength: 500 }, periodId: { type: "integer", minimum: 1 }, tagIds: { type: "array", items: { type: "integer", minimum: 1 }, maxItems: 100 } } }, execute: (input, context) => executePreparation(input, "income", context), projectResult: (r, i, id, rev) => projectResult("prepare_income", r, i, id, rev),
  },
  {
    name: "prepare_transfer", kind: "action", summary: "Prepare a wallet transfer proposal from business fields.", description: "Backend builds balanced transfer lines; this creates a review proposal and never posts.", inputSchema: { type: "object", additionalProperties: false, required: ["amountCents", "accountId", "toAccountId", "description", "date"], properties: { amountCents: { type: "integer", minimum: 1 }, accountId: { type: "integer", minimum: 1 }, toAccountId: { type: "integer", minimum: 1 }, description: { type: "string", minLength: 1, maxLength: 500 }, date: { type: "string", maxLength: 64 }, dateMs: { type: "integer", minimum: 0 }, notes: { type: "string", maxLength: 2000 }, reference: { type: "string", maxLength: 500 }, periodId: { type: "integer", minimum: 1 } } }, execute: (input, context) => executePreparation(input, "transfer", context), projectResult: (r, i, id, rev) => projectResult("prepare_transfer", r, i, id, rev),
  },
  {
    name: "prepare_expense_batch", kind: "action", summary: "Prepare several expense proposals as one review batch.", description: "Each expense is independently validated and remains unposted until approval.", inputSchema: { type: "object", additionalProperties: false, required: ["transactions"], properties: { transactions: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", additionalProperties: false, required: ["amountCents", "accountId", "description", "date"], properties: { amountCents: { type: "integer", minimum: 1 }, accountId: { type: "integer", minimum: 1 }, categoryId: { type: "integer", minimum: 1 }, description: { type: "string", minLength: 1, maxLength: 500 }, date: { type: "string", maxLength: 64 }, dateMs: { type: "integer", minimum: 0 }, notes: { type: "string", maxLength: 2000 }, reference: { type: "string", maxLength: 500 }, periodId: { type: "integer", minimum: 1 }, tagIds: { type: "array", maxItems: 100, items: { type: "integer", minimum: 1 } } } } } } }, execute: async (input, context) => {
      if (!isRecord(input) || !Array.isArray(input.transactions)) throw new Error("transactions is required");
      const transactions = await Promise.all(input.transactions.map((item) => prepareBusinessTransaction(item, "expense")));
      return oldTool("prepare_transactions", { transactions }, context);
    }, projectResult: (r, i, id, rev) => projectResult("prepare_expense_batch", r, i, id, rev),
  },
  {
    name: "set_transaction_note", kind: "action", summary: "Set or clear one transaction note.", description: "Immediate metadata change; use only when the user clearly requests it.", inputSchema: { type: "object", additionalProperties: false, required: ["transactionId", "notes"], properties: { transactionId: { type: "integer", minimum: 1 }, notes: { type: ["string", "null"], maxLength: 2000 } } }, execute: (input, context) => oldTool("update_transaction_metadata", { transactions: [input] }, context), projectResult: (r, i, id, rev) => projectResult("set_transaction_note", r, i, id, rev),
  },
  {
    name: "set_transaction_tags", kind: "action", summary: "Replace, add, or remove one transaction's tags.", description: "Immediate metadata change; use only when the user clearly requests it.", inputSchema: { type: "object", additionalProperties: false, required: ["transactionId", "tagIds"], properties: { transactionId: { type: "integer", minimum: 1 }, tagIds: { type: "array", maxItems: 100, items: { type: "integer", minimum: 1 } }, operation: { type: "string", enum: ["add", "remove", "replace"] } } }, execute: (input, context) => oldTool("update_transaction_tags", input, context), projectResult: (r, i, id, rev) => projectResult("set_transaction_tags", r, i, id, rev),
  },
  {
    name: "create_tag", kind: "action", summary: "Create a tag when the user asks for one.", description: "Immediate metadata change; duplicate names are handled by the backend.", inputSchema: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 100 }, color: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" } } }, execute: (input, context) => oldTool("create_tag", input, context), projectResult: (r, i, id, rev) => projectResult("create_tag", r, i, id, rev),
  },
  {
    name: "calculate", kind: "read", summary: "Evaluate deterministic arithmetic.", description: "Use only when a purpose-built financial tool does not provide the calculation.", inputSchema: { type: "object", additionalProperties: false, required: ["expression"], properties: { expression: { type: "string", minLength: 1, maxLength: 500 } } }, execute: (input, context) => oldTool("calculate", input, context), projectResult: (r, i, id, rev) => projectResult("calculate", r, i, id, rev),
  },
  {
    name: "get_current_datetime", kind: "read", summary: "Read the verified current time.", description: "Use only when an exact fresh time check matters.", inputSchema: { type: "object", additionalProperties: false, properties: {} }, execute: (input, context) => oldTool("get_current_datetime", input, context), projectResult: (r, i, id, rev) => projectResult("get_current_datetime", r, i, id, rev),
  },
  {
    name: "calculate_date_difference", kind: "read", summary: "Calculate elapsed time between two timestamps.", description: "Use for exact due-date or planning arithmetic.", inputSchema: { type: "object", additionalProperties: false, required: ["startDate", "endDate"], properties: { startDate: { type: "integer", minimum: 0 }, endDate: { type: "integer", minimum: 0 } } }, execute: (input, context) => oldTool("calculate_date_difference", input, context), projectResult: (r, i, id, rev) => projectResult("calculate_date_difference", r, i, id, rev),
  },
  {
    name: "get_currency_exchange_rate", kind: "read", summary: "Get a current or historical reference exchange rate.", description: "Reference data only; it is not a ledger valuation.", inputSchema: { type: "object", additionalProperties: false, required: ["from", "to"], properties: { from: { type: "string", pattern: "^[A-Za-z]{3}$" }, to: { type: "string", pattern: "^[A-Za-z]{3}$" }, amount: { type: "number" }, date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } } }, execute: (input, context) => oldTool("get_currency_exchange_rate", input, context), projectResult: (r, i, id, rev) => projectResult("get_currency_exchange_rate", r, i, id, rev),
  },
];

const presentationTools: AgentModelTool[] = [
  presentationTool("show_metric", "Show one important metric after evidence is available.", presentationSchema("metric", metricProperties, ["title", "value", "unit"]), (input) => parseAgentPresentation("show_chart", { ...asRecord(input), type: "metric" })),
  presentationTool("show_breakdown", "Show a category or item breakdown as a donut or ranked bars.", presentationSchema("breakdown", { title: metricProperties.title, unit: metricProperties.unit, style: { type: "string", enum: ["donut", "ranked_bar"] }, items: { type: "array", minItems: 1, maxItems: 10, items: { type: "object", additionalProperties: false, required: ["label", "value"], properties: { label: { type: "string", minLength: 1, maxLength: 120 }, value: { type: "number" } } } } }, ["title", "unit", "items"]), (input) => {
    const value = asRecord(input);
    return parseAgentPresentation("show_chart", { ...value, type: value.style === "donut" ? "donut" : "ranked_bar" });
  }),
  presentationTool("show_comparison", "Show current and previous values for a comparison.", presentationSchema("comparison", { title: metricProperties.title, unit: metricProperties.unit, currentLabel: { type: "string", maxLength: 120 }, previousLabel: { type: "string", maxLength: 120 }, items: { type: "array", minItems: 1, maxItems: 8, items: { type: "object", additionalProperties: false, required: ["label", "current", "previous"], properties: { label: { type: "string", maxLength: 120 }, current: { type: "number" }, previous: { type: "number" } } } } }, ["title", "unit", "currentLabel", "previousLabel", "items"]), (input) => parseAgentPresentation("show_chart", { ...asRecord(input), type: "comparison" })),
  presentationTool("show_trend", "Show a trend over time.", presentationSchema("trend", { title: metricProperties.title, unit: metricProperties.unit, points: { type: "array", minItems: 2, maxItems: 24, items: { type: "object", additionalProperties: false, required: ["label", "value"], properties: { label: { type: "string", maxLength: 120 }, value: { type: "number" } } } } }, ["title", "unit", "points"]), (input) => parseAgentPresentation("show_chart", { ...asRecord(input), type: "sparkline" })),
  presentationTool("show_budget_progress", "Show planned versus actual budget progress.", presentationSchema("budget_progress", { title: metricProperties.title, unit: metricProperties.unit, planned: { type: "number", minimum: 0 }, actual: { type: "number", minimum: 0 }, remaining: { type: "number" }, status: { type: "string", enum: ["positive", "negative", "neutral"] } }, ["title", "unit", "planned", "actual"]), (input) => parseAgentPresentation("show_chart", { ...asRecord(input), type: "budget_progress" })),
  presentationTool("show_cash_flow", "Show income, spending, and net cash flow.", presentationSchema("cash_flow", { title: metricProperties.title, unit: metricProperties.unit, income: { type: "number" }, spending: { type: "number" }, net: { type: "number" }, periodLabel: { type: "string", maxLength: 120 } }, ["title", "unit", "income", "spending", "net"]), (input) => parseAgentPresentation("show_chart", { ...asRecord(input), type: "cash_flow" })),
  presentationTool("show_projection", "Show an editable projection scenario.", presentationSchema("projection", { unit: metricProperties.unit, startingValue: { type: "number" }, monthlyContribution: { type: "number" }, monthlyGrowthRate: { type: "number", minimum: -100, maximum: 100 }, horizonMonths: { type: "integer", minimum: 3, maximum: 120 }, target: { type: "number" }, subtitle: { type: "string", maxLength: 240 } }, ["title", "startingValue", "monthlyContribution", "monthlyGrowthRate", "horizonMonths"]), (input) => parseAgentPresentation("show_scenario", { ...asRecord(input), type: "projection" })),
  presentationTool("show_scenario_comparison", "Show an editable comparison of what-if scenarios.", presentationSchema("scenario_compare", { scenarios: { type: "array", minItems: 2, maxItems: 4, items: { type: "object", additionalProperties: false, required: ["label", "metrics"], properties: { label: { type: "string", maxLength: 120 }, description: { type: "string", maxLength: 240 }, metrics: { type: "array", minItems: 1, maxItems: 5, items: { type: "object", additionalProperties: false, required: ["label", "value", "unit"], properties: { label: { type: "string" }, value: { type: "number" }, unit: { type: "string", enum: ["IDR", "number", "percent", "months"] } } } } } } } }, ["title", "scenarios"]), (input) => parseAgentPresentation("show_scenario", { ...asRecord(input), type: "scenario_compare" })),
  presentationTool("show_allocation", "Show an editable allocation of a total.", presentationSchema("allocation_editor", { unit: metricProperties.unit, total: { type: "number", minimum: 0 }, rows: { type: "array", minItems: 1, maxItems: 10, items: { type: "object", additionalProperties: false, required: ["label", "value"], properties: { label: { type: "string" }, value: { type: "number", minimum: 0 }, locked: { type: "boolean" } } } } }, ["title", "total", "rows"]), (input) => parseAgentPresentation("show_scenario", { ...asRecord(input), type: "allocation_editor" })),
  presentationTool("show_goal_tracker", "Show progress toward a financial goal.", presentationSchema("goal_tracker", { unit: metricProperties.unit, current: { type: "number", minimum: 0 }, target: { type: "number", exclusiveMinimum: 0 }, monthlyContribution: { type: "number", minimum: 0 }, deadlineMonths: { type: "integer", minimum: 1, maximum: 600 } }, ["title", "current", "target", "monthlyContribution"]), (input) => parseAgentPresentation("show_scenario", { ...asRecord(input), type: "goal_tracker" })),
  presentationTool("show_worksheet", "Show a compact editable calculation worksheet.", {
    type: "object", additionalProperties: false, required: ["type", "title", "inputColumns", "formulaColumns", "rows"],
    properties: {
      type: { type: "string", enum: ["worksheet"] }, title: { type: "string", minLength: 1, maxLength: 120 },
      inputColumns: { type: "array", minItems: 1, maxItems: 3, items: { type: "object", additionalProperties: false, required: ["key", "label", "unit"], properties: { key: { type: "string", pattern: "^[a-z][a-z0-9_]{0,30}$" }, label: { type: "string", minLength: 1, maxLength: 120 }, unit: { type: "string", enum: ["IDR", "number", "percent", "months"] } } } },
      formulaColumns: { type: "array", maxItems: 3, items: { type: "object", additionalProperties: false, required: ["key", "label", "unit", "operation", "left", "right"], properties: { key: { type: "string" }, label: { type: "string" }, unit: { type: "string", enum: ["IDR", "number", "percent", "months"] }, operation: { type: "string", enum: ["add", "subtract", "multiply", "divide", "percent_change"] }, left: { type: "string" }, right: { type: "string" } } } },
      rows: { type: "array", minItems: 1, maxItems: 12, items: { type: "object", additionalProperties: false, required: ["label", "values"], properties: { label: { type: "string", minLength: 1, maxLength: 120 }, values: { type: "object", additionalProperties: { type: "number" } } } } },
    },
  }, (input) => parseAgentPresentation("show_worksheet", { ...asRecord(input), type: "worksheet" })),
  presentationTool("show_split_bill", "Show an editable split-bill calculation card.", {
    type: "object", additionalProperties: false, required: ["title", "participants", "items", "charges"],
    properties: {
      title: { type: "string", minLength: 1, maxLength: 120 },
      merchant: { type: "string", maxLength: 160 }, date: { type: "string", maxLength: 40 }, payerId: { type: "string", maxLength: 60 }, note: { type: "string", maxLength: 500 },
      participants: { type: "array", minItems: 1, maxItems: 30, items: { type: "object", additionalProperties: false, required: ["id", "name"], properties: { id: { type: "string", minLength: 1, maxLength: 60 }, name: { type: "string", minLength: 1, maxLength: 120 } } } },
      items: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", additionalProperties: false, required: ["id", "name", "quantity", "amount", "participantIds"], properties: { id: { type: "string", minLength: 1, maxLength: 60 }, name: { type: "string", minLength: 1, maxLength: 120 }, quantity: { type: "integer", minimum: 1 }, amount: { type: "integer", minimum: 0 }, participantIds: { type: "array", maxItems: 30, items: { type: "string", maxLength: 60 } } } } },
      charges: { type: "object", additionalProperties: false, required: ["tax", "service", "discount", "tip"], properties: { tax: { type: "integer", minimum: 0 }, service: { type: "integer", minimum: 0 }, discount: { type: "integer", minimum: 0 }, tip: { type: "integer", minimum: 0 }, taxRule: { type: "string", enum: ["proportional", "equal", "payer"] }, serviceRule: { type: "string", enum: ["proportional", "equal", "payer"] }, discountRule: { type: "string", enum: ["proportional", "equal", "payer"] }, tipRule: { type: "string", enum: ["proportional", "equal", "payer"] } } },
    },
  }, (input) => parseAgentPresentation("show_split_bill", { ...asRecord(input), type: "split_bill" })),
];

export const agentModelTools: AgentModelTool[] = [...modelTools, ...presentationTools];
export const agentModelToolMap = new Map(agentModelTools.map((tool) => [tool.name, tool]));
export const agentModelToolNames = agentModelTools.map((tool) => tool.name);
export const agentReadToolNames = new Set(agentModelTools.filter((tool) => tool.kind === "read").map((tool) => tool.name));
export const modelPresentationToolNames = new Set(presentationTools.map((tool) => tool.name));

export const agentToolCatalog = agentModelTools.map(({ name, kind, summary }) => ({
  name,
  kind,
  // Keep the full registry discoverable while leaving the catalog small
  // enough to coexist with the initial runtime schemas and user context.
  summary: summary.length > 40 ? summary.slice(0, 37) + "..." : summary,
}));

export function modelToolToChatTool(tool: AgentModelTool): AgentChatTool {
  return { type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } };
}

export function modelToolsForNames(names: Iterable<string>): AgentChatTool[] {
  return [...new Set(names)]
    .map((name) => agentModelToolMap.get(name))
    .filter((tool): tool is AgentModelTool => tool != null)
    .map(modelToolToChatTool);
}

export class ModelToolInputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelToolInputValidationError";
  }
}

function validationPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function validateJsonSchema(schema: JsonSchema, value: unknown, path: string, errors: string[]): void {
  if (errors.length >= 8) return;
  const anyOf = Array.isArray(schema.anyOf) ? schema.anyOf.filter(isRecord) : [];
  if (anyOf.length > 0) {
    const valid = anyOf.some((candidate) => {
      const candidateErrors: string[] = [];
      validateJsonSchema(candidate, value, path, candidateErrors);
      return candidateErrors.length === 0;
    });
    if (!valid) errors.push(`${path || "input"} must match one accepted shape`);
    return;
  }
  const oneOf = Array.isArray(schema.oneOf) ? schema.oneOf.filter(isRecord) : [];
  if (oneOf.length > 0) {
    const validCount = oneOf.filter((candidate) => {
      const candidateErrors: string[] = [];
      validateJsonSchema(candidate, value, path, candidateErrors);
      return candidateErrors.length === 0;
    }).length;
    if (validCount !== 1) errors.push(`${path || "input"} must match exactly one accepted shape`);
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    errors.push(`${path || "input"} must be one of ${schema.enum.map(String).join(", ")}`);
    return;
  }
  const type = typeof schema.type === "string" ? schema.type : null;
  if (type === "object") {
    if (!isRecord(value)) {
      errors.push(`${path || "input"} must be an object`);
      return;
    }
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === "string") : [];
    for (const key of required) {
      if (!(key in value)) errors.push(`${validationPath(path, key)} is required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) errors.push(`${validationPath(path, key)} is not allowed`);
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (key in value && isRecord(childSchema)) validateJsonSchema(childSchema, value[key], validationPath(path, key), errors);
    }
    return;
  }
  if (type === "array") {
    if (!Array.isArray(value)) {
      errors.push(`${path || "input"} must be an array`);
      return;
    }
    if (typeof schema.minItems === "number" && value.length < schema.minItems) errors.push(`${path || "input"} must contain at least ${schema.minItems} item(s)`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) errors.push(`${path || "input"} must contain at most ${schema.maxItems} item(s)`);
    if (isRecord(schema.items)) value.forEach((item, index) => validateJsonSchema(schema.items as JsonSchema, item, `${path || "input"}[${index}]`, errors));
    return;
  }
  if (type === "string") {
    if (typeof value !== "string") {
      errors.push(`${path || "input"} must be a string`);
      return;
    }
    if (typeof schema.minLength === "number" && value.length < schema.minLength) errors.push(`${path || "input"} is too short`);
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) errors.push(`${path || "input"} is too long`);
    return;
  }
  if (type === "integer" || type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value) || (type === "integer" && !Number.isInteger(value))) {
      errors.push(`${path || "input"} must be ${type === "integer" ? "an integer" : "a number"}`);
      return;
    }
    if (typeof schema.minimum === "number" && value < schema.minimum) errors.push(`${path || "input"} must be at least ${schema.minimum}`);
    if (typeof schema.maximum === "number" && value > schema.maximum) errors.push(`${path || "input"} must be at most ${schema.maximum}`);
    return;
  }
  if (type === "boolean" && typeof value !== "boolean") errors.push(`${path || "input"} must be a boolean`);
}

/**
 * The optimistic read gateway is intentionally generic at the provider
 * boundary. Validate the exact canonical schema here before invoking the
 * underlying executor so it remains as strict as a directly loaded tool.
 */
export function validateModelToolInput(tool: AgentModelTool, input: unknown): void {
  const errors: string[] = [];
  validateJsonSchema(tool.inputSchema, input, "", errors);
  if (errors.length > 0) throw new ModelToolInputValidationError(errors.join("; "));
}

export function projectModelToolResult(tool: AgentModelTool, result: unknown, input: unknown, evidenceId: string, revision: number): ModelEvidence {
  return tool.projectResult(result, input, evidenceId, revision);
}

export async function parseModelPresentation(name: string, input: unknown): Promise<AgentPresentation> {
  const tool = agentModelToolMap.get(name);
  if (!tool || tool.kind !== "presentation") throw new Error("Unknown presentation tool");
  return await tool.execute(input) as AgentPresentation;
}
