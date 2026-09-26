import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { getTableConfig, SQLiteTable, SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { is, SQL } from "drizzle-orm";
import { readFileSync } from "fs";
import * as schema from "../db/schema";
import path from "path";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db/client", () => ({ db: new Proxy({}, {
  get(_target, key) { const value = state.db[key]; return typeof value === "function" ? value.bind(state.db) : value; },
}) }));
vi.mock("../cache/invalidation", () => ({ invalidateOnTransactionMutation: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../cache", () => ({ invalidateOnTransactionMutation: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../cache/redis", () => ({ cacheSet: vi.fn().mockResolvedValue(true) }));

import { assertNotReallocated, linkReallocation, loadReallocationCandidates, unlinkReallocation } from "./transaction-reallocations";
import { getBudgetFacts, getFinancialFacts } from "./financial-facts";
import { generateIncomeStatement, generateCashFlowStatement, generateBalanceSheet } from "./reports";
import { computeAccountBalance } from "./ledger";
import { createReimbursementClaim } from "./reimbursements";
import transactionsRoute from "../routes/transactions";
import { invalidateOnTransactionMutation } from "../cache/invalidation";
import { precomputePeriodSummary } from "../cache/precompute";
import { getSpendingTrend, calculateBurnRate } from "./analytics";

const august = Date.UTC(2026, 7, 20), september = Date.UTC(2026, 8, 20);
const range = { startMs: Date.UTC(2026, 7, 1), endMs: Date.UTC(2026, 8, 30) };

describe("transaction reallocations", () => {
  let sqlite: InstanceType<typeof Database>;
  beforeEach(() => {
    sqlite = new Database(":memory:");
    state.db = drizzle(sqlite);
    // Build the current schema; legacy migrations contain unrelated bootstrap repairs.
    const dialect = new SQLiteSyncDialect();
    for (const table of Object.values(schema)) {
      if (!is(table, SQLiteTable)) continue;
      const config = getTableConfig(table);
      if (config.name === 'transaction_reallocation') continue;
      const columns = config.columns.map(column => {
        let definition = `"${column.name}" ${column.getSQLType()}${column.primary ? ' PRIMARY KEY' : ''}${column.notNull ? ' NOT NULL' : ''}`;
        if (column.default !== undefined) {
          const value = column.default;
          const literal = is(value, SQL) ? dialect.sqlToQuery(value).sql : typeof value === 'string' ? "'" + value.replace(/'/g, "''") + "'" : typeof value === 'boolean' ? String(Number(value)) : String(value);
          definition += ` DEFAULT ${literal}`;
        }
        return definition;
      });
      sqlite.exec(`CREATE TABLE "${config.name}" (${columns.join(', ')})`);
    }
    sqlite.exec(readFileSync(path.resolve(__dirname, "../../drizzle/0043_transaction_reallocation.sql"), "utf8").replace(/--> statement-breakpoint/g, ""));
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(`
      INSERT INTO account (id, name, type, liquidity_class) VALUES
        (1, 'Bank', 'asset', 'cash_equivalent'), (2, 'Other bank', 'asset', 'cash_equivalent'),
        (3, 'Donations', 'expense', 'non_cash'), (4, 'Income', 'revenue', 'non_cash');
      INSERT INTO category (id, name) VALUES (1, 'Donations'), (2, 'Other');
      INSERT INTO contact (id, name, kind) VALUES (1, 'Friend', 'person');
    `);
    const period = sqlite.prepare("INSERT INTO salary_period (id, name, start_date, end_date, status) VALUES (?, ?, ?, ?, ?)");
    period.run(1, "August", Date.UTC(2026, 7, 1), Date.UTC(2026, 7, 31), "closed");
    period.run(2, "September", Date.UTC(2026, 8, 1), Date.UTC(2026, 8, 30), "open");
    sqlite.exec("INSERT INTO budget_plan (period_id, category_id, planned_amount) VALUES (1, 1, 1000000), (2, 1, 1000000)");
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 8, 26));
  });
  afterEach(() => { sqlite.close(); state.db = null; vi.restoreAllMocks(); });

  function entry(id: number, kind: "income" | "refund" | "expense", amount: number, date = september, wallet = 1) {
    sqlite.prepare('INSERT INTO "transaction" (id, date, description, tx_type, status, category_id, period_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, date, kind === "income" || kind === "refund" ? "ITBSF returned donation" : "Friend cat sterilisation", kind === "refund" ? "manual" : `simple_${kind}`, "posted", kind === "income" ? null : 1, date === august ? 1 : 2);
    const incoming = kind !== "expense";
    const line = sqlite.prepare("INSERT INTO transaction_line (transaction_id, account_id, debit, credit, cash_flow_class) VALUES (?, ?, ?, ?, ?)");
    line.run(id, wallet, incoming ? amount : 0, incoming ? 0 : amount, "operating");
    line.run(id, kind === "income" ? 4 : 3, kind === "expense" ? amount : 0, incoming ? amount : 0, null);
    if (kind !== "income") sqlite.prepare("INSERT INTO transaction_category_allocation (transaction_id, category_id, amount) VALUES (?, 1, ?)").run(id, kind === "refund" ? -amount : amount);
  }

  async function server() {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
    app.decorate("authenticate", async () => {});
    await app.register(transactionsRoute);
    return app;
  }

  it.each(["income", "refund"] as const)("excludes equal %s and expense amounts while preserving balances and formal reports", async kind => {
    entry(1, kind, 500000); entry(2, "expense", 500000, september, 2);
    const balances = await Promise.all([computeAccountBalance(1), computeAccountBalance(2)]);
    const statement = await generateIncomeStatement(undefined, range.startMs, range.endMs);
    const cashflow = await generateCashFlowStatement(undefined, range.startMs, range.endMs);
    const balanceSheet = await generateBalanceSheet(range.endMs);
    await linkReallocation(1, 2, "Original spending predates tracking");
    const facts = await getFinancialFacts(range);
    expect(facts.totalIncomeCents).toBe(0); expect(facts.totalSpentCents).toBe(0); expect(facts.byCategory).toEqual([]);
    expect(await Promise.all([computeAccountBalance(1), computeAccountBalance(2)])).toEqual(balances);
    const rawFacts = await getFinancialFacts({ ...range, reportingBasis: "ledger" });
    expect(rawFacts.totalIncomeCents).toBe(kind === "income" ? 500000 : 0);
    expect((await generateIncomeStatement(undefined, range.startMs, range.endMs)).totalExpenses).toBe(statement.totalExpenses);
    expect((await generateIncomeStatement(undefined, range.startMs, range.endMs)).totalRevenue).toBe(statement.totalRevenue);
    expect((await generateCashFlowStatement(undefined, range.startMs, range.endMs)).netOperating).toBe(cashflow.netOperating);
    expect((await generateBalanceSheet(range.endMs)).totalAssets).toBe(balanceSheet.totalAssets);
  });

  it("keeps a top-up as spending and applies exclusions independently across closed/open months", async () => {
    entry(1, "refund", 500000, august); entry(2, "expense", 600000);
    await linkReallocation(2, 1, "Original spending predates tracking");
    expect((await getFinancialFacts({ startMs: august, endMs: august, periodId: 1 })).totalSpentCents).toBe(0);
    const current = await getFinancialFacts({ startMs: september, endMs: september, periodId: 2 });
    expect(current.totalSpentCents).toBe(100000);
    expect(current.byCategory[0].spentCents).toBe(100000);
    expect((await getBudgetFacts(1))[0].spentCents).toBe(0);
    expect((await getBudgetFacts(2))[0].spentCents).toBe(100000);
    expect(invalidateOnTransactionMutation).toHaveBeenCalledWith(expect.objectContaining({ affectedPeriodIds: [2, 1], revisionBumped: true }));
  });

  it.each(["income", "refund"] as const)("retains an unmatched incoming %s remainder", async kind => {
    entry(1, kind, 600000); entry(2, "expense", 500000);
    await linkReallocation(1, 2, "Partial redirection");
    const facts = await getFinancialFacts(range);
    expect(facts.totalIncomeCents).toBe(kind === "income" ? 100000 : 0);
    expect(facts.totalSpentCents).toBe(kind === "refund" ? -100000 : 0);
  });

  it("unlinks from either entry, restores reporting, and audits both operations", async () => {
    entry(1, "income", 500000); entry(2, "expense", 600000);
    await linkReallocation(1, 2, "Historical donation");
    expect(() => assertNotReallocated(2)).toThrow("Unlink");
    await unlinkReallocation(2);
    expect(() => assertNotReallocated(2)).not.toThrow();
    const facts = await getFinancialFacts(range);
    expect(facts.totalIncomeCents).toBe(500000); expect(facts.totalSpentCents).toBe(600000);
    expect(sqlite.prepare("SELECT action FROM audit_log WHERE entity_type = 'transaction_reallocation' ORDER BY id").all()).toEqual([{ action: "create" }, { action: "delete" }]);
    expect(sqlite.prepare("SELECT revision FROM financial_state").get()).toEqual({ revision: 2 });
  });

  it("prevents duplicate/overlapping pairings and checks missing or same-direction entries", async () => {
    entry(1, "income", 500000); entry(2, "expense", 500000); entry(3, "expense", 500000);
    await expect(linkReallocation(1, 1, "Same")).rejects.toThrow("different");
    await expect(linkReallocation(2, 3, "Wrong")).rejects.toThrow("incoming");
    await expect(linkReallocation(1, 99, "Missing")).rejects.toThrow("not found");
    const results = await Promise.allSettled([linkReallocation(1, 2, "First"), linkReallocation(1, 3, "Second")]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(sqlite.prepare("SELECT count(*) AS count FROM transaction_reallocation").get()).toEqual({ count: 1 });
    expect(() => sqlite.prepare("INSERT INTO transaction_reallocation (incoming_transaction_id, outgoing_transaction_id, amount, reason) VALUES (3, 1, 1, 'Overlap')").run()).toThrow();
  });

  it.each(["loan_payment", "subscription_renewal", "simple_transfer", "reversal", "paylater_recognition"])("rejects unsupported %s entries", async txType => {
    entry(1, "income", 500000); entry(2, "expense", 500000);
    sqlite.prepare('UPDATE "transaction" SET tx_type = ? WHERE id = 2').run(txType);
    await expect(linkReallocation(1, 2, "Unsupported")).rejects.toThrow("ordinary");
  });

  it("rejects draft, split-category, and reimbursement-owned entries", async () => {
    entry(1, "income", 500000); entry(2, "expense", 500000);
    sqlite.exec('UPDATE "transaction" SET status = \'draft\' WHERE id = 2');
    expect(loadReallocationCandidates([2]).get(2)?.role).toBeNull();
    sqlite.exec('UPDATE "transaction" SET status = \'posted\' WHERE id = 2');
    sqlite.exec("INSERT INTO transaction_category_allocation (transaction_id, category_id, amount) VALUES (2, 2, 1)");
    expect(loadReallocationCandidates([2]).get(2)?.role).toBeNull();
    sqlite.exec("DELETE FROM transaction_category_allocation WHERE category_id = 2");
    await createReimbursementClaim({ contactId: 1, title: "Claim", sources: [{ sourceTransactionId: 2, expenseLineId: 4, categoryId: 1, amount: 1 }] });
    await expect(linkReallocation(1, 2, "Claimed")).rejects.toThrow("ordinary");
  });

  it("prevents attaching a reimbursement after pairing", async () => {
    entry(1, "income", 500000); entry(2, "expense", 500000);
    await linkReallocation(1, 2, "Historical donation");
    await expect(createReimbursementClaim({ contactId: 1, title: "Claim", sources: [{ sourceTransactionId: 2, expenseLineId: 4, categoryId: 1, amount: 1 }] })).rejects.toThrow("Unlink");
  });

  it("uses the adjusted amount in cached dashboard summaries and spending analytics", async () => {
    entry(1, "income", 500000, august); entry(2, "expense", 600000);
    await linkReallocation(1, 2, "Historical donation");
    expect(await precomputePeriodSummary(1)).toMatchObject({ income: 0, expenses: 0 });
    expect(await precomputePeriodSummary(2)).toMatchObject({ income: 0, expenses: 100000 });
    expect((await getSpendingTrend(30, 2)).totalSpent).toBe(100000);
    expect((await calculateBurnRate(3)).grossBurnRate).toBe(Math.round(100000 / 3));
  });

  it("requires authentication and validates the link request", async () => {
    entry(1, "income", 500000); entry(2, "expense", 500000);
    const denied = Fastify();
    denied.setValidatorCompiler(validatorCompiler); denied.setSerializerCompiler(serializerCompiler);
    denied.decorate("authenticate", async (_request: unknown, reply: any) => { reply.code(401).send({ error: "Authentication required" }); });
    await denied.register(transactionsRoute);
    try {
      expect((await denied.inject({ method: "POST", url: "/api/transactions/1/reallocation", payload: { counterpartTransactionId: 2 } })).statusCode).toBe(401);
    } finally { await denied.close(); }
    const app = await server();
    try {
      expect((await app.inject({ method: "POST", url: "/api/transactions/1/reallocation", payload: { counterpartTransactionId: 2, reason: " " } })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url: "/api/transactions/1/reallocation", payload: { counterpartTransactionId: 2, reason: "Historical" } })).statusCode).toBe(201);
      const spending = await app.inject({ url: "/api/transactions?periodId=all&kind=expense" });
      expect(spending.json().pagination.total).toBe(0);
      const mutation = await app.inject({ method: "PUT", url: "/api/transactions/2", payload: { categoryId: 2 } });
      expect(mutation.statusCode, mutation.body).toBe(409);
    } finally { await app.close(); }
  });

  it("keeps full entries visible, adjusts filtered summaries/charts, and blocks reversal", async () => {
    entry(1, "income", 500000, august); entry(2, "expense", 600000); entry(3, "expense", 500000);
    const app = await server();
    try {
      const linked = await app.inject({ method: "POST", url: "/api/transactions/1/reallocation", payload: { counterpartTransactionId: 2 } });
      expect(linked.statusCode, linked.body).toBe(201);
      const response = await app.inject({ url: "/api/transactions?periodId=all&accountId=1&limit=1" });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().data).toHaveLength(1);
      expect(response.json().summary.expenseCents).toBe(600000);
      expect(response.json().summary.incomeCents).toBe(0);
      const detail = await app.inject({ url: "/api/transactions/2" });
      expect(detail.json()).toMatchObject({ expenseCents: 600000, personalExpenseCents: 100000, reallocation: { counterpartTransactionId: 1, amount: 500000 } });
      const incomeOnly = await app.inject({ url: "/api/transactions?periodId=all&kind=income" });
      expect(incomeOnly.json().pagination.total).toBe(0);
      const septemberOnly = await app.inject({ url: "/api/transactions?periodId=2&search=Friend" });
      expect(septemberOnly.json().summary.categoryBreakdown[0].amountCents).toBe(600000);
      const reverse = await app.inject({ method: "POST", url: "/api/transactions/2/reverse" });
      expect(reverse.statusCode).toBe(409); expect(reverse.json().error).toContain("Unlink");
      const removed = await app.inject({ method: "DELETE", url: "/api/transactions/2/reallocation" });
      expect(removed.statusCode, removed.body).toBe(204);
    } finally { await app.close(); }
  });
});
