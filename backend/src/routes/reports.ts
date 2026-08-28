import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db/client";
import { salaryPeriods } from "../db/schema";
import {
  generateIncomeStatement,
  generateBalanceSheet,
  generateCashFlowStatement,
  generateSpendingBreakdown,
  exportReportToCSV,
} from "../services/reports";
import { getBudgetFacts, getFinancialFacts } from "../services/financial-facts";
import { getFinancialRevision } from "../services/financial-revision";
import { getPeriodCoverage } from "../services/period-coverage";

// Query parameter schemas
const periodQuerySchema = z.object({
  periodId: z.coerce.number().int().positive().optional(),
  startDate: z.coerce.number().int().nonnegative().optional(),
  endDate: z.coerce.number().int().nonnegative().optional(),
}).superRefine((query, ctx) => {
  if ((query.startDate === undefined) !== (query.endDate === undefined)) {
    ctx.addIssue({ code: "custom", message: "startDate and endDate must be supplied together" });
  }
  if (query.startDate !== undefined && query.endDate !== undefined && query.startDate > query.endDate) {
    ctx.addIssue({ code: "custom", message: "startDate must be before or equal to endDate" });
  }
});

const asOfQuerySchema = z.object({
  asOfDate: z.coerce.number().int().nonnegative().optional(),
});

const reportErrorSchema = z.object({ error: z.string(), issues: z.array(z.unknown()).optional() }).passthrough();
const reportCoverageSchema = z.object({
  complete: z.array(z.number().int()),
  partial: z.array(z.number().int()),
  skipped: z.array(z.number().int()),
  unknown: z.array(z.number().int()),
  isComparable: z.boolean(),
  warnings: z.array(z.string()),
}).passthrough();
const incomeStatementItemSchema = z.object({ name: z.string(), code: z.string().optional(), amount: z.number(), isTotal: z.boolean().optional(), level: z.number().int() }).passthrough();
const incomeStatementSchema = z.object({
  revenue: z.array(incomeStatementItemSchema),
  expenses: z.array(incomeStatementItemSchema),
  totalRevenue: z.number(),
  totalExpenses: z.number(),
  netIncome: z.number(),
  periodName: z.string().optional(),
  startDate: z.number().optional(),
  endDate: z.number().optional(),
  coverage: reportCoverageSchema.optional(),
}).passthrough();
const balanceSheetItemSchema = z.object({ name: z.string(), code: z.string(), balance: z.number(), level: z.number().int(), isTotal: z.boolean().optional() }).passthrough();
const balanceSheetSchema = z.object({
  assets: z.array(balanceSheetItemSchema),
  liabilities: z.array(balanceSheetItemSchema),
  equity: z.array(balanceSheetItemSchema),
  totalAssets: z.number(),
  totalLiabilities: z.number(),
  totalEquity: z.number(),
  asOfDate: z.string(),
}).passthrough();
const cashFlowItemSchema = z.object({ category: z.string(), description: z.string(), amount: z.number(), type: z.enum(["operating", "investing", "financing"]), classificationSource: z.enum(["explicit", "legacy_inference"]) }).passthrough();
const cashFlowSchema = z.object({
  operating: z.array(cashFlowItemSchema),
  investing: z.array(cashFlowItemSchema),
  financing: z.array(cashFlowItemSchema),
  netOperating: z.number(),
  netInvesting: z.number(),
  netFinancing: z.number(),
  netChange: z.number(),
  historicalRecoveryBridge: z.number().optional(),
  beginningCash: z.number(),
  endingCash: z.number(),
  periodName: z.string().optional(),
  coverage: reportCoverageSchema.optional(),
}).passthrough();
const spendingBreakdownSchema = z.object({ category: z.string(), accountId: z.number().int(), amount: z.number(), percentage: z.number() }).passthrough();
const spendingReportSchema = z.object({ breakdown: z.array(spendingBreakdownSchema), total: z.number(), coverage: reportCoverageSchema }).passthrough();
const monthlyReportSchema = z.object({
  revision: z.number().int(),
  period: z.object({ id: z.number().int(), name: z.string(), startDate: z.number(), endDate: z.number() }).passthrough(),
  incomeStatement: incomeStatementSchema,
  balanceSheet: balanceSheetSchema,
  incomeBySource: z.array(z.object({ name: z.string(), amount: z.number() }).passthrough()),
  expensesByCategory: z.array(z.object({ name: z.string(), amount: z.number() }).passthrough()),
  budgetComparison: z.array(z.object({ category: z.string(), budget: z.number(), actual: z.number(), variance: z.number() }).passthrough()),
  transactions: z.array(z.object({ id: z.number().int(), date: z.number(), description: z.string(), category: z.string(), amountCents: z.number(), type: z.enum(["income", "expense", "transfer"]) }).passthrough()),
  coverage: reportCoverageSchema,
  provenance: z.object({ source: z.string(), asOfMs: z.number(), includesDrafts: z.boolean() }).passthrough(),
}).passthrough();
const trendRowSchema = z.object({ periodId: z.number().int(), periodName: z.string(), startDate: z.number(), endDate: z.number(), revenue: z.number(), expenses: z.number(), netIncome: z.number(), coverage: reportCoverageSchema.optional() }).passthrough();
const reportTypeParamsSchema = z.object({ reportType: z.enum(["income-statement", "balance-sheet", "cash-flow"]) });
const trendQuerySchema = z.object({ periodCount: z.coerce.number().int().min(1).max(24).optional() });
const reportExportQuerySchema = periodQuerySchema.extend({ asOfDate: z.coerce.number().int().nonnegative().optional() });

const DAY_MS = 86_400_000;
function inclusiveEnd(timestamp: number): number {
  return timestamp % DAY_MS === 0 ? timestamp + DAY_MS - 1 : timestamp;
}

function reportError(fastify: FastifyInstance, reply: any, err: unknown, fallback: string) {
  if (err instanceof z.ZodError) {
    return reply.code(400).send({ error: "Invalid report parameters", issues: err.issues });
  }
  fastify.log.error(err);
  return reply.code(500).send({ error: fallback });
}

export default async function (fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook("onRequest", fastify.authenticate);

  // Income Statement (Profit & Loss)
  fastify.get("/api/reports/income-statement", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute", groupId: "reports" } },
    schema: { operationId: "getIncomeStatement", tags: ["reports"], querystring: periodQuerySchema, response: { 200: incomeStatementSchema, 400: reportErrorSchema, 500: reportErrorSchema } },
  }, async (request, reply) => {
    try {
      const query = periodQuerySchema.parse(request.query);

      const report = await generateIncomeStatement(
        query.periodId,
        query.startDate,
        query.endDate
      );

      return report;
    } catch (err) {
      return reportError(fastify, reply, err, "Failed to generate income statement");
    }
  });

  // Balance Sheet
  fastify.get("/api/reports/balance-sheet", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute", groupId: "reports" } },
    schema: { operationId: "getBalanceSheet", tags: ["reports"], querystring: asOfQuerySchema, response: { 200: balanceSheetSchema, 400: reportErrorSchema, 500: reportErrorSchema } },
  }, async (request, reply) => {
    try {
      const { asOfDate } = asOfQuerySchema.parse(request.query);

      const report = await generateBalanceSheet(asOfDate);
      return report;
    } catch (err) {
      return reportError(fastify, reply, err, "Failed to generate balance sheet");
    }
  });

  // Cash Flow Statement
  fastify.get("/api/reports/cash-flow", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute", groupId: "reports" } },
    schema: { operationId: "getCashFlowStatement", tags: ["reports"], querystring: periodQuerySchema, response: { 200: cashFlowSchema, 400: reportErrorSchema, 500: reportErrorSchema } },
  }, async (request, reply) => {
    try {
      const query = periodQuerySchema.parse(request.query);

      const report = await generateCashFlowStatement(
        query.periodId,
        query.startDate,
        query.endDate
      );

      return report;
    } catch (err) {
      return reportError(fastify, reply, err, "Failed to generate cash flow statement");
    }
  });

  // Spending Breakdown
  fastify.get("/api/reports/spending", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute", groupId: "reports" } },
    schema: { operationId: "getSpendingReport", tags: ["reports"], querystring: periodQuerySchema, response: { 200: spendingReportSchema, 400: reportErrorSchema, 500: reportErrorSchema } },
  }, async (request, reply) => {
    try {
      const query = periodQuerySchema.parse(request.query);

      const breakdown = await generateSpendingBreakdown(
        query.periodId,
        query.startDate,
        query.endDate
      );
      let coverageStart = query.startDate ?? 0;
      let coverageEnd = query.endDate ?? Date.now();
      if (query.periodId != null) {
        const [period] = await db.select({ startDate: salaryPeriods.startDate, endDate: salaryPeriods.endDate })
          .from(salaryPeriods).where(eq(salaryPeriods.id, query.periodId)).limit(1);
        if (period) {
          coverageStart = period.startDate;
          coverageEnd = inclusiveEnd(period.endDate);
        }
      }
      const coverage = await getPeriodCoverage(coverageStart, coverageEnd);
      return { breakdown, total: breakdown.reduce((sum, b) => sum + b.amount, 0), coverage };
    } catch (err) {
      return reportError(fastify, reply, err, "Failed to generate spending breakdown");
    }
  });

  /**
   * One canonical, period-scoped payload for the monthly PDF. The browser must
   * not reconstruct income/expense from txType or from a capped transaction
   * list, and the balance sheet must use the selected period's as-of date.
   */
  fastify.get("/api/reports/monthly", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute", groupId: "reports" } },
    schema: { operationId: "getMonthlyReport", tags: ["reports"], querystring: z.object({ periodId: z.coerce.number().int().positive() }), response: { 200: monthlyReportSchema, 400: reportErrorSchema, 404: reportErrorSchema, 500: reportErrorSchema } },
  }, async (request, reply) => {
    try {
      const { periodId } = z.object({ periodId: z.coerce.number().int().positive() }).parse(request.query);
      const [period] = await db.select({ id: salaryPeriods.id, name: salaryPeriods.name, startDate: salaryPeriods.startDate, endDate: salaryPeriods.endDate })
        .from(salaryPeriods).where(eq(salaryPeriods.id, periodId)).limit(1);
      if (!period) return reply.code(404).send({ error: "Period not found" });
      const [facts, incomeStatement, balanceSheet, budgets, revision, coverage] = await Promise.all([
        getFinancialFacts({ startMs: period.startDate, endMs: inclusiveEnd(period.endDate), asOfMs: inclusiveEnd(period.endDate), periodId }),
        generateIncomeStatement(periodId),
        generateBalanceSheet(inclusiveEnd(period.endDate)),
        getBudgetFacts(periodId),
        getFinancialRevision(),
        getPeriodCoverage(period.startDate, inclusiveEnd(period.endDate)),
      ]);
      const transactionRows = facts.rows
        .map((row) => {
          const signed = row.incomeCents - row.expenseCents;
          return {
            id: row.id,
            date: row.date,
            description: row.description,
            category: row.category ?? "Uncategorized",
            amountCents: Math.abs(signed),
            type: signed > 0 ? "income" : signed < 0 ? "expense" : "transfer",
          };
        })
        .filter((row) => row.amountCents > 0);
      return {
        revision,
        period,
        incomeStatement,
        balanceSheet,
        incomeBySource: incomeStatement.revenue.filter((row) => row.amount !== 0).map((row) => ({ name: row.name, amount: row.amount })),
        expensesByCategory: facts.byCategory.filter((row) => row.spentCents !== 0).map((row) => ({ name: row.category, amount: row.spentCents })),
        budgetComparison: budgets.map((row) => ({
          category: row.category,
          budget: row.plannedCents,
          actual: row.spentCents,
          variance: row.plannedCents - row.spentCents,
        })),
        transactions: transactionRows,
        coverage,
        provenance: { source: "canonical-financial-facts", asOfMs: inclusiveEnd(period.endDate), includesDrafts: false },
      };
    } catch (err) {
      return reportError(fastify, reply, err, "Failed to generate monthly report");
    }
  });

  // Export reports to CSV
  fastify.get("/api/reports/export/:reportType", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute", groupId: "reports" } },
    schema: { operationId: "exportReport", tags: ["reports"], params: reportTypeParamsSchema, querystring: reportExportQuerySchema, response: { 200: z.string(), 400: reportErrorSchema, 500: reportErrorSchema } },
  }, async (request, reply) => {
    try {
      const { reportType } = z.object({ reportType: z.string() }).parse(request.params);
      const query = periodQuerySchema.parse(request.query);

      let report;

      switch (reportType) {
        case "income-statement":
          report = await generateIncomeStatement(
            query.periodId,
            query.startDate,
            query.endDate
          );
          break;
        case "balance-sheet": {
          const { asOfDate } = asOfQuerySchema.parse(request.query);
          let resolvedAsOfDate = asOfDate;
          if (resolvedAsOfDate === undefined && query.periodId !== undefined) {
            const [period] = await db
              .select({ endDate: salaryPeriods.endDate })
              .from(salaryPeriods)
              .where(eq(salaryPeriods.id, query.periodId))
              .limit(1);
            if (!period) throw new Error(`Period not found: ${query.periodId}`);
            resolvedAsOfDate = period.endDate;
          }
          report = await generateBalanceSheet(resolvedAsOfDate);
          break;
        }
        case "cash-flow":
          report = await generateCashFlowStatement(
            query.periodId,
            query.startDate,
            query.endDate
          );
          break;
        default:
          return reply.code(400).send({ error: "Unknown report type" });
      }

      const csv = exportReportToCSV(report);

      reply.header("Content-Type", "text/csv; charset=utf-8");
      reply.header("Content-Disposition", `attachment; filename="${reportType}-${Date.now()}.csv"`);
      return csv;
    } catch (err) {
      return reportError(fastify, reply, err, "Failed to export report");
    }
  });

  // Trend analysis (income/expenses over multiple periods)
  fastify.get("/api/reports/trends", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute", groupId: "reports" } },
    schema: { operationId: "getReportTrends", tags: ["reports"], querystring: trendQuerySchema, response: { 200: z.array(trendRowSchema), 400: reportErrorSchema, 500: reportErrorSchema } },
  }, async (request, reply) => {
    try {
      const { periodCount = 6 } = z.object({
        periodCount: z.coerce.number().int().min(1).max(24).optional(),
      }).parse(request.query);

      // Get recent periods
      const periods = await db
        .select({
          id: salaryPeriods.id,
          name: salaryPeriods.name,
          startDate: salaryPeriods.startDate,
          endDate: salaryPeriods.endDate,
        })
        .from(salaryPeriods)
        .orderBy(desc(salaryPeriods.startDate))
        .limit(periodCount);

      // Generate income statement for each period
      const trends = await Promise.all(
        periods.map(async (period) => {
          const stmt = await generateIncomeStatement(period.id);
          return {
            periodId: period.id,
            periodName: period.name,
            startDate: period.startDate,
            endDate: period.endDate,
            revenue: stmt.totalRevenue,
            expenses: stmt.totalExpenses,
            netIncome: stmt.netIncome,
            coverage: stmt.coverage,
          };
        })
      );

      return trends.reverse(); // Oldest first
    } catch (err) {
      return reportError(fastify, reply, err, "Failed to generate trends");
    }
  });
}
