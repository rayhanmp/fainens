import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { computeAccountBalanceAsOf } from "./ledger";

describe("computeAccountBalanceAsOf reversal restatement", () => {
  let sqlite: InstanceType<typeof Database> | null = null;

  afterEach(() => {
    sqlite?.close();
    sqlite = null;
  });

  it("removes a reversed journal and its reversal from every restated snapshot", async () => {
    sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE account (id INTEGER PRIMARY KEY, type TEXT NOT NULL);
      CREATE TABLE "transaction" (
        id INTEGER PRIMARY KEY,
        date INTEGER NOT NULL,
        status TEXT NOT NULL,
        tx_type TEXT NOT NULL,
        reversal_of_tx_id INTEGER
      );
      CREATE TABLE transaction_line (
        id INTEGER PRIMARY KEY,
        transaction_id INTEGER NOT NULL,
        account_id INTEGER NOT NULL,
        debit INTEGER NOT NULL DEFAULT 0,
        credit INTEGER NOT NULL DEFAULT 0
      );
    `);
    sqlite.prepare("INSERT INTO account (id, type) VALUES (?, ?)").run(1, "asset");
    sqlite.prepare("INSERT INTO [transaction] (id, date, status, tx_type, reversal_of_tx_id) VALUES (?, ?, ?, ?, ?)")
      .run(1, 100, "reversed", "simple_income", null);
    sqlite.prepare("INSERT INTO [transaction] (id, date, status, tx_type, reversal_of_tx_id) VALUES (?, ?, ?, ?, ?)")
      .run(2, 200, "posted", "reversal", 1);
    sqlite.prepare("INSERT INTO [transaction] (id, date, status, tx_type, reversal_of_tx_id) VALUES (?, ?, ?, ?, ?)")
      .run(3, 150, "posted", "manual", null);
    sqlite.prepare("INSERT INTO transaction_line (id, transaction_id, account_id, debit, credit) VALUES (?, ?, ?, ?, ?)")
      .run(1, 1, 1, 100, 0);
    sqlite.prepare("INSERT INTO transaction_line (id, transaction_id, account_id, debit, credit) VALUES (?, ?, ?, ?, ?)")
      .run(2, 2, 1, 0, 100);
    sqlite.prepare("INSERT INTO transaction_line (id, transaction_id, account_id, debit, credit) VALUES (?, ?, ?, ?, ?)")
      .run(3, 3, 1, 50, 0);

    const testDb = drizzle(sqlite);
    expect(await computeAccountBalanceAsOf(1, 150, testDb)).toBe(150);
    expect(await computeAccountBalanceAsOf(1, 150, testDb, { restateReversals: true })).toBe(50);
    expect(await computeAccountBalanceAsOf(1, 250, testDb, { restateReversals: true })).toBe(50);
  });
});
