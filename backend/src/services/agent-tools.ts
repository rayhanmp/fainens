import { and, desc, eq, gte, inArray, like, lte, sql } from "drizzle-orm";

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
  transactionCategoryAllocations,
  transactionLines,
  transactions,
} from "../db/schema";
import { computeAccountBalanceAsOf } from "./ledger";
import { getBudgetFacts, getFinancialFacts } from "./financial-facts";
import { getFinancialRevision } from "./financial-revision";
import { getPaylaterObligations } from "./paylater";
import { previewDueSubscriptionRenewals } from "./subscription-renewals";
import { previewSalaryCatchUp } from "./salary-posting";
import { assignedOrLegacyPeriodMembership, inclusivePeriodEnd } from "./period-locking";
import { getPeriodCoverage } from "./period-coverage";
import { prepareAgentAction } from "./agent-actions";

const DAY_MS = 86_400_000;
const MAX_TRANSACTION_SEARCH = 100;
const MAX_CATEGORIES = 200;
const MAX_RECONCILIATION_SESSIONS = 50;
const CURRENCY_RATE_API = "https://api.frankfurter.app";
const CURRENCY_RATE_CACHE_TTL_MS = 5 * 60_000;
const currencyRateCache = new Map<string, { expiresAt: number; payload: CurrencyRatePayload }>();

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
  readOnly: boolean;
  data: T;
}

export interface AgentToolExecutionContext {
  ownerEmail: string;
  conversationId?: number | null;
}

interface CurrencyRatePayload {
  amount: number;
  base: string;
  date: string;
  rates: Record<string, number>;
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
    name: "calculate",
    description: "Evaluate a basic arithmetic expression deterministically. Supports numbers, parentheses, +, -, *, /, %, and ^. It never accesses financial data.",
    inputSchema: {
      type: "object",
      properties: { expression: { type: "string", minLength: 1, maxLength: 500 } },
      required: ["expression"],
      additionalProperties: false,
    },
  },
  {
    name: "get_current_datetime",
    description: "Read the current timestamp in UTC and Asia/Jakarta for date-sensitive planning. It never accesses financial data.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "calculate_date_difference",
    description: "Calculate the exact signed elapsed time between two UTC millisecond timestamps. Useful for due-date and planning arithmetic.",
    inputSchema: {
      type: "object",
      properties: {
        startDate: { type: "integer", minimum: 0, description: "Start UTC timestamp in milliseconds." },
        endDate: { type: "integer", minimum: 0, description: "End UTC timestamp in milliseconds." },
      },
      required: ["startDate", "endDate"],
      additionalProperties: false,
    },
  },
  {
    name: "get_currency_exchange_rate",
    description: "Fetch a current or historical reference exchange rate between two ISO-4217 currencies from Frankfurter/ECB. Returns the source date, rate, and converted amount; this is market reference data, not a transaction or accounting valuation.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", pattern: "^[A-Za-z]{3}$", description: "Base ISO-4217 currency code, for example IDR." },
        to: { type: "string", pattern: "^[A-Za-z]{3}$", description: "Quote ISO-4217 currency code, for example USD." },
        amount: { type: "number", minimum: -1000000000000000, maximum: 1000000000000000, description: "Optional amount in the base currency; defaults to 1." },
        date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Optional UTC date for a historical reference rate; omit for the latest available rate." },
      },
      required: ["from", "to"],
      additionalProperties: false,
    },
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
    name: "get_category_spending",
    description: "Read canonical posted spending by category, sorted by amount with percentage shares and period-coverage disclosure.",
    inputSchema: scopeSchema(),
  },
  {
    name: "get_transaction_details",
    description: "Read one exact journal's immutable header, debit/credit lines, cash-flow classifications, and category allocations for audit/provenance.",
    inputSchema: {
      type: "object",
      properties: { transactionId: { type: "integer", minimum: 1 } },
      required: ["transactionId"],
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
  {
    name: "get_categories",
    description: "Read the small active category list (IDs, names, and reporting-account links) for transaction classification. Call without search when preparing a transaction so the model can choose the closest category locally.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", maxLength: 100, description: "Optional case-insensitive category-name search." },
        limit: { type: "integer", minimum: 1, maximum: MAX_CATEGORIES, description: "Maximum categories; defaults to all up to 200." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "prepare_transaction",
    description: "Prepare an explicit balanced manual journal proposal for user review. This never posts or changes financial data. First retrieve account IDs and the local category list when needed; ask a clarification only for missing date, amount, or account facts, while a clear merchant/category may be reasonably inferred.",
    inputSchema: {
      type: "object",
      properties: {
        dateMs: { type: "integer", minimum: 0, description: "Transaction date as a UTC timestamp in milliseconds." },
        description: { type: "string", minLength: 1, maxLength: 500 },
        reference: { type: ["string", "null"], maxLength: 500 },
        notes: { type: ["string", "null"], maxLength: 2000 },
        place: { type: ["string", "null"], maxLength: 500 },
        periodId: { type: ["integer", "null"], minimum: 1 },
        categoryId: { type: ["integer", "null"], minimum: 1 },
        categoryAllocations: {
          type: "array",
          maxItems: 100,
          items: {
            type: "object",
            properties: { categoryId: { type: "integer", minimum: 1 }, amount: { type: "integer" } },
            required: ["categoryId", "amount"],
            additionalProperties: false,
          },
        },
        lines: {
          type: "array",
          minItems: 2,
          maxItems: 100,
          items: {
            type: "object",
            properties: {
              accountId: { type: "integer", minimum: 1 },
              debit: { type: "integer", minimum: 0 },
              credit: { type: "integer", minimum: 0 },
              description: { type: ["string", "null"], maxLength: 500 },
              cashFlowClass: { type: ["string", "null"], enum: ["operating", "investing", "financing", "transfer", "recovery", null] },
            },
            required: ["accountId", "debit", "credit"],
            additionalProperties: false,
          },
        },
        tagIds: { type: "array", maxItems: 100, items: { type: "integer", minimum: 1 } },
        assumptions: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 500 } },
      },
      required: ["dateMs", "description", "lines"],
      additionalProperties: false,
    },
  },
  {
    name: "prepare_transactions",
    description: "Prepare several independent explicit balanced manual journal proposals from one user message. Each item becomes its own review card and nothing is posted. Do not merge unrelated transactions; ask for clarification when a required item is ambiguous.",
    inputSchema: {
      type: "object",
      properties: {
        transactions: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          description: "One explicit transaction payload per independent transaction.",
          items: {
            type: "object",
            properties: {
              dateMs: { type: "integer", minimum: 0, description: "Transaction date as a UTC timestamp in milliseconds." },
              description: { type: "string", minLength: 1, maxLength: 500 },
              reference: { type: ["string", "null"], maxLength: 500 },
              notes: { type: ["string", "null"], maxLength: 2000 },
              place: { type: ["string", "null"], maxLength: 500 },
              periodId: { type: ["integer", "null"], minimum: 1 },
              categoryId: { type: ["integer", "null"], minimum: 1 },
              categoryAllocations: {
                type: "array",
                maxItems: 100,
                items: {
                  type: "object",
                  properties: { categoryId: { type: "integer", minimum: 1 }, amount: { type: "integer" } },
                  required: ["categoryId", "amount"],
                  additionalProperties: false,
                },
              },
              lines: {
                type: "array",
                minItems: 2,
                maxItems: 100,
                items: {
                  type: "object",
                  properties: {
                    accountId: { type: "integer", minimum: 1 },
                    debit: { type: "integer", minimum: 0 },
                    credit: { type: "integer", minimum: 0 },
                    description: { type: ["string", "null"], maxLength: 500 },
                    cashFlowClass: { type: ["string", "null"], enum: ["operating", "investing", "financing", "transfer", "recovery", null] },
                  },
                  required: ["accountId", "debit", "credit"],
                  additionalProperties: false,
                },
              },
              tagIds: { type: "array", maxItems: 100, items: { type: "integer", minimum: 1 } },
              assumptions: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 500 } },
            },
            required: ["dateMs", "description", "lines"],
            additionalProperties: false,
          },
        },
      },
      required: ["transactions"],
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

class ArithmeticParser {
  private index = 0;

  constructor(private readonly expression: string) {}

  parse(): number {
    const value = this.parseSum();
    this.skipWhitespace();
    if (this.index !== this.expression.length) throw new Error("Invalid arithmetic expression");
    return this.assertFinite(value);
  }

  private parseSum(): number {
    let value = this.parseProduct();
    while (true) {
      this.skipWhitespace();
      if (this.consume("+")) value = this.assertFinite(value + this.parseProduct());
      else if (this.consume("-")) value = this.assertFinite(value - this.parseProduct());
      else return value;
    }
  }

  private parseProduct(): number {
    let value = this.parsePower();
    while (true) {
      this.skipWhitespace();
      if (this.consume("*")) value = this.assertFinite(value * this.parsePower());
      else if (this.consume("/")) {
        const divisor = this.parsePower();
        if (divisor === 0) throw new Error("Division by zero");
        value = this.assertFinite(value / divisor);
      } else if (this.consume("%")) {
        const divisor = this.parsePower();
        if (divisor === 0) throw new Error("Division by zero");
        value = this.assertFinite(value % divisor);
      } else return value;
    }
  }

  private parsePower(): number {
    let value = this.parseUnary();
    this.skipWhitespace();
    if (this.consume("^")) value = this.assertFinite(value ** this.parsePower());
    return value;
  }

  private parseUnary(): number {
    this.skipWhitespace();
    if (this.consume("+")) return this.parseUnary();
    if (this.consume("-")) return this.assertFinite(-this.parseUnary());
    if (this.consume("(")) {
      const value = this.parseSum();
      this.skipWhitespace();
      if (!this.consume(")")) throw new Error("Missing closing parenthesis");
      return value;
    }
    const start = this.index;
    while (/[0-9.]/.test(this.expression[this.index] ?? "")) this.index += 1;
    if (start === this.index) throw new Error("Expected a number");
    const value = Number(this.expression.slice(start, this.index));
    if (!Number.isFinite(value)) throw new Error("Invalid number");
    return value;
  }

  private consume(token: string): boolean {
    if (!this.expression.startsWith(token, this.index)) return false;
    this.index += token.length;
    return true;
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.expression[this.index] ?? "")) this.index += 1;
  }

  private assertFinite(value: number): number {
    if (!Number.isFinite(value) || Math.abs(value) > 1e15) throw new Error("Result is outside the supported range");
    return value;
  }
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

export async function getFinancialFactsTool(input: AgentScopeInput): Promise<{ scope: AgentScope; facts: Awaited<ReturnType<typeof getFinancialFacts>>; coverage: Awaited<ReturnType<typeof getPeriodCoverage>> }> {
  const scope = await resolveAgentScope(input);
  const asOfMs = Math.min(Date.now(), scope.endMs);
  const facts = await getFinancialFacts({
    startMs: scope.startMs,
    endMs: scope.endMs,
    asOfMs,
    periodId: scope.periodId ?? undefined,
  });
  return { scope, facts, coverage: await getPeriodCoverage(scope.startMs, scope.endMs) };
}

export function calculateTool(input: unknown) {
  if (!isRecord(input)) throw new Error("Tool input must be a JSON object");
  const expression = optionalText(input.expression, "expression", 500);
  if (!expression) throw new Error("expression is required");
  return { expression, result: new ArithmeticParser(expression).parse() };
}

export function getCurrentDatetimeTool() {
  const nowMs = Date.now();
  return {
    nowMs,
    utcIso: new Date(nowMs).toISOString(),
    asiaJakarta: new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta", dateStyle: "full", timeStyle: "long",
    }).format(new Date(nowMs)),
  };
}

export function calculateDateDifferenceTool(input: unknown) {
  if (!isRecord(input)) throw new Error("Tool input must be a JSON object");
  const startDate = optionalInteger(input.startDate, "startDate", { min: 0 });
  const endDate = optionalInteger(input.endDate, "endDate", { min: 0 });
  if (startDate == null || endDate == null) throw new Error("startDate and endDate are required");
  const milliseconds = endDate - startDate;
  return {
    startDate,
    endDate,
    milliseconds,
    hours: milliseconds / (60 * 60 * 1000),
    days: milliseconds / DAY_MS,
  };
}

function requiredCurrencyCode(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[A-Za-z]{3}$/.test(value.trim())) {
    throw new Error(`${field} must be a three-letter ISO-4217 currency code`);
  }
  return value.trim().toUpperCase();
}

function optionalCurrencyDate(value: unknown): string | undefined {
  const date = optionalText(value, "date", 10);
  if (date == null) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("date must use YYYY-MM-DD");
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error("date must be a valid calendar date");
  }
  return date;
}

async function fetchCurrencyRate(base: string, quote: string, date?: string): Promise<CurrencyRatePayload> {
  const endpoint = date == null ? `${CURRENCY_RATE_API}/latest` : `${CURRENCY_RATE_API}/${date}`;
  const url = `${endpoint}?from=${encodeURIComponent(base)}&to=${encodeURIComponent(quote)}`;
  const cacheKey = `${base}:${quote}:${date ?? "latest"}`;
  const cached = currencyRateCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { headers: { accept: "application/json" }, signal: controller.signal });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200).replace(/\s+/g, " ").trim();
      throw new Error(`Currency provider returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    const payload = await response.json() as Partial<CurrencyRatePayload>;
    const rate = payload.rates?.[quote];
    if (payload.base !== base || typeof payload.date !== "string" || typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
      throw new Error("Currency provider returned an invalid exchange-rate payload");
    }
    const normalized: CurrencyRatePayload = { amount: 1, base, date: payload.date, rates: { [quote]: rate } };
    currencyRateCache.set(cacheKey, { expiresAt: Date.now() + CURRENCY_RATE_CACHE_TTL_MS, payload: normalized });
    return normalized;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("Currency provider timed out after 8 seconds");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getCurrencyExchangeRateTool(input: unknown) {
  if (!isRecord(input)) throw new Error("from and to are required");
  const from = requiredCurrencyCode(input.from, "from");
  const to = requiredCurrencyCode(input.to, "to");
  const date = optionalCurrencyDate(input.date);
  const amount = input.amount == null ? 1 : input.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || Math.abs(amount) > 1e15) {
    throw new Error("amount must be a finite number between -1e15 and 1e15");
  }
  if (from === to) {
    return {
      from,
      to,
      amount,
      rate: 1,
      convertedAmount: amount,
      rateDate: date ?? new Date().toISOString().slice(0, 10),
      source: "identity rate (same currency)",
      isReferenceRate: true,
    };
  }
  const payload = await fetchCurrencyRate(from, to, date);
  const rate = payload.rates[to];
  return {
    from,
    to,
    amount,
    rate,
    convertedAmount: amount * rate,
    rateDate: payload.date,
    source: "Frankfurter / European Central Bank reference rates",
    sourceUrl: CURRENCY_RATE_API,
    isReferenceRate: true,
    fetchedAt: new Date().toISOString(),
  };
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
    coverage: await getPeriodCoverage(period.startDate, inclusiveEndOfSelectedDay(period.endDate)),
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

export async function getCategorySpendingTool(input: unknown) {
  const { scope, facts, coverage } = await getFinancialFactsTool(parseAgentScopeInput(input));
  const totalSpentCents = facts.totalSpentCents;
  return {
    scope,
    totalSpentCents,
    categories: facts.byCategory
      .filter((row) => row.spentCents !== 0)
      .sort((left, right) => right.spentCents - left.spentCents)
      .map((row) => ({
        ...row,
        sharePercent: totalSpentCents === 0 ? 0 : Math.round((row.spentCents / totalSpentCents) * 10_000) / 100,
      })),
    coverage,
  };
}

export async function getCategoriesTool(input: unknown) {
  if (!isRecord(input)) throw new Error("Tool input must be a JSON object");
  const search = optionalText(input.search, "search", 100);
  const requestedLimit = optionalInteger(input.limit, "limit", { min: 1 }) ?? MAX_CATEGORIES;
  const limit = Math.min(requestedLimit, MAX_CATEGORIES);
  const pattern = search ? `%${search.toLowerCase().replace(/[%_]/g, "\\$&")}%` : null;
  const rows = await db.select({ id: categories.id, name: categories.name, reportingAccountId: categories.reportingAccountId })
    .from(categories)
    .where(pattern == null ? undefined : like(sql`lower(${categories.name})`, pattern))
    .orderBy(categories.name)
    .limit(limit);
  return { search: search ?? null, categories: rows, limit };
}

export async function getTransactionDetailsTool(input: unknown) {
  if (!isRecord(input)) throw new Error("Tool input must be a JSON object");
  const transactionId = optionalInteger(input.transactionId, "transactionId", { min: 1 });
  if (transactionId == null) throw new Error("transactionId is required");
  const [transaction] = await db.select({
    id: transactions.id,
    date: transactions.date,
    dueDate: transactions.dueDate,
    description: transactions.description,
    reference: transactions.reference,
    notes: transactions.notes,
    place: transactions.place,
    txType: transactions.txType,
    status: transactions.status,
    periodId: transactions.periodId,
    categoryId: transactions.categoryId,
    category: categories.name,
    linkedTxId: transactions.linkedTxId,
    reversalOfTxId: transactions.reversalOfTxId,
  }).from(transactions).leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(and(eq(transactions.id, transactionId), eq(transactions.status, "posted"))).limit(1);
  if (!transaction) throw new Error("Posted transaction not found");
  const [lines, allocations] = await Promise.all([
    db.select({
      id: transactionLines.id,
      accountId: transactionLines.accountId,
      accountName: accounts.name,
      accountType: accounts.type,
      debitCents: transactionLines.debit,
      creditCents: transactionLines.credit,
      description: transactionLines.description,
      cashFlowClass: transactionLines.cashFlowClass,
    }).from(transactionLines).innerJoin(accounts, eq(transactionLines.accountId, accounts.id))
      .where(eq(transactionLines.transactionId, transactionId)).orderBy(transactionLines.id),
    db.select({
      categoryId: transactionCategoryAllocations.categoryId,
      category: categories.name,
      amountCents: transactionCategoryAllocations.amount,
    }).from(transactionCategoryAllocations).innerJoin(categories, eq(transactionCategoryAllocations.categoryId, categories.id))
      .where(eq(transactionCategoryAllocations.transactionId, transactionId)),
  ]);
  return { transaction, lines, categoryAllocations: allocations };
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
    coverageStatus: salaryPeriods.coverageStatus,
    coverageReason: salaryPeriods.coverageReason,
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

export async function executeAgentTool(name: unknown, input: unknown, executionContext?: AgentToolExecutionContext): Promise<AgentToolResult> {
  if (typeof name !== "string" || !agentToolDefinitions.some((definition) => definition.name === name)) {
    throw new Error("Unknown or unavailable agent tool");
  }
  let data: unknown;
  switch (name) {
    case "get_financial_facts":
      data = await getFinancialFactsTool(parseAgentScopeInput(input));
      break;
    case "calculate":
      data = calculateTool(input);
      break;
    case "get_current_datetime":
      data = getCurrentDatetimeTool();
      break;
    case "calculate_date_difference":
      data = calculateDateDifferenceTool(input);
      break;
    case "get_currency_exchange_rate":
      data = await getCurrencyExchangeRateTool(input);
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
    case "get_category_spending":
      data = await getCategorySpendingTool(input);
      break;
    case "get_categories":
      data = await getCategoriesTool(input);
      break;
    case "get_transaction_details":
      data = await getTransactionDetailsTool(input);
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
    case "prepare_transaction":
      if (!executionContext?.ownerEmail) throw new Error("Transaction proposals require an authenticated conversation");
      data = await prepareAgentAction({
        ownerEmail: executionContext.ownerEmail,
        conversationId: executionContext.conversationId,
        kind: "transaction_journal_create",
        input,
        assumptions: isRecord(input) ? input.assumptions : undefined,
      });
      break;
    case "prepare_transactions": {
      if (!executionContext?.ownerEmail) throw new Error("Transaction proposals require an authenticated conversation");
      if (!isRecord(input) || !Array.isArray(input.transactions) || input.transactions.length < 1 || input.transactions.length > 20) {
        throw new Error("transactions must contain 1-20 transaction payloads");
      }
      const proposals: unknown[] = [];
      const errors: Array<{ index: number; error: string }> = [];
      for (const [index, transaction] of input.transactions.entries()) {
        try {
          proposals.push(await prepareAgentAction({
            ownerEmail: executionContext.ownerEmail,
            conversationId: executionContext.conversationId,
            kind: "transaction_journal_create",
            input: transaction,
            assumptions: isRecord(transaction) ? transaction.assumptions : undefined,
          }));
        } catch (error) {
          errors.push({ index, error: error instanceof Error ? error.message : "Transaction proposal failed" });
        }
      }
      if (proposals.length === 0 && errors.length > 0) {
        throw new Error(`No transaction proposals could be prepared: ${errors.map((item) => `#${item.index + 1} ${item.error}`).join("; ")}`);
      }
      data = { proposals: proposals.map((proposal) => isRecord(proposal) && "data" in proposal ? proposal.data : proposal), errors };
      break;
    }
    default:
      throw new Error("Unknown or unavailable agent tool");
  }
  return { tool: name, revision: await getFinancialRevision(), readOnly: name !== "prepare_transaction" && name !== "prepare_transactions", data };
}
