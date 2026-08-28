import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  recognizePaylaterPurchase,
  recordPaylaterInterest,
  settlePaylaterPayment,
  reversePaylaterTransaction,
  getPaylaterSummary,
  getPaylaterObligations,
} from "../services/paylater";

const paylaterErrorSchema = z.object({ error: z.string() }).passthrough();
const paylaterTransactionParamsSchema = z.object({ transactionId: z.coerce.number().int().positive() });
const paylaterIdParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const paylaterInstallmentMonthsSchema = z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]);
const paylaterInstallmentSchema = z.object({
  installmentNumber: z.number().int(), totalInstallments: z.number().int(), dueDate: z.number(), principalCents: z.number().int(), interestCents: z.number().int(), feeCents: z.number().int(), totalCents: z.number().int(),
}).passthrough();
const paylaterTransactionResponseSchema = z.object({ transactionId: z.number().int() }).passthrough();
const paylaterRecognitionResponseSchema = paylaterTransactionResponseSchema.extend({ installments: z.array(paylaterInstallmentSchema) }).passthrough();
const paylaterRecognizeBodySchema = z.object({
  date: z.number().int().optional(), description: z.string().trim().min(1), principalAmount: z.number().int().positive(), paylaterLiabilityAccountId: z.number().int().positive(), categoryId: z.number().int().positive().optional(), installmentMonths: paylaterInstallmentMonthsSchema, interestRatePercent: z.number().finite().optional(), adminFeeCents: z.number().int().nonnegative().optional(), firstDueDate: z.number().int().positive(), reference: z.string().max(500).optional(), notes: z.string().max(2000).optional(),
}).passthrough();
const paylaterScheduleBodySchema = z.object({ principalAmount: z.number().int().positive(), installmentMonths: paylaterInstallmentMonthsSchema, interestRatePercent: z.number().finite().optional(), adminFeeCents: z.number().int().nonnegative().optional(), firstDueDate: z.number().int().positive() }).passthrough();
const paylaterInterestBodySchema = z.object({ date: z.number().int().optional(), description: z.string().trim().min(1), interestAmount: z.number().int().positive(), interestExpenseAccountId: z.number().int().positive(), paylaterLiabilityAccountId: z.number().int().positive(), originalTxId: z.number().int().positive().optional(), reference: z.string().max(500).optional(), notes: z.string().max(2000).optional(), dueDate: z.number().int().positive().nullable().optional() }).passthrough();
const paylaterSettleBodySchema = z.object({ date: z.number().int().optional(), description: z.string().trim().min(1), paymentAmount: z.number().int().positive(), paylaterLiabilityAccountId: z.number().int().positive(), bankAccountId: z.number().int().positive(), originalTxId: z.number().int().positive().optional(), installmentIds: z.array(z.number().int().positive()).max(100).optional(), reference: z.string().max(500).optional(), notes: z.string().max(2000).optional() }).passthrough();
const paylaterReverseBodySchema = z.object({ reason: z.string().trim().max(1000).optional() }).passthrough();
const paylaterSummarySchema = z.object({ totalOutstanding: z.number(), paylaterAccounts: z.array(z.object({ accountId: z.number().int(), accountName: z.string(), balance: z.number() }).passthrough()) }).passthrough();
const paylaterObligationSchema = z.object({
  recognitionTxId: z.number().int(), description: z.string(), dateRecognizedMs: z.number(), liabilityAccountId: z.number().int(), liabilityAccountName: z.string(), principalCents: z.number().int(), interestPostedCents: z.number().int(), paymentsPostedCents: z.number().int(), outstandingCents: z.number().int(), dueDateMs: z.number().nullable(), status: z.enum(["paid", "overdue", "due_soon", "current"]), daysUntilDue: z.number().nullable(),
}).passthrough();
const paylaterObligationsSchema = z.object({ obligations: z.array(paylaterObligationSchema), scheduleItems: z.array(z.object({ dateMs: z.number(), kind: z.string(), recognitionTxId: z.number().int(), transactionId: z.number().int(), description: z.string(), amountCents: z.number().int(), liabilityAccountId: z.number().int(), liabilityAccountName: z.string() }).passthrough()), providerExposure: z.array(z.object({ liabilityAccountId: z.number().int(), liabilityAccountName: z.string(), totalOutstandingCents: z.number().int(), nextDueDateMs: z.number().nullable(), daysUntilNextDue: z.number().nullable() }).passthrough()), totalOutstandingCents: z.number().int() }).passthrough();

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.post("/api/paylater/recognize", {
    schema: { operationId: "recognizePaylaterPurchase", tags: ["paylater"], body: paylaterRecognizeBodySchema, response: { 200: paylaterRecognitionResponseSchema, 400: paylaterErrorSchema } },
  }, async (request, reply) => {
    try {
      const body = request.body as {
        date: number;
        description: string;
        principalAmount: number;
        paylaterLiabilityAccountId: number;
        categoryId?: number;
        installmentMonths: 1 | 3 | 6 | 12;
        interestRatePercent?: number;
        adminFeeCents?: number;
        firstDueDate: number;
        reference?: string;
        notes?: string;
      };

      // Validate required fields
      if (!body.installmentMonths || ![1, 3, 6, 12].includes(body.installmentMonths)) {
        reply.code(400).send({ error: "installmentMonths must be 1, 3, 6, or 12" });
        return;
      }

      if (!body.firstDueDate) {
        reply.code(400).send({ error: "firstDueDate is required" });
        return;
      }

      const result = await recognizePaylaterPurchase({
        date: body.date || Date.now(),
        description: body.description,
        principalAmount: body.principalAmount,
        paylaterLiabilityAccountId: body.paylaterLiabilityAccountId,
        categoryId: body.categoryId,
        installmentMonths: body.installmentMonths,
        interestRatePercent: body.interestRatePercent ?? 0,
        adminFeeCents: body.adminFeeCents ?? 0,
        firstDueDate: body.firstDueDate,
        reference: body.reference,
        notes: body.notes,
      });

      return result;
    } catch (err) {
      reply.code(400).send({ error: "Failed to recognize paylater purchase" });
    }
  });

  // New endpoint: Calculate installment schedule (preview)
  fastify.post("/api/paylater/calculate-schedule", {
    schema: { operationId: "calculatePaylaterSchedule", tags: ["paylater"], body: paylaterScheduleBodySchema, response: { 200: z.object({ installments: z.array(paylaterInstallmentSchema) }).passthrough(), 400: paylaterErrorSchema } },
  }, async (request, reply) => {
    try {
      const body = request.body as {
        principalAmount: number;
        installmentMonths: 1 | 3 | 6 | 12;
        interestRatePercent?: number;
        adminFeeCents?: number;
        firstDueDate: number;
      };

      if (!body.installmentMonths || ![1, 3, 6, 12].includes(body.installmentMonths)) {
        reply.code(400).send({ error: "installmentMonths must be 1, 3, 6, or 12" });
        return;
      }

      const { calculateInstallmentSchedule } = await import("../services/paylater");
      const schedule = calculateInstallmentSchedule({
        principalCents: body.principalAmount,
        months: body.installmentMonths,
        annualInterestRatePercent: body.interestRatePercent ?? 0,
        adminFeeCents: body.adminFeeCents ?? 0,
        firstDueDateMs: body.firstDueDate,
      });

      return { installments: schedule };
    } catch (err) {
      reply.code(400).send({ error: "Failed to calculate schedule" });
    }
  });

  fastify.post("/api/paylater/interest", {
    schema: { operationId: "recordPaylaterInterest", tags: ["paylater"], body: paylaterInterestBodySchema, response: { 200: paylaterTransactionResponseSchema, 400: paylaterErrorSchema } },
  }, async (request, reply) => {
    try {
      const body = request.body as {
        date: number;
        description: string;
        interestAmount: number;
        interestExpenseAccountId: number;
        paylaterLiabilityAccountId: number;
        originalTxId?: number;
        reference?: string;
        notes?: string;
        dueDate?: number | null;
      };

      const result = await recordPaylaterInterest({
        date: body.date || Date.now(),
        description: body.description,
        interestAmount: body.interestAmount,
        interestExpenseAccountId: body.interestExpenseAccountId,
        paylaterLiabilityAccountId: body.paylaterLiabilityAccountId,
        originalTxId: body.originalTxId,
        reference: body.reference,
        notes: body.notes,
        dueDate: body.dueDate,
      });

      return result;
    } catch (err) {
      reply.code(400).send({ error: "Failed to record interest" });
    }
  });

  fastify.post("/api/paylater/settle", {
    schema: { operationId: "settlePaylaterPayment", tags: ["paylater"], body: paylaterSettleBodySchema, response: { 200: paylaterTransactionResponseSchema, 400: paylaterErrorSchema } },
  }, async (request, reply) => {
    try {
      const body = request.body as {
        date: number;
        description: string;
        paymentAmount: number;
        paylaterLiabilityAccountId: number;
        bankAccountId: number;
        originalTxId?: number;
        installmentIds?: number[];
        reference?: string;
        notes?: string;
      };

      const result = await settlePaylaterPayment({
        date: body.date || Date.now(),
        description: body.description,
        paymentAmount: body.paymentAmount,
        paylaterLiabilityAccountId: body.paylaterLiabilityAccountId,
        bankAccountId: body.bankAccountId,
        originalTxId: body.originalTxId,
        installmentIds: body.installmentIds,
        reference: body.reference,
        notes: body.notes,
      });

      return result;
    } catch (err) {
      reply.code(400).send({ error: "Failed to settle paylater" });
    }
  });

  fastify.post("/api/paylater/:transactionId/reverse", {
    schema: { operationId: "reversePaylaterTransaction", tags: ["paylater"], params: paylaterTransactionParamsSchema, body: paylaterReverseBodySchema, response: { 201: z.object({ reversalTransactionId: z.number().int() }).passthrough(), 409: paylaterErrorSchema } },
  }, async (request, reply) => {
    const transactionId = Number((request.params as { transactionId?: string }).transactionId);
    const reason = String((request.body as { reason?: unknown } | undefined)?.reason ?? "").trim();
    try {
      const result = await reversePaylaterTransaction({ transactionId, reason });
      return reply.code(201).send(result);
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "Failed to reverse PayLater transaction" });
    }
  });

  fastify.get("/api/paylater/summary", {
    schema: { operationId: "getPaylaterSummary", tags: ["paylater"], response: { 200: paylaterSummarySchema } },
  }, async () => {
    return await getPaylaterSummary();
  });

  fastify.get("/api/paylater/obligations", {
    schema: { operationId: "getPaylaterObligations", tags: ["paylater"], response: { 200: paylaterObligationsSchema } },
  }, async () => {
    return await getPaylaterObligations();
  });
}
