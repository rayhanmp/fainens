import { describe, expect, it } from "vitest";

import { parseIdrInteger } from "./money";

describe("canonical IDR parsing", () => {
  it.each([
    ["Rp 100.000", 100_000],
    ["100,000", 100_000],
    ["100000", 100_000],
    ["1.234.567", 1_234_567],
    ["100,00", 100],
    ["-25.000", -25_000],
    ["(25.000)", -25_000],
  ])("parses %s as integer rupiah", (input, expected) => {
    expect(parseIdrInteger(input)).toBe(expected);
  });

  it.each(["", "Rp nope", "1.234,50", "12-34"])("rejects %s", (input) => {
    expect(parseIdrInteger(input)).toBeNull();
  });
});
