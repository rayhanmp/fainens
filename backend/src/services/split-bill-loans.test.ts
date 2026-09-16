import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, is, SQL } from "drizzle-orm";
import { getTableConfig, SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import * as schema from "../db/schema";

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

import { executeAgentApproval, prepareAgentAction, reissueAgentApproval } from "./agent-actions";
import { insertPreparedJournalEntrySync } from "./ledger";
import { insertSplitBillLoansSync, loadLoanSourceLinks, prepareSplitBillLoans, splitBillLoanInputSchema, splitBillTagNames } from "./split-bill-loans";

const input = {
  title: "Sogogi Reserve", date: "2026-09-12T17:10:00+07:00", walletAccountId: 1,
  personalShareCents: 130900, receiptTotalCents: 654500,
  receivables: ["Hilma", "Gibran", "Revian", "Nipeh"].map((name) => ({ name, amountCents: 130900 })),
};
const ownerEmail = "rayhan@example.com";

describe("linked split-bill receivables", () => {
  let sqlite: InstanceType<typeof Database>;
  beforeEach(() => {
    sqlite = new Database(":memory:");
    const dialect = new SQLiteSyncDialect();
    // Match the current production columns/defaults without touching the user's DB.
    for (const table of [schema.accounts, schema.contacts, schema.loans, schema.tags, schema.transactions,
      schema.transactionLines, schema.transactionTags, schema.transactionCategoryAllocations,
      schema.categories, schema.salaryPeriods, schema.auditLogs, schema.splitbillSessions,
      schema.agentApprovals, schema.agentPendingActions, schema.agentConversations, schema.financialState]) {
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
    state.db = drizzle(sqlite);
    state.db.insert(schema.accounts).values({ id: 1, name: "BNI", type: "asset", liquidityClass: "cash_equivalent", isActive: true }).run();
    state.db.insert(schema.contacts).values({ name: "Hilma", fullName: "Hilma Test" }).run();
  });
  afterEach(() => { sqlite.close(); state.db = null; });

  it("validates exact receipt accounting and rejects duplicate participants", () => {
    expect(splitBillLoanInputSchema.safeParse(input).success).toBe(true);
    expect(splitBillLoanInputSchema.safeParse({ ...input, receiptTotalCents: 654501 }).success).toBe(false);
    expect(splitBillLoanInputSchema.safeParse({ ...input, receivables: [{ name: "Hilma", amountCents: 261800 }, { name: "hilma", amountCents: 261800 }] }).success).toBe(false);
    expect(splitBillLoanInputSchema.safeParse({ ...input, date: "not a date" }).success).toBe(false);
    expect(splitBillTagNames(input.title, input.date, ["split bill"])).toHaveLength(2);
  });

  it("prepares without posting, then atomically saves four linked loans and one payment", async () => {
    const proposal = await prepareAgentAction({ ownerEmail, kind: "split_bill_loans_create", input });
    expect(state.db.select().from(schema.transactions).all()).toHaveLength(0);
    expect(state.db.select().from(schema.loans).all()).toHaveLength(0);
    expect(state.db.select().from(schema.contacts).all()).toHaveLength(1);
    expect(state.db.select().from(schema.tags).all()).toHaveLength(0);
    const result = await executeAgentApproval({ ownerEmail, approvalId: proposal.approvalId, token: proposal.approvalToken });
    if (result.receipt.kind !== "split_bill_loans_create") throw new Error("Unexpected receipt kind");
    const savedLoans = state.db.select().from(schema.loans).all();
    expect(savedLoans).toHaveLength(4);
    expect(savedLoans.reduce((sum: number, loan: any) => sum + loan.amountCents, 0)).toBe(523600);
    expect(savedLoans.every((loan: any) => loan.sourceTransactionId === result.receipt.transactionId && loan.sourceType === "split_bill")).toBe(true);
    expect(state.db.select().from(schema.transactions).all()).toHaveLength(1);
    expect(state.db.select().from(schema.contacts).all()).toHaveLength(4);
    const lines = state.db.select().from(schema.transactionLines).all();
    expect(lines.reduce((sum: number, line: any) => sum + line.debit, 0)).toBe(654500);
    expect(lines.reduce((sum: number, line: any) => sum + line.credit, 0)).toBe(654500);
    expect(lines.find((line: any) => line.accountId === 1).credit).toBe(654500);
    const expense = state.db.select().from(schema.accounts).all().find((account: any) => account.type === "expense");
    expect(lines.find((line: any) => line.accountId === expense.id).debit).toBe(130900);
    const [session] = state.db.select().from(schema.splitbillSessions).all();
    expect(JSON.parse(session.loanIds)).toEqual(savedLoans.map((loan: any) => loan.id));
    const links = await loadLoanSourceLinks(savedLoans);
    expect(links.get(result.receipt.transactionId!)?.tags.map((tag) => tag.name)).toEqual([...splitBillTagNames(input.title, input.date), `Split bill #${result.receipt.transactionId}`]);
    const replay = await executeAgentApproval({ ownerEmail, approvalId: proposal.approvalId, token: proposal.approvalToken });
    expect(replay.replay).toBe(true);
    expect(state.db.select().from(schema.loans).all()).toHaveLength(4);
  });

  it("requires the approval owner, supports restored proposals and reuses existing contacts", async () => {
    const proposal = await prepareAgentAction({ ownerEmail, kind: "split_bill_loans_create", input });
    await expect(executeAgentApproval({ ownerEmail: "other@example.com", approvalId: proposal.approvalId, token: proposal.approvalToken })).rejects.toThrow();
    const restored = await reissueAgentApproval({ ownerEmail, approvalId: proposal.approvalId });
    expect(restored.kind).toBe("split_bill_loans_create");
    await expect(executeAgentApproval({ ownerEmail, approvalId: proposal.approvalId, token: proposal.approvalToken })).rejects.toThrow();
    await executeAgentApproval({ ownerEmail, approvalId: restored.approvalId, token: restored.approvalToken });
    expect(state.db.select().from(schema.contacts).where(eq(schema.contacts.name, "Hilma")).all()).toHaveLength(1);
  });

  it("rolls back the entire bill when a later insert fails", async () => {
    const parsed = splitBillLoanInputSchema.parse(input);
    const draft = await prepareSplitBillLoans(parsed);
    sqlite.exec("CREATE TRIGGER reject_second_loan BEFORE INSERT ON loan WHEN (SELECT COUNT(*) FROM loan) = 1 BEGIN SELECT RAISE(ABORT, 'forced failure'); END");
    expect(() => state.db.transaction((tx: any) => insertSplitBillLoansSync(tx, parsed, draft, insertPreparedJournalEntrySync))).toThrow();
    for (const table of [schema.transactions, schema.transactionLines, schema.loans, schema.tags, schema.splitbillSessions]) expect(state.db.select().from(table).all()).toHaveLength(0);
    expect(state.db.select().from(schema.contacts).all()).toHaveLength(1);
  });

  it("refuses a stale approval instead of partially creating loans", async () => {
    const proposal = await prepareAgentAction({ ownerEmail, kind: "split_bill_loans_create", input });
    state.db.insert(schema.financialState).values({ id: 1, revision: proposal.baseFinancialRevision + 1 }).run();
    await expect(executeAgentApproval({ ownerEmail, approvalId: proposal.approvalId, token: proposal.approvalToken })).rejects.toThrow(/changed/);
    expect(state.db.select().from(schema.loans).all()).toHaveLength(0);
  });

  it("reuses the common tag but keeps different source payments as separate bills", async () => {
    for (const title of ["Sogogi Reserve", "Lunch together"]) {
      const proposal = await prepareAgentAction({ ownerEmail, kind: "split_bill_loans_create", input: { ...input, title } });
      await executeAgentApproval({ ownerEmail, approvalId: proposal.approvalId, token: proposal.approvalToken });
    }
    expect(state.db.select().from(schema.tags).all()).toHaveLength(5);
    expect(state.db.select().from(schema.contacts).all()).toHaveLength(4);
    expect(state.db.select().from(schema.splitbillSessions).all()).toHaveLength(2);
    expect(new Set(state.db.select().from(schema.loans).all().map((loan: any) => loan.sourceTransactionId)).size).toBe(2);
  });
});
