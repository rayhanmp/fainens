import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema";

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db/client", () => ({ db: new Proxy({}, {
  get(_target, key) {
    const value = state.db[key];
    return typeof value === "function" ? value.bind(state.db) : value;
  },
}) }));

import savingsPlanRoutes from "./savings-plans";

const inputs = {
  years: 10,
  inflation: 3,
  pots: [
    { id: "cash", name: "Tabungan", start: 10_000_000, monthly: 1_000_000, raise: 0, returnRate: 2.5, uncertainty: "off" },
    { id: "sbn", name: "SBN", start: 0, monthly: 2_000_000, raise: 5, returnRate: 6.3, uncertainty: "low" },
  ],
  events: [{ id: "thr", label: "THR", month: 6, amount: 5_000_000, yearly: true, potId: "sbn" }],
  goals: [{ id: "house", name: "House down payment", amount: 150_000_000, byMonth: 60, potId: "sbn", spend: true }],
};

describe("savings plans", () => {
  let sqlite: InstanceType<typeof Database>;
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    sqlite = new Database(":memory:");
    sqlite.exec(`CREATE TABLE savings_plan (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      name text NOT NULL,
      inputs text NOT NULL,
      created_at integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
      updated_at integer DEFAULT (unixepoch('now') * 1000) NOT NULL
    )`);
    state.db = drizzle(sqlite, { schema });
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate("authenticate", async () => {});
    await app.register(savingsPlanRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    sqlite.close();
  });

  it("saves, lists, renames, re-saves and deletes a plan", async () => {
    const created = await app.inject({ method: "POST", url: "/api/savings-plans", payload: { name: "Steady", inputs } });
    expect(created.statusCode).toBe(201);
    const plan = created.json();
    expect(plan).toMatchObject({ name: "Steady", inputs });

    const renamed = await app.inject({ method: "PATCH", url: `/api/savings-plans/${plan.id}`, payload: { name: "Steady 2" } });
    expect(renamed.json()).toMatchObject({ name: "Steady 2", inputs });
    const resaved = await app.inject({ method: "PATCH", url: `/api/savings-plans/${plan.id}`, payload: { inputs: { ...inputs, years: 15 } } });
    expect(resaved.json().inputs.years).toBe(15);

    const listed = (await app.inject({ method: "GET", url: "/api/savings-plans" })).json();
    expect(listed.map((row: { name: string }) => row.name)).toEqual(["Steady 2"]);

    expect((await app.inject({ method: "DELETE", url: `/api/savings-plans/${plan.id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: `/api/savings-plans/${plan.id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "PATCH", url: `/api/savings-plans/${plan.id}`, payload: { name: "Gone" } })).statusCode).toBe(404);
  });

  it("rejects inputs outside the plan's shape", async () => {
    const bad = [
      { ...inputs, years: 0 },
      { ...inputs, pots: [] },
      { ...inputs, pots: [{ ...inputs.pots[0], uncertainty: "wild" }, inputs.pots[1]] },
      { ...inputs, pots: [{ ...inputs.pots[0], start: -1 }, inputs.pots[1]] },
      { ...inputs, pots: [inputs.pots[0], { ...inputs.pots[1], id: "cash" }] },
      { ...inputs, goals: [{ ...inputs.goals[0], potId: "nowhere" }] },
      { ...inputs, goals: [{ ...inputs.goals[0], amount: 0 }] },
      { ...inputs, extra: true },
    ];
    for (const payload of bad) {
      const response = await app.inject({ method: "POST", url: "/api/savings-plans", payload: { name: "Bad", inputs: payload } });
      expect(response.statusCode).toBe(400);
    }
    expect((await app.inject({ method: "POST", url: "/api/savings-plans", payload: { name: "  ", inputs } })).statusCode).toBe(400);
  });

  it("leaves out a stored plan that no longer parses", async () => {
    sqlite.prepare("INSERT INTO savings_plan (name, inputs) VALUES (?, ?)").run("Broken", "{not json");
    await app.inject({ method: "POST", url: "/api/savings-plans", payload: { name: "Fine", inputs } });
    const listed = (await app.inject({ method: "GET", url: "/api/savings-plans" })).json();
    expect(listed.map((row: { name: string }) => row.name)).toEqual(["Fine"]);
  });
});
