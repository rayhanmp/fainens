import { describe, expect, it } from "vitest";

import type { ModelEvidence } from "./agent-evidence";
import { ChartBindingError, buildChartPresentation, chartToolJsonSchema, chartTools, cleanLabeledRows, openLinkForTool, readPath, toNumber } from "./agent-chart-library";

const evidence: ModelEvidence = {
  evidenceId: "ev-budget",
  source: "get_budget_facts",
  financialRevision: 509,
  complete: true,
  data: {
    totals: { plannedCents: 3_064_510, spentCents: 737_870 },
    rows: [
      { category: "Utilities", spentCents: 160_000, plannedCents: 160_000 },
      { category: "Food & Dining", spentCents: 240_470, plannedCents: 500_000 },
      { category: "Fashion", spentCents: 273_829, plannedCents: 540_000 },
      { category: "Gifts", spentCents: "52500", plannedCents: 100_000 },
      { category: "", spentCents: 999 },
      { category: "Broken", spentCents: "n/a" },
    ],
  },
};
const lookup = (id: string) => (id === evidence.evidenceId ? evidence : undefined);

describe("chart library schemas", () => {
  it("derives a closed provider schema from each zod input", () => {
    for (const tool of chartTools) {
      const schema = chartToolJsonSchema(tool);
      expect(schema).not.toHaveProperty("$schema");
      expect(schema.type).toBe("object");
      expect(schema.additionalProperties).toBe(false);
      expect(Object.keys(schema.properties as object)).toEqual(expect.arrayContaining(["title", "source", "followUps"]));
      expect(schema.required).toEqual(expect.arrayContaining(["title"]));
    }
  });

  it("keeps backend-computed fields out of the input", () => {
    const cashFlow = chartTools.find((tool) => tool.name === "show_cash_flow")!;
    expect(chartToolJsonSchema(cashFlow).properties).not.toHaveProperty("net");
  });
});

describe("chart helpers", () => {
  it("reads dot paths and coerces numeric strings only", () => {
    expect(readPath(evidence.data, "totals.spentCents")).toBe(737_870);
    expect(readPath(evidence.data, "rows.1.category")).toBe("Food & Dining");
    expect(readPath(evidence.data, "missing.path")).toBeUndefined();
    expect(toNumber("52500")).toBe(52_500);
    expect(toNumber("12,500")).toBeNull();
    expect(toNumber(Number.NaN)).toBeNull();
  });

  it("drops unusable rows, sorts and trims", () => {
    const rows = cleanLabeledRows([{ label: "A", value: 1 }, { label: "", value: 5 }, { label: "B", value: "3" }, { label: "C", value: null }, { label: "D", value: 2 }], 2, "desc");
    expect(rows).toEqual([{ label: "B", value: 3 }, { label: "D", value: 2 }]);
  });

  it("maps evidence tools to app pages", () => {
    expect(openLinkForTool("get_budget_facts")).toEqual({ href: "/budget", label: "Open budget" });
    expect(openLinkForTool("search_transactions")?.href).toBe("/transactions");
    expect(openLinkForTool("get_currency_exchange_rate")).toBeUndefined();
  });
});

describe("evidence-bound charts", () => {
  it("fills a breakdown from evidence rows, dropping bad rows and sorting by value", () => {
    const presentation = buildChartPresentation("show_breakdown", {
      title: "Spent by category",
      source: { evidenceId: "ev-budget", rows: "rows", fields: { label: "category", value: "spentCents" } },
      followUps: ["Why is Fashion so high?"],
    }, lookup);
    expect(presentation).toMatchObject({
      type: "ranked_bar",
      unit: "IDR",
      items: [
        { label: "Fashion", value: 273_829 },
        { label: "Food & Dining", value: 240_470 },
        { label: "Utilities", value: 160_000 },
        { label: "Gifts", value: 52_500 },
      ],
      provenance: { evidenceId: "ev-budget", tool: "get_budget_facts", revision: 509 },
      actions: { open: { href: "/budget", label: "Open budget" }, followUps: ["Why is Fashion so high?"] },
    });
  });

  it("lets bound values override numbers the model typed", () => {
    const presentation = buildChartPresentation("show_metric", {
      title: "Spent so far",
      value: 1,
      source: { evidenceId: "ev-budget", fields: { value: "totals.spentCents" } },
    }, lookup);
    expect(presentation).toMatchObject({ type: "metric", value: 737_870, unit: "IDR", tone: "neutral" });
  });

  it("computes budget remaining and status from bound fields", () => {
    const presentation = buildChartPresentation("show_budget_progress", {
      title: "October budget",
      source: { evidenceId: "ev-budget", fields: { planned: "totals.plannedCents", actual: "totals.spentCents" } },
    }, lookup);
    expect(presentation).toMatchObject({ type: "budget_progress", planned: 3_064_510, actual: 737_870, remaining: 2_326_640, status: "neutral" });
  });

  it("respects a limit and keeps literal charts working without provenance", () => {
    const bound = buildChartPresentation("show_breakdown", {
      title: "Top two", style: "donut",
      source: { evidenceId: "ev-budget", rows: "rows", fields: { label: "category", value: "spentCents" }, limit: 2 },
    }, lookup);
    expect(bound).toMatchObject({ type: "donut", items: [{ label: "Fashion" }, { label: "Food & Dining" }] });
    const literal = buildChartPresentation("show_trend", { title: "Trend", unit: "number", points: [{ label: "Mon", value: 1 }, { label: "Tue", value: "2" }, { label: "Wed", value: "x" }] });
    expect(literal).toMatchObject({ type: "sparkline", points: [{ label: "Mon", value: 1 }, { label: "Tue", value: 2 }] });
    expect(literal).not.toHaveProperty("provenance");
    expect(literal).not.toHaveProperty("actions");
  });

  it("explains bad bindings in terms the model can fix", () => {
    expect(() => buildChartPresentation("show_breakdown", { title: "x", source: { evidenceId: "nope", rows: "rows", fields: { label: "category", value: "spentCents" } } }, lookup))
      .toThrow(/Unknown evidenceId "nope"/);
    expect(() => buildChartPresentation("show_breakdown", { title: "x", source: { evidenceId: "ev-budget", rows: "totals", fields: { label: "category", value: "spentCents" } } }, lookup))
      .toThrow(/not a list/);
    expect(() => buildChartPresentation("show_breakdown", { title: "x", source: { evidenceId: "ev-budget", fields: { value: "totals.spentCents" } } }, lookup))
      .toThrow(/needs source.rows/);
    expect(() => buildChartPresentation("show_metric", { title: "x", source: { evidenceId: "ev-budget", fields: { value: "totals.missing" } } }, lookup))
      .toThrow(ChartBindingError);
    expect(() => buildChartPresentation("show_trend", { title: "x", points: [{ label: "only", value: 1 }] })).toThrow(/at least two points/);
  });
});
