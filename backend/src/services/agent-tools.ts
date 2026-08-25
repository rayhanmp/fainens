import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { db } from "../db/client";
import {
  accounts,
  budgetPlans,
  categories,
  contacts,
  loans,
  reconciliationItems,
  reconciliationSessions,
  salaryPeriods,
  subscriptions,
} from "../db/schema";
import { computeAccountBalanceAsOf } from "./ledger";
import { getBudgetFacts, getFinancialFacts } from "./financial-facts";
import { getFinancialRevision } from "./financial-revision";
import { getPaylaterObligations } from "./paylater";
import { previewDueSubscriptionRenewals } from "./subscription-renewals";
import { previewSalaryCatchUp } from "./salary-posting";
import { assignedOrLegacyPeriodMembership, inclusivePeriodEnd } from "./period-locking";

const DAY_MS = 86_400_000;
const MAX_TRANSACTION_SEARCH = 100;
const MAX_RECONCILIATION_SESSIONS = 50;

const inclusiveEndOfSelectedDay = inclusivePeriodEnd;

export interface AgentScopeInput {
  periodId?: number;
  startDate?: number;
  endDate?: number;
}

export interface AgentScope {
  periodId: number | null;
  startMs: number;
  endMs: number;
  periodName: string | null;
}

export interface AgentToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
}

export interface AgentToolResult<T = unknown> {
  tool: string;
  revision: number;
  readOnly: true;
  data: T;
}

const scopeProperties: Record<string, unknown> = {
  periodId: { type: "integer", minimum: 1, description: "Salary-period ID. Omit for a custom date range or the current period." },
  startDate: { type: "integer", minimum: 0, description: "Inclusive UTC timestamp in milliseconds." },
  endDate: { type: "integer", minimum: 0, description: "Inclusive UTC timestamp in milliseconds." },
};

const scopeSchema = (): AgentToolDefinition["inputSchema"] => ({
  type: "object",
  properties: { ...scopeProperties },
  additionalProperties: false,
});

export const agentToolDefinitions: AgentToolDefinition[] = [
  {
    name: "get_financial_facts",
    description: "Read canonical posted income, expense, transaction rows, category totals, and wallet balance for a period or date range.",
    inputSchema: scopeSchema(),
  },
  {
    name: "get_budget_facts",
    description: "Read planned budget amounts and posted expense actuals by category for a salary period.",
    inputSchema: {
      type: "object",
      properties: { periodId: scopeProperties.periodId },
      required: ["periodId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_account_balances",
    description: "Read active ledger account balances as of an inclusive timestamp, using each account's normal balance.",
    inputSchema: {
      type: "object",
      properties: {
        asOfDate: { type: "integer", minimum: 0, description: "Inclusive UTC timestamp in milliseconds; defaults to now." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_loan_balances",
    description: "Read loan receivables and payables, remaining amounts, counterparties, due dates, and status.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["active", "all", "closed"], description: "Defaults to active." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_paylater_obligations",
    description: "Read pay-later principal, posted interest, payments, outstanding balances, and installment schedule state.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_due_recurring",
    description: "Preview subscription occurrences due by a timestamp. This is read-only and never posts or skips an occurrence.",
    inputSchema: {
      type: "object",
      properties: {
        asOfDate: { type: "integer", minimum: 0, description: "Include occurrences due on or before this timestamp; defaults to now." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_salary_catch_up",
    description: "Preview unprocessed salary months after an absence. This is read-only; posting or skipping requires an explicit confirmed write command.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "search_transactions",
    description: "Search posted journal summaries by text, date range, period, or result limit. Draft journals are excluded.",
    inputSchema: {
      type: "object",
      properties: {
        ...scopeProperties,
        text: { type: "string", maxLength: 200, description: "Searches description, notes, and reference." },
        limit: { type: "integer", minimum: 1, maximum: MAX_TRANSACTION_SEARCH, description: "Maximum rows; defaults to 50." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_reconciliation_status",
    description: "Read durable reconciliation sessions and account-level differences. Reconciliation is control evidence, not income or expense.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "integer", minimum: 1 },
        limit: { type: "integer", minimum: 1, maximum: MAX_RECONCILIATION_SESSIONS },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_periods",
    description: "Read salary periods and their budget-plan totals, useful for returning after a long absence or comparing periods.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "preview_budget_plan",
    description: "Calculate a read-only budget suggestion from canonical historical expense debits and a target savings rate. It never writes a budget.",
    inputSchema: {
      type: "object",
      properties: {
        periodId: scopeProperties.periodId,
        targetSavingsRate: { type: "number", minimum: 0, maximum: 100, description: "Desired savings percentage of canonical income; defaults to 20." },
      },
      additionalProperties: false,
    },
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalInteger(value: unknown, field: string, options: { min?: number } = {}): number | undefined {
  if (value == null) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || (options.min != null && value < options.min)) {
    throw new Error(`${field} must be a safe integer${options.min == null ? "" : ` >= ${options.min}`}`);
  }
  return value;
}

function optionalText(value: unknown, field: string, maxLength: number): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string" || value.length > maxLength) throw new Error(`${field} must be a string of at most ${maxLength} characters`);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseAgentScopeInput(value: unknown): AgentScopeInput {
  if (value == null) return {};
  if (!isRecord(value)) throw new Error("Tool input must be a JSON object");
  return {
    periodId: optionalInteger(value.periodId, "periodId", { min: 1 }),
    startDate: optionalInteger(value.startDate, "startDate", { min: 0 }),
    endDate: optionalInteger(value.endDate, "endDate", { min: 0 }),
  };
}

export async function resolveAgentScope(input: AgentScopeInput = {}): Promise<AgentScope> {
  const hasExplicitRange = input.startDate != null || input.endDate != null;
  let period: { id: number; name: string; startDate: number; endDate: number } | undefined;

  if (input.periodId != null) {
    period = (await db
      .select({ id: salaryPeriods.id, name: salaryPeriods.name, startDate: salaryPeriods.startDate, endDate: salaryPeriods.endDate })
      .from(salaryPeriods)
      .where(eq(salaryPeriods.id, input.periodId))
      .limit(1))[0];
    if (!period) throw new Error("Period not found");
  } else if (!hasExplicitRange) {
    const now = Date.now();
    period = (await db
      .select({ id: salaryPeriods.id, name: salaryPeriods.name, startDate: salaryPeriods.startDate, endDate: salaryPeriods.endDate })
      .from(salaryPeriods)
      .where(and(lte(salaryPeriods.startDate, now), gte(salaryPeriods.endDate, now)))
      .orderBy(salaryPeriods.endDate)
      .limit(1))[0];
    if (!period) {
      period = (await db
        .select({ id: salaryPeriods.id, name: salaryPeriods.name, startDate: salaryPeriods.startDate, endDate: salaryPeriods.endDate })
        .from(salaryPeriods)
        .orderBy(desc(salaryPeriods.endDate))
        .limit(1))[0];
    }
  }

  const fallbackEnd = Date.now();
  const startMs = input.startDate ?? (period?.startDate ?? fallbackEnd - 30 * DAY_MS);
  const rawEndMs = input.endDate ?? (period?.endDate ?? fallbackEnd);
  const endMs = inclusiveEndOfSelectedDay(rawEndMs);
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(rawEndMs) || !Number.isSafeInteger(endMs) || startMs < 0 || endMs < startMs) {
    throw new Error("Invalid scope date range");
  }

  // A custom range is intentionally not constrained to an inferred period.
  // This matters when an absent user asks about the months before returning.
  return {
    periodId: input.periodId ?? (hasExplicitRange ? null : period?.id ?? null),
    startMs,
    endMs,
    periodName: period?.name ?? null,
  };
}

function parseAsOfDate(value: unknown): number {
  const parsed = optionalInteger(value, "asOfDate", { min: 0 }) ?? Date.now();
  return parsed;
}

export async function getFinancialFactsTool(input: AgentScopeInput): Promise<{ scope: AgentScope; facts: Awaited<ReturnType<typeof getFinancialFacts>> }> {
  const scope = await resolveAgentScope(input);
  const asOfMs = Math.min(Date.now(), scope.endMs);
  const facts = await getFinancialFacts({
    startMs: scope.startMs,
    endMs: scope.endMs,
    asOfMs,
    periodId: scope.periodId ?? undefined,
  });
  return { scope, facts };
}

export async function getBudgetFactsTool(input: unknown) {
  if (!isRecord(input)) throw new Error("periodId is required");
  const periodId = optionalInteger(input.periodId, "periodId", { min: 1 });
  if (periodId == null) throw new Error("periodId is required");
  const period = (await db.select({ id: salaryPeriods.id, name: salaryPeriods.name, startDate: salaryPeriods.startDate, endDate: salaryPeriods.endDate })
    .from(salaryPeriods).where(eq(salaryPeriods.id, periodId)).limit(1))[0];
  if (!period) throw new Error("Period not found");
  return {
    period: { periodId: period.id, name: period.name, startMs: period.startDate, endMs: period.endDate },
    budgets: await getBudgetFacts(periodId),
  };
}

export async function getAccountBalancesTool(input: unknown) {
  if (!isRecord(input)) throw new Error("Tool input must be a JSON object");
  const asOfMs = parseAsOfDate(input.asOfDate);
  const rows = await db.select({
    id: accounts.id,
    name: accounts.name,
    type: accounts.type,
    isActive: accounts.isActive,
    provider: accounts.provider,
    systemKey: accounts.systemKey,
  }).from(accounts).where(eq(accounts.isActive, true));
  const balances = await Promise.all(rows.map(async (row) => ({
    ...row,
    balanceCents: await computeAccountBalanceAsOf(row.id, asOfMs),
  })));
  return { asOfMs, accounts: balances };
}

export async function getLoanBalancesTool(input: unknown) {
  if (!isRecord(input)) throw new Error("Tool input must be a JSON object");
  const status = input.status == null ? "active" : input.status;
  if (status !== "active" && status !== "all" && status !== "closed") throw new Error("status must be active, all, or closed");
  const rows = await db.select({
    id: loans.id,
    contactId: loans.contactId,
    contactName: contacts.name,
    direction: loans.direction,
    amountCents: loans.amountCents,
    remainingCents: loans.remainingCents,
    startDate: loans.startDate,
    dueDate: loans.dueDate,
    status: loans.status,
    description: loans.description,
    sourceType: loans.sourceType,
  }).from(loans).leftJoin(contacts, eq(loans.contactId, contacts.id)).where(
    status === "active" ? eq(loans.status, "active") : status === "closed" ? sql`${loans.status} <> 'active'` : undefined,
  );
  return {
    loans: rows,
    totalReceivableCents: rows.filter((row) => row.direction === "lent").reduce((sum, row) => sum + row.remainingCents, 0),
    totalPayableCents: rows.filter((row) => row.direction === "borrowed").reduce((sum, row) => sum + row.remainingCents, 0),
  };
}

export async function getPaylaterObligationsTool() {
  return getPaylaterObligations();
}

export async function getDueRecurringTool(input: unknown) {
  if (!isRecord(input)) throw new Error("Tool input must be a JSON object");
  const asOfMs = parseAsOfDate(input.asOfDate);
  const preview = await previewDueSubscriptionRenewals(asOfMs);
  return { asOfMs, ...preview, writesPerformed: false };
}

export async function getSalaryCatchUpTool() {
  return { ...(await previewSalaryCatchUp()), writesPerformed: false };
}

export async function searchTransactionsTool(input: unknown) {
  if (!isRecord(input)) throw new Error("Tool input must be a JSON object");
  const scopeInput = parseAgentScopeInput(input);
  const scope = await resolveAgentScope(scopeInput);
  const text = optionalText(input.text, "text", 200);
  const requestedLimit = optionalInteger(input.limit, "limit", { min: 1 }) ?? 50;
  const limit = Math.min(requestedLimit, MAX_TRANSACTION_SEARCH);
  const pattern = text ? `%${text.toLowerCase().replace(/[%_]/g, "\\$&")}%` : null;
  const rows = await db.all(sql`
    SELECT
      t.id,
      t.date,
      t.description,
      t.reference,
      t.notes,
      t.tx_type AS tx_type,
      t.status,
      t.period_id AS period_id,
      t.category_id AS category_id,
      c.name AS category,
      COALESCE(SUM(tl.debit), 0) AS debit_cents,
      COALESCE(SUM(tl.credit), 0) AS credit_cents,
      COALESCE(SUM(CASE WHEN a.type = 'expense' THEN tl.debit - tl.credit ELSE 0 END), 0) AS expense_cents,
      COALESCE(SUM(CASE WHEN a.type = 'revenue' THEN tl.credit - tl.debit ELSE 0 END), 0) AS income_cents
    FROM "transaction" t
    LEFT JOIN transaction_line tl ON tl.transaction_id = t.id
    LEFT JOIN account a ON a.id = tl.account_id
    LEFT JOIN category c ON c.id = t.category_id
    WHERE t.date >= ${scope.startMs}
      AND t.date <= ${scope.endMs}
      AND t.status <> 'draft'
      ${scope.periodId == null ? sql`` : sql`AND ${assignedOrLegacyPeriodMembership(scope.periodId, sql`t.period_id`)}`}
      ${pattern == null ? sql`` : sql`AND (lower(t.description) LIKE ${pattern} ESCAPE '\\' OR lower(coalesce(t.notes, '')) LIKE ${pattern} ESCAPE '\\' OR lower(coalesce(t.reference, '')) LIKE ${pattern} ESCAPE '\\')`}
    GROUP BY t.id, t.date, t.description, t.reference, t.notes, t.tx_type, t.status, t.period_id, t.category_id, c.name
    ORDER BY t.date DESC, t.id DESC
    LIMIT ${limit}
  `) as unknown as Array<Record<string, unknown>>;
  return {
    scope,
    transactions: rows.map((row) => ({
      id: Number(row.id),
      date: Number(row.date),
      description: String(row.description ?? ""),
      reference: row.reference == null ? null : String(row.reference),
      notes: row.notes == null ? null : String(row.notes),
      txType: String(row.tx_type ?? "manual"),
      status: String(row.status ?? "posted"),
      periodId: row.period_id == null ? null : Number(row.period_id),
      categoryId: row.category_id == null ? null : Number(row.category_id),
      category: row.category == null ? null : String(row.category),
      debitCents: Number(row.debit_cents ?? 0),
      creditCents: Number(row.credit_cents ?? 0),
      expenseCents: Number(row.expense_cents ?? 0),
      incomeCents: Number(row.income_cents ?? 0),
    })),
    limit,
  };
}

export async function getReconciliationStatusTool(input: unknown) {
  if (!isRecord(input)) throw new Error("Tool input must be a JSON object");
  const accountId = optionalInteger(input.accountId, "accountId", { min: 1 });
  const requestedLimit = optionalInteger(input.limit, "limit", { min: 1 }) ?? 20;
  const limit = Math.min(requestedLimit, MAX_RECONCILIATION_SESSIONS);
  const sessions = await db.select().from(reconciliationSessions).orderBy(desc(reconciliationSessions.asOfDate)).limit(limit);
  const sessionIds = sessions.map((session) => session.id);
  const items = sessionIds.length === 0 ? [] : await db.select({
    id: reconciliationItems.id,
    sessionId: reconciliationItems.sessionId,
    accountId: reconciliationItems.accountId,
    accountName: accounts.name,
    ledgerBalance: reconciliationItems.ledgerBalance,
    actualBalance: reconciliationItems.actualBalance,
    difference: reconciliationItems.difference,
    status: reconciliationItems.status,
  }).from(reconciliationItems)
    .innerJoin(accounts, eq(reconciliationItems.accountId, accounts.id))
    .where(and(
      inArray(reconciliationItems.sessionId, sessionIds),
      accountId == null ? undefined : eq(reconciliationItems.accountId, accountId),
    ));
  const itemsBySession = new Map<number, typeof items>();
  for (const item of items) {
    const current = itemsBySession.get(item.sessionId) ?? [];
    current.push(item);
    itemsBySession.set(item.sessionId, current);
  }
  return {
    sessions: sessions.map((session) => ({ ...session, items: itemsBySession.get(session.id) ?? [] })),
    accountId: accountId ?? null,
  };
}

export async function listPeriodsTool(input: unknown) {
  if (!isRecord(input)) throw new Error("Tool input must be a JSON object");
  const requestedLimit = optionalInteger(input.limit, "limit", { min: 1 }) ?? 24;
  const limit = Math.min(requestedLimit, 100);
  const periods = await db.select({
    id: salaryPeriods.id,
    name: salaryPeriods.name,
    startDate: salaryPeriods.startDate,
    endDate: salaryPeriods.endDate,
    status: salaryPeriods.status,
    closedAt: salaryPeriods.closedAt,
    reopenedAt: salaryPeriods.reopenedAt,
  })
    .from(salaryPeriods).orderBy(desc(salaryPeriods.endDate)).limit(limit);
  const periodIds = periods.map((period) => period.id);
  const budgets = periodIds.length === 0 ? [] : await db.select({ periodId: budgetPlans.periodId, plannedCents: sql<number>`coalesce(sum(${budgetPlans.plannedAmount}), 0)` })
    .from(budgetPlans).where(inArray(budgetPlans.periodId, periodIds)).groupBy(budgetPlans.periodId);
  const plannedByPeriod = new Map(budgets.map((row) => [row.periodId, Number(row.plannedCents ?? 0)]));
  return {
    periods: periods.map((period) => ({ ...period, plannedCents: plannedByPeriod.get(period.id) ?? 0 })),
    limit,
  };
}

export async function previewBudgetPlanTool(input: unknown) {
  if (!isRecord(input)) throw new Error("Tool input must be a JSON object");
  const periodId = optionalInteger(input.periodId, "periodId", { min: 1 });
  const targetSavingsRate = input.targetSavingsRate == null ? 20 : Number(input.targetSavingsRate);
  if (!Number.isFinite(targetSavingsRate) || targetSavingsRate < 0 || targetSavingsRate > 100) {
    throw new Error("targetSavingsRate must be between 0 and 100");
  }
  const { scope, facts } = await getFinancialFactsTool(periodId == null ? {} : { periodId });
  const incomeCents = facts.totalIncomeCents;
  const targetSpendCents = Math.max(0, Math.round(incomeCents * (1 - targetSavingsRate / 100)));
  const historicalSpendCents = facts.byCategory.reduce((sum, row) => sum + row.spentCents, 0);
  const scale = historicalSpendCents > 0 ? targetSpendCents / historicalSpendCents : 0;
  return {
    period: scope,
    targetSavingsRate,
    incomeCents,
    targetSpendCents,
    recommendations: facts.byCategory.map((row) => ({
      categoryId: row.categoryId,
      category: row.category,
      suggestedAmountCents: Math.max(0, Math.round(row.spentCents * scale)),
      basis: "scaled historical expense debits",
    })),
    requiresConfirmation: true,
    writesPerformed: false,
  };
}

export async function executeAgentTool(name: unknown, input: unknown): Promise<AgentToolResult> {
  if (typeof name !== "string" || !agentToolDefinitions.some((definition) => definition.name === name)) {
    throw new Error("Unknown or unavailable agent tool");
  }
  let data: unknown;
  switch (name) {
    case "get_financial_facts":
      data = await getFinancialFactsTool(parseAgentScopeInput(input));
      break;
    case "get_budget_facts":
      data = await getBudgetFactsTool(input);
      break;
    case "get_account_balances":
      data = await getAccountBalancesTool(input);
      break;
    case "get_loan_balances":
      data = await getLoanBalancesTool(input);
      break;
    case "get_paylater_obligations":
      data = await getPaylaterObligationsTool();
      break;
    case "get_due_recurring":
      data = await getDueRecurringTool(input);
      break;
    case "get_salary_catch_up":
      data = await getSalaryCatchUpTool();
      break;
    case "search_transactions":
      data = await searchTransactionsTool(input);
      break;
    case "get_reconciliation_status":
      data = await getReconciliationStatusTool(input);
      break;
    case "list_periods":
      data = await listPeriodsTool(input);
      break;
    case "preview_budget_plan":
      data = await previewBudgetPlanTool(input);
      break;
    default:
      throw new Error("Unknown or unavailable agent tool");
  }
  return { tool: name, revision: await getFinancialRevision(), readOnly: true, data };
}
