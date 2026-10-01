import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mocks = vi.hoisted(() => ({ client: null as any }));
vi.mock("../db/client", () => ({ db: { get $client() { return mocks.client; } } }));
import { getRecapHighlightSeenAt, markRecapHighlightSeen } from "./recap-highlight";

describe("per-period recap highlight visibility", () => {
  beforeEach(() => {
    mocks.client = new Database(":memory:");
    mocks.client.pragma("foreign_keys = ON");
    mocks.client.exec("CREATE TABLE salary_period (id integer PRIMARY KEY)");
    mocks.client.exec(readFileSync(resolve(__dirname, "../../drizzle/0046_recap_period_seen.sql"), "utf8"));
    mocks.client.prepare("INSERT INTO salary_period (id) VALUES (?), (?)").run(12, 13);
  });
  afterEach(() => mocks.client.close());

  it("remembers dismissal per owner and salary period without changing the first seen timestamp", () => {
    expect(getRecapHighlightSeenAt("owner@example.test", 12)).toBeNull();
    expect(markRecapHighlightSeen("owner@example.test", 12, 1000)).toBe(1000);
    expect(markRecapHighlightSeen("owner@example.test", 12, 2000)).toBe(1000);
    expect(getRecapHighlightSeenAt("owner@example.test", 12)).toBe(1000);
    expect(getRecapHighlightSeenAt("other@example.test", 12)).toBeNull();
    expect(getRecapHighlightSeenAt("owner@example.test", 13)).toBeNull();
  });

  it("does not create dismissal state for an unknown salary period", () => {
    expect(() => getRecapHighlightSeenAt("owner@example.test", 99)).toThrowError("This salary period does not exist");
    expect(() => markRecapHighlightSeen("owner@example.test", 99, 1000)).toThrowError("This salary period does not exist");
  });
});
