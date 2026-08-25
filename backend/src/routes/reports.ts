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
  fastify.get("/api/reports/income-statement", async (request, reply) => {
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
  fastify.get("/api/reports/balance-sheet", async (request, reply) => {
    try {
      const { asOfDate } = asOfQuerySchema.parse(request.query);

      const report = await generateBalanceSheet(asOfDate);
      return report;
    } catch (err) {
      return reportError(fastify, reply, err, "Failed to generate balance sheet");
    }
  });

  // Cash Flow Statement
  fastify.get("/api/reports/cash-flow", async (request, reply) => {
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
  fastify.get("/api/reports/spending", async (request, reply) => {
    try {
      const query = periodQuerySchema.parse(request.query);

      const breakdown = await generateSpendingBreakdown(
        query.periodId,
        query.startDate,
        query.endDate
      );

      return { breakdown, total: breakdown.reduce((sum, b) => sum + b.amount, 0) };
    } catch (err) {
      return reportError(fastify, reply, err, "Failed to generate spending breakdown");
    }
  });

  // Export reports to CSV
  fastify.get("/api/reports/export/:reportType", async (request, reply) => {
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
  fastify.get("/api/reports/trends", async (request, reply) => {
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
          };
        })
      );

      return trends.reverse(); // Oldest first
    } catch (err) {
      return reportError(fastify, reply, err, "Failed to generate trends");
    }
  });
}
