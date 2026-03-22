import type { FastifyInstance } from "fastify";
import { desc } from "drizzle-orm";
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
  periodId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export default async function (fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook("onRequest", fastify.authenticate);

  // Income Statement (Profit & Loss)
  fastify.get("/api/reports/income-statement", async (request, reply) => {
    try {
      const query = periodQuerySchema.parse(request.query);

      const report = await generateIncomeStatement(
        query.periodId ? parseInt(query.periodId) : undefined,
        query.startDate ? parseInt(query.startDate) : undefined,
        query.endDate ? parseInt(query.endDate) : undefined
      );

      return report;
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message });
    }
  });

  // Balance Sheet
  fastify.get("/api/reports/balance-sheet", async (request, reply) => {
    try {
      const { asOfDate } = z.object({ asOfDate: z.string().optional() }).parse(request.query);

      const report = await generateBalanceSheet(asOfDate ? parseInt(asOfDate) : undefined);
      return report;
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message });
    }
  });

  // Cash Flow Statement
  fastify.get("/api/reports/cash-flow", async (request, reply) => {
    try {
      const query = periodQuerySchema.parse(request.query);

      const report = await generateCashFlowStatement(
        query.periodId ? parseInt(query.periodId) : undefined,
        query.startDate ? parseInt(query.startDate) : undefined,
        query.endDate ? parseInt(query.endDate) : undefined
      );

      return report;
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message });
    }
  });

  // Spending Breakdown
  fastify.get("/api/reports/spending", async (request, reply) => {
    try {
      const query = periodQuerySchema.parse(request.query);

      const breakdown = await generateSpendingBreakdown(
        query.periodId ? parseInt(query.periodId) : undefined,
        query.startDate ? parseInt(query.startDate) : undefined,
        query.endDate ? parseInt(query.endDate) : undefined
      );

      return { breakdown, total: breakdown.reduce((sum, b) => sum + b.amount, 0) };
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message });
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
            query.periodId ? parseInt(query.periodId) : undefined,
            query.startDate ? parseInt(query.startDate) : undefined,
            query.endDate ? parseInt(query.endDate) : undefined
          );
          break;
        case "balance-sheet":
          const { asOfDate } = z.object({ asOfDate: z.string().optional() }).parse(request.query);
          report = await generateBalanceSheet(asOfDate ? parseInt(asOfDate) : undefined);
          break;
        case "cash-flow":
          report = await generateCashFlowStatement(
            query.periodId ? parseInt(query.periodId) : undefined,
            query.startDate ? parseInt(query.startDate) : undefined,
            query.endDate ? parseInt(query.endDate) : undefined
          );
          break;
        default:
          return reply.code(400).send({ error: "Unknown report type" });
      }

      const csv = exportReportToCSV(report);

      reply.header("Content-Type", "text/csv");
      reply.header("Content-Disposition", `attachment; filename="${reportType}-${Date.now()}.csv"`);
      return csv;
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message });
    }
  });

  // Trend analysis (income/expenses over multiple periods)
  fastify.get("/api/reports/trends", async (request, reply) => {
    try {
      const { periodCount } = z.object({ periodCount: z.string().optional() }).parse(request.query);
      const count = periodCount ? parseInt(periodCount) : 6;

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
        .limit(count);

      // Generate income statement for each period
      const trends = await Promise.all(
        periods.map(async (period) => {
          try {
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
          } catch {
            return null;
          }
        })
      );

      return trends.filter(Boolean).reverse(); // Oldest first
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message });
    }
  });
}
