import { asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { savingsPlans } from "../db/schema";
import { db } from "../db/client";

/** The most a plan can hold or move: Rp10 trillion, far beyond any personal plan but still a safe integer. */
const MAX_AMOUNT = 10_000_000_000_000;
const MAX_MONTHS = 600;

const amount = z.number().int().min(0).max(MAX_AMOUNT);
const shortId = z.string().trim().min(1).max(40);

/** A pot of money with its own start, monthly saving, yearly raise (%), return (%) and uncertainty. */
const savingsPlanPotSchema = z.object({
  id: shortId,
  name: z.string().trim().min(1).max(80),
  start: amount,
  monthly: amount,
  raise: z.number().min(0).max(50),
  returnRate: z.number().min(-20).max(50),
  uncertainty: z.enum(["off", "low", "medium", "high"]),
}).strict();

/** One-off or yearly money in (positive) or out (negative) of a pot, counted from the plan's first month. */
const savingsPlanEventSchema = z.object({
  id: shortId,
  label: z.string().trim().max(80),
  month: z.number().int().min(1).max(MAX_MONTHS),
  amount: z.number().int().min(-MAX_AMOUNT).max(MAX_AMOUNT),
  yearly: z.boolean(),
  potId: shortId,
}).strict();

/**
 * Something to save for in today's rupiah, paid from a pot; `byMonth` is the month it's wanted
 * by, or null for "whenever"; `spend` goals leave the pot when bought; `saved` is what's set aside
 * for it today.
 */
const savingsPlanGoalSchema = z.object({
  id: shortId,
  name: z.string().trim().min(1).max(80),
  amount: amount.refine((value) => value > 0, "Goal amount must be above zero"),
  byMonth: z.number().int().min(1).max(MAX_MONTHS).nullable(),
  potId: shortId,
  spend: z.boolean(),
  /** Part of the pot's money today already set aside for this goal. */
  saved: amount.default(0),
}).strict();

export const savingsPlanInputsSchema = z.object({
  years: z.number().int().min(1).max(50),
  inflation: z.number().min(0).max(30),
  pots: z.array(savingsPlanPotSchema).min(1).max(6),
  events: z.array(savingsPlanEventSchema).max(20),
  goals: z.array(savingsPlanGoalSchema).max(20),
}).strict().superRefine((inputs, context) => {
  const pots = new Set(inputs.pots.map((pot) => pot.id));
  if (pots.size !== inputs.pots.length) context.addIssue({ code: "custom", message: "Pot ids must be unique", path: ["pots"] });
  for (const [key, items] of [["events", inputs.events], ["goals", inputs.goals]] as const) {
    items.forEach((item, index) => {
      if (!pots.has(item.potId)) context.addIssue({ code: "custom", message: "Unknown pot", path: [key, index, "potId"] });
    });
  }
});

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const errorSchema = z.object({ error: z.string() }).passthrough();
const bodySchema = z.object({ name: z.string().trim().min(1).max(80), inputs: savingsPlanInputsSchema }).strict();
const updateBodySchema = bodySchema.partial().strict();
const savingsPlanSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  inputs: savingsPlanInputsSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});

function view(row: typeof savingsPlans.$inferSelect): z.infer<typeof savingsPlanSchema> | null {
  try {
    const parsed = savingsPlanInputsSchema.safeParse(JSON.parse(row.inputs));
    if (!parsed.success) return null;
    return { id: row.id, name: row.name, inputs: parsed.data, createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() };
  } catch {
    return null;
  }
}

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/savings-plans", {
    schema: { operationId: "listSavingsPlans", tags: ["savings"], response: { 200: z.array(savingsPlanSchema) } },
  }, async () => {
    const rows = await db.select().from(savingsPlans).orderBy(asc(savingsPlans.createdAt), asc(savingsPlans.id));
    // A row that no longer matches the current shape is left out rather than breaking the page.
    return rows.map(view).filter((plan): plan is z.infer<typeof savingsPlanSchema> => plan !== null);
  });

  fastify.post("/api/savings-plans", {
    schema: { operationId: "createSavingsPlan", tags: ["savings"], body: bodySchema, response: { 201: savingsPlanSchema, 400: errorSchema } },
  }, async (request, reply) => {
    const body = request.body as z.infer<typeof bodySchema>;
    const [created] = await db.insert(savingsPlans).values({ name: body.name, inputs: JSON.stringify(body.inputs) }).returning();
    const plan = created ? view(created) : null;
    if (!plan) return reply.code(400).send({ error: "Could not save the plan" });
    return reply.code(201).send(plan);
  });

  fastify.patch("/api/savings-plans/:id", {
    schema: { operationId: "updateSavingsPlan", tags: ["savings"], params: idParamsSchema, body: updateBodySchema, response: { 200: savingsPlanSchema, 400: errorSchema, 404: errorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof idParamsSchema>;
    const body = request.body as z.infer<typeof updateBodySchema>;
    const updates: Partial<typeof savingsPlans.$inferInsert> = { updatedAt: new Date() };
    if (body.name !== undefined) updates.name = body.name;
    if (body.inputs !== undefined) updates.inputs = JSON.stringify(body.inputs);
    const [updated] = await db.update(savingsPlans).set(updates).where(eq(savingsPlans.id, id)).returning();
    if (!updated) return reply.code(404).send({ error: "Plan not found" });
    const plan = view(updated);
    if (!plan) return reply.code(400).send({ error: "Could not update the plan" });
    return plan;
  });

  fastify.delete("/api/savings-plans/:id", {
    schema: { operationId: "deleteSavingsPlan", tags: ["savings"], params: idParamsSchema, response: { 204: z.null(), 404: errorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof idParamsSchema>;
    const result = await db.delete(savingsPlans).where(eq(savingsPlans.id, id)).run();
    if (result.changes === 0) return reply.code(404).send({ error: "Plan not found" });
    return reply.code(204).send();
  });
}
