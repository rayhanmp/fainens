import { describe, expect, it, vi } from "vitest";

// The normalizer is pure; never reach the model provider or its settings store.
vi.mock("./openrouter", () => ({ callOpenRouter: vi.fn() }));
vi.mock("./agent-provider-config", () => ({ getAgentProviderConfig: vi.fn() }));

import { normalizeParsedTransaction } from "./transaction-parser";

describe("LLM transaction parse normalization", () => {
  it("keeps a transfer as a transfer", () => {
    const parsed = normalizeParsedTransaction({
      type: "transfer", amount: 1_000_000, description: "Transfer ke tabungan", category: "Others",
      fromAccount: "BCA", toAccount: "Tabungan", confidence: 0.9,
    }, "transfer 1jt ke tabungan");
    expect(parsed).toMatchObject({ type: "transfer", amount: 1_000_000, fromAccount: "BCA", toAccount: "Tabungan", confidence: 0.9 });
  });

  it("reports an unknown type or missing amount as a failed parse", () => {
    expect(normalizeParsedTransaction({ type: "unknown", amount: 0, confidence: 0 }, "halo").confidence).toBe(0);
    expect(normalizeParsedTransaction({ type: "expense", amount: 0, confidence: 0.7 }, "makan").confidence).toBe(0);
    expect(normalizeParsedTransaction({ type: "expense", description: "makan" }, "makan").confidence).toBe(0);
  });

  it("does not turn an explicit zero confidence into 0.5", () => {
    expect(normalizeParsedTransaction({ type: "expense", amount: 25_000, confidence: 0 }, "kopi").confidence).toBe(0);
    expect(normalizeParsedTransaction({ type: "expense", amount: 25_000 }, "kopi").confidence).toBe(0.5);
  });

  it("parses a formatted amount string without inflating it", () => {
    expect(normalizeParsedTransaction({ type: "expense", amount: "1.000.000", confidence: 0.8 }, "x").amount).toBe(1_000_000);
    expect(normalizeParsedTransaction({ type: "expense", amount: "10.5", confidence: 0.8 }, "x").confidence).toBe(0);
  });
});
