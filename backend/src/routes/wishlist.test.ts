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

import wishlistRoutes from "./wishlist";

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

describe("wishlist", () => {
  let sqlite: InstanceType<typeof Database>;
  let app: ReturnType<typeof Fastify>;
  const create = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/wishlist", payload });

  beforeEach(async () => {
    sqlite = new Database(":memory:");
    createAllTables(sqlite);
    state.db = drizzle(sqlite, { schema });
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate("authenticate", async () => {});
    await app.register(wishlistRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    sqlite.close();
  });

  it("saves an item with the product picture the scraper stored", async () => {
    const response = await create({ name: "Kindle", amount: 1_500_000, imageUrl: "wishlist-images/1729_abc123.jpg" });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ amount: 1_500_000, imageUrl: "wishlist-images/1729_abc123.jpg" });
  });

  it("takes only stored pictures, not shop links or other paths", async () => {
    expect((await create({ name: "Kindle", amount: 1, imageUrl: "https://shop.example/kindle.jpg" })).statusCode).toBe(400);
    expect((await create({ name: "Kindle", amount: 1, imageUrl: "wishlist-images/../goals/secret.jpg" })).statusCode).toBe(400);
    expect((await create({ name: "Kindle", amount: 1, imageUrl: null })).statusCode).toBe(201);
  });
});
