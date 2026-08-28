import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, like, lte, ne, sql } from "drizzle-orm";

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
  transactionTags,
  transactions,
  tags,
  transportRouteTemplates,
} from "../db/schema";
import { computeAccountBalanceAsOf } from "./ledger";
import { getBudgetFacts, getFinancialFacts } from "./financial-facts";
import { getFinancialRevision } from "./financial-revision";
import { getPaylaterObligations } from "./paylater";
import { previewDueSubscriptionRenewals } from "./subscription-renewals";
import { previewSalaryCatchUp } from "./salary-posting";
import { generateCashFlowStatement } from "./reports";
import { calculateBurnRate } from "./analytics";
import { assignedPeriodMembership, inclusivePeriodEnd } from "./period-locking";
import { getPeriodCoverage } from "./period-coverage";
import { prepareAgentAction } from "./agent-actions";
import { listMoneyAnomalyReviews } from "./money-anomaly-review";
import { reviewBudgetOutlook } from "./budget-outlook-review";
import { updateTransactionAtomically } from "./transaction-mutations";

const DAY_MS = 86_400_000;
const MAX_TRANSACTION_SEARCH = 100;
const MAX_CATEGORIES = 200;
const MAX_TAGS = 200;
const MAX_RECONCILIATION_SESSIONS = 50;
const CURRENCY_RATE_API = "https://api.frankfurter.app";
const CURRENCY_RATE_CACHE_TTL_MS = 5 * 60_000;
const currencyRateCache = new Map<string, { expiresAt: number; payload: CurrencyRatePayload }>();
const INTERNAL_CORRECTION_TX_TYPES = ["reversal", "domain_reversal", "historical_recovery_adjustment"] as const;

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
    anyOf?: Array<{ required: string[] }>;
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
  periodId: { type: "integer", minimum: 1, description: "Salary-period ID. Prefer this for a whole payroll period; omit it for a custom range." },
  startDate: { type: "integer", minimum: 0, description: "Inclusive UTC epoch timestamp in milliseconds. Use only with a custom range, not periodId." },
  endDate: { type: "integer", minimum: 0, description: "Inclusive UTC epoch timestamp in milliseconds. Use only with a custom range, not periodId." },
};

const scopeSchema = (): AgentToolDefinition["inputSchema"] => ({
  type: "object",
  properties: { ...scopeProperties },
  additionalProperties: false,
});

const journalLineSchema = {
  type: "object",
  properties: {
    accountId: { type: "integer", minimum: 1, description: "Account ID returned by get_account_balances." },
    debit: { type: "integer", minimum: 0, description: "Integer IDR amount on the debit side. Exactly one of debit or credit must be non-zero." },
    credit: { type: "integer", minimum: 0, description: "Integer IDR amount on the credit side. Exactly one of debit or credit must be non-zero." },
    description: { type: ["string", "null"], maxLength: 500, description: "Optional line-level note; normally omit when the journal description is sufficient." },
    cashFlowClass: { type: ["string", "null"], enum: ["operating", "investing", "financing", "transfer", null], description: "Required on every cash_equivalent account line and forbidden on non-cash lines. Use operating for ordinary income/expense, investing for investment movement, financing for borrowing/repayment, and transfer only between two cash-equivalent wallets." },
  },
  required: ["accountId", "debit", "credit"],
  additionalProperties: false,
} as const;

const transactionProposalProperties: Record<string, unknown> = {
  intent: { type: "string", enum: ["expense", "income", "transfer"], description: "The economic intent. expense requires an expense debit; income requires a revenue credit; transfer is only a two-wallet cash-equivalent transfer." },
  date: { type: "string", format: "date-time", pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d{1,3})?)?(?:Z|[+-]\\d{2}:\\d{2})$", description: "Timezone-aware ISO 8601 date/time, for example 2026-08-27T14:00:00+07:00. Use Asia/Jakarta unless the user supplies another timezone." },
  dateMs: { type: "integer", minimum: 0, description: "Legacy UTC epoch-millisecond input. Do not send this when date is supplied; prefer date." },
  description: { type: "string", minLength: 1, maxLength: 500, description: "Short user-facing transaction name." },
  reference: { type: ["string", "null"], maxLength: 500, description: "Optional external reference, receipt, or transfer reference." },
  notes: { type: ["string", "null"], maxLength: 2000, description: "Optional longer note; do not put accounting instructions here." },
  place: { type: ["string", "null"], maxLength: 500, description: "Optional merchant or location." },
  originName: { type: ["string", "null"], maxLength: 200, description: "Optional transport origin from a saved route template." },
  destName: { type: ["string", "null"], maxLength: 200, description: "Optional transport destination from a saved route template." },
  periodId: { type: ["integer", "null"], minimum: 1, description: "Optional explicit period ID. Omit to assign the open period containing date." },
  categoryId: { type: ["integer", "null"], minimum: 1, description: "Optional category for an expense only. Omit for income, transfers, and uncategorized fees." },
  categoryAllocations: {
    type: "array",
    maxItems: 100,
    description: "Optional signed integer-IDR allocations for an expense only. Their sum must equal the journal's net expense amount.",
    items: {
      type: "object",
      properties: {
        categoryId: { type: "integer", minimum: 1, description: "Active category ID from get_categories." },
        amount: { type: "integer", description: "Signed integer IDR allocation; all allocations must reconcile to the net expense." },
      },
      required: ["categoryId", "amount"],
      additionalProperties: false,
    },
  },
  lines: { type: "array", minItems: 2, maxItems: 100, description: "Balanced journal lines. Total debit must equal total credit.", items: journalLineSchema },
  tagIds: { type: "array", maxItems: 100, items: { type: "integer", minimum: 1 }, description: "Optional existing tag IDs." },
  assumptions: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 500 }, description: "Brief assumptions made while preparing this proposal, such as a confidently inferred category." },
};

const transactionProposalRequired = ["intent", "date", "description", "lines"];

export const agentToolDefinitions: AgentToolDefinition[] = [
  {
    name: "get_financial_facts",
    description: "Period-level canonical overview of posted income, spending, net result, category totals, and coverage. Use for broad questions such as 'how am I doing?'; use search_transactions for an itemized/filtered list and get_account_balances for individual accounts.",
    inputSchema: scopeSchema(),
  },
  {
    name: "calculate",
    description: "Evaluate a basic arithmetic expression deterministically. Use only when no purpose-built financial tool already supplies the calculation. Supports numbers, parentheses, +, -, *, /, %, and ^.",
    inputSchema: {
      type: "object",
      properties: { expression: { type: "string", minLength: 1, maxLength: 500 } },
      required: ["expression"],
      additionalProperties: false,
    },
  },
  {
    name: "get_current_datetime",
    description: "Read a separately verified current timestamp in UTC and Asia/Jakarta. The system runtime context already covers ordinary relative dates; use this only when an exact fresh time check matters.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "calculate_date_difference",
    description: "Calculate exact signed elapsed time between two UTC epoch-millisecond timestamps. Use for due-date or planning arithmetic after dates are known.",
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
    description: "Fetch a current or historical Frankfurter/ECB reference rate between ISO-4217 currencies. Returns the rate date and conversion; it is market reference data, never a transaction, bank settlement rate, or ledger valuation.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", pattern: "^[A-Za-z]{3}$", description: "Base ISO-4217 currency code, for example IDR." },
        to: { type: "string", pattern: "^[A-Za-z]{3}$", description: "Quote ISO-4217 currency code, for example USD." },
        amount: { type: "number", minimum: -1000000000000000, maximum: 1000000000000000, description: "Optional amount in the base currency for conversion; defaults to 1." },
        date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Optional UTC date for a historical reference rate; omit for the latest available rate." },
      },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "get_budget_facts",
    description: "Read one period's planned budget and posted expense actuals by category. Use get_category_variance when the question is specifically about over/under budget or variance.",
    inputSchema: {
      type: "object",
      properties: { periodId: scopeProperties.periodId },
      required: ["periodId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_account_balances",
    description: "Read all active account balances, types, and liquidity classes as of a timestamp. Use this to resolve named accounts/IDs before a proposal; use get_account_health for one account's reconciliation evidence. cash_equivalent lines require a cash-flow class, while non-cash lines must leave it null.",
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
    description: "Read loan receivables and payables, counterparties, remaining amounts, due dates, and status. Use before classifying lending, borrowing, or repayment; these are not automatically income or ordinary spending.",
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
    description: "Read pay-later principal, interest, payments, outstanding balances, and installment state. Use before discussing or classifying a pay-later settlement; it is not automatically ordinary spending.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_due_recurring",
    description: "Read subscription renewal occurrences due by a timestamp. This is a preview only: it never posts, skips, or changes an occurrence.",
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
    description: "Read unprocessed salary occurrence candidates after an absence. This is a preview only; do not claim that any salary was posted or skipped from this result.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "search_transactions",
    description: "Search effective posted transaction summaries by text, period, date range, or limit. Use for itemized or filtered activity; drafts and internal correction mechanics are excluded. Use get_transaction_details after you know the exact journal ID.",
    inputSchema: {
      type: "object",
      properties: {
        ...scopeProperties,
        text: { type: "string", maxLength: 200, description: "Optional text matched against description, notes, and reference." },
        limit: { type: "integer", minimum: 1, maximum: MAX_TRANSACTION_SEARCH, description: "Maximum returned summaries; defaults to 50." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_category_spending",
    description: "Read canonical posted spending by category, sorted by amount with percentage shares and coverage. Use for category rankings such as top spending; it is not a transaction list.",
    inputSchema: scopeSchema(),
  },
  {
    name: "find_similar_transactions",
    description: "Find deterministic historical candidates similar to a known transaction or merchant. Supply transactionId, or a non-empty query; amountCents is an optional integer-IDR refinement despite its legacy name. Similarity is review evidence, not an accounting conclusion.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 200, description: "Merchant/description text. Provide this or transactionId." },
        transactionId: { type: "integer", minimum: 1, description: "Known posted transaction to use as the similarity seed. Provide this or query." },
        amountCents: { type: "integer", minimum: 1, description: "Optional integer IDR amount refinement despite the legacy field name." },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "Maximum candidates; defaults to 20." },
      },
      anyOf: [{ required: ["query"] }, { required: ["transactionId"] }],
      additionalProperties: false,
    },
  },
  {
    name: "get_cash_flow",
    description: "Read the canonical cash-flow statement: operating, investing, financing, recovery bridge, and coverage. Use for 'where did cash go?' rather than category spending or a P&L overview.",
    inputSchema: scopeSchema(),
  },
  {
    name: "get_category_variance",
    description: "Compare a period's planned budget with allocation-aware posted spending, optionally for one category. Use for over/under-budget analysis; skipped/unknown coverage is never treated as under budget.",
    inputSchema: {
      type: "object",
      properties: { periodId: scopeProperties.periodId, categoryId: { type: "integer", minimum: 1, description: "Optional category to narrow the variance; omit for all categories." } },
      required: ["periodId"],
      additionalProperties: false,
    },
  },
  {
    name: "compare_periods",
    description: "Compare two to six salary periods on canonical income, spending, net result, and coverage. Use this rather than manually comparing several get_financial_facts results.",
    inputSchema: {
      type: "object",
      properties: { periodIds: { type: "array", minItems: 2, maxItems: 6, description: "Two to six distinct salary-period IDs to compare.", items: { type: "integer", minimum: 1 } } },
      required: ["periodIds"],
      additionalProperties: false,
    },
  },
  {
    name: "forecast_cash_position",
    description: "Project cash-equivalent balance from current cash and recorded operating burn over a requested horizon. This is a disclosed forecast, never a ledger mutation or a guarantee.",
    inputSchema: {
      type: "object",
      properties: { horizonMonths: { type: "integer", minimum: 1, maximum: 60, description: "Forecast horizon in whole months; defaults to 6." } },
      additionalProperties: false,
    },
  },
  {
    name: "review_budget_patterns",
    description: "Ask the configured model to classify deterministic budget outliers as one-off, unusual, recurring, or normal. The validated result is stored as revision-bound analytical metadata and never changes ledger facts, balances, or budget amounts.",
    inputSchema: {
      type: "object",
      properties: { periodId: { type: "integer", minimum: 1, description: "Salary-period ID to review." } },
      required: ["periodId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_account_health",
    description: "Read one account's balance, liquidity treatment, and latest reconciliation evidence. Use after get_account_balances when answering a health/reconciliation question about a specific account.",
    inputSchema: {
      type: "object",
      properties: { accountId: { type: "integer", minimum: 1, description: "Account ID from get_account_balances." }, asOfDate: { type: "integer", minimum: 0, description: "Inclusive UTC epoch timestamp in milliseconds; defaults to now." } },
      required: ["accountId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_money_anomalies",
    description: "Read human-reviewable anomaly candidates. Findings are signals for review, not proven errors, and this tool never changes ledger data.",
    inputSchema: {
      type: "object",
      properties: { status: { type: "string", enum: ["open", "resolved", "dismissed"], description: "Review-state filter; defaults to open." }, limit: { type: "integer", minimum: 1, maximum: 100, description: "Maximum findings; defaults to 50." } },
      additionalProperties: false,
    },
  },
  {
    name: "get_transaction_details",
    description: "Read one exact posted journal's header, notes, tags, debit/credit lines, cash-flow classifications, links, and category allocations. Use for audit/provenance after an exact transaction ID is known.",
    inputSchema: {
      type: "object",
      properties: { transactionId: { type: "integer", minimum: 1, description: "Exact posted transaction ID, usually returned by search_transactions." } },
      required: ["transactionId"],
      additionalProperties: false,
    },
  },
  {
    name: "update_transaction_tags",
    description: "Update descriptive tags on one exact posted transaction. Tags are metadata only and do not change categories, budgets, reports, balances, or cash flow. Use search_transactions or get_transaction_details first to resolve the exact transaction and get_tags to resolve tag IDs, then add, remove, or replace existing tag IDs. This explicit metadata update executes immediately and returns an audit receipt; it does not require accounting confirmation.",
    inputSchema: {
      type: "object",
      properties: {
        transactionId: { type: "integer", minimum: 1, description: "Exact posted transaction ID." },
        operation: { type: "string", enum: ["add", "remove", "replace"], description: "How to apply tagIds. Defaults to replace." },
        tagIds: { type: "array", maxItems: 100, items: { type: "integer", minimum: 1 }, description: "Existing tag IDs returned by get_tags." },
      },
      required: ["transactionId", "tagIds"],
      additionalProperties: false,
    },
  },
  {
    name: "get_tags",
    description: "Read available descriptive tags and IDs for transaction labeling. Tags are metadata only and do not affect categories, budgets, reports, balances, or cash flow.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", maxLength: 100, description: "Optional case-insensitive tag-name search." },
        limit: { type: "integer", minimum: 1, maximum: MAX_TAGS, description: "Maximum tags; defaults to all up to 200." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_transport_route_templates",
    description: "Read saved transport route templates for repeated trips. Templates provide reusable origin/destination, provider, service, category, account, notes, and tags; the fare and date still come from the current trip. Use before preparing a familiar transport expense when the user refers to a saved route.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", maxLength: 120, description: "Optional case-insensitive search across route names and locations." },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Maximum templates; defaults to 50." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "create_tag",
    description: "Create one new global descriptive tag for labeling transactions. Tags are metadata only and do not affect accounting or reporting. Use this only when the user explicitly asks for a new tag; then use the returned ID with update_transaction_tags or update_transaction_metadata. The tag is created immediately and returns an audit receipt without accounting confirmation.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: 100, description: "Human-readable tag name." },
        color: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$", description: "Optional six-digit hex color. Defaults to #2563EB." },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "update_transaction_metadata",
    description: "Update descriptive notes and/or tags on one or more exact posted transactions (up to 20). Metadata changes do not affect categories, budgets, reports, balances, or cash flow. Resolve exact transaction IDs with search_transactions and tag IDs with get_tags first. Each item must provide notes (a string or null to clear) and/or tagIds with tagOperation add, remove, or replace. Explicit metadata requests execute immediately and return per-transaction audit receipts without accounting confirmation.",
    inputSchema: {
      type: "object",
      properties: {
        transactions: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              transactionId: { type: "integer", minimum: 1, description: "Exact posted transaction ID." },
              notes: { type: ["string", "null"], maxLength: 2000, description: "Replacement notes. Use null to clear notes." },
              tagIds: { type: "array", maxItems: 100, items: { type: "integer", minimum: 1 }, description: "Existing tag IDs returned by get_tags." },
              tagOperation: { type: "string", enum: ["add", "remove", "replace"], description: "How to apply tagIds; defaults to replace." },
            },
            required: ["transactionId"],
            additionalProperties: false,
          },
        },
      },
      required: ["transactions"],
      additionalProperties: false,
    },
  },
  {
    name: "get_reconciliation_status",
    description: "Read reconciliation sessions and account-level differences, optionally for one account. Reconciliation is control evidence, never income, expense, or cash flow.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "integer", minimum: 1, description: "Optional account ID to narrow session items." },
        limit: { type: "integer", minimum: 1, maximum: MAX_RECONCILIATION_SESSIONS, description: "Maximum recent reconciliation sessions; defaults to 20." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_periods",
    description: "Read salary periods with dates, lifecycle/coverage status, and planned-budget totals. Use to choose a period, explain a return after an absence, or prepare a period comparison.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Maximum periods, newest first; defaults to 24." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "preview_budget_plan",
    description: "Create a read-only budget suggestion by scaling the selected period's recorded category spending to a target savings rate. It never writes or changes a budget.",
    inputSchema: {
      type: "object",
      properties: {
        periodId: scopeProperties.periodId,
        targetSavingsRate: { type: "number", minimum: 0, maximum: 100, description: "Desired savings percentage of the selected period's recorded income; defaults to 20." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "prepare_budget",
    description: "Prepare a non-posting budget setup or modification for an active open salary period. Retrieve the period and current budget first, then provide each category amount in integer IDR units. Existing categories not included stay unchanged; use zero deliberately to stop a category. Nothing changes until the user confirms the review card.",
    inputSchema: {
      type: "object",
      properties: {
        periodId: { type: "integer", minimum: 1, description: "Active open salary-period ID from list_periods." },
        plans: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          description: "Category budget amounts to create or update. Amounts are integer IDR units despite the legacy plannedAmountCents name.",
          items: {
            type: "object",
            properties: {
              categoryId: { type: "integer", minimum: 1, description: "Active category ID from get_categories." },
              plannedAmountCents: { type: "integer", minimum: 0, description: "Planned amount in whole IDR units. Use zero only when intentionally stopping a category." },
            },
            required: ["categoryId", "plannedAmountCents"],
            additionalProperties: false,
          },
        },
        assumptions: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 500 }, description: "Brief planning assumptions shown on the review card." },
      },
      required: ["periodId", "plans"],
      additionalProperties: false,
    },
  },
  {
    name: "get_categories",
    description: "Read active category IDs, names, and reporting-account links for classifying a standard spending expense. Call without search to load the small local list. Do not call for pure income, wallet transfers, loan/debt movements, or uncategorized transfer fees.",
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
    description: "Prepare one explicit, balanced, non-posting review proposal. Supports a standard expense, income, or two-wallet transfer. First resolve account IDs and liquidity with get_account_balances; load categories only for a categorised expense. Use a timezone-aware ISO date and an intent that the backend validates. Nothing is posted until the user confirms the resulting card.",
    inputSchema: {
      type: "object",
      properties: transactionProposalProperties,
      required: transactionProposalRequired,
      additionalProperties: false,
    },
  },
  {
    name: "prepare_transactions",
    description: "Prepare 1-20 independent, balanced, non-posting review proposals from one message. Each item has the same contract as prepare_transaction and becomes its own confirmable card. Do not merge unrelated events. If a transfer has a fee, prepare the fee as a separate expense item rather than merging it into the transfer journal.",
    inputSchema: {
      type: "object",
      properties: {
        transactions: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          description: "One independent transaction proposal per item. Each will have its own approval card.",
          items: {
            type: "object",
            properties: transactionProposalProperties,
            required: transactionProposalRequired,
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
  // Totals must include correction journals so they reconcile to the ledger,
  // but raw bookkeeping mechanics do not belong in a normal assistant answer.
  const visibleRows = facts.rows.filter((row) => row.status !== "reversed" && !INTERNAL_CORRECTION_TX_TYPES.includes(row.txType as typeof INTERNAL_CORRECTION_TX_TYPES[number]));
  return { scope, facts: { ...facts, rows: visibleRows }, coverage: await getPeriodCoverage(scope.startMs, scope.endMs) };
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
    liquidityClass: accounts.liquidityClass,
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
      AND t.status = 'posted'
      AND t.tx_type NOT IN ('reversal', 'domain_reversal', 'historical_recovery_adjustment')
      ${scope.periodId == null ? sql`` : sql`AND ${assignedPeriodMembership(scope.periodId, sql`t.period_id`)}`}
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

export async function findSimilarTransactionsTool(input: unknown) {
  if (!isRecord(input)) throw new Error("query or transactionId is required");
  const transactionId = optionalInteger(input.transactionId, "transactionId", { min: 1 });
  let query = optionalText(input.query, "query", 200);
  let amountCents = optionalInteger(input.amountCents, "amountCents", { min: 1 });
  let seedCategoryId: number | null = null;
  if (transactionId != null) {
    const [seed] = await db.select({ description: transactions.description, categoryId: transactions.categoryId })
      .from(transactions).where(and(eq(transactions.id, transactionId), ne(transactions.status, "draft"))).limit(1);
    if (!seed) throw new Error("Seed transaction not found");
    query = query ?? seed.description;
    seedCategoryId = seed.categoryId;
    const [amount] = await db.select({ amount: sql<number>`coalesce(sum(case when ${accounts.type} = 'expense' then ${transactionLines.debit} - ${transactionLines.credit} else 0 end), 0)` })
      .from(transactionLines).innerJoin(accounts, eq(transactionLines.accountId, accounts.id)).where(eq(transactionLines.transactionId, transactionId));
    amountCents = amountCents ?? Math.abs(Number(amount?.amount ?? 0));
  }
  if (!query && amountCents == null) throw new Error("query or transactionId is required");
  const tokens = (query ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 2).slice(0, 8);
  const rows = await db.all(sql`
    SELECT t.id, t.date, t.description, t.category_id AS category_id, c.name AS category,
      COALESCE(SUM(CASE WHEN a.type = 'expense' THEN tl.debit - tl.credit ELSE 0 END), 0) AS expense_cents
    FROM "transaction" t
    LEFT JOIN transaction_line tl ON tl.transaction_id = t.id
    LEFT JOIN account a ON a.id = tl.account_id
    LEFT JOIN category c ON c.id = t.category_id
    WHERE t.status = 'posted'
      AND t.tx_type NOT IN ('reversal', 'domain_reversal', 'historical_recovery_adjustment')
    GROUP BY t.id, t.date, t.description, t.category_id, c.name
    ORDER BY t.date DESC, t.id DESC
    LIMIT 500
  `) as unknown as Array<Record<string, unknown>>;
  const limit = Math.min(optionalInteger(input.limit, "limit", { min: 1 }) ?? 20, 50);
  const candidates = rows.map((row) => {
    const description = String(row.description ?? "");
    const haystack = description.toLowerCase();
    const matchingTokens = tokens.filter((token) => haystack.includes(token));
    const candidateAmount = Math.abs(Number(row.expense_cents ?? 0));
    const amountDelta = amountCents && candidateAmount ? Math.abs(candidateAmount - amountCents) / Math.max(amountCents, candidateAmount) : null;
    const categoryMatch = seedCategoryId != null && Number(row.category_id ?? 0) === seedCategoryId;
    const score = matchingTokens.length * 3 + (categoryMatch ? 2 : 0) + (amountDelta != null && amountDelta <= 0.1 ? 1 : 0);
    return { id: Number(row.id), date: Number(row.date), description, categoryId: row.category_id == null ? null : Number(row.category_id), category: row.category == null ? null : String(row.category), amountCents: candidateAmount, score, matchReasons: [...(matchingTokens.length ? [`description matched: ${matchingTokens.join(", ")}`] : []), ...(categoryMatch ? ["same category"] : []), ...(amountDelta != null && amountDelta <= 0.1 ? ["amount within 10%"] : [])] };
  }).filter((row) => row.id !== transactionId && row.score > 0).sort((a, b) => b.score - a.score || b.date - a.date).slice(0, limit);
  return { seed: { transactionId: transactionId ?? null, query: query ?? null, amountCents: amountCents ?? null }, candidates, deterministic: true };
}

export async function getCashFlowTool(input: unknown) {
  const scope = await resolveAgentScope(parseAgentScopeInput(input));
  const statement = await generateCashFlowStatement(scope.periodId ?? undefined, scope.periodId == null ? scope.startMs : undefined, scope.periodId == null ? scope.endMs : undefined);
  return { scope, statement, coverage: statement.coverage, provenance: { source: "canonical-cash-flow-statement", includesLegacyInference: true } };
}

export async function getCategoryVarianceTool(input: unknown) {
  if (!isRecord(input)) throw new Error("periodId is required");
  const periodId = optionalInteger(input.periodId, "periodId", { min: 1 });
  if (periodId == null) throw new Error("periodId is required");
  const categoryId = optionalInteger(input.categoryId, "categoryId", { min: 1 });
  const period = (await db.select({ id: salaryPeriods.id, name: salaryPeriods.name, startDate: salaryPeriods.startDate, endDate: salaryPeriods.endDate, coverageStatus: salaryPeriods.coverageStatus, coverageReason: salaryPeriods.coverageReason }).from(salaryPeriods).where(eq(salaryPeriods.id, periodId)).limit(1))[0];
  if (!period) throw new Error("Period not found");
  const facts = await getBudgetFacts(periodId);
  const rows = categoryId == null ? facts : facts.filter((row) => row.categoryId === categoryId);
  return { period, rows: rows.map((row) => ({ ...row, varianceCents: row.plannedCents - row.spentCents, isTracked: period.coverageStatus === "complete" || period.coverageStatus === "partial" })), coverage: await getPeriodCoverage(period.startDate, inclusivePeriodEnd(period.endDate)) };
}

export async function comparePeriodsTool(input: unknown) {
  if (!isRecord(input) || !Array.isArray(input.periodIds) || input.periodIds.length < 2) throw new Error("periodIds must contain at least two period IDs");
  const periodIds = input.periodIds.map((value, index) => optionalInteger(value, `periodIds[${index}]`, { min: 1 })).filter((value): value is number => value != null).slice(0, 6);
  const periods = await db.select({ id: salaryPeriods.id, name: salaryPeriods.name, startDate: salaryPeriods.startDate, endDate: salaryPeriods.endDate, coverageStatus: salaryPeriods.coverageStatus, coverageReason: salaryPeriods.coverageReason }).from(salaryPeriods).where(inArray(salaryPeriods.id, periodIds));
  if (periods.length !== periodIds.length) throw new Error("One or more periods not found");
  const results = await Promise.all(periods.map(async (period) => {
    const facts = await getFinancialFacts({ startMs: period.startDate, endMs: inclusivePeriodEnd(period.endDate), periodId: period.id });
    return { period, incomeCents: facts.totalIncomeCents, spentCents: facts.totalSpentCents, netCents: facts.totalIncomeCents - facts.totalSpentCents, byCategory: facts.byCategory, coverage: await getPeriodCoverage(period.startDate, inclusivePeriodEnd(period.endDate)) };
  }));
  return { periods: results, comparable: results.every((result) => result.coverage.isComparable), warnings: results.flatMap((result) => result.coverage.warnings) };
}

export async function forecastCashPositionTool(input: unknown) {
  if (!isRecord(input)) throw new Error("Tool input must be a JSON object");
  const horizonMonths = Math.min(optionalInteger(input.horizonMonths, "horizonMonths", { min: 1 }) ?? 6, 60);
  const liquidAccounts = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.type, "asset"), eq(accounts.isActive, true), eq(accounts.liquidityClass, "cash_equivalent")));
  const liquidBalanceCents = (await Promise.all(liquidAccounts.map((account) => computeAccountBalanceAsOf(account.id, Date.now())))).reduce((sum, balance) => sum + balance, 0);
  const burn = await calculateBurnRate();
  return { horizonMonths, currentCashCents: liquidBalanceCents, monthlyBurnCents: burn.grossBurnRate, projectedCashCents: liquidBalanceCents - burn.grossBurnRate * horizonMonths, assumptions: ["Uses active asset account balances as cash; use the runway/account-health tools for liquidity-class detail.", "Assumes recorded average operating burn continues; skipped/unknown periods are not treated as zero activity."], writesPerformed: false };
}

export async function getAccountHealthTool(input: unknown) {
  if (!isRecord(input)) throw new Error("accountId is required");
  const accountId = optionalInteger(input.accountId, "accountId", { min: 1 });
  if (accountId == null) throw new Error("accountId is required");
  const asOfMs = parseAsOfDate(input.asOfDate);
  const [account] = await db.select({ id: accounts.id, name: accounts.name, type: accounts.type, isActive: accounts.isActive, liquidityClass: accounts.liquidityClass, systemKey: accounts.systemKey }).from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!account) throw new Error("Account not found");
  const balanceCents = await computeAccountBalanceAsOf(accountId, asOfMs);
  const [latest] = await db.select({ id: reconciliationSessions.id, asOfDate: reconciliationSessions.asOfDate, status: reconciliationSessions.status, lifecycleStatus: reconciliationSessions.lifecycleStatus }).from(reconciliationSessions).innerJoin(reconciliationItems, eq(reconciliationItems.sessionId, reconciliationSessions.id)).where(and(eq(reconciliationItems.accountId, accountId), eq(reconciliationSessions.lifecycleStatus, "active"))).orderBy(desc(reconciliationSessions.asOfDate)).limit(1);
  return { account, asOfMs, balanceCents, latestReconciliation: latest ?? null, warnings: latest ? [] : ["No active reconciliation evidence found for this account"] };
}

export async function getMoneyAnomaliesTool(input: unknown) {
  if (!isRecord(input)) throw new Error("Tool input must be a JSON object");
  const status = input.status == null ? "open" : input.status;
  if (status !== "open" && status !== "resolved" && status !== "dismissed") throw new Error("status must be open, resolved, or dismissed");
  const limit = Math.min(optionalInteger(input.limit, "limit", { min: 1 }) ?? 50, 100);
  const reviews = await listMoneyAnomalyReviews(status);
  return { status, reviews: reviews.slice(0, limit), writesPerformed: false };
}

export async function getCategoriesTool(input: unknown) {
  if (!isRecord(input)) throw new Error("Tool input must be a JSON object");
  const search = optionalText(input.search, "search", 100);
  const requestedLimit = optionalInteger(input.limit, "limit", { min: 1 }) ?? MAX_CATEGORIES;
  const limit = Math.min(requestedLimit, MAX_CATEGORIES);
  const pattern = search ? `%${search.toLowerCase().replace(/[%_]/g, "\\$&")}%` : null;
  const rows = await db.select({ id: categories.id, name: categories.name, reportingAccountId: categories.reportingAccountId })
    .from(categories)
    .where(pattern == null ? eq(categories.isActive, true) : and(eq(categories.isActive, true), like(sql`lower(${categories.name})`, pattern)))
    .orderBy(categories.name)
    .limit(limit);
  return { search: search ?? null, categories: rows, limit };
}

export async function getTagsTool(input: unknown) {
  if (!isRecord(input)) throw new Error("Tool input must be a JSON object");
  const search = optionalText(input.search, "search", 100);
  const requestedLimit = optionalInteger(input.limit, "limit", { min: 1 }) ?? MAX_TAGS;
  const limit = Math.min(requestedLimit, MAX_TAGS);
  const pattern = search ? `%${search.toLowerCase().replace(/[%_]/g, "\\$&")}%` : null;
  const rows = await db.select({ id: tags.id, name: tags.name, color: tags.color })
    .from(tags)
    .where(pattern == null ? undefined : like(sql`lower(${tags.name})`, pattern))
    .orderBy(tags.name)
    .limit(limit);
  return { search: search ?? null, tags: rows, limit };
}

export async function getTransportRouteTemplatesTool(input: unknown) {
  if (!isRecord(input)) throw new Error("Tool input must be a JSON object");
  const search = optionalText(input.search, "search", 120)?.toLowerCase();
  const requestedLimit = optionalInteger(input.limit, "limit", { min: 1 }) ?? 50;
  const limit = Math.min(requestedLimit, 100);
  const rows = await db.select().from(transportRouteTemplates).orderBy(transportRouteTemplates.name).limit(100);
  const templates = rows.map((row) => {
    let tagIds: number[] = [];
    try {
      const parsed = JSON.parse(row.tagIds);
      if (Array.isArray(parsed)) tagIds = parsed.filter((id): id is number => Number.isSafeInteger(id) && id > 0);
    } catch { /* malformed metadata is treated as empty */ }
    return {
      id: row.id,
      name: row.name,
      provider: row.provider,
      service: row.service,
      originName: row.originName,
      originLat: row.originLat,
      originLng: row.originLng,
      destName: row.destName,
      destLat: row.destLat,
      destLng: row.destLng,
      categoryId: row.categoryId,
      defaultAccountId: row.defaultAccountId,
      notes: row.notes,
      tagIds,
    };
  }).filter((template) => !search || [template.name, template.originName, template.destName, template.provider, template.service]
    .some((value) => value?.toLowerCase().includes(search)));
  return { search: search ?? null, templates: templates.slice(0, limit), limit, writesPerformed: false };
}

export async function createTagTool(input: unknown, executionContext?: AgentToolExecutionContext) {
  if (!executionContext?.ownerEmail?.trim()) throw new Error("Creating tags requires an authenticated conversation");
  if (!isRecord(input)) throw new Error("Tool input must be a JSON object");
  const name = input.name;
  if (typeof name !== "string" || name.trim().length === 0 || name.length > 100) {
    throw new Error("name must be a non-empty string of at most 100 characters");
  }
  const normalizedName = name.trim();
  const color = input.color == null ? "#2563EB" : input.color;
  if (typeof color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(color)) {
    throw new Error("color must be a six-digit hex color such as #2563EB");
  }
  const [existing] = await db.select({ id: tags.id, name: tags.name, color: tags.color }).from(tags)
    .where(eq(sql`lower(${tags.name})`, normalizedName.toLowerCase())).limit(1);
  if (existing) {
    return { writesPerformed: false, alreadyExists: true, tag: existing, message: "A tag with this name already exists" };
  }
  const [created] = await db.insert(tags).values({ name: normalizedName, color: color.toUpperCase() }).returning({ id: tags.id, name: tags.name, color: tags.color });
  if (!created) throw new Error("Failed to create tag");
  return { writesPerformed: true, alreadyExists: false, receipt: { tagId: created.id, name: created.name, color: created.color } };
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
  const [lines, allocations, transactionTagRows] = await Promise.all([
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
    db.select({
      tagId: transactionTags.tagId,
      tag: tags.name,
      color: tags.color,
    }).from(transactionTags).innerJoin(tags, eq(transactionTags.tagId, tags.id))
      .where(eq(transactionTags.transactionId, transactionId)).orderBy(tags.name),
  ]);
  return { transaction, lines, categoryAllocations: allocations, tags: transactionTagRows };
}

export async function updateTransactionTagsTool(input: unknown, executionContext?: AgentToolExecutionContext) {
  if (!executionContext?.ownerEmail?.trim()) throw new Error("Tag updates require an authenticated conversation");
  if (!isRecord(input)) throw new Error("Tool input must be a JSON object");
  const transactionId = optionalInteger(input.transactionId, "transactionId", { min: 1 });
  if (transactionId == null) throw new Error("transactionId is required");
  const operation = input.operation == null ? "replace" : input.operation;
  if (operation !== "add" && operation !== "remove" && operation !== "replace") {
    throw new Error("operation must be add, remove, or replace");
  }
  if (!Array.isArray(input.tagIds) || input.tagIds.length > 100 || input.tagIds.some((id) => typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error("tagIds must contain at most 100 positive integer IDs");
  }
  const requestedTagIds = [...new Set(input.tagIds as number[])].sort((a, b) => a - b);
  const [transaction] = await db.select({ id: transactions.id, description: transactions.description, status: transactions.status, txType: transactions.txType })
    .from(transactions).where(eq(transactions.id, transactionId)).limit(1);
  if (!transaction || transaction.status !== "posted") throw new Error("Posted transaction not found");
  if (INTERNAL_CORRECTION_TX_TYPES.includes(transaction.txType as typeof INTERNAL_CORRECTION_TX_TYPES[number])) {
    throw new Error("Internal correction transactions cannot be tagged through the agent");
  }
  if (requestedTagIds.length > 0) {
    const validTags = await db.select({ id: tags.id }).from(tags).where(inArray(tags.id, requestedTagIds));
    if (validTags.length !== requestedTagIds.length) throw new Error("One or more tags do not exist; call get_tags first");
  }
  const currentRows = await db.select({ tagId: transactionTags.tagId }).from(transactionTags)
    .where(eq(transactionTags.transactionId, transactionId));
  const currentTagIds = currentRows.map((row) => row.tagId);
  const requestedSet = new Set(requestedTagIds);
  const nextTagIds = operation === "replace"
    ? requestedTagIds
    : operation === "add"
      ? [...new Set([...currentTagIds, ...requestedTagIds])].sort((a, b) => a - b)
      : currentTagIds.filter((tagId) => !requestedSet.has(tagId)).sort((a, b) => a - b);
  const changed = currentTagIds.length !== nextTagIds.length || currentTagIds.some((tagId) => !nextTagIds.includes(tagId));
  if (changed) await updateTransactionAtomically(transactionId, { tagIds: nextTagIds });
  const nextTags = nextTagIds.length === 0 ? [] : await db.select({ id: tags.id, name: tags.name, color: tags.color })
    .from(tags).where(inArray(tags.id, nextTagIds)).orderBy(tags.name);
  return {
    writesPerformed: changed,
    requiresConfirmation: false,
    receipt: {
      transactionId,
      operation,
      changed,
      previousTagIds: currentTagIds,
      tagIds: nextTagIds,
      tags: nextTags,
    },
    transaction: { id: transaction.id, description: transaction.description },
  };
}

export async function updateTransactionMetadataTool(input: unknown, executionContext?: AgentToolExecutionContext) {
  if (!executionContext?.ownerEmail?.trim()) throw new Error("Metadata updates require an authenticated conversation");
  if (!isRecord(input) || !Array.isArray(input.transactions) || input.transactions.length < 1 || input.transactions.length > 20) {
    throw new Error("transactions must contain 1-20 metadata updates");
  }
  const requests = input.transactions.map((candidate, index) => {
    if (!isRecord(candidate)) throw new Error(`transactions[${index}] must be an object`);
    const transactionId = optionalInteger(candidate.transactionId, `transactions[${index}].transactionId`, { min: 1 });
    if (transactionId == null) throw new Error(`transactions[${index}].transactionId is required`);
    const hasNotes = Object.prototype.hasOwnProperty.call(candidate, "notes");
    const hasTagIds = Object.prototype.hasOwnProperty.call(candidate, "tagIds");
    if (!hasNotes && !hasTagIds) throw new Error(`transactions[${index}] must include notes and/or tagIds`);
    let notes: string | null | undefined;
    if (hasNotes) {
      if (candidate.notes == null) notes = null;
      else if (typeof candidate.notes !== "string" || candidate.notes.length > 2000) throw new Error(`transactions[${index}].notes must be a string of at most 2000 characters or null`);
      else notes = candidate.notes.trim() || null;
    }
    const tagOperation = candidate.tagOperation == null ? "replace" : candidate.tagOperation;
    if (tagOperation !== "add" && tagOperation !== "remove" && tagOperation !== "replace") {
      throw new Error(`transactions[${index}].tagOperation must be add, remove, or replace`);
    }
    if (hasTagIds && (!Array.isArray(candidate.tagIds) || candidate.tagIds.length > 100 || candidate.tagIds.some((id) => typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0))) {
      throw new Error(`transactions[${index}].tagIds must contain at most 100 positive integer IDs`);
    }
    const tagIds = hasTagIds ? [...new Set(candidate.tagIds as number[])].sort((a, b) => a - b) : undefined;
    return { transactionId, hasNotes, hasTagIds, notes, tagOperation, tagIds };
  });
  const ids = requests.map((request) => request.transactionId);
  if (new Set(ids).size !== ids.length) throw new Error("transactions must not contain duplicate transaction IDs");
  const transactionRows = await db.select({ id: transactions.id, description: transactions.description, status: transactions.status, txType: transactions.txType, notes: transactions.notes })
    .from(transactions).where(inArray(transactions.id, ids));
  const transactionById = new Map(transactionRows.map((transaction) => [transaction.id, transaction]));
  for (const request of requests) {
    const transaction = transactionById.get(request.transactionId);
    if (!transaction || transaction.status !== "posted") throw new Error(`Posted transaction ${request.transactionId} not found`);
    if (INTERNAL_CORRECTION_TX_TYPES.includes(transaction.txType as typeof INTERNAL_CORRECTION_TX_TYPES[number])) {
      throw new Error(`Internal correction transaction ${request.transactionId} cannot be changed through the agent`);
    }
  }
  const requestedTagIds = [...new Set(requests.flatMap((request) => request.tagIds ?? []))];
  if (requestedTagIds.length > 0) {
    const validTags = await db.select({ id: tags.id }).from(tags).where(inArray(tags.id, requestedTagIds));
    if (validTags.length !== requestedTagIds.length) throw new Error("One or more tags do not exist; call get_tags first");
  }
  const existingTagRows = await db.select({ transactionId: transactionTags.transactionId, tagId: transactionTags.tagId })
    .from(transactionTags).where(inArray(transactionTags.transactionId, ids));
  const existingByTransaction = new Map<number, number[]>();
  for (const row of existingTagRows) existingByTransaction.set(row.transactionId, [...(existingByTransaction.get(row.transactionId) ?? []), row.tagId]);

  const results: Array<Record<string, unknown>> = [];
  for (const request of requests) {
    const transaction = transactionById.get(request.transactionId) as typeof transactionRows[number];
    const currentTagIds = [...(existingByTransaction.get(request.transactionId) ?? [])].sort((a, b) => a - b);
    const requestedTagIdsForTransaction = request.tagIds ?? [];
    const requestedSet = new Set(requestedTagIdsForTransaction);
    const nextTagIds = !request.hasTagIds
      ? currentTagIds
      : request.tagOperation === "replace"
        ? requestedTagIdsForTransaction
        : request.tagOperation === "add"
          ? [...new Set([...currentTagIds, ...requestedTagIdsForTransaction])].sort((a, b) => a - b)
          : currentTagIds.filter((tagId) => !requestedSet.has(tagId)).sort((a, b) => a - b);
    const nextNotes = request.hasNotes ? request.notes ?? null : transaction.notes;
    const tagsChanged = currentTagIds.length !== nextTagIds.length || currentTagIds.some((tagId, index) => tagId !== nextTagIds[index]);
    const notesChanged = nextNotes !== transaction.notes;
    if (tagsChanged || notesChanged) {
      await updateTransactionAtomically(request.transactionId, {
        ...(request.hasNotes ? { notes: nextNotes } : {}),
        ...(request.hasTagIds ? { tagIds: nextTagIds } : {}),
      });
    }
    results.push({
      transactionId: request.transactionId,
      description: transaction.description,
      changed: tagsChanged || notesChanged,
      changedFields: [ ...(notesChanged ? ["notes"] : []), ...(tagsChanged ? ["tags"] : []) ],
      notes: nextNotes,
      tagIds: nextTagIds,
    });
  }
  return {
    writesPerformed: results.some((result) => result.changed === true),
    requiresConfirmation: false,
    receipt: { transactionCount: results.length, changedCount: results.filter((result) => result.changed === true).length, transactions: results },
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
    case "find_similar_transactions":
      data = await findSimilarTransactionsTool(input);
      break;
    case "get_cash_flow":
      data = await getCashFlowTool(input);
      break;
    case "get_category_variance":
      data = await getCategoryVarianceTool(input);
      break;
    case "compare_periods":
      data = await comparePeriodsTool(input);
      break;
    case "forecast_cash_position":
      data = await forecastCashPositionTool(input);
      break;
    case "review_budget_patterns":
      if (!isRecord(input) || typeof input.periodId !== "number") throw new Error("periodId is required");
      data = await reviewBudgetOutlook(input.periodId);
      break;
    case "get_account_health":
      data = await getAccountHealthTool(input);
      break;
    case "get_money_anomalies":
      data = await getMoneyAnomaliesTool(input);
      break;
    case "get_categories":
      data = await getCategoriesTool(input);
      break;
    case "get_transaction_details":
      data = await getTransactionDetailsTool(input);
      break;
    case "update_transaction_tags":
      data = await updateTransactionTagsTool(input, executionContext);
      break;
    case "update_transaction_metadata":
      data = await updateTransactionMetadataTool(input, executionContext);
      break;
    case "get_tags":
      data = await getTagsTool(input);
      break;
    case "get_transport_route_templates":
      data = await getTransportRouteTemplatesTool(input);
      break;
    case "create_tag":
      data = await createTagTool(input, executionContext);
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
    case "prepare_budget":
      if (!executionContext?.ownerEmail) throw new Error("Budget proposals require an authenticated conversation");
      data = await prepareAgentAction({
        ownerEmail: executionContext.ownerEmail,
        conversationId: executionContext.conversationId,
        kind: "budget_plan_upsert",
        input,
        assumptions: isRecord(input) ? input.assumptions : undefined,
      });
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
      const batchId = randomUUID();
      for (const [index, transaction] of input.transactions.entries()) {
        try {
          proposals.push(await prepareAgentAction({
            ownerEmail: executionContext.ownerEmail,
            conversationId: executionContext.conversationId,
            kind: "transaction_journal_create",
            input: transaction,
            assumptions: isRecord(transaction) ? transaction.assumptions : undefined,
            batchId,
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
  return { tool: name, revision: await getFinancialRevision(), readOnly: !["prepare_transaction", "prepare_transactions", "prepare_budget", "review_budget_patterns", "update_transaction_tags", "update_transaction_metadata", "create_tag"].includes(name), data };
}
