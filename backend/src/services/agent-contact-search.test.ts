import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db/client", () => ({ db: new Proxy({}, {
  get(_target, key) { const value = state.db[key]; return typeof value === "function" ? value.bind(state.db) : value; },
}) }));

import { contactSearchInputSchema, findContactsTool } from "./agent-contact-search";

describe("agent contact-name discovery", () => {
  let sqlite: InstanceType<typeof Database>;
  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE contact (id INTEGER PRIMARY KEY, name TEXT NOT NULL, full_name TEXT, kind TEXT NOT NULL DEFAULT 'person', is_active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE financial_state (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL);
      INSERT INTO financial_state VALUES (1, 7);
    `);
    const insert = sqlite.prepare("INSERT INTO contact (id, name, full_name, is_active) VALUES (?, ?, ?, ?)");
    insert.run(11, "Hilma", "Hilma Salsabila", 1);
    insert.run(12, "Gibran", "Gibran Test", 1);
    insert.run(13, "Hilman", null, 1);
    insert.run(14, "Hilma", "Hilma Other", 0);
    insert.run(15, "100% Real", null, 1);
    insert.run(16, "Júlia", "Júlia Test", 1);
    state.db = drizzle(sqlite);
  });
  afterEach(() => { sqlite.close(); state.db = null; });

  it("discovers IDs without requiring an existing loan and ranks exact names first", async () => {
    const result = await findContactsTool({ query: " hILMa ", selection: { mode: "all" } });
    expect(result.data.contacts.map((row) => row.id)).toEqual([11, 13]);
    expect(result.data.contacts[0]).toMatchObject({ id: 11, name: "Hilma", matchType: "exact", matchedField: "name" });
    expect(result.data.exactMatchCount).toBe(1);
    expect(result.data.ambiguous).toBe(false);
    expect(result.data.complete).toBe(true);
    expect(result.readOnly).toBe(true);
    expect(result.revision).toBe(7);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM contact").get()).toEqual({ count: 6 });
  });

  it("matches full names, whitespace and accents", async () => {
    const fullName = await findContactsTool({ query: "Hilma   Salsabila", selection: { mode: "all" } });
    expect(fullName.data.contacts[0]).toMatchObject({ id: 11, matchedField: "fullName", matchType: "exact" });
    const accent = await findContactsTool({ query: "Julia", selection: { mode: "all" } });
    expect(accent.data.contacts[0]).toMatchObject({ id: 16, matchType: "exact" });
  });

  it("reports ambiguous partial names and includes archived contacts only explicitly", async () => {
    const partial = await findContactsTool({ query: "Hil", selection: { mode: "all" } });
    expect(partial.data.ambiguous).toBe(true);
    expect(partial.data.contacts.map((row) => row.id)).toEqual([11, 13]);
    const archived = await findContactsTool({ query: "Hilma", includeInactive: true, selection: { mode: "all" } });
    expect(archived.data.exactMatchCount).toBe(2);
    expect(archived.data.ambiguous).toBe(true);
    expect(archived.data.contacts.map((row) => row.id)).toContain(14);
  });

  it("does not widen missing names or interpret SQL wildcard characters", async () => {
    expect((await findContactsTool({ query: "Missing Person", selection: { mode: "all" } })).data.contacts).toEqual([]);
    expect((await findContactsTool({ query: "%", selection: { mode: "all" } })).data.contacts.map((row) => row.id)).toEqual([15]);
    expect(contactSearchInputSchema.safeParse({ query: "   ", selection: { mode: "all" } }).success).toBe(false);
    expect(contactSearchInputSchema.safeParse({ query: "Hilma" }).success).toBe(false);
  });

  it("preserves pagination and refuses hidden truncation for an all-results request", async () => {
    const first = await findContactsTool({ query: "Hil", selection: { mode: "page", limit: 1 } });
    expect(first.data.contacts.map((row) => row.id)).toEqual([11]);
    expect(first.data.availableCount).toBe(2);
    expect(first.data.nextOffset).toBe(1);
    expect(first.data.complete).toBe(false);
    const second = await findContactsTool({ query: "Hil", selection: { mode: "page", limit: 1, offset: first.data.nextOffset } });
    expect(second.data.contacts.map((row) => row.id)).toEqual([13]);
    expect(second.data.nextOffset).toBeNull();
    const insert = sqlite.prepare("INSERT INTO contact (name) VALUES (?)");
    for (let index = 0; index < 101; index += 1) insert.run(`Person ${index}`);
    await expect(findContactsTool({ query: "Person", selection: { mode: "all" } })).rejects.toThrow(/narrow/);
    expect((await findContactsTool({ query: "Person", selection: { mode: "page", limit: 100 } })).data.nextOffset).toBe(100);
  });
});
