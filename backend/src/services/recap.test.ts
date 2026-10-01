import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FinancialFacts, FinancialFactRow } from "./financial-facts";
const mocks = vi.hoisted(() => ({ facts: vi.fn(), select: vi.fn(), plans: vi.fn() }));
vi.mock("../db/client", () => ({ db: { select: mocks.select, all: mocks.plans } }));
vi.mock("./financial-facts", () => ({ getFinancialFacts: mocks.facts }));
import { getPeriodRecap, listRecapPeriods, summarizeRecap, summarizeRecapBudget } from "./recap";

const facts = (overrides: Partial<FinancialFacts> = {}): FinancialFacts => ({
  startMs: 0, endMs: 0, asOfMs: 0, rows: [], totalSpentCents: 0, totalIncomeCents: 0,
  walletBalanceCents: 0, byCategory: [], ...overrides,
});
const row = (id: number, expenseCents: number, incomeCents = 0): FinancialFactRow => ({
  id, date: Date.UTC(2026, 7, id), description: "Purchase", status: "posted", categoryId: 1,
  category: "Food", txType: "manual", expenseCents, incomeCents,
});

const previous = { id: 11, name: "July salary", startDate: Date.UTC(2026, 6, 25), endDate: Date.UTC(2026, 7, 24), coverageStatus: "complete" };
const current = { id: 12, name: "August salary", startDate: Date.UTC(2026, 7, 25), endDate: Date.UTC(2026, 8, 24), coverageStatus: "complete" };
const finished = Date.UTC(2026, 8, 27);
describe("salary-period recaps", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.select.mockReturnValue({ from: async () => [current, previous] });
    mocks.facts.mockResolvedValue(facts({ totalSpentCents: 100 }));
    mocks.plans.mockReturnValue([]);
  });
  it("uses canonical net expenses including refunds, without counting transfers as purchases", () => {
    const summary = summarizeRecap(facts({
      rows: [row(1, 100), row(2, -30), row(3, 0), row(4, 0, 200)], totalSpentCents: 70, totalIncomeCents: 200,
      byCategory: [{ categoryId: 1, category: "Food", spentCents: 70 }, { categoryId: 2, category: "Refunds", spentCents: -10 }],
    }));
    expect(summary).toMatchObject({ expenses: 70, income: 200, net: 130, activityCount: 3, purchaseCount: 1, spendingDays: 1 });
    expect(summary.largestPurchase?.amount).toBe(100);
    expect(summary.purchaseProfile).toEqual({ totalAmount: 100, medianAmount: 100 });
    expect(summary.categories).toEqual([{ name: "Food", amount: 70 }]);
    expect(summarizeRecap(facts()).largestPurchase).toBeNull();
  });
  it("summarizes repeat purchases and the peak net expense day without treating credits as purchases", () => {
    const rows = [{ ...row(1, 100), description: "Coffee", date: Date.UTC(2026, 7, 25) }, { ...row(2, 200), description: "Coffee", date: Date.UTC(2026, 7, 25) }, { ...row(3, -280), date: Date.UTC(2026, 7, 25) }, { ...row(4, 50), description: "Train", date: Date.UTC(2026, 7, 26) }];
    const summary = summarizeRecap(facts({ rows }));
    expect(summary.highlights.averagePurchaseAmount).toBe(117);
    expect(summary.highlights.peakSpendingDay).toEqual({ date: Date.UTC(2026, 7, 26), amount: 50, purchaseCount: 1 });
    expect(summary.highlights.topPurchases.map(purchase => purchase.description)).toEqual(["Coffee", "Coffee", "Train"]);
    expect(summary.highlights.repeatPurchases).toEqual([{ description: "Coffee", occurrences: 2, totalAmount: 300, category: "Food" }]);
    expect(summarizeRecap(facts()).highlights).toEqual({ averagePurchaseAmount: null, peakSpendingDay: null, topPurchases: [], repeatPurchases: [] });
  });
  it("uses the exact cross-month salary boundaries and assigned period identity", async () => {
    mocks.facts.mockResolvedValueOnce(facts({ totalSpentCents: 80 })).mockResolvedValueOnce(facts({ totalSpentCents: 100 }));
    const result = await getPeriodRecap(12, finished);
    expect(result.period).toEqual({ id: 12, name: current.name, startDate: current.startDate, endDate: current.endDate });
    expect(result.comparison).toMatchObject({ periodId: 11, periodName: previous.name, changePercent: -20 });
    expect(mocks.facts).toHaveBeenNthCalledWith(1, { periodId: 12, startMs: current.startDate, endMs: Date.UTC(2026, 8, 25) - 1, asOfMs: Date.UTC(2026, 8, 25) - 1 });
    expect(mocks.facts).toHaveBeenNthCalledWith(2, { periodId: 11, startMs: previous.startDate, endMs: Date.UTC(2026, 7, 25) - 1 });
  });
  it.each(["partial", "skipped", "unknown"])("omits comparisons for %s coverage even when another period covers those dates", async status => {
    mocks.select.mockReturnValue({ from: async () => [{ ...current, coverageStatus: status }, previous] });
    expect((await getPeriodRecap(12, finished)).comparison).toBeNull();
    expect(mocks.facts).toHaveBeenCalledTimes(1);
  });
  it("does not compare an unfinished period against a full period", async () => {
    const now = Date.UTC(2026, 8, 5);
    const result = await getPeriodRecap(12, now);
    expect(result.isPartial).toBe(true); expect(result.comparison).toBeNull();
    expect(mocks.facts.mock.calls[0][0].asOfMs).toBe(now);
    expect(mocks.facts.mock.calls[1][0]).toEqual({ periodId: previous.id, startMs: previous.startDate,
      endMs: Date.UTC(2026, 7, 25) - 1, asOfMs: previous.startDate + now - current.startDate });
    expect(result.baseline?.matchedElapsed).toBe(true);
  });
  it("builds a bounded recent baseline from complete comparable salary periods", async () => {
    const older = { ...previous, id: 10, startDate: Date.UTC(2026, 5, 25), endDate: Date.UTC(2026, 6, 24) };
    const oldest = { ...previous, id: 9, startDate: Date.UTC(2026, 4, 25), endDate: Date.UTC(2026, 5, 24) };
    mocks.select.mockReturnValue({ from: async () => [current, previous, older, oldest,
      { ...previous, id: 8, startDate: Date.UTC(2026, 3, 25), endDate: Date.UTC(2026, 4, 24) },
      { ...previous, id: 15, coverageStatus: 'unknown' }] });
    mocks.facts.mockImplementation(async ({ periodId }: { periodId: number }) => facts({
      totalIncomeCents: periodId === 12 ? 300 : 100,
      totalSpentCents: periodId === 12 ? 80 : 50,
      rows: periodId === 12 ? [row(1, 40), row(2, 40), row(3, -10)] : [row(1, 50), row(2, -10)],
    }));
    const result = await getPeriodRecap(12, finished);
    expect(result.baseline).toEqual({ periodCount: 3, matchedElapsed: false, income: 100, expenses: 50, purchaseCount: 1, purchaseTotal: 50 });
    expect(mocks.facts).toHaveBeenCalledTimes(4);
    expect(mocks.facts.mock.calls.map(([args]) => args.periodId)).toEqual([12, 11, 10, 9]);
  });
  it("does not skip an unknown predecessor to compare with an older covered period", async () => {
    mocks.select.mockReturnValue({ from: async () => [current, { ...previous, coverageStatus: "unknown" }, { ...previous, id: 10, startDate: Date.UTC(2026, 5, 25) }] });
    expect((await getPeriodRecap(12, finished)).comparison).toBeNull();
  });
  it("does not divide by zero or narrate net refunds as decreased spending", async () => {
    mocks.facts.mockResolvedValueOnce(facts({ totalSpentCents: -20 })).mockResolvedValueOnce(facts({ totalSpentCents: 0 }));
    expect((await getPeriodRecap(12, finished)).comparison).toBeNull();
  });
  it("lists started salary periods, including empty ones, rather than calendar months", async () => {
    mocks.select.mockReturnValue({ from: async () => [previous, current, { ...current, id: 13, startDate: Date.UTC(2026, 9, 25) }] });
    expect(await listRecapPeriods(Date.UTC(2026, 8, 5))).toEqual([
      { id: 12, name: current.name, startDate: current.startDate, endDate: current.endDate, isPartial: true },
      { id: 11, name: previous.name, startDate: previous.startDate, endDate: previous.endDate, isPartial: false },
    ]);
  });
  it("compares only budgeted categories and separates unbudgeted expenses and refunds", () => {
    const summary = summarizeRecapBudget(facts({ totalSpentCents: 210000, byCategory: [
      { categoryId: 1, category: 'Food', spentCents: 150000 },
      { categoryId: 2, category: 'Transport', spentCents: -10000 },
      { categoryId: 3, category: 'Unplanned', spentCents: 70000 },
    ] }), [{ categoryId: 1, name: 'Food', plannedAmount: 100000 }, { categoryId: 2, name: 'Transport', plannedAmount: 100000 }]);
    expect(summary).toEqual({ planned: 200000, spent: 140000, remaining: 60000, percentUsed: 70,
      categoryCount: 2, unbudgetedExpenses: 70000, overBudgetCategoryCount: 1,
      overBudgetCategories: [{ name: 'Food', planned: 100000, spent: 150000, over: 50000 }] });
    expect(summarizeRecapBudget(facts(), [])).toBeNull();
    expect(summarizeRecapBudget(facts(), [{ categoryId: 1, name: 'Food', plannedAmount: 0 }])?.percentUsed).toBeNull();
  });
  it("freezes budget actuals at the recap cutoff even while the period is in progress", async () => {
    mocks.plans.mockReturnValue([{ categoryId: 1, name: 'Food', plannedAmount: 100000 }]);
    mocks.facts.mockResolvedValue(facts({ totalSpentCents: 150000, byCategory: [{ categoryId: 1, category: 'Food', spentCents: 150000 }] }));
    const now = Date.UTC(2026, 8, 5);
    const result = await getPeriodRecap(12, now);
    expect(result.budget).toMatchObject({ planned: 100000, spent: 150000, remaining: -50000, percentUsed: 150 });
    expect(mocks.facts).toHaveBeenCalledWith({ periodId: 12, startMs: current.startDate, endMs: Date.UTC(2026, 8, 25) - 1, asOfMs: now });
  });
  it("rejects missing and not-yet-started periods before reading financial records", async () => {
    await expect(getPeriodRecap(99, finished)).rejects.toMatchObject({ status: 404 });
    await expect(getPeriodRecap(12, Date.UTC(2026, 7, 20))).rejects.toMatchObject({ status: 400 });
    expect(mocks.facts).not.toHaveBeenCalled();
  });
});
