import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { getTableConfig, SQLiteTable, SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { is, SQL } from "drizzle-orm";
import { readFileSync } from "fs";
import path from "path";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import * as schema from "../db/schema";

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db/client", () => ({ db: new Proxy({}, {
  get(_target, key) { const value = state.db[key]; return typeof value === "function" ? value.bind(state.db) : value; },
}) }));
vi.mock("../cache/redis", () => ({ cacheSet: vi.fn().mockResolvedValue(true), cacheGet: vi.fn().mockResolvedValue(null) }));

import { localDate } from "../lib/calendar";
import { calculateBurnRate, calculateRunway, getSpendingTrend, MIN_BURN_RATE_MONTHS } from "./analytics";
import { precomputeBurnRate, precomputePeriodSummary, precomputeRunway } from "../cache/precompute";
import { getBudgetFacts, getFinancialFacts } from "./financial-facts";
import { budgetRiskStatus, getBudgetOutlook } from "./budget-outlook";
import { generateCashFlowStatement, generateIncomeStatement } from "./reports";
import { summarizeRecap } from "./recap";
import reportsRoute from "../routes/reports";

const HOUR = 3_600_000;
/** Local (WIB) wall-clock instant. */
const wib = (month: number, day: number, hour = 12, minute = 0) => localDate(2026, month, day) + hour * HOUR + minute * 60_000;

describe("reporting consistency", () => {
  let sqlite: InstanceType<typeof Database>;
  let nextTxId = 1;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    state.db = drizzle(sqlite);
    const dialect = new SQLiteSyncDialect();
    for (const table of Object.values(schema)) {
      if (!is(table, SQLiteTable)) continue;
      const config = getTableConfig(table);
      if (config.name === "transaction_reallocation") continue;
      const columns = config.columns.map((column) => {
        let definition = `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}${column.notNull ? " NOT NULL" : ""}`;
        if (column.default !== undefined) {
          const value = column.default;
          const literal = is(value, SQL) ? dialect.sqlToQuery(value).sql : typeof value === "string" ? "'" + value.replace(/'/g, "''") + "'" : typeof value === "boolean" ? String(Number(value)) : String(value);
          definition += ` DEFAULT ${literal}`;
        }
        return definition;
      });
      sqlite.exec(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);
    }
    sqlite.exec(readFileSync(path.resolve(__dirname, "../../drizzle/0043_transaction_reallocation.sql"), "utf8").replace(/--> statement-breakpoint/g, ""));
    sqlite.exec(`
      INSERT INTO account (id, name, type, liquidity_class) VALUES
        (1, 'Bank', 'asset', 'cash_equivalent'), (2, 'Food', 'expense', 'non_cash'),
        (3, 'Salary', 'revenue', 'non_cash'), (4, 'Other income', 'revenue', 'non_cash');
      INSERT INTO category (id, name) VALUES (1, 'Food'), (2, 'Fun');
    `);
    nextTxId = 1;
    vi.restoreAllMocks();
  });
  afterEach(() => { sqlite.close(); state.db = null; vi.restoreAllMocks(); });

  /** Periods are stored the way the app stores them now: local midnights of the first and last day. */
  function period(id: number, name: string, startMs: number, lastDayMs: number, coverageStatus = "complete") {
    sqlite.prepare("INSERT INTO salary_period (id, name, start_date, end_date, status, coverage_status) VALUES (?, ?, ?, ?, 'open', ?)")
      .run(id, name, startMs, lastDayMs, coverageStatus);
  }

  function tx(input: { date: number; kind: "expense" | "refund" | "income"; amount: number; periodId?: number | null; status?: string; txType?: string; categoryId?: number | null; revenueAccount?: number }): number {
    const id = nextTxId++;
    const txType = input.txType ?? (input.kind === "income" ? "simple_income" : input.kind === "refund" ? "manual" : "simple_expense");
    sqlite.prepare('INSERT INTO "transaction" (id, date, description, tx_type, status, category_id, period_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.date, `${input.kind} ${id}`, txType, input.status ?? "posted", input.kind === "income" ? null : (input.categoryId === undefined ? 1 : input.categoryId), input.periodId ?? null);
    const line = sqlite.prepare("INSERT INTO transaction_line (transaction_id, account_id, debit, credit, cash_flow_class) VALUES (?, ?, ?, ?, ?)");
    const cashIn = input.kind !== "expense";
    line.run(id, 1, cashIn ? input.amount : 0, cashIn ? 0 : input.amount, "operating");
    const other = input.kind === "income" ? (input.revenueAccount ?? 3) : 2;
    line.run(id, other, input.kind === "expense" ? input.amount : 0, cashIn ? input.amount : 0, null);
    return id;
  }

  /** A reversal journal with the opposite lines of `originalId`, and the original marked reversed. */
  function reverse(originalId: number, date: number, periodId: number | null) {
    const id = nextTxId++;
    sqlite.prepare('INSERT INTO "transaction" (id, date, description, tx_type, status, period_id, reversal_of_tx_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, date, "Reversal", "reversal", "posted", periodId, originalId);
    sqlite.prepare("INSERT INTO transaction_line (transaction_id, account_id, debit, credit, cash_flow_class) SELECT ?, account_id, credit, debit, cash_flow_class FROM transaction_line WHERE transaction_id = ?")
      .run(id, originalId);
    sqlite.prepare("UPDATE \"transaction\" SET status = 'reversed' WHERE id = ?").run(originalId);
    return id;
  }

  function reallocate(outgoingId: number, incomingId: number, amount: number) {
    sqlite.prepare("INSERT INTO transaction_reallocation (outgoing_transaction_id, incoming_transaction_id, amount, reason) VALUES (?, ?, ?, ?)")
      .run(outgoingId, incomingId, amount, "Reimbursed");
  }

  describe("spending trend", () => {
    it("buckets by local calendar day, not UTC day", async () => {
      vi.spyOn(Date, "now").mockReturnValue(wib(9, 26, 12));
      period(1, "September", localDate(2026, 9, 1), localDate(2026, 9, 30));
      // 03:00 WIB on 21 September is still 20 September in UTC.
      tx({ date: wib(9, 21, 3), kind: "expense", amount: 40_000, periodId: 1 });
      const trend = await getSpendingTrend(30);
      expect(trend.series.find((point) => point.label === "Sep 21")?.spent).toBe(40_000);
      expect(trend.series.find((point) => point.label === "Sep 20")?.spent).toBe(0);
      const sep21 = trend.series.find((point) => point.label === "Sep 21")!;
      expect(sep21.startMs).toBe(localDate(2026, 9, 21));
      expect(sep21.endMs).toBe(localDate(2026, 9, 22) - 1);
    });

    it("includes the last day of a selected period through local midnight", async () => {
      vi.spyOn(Date, "now").mockReturnValue(wib(10, 5));
      period(1, "September", localDate(2026, 9, 1), localDate(2026, 9, 30));
      tx({ date: wib(9, 30, 22), kind: "expense", amount: 25_000, periodId: 1 });
      const trend = await getSpendingTrend(30, 1);
      expect(trend.bucketCount).toBe(30);
      expect(trend.series[trend.series.length - 1]?.spent).toBe(25_000);
      expect(trend.totalSpent).toBe(25_000);
    });

    it("nets refunds against spending like financial facts, without negative days", async () => {
      vi.spyOn(Date, "now").mockReturnValue(wib(9, 26));
      period(1, "September", localDate(2026, 9, 1), localDate(2026, 9, 30));
      tx({ date: wib(9, 10), kind: "expense", amount: 100_000, periodId: 1 });
      tx({ date: wib(9, 12), kind: "refund", amount: 30_000, periodId: 1 });
      const trend = await getSpendingTrend(30, 1);
      const facts = await getFinancialFacts({ startMs: trend.startMs, endMs: trend.endMs, periodId: 1 });
      expect(trend.totalSpent).toBe(70_000);
      expect(trend.totalSpent).toBe(facts.totalSpentCents);
      expect(trend.series.find((point) => point.label === "Sep 10")?.spent).toBe(100_000);
      expect(trend.series.find((point) => point.label === "Sep 12")?.spent).toBe(0);
      expect(trend.series.every((point) => point.spent >= 0)).toBe(true);
    });

    it("excludes reversed originals and their reversal journals", async () => {
      vi.spyOn(Date, "now").mockReturnValue(wib(9, 26));
      period(1, "September", localDate(2026, 9, 1), localDate(2026, 9, 30));
      const original = tx({ date: wib(9, 5), kind: "expense", amount: 500_000, periodId: 1 });
      reverse(original, wib(9, 8), 1);
      expect((await getSpendingTrend(30, 1)).totalSpent).toBe(0);
    });

    it("averages over the same days in the numerator and the denominator", async () => {
      vi.spyOn(Date, "now").mockReturnValue(wib(9, 30, 12));
      // 1–10 Sep has unknown coverage; 11–30 Sep is complete (20 days).
      period(1, "Early September", localDate(2026, 9, 1), localDate(2026, 9, 10), "unknown");
      period(2, "Late September", localDate(2026, 9, 11), localDate(2026, 9, 30), "complete");
      tx({ date: wib(9, 5), kind: "expense", amount: 3_000_000, periodId: 1 });
      tx({ date: wib(9, 20), kind: "expense", amount: 200_000, periodId: 2 });
      const trend = await getSpendingTrend(30);
      expect(trend.totalSpent).toBe(3_200_000);
      // Only the 20 complete days count, and only their spending.
      expect(trend.averageDailySpend).toBe(10_000);
    });

    it("uses every non-skipped day when no day has known coverage", async () => {
      vi.spyOn(Date, "now").mockReturnValue(wib(9, 30, 12));
      period(1, "September", localDate(2026, 9, 1), localDate(2026, 9, 30), "unknown");
      tx({ date: wib(9, 20), kind: "expense", amount: 300_000, periodId: 1 });
      const trend = await getSpendingTrend(30);
      expect(trend.averageDailySpend).toBe(10_000);
    });
  });

  describe("period summaries", () => {
    it("exclude a September expense reversed in October from both periods, matching facts", async () => {
      vi.spyOn(Date, "now").mockReturnValue(wib(10, 20));
      period(1, "September", localDate(2026, 9, 1), localDate(2026, 9, 30));
      period(2, "October", localDate(2026, 10, 1), localDate(2026, 10, 31));
      const original = tx({ date: wib(9, 15), kind: "expense", amount: 500_000, periodId: 1 });
      reverse(original, wib(10, 3), 2);
      tx({ date: wib(10, 4), kind: "expense", amount: 20_000, periodId: 2 });
      expect(await precomputePeriodSummary(1)).toMatchObject({ expenses: 0, income: 0 });
      expect(await precomputePeriodSummary(2)).toMatchObject({ expenses: 20_000 });
    });

    it("count activity on the last day of the period", async () => {
      vi.spyOn(Date, "now").mockReturnValue(wib(10, 20));
      period(1, "September", localDate(2026, 9, 1), localDate(2026, 9, 30));
      tx({ date: wib(9, 30, 23, 30), kind: "income", amount: 9_000_000, periodId: 1 });
      expect(await precomputePeriodSummary(1)).toMatchObject({ income: 9_000_000 });
    });
  });

  describe("burn rate and runway", () => {
    it("divides by the tracked history inside the window, never less than the minimum", async () => {
      vi.spyOn(Date, "now").mockReturnValue(wib(9, 30, 12));
      tx({ date: wib(9, 20), kind: "expense", amount: 300_000 });
      const burn = await calculateBurnRate(3);
      expect(MIN_BURN_RATE_MONTHS).toBe(1);
      expect(burn.divisorMonths).toBe(1);
      expect(burn.grossBurnRate).toBe(300_000);
      expect(burn.period).toContain("tracked history");
    });

    it("uses fractional months of history once it exceeds the minimum", async () => {
      const now = wib(9, 30, 12);
      vi.spyOn(Date, "now").mockReturnValue(now);
      tx({ date: localDate(2026, 8, 16), kind: "income", amount: 1_000_000 });
      tx({ date: wib(9, 20), kind: "expense", amount: 450_000 });
      const burn = await calculateBurnRate(3);
      const months = (now - localDate(2026, 8, 16) + 1) / (30 * 86_400_000);
      expect(burn.grossBurnRate).toBe(Math.round(450_000 / months));
    });

    it("divides by the whole window when history covers it", async () => {
      vi.spyOn(Date, "now").mockReturnValue(wib(9, 30, 12));
      tx({ date: localDate(2026, 1, 5), kind: "income", amount: 1_000_000 });
      tx({ date: wib(9, 20), kind: "expense", amount: 900_000 });
      const burn = await calculateBurnRate(3);
      expect(burn.divisorMonths).toBe(3);
      expect(burn.grossBurnRate).toBe(300_000);
      expect(burn.period).toBe("Last 90 days");
    });

    it("excludes reversed originals, reversal journals and skipped periods", async () => {
      vi.spyOn(Date, "now").mockReturnValue(wib(9, 30, 12));
      tx({ date: localDate(2026, 1, 5), kind: "income", amount: 1_000_000 });
      period(1, "Skipped August", localDate(2026, 8, 1), localDate(2026, 8, 30), "skipped");
      tx({ date: wib(8, 10), kind: "expense", amount: 5_000_000 });
      const original = tx({ date: wib(9, 5), kind: "expense", amount: 800_000 });
      reverse(original, wib(9, 6), null);
      tx({ date: wib(9, 20), kind: "expense", amount: 600_000 });
      const burn = await calculateBurnRate(3);
      // 90-day window minus the 30 skipped days leaves two tracked months.
      expect(burn.divisorMonths).toBeCloseTo(2, 2);
      expect(burn.grossBurnRate).toBe(Math.round(600_000 / ((90 * 86_400_000 + 1 - 30 * 86_400_000) / (30 * 86_400_000))));
    });

    it("gives the dashboard cache and the agent the same burn rate and runway", async () => {
      vi.spyOn(Date, "now").mockReturnValue(wib(9, 30, 12));
      tx({ date: wib(9, 1), kind: "income", amount: 3_000_000 });
      tx({ date: wib(9, 20), kind: "expense", amount: 450_000 });
      const agent = await calculateBurnRate();
      const dashboard = await precomputeBurnRate();
      expect(dashboard).toMatchObject({ grossBurnRate: agent.grossBurnRate, period: agent.period, divisorMonths: agent.divisorMonths });
      const [agentRunway, dashboardRunway] = await Promise.all([calculateRunway(), precomputeRunway()]);
      expect(dashboardRunway).toMatchObject(agentRunway);
    });
  });

  describe("reports", () => {
    it("monthly report uses the personal basis for income and expenses and includes the last day", async () => {
      vi.spyOn(Date, "now").mockReturnValue(wib(10, 10));
      period(1, "September", localDate(2026, 9, 1), localDate(2026, 9, 30));
      tx({ date: wib(9, 1), kind: "income", amount: 10_000_000, periodId: 1 });
      const dinner = tx({ date: wib(9, 10), kind: "expense", amount: 600_000, periodId: 1 });
      const payback = tx({ date: wib(9, 12), kind: "income", amount: 400_000, periodId: 1, revenueAccount: 4 });
      reallocate(dinner, payback, 400_000);
      // 22:00 WIB on the last day is after UTC midnight-based cut-offs.
      tx({ date: wib(9, 30, 22), kind: "expense", amount: 50_000, periodId: 1, categoryId: 2 });

      const app = Fastify();
      app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
      app.decorate("authenticate", async () => {});
      await app.register(reportsRoute);
      try {
        const response = await app.inject({ url: "/api/reports/monthly?periodId=1" });
        expect(response.statusCode).toBe(200);
        const report = response.json();
        const facts = await getFinancialFacts({ startMs: localDate(2026, 9, 1), endMs: localDate(2026, 10, 1) - 1, periodId: 1 });
        expect(report.reportingBasis).toBe("personal");
        expect(report.incomeStatement.reportingBasis).toBe("personal");
        expect(report.incomeStatement.totalRevenue).toBe(facts.totalIncomeCents);
        expect(report.incomeStatement.totalExpenses).toBe(facts.totalSpentCents);
        expect(report.incomeStatement.totalExpenses).toBe(250_000);
        expect(report.incomeBySource).toEqual([{ name: "Salary", amount: 10_000_000 }]);
        expect(report.expensesByCategory.reduce((sum: number, row: { amount: number }) => sum + row.amount, 0)).toBe(250_000);
        expect(report.expensesByCategory).toContainEqual({ name: "Fun", amount: 50_000 });
      } finally {
        await app.close();
      }
      // The formal statement stays on the ledger basis.
      const ledger = await generateIncomeStatement(1);
      expect(ledger.reportingBasis).toBe("ledger");
      expect(ledger.totalExpenses).toBe(650_000);
      expect(ledger.totalRevenue).toBe(10_400_000);
    });

    it("cash-flow statements reconcile to ledger cash and chain across periods", async () => {
      vi.spyOn(Date, "now").mockReturnValue(wib(11, 10));
      period(1, "August", localDate(2026, 8, 1), localDate(2026, 8, 31));
      period(2, "September", localDate(2026, 9, 1), localDate(2026, 9, 30));
      period(3, "October", localDate(2026, 10, 1), localDate(2026, 10, 31));
      tx({ date: wib(8, 5), kind: "income", amount: 5_000_000, periodId: 1 });
      tx({ date: wib(9, 3), kind: "expense", amount: 200_000, periodId: 2 });
      // Dated in September but assigned elsewhere / unassigned: still moves September cash.
      tx({ date: wib(9, 15), kind: "expense", amount: 300_000, periodId: 3 });
      tx({ date: wib(9, 30, 21), kind: "income", amount: 1_000_000, periodId: null });
      tx({ date: wib(10, 2), kind: "expense", amount: 100_000, periodId: 3 });

      const august = await generateCashFlowStatement(1);
      const september = await generateCashFlowStatement(2);
      const october = await generateCashFlowStatement(3);
      expect(august.endingCash).toBe(5_000_000);
      expect(september.beginningCash).toBe(august.endingCash);
      expect(september.endingCash).toBe(5_000_000 - 200_000 - 300_000 + 1_000_000);
      expect(october.beginningCash).toBe(september.endingCash);
      expect(october.endingCash).toBe(september.endingCash - 100_000);
    });
  });

  describe("budgets", () => {
    it("treats spending exactly on plan, and a zero plan with zero spend, as within budget", () => {
      expect(budgetRiskStatus(0, 0, null, true)).toBe("within_budget");
      expect(budgetRiskStatus(0, 0, 0, false)).toBe("within_budget");
      expect(budgetRiskStatus(100_000, 100_000, 100_000, false)).toBe("within_budget");
      expect(budgetRiskStatus(100_000, 100_000, null, true)).toBe("within_budget");
      expect(budgetRiskStatus(100_001, 100_000, null, false)).toBe("over_budget");
      expect(budgetRiskStatus(1, 0, null, false)).toBe("over_budget");
      expect(budgetRiskStatus(50_000, 100_000, 120_000, false)).toBe("at_risk");
      expect(budgetRiskStatus(50_000, 100_000, null, false)).toBe("unknown");
    });

    it("budget list and outlook report the same actuals for the same period", async () => {
      const now = wib(9, 15);
      vi.spyOn(Date, "now").mockReturnValue(now);
      period(1, "September", localDate(2026, 9, 1), localDate(2026, 9, 30));
      sqlite.exec("INSERT INTO budget_plan (period_id, category_id, planned_amount) VALUES (1, 1, 1000000), (1, 2, 0)");
      tx({ date: wib(9, 10), kind: "expense", amount: 300_000, periodId: 1 });
      // Future-dated within the period: not spent yet on either screen.
      tx({ date: wib(9, 28), kind: "expense", amount: 200_000, periodId: 1 });
      const facts = await getBudgetFacts(1, now);
      const outlook = await getBudgetOutlook(1, now);
      const food = outlook.categories.find((row) => row.categoryId === 1)!;
      expect(facts.find((row) => row.categoryId === 1)?.spentCents).toBe(300_000);
      expect(food.actualAmount).toBe(300_000);
      const fun = outlook.categories.find((row) => row.categoryId === 2)!;
      expect(fun.riskStatus).not.toBe("over_budget");
    });
  });

  describe("recap daily bucketing", () => {
    it("counts spending days and the peak day by local calendar day", () => {
      const row = (id: number, date: number, expenseCents: number) => ({ id, date, description: `Purchase ${id}`, status: "posted", categoryId: 1, category: "Food", txType: "manual", expenseCents, incomeCents: 0 });
      // 06:00 and 23:00 WIB on 21 Sep fall on different UTC days but the same local day.
      const summary = summarizeRecap({ startMs: 0, endMs: 0, asOfMs: 0, walletBalanceCents: 0, byCategory: [], totalIncomeCents: 0, totalSpentCents: 160,
        rows: [row(1, wib(9, 21, 6), 100), row(2, wib(9, 21, 23), 50), row(3, wib(9, 22, 8), 10)] });
      expect(summary.spendingDays).toBe(2);
      expect(summary.highlights.peakSpendingDay).toEqual({ date: localDate(2026, 9, 21), amount: 150, purchaseCount: 2 });
    });
  });
});
