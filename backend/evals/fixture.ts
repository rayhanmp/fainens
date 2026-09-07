import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";
import * as schema from "../src/db/schema";

export const NOW = Date.parse("2026-08-31T12:00:00+07:00");
export const OWNER = "agent-eval@example.invalid";
export const PERIOD = 2;
export const CATEGORY_NAMES = ["Food", "Travel", "Shopping", "Health", "Music", "Utilities", "Gifts", "Other"];
export const CATEGORY_AMOUNTS = [200_000, 180_000, 160_000, 140_000, 120_000, 100_000, 80_000, 60_000];
export const SPENDING = 1_040_000;
export const BNI_BALANCE = 3_960_000;
export const TOTAL_BALANCE = 4_260_000;

let sqlite: InstanceType<typeof Database> | undefined;
let current: ReturnType<typeof drizzle> | undefined;
let schemaSql: string[] | undefined;
// Imports throughout the real application see the same proxy; each case gets
// a fresh in-memory connection. The production db/client module is never loaded.
export const evalDb = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, key) {
    if (!current) throw new Error("Evaluation database has not been initialized");
    const value = Reflect.get(current, key);
    return typeof value === "function" ? value.bind(current) : value;
  },
});

export async function resetFixture() {
  sqlite?.close();
  sqlite = new Database(":memory:");
  current = drizzle(sqlite);
  // Build from the real current schema. This suite evaluates the current
  // runtime, not legacy migration upgrades or migration-only triggers.
  if (!schemaSql) schemaSql = await generateSQLiteMigration(
    await generateSQLiteDrizzleJson({}), await generateSQLiteDrizzleJson(schema),
  );
  for (const statement of schemaSql) sqlite.exec(statement);
  sqlite.pragma("foreign_keys = ON");
  const account = sqlite.prepare("INSERT INTO account (id,name,type,liquidity_class,system_key,account_number) VALUES (?,?,?,?,?,?)");
  account.run(1, "BNI", "asset", "cash_equivalent", null, "EVAL-BNI-001");
  account.run(2, "GoPay", "asset", "cash_equivalent", null, "EVAL-GOPAY-002");
  account.run(3, "Investments", "asset", "investment", null, null);
  account.run(10, "Expenses", "expense", "non_cash", "eval_expense", null);
  account.run(11, "Revenue", "revenue", "non_cash", "eval_revenue", null);
  account.run(12, "Opening equity", "equity", "non_cash", "eval_equity", null);
  const period = sqlite.prepare("INSERT INTO salary_period (id,name,start_date,end_date,status,coverage_status,is_active) VALUES (?,?,?,?,?,?,?)");
  period.run(1, "August 2026", Date.parse("2026-07-25T00:00:00+07:00"), Date.parse("2026-08-24T00:00:00+07:00"), "closed", "partial", 0);
  period.run(PERIOD, "September 2026", Date.parse("2026-08-25T00:00:00+07:00"), Date.parse("2026-09-24T00:00:00+07:00"), "open", "complete", 1);
  CATEGORY_NAMES.forEach((name, i) => {
    sqlite!.prepare("INSERT INTO category (id,name,is_active,reporting_account_id) VALUES (?,?,1,10)").run(i + 1, name);
    sqlite!.prepare("INSERT INTO budget_plan (period_id,category_id,planned_amount) VALUES (?,?,?)").run(PERIOD, i + 1, 300_000);
  });
  // Opening balances are outside the reporting period and are not income.
  journal(1, "Opening BNI", 5_000_000, 1, 12, null, null, "opening_balance", "2026-07-01T12:00:00+07:00");
  journal(2, "Opening GoPay", 300_000, 2, 12, null, null, "opening_balance", "2026-07-01T12:00:00+07:00");
  journal(3, "Opening investments", 9_000_000, 3, 12, null, null, "opening_balance", "2026-07-01T12:00:00+07:00");
  CATEGORY_AMOUNTS.forEach((amount, i) => journal(100 + i, `${CATEGORY_NAMES[i]} purchase`, amount, 10, 1, i + 1, PERIOD));
  sqlite.prepare("INSERT INTO agent_profile (owner_email,nickname) VALUES (?,?)").run(OWNER, "Ray");
  sqlite.prepare("INSERT INTO agent_memory (owner_email,label,content) VALUES (?,?,?)")
    .run(OWNER, "Display name", "Call me Ray. Split bills are calculation-only unless I explicitly request recording.");
  sqlite.prepare("INSERT INTO financial_state (id,revision) VALUES (1,223)").run();
}

export function journal(id: number, description: string, amount: number, debitAccount: number, creditAccount: number,
  categoryId: number | null, periodId: number | null, type = "expense", date = "2026-08-30T12:00:00+07:00") {
  if (!sqlite) throw new Error("No evaluation database");
  sqlite.prepare('INSERT INTO "transaction" (id,date,description,tx_type,status,period_id,category_id) VALUES (?,?,?,?,?,?,?)')
    .run(id, Date.parse(date), description, type, "posted", periodId, categoryId);
  const line = sqlite.prepare("INSERT INTO transaction_line (transaction_id,account_id,debit,credit,cash_flow_class) VALUES (?,?,?,?,?)");
  line.run(id, debitAccount, amount, 0, debitAccount <= 2 ? "operating" : null);
  line.run(id, creditAccount, 0, amount, creditAccount <= 2 ? "operating" : null);
  if (categoryId != null) sqlite.prepare("INSERT INTO transaction_category_allocation (transaction_id,category_id,amount) VALUES (?,?,?)")
    .run(id, categoryId, amount);
}

export function sqlRows(query: string, ...args: unknown[]): Record<string, any>[] {
  if (!sqlite) throw new Error("No evaluation database");
  return sqlite.prepare(query).all(...args) as Record<string, any>[];
}

export function sqlRun(query: string, ...args: unknown[]) {
  if (!sqlite) throw new Error("No evaluation database");
  return sqlite.prepare(query).run(...args);
}

export function ledgerSnapshot() {
  return JSON.stringify({
    transactions: sqlRows('SELECT * FROM "transaction" ORDER BY id'),
    lines: sqlRows("SELECT * FROM transaction_line ORDER BY id"),
    allocations: sqlRows("SELECT * FROM transaction_category_allocation ORDER BY id"),
    loans: sqlRows("SELECT * FROM loan ORDER BY id"),
    budgets: sqlRows("SELECT * FROM budget_plan ORDER BY id"),
    tags: sqlRows("SELECT * FROM tag ORDER BY id"),
  });
}

export function closeFixture() { sqlite?.close(); sqlite = undefined; current = undefined; }
