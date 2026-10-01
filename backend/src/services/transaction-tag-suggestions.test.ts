import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

const state = vi.hoisted(() => ({ db: null as any, call: vi.fn(), config: vi.fn() }));
vi.mock("../db/client", () => ({ db: new Proxy({}, { get(_target, key) { const value = state.db[key]; return typeof value === "function" ? value.bind(state.db) : value; } }) }));
vi.mock("./openrouter", () => ({ callOpenRouter: state.call }));
vi.mock("./agent-provider-config", () => ({ getAgentProviderConfig: state.config }));
import { suggestTransactionTags } from "./transaction-tag-suggestions";

describe("same-category tag examples", () => {
  let sqlite: InstanceType<typeof Database>;
  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE tag (id INTEGER PRIMARY KEY, name TEXT, color TEXT);
      CREATE TABLE "transaction" (id INTEGER PRIMARY KEY, date INTEGER, description TEXT, category_id INTEGER, status TEXT, reversal_of_tx_id INTEGER);
      CREATE TABLE transaction_tag (transaction_id INTEGER, tag_id INTEGER);
      CREATE TABLE transaction_category_allocation (transaction_id INTEGER, category_id INTEGER, amount INTEGER);
      INSERT INTO tag VALUES (1, 'Food', '#64748B'), (2, 'Campus', '#64748B');
    `);
    state.db = drizzle(sqlite);
    vi.clearAllMocks();
    state.config.mockResolvedValue({ apiKey: "test", model: "test", baseUrl: "https://provider.example/v1" });
    state.call.mockResolvedValue('{"tagIds":[1]}');
  });
  afterEach(() => { sqlite.close(); state.db = null; });

  function entry(id: number, categoryId: number | null, status = "posted", reversalOf: number | null = null) {
    sqlite.prepare('INSERT INTO "transaction" VALUES (?, ?, ?, ?, ?, ?)').run(id, id * 1000, `Example ${id}`, categoryId, status, reversalOf);
    sqlite.prepare('INSERT INTO transaction_tag VALUES (?, 1), (?, 2)').run(id, id);
  }
  function prompt() { return JSON.parse(state.call.mock.calls[0][1]); }

  it("includes at most fifteen distinct tagged transactions from the same category, newest first", async () => {
    for (let id = 1; id <= 20; id++) entry(id, 1);
    for (let id = 30; id <= 40; id++) entry(id, 2);
    entry(50, 1, "draft"); entry(51, 1, "reversed"); entry(52, 1, "posted", 1);
    await suggestTransactionTags({ description: "Lunch", categoryId: 1 });
    expect(prompt().previousTaggedTransactions).toEqual(Array.from({ length: 15 }, (_, index) => ({ description: `Example ${20 - index}`, tagIds: [1, 2] })));
  });
  it("omits history entirely when there is no category", async () => {
    entry(1, 1);
    await suggestTransactionTags({ description: "Lunch" });
    expect(prompt()).not.toHaveProperty("previousTaggedTransactions");
  });
  it("excludes the current transaction when editing", async () => {
    entry(1, 1); entry(2, 1);
    await suggestTransactionTags({ description: "Lunch", categoryId: 1, transactionId: 2 });
    expect(prompt().previousTaggedTransactions).toEqual([{ description: "Example 1", tagIds: [1, 2] }]);
    expect(prompt().transaction).toEqual({ description: "Lunch" });
  });
  it("includes journals allocated only to the chosen category and excludes mixed allocations", async () => {
    entry(1, null); entry(2, null); entry(3, 1);
    sqlite.exec('INSERT INTO transaction_category_allocation VALUES (1, 1, 100), (2, 1, 50), (2, 2, 50), (3, 1, 50), (3, 2, 50)');
    await suggestTransactionTags({ description: "Lunch", categoryId: 1 });
    expect(prompt().previousTaggedTransactions).toEqual([{ description: "Example 1", tagIds: [1, 2] }]);
  });
  it("has no examples when that category has no tagged history", async () => {
    entry(1, 2);
    await suggestTransactionTags({ description: "Lunch", categoryId: 1 });
    expect(prompt().previousTaggedTransactions).toEqual([]);
  });
});
