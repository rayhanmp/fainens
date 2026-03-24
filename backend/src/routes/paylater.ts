import type { FastifyInstance } from "fastify";

import {
  recognizePaylaterPurchase,
  recordPaylaterInterest,
  settlePaylaterPayment,
  getPaylaterSummary,
  getPaylaterObligations,
} from "../services/paylater";

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.post("/api/paylater/recognize", async (request, reply) => {
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
      reply.code(400).send({ error: (err as Error).message });
    }
  });

  // New endpoint: Calculate installment schedule (preview)
  fastify.post("/api/paylater/calculate-schedule", async (request, reply) => {
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
      reply.code(400).send({ error: (err as Error).message });
    }
  });

  fastify.post("/api/paylater/interest", async (request, reply) => {
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
      reply.code(400).send({ error: (err as Error).message });
    }
  });

  fastify.post("/api/paylater/settle", async (request, reply) => {
    try {
      const body = request.body as {
        date: number;
        description: string;
        paymentAmount: number;
        paylaterLiabilityAccountId: number;
        bankAccountId: number;
        originalTxId?: number;
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
        reference: body.reference,
        notes: body.notes,
      });

      return result;
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message });
    }
  });

  fastify.get("/api/paylater/summary", async () => {
    return await getPaylaterSummary();
  });

  fastify.get("/api/paylater/obligations", async () => {
    return await getPaylaterObligations();
  });
}
