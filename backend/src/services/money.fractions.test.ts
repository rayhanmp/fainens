import { describe, expect, it } from "vitest";

import { parseIdrInteger } from "./money";

describe("IDR parsing of separators and fractions", () => {
  it.each([
    ["1,234,567", 1_234_567],
    ["Rp1.234", 1_234],
    ["Rp654.500,00", 654_500],
    ["IDR 654,500.00", 654_500],
    ["1.234,00", 1_234],
    ["1,234.00", 1_234],
  ])("parses %s as integer rupiah", (input, expected) => {
    expect(parseIdrInteger(input)).toBe(expected);
  });

  // Ambiguous or fractional values must be rejected, never glued into a
  // larger amount ("1.234,5" used to become 12345, "10.5" became 105).
  it.each(["1.234,5", "10.5", "1.2345", "12,34", "1.234.56", "1,234.567", "12.34.567"])("rejects %s", (input) => {
    expect(parseIdrInteger(input)).toBeNull();
  });
});
