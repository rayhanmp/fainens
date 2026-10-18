import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, is, SQL } from "drizzle-orm";
import { getTableConfig, SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import * as schema from "../db/schema";
import { localDate } from "../lib/calendar";

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db/client", () => ({ db: new Proxy({}, {
  get(_target, key) {
    const value = state.db[key];
    return typeof value === "function" ? value.bind(state.db) : value;
  },
}) }));
vi.mock("../cache/invalidation", () => ({
  invalidateOnTransactionMutation: vi.fn(async () => {}),
  invalidateAllAnalytics: vi.fn(async () => {}),
  invalidateAllInsights: vi.fn(async () => {}),
  invalidatePeriodSummary: vi.fn(async () => {}),
}));
vi.mock("../cache", () => ({ invalidateOnTransactionMutation: vi.fn(async () => {}) }));

import {
  calculateInstallmentSchedule,
  getPaylaterObligations,
  recognizePaylaterPurchase,
  reversePaylaterTransaction,
  settlePaylaterPayment,
} from "./paylater";

const BANK = 1;
const PAYLATER = 2;
const OTHER_PAYLATER = 3;
const CATEGORY = 7;

function createTables(sqlite: InstanceType<typeof Database>) {
  const dialect = new SQLiteSyncDialect();
  // Match the current production columns/defaults without touching the user's DB.
  for (const table of [schema.accounts, schema.transactions, schema.transactionLines, schema.transactionTags,
    schema.transactionCategoryAllocations, schema.transactionReallocations, schema.categories, schema.salaryPeriods,
    schema.auditLogs, schema.financialState, schema.paylaterInstallments, schema.paylaterSettlementAllocations]) {
    const config = getTableConfig(table);
    const columns = config.columns.map((column) => {
      let defaultSql = "";
      if (column.default !== undefined) {
        const value = column.default;
        const literal = is(value, SQL) ? dialect.sqlToQuery(value).sql
          : typeof value === "string" ? `'${value.replace(/'/g, "''")}'`
          : typeof value === "boolean" ? String(Number(value)) : String(value);
        defaultSql = ` DEFAULT ${literal}`;
      }
      return `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}${column.notNull ? " NOT NULL" : ""}${column.isUnique ? " UNIQUE" : ""}${defaultSql}`;
    });
    sqlite.exec(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);
  }
}

/** Natural balance of an account: credit - debit for liabilities, debit - credit otherwise. */
function balance(accountId: number): number {
  const lines = state.db.select().from(schema.transactionLines).where(eq(schema.transactionLines.accountId, accountId)).all();
  const debitMinusCredit = lines.reduce((sum: number, line: any) => sum + line.debit - line.credit, 0);
  const account = state.db.select().from(schema.accounts).where(eq(schema.accounts.id, accountId)).all()[0];
  return account.type === "liability" ? 0 - debitMinusCredit || 0 : debitMinusCredit;
}

function expenseBalance(): number {
  const account = state.db.select().from(schema.accounts).where(eq(schema.accounts.systemKey, "auto-expense")).all()[0];
  return account ? balance(account.id) : 0;
}

const firstDueDate = localDate(2026, 11, 5);

function recognize(overrides: Partial<Parameters<typeof recognizePaylaterPurchase>[0]> = {}) {
  return recognizePaylaterPurchase({
    date: localDate(2026, 10, 1),
    description: "Phone",
    principalAmount: 300_000,
    paylaterLiabilityAccountId: PAYLATER,
    installmentMonths: 3,
    firstDueDate,
    ...overrides,
  });
}

function pay(recognitionTxId: number, paymentAmount: number, liabilityAccountId = PAYLATER) {
  return settlePaylaterPayment({
    date: localDate(2026, 10, 10),
    description: "PayLater payment",
    paymentAmount,
    paylaterLiabilityAccountId: liabilityAccountId,
    bankAccountId: BANK,
    originalTxId: recognitionTxId,
  });
}

async function obligation(recognitionTxId: number) {
  const payload = await getPaylaterObligations();
  const found = payload.obligations.find((item) => item.recognitionTxId === recognitionTxId);
  if (!found) throw new Error(`Obligation ${recognitionTxId} not listed`);
  return { payload, obligation: found };
}

/** An obligation as the old code recognised it: principal only, financing left in the schedule. */
function insertLegacyRecognition(params: { principal: number; interestRatePercent: number; adminFeeCents: number }) {
  const expense = state.db.insert(schema.accounts).values({ name: "Expense (Auto)", type: "expense", isActive: true, systemKey: "auto-expense" })
    .returning().all()[0];
  const [tx] = state.db.insert(schema.transactions).values({
    date: new Date(localDate(2026, 9, 1)), description: "Legacy laptop", txType: "paylater_recognition", status: "posted",
    categoryId: CATEGORY, installmentMonths: 3, interestRatePercent: params.interestRatePercent, adminFeeCents: params.adminFeeCents, totalInstallments: 3,
  }).returning().all();
  state.db.insert(schema.transactionLines).values([
    { transactionId: tx.id, accountId: expense.id, debit: params.principal, credit: 0 },
    { transactionId: tx.id, accountId: PAYLATER, debit: 0, credit: params.principal },
  ]).run();
  const schedule = calculateInstallmentSchedule({
    principalCents: params.principal, months: 3, annualInterestRatePercent: params.interestRatePercent,
    adminFeeCents: params.adminFeeCents, firstDueDateMs: firstDueDate,
  });
  state.db.insert(schema.paylaterInstallments).values(schedule.map((item) => ({
    recognitionTxId: tx.id, installmentNumber: item.installmentNumber, totalInstallments: 3, dueDate: new Date(item.dueDate),
    principalCents: item.principalCents, interestCents: item.interestCents, feeCents: item.feeCents, totalCents: item.totalCents,
  }))).run();
  return { recognitionTxId: tx.id as number, schedule };
}

describe("PayLater ledger", () => {
  let sqlite: InstanceType<typeof Database>;
  beforeEach(() => {
    sqlite = new Database(":memory:");
    createTables(sqlite);
    state.db = drizzle(sqlite);
    state.db.insert(schema.accounts).values([
      { id: BANK, name: "BNI", type: "asset", liquidityClass: "cash_equivalent", isActive: true },
      { id: PAYLATER, name: "SPayLater", type: "liability", isActive: true },
      { id: OTHER_PAYLATER, name: "Kredivo", type: "liability", isActive: true },
    ]).run();
    state.db.insert(schema.categories).values({ id: CATEGORY, name: "Electronics" }).run();
  });
  afterEach(() => {
    vi.useRealTimers();
    sqlite.close();
    state.db = null;
  });

  describe("over-payment guard", () => {
    it("refuses a payment once the obligation's liability is cleared", async () => {
      const { transactionId } = await recognize();
      await pay(transactionId, 300_000);
      expect(balance(PAYLATER)).toBe(0);
      await expect(pay(transactionId, 1)).rejects.toThrow("Payment exceeds outstanding paylater liability (0)");
      expect(balance(PAYLATER)).toBe(0);
    });

    it("refuses one of two concurrent full payments", async () => {
      const { transactionId } = await recognize();
      const results = await Promise.allSettled([pay(transactionId, 300_000), pay(transactionId, 300_000)]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(balance(PAYLATER)).toBe(0);
      expect(balance(BANK)).toBe(-300_000);
    });

    it("does not let one obligation spend another obligation's balance on the same account", async () => {
      const first = await recognize({ principalAmount: 100_000, installmentMonths: 1 });
      await recognize({ principalAmount: 500_000, installmentMonths: 1 });
      await expect(pay(first.transactionId, 100_001)).rejects.toThrow("(100000)");
      await pay(first.transactionId, 100_000);
      await expect(pay(first.transactionId, 100_000)).rejects.toThrow("(0)");
    });

    it("counts a reversed payment as unpaid again", async () => {
      const { transactionId } = await recognize({ installmentMonths: 1 });
      const payment = await pay(transactionId, 300_000);
      await reversePaylaterTransaction({ transactionId: payment.transactionId, reason: "Wrong wallet" });
      await pay(transactionId, 300_000);
      expect(balance(PAYLATER)).toBe(0);
    });
  });

  describe("financing cost", () => {
    const plan = { interestRatePercent: 12, adminFeeCents: 5_000 };

    it("posts interest and admin fee at recognition so the full schedule clears the liability", async () => {
      const { transactionId, installments } = await recognize(plan);
      // 300,000 x 1% x 3 months of interest plus the admin fee.
      expect(balance(PAYLATER)).toBe(314_000);
      expect(expenseBalance()).toBe(314_000);
      for (const installment of installments) {
        await pay(transactionId, installment.totalCents);
        expect(balance(PAYLATER)).toBeGreaterThanOrEqual(0);
      }
      expect(balance(PAYLATER)).toBe(0);
      expect(expenseBalance()).toBe(314_000);
      expect(balance(BANK)).toBe(-314_000);
      const { obligation: row } = await obligation(transactionId);
      expect(row).toMatchObject({ principalCents: 300_000, interestPostedCents: 14_000, paymentsPostedCents: 314_000, outstandingCents: 0, status: "paid" });
      await expect(pay(transactionId, 1)).rejects.toThrow("(0)");
    });

    it("reverses the financing cost with the recognition", async () => {
      const { transactionId } = await recognize({ ...plan, categoryId: CATEGORY });
      await reversePaylaterTransaction({ transactionId, reason: "Cancelled order" });
      expect(balance(PAYLATER)).toBe(0);
      expect(expenseBalance()).toBe(0);
      const allocations = state.db.select().from(schema.transactionCategoryAllocations).all();
      expect(allocations.reduce((sum: number, row: any) => sum + row.amount, 0)).toBe(0);
    });

    it("expenses an older obligation's unrecognised financing as installments are paid", async () => {
      const { recognitionTxId, schedule } = insertLegacyRecognition({ principal: 300_000, ...plan });
      expect((await obligation(recognitionTxId)).obligation.outstandingCents).toBe(314_000);
      let expensed = 0;
      for (const installment of schedule) {
        const { transactionId } = await pay(recognitionTxId, installment.totalCents);
        const lines = state.db.select().from(schema.transactionLines).where(eq(schema.transactionLines.transactionId, transactionId)).all();
        const financing = lines.filter((line: any) => line.accountId !== BANK && line.accountId !== PAYLATER)
          .reduce((sum: number, line: any) => sum + line.debit, 0);
        expect(financing).toBe(installment.interestCents + installment.feeCents);
        expensed += financing;
        expect(balance(PAYLATER)).toBeGreaterThanOrEqual(0);
      }
      expect(expensed).toBe(14_000);
      expect(balance(PAYLATER)).toBe(0);
      expect(expenseBalance()).toBe(314_000);
      expect((await obligation(recognitionTxId)).obligation).toMatchObject({ outstandingCents: 0, status: "paid" });
      // The financing expense keeps the purchase's category.
      const categorised = state.db.select().from(schema.transactionCategoryAllocations).all();
      expect(categorised.reduce((sum: number, row: any) => sum + row.amount, 0)).toBe(14_000);
      await expect(pay(recognitionTxId, 1)).rejects.toThrow("(0)");
    });

    it("never drives an older obligation negative, even when a payment covers only part of an installment", async () => {
      const { recognitionTxId } = insertLegacyRecognition({ principal: 300_000, ...plan });
      for (const amount of [3_000, 150_000, 1, 100_000]) {
        await pay(recognitionTxId, amount);
        expect(balance(PAYLATER)).toBeGreaterThanOrEqual(0);
      }
      const remaining = (await obligation(recognitionTxId)).obligation.outstandingCents;
      expect(remaining).toBe(314_000 - 253_001);
      await expect(pay(recognitionTxId, remaining + 1)).rejects.toThrow(`(${remaining})`);
      await pay(recognitionTxId, remaining);
      expect(balance(PAYLATER)).toBe(0);
      expect(expenseBalance()).toBe(314_000);
    });

    it("finishes an older obligation that was partly paid before allocation rows existed", async () => {
      const { recognitionTxId, schedule } = insertLegacyRecognition({ principal: 300_000, ...plan });
      const [old] = state.db.insert(schema.transactions).values({
        date: new Date(localDate(2026, 9, 20)), description: "Old payment", txType: "paylater_settlement", status: "posted", linkedTxId: recognitionTxId,
      }).returning().all();
      state.db.insert(schema.transactionLines).values([
        { transactionId: old.id, accountId: PAYLATER, debit: schedule[0].totalCents, credit: 0 },
        { transactionId: old.id, accountId: BANK, debit: 0, credit: schedule[0].totalCents, cashFlowClass: "financing" },
      ]).run();
      const { obligation: row } = await obligation(recognitionTxId);
      expect(row.paymentsPostedCents).toBe(schedule[0].totalCents);
      expect(row.outstandingCents).toBe(314_000 - schedule[0].totalCents);
      expect(row.installments?.map((item) => item.status)).toEqual(["paid", "pending", "pending"]);
      await pay(recognitionTxId, row.outstandingCents);
      expect(balance(PAYLATER)).toBe(0);
      expect(expenseBalance()).toBe(314_000);
    });
  });

  describe("outstanding balance", () => {
    it("counts partial payments exactly once from allocation rows", async () => {
      const { transactionId } = await recognize();
      await pay(transactionId, 50_000);
      let { obligation: row, payload } = await obligation(transactionId);
      expect(row).toMatchObject({ paymentsPostedCents: 50_000, outstandingCents: 250_000 });
      expect(row.installments?.map((item) => item.paidCents)).toEqual([50_000, 0, 0]);

      const second = await pay(transactionId, 80_000);
      ({ obligation: row, payload } = await obligation(transactionId));
      expect(row).toMatchObject({ paymentsPostedCents: 130_000, outstandingCents: 170_000 });
      expect(row.installments?.map((item) => [item.paidCents, item.status])).toEqual([[100_000, "paid"], [30_000, "pending"], [0, "pending"]]);
      expect(payload.totalOutstandingCents).toBe(170_000);
      expect(payload.providerExposure).toEqual([expect.objectContaining({ liabilityAccountId: PAYLATER, totalOutstandingCents: 170_000 })]);
      expect(payload.scheduleItems.map((item) => item.amountCents)).toEqual([70_000, 100_000]);
      expect(balance(PAYLATER)).toBe(170_000);

      await reversePaylaterTransaction({ transactionId: second.transactionId, reason: "Duplicate" });
      ({ obligation: row } = await obligation(transactionId));
      expect(row).toMatchObject({ paymentsPostedCents: 50_000, outstandingCents: 250_000 });
    });

    it("uses the ledger liability for an obligation without a schedule", async () => {
      const [tx] = state.db.insert(schema.transactions).values({
        date: new Date(localDate(2026, 8, 1)), dueDate: new Date(localDate(2026, 12, 1)), description: "Old plan", txType: "paylater_recognition", status: "posted",
      }).returning().all();
      const expense = state.db.insert(schema.accounts).values({ name: "Expense (Auto)", type: "expense", isActive: true, systemKey: "auto-expense" }).returning().all()[0];
      state.db.insert(schema.transactionLines).values([
        { transactionId: tx.id, accountId: expense.id, debit: 200_000, credit: 0 },
        { transactionId: tx.id, accountId: OTHER_PAYLATER, debit: 0, credit: 200_000 },
      ]).run();
      await pay(tx.id, 75_000, OTHER_PAYLATER);
      const { obligation: row, payload } = await obligation(tx.id);
      expect(row).toMatchObject({ principalCents: 200_000, paymentsPostedCents: 75_000, outstandingCents: 125_000 });
      expect(payload.providerExposure).toEqual([expect.objectContaining({ liabilityAccountId: OTHER_PAYLATER, totalOutstandingCents: 125_000 })]);
      await expect(pay(tx.id, 125_001, OTHER_PAYLATER)).rejects.toThrow("(125000)");
    });
  });

  describe("schedule dates", () => {
    it("keeps a month-end anchor instead of drifting after February", () => {
      const schedule = calculateInstallmentSchedule({
        principalCents: 600_000, months: 6, annualInterestRatePercent: 0, adminFeeCents: 0, firstDueDateMs: localDate(2027, 1, 31),
      });
      expect(schedule.map((item) => new Date(item.dueDate).getDate())).toEqual([31, 28, 31, 30, 31, 30]);
    });

    it("treats an installment as overdue only from the WIB day after its due date", async () => {
      const dueDay = localDate(2026, 10, 19);
      const { transactionId } = await recognize({ installmentMonths: 1, firstDueDate: dueDay });
      vi.useFakeTimers({ toFake: ["Date"] });
      // The due day's WIB midnight falls on the previous UTC date, so a UTC day comparison would
      // already call this overdue late on the due day itself.
      vi.setSystemTime(new Date("2026-10-19T23:30:00+07:00"));
      let { obligation: row } = await obligation(transactionId);
      expect(row).toMatchObject({ status: "due_soon", daysUntilDue: 0 });
      expect(row.installments?.[0].status).toBe("pending");

      vi.setSystemTime(new Date("2026-10-20T00:30:00+07:00"));
      ({ obligation: row } = await obligation(transactionId));
      expect(row).toMatchObject({ status: "overdue", daysUntilDue: -1 });
      expect(row.installments?.[0].status).toBe("overdue");
    });
  });
});
