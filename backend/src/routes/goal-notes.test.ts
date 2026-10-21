import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { is, SQL } from "drizzle-orm";
import { getTableConfig, SQLiteSyncDialect, SQLiteTable } from "drizzle-orm/sqlite-core";
import * as schema from "../db/schema";

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db/client", () => ({ db: new Proxy({}, {
  get(_target, key) {
    const value = state.db[key];
    return typeof value === "function" ? value.bind(state.db) : value;
  },
}) }));

import noteRoutes from "./goal-notes";
import { dueTasks, plainLine, VERSIONS_KEPT } from "../services/goal-notes";

function createAllTables(sqlite: InstanceType<typeof Database>) {
  const dialect = new SQLiteSyncDialect();
  for (const table of Object.values(schema).filter((value): value is SQLiteTable => is(value, SQLiteTable))) {
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
      return `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}${column.notNull ? " NOT NULL" : ""}${defaultSql}`;
    });
    sqlite.exec(`CREATE TABLE IF NOT EXISTS "${config.name}" (${columns.join(", ")})`);
  }
}

describe("goal notes", () => {
  let sqlite: InstanceType<typeof Database>;
  let app: ReturnType<typeof Fastify>;
  const inject = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload?: unknown) => app.inject({ method, url, payload: payload as any });

  beforeEach(async () => {
    sqlite = new Database(":memory:");
    createAllTables(sqlite);
    state.db = drizzle(sqlite, { schema });
    state.db.insert(schema.savingsGoals).values([
      { id: 1, name: "Japan", targetAmount: 25_000_000 },
      { id: 2, name: "Old trip", targetAmount: 1, status: "archived" },
    ]).run();
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate("authenticate", async () => {});
    await app.register(noteRoutes);
    await app.ready();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
    sqlite.close();
  });

  it("keeps pages in order, and a copy of the old text at most every ten minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 21, 9));
    const notes = (await inject("POST", "/api/goals/1/pages", { title: "Notes" })).json();
    const food = (await inject("POST", "/api/goals/1/pages", { title: "Places to eat", content: "- Ichiran" })).json();
    expect((await inject("PUT", "/api/goals/1/pages/order", { ids: [food.id] })).json().map((page: { title: string }) => page.title)).toEqual(["Places to eat", "Notes"]);

    await inject("PATCH", `/api/goal-pages/${notes.id}`, { content: "first" });
    // The page was empty before, so there was nothing to keep.
    expect((await inject("GET", `/api/goal-pages/${notes.id}/versions`)).json()).toEqual([]);
    await inject("PATCH", `/api/goal-pages/${notes.id}`, { content: "second" });
    vi.setSystemTime(new Date(2026, 9, 21, 9, 5));
    await inject("PATCH", `/api/goal-pages/${notes.id}`, { content: "third" });
    vi.setSystemTime(new Date(2026, 9, 21, 9, 12));
    await inject("PATCH", `/api/goal-pages/${notes.id}`, { content: "fourth" });
    const versions = (await inject("GET", `/api/goal-pages/${notes.id}/versions`)).json();
    expect(versions.map((version: { preview: string }) => version.preview)).toEqual(["third", "first"]);

    // Restoring keeps what was there, so it can be undone too.
    const restored = (await inject("POST", `/api/goal-page-versions/${versions[1].id}/restore`)).json();
    expect(restored.content).toBe("first");
    expect((await inject("GET", `/api/goal-pages/${notes.id}/versions`)).json()[0].preview).toBe("fourth");
    expect((await inject("DELETE", `/api/goal-pages/${food.id}`)).statusCode).toBe(204);
    expect((await inject("GET", "/api/goals/1/pages")).json().map((page: { title: string }) => page.title)).toEqual(["Notes"]);
  });

  it("keeps only the newest copies", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const page = (await inject("POST", "/api/goals/1/pages", { title: "Notes", content: "v0" })).json();
    for (let step = 1; step <= VERSIONS_KEPT + 3; step += 1) {
      vi.setSystemTime(new Date(2026, 9, 21, 0, step * 11));
      await inject("PATCH", `/api/goal-pages/${page.id}`, { content: `v${step}` });
    }
    const versions = (await inject("GET", `/api/goal-pages/${page.id}/versions`)).json();
    expect(versions).toHaveLength(VERSIONS_KEPT);
    expect(versions.at(-1).preview).toBe("v3");
  });

  it("finds words across goals' notes, and lists dated checklist items still to do", async () => {
    await inject("POST", "/api/goals/1/pages", { title: "Notes", content: "## Before we go\n- [ ] Apply for the visa @[2027-01-10]\n- [x] Book [[part:3|Flights]] @[2026-11-01]\n- [ ] Pack\n\nRamen at Ichiran in Shibuya" });
    await inject("POST", "/api/goals/2/pages", { title: "Archived", content: "- [ ] Old task @[2026-01-01]" });
    const hits = (await inject("GET", "/api/goals/notes/search?q=ichiran")).json();
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ goalId: 1, goalName: "Japan", pageTitle: "Notes" });
    expect(hits[0].snippet).toContain("Ramen at Ichiran");
    expect((await inject("GET", "/api/goals/notes/search?q=x")).json()).toEqual([]);
    const tasks = (await inject("GET", "/api/goals/notes/tasks")).json();
    expect(tasks.map((task: { text: string; goalId: number }) => [task.text, task.goalId])).toEqual([["Apply for the visa", 1]]);
  });

  it("reads notes' own marks as plain words", () => {
    expect(plainLine("Book [[part:3|Flights]] by @[2027-01-10] **now**")).toBe("Book Flights by 10 Jan **now**".replace(/\*\*/g, ""));
    expect(dueTasks("- [ ] Visa @[2027-01-10]\n- [x] Done @[2027-01-01]\n- [ ] No date")).toEqual([{ text: "Visa", dueAt: new Date(2027, 0, 10, 12).getTime() }]);
    // As the editor keeps them: a date tag, and a link to a part.
    expect(dueTasks('- [ ] Pay <span data-goal-ref="part:3">Hotel</span> <span data-date="2027-02-01">1 Feb 2027</span>')).toEqual([{ text: "Pay Hotel", dueAt: new Date(2027, 1, 1, 12).getTime() }]);
  });
});
