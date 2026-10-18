import { z } from "zod";


const unitSchema = z.enum(["IDR", "number", "percent", "months"]);
const toneSchema = z.enum(["positive", "negative", "neutral"]);
const titleSchema = z.string().trim().min(1).max(120);
const labelSchema = z.string().trim().min(1).max(120);
const finiteNumber = z.number().finite();
const nonNegativeNumber = finiteNumber.min(0);
const labeledValue = z.object({ label: labelSchema, value: finiteNumber }).strict();
const calculationOperation = z.enum(["add", "subtract", "multiply", "divide", "percent_change"]);

const chartSchema = z.discriminatedUnion("type", [
  // The OpenAI-compatible function schema must advertise every optional
  // chart field together. Strip irrelevant sibling fields at this boundary,
  // while retaining strict validation for the selected chart's required data.
  z.object({ type: z.literal("metric"), title: titleSchema, value: finiteNumber, unit: unitSchema, subtitle: z.string().trim().max(240).optional(), tone: toneSchema.default("neutral") }),
  z.object({ type: z.literal("ranked_bar"), title: titleSchema, unit: unitSchema, items: z.array(labeledValue).min(1).max(10) }),
  z.object({ type: z.literal("comparison"), title: titleSchema, unit: unitSchema, currentLabel: labelSchema, previousLabel: labelSchema, items: z.array(z.object({ label: labelSchema, current: finiteNumber, previous: finiteNumber }).strict()).min(1).max(8) }),
  z.object({ type: z.literal("sparkline"), title: titleSchema, unit: unitSchema, points: z.array(labeledValue).min(2).max(24) }),
  z.object({ type: z.literal("donut"), title: titleSchema, unit: unitSchema, items: z.array(z.object({ label: labelSchema, value: nonNegativeNumber }).strict()).min(1).max(8).refine((items) => items.some((item) => item.value > 0), "At least one donut value must be positive") }),
  z.object({ type: z.literal("budget_progress"), title: titleSchema, unit: unitSchema, planned: nonNegativeNumber, actual: nonNegativeNumber, remaining: finiteNumber.optional(), status: toneSchema.default("neutral") }),
  z.object({ type: z.literal("cash_flow"), title: titleSchema, unit: unitSchema, income: finiteNumber, spending: finiteNumber, net: finiteNumber, periodLabel: labelSchema.optional() }),
  z.object({ type: z.literal("activity_heatmap"), title: titleSchema, unit: unitSchema, cells: z.array(z.object({ label: labelSchema, value: nonNegativeNumber }).strict()).min(1).max(62) }),
]);

const scenarioSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("projection"), title: titleSchema, unit: unitSchema.default("IDR"), startingValue: finiteNumber, monthlyContribution: finiteNumber, monthlyGrowthRate: finiteNumber.min(-100).max(100), horizonMonths: z.number().int().min(3).max(120), target: finiteNumber.optional(), subtitle: z.string().trim().max(240).optional() }),
  z.object({ type: z.literal("runway_scenario"), title: titleSchema, unit: unitSchema.default("IDR"), cash: nonNegativeNumber, monthlyBurn: nonNegativeNumber, monthlyIncome: nonNegativeNumber, subtitle: z.string().trim().max(240).optional() }),
  z.object({ type: z.literal("calculation"), title: titleSchema, operation: calculationOperation, left: z.object({ label: labelSchema, value: finiteNumber, unit: unitSchema }).strict(), right: z.object({ label: labelSchema, value: finiteNumber, unit: unitSchema }).strict(), resultLabel: labelSchema, resultUnit: unitSchema }),
  z.object({ type: z.literal("scenario_compare"), title: titleSchema, scenarios: z.array(z.object({ label: labelSchema, description: z.string().trim().max(240).optional(), metrics: z.array(z.object({ label: labelSchema, value: finiteNumber, unit: unitSchema }).strict()).min(1).max(5) }).strict()).min(2).max(4) }),
  z.object({ type: z.literal("allocation_editor"), title: titleSchema, unit: unitSchema.default("IDR"), total: nonNegativeNumber, rows: z.array(z.object({ label: labelSchema, value: nonNegativeNumber, locked: z.boolean().default(false) }).strict()).min(1).max(10) }),
  z.object({ type: z.literal("time_series_explorer"), title: titleSchema, unit: unitSchema.default("IDR"), series: z.array(z.object({ label: labelSchema, points: z.array(labeledValue).min(2).max(90) }).strict()).min(1).max(4) }),
  z.object({ type: z.literal("goal_tracker"), title: titleSchema, unit: unitSchema.default("IDR"), current: nonNegativeNumber, target: finiteNumber.positive(), monthlyContribution: nonNegativeNumber, deadlineMonths: z.number().int().min(1).max(600).optional() }),
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

function allocateInteger(total: number, ids: string[], weights: Record<string, number>): Record<string, number> {
  const allocated = Object.fromEntries(ids.map((id) => [id, 0])) as Record<string, number>;
  if (total === 0 || ids.length === 0) return allocated;
  const sign = total < 0 ? -1 : 1;
  const absolute = Math.abs(total);
  const totalWeight = ids.reduce((sum, id) => sum + Math.max(0, weights[id] ?? 0), 0);
  const effectiveWeights = totalWeight > 0 ? weights : Object.fromEntries(ids.map((id) => [id, 1]));
  const effectiveTotal = totalWeight > 0 ? totalWeight : ids.length;
  const rows = ids.map((id, index) => {
    const exact = absolute * Math.max(0, effectiveWeights[id] ?? 0) / effectiveTotal;
    return { id, index, amount: Math.floor(exact), fraction: exact - Math.floor(exact) };
  });
  let remainder = absolute - rows.reduce((sum, row) => sum + row.amount, 0);
  rows.sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (const row of rows) {
    if (remainder <= 0) break;
    row.amount += 1;
    remainder -= 1;
  }
  for (const row of rows) allocated[row.id] = row.amount * sign;
  return allocated;
}

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
}).transform((value) => {
  const charges = { ...value.charges, tipRule: value.charges.tipRule ?? (value.payerId ? "payer" as const : "proportional" as const) };
  const participantIds = value.participants.map((participant) => participant.id);
  const participantNames = Object.fromEntries(value.participants.map((participant) => [participant.id, participant.name]));
  const subtotals = Object.fromEntries(participantIds.map((id) => [id, 0])) as Record<string, number>;
  let unassignedItems = 0;
  for (const item of value.items) {
    const assigned = item.participantIds.filter((id) => participantIds.includes(id));
    if (assigned.length === 0) {
      unassignedItems += item.amount;
      continue;
    }
    const allocation = allocateInteger(item.amount, assigned, Object.fromEntries(assigned.map((id) => [id, 1])));
    for (const id of assigned) subtotals[id] += allocation[id] ?? 0;
  }
  const eligible = participantIds.filter((id) => subtotals[id] > 0);
  const allocateCharge = (amount: number, rule: z.infer<typeof splitRule>) => {
    if (amount === 0) return Object.fromEntries(participantIds.map((id) => [id, 0])) as Record<string, number>;
    if (rule === "payer") return value.payerId && participantIds.includes(value.payerId)
      ? allocateInteger(amount, [value.payerId], { [value.payerId]: 1 })
      : Object.fromEntries(participantIds.map((id) => [id, 0])) as Record<string, number>;
    return allocateInteger(amount, eligible, rule === "equal" ? Object.fromEntries(eligible.map((id) => [id, 1])) : subtotals);
  };
  const tax = allocateCharge(charges.tax, charges.taxRule);
  const service = allocateCharge(charges.service, charges.serviceRule);
  const discount = allocateCharge(-charges.discount, charges.discountRule);
  const tip = allocateCharge(charges.tip, charges.tipRule);
  const totals = Object.fromEntries(participantIds.map((id) => [id,
    (subtotals[id] ?? 0) + (tax[id] ?? 0) + (service[id] ?? 0) + (discount[id] ?? 0) + (tip[id] ?? 0),
  ])) as Record<string, number>;
  const itemSubtotal = value.items.reduce((sum, item) => sum + item.amount, 0);
  const total = itemSubtotal + charges.tax + charges.service + charges.tip - charges.discount;
  const allocated = Object.values(totals).reduce((sum, amount) => sum + amount, 0);
  const settlements = value.payerId
    ? value.participants
      .filter((participant) => participant.id !== value.payerId && (totals[participant.id] ?? 0) > 0)
      .map((participant) => ({
        fromId: participant.id,
        fromName: participant.name,
        toId: value.payerId as string,
        toName: participantNames[value.payerId as string] ?? value.payerId,
        amount: totals[participant.id] ?? 0,
      }))
    : [];
  return {
    ...value,
    charges,
    calculation: {
      subtotals,
      tax,
      service,
      discount,
      tip,
      totals,
      itemSubtotal,
      total,
      allocated,
      unassignedItems,
      chargeNeedsPayer: [charges.taxRule, charges.serviceRule, charges.discountRule, charges.tipRule].includes("payer") && !value.payerId,
      settlements,
    },
  };
});

/** Where a chart's numbers came from: the evidence entry it was bound to. */
export type PresentationProvenance = { evidenceId: string; tool: string; revision: number };
/** What a card lets the user do next: open the matching app page, or ask a follow-up question. */
export type PresentationActions = { open?: { href: string; label: string }; followUps?: string[] };
type PresentationMeta = { provenance?: PresentationProvenance; actions?: PresentationActions };

export type AgentPresentation = (
  | z.infer<typeof chartSchema>
  | z.infer<typeof scenarioSchema>
  | z.infer<typeof worksheetSchema>
  | z.infer<typeof splitBillSchema>
) & PresentationMeta;

export function parseAgentPresentation(name: string, input: unknown): AgentPresentation {
  if (name === "show_chart") return chartSchema.parse(input);
  if (name === "show_scenario") return scenarioSchema.parse(input);
  if (name === "show_worksheet") return worksheetSchema.parse(input);
  if (name === "show_split_bill") return splitBillSchema.parse(input);
  throw new Error(`Unknown presentation tool: ${name}`);
}
