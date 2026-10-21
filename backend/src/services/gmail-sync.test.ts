import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { is, SQL } from "drizzle-orm";
import { getTableConfig, SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import * as schema from "../db/schema";

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db/client", () => ({ db: new Proxy({}, {
  get(_target, key) {
    const value = state.db[key];
    return typeof value === "function" ? value.bind(state.db) : value;
  },
}) }));

import { gmailErrorText, insertGmailPendingTransactionOnce, resolveFundingAccount } from "./gmail-sync";

describe("Gmail sync errors", () => {
  it("says access was lost in plain words, and passes other failures on", () => {
    expect(gmailErrorText(new Error("invalid_grant: Token has been expired or revoked."))).toBe("Google no longer lets Fainens read your Gmail. Connect it again.");
    expect(gmailErrorText(new Error("Request failed with status code 401"))).toMatch(/Connect it again/);
    expect(gmailErrorText(new Error("socket hang up"))).toBe("Gmail couldn't be checked: socket hang up");
  });
});

function createPendingTable(sqlite: InstanceType<typeof Database>) {
  const dialect = new SQLiteSyncDialect();
  const config = getTableConfig(schema.pendingTransactions);
  const columns = config.columns.map((column) => {
    let defaultSql = "";
    if (column.default !== undefined) {
      const value = column.default;
      const literal = is(value, SQL) ? dialect.sqlToQuery(value).sql
        : typeof value === "string" ? `'${value.replace(/'/g, "''")}'` : String(value);
      defaultSql = ` DEFAULT ${literal}`;
    }
    return `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}${column.notNull ? " NOT NULL" : ""}${defaultSql}`;
  });
  sqlite.exec(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);
}

const email = (messageId: string, reference: string | null) => ({
  messageId,
  reference,
  rawMessage: `Gmail: wondr@bni.co.id\nMessage: ${messageId}`,
  parsedData: JSON.stringify({ type: "expense", amount: 654_500, reference }),
});

describe("Gmail pending import dedupe", () => {
  let sqlite: InstanceType<typeof Database>;
  beforeEach(() => {
    sqlite = new Database(":memory:");
    createPendingTable(sqlite);
    state.db = drizzle(sqlite);
  });
  afterEach(() => { sqlite.close(); state.db = null; });

  it("inserts each Gmail message once", () => {
    expect(insertGmailPendingTransactionOnce(email("msg-1", "REF-1"))).toEqual(expect.any(Number));
    expect(insertGmailPendingTransactionOnce(email("msg-1", "REF-1"))).toBeNull();
    expect(state.db.select().from(schema.pendingTransactions).all()).toHaveLength(1);
  });

  it("skips a second email carrying the same bank reference ID", () => {
    expect(insertGmailPendingTransactionOnce(email("msg-1", "REF-1"))).not.toBeNull();
    expect(insertGmailPendingTransactionOnce(email("msg-2", " REF-1 "))).toBeNull();
    expect(insertGmailPendingTransactionOnce(email("msg-3", "REF-2"))).not.toBeNull();
    expect(insertGmailPendingTransactionOnce(email("msg-4", null))).not.toBeNull();
    expect(state.db.select().from(schema.pendingTransactions).all()).toHaveLength(3);
  });

  it("tolerates unreadable parsed data on older rows", () => {
    state.db.insert(schema.pendingTransactions).values({ rawMessage: "x", parsedData: "not json", source: "gmail:bni", userMessageId: "old" }).run();
    expect(insertGmailPendingTransactionOnce(email("msg-1", "REF-1"))).not.toBeNull();
  });

  it("takes the write lock before the duplicate check", () => {
    // A second connection holding the write lock must block the import rather
    // than letting it read a stale "no duplicate" answer.
    // Two connections need a shared file; use a throwaway one, never the app DB.
    const dir = mkdtempSync(path.join(tmpdir(), "fainens-gmail-sync-"));
    const file = path.join(dir, "lock-test.db");
    const writer = new Database(file);
    const reader = new Database(file, { timeout: 50 });
    try {
      createPendingTable(writer);
      state.db = drizzle(reader);
      writer.exec("BEGIN IMMEDIATE");
      expect(() => insertGmailPendingTransactionOnce(email("msg-1", "REF-1"))).toThrow(/locked|busy/i);
      writer.exec("ROLLBACK");
      expect(insertGmailPendingTransactionOnce(email("msg-1", "REF-1"))).not.toBeNull();
    } finally {
      reader.close();
      writer.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Gmail funding account resolution", () => {
  it("leaves a tied match unresolved", () => {
    const rows = [
      { id: 1, name: "Taplus Muda", accountNumber: null },
      { id: 2, name: "Taplus Muda Savings", accountNumber: null },
    ];
    expect(resolveFundingAccount("TAPLUS MUDA • *******897", rows)).toBeNull();
    expect(resolveFundingAccount("TAPLUS MUDA • *******897", [...rows, { id: 3, name: "BNI", accountNumber: "1234567897" }]))
      .toEqual({ id: 3, name: "BNI" });
  });
});
