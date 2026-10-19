import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { listTaxYearIncome, setTaxTreatment, TAX_TREATMENTS, TaxIncomeError, type TaxTreatment } from "../services/tax-income";

const errorSchema = z.object({ error: z.string() }).passthrough();
const treatmentSchema = z.enum(TAX_TREATMENTS);
const rowSchema = z.object({
  id: z.number().int(),
  date: z.number(),
  description: z.string(),
  txType: z.string(),
  incomeCents: z.number().int(),
  taxTreatment: treatmentSchema,
  marked: z.boolean(),
}).passthrough();

function fail(error: unknown): { status: 400 | 404 | 500; message: string } {
  if (error instanceof TaxIncomeError) return { status: error.statusCode, message: error.message };
  return { status: 500, message: error instanceof Error ? error.message : "Unexpected error" };
}

/** Which income counts toward the annual tax return, entry by entry. */
export default async function taxIncomeRoutes(fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/tax-income", {
    schema: { operationId: "listTaxYearIncome", tags: ["tax"], querystring: z.object({ year: z.coerce.number().int() }), response: { 200: z.object({ year: z.number().int(), rows: z.array(rowSchema) }).passthrough(), 400: errorSchema, 404: errorSchema, 500: errorSchema } },
  }, async (request, reply) => {
    const { year } = request.query as { year: number };
    try {
      return { year, rows: await listTaxYearIncome(year) };
    } catch (error) {
      const { status, message } = fail(error);
      return reply.code(status).send({ error: message });
    }
  });

  fastify.patch("/api/transactions/:id/tax-treatment", {
    schema: { operationId: "setTransactionTaxTreatment", tags: ["tax"], params: z.object({ id: z.coerce.number().int().positive() }), body: z.object({ taxTreatment: treatmentSchema.nullable() }), response: { 200: z.object({ id: z.number().int(), taxTreatment: treatmentSchema.nullable() }).passthrough(), 400: errorSchema, 404: errorSchema, 500: errorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as { id: number };
    const { taxTreatment } = request.body as { taxTreatment: TaxTreatment | null };
    try {
      return await setTaxTreatment(id, taxTreatment);
    } catch (error) {
      const { status, message } = fail(error);
      return reply.code(status).send({ error: message });
    }
  });
}
