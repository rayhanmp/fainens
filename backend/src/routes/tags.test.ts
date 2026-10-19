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

import tagRoutes from "./tags";

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

describe("tag groups", () => {
  let sqlite: InstanceType<typeof Database>;
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    sqlite = new Database(":memory:");
    createAllTables(sqlite);
    state.db = drizzle(sqlite);
    state.db.insert(schema.tags).values([{ id: 1, name: "Hangout", color: "#000000" }, { id: 2, name: "Salatiga trip", color: "#111111" }]).run();
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate("authenticate", async () => {});
    await app.register(tagRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    sqlite.close();
  });

  const createGroup = async (name: string) => {
    const response = await app.inject({ method: "POST", url: "/api/tag-groups", payload: { name } });
    expect(response.statusCode).toBe(201);
    return response.json() as { id: number; name: string; sortOrder: number };
  };
  const listTags = async () => (await app.inject({ method: "GET", url: "/api/tags" })).json() as Array<{ id: number; groupId: number | null }>;

  it("creates groups in order, files a tag into one and moves it back out", async () => {
    const trips = await createGroup("Trips");
    const people = await createGroup("People");
    expect([trips.sortOrder, people.sortOrder]).toEqual([0, 1]);

    expect((await app.inject({ method: "PATCH", url: "/api/tags/2", payload: { groupId: trips.id } })).statusCode).toBe(200);
    expect((await listTags()).find((tag) => tag.id === 2)?.groupId).toBe(trips.id);
    expect((await app.inject({ method: "PATCH", url: "/api/tags/2", payload: { groupId: null } })).statusCode).toBe(200);
    expect((await listTags()).find((tag) => tag.id === 2)?.groupId).toBeNull();

    expect((await app.inject({ method: "PATCH", url: "/api/tags/2", payload: { groupId: 999 } })).statusCode).toBe(400);
    const renamed = await app.inject({ method: "PATCH", url: `/api/tag-groups/${people.id}`, payload: { name: "Friends", sortOrder: 5 } });
    expect(renamed.json()).toMatchObject({ name: "Friends", sortOrder: 5 });
    expect((await app.inject({ method: "GET", url: "/api/tag-groups" })).json().map((group: { name: string }) => group.name)).toEqual(["Trips", "Friends"]);
  });

  it("keeps a deleted group's tags, ungrouped", async () => {
    const trips = await createGroup("Trips");
    await app.inject({ method: "PATCH", url: "/api/tags/2", payload: { groupId: trips.id } });
    expect((await app.inject({ method: "DELETE", url: `/api/tag-groups/${trips.id}` })).statusCode).toBe(204);
    expect((await listTags()).map((tag) => tag.groupId)).toEqual([null, null]);
    expect((await app.inject({ method: "DELETE", url: `/api/tag-groups/${trips.id}` })).statusCode).toBe(404);
  });
});
