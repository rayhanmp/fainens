import { z } from "zod";

import type { ModelEvidence } from "./agent-evidence";
import { parseAgentPresentation, type AgentPresentation, type PresentationActions, type PresentationProvenance } from "./agent-presentations";

/*
 * The chart component library the model renders from. Each chart tool is defined once here: the zod input schema
 * validates the call and also produces the JSON schema the provider sees, so the two can never drift.
 *
 * Charts bind to evidence instead of retyping numbers. A call may pass `source` — a retained evidence ID plus the
 * fields to read — and the backend fills in the values from that evidence. Literal values are still accepted for
 * derived figures, but bound values always win.
 *
 * Validation is lenient where it is safe: rows with a missing label or a non-numeric value are dropped, numeric
 * strings are coerced, and long lists are trimmed, so one bad row no longer rejects the whole card.
 */

export type EvidenceLookup = (evidenceId: string) => ModelEvidence | undefined;

const unit = z.enum(["IDR", "number", "percent", "months"]);
const tone = z.enum(["positive", "negative", "neutral"]);
const title = z.string().trim().min(1).max(120);
const label = z.string().trim().min(1).max(120);
const fieldPath = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/);

const source = z.strictObject({
  evidenceId: z.string().trim().min(1).max(80).describe("An evidenceId returned by a read tool in this run."),
  rows: fieldPath.optional().describe("Dot path to an array inside the evidence data, for list charts (for example \"rows\" or \"byCategory\")."),
  fields: z.record(z.string(), fieldPath).describe("Map from chart field to evidence field. With rows, paths are relative to each row (for example {\"label\": \"category\", \"value\": \"spentCents\"}); without rows, relative to the evidence data (for example {\"value\": \"totals.spentCents\"})."),
  sort: z.enum(["desc", "asc", "none"]).optional().describe("Sort list rows by value. Defaults to desc for breakdowns and none for trends."),
  limit: z.number().int().min(1).max(24).optional(),
});

const followUps = z.array(z.string().trim().min(2).max(140)).max(2).optional()
  .describe("Up to two short follow-up questions the user can tap, phrased as the user would ask them.");

const labeledValue = z.object({ label: z.unknown(), value: z.unknown() });
const comparisonRow = z.object({ label: z.unknown(), current: z.unknown(), previous: z.unknown() });

type ChartTool = {
  name: "show_metric" | "show_breakdown" | "show_comparison" | "show_trend" | "show_budget_progress" | "show_cash_flow";
  summary: string;
  input: z.ZodType;
};

export const chartTools: ChartTool[] = [
  {
    name: "show_metric",
    summary: "Show one important metric. Bind value to evidence with source.fields.value.",
    input: z.strictObject({ title, unit: unit.optional(), value: z.number().optional(), subtitle: z.string().trim().max(240).optional(), tone: tone.optional(), source: source.optional(), followUps }),
  },
  {
    name: "show_breakdown",
    summary: "Show a category or item breakdown as a donut or ranked bars. Bind rows with source.rows and fields {label, value}.",
    input: z.strictObject({ title, unit: unit.optional(), style: z.enum(["donut", "ranked_bar"]).optional(), items: z.array(labeledValue).max(24).optional(), source: source.optional(), followUps }),
  },
  {
    name: "show_comparison",
    summary: "Show current versus previous values. Bind rows with source.rows and fields {label, current, previous}.",
    input: z.strictObject({ title, unit: unit.optional(), currentLabel: label, previousLabel: label, items: z.array(comparisonRow).max(24).optional(), source: source.optional(), followUps }),
  },
  {
    name: "show_trend",
    summary: "Show a trend over time. Bind rows with source.rows and fields {label, value}.",
    input: z.strictObject({ title, unit: unit.optional(), points: z.array(labeledValue).max(60).optional(), source: source.optional(), followUps }),
  },
  {
    name: "show_budget_progress",
    summary: "Show planned versus actual budget progress. Bind with source.fields {planned, actual}.",
    input: z.strictObject({ title, unit: unit.optional(), planned: z.number().optional(), actual: z.number().optional(), status: tone.optional(), source: source.optional(), followUps }),
  },
  {
    name: "show_cash_flow",
    summary: "Show income, spending and net cash flow; net is calculated by the backend. Bind with source.fields {income, spending}.",
    input: z.strictObject({ title, unit: unit.optional(), income: z.number().optional(), spending: z.number().optional(), periodLabel: z.string().trim().max(120).optional(), source: source.optional(), followUps }),
  },
];

export const chartToolNames = new Set(chartTools.map((tool) => tool.name));

/** The provider-facing JSON schema, derived from the zod input schema. */
export function chartToolJsonSchema(tool: ChartTool): Record<string, unknown> {
  const schema = z.toJSONSchema(tool.input, { target: "draft-7", io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

const LIST_LIMITS = { donut: 8, ranked_bar: 10, comparison: 8, sparkline: 24 } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const key of path.split(".")) {
    if (Array.isArray(current) && /^\d+$/.test(key)) current = current[Number(key)];
    else if (isRecord(current)) current = current[key];
    else return undefined;
  }
  return current;
}

/** A finite number, accepting numeric strings ("12.500" and "12,500" style separators are not guessed). */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "" && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value.trim());
  return null;
}

function toLabel(value: unknown): string | null {
  if (typeof value === "string") return value.trim() ? value.trim().slice(0, 120) : null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function sortRows<T extends { sortValue: number }>(rows: T[], order: "desc" | "asc" | "none"): T[] {
  if (order === "none") return rows;
  return [...rows].sort((left, right) => order === "desc" ? right.sortValue - left.sortValue : left.sortValue - right.sortValue);
}

/** Keep rows with a usable label and numbers; drop the rest. */
export function cleanLabeledRows(rows: unknown, limit: number, order: "desc" | "asc" | "none" = "none"): Array<{ label: string; value: number }> {
  if (!Array.isArray(rows)) return [];
  const cleaned = rows.flatMap((row) => {
    const value = isRecord(row) ? toNumber(row.value) : null;
    const name = isRecord(row) ? toLabel(row.label) : null;
    return value != null && name != null ? [{ label: name, value, sortValue: value }] : [];
  });
  return sortRows(cleaned, order).slice(0, limit).map(({ label: name, value }) => ({ label: name, value }));
}

export function cleanComparisonRows(rows: unknown, limit: number, order: "desc" | "asc" | "none" = "none"): Array<{ label: string; current: number; previous: number }> {
  if (!Array.isArray(rows)) return [];
  const cleaned = rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const name = toLabel(row.label);
    const current = toNumber(row.current);
    const previous = toNumber(row.previous);
    return name != null && current != null && previous != null ? [{ label: name, current, previous, sortValue: current }] : [];
  });
  return sortRows(cleaned, order).slice(0, limit).map(({ label: name, current, previous }) => ({ label: name, current, previous }));
}

export class ChartBindingError extends Error {}

type Source = z.infer<typeof source>;

/** The evidence tool's page in the app, so a bound card can offer "Open budget" and the like. */
export function openLinkForTool(toolName: string): PresentationActions["open"] {
  if (/budget|category_spending/.test(toolName)) return { href: "/budget", label: "Open budget" };
  if (/transaction|financial_facts|period_summary|spending/.test(toolName)) return { href: "/transactions", label: "Open transactions" };
  if (/account|net_worth|reconciliation|balance/.test(toolName)) return { href: "/accounts", label: "Open accounts" };
  if (/loan/.test(toolName)) return { href: "/loans", label: "Open loans" };
  if (/paylater/.test(toolName)) return { href: "/paylater", label: "Open PayLater" };
  if (/recurring|subscription/.test(toolName)) return { href: "/subscriptions", label: "Open subscriptions" };
  return undefined;
}

/** Read rows (or scalar fields) for a chart out of one evidence entry. */
function bindSource(tool: ChartTool["name"], input: Record<string, unknown>, binding: Source, lookup: EvidenceLookup | undefined): { values: Record<string, unknown>; evidence: ModelEvidence } {
  const evidence = lookup?.(binding.evidenceId);
  if (!evidence) throw new ChartBindingError(`Unknown evidenceId "${binding.evidenceId}". Use an evidenceId returned by a read tool in this run, or pass literal values.`);
  const listTarget = tool === "show_breakdown" || tool === "show_comparison" ? "items" : tool === "show_trend" ? "points" : null;
  if (binding.rows) {
    if (!listTarget) throw new ChartBindingError(`${tool} binds scalar fields; omit source.rows.`);
    const rows = readPath(evidence.data, binding.rows);
    if (!Array.isArray(rows)) throw new ChartBindingError(`source.rows "${binding.rows}" is not a list in evidence ${binding.evidenceId}.`);
    const mapped = rows.map((row) => Object.fromEntries(Object.entries(binding.fields).map(([target, path]) => [target, readPath(row, path)])));
    return { values: { [listTarget]: mapped }, evidence };
  }
  if (listTarget) throw new ChartBindingError(`${tool} needs source.rows to bind a list.`);
  const values: Record<string, unknown> = {};
  for (const [target, path] of Object.entries(binding.fields)) {
    const value = readPath(evidence.data, path);
    if (value === undefined) throw new ChartBindingError(`Field "${path}" was not found in evidence ${binding.evidenceId}.`);
    values[target] = toNumber(value) ?? value;
  }
  return { values, evidence };
}

function defaultUnit(binding: Source | undefined): "IDR" | "number" {
  if (!binding) return "IDR";
  return Object.values(binding.fields).some((path) => /cents$/i.test(path)) ? "IDR" : "number";
}

/**
 * Validate a chart call, resolve its evidence binding, clean its rows, and return the presentation the UI renders.
 * Throws ZodError or ChartBindingError with a message the model can act on.
 */
export function buildChartPresentation(name: string, rawInput: unknown, lookup?: EvidenceLookup): AgentPresentation {
  const tool = chartTools.find((candidate) => candidate.name === name);
  if (!tool) throw new ChartBindingError(`Unknown chart tool: ${name}`);
  const input = tool.input.parse(rawInput) as Record<string, unknown> & { source?: Source; followUps?: string[] };
  const bound = input.source ? bindSource(tool.name, input, input.source, lookup) : null;
  const merged: Record<string, unknown> = { ...input, ...(bound?.values ?? {}) };
  const order = input.source?.sort;
  const limitFor = (cap: number) => Math.min(cap, input.source?.limit ?? cap);
  const chartUnit = (input.unit as string | undefined) ?? defaultUnit(input.source);

  let chart: Record<string, unknown>;
  if (tool.name === "show_metric") {
    const value = toNumber(merged.value);
    if (value == null) throw new ChartBindingError("show_metric needs a numeric value or source.fields.value.");
    chart = { type: "metric", title: input.title, value, unit: chartUnit, subtitle: input.subtitle, tone: input.tone ?? "neutral" };
  } else if (tool.name === "show_breakdown") {
    const style = input.style === "donut" ? "donut" : "ranked_bar";
    const items = cleanLabeledRows(merged.items, limitFor(LIST_LIMITS[style]), order ?? "desc");
    const usable = style === "donut" ? items.filter((item) => item.value > 0) : items;
    if (usable.length === 0) throw new ChartBindingError("show_breakdown has no rows with a label and a numeric value.");
    chart = { type: style, title: input.title, unit: chartUnit, items: usable };
  } else if (tool.name === "show_comparison") {
    const items = cleanComparisonRows(merged.items, limitFor(LIST_LIMITS.comparison), order ?? "none");
    if (items.length === 0) throw new ChartBindingError("show_comparison has no rows with a label, current and previous value.");
    chart = { type: "comparison", title: input.title, unit: chartUnit, currentLabel: input.currentLabel, previousLabel: input.previousLabel, items };
  } else if (tool.name === "show_trend") {
    const points = cleanLabeledRows(merged.points, limitFor(LIST_LIMITS.sparkline), order ?? "none");
    if (points.length < 2) throw new ChartBindingError("show_trend needs at least two points with a label and a numeric value.");
    chart = { type: "sparkline", title: input.title, unit: chartUnit, points };
  } else if (tool.name === "show_budget_progress") {
    const planned = toNumber(merged.planned);
    const actual = toNumber(merged.actual);
    if (planned == null || actual == null) throw new ChartBindingError("show_budget_progress needs numeric planned and actual values.");
    const status = input.status ?? (actual > planned ? "negative" : "neutral");
    chart = { type: "budget_progress", title: input.title, unit: chartUnit, planned: Math.max(0, planned), actual: Math.max(0, actual), remaining: planned - actual, status };
  } else {
    const income = toNumber(merged.income);
    const spending = toNumber(merged.spending);
    if (income == null || spending == null) throw new ChartBindingError("show_cash_flow needs numeric income and spending values.");
    chart = { type: "cash_flow", title: input.title, unit: chartUnit, income, spending, net: income - spending, periodLabel: input.periodLabel };
  }

  const presentation = parseAgentPresentation("show_chart", chart);
  const provenance: PresentationProvenance | undefined = bound
    ? { evidenceId: bound.evidence.evidenceId, tool: bound.evidence.source, revision: bound.evidence.financialRevision }
    : undefined;
  const open = bound ? openLinkForTool(bound.evidence.source) : undefined;
  const actions: PresentationActions | undefined = open || input.followUps?.length
    ? { ...(open ? { open } : {}), ...(input.followUps?.length ? { followUps: input.followUps } : {}) }
    : undefined;
  return { ...presentation, ...(provenance ? { provenance } : {}), ...(actions ? { actions } : {}) };
}
