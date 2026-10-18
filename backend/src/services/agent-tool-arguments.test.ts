import { describe, expect, it } from "vitest";

import { parseToolArgumentsLeniently } from "./agent-tool-arguments";

describe("lenient tool arguments", () => {
  it("passes valid objects through untouched", () => {
    expect(parseToolArgumentsLeniently('{"name":"get_period_summary","arguments":{"periodId":3}}'))
      .toEqual({ ok: true, value: { name: "get_period_summary", arguments: { periodId: 3 } }, repaired: false });
    expect(parseToolArgumentsLeniently("")).toEqual({ ok: true, value: {}, repaired: false });
    expect(parseToolArgumentsLeniently(undefined)).toEqual({ ok: true, value: {}, repaired: false });
  });

  it("repairs fences, double encoding and trailing commas", () => {
    expect(parseToolArgumentsLeniently('```json\n{"title":"Spend"}\n```')).toMatchObject({ ok: true, value: { title: "Spend" }, repaired: true });
    expect(parseToolArgumentsLeniently(JSON.stringify(JSON.stringify({ a: 1 })))).toMatchObject({ ok: true, value: { a: 1 }, repaired: true });
    expect(parseToolArgumentsLeniently('{"items":[{"label":"A","value":1},],}')).toMatchObject({ ok: true, value: { items: [{ label: "A", value: 1 }] } });
    expect(parseToolArgumentsLeniently('Sure: {"a": 1} hope that helps')).toMatchObject({ ok: true, value: { a: 1 } });
  });

  it("closes output that was cut off", () => {
    expect(parseToolArgumentsLeniently('{"title":"Spend","items":[{"label":"Food","value":12')).toMatchObject({ ok: true, value: { title: "Spend", items: [{ label: "Food", value: 12 }] } });
    expect(parseToolArgumentsLeniently('{"title":"Unfinished')).toMatchObject({ ok: true, value: { title: "Unfinished" } });
  });

  it("does not treat commas inside strings as trailing", () => {
    expect(parseToolArgumentsLeniently('{"note":"a, ]","x":[1,]}')).toMatchObject({ ok: true, value: { note: "a, ]", x: [1] } });
  });

  it("explains what to resend when it cannot repair", () => {
    const array = parseToolArgumentsLeniently("[1,2]");
    expect(array).toMatchObject({ ok: false });
    expect(array.ok ? "" : array.message).toMatch(/not an array/);
    expect(parseToolArgumentsLeniently("call get_period_summary")).toMatchObject({ ok: false });
    expect(parseToolArgumentsLeniently("{'single': 'quotes'}")).toMatchObject({ ok: false });
  });
});
