import { z } from "zod";

import type { AgentChatTool } from "./agent-llm";

const unitSchema = z.enum(["IDR", "number", "percent", "months"]);
const toneSchema = z.enum(["positive", "negative", "neutral"]);
const titleSchema = z.string().trim().min(1).max(120);
const labelSchema = z.string().trim().min(1).max(120);
const finiteNumber = z.number().finite();
const nonNegativeNumber = finiteNumber.min(0);
const labeledValue = z.object({ label: labelSchema, value: finiteNumber }).strict();
const calculationOperation = z.enum(["add", "subtract", "multiply", "divide", "percent_change"]);

const chartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("metric"), title: titleSchema, value: finiteNumber, unit: unitSchema, subtitle: z.string().trim().max(240).optional(), tone: toneSchema.default("neutral") }).strict(),
  z.object({ type: z.literal("ranked_bar"), title: titleSchema, unit: unitSchema, items: z.array(labeledValue).min(1).max(10) }).strict(),
  z.object({ type: z.literal("comparison"), title: titleSchema, unit: unitSchema, currentLabel: labelSchema, previousLabel: labelSchema, items: z.array(z.object({ label: labelSchema, current: finiteNumber, previous: finiteNumber }).strict()).min(1).max(8) }).strict(),
  z.object({ type: z.literal("sparkline"), title: titleSchema, unit: unitSchema, points: z.array(labeledValue).min(2).max(24) }).strict(),
  z.object({ type: z.literal("donut"), title: titleSchema, unit: unitSchema, items: z.array(z.object({ label: labelSchema, value: nonNegativeNumber }).strict()).min(1).max(8).refine((items) => items.some((item) => item.value > 0), "At least one donut value must be positive") }).strict(),
  z.object({ type: z.literal("budget_progress"), title: titleSchema, unit: unitSchema, planned: nonNegativeNumber, actual: nonNegativeNumber, remaining: finiteNumber.optional(), status: toneSchema.default("neutral") }).strict(),
  z.object({ type: z.literal("cash_flow"), title: titleSchema, unit: unitSchema, income: finiteNumber, spending: finiteNumber, net: finiteNumber, periodLabel: labelSchema.optional() }).strict(),
  z.object({ type: z.literal("activity_heatmap"), title: titleSchema, unit: unitSchema, cells: z.array(z.object({ label: labelSchema, value: nonNegativeNumber }).strict()).min(1).max(62) }).strict(),
]);

const scenarioSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("projection"), title: titleSchema, unit: unitSchema.default("IDR"), startingValue: finiteNumber, monthlyContribution: finiteNumber, monthlyGrowthRate: finiteNumber.min(-100).max(100), horizonMonths: z.number().int().min(3).max(120), target: finiteNumber.optional(), subtitle: z.string().trim().max(240).optional() }).strict(),
  z.object({ type: z.literal("runway_scenario"), title: titleSchema, unit: unitSchema.default("IDR"), cash: nonNegativeNumber, monthlyBurn: nonNegativeNumber, monthlyIncome: nonNegativeNumber, subtitle: z.string().trim().max(240).optional() }).strict(),
  z.object({ type: z.literal("calculation"), title: titleSchema, operation: calculationOperation, left: z.object({ label: labelSchema, value: finiteNumber, unit: unitSchema }).strict(), right: z.object({ label: labelSchema, value: finiteNumber, unit: unitSchema }).strict(), resultLabel: labelSchema, resultUnit: unitSchema }).strict(),
  z.object({ type: z.literal("scenario_compare"), title: titleSchema, scenarios: z.array(z.object({ label: labelSchema, description: z.string().trim().max(240).optional(), metrics: z.array(z.object({ label: labelSchema, value: finiteNumber, unit: unitSchema }).strict()).min(1).max(5) }).strict()).min(2).max(4) }).strict(),
  z.object({ type: z.literal("allocation_editor"), title: titleSchema, unit: unitSchema.default("IDR"), total: nonNegativeNumber, rows: z.array(z.object({ label: labelSchema, value: nonNegativeNumber, locked: z.boolean().default(false) }).strict()).min(1).max(10) }).strict(),
  z.object({ type: z.literal("time_series_explorer"), title: titleSchema, unit: unitSchema.default("IDR"), series: z.array(z.object({ label: labelSchema, points: z.array(labeledValue).min(2).max(90) }).strict()).min(1).max(4) }).strict(),
  z.object({ type: z.literal("goal_tracker"), title: titleSchema, unit: unitSchema.default("IDR"), current: nonNegativeNumber, target: finiteNumber.positive(), monthlyContribution: nonNegativeNumber, deadlineMonths: z.number().int().min(1).max(600).optional() }).strict(),
]);

const worksheetSchema = z.object({
  type: z.literal("worksheet"),
  title: titleSchema,
  inputColumns: z.array(z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/i), label: labelSchema, unit: unitSchema }).strict()).min(1).max(3),
  formulaColumns: z.array(z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/i), label: labelSchema, unit: unitSchema, operation: calculationOperation, left: z.string(), right: z.string() }).strict()).max(3),
  rows: z.array(z.object({ label: labelSchema, values: z.record(z.string(), finiteNumber) }).strict()).min(1).max(12),
}).strict().superRefine((value, context) => {
  const inputKeys = new Set(value.inputColumns.map((column) => column.key));
  const allKeys = new Set(inputKeys);
  for (const column of value.formulaColumns) {
    if (allKeys.has(column.key)) context.addIssue({ code: "custom", message: `Duplicate worksheet key: ${column.key}` });
    allKeys.add(column.key);
    if (!inputKeys.has(column.left) || !inputKeys.has(column.right)) context.addIssue({ code: "custom", message: `Formula ${column.key} must reference input columns` });
  }
  for (const row of value.rows) {
    for (const key of inputKeys) if (!(key in row.values)) context.addIssue({ code: "custom", message: `Row ${row.label} is missing ${key}` });
  }
});

const splitRule = z.enum(["proportional", "equal", "payer"]);
const splitBillSchema = z.object({
  type: z.literal("split_bill"),
  title: titleSchema,
  merchant: z.string().trim().max(160).optional(),
  date: z.string().trim().max(40).optional(),
  participants: z.array(z.object({ id: z.string().trim().min(1).max(60), name: labelSchema }).strict()).min(1).max(30),
  items: z.array(z.object({ id: z.string().trim().min(1).max(60), name: labelSchema, quantity: z.number().int().min(1).max(1_000), amount: z.number().int().min(0), participantIds: z.array(z.string().trim().min(1).max(60)).max(30) }).strict()).min(1).max(100),
  charges: z.object({
    tax: z.number().int().min(0).default(0),
    service: z.number().int().min(0).default(0),
    discount: z.number().int().min(0).default(0),
    tip: z.number().int().min(0).default(0),
    taxRule: splitRule.default("proportional"),
    serviceRule: splitRule.default("proportional"),
    discountRule: splitRule.default("proportional"),
    tipRule: splitRule.optional(),
  }).strict(),
  payerId: z.string().trim().min(1).max(60).optional(),
  note: z.string().trim().max(500).optional(),
}).strict().superRefine((value, context) => {
  const participantIds = new Set(value.participants.map((participant) => participant.id));
  if (participantIds.size !== value.participants.length) context.addIssue({ code: "custom", message: "Participant IDs must be unique" });
  if (value.payerId && !participantIds.has(value.payerId)) context.addIssue({ code: "custom", message: "payerId must identify a participant" });
  for (const item of value.items) {
    for (const id of item.participantIds) if (!participantIds.has(id)) context.addIssue({ code: "custom", message: `Unknown participant ${id} on ${item.name}` });
  }
}).transform((value) => ({
  ...value,
  charges: { ...value.charges, tipRule: value.charges.tipRule ?? (value.payerId ? "payer" as const : "proportional" as const) },
}));

export type AgentPresentation =
  | z.infer<typeof chartSchema>
  | z.infer<typeof scenarioSchema>
  | z.infer<typeof worksheetSchema>
  | z.infer<typeof splitBillSchema>;

const units = ["IDR", "number", "percent", "months"];
const itemSchema = { type: "object", additionalProperties: false, required: ["label", "value"], properties: { label: { type: "string", minLength: 1, maxLength: 120 }, value: { type: "number" } } };
const commonProperties = { type: { type: "string" }, title: { type: "string", minLength: 1, maxLength: 120 }, unit: { type: "string", enum: units } };

export const presentationTools: AgentChatTool[] = [
  {
    type: "function",
    function: {
      name: "show_chart",
      description: "Render one validated chart from retrieved facts or transparent calculations. Use only when it improves understanding; do not repeat its detailed values in prose.",
      parameters: {
        type: "object", additionalProperties: false, required: ["type", "title", "unit"],
        properties: {
          ...commonProperties,
          type: { type: "string", enum: ["metric", "ranked_bar", "comparison", "sparkline", "donut", "budget_progress", "cash_flow", "activity_heatmap"] },
          value: { type: "number" }, subtitle: { type: "string", maxLength: 240 }, tone: { type: "string", enum: ["positive", "negative", "neutral"] },
          items: { type: "array", minItems: 1, maxItems: 10, items: { type: "object", additionalProperties: false, required: ["label"], properties: { label: { type: "string", minLength: 1, maxLength: 120 }, value: { type: "number" }, current: { type: "number" }, previous: { type: "number" } } } },
          points: { type: "array", minItems: 2, maxItems: 24, items: itemSchema }, cells: { type: "array", minItems: 1, maxItems: 62, items: itemSchema },
          currentLabel: { type: "string", maxLength: 120 }, previousLabel: { type: "string", maxLength: 120 }, planned: { type: "number" }, actual: { type: "number" }, remaining: { type: "number" }, status: { type: "string", enum: ["positive", "negative", "neutral"] }, income: { type: "number" }, spending: { type: "number" }, net: { type: "number" }, periodLabel: { type: "string", maxLength: 120 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_scenario",
      description: "Render one editable what-if, calculation, comparison, allocation, series explorer, or goal tracker. It is a local scenario and never changes the ledger.",
      parameters: {
        type: "object", additionalProperties: false, required: ["type", "title"],
        properties: {
          ...commonProperties,
          type: { type: "string", enum: ["projection", "runway_scenario", "calculation", "scenario_compare", "allocation_editor", "time_series_explorer", "goal_tracker"] },
          subtitle: { type: "string", maxLength: 240 }, startingValue: { type: "number" }, monthlyContribution: { type: "number" }, monthlyGrowthRate: { type: "number", minimum: -100, maximum: 100 }, horizonMonths: { type: "integer", minimum: 3, maximum: 120 }, target: { type: "number" },
          cash: { type: "number", minimum: 0 }, monthlyBurn: { type: "number", minimum: 0 }, monthlyIncome: { type: "number", minimum: 0 },
          operation: { type: "string", enum: calculationOperation.options },
          left: { type: "object", additionalProperties: false, required: ["label", "value", "unit"], properties: { label: { type: "string" }, value: { type: "number" }, unit: { type: "string", enum: units } } },
          right: { type: "object", additionalProperties: false, required: ["label", "value", "unit"], properties: { label: { type: "string" }, value: { type: "number" }, unit: { type: "string", enum: units } } },
          resultLabel: { type: "string" }, resultUnit: { type: "string", enum: units }, total: { type: "number", minimum: 0 }, current: { type: "number", minimum: 0 }, deadlineMonths: { type: "integer", minimum: 1, maximum: 600 },
          rows: { type: "array", minItems: 1, maxItems: 10, items: { type: "object", additionalProperties: false, required: ["label", "value"], properties: { label: { type: "string" }, value: { type: "number", minimum: 0 }, locked: { type: "boolean" } } } },
          scenarios: { type: "array", minItems: 2, maxItems: 4, items: { type: "object", additionalProperties: false, required: ["label", "metrics"], properties: { label: { type: "string" }, description: { type: "string" }, metrics: { type: "array", minItems: 1, maxItems: 5, items: { type: "object", additionalProperties: false, required: ["label", "value", "unit"], properties: { label: { type: "string" }, value: { type: "number" }, unit: { type: "string", enum: units } } } } } } },
          series: { type: "array", minItems: 1, maxItems: 4, items: { type: "object", additionalProperties: false, required: ["label", "points"], properties: { label: { type: "string" }, points: { type: "array", minItems: 2, maxItems: 90, items: itemSchema } } } },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_worksheet",
      description: "Render a compact editable worksheet with 1-3 input columns, optional formulas that reference input columns, and up to 12 rows. Local edits never change ledger facts.",
      parameters: {
        type: "object", additionalProperties: false, required: ["type", "title", "inputColumns", "formulaColumns", "rows"],
        properties: {
          type: { type: "string", enum: ["worksheet"] }, title: { type: "string", minLength: 1, maxLength: 120 },
          inputColumns: { type: "array", minItems: 1, maxItems: 3, items: { type: "object", additionalProperties: false, required: ["key", "label", "unit"], properties: { key: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]{0,30}$" }, label: { type: "string", minLength: 1, maxLength: 120 }, unit: { type: "string", enum: units } } } },
          formulaColumns: { type: "array", maxItems: 3, items: { type: "object", additionalProperties: false, required: ["key", "label", "unit", "operation", "left", "right"], properties: { key: { type: "string" }, label: { type: "string" }, unit: { type: "string", enum: units }, operation: { type: "string", enum: calculationOperation.options }, left: { type: "string" }, right: { type: "string" } } } },
          rows: { type: "array", minItems: 1, maxItems: 12, items: { type: "object", additionalProperties: false, required: ["label", "values"], properties: { label: { type: "string", minLength: 1, maxLength: 120 }, values: { type: "object", additionalProperties: { type: "number" } } } } },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_split_bill",
      description: "Render an editable split calculation from supplied items or a receipt. Never creates transactions, loans, or debt. amount is the full line total; leave unread assignments empty. Default tax, service, and discount to proportional and tip to payer when known. Use participant ID 'me' with the preferred user name.",
      parameters: {
        type: "object", additionalProperties: false, required: ["type", "title", "participants", "items", "charges"],
        properties: {
          type: { type: "string", enum: ["split_bill"] }, title: { type: "string", minLength: 1, maxLength: 120 }, merchant: { type: "string", maxLength: 160 }, date: { type: "string", maxLength: 40 }, payerId: { type: "string", maxLength: 60 }, note: { type: "string", maxLength: 500 },
          participants: { type: "array", minItems: 1, maxItems: 30, items: { type: "object", additionalProperties: false, required: ["id", "name"], properties: { id: { type: "string", minLength: 1, maxLength: 60 }, name: { type: "string", minLength: 1, maxLength: 120 } } } },
          items: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", additionalProperties: false, required: ["id", "name", "quantity", "amount", "participantIds"], properties: { id: { type: "string", minLength: 1, maxLength: 60 }, name: { type: "string", minLength: 1, maxLength: 120 }, quantity: { type: "integer", minimum: 1 }, amount: { type: "integer", minimum: 0 }, participantIds: { type: "array", maxItems: 30, items: { type: "string" } } } } },
          charges: { type: "object", additionalProperties: false, required: ["tax", "service", "discount", "tip"], properties: { tax: { type: "integer", minimum: 0 }, service: { type: "integer", minimum: 0 }, discount: { type: "integer", minimum: 0 }, tip: { type: "integer", minimum: 0 }, taxRule: { type: "string", enum: splitRule.options }, serviceRule: { type: "string", enum: splitRule.options }, discountRule: { type: "string", enum: splitRule.options }, tipRule: { type: "string", enum: splitRule.options } } },
        },
      },
    },
  },
];

export const presentationToolNames = new Set(presentationTools.map((tool) => tool.function.name));

export function parseAgentPresentation(name: string, input: unknown): AgentPresentation {
  if (name === "show_chart") return chartSchema.parse(input);
  if (name === "show_scenario") return scenarioSchema.parse(input);
  if (name === "show_worksheet") return worksheetSchema.parse(input);
  if (name === "show_split_bill") return splitBillSchema.parse(input);
  throw new Error(`Unknown presentation tool: ${name}`);
}
