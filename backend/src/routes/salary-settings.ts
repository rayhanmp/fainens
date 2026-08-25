import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";

import { db } from "../db/client";
import { salarySettings, accounts } from "../db/schema";
import {
  estimatePayroll,
  PTKP_ANNUAL_IDR,
  PTKP_LABELS,
  type PayrollBreakdown,
  getTERCategory,
  type PayrollSettings,
} from "../services/indonesia-payroll";
import { correctSalaryOccurrence, postSalaryIfPayrollDay, previewSalaryPosting, previewSalaryCatchUp, skipSalaryOccurrence } from "../services/salary-posting";

const SINGLETON_ID = 1;

async function getOrCreateRow() {
  const [row] = await db.select().from(salarySettings).where(eq(salarySettings.id, SINGLETON_ID)).limit(1);
  if (row) return row;
  await db.insert(salarySettings).values({
    id: SINGLETON_ID,
    grossMonthly: 0,
    payrollDay: 25,
    ptkpCode: "TK0",
    depositAccountId: null,
    terCategory: "A",
    jkkRiskGrade: 24, // 0.24% as basis points
    jkmRate: 30, // 0.3% as basis points
    bpjsKesehatanActive: true,
    jpWageCap: 10_042_300,
    bpjsKesWageCap: 12_000_000,
    jhtWageCap: 12_000_000,
  });
  const [created] = await db.select().from(salarySettings).where(eq(salarySettings.id, SINGLETON_ID)).limit(1);
  return created;
}

function buildPayrollSettings(row: typeof salarySettings.$inferSelect): PayrollSettings {
  return {
    ptkpCode: row.ptkpCode,
    terCategory: (row.terCategory as "A" | "B" | "C") || getTERCategory(row.ptkpCode),
    jkkRiskGrade: row.jkkRiskGrade / 10000, // Convert basis points to decimal
    jkmRate: row.jkmRate / 10000, // Convert basis points to decimal
    bpjsKesehatanActive: row.bpjsKesehatanActive,
    jpWageCap: row.jpWageCap,
    bpjsKesWageCap: row.bpjsKesWageCap,
    jhtWageCap: row.jhtWageCap,
  };
}

async function buildResponse(row: typeof salarySettings.$inferSelect, computed: PayrollBreakdown) {
  // Fetch deposit account name if set
  let depositAccountName: string | null = null;
  if (row.depositAccountId) {
    const [account] = await db
      .select({ name: accounts.name })
      .from(accounts)
      .where(eq(accounts.id, row.depositAccountId))
      .limit(1);
    depositAccountName = account?.name ?? null;
  }

  return {
    settings: {
      grossMonthly: row.grossMonthly,
      payrollDay: row.payrollDay,
      ptkpCode: row.ptkpCode,
      depositAccountId: row.depositAccountId,
      depositAccountName,
      terCategory: row.terCategory,
      jkkRiskGrade: row.jkkRiskGrade,
      jkmRate: row.jkmRate,
      bpjsKesehatanActive: row.bpjsKesehatanActive,
      jpWageCap: row.jpWageCap,
      bpjsKesWageCap: row.bpjsKesWageCap,
      jhtWageCap: row.jhtWageCap,
    },
    ptkpOptions: Object.keys(PTKP_ANNUAL_IDR).map((code) => ({
      code,
      label: PTKP_LABELS[code] ?? code,
      annualPtkp: PTKP_ANNUAL_IDR[code],
      terCategory: getTERCategory(code),
    })),
    computed,
  };
}

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/salary-settings", async () => {
    const row = await getOrCreateRow();
    const settings = buildPayrollSettings(row);
    const computed = estimatePayroll(row.grossMonthly, row.ptkpCode, 1, settings);
    return buildResponse(row, computed);
  });

  fastify.get("/api/salary-settings/preview", async (request) => {
    const q = request.query as { 
      grossMonthly?: string; 
      ptkpCode?: string;
      month?: string;
      jkkRiskGrade?: string;
      jkmRate?: string;
      bpjsKesehatanActive?: string;
      jpWageCap?: string;
      bpjsKesWageCap?: string;
      jhtWageCap?: string;
    };
    
    const gross = Math.max(0, Math.floor(Number(q.grossMonthly ?? 0)));
    const code = q.ptkpCode && PTKP_ANNUAL_IDR[q.ptkpCode] ? q.ptkpCode : "TK0";
    const month = Math.min(12, Math.max(1, Math.floor(Number(q.month ?? 1))));
    
    const settings: Partial<PayrollSettings> = {
      ptkpCode: code,
      terCategory: getTERCategory(code),
    };
    
    if (q.jkkRiskGrade !== undefined) {
      settings.jkkRiskGrade = Number(q.jkkRiskGrade) / 10000;
    }
    if (q.jkmRate !== undefined) {
      settings.jkmRate = Number(q.jkmRate) / 10000;
    }
    if (q.bpjsKesehatanActive !== undefined) {
      settings.bpjsKesehatanActive = q.bpjsKesehatanActive === "true";
    }
    if (q.jpWageCap !== undefined) {
      settings.jpWageCap = Math.floor(Number(q.jpWageCap));
    }
    if (q.bpjsKesWageCap !== undefined) {
      settings.bpjsKesWageCap = Math.floor(Number(q.bpjsKesWageCap));
    }
    if (q.jhtWageCap !== undefined) {
      settings.jhtWageCap = Math.floor(Number(q.jhtWageCap));
    }
    
    const computed = estimatePayroll(gross, code, month, settings);
    return { computed, month };
  });

  fastify.get("/api/salary-settings/posting-preview", async () => {
    const preview = await previewSalaryPosting(db);
    return preview;
  });

  fastify.get("/api/salary-settings/catch-up-preview", async () => previewSalaryCatchUp());

  fastify.post("/api/salary-settings/post-salary", async (request, reply) => {
    const body = (request.body ?? {}) as { occurrenceDate?: number };
    if (body.occurrenceDate !== undefined && (!Number.isSafeInteger(body.occurrenceDate) || body.occurrenceDate < 0)) {
      reply.code(400).send({ error: "occurrenceDate must be a non-negative safe integer" });
      return;
    }
    const result = await postSalaryIfPayrollDay(db, true, body.occurrenceDate);
    if (result.posted) {
      return result;
    } else {
      reply.code(400).send({ error: result.message });
      return;
    }
  });

  fastify.post("/api/salary-settings/catch-up", async (request, reply) => {
    const body = request.body as { mode?: "post" | "skip"; occurrenceDates?: number[] };
    if (!body || !["post", "skip"].includes(body.mode ?? "") || !Array.isArray(body.occurrenceDates) || body.occurrenceDates.length === 0 || body.occurrenceDates.length > 120) {
      reply.code(400).send({ error: "mode and 1-120 occurrenceDates are required" });
      return;
    }
    const occurrenceDates = body.occurrenceDates.map(Number);
    if (occurrenceDates.some((date) => !Number.isSafeInteger(date) || date < 0)) {
      reply.code(400).send({ error: "occurrenceDates must contain non-negative safe integers" });
      return;
    }
    const results = [];
    for (const occurrenceDate of occurrenceDates) {
      results.push(body.mode === "skip"
        ? { occurrenceDate, ...(await skipSalaryOccurrence(occurrenceDate)) }
        : { occurrenceDate, ...(await postSalaryIfPayrollDay(db, true, occurrenceDate)) });
    }
    return { mode: body.mode, results };
  });

  fastify.post("/api/salary-settings/occurrences/:occurrenceDate/correct", async (request, reply) => {
    const occurrenceDate = Number((request.params as { occurrenceDate?: string }).occurrenceDate);
    const body = (request.body ?? {}) as {
      reason?: string;
      effectiveDate?: number;
      netAmount?: number;
      depositAccountId?: number;
    };
    try {
      const result = await correctSalaryOccurrence({
        occurrenceDate,
        reason: body.reason ?? "",
        effectiveDate: body.effectiveDate,
        netAmount: body.netAmount,
        depositAccountId: body.depositAccountId,
      });
      return reply.code(201).send(result);
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "Failed to correct salary occurrence" });
    }
  });

  fastify.put("/api/salary-settings", async (request, reply) => {
    const body = request.body as {
      grossMonthly?: number;
      payrollDay?: number;
      ptkpCode?: string;
      depositAccountId?: number | null;
      terCategory?: string;
      jkkRiskGrade?: number;
      jkmRate?: number;
      bpjsKesehatanActive?: boolean;
      jpWageCap?: number;
      bpjsKesWageCap?: number;
      jhtWageCap?: number;
    };

    const row = await getOrCreateRow();

    const grossMonthly =
      body.grossMonthly !== undefined
        ? Math.max(0, Math.floor(Number(body.grossMonthly)))
        : row.grossMonthly;

    let payrollDay =
      body.payrollDay !== undefined ? Math.floor(Number(body.payrollDay)) : row.payrollDay;
    if (payrollDay < 1) payrollDay = 1;
    if (payrollDay > 31) payrollDay = 31;

    const ptkpCode =
      body.ptkpCode !== undefined && PTKP_ANNUAL_IDR[body.ptkpCode]
        ? body.ptkpCode
        : row.ptkpCode;

    // Validate deposit account if provided
    let depositAccountId = row.depositAccountId;
    if (body.depositAccountId !== undefined) {
      if (body.depositAccountId === null) {
        depositAccountId = null;
      } else {
        const accountId = Number(body.depositAccountId);
        const [account] = await db
          .select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive })
          .from(accounts)
          .where(eq(accounts.id, accountId))
          .limit(1);
        
        if (!account) {
          reply.code(400).send({ error: "Deposit account not found" });
          return;
        }
        if (!account.isActive) {
          reply.code(400).send({ error: "Deposit account is not active" });
          return;
        }
        if (account.type !== "asset") {
          reply.code(400).send({ error: "Deposit account must be an asset (wallet) account" });
          return;
        }
        depositAccountId = accountId;
      }
    }

    // TER settings
    const terCategory = body.terCategory ?? row.terCategory ?? getTERCategory(ptkpCode);
    const jkkRiskGrade = body.jkkRiskGrade !== undefined 
      ? Math.max(0, Math.min(10000, Math.floor(Number(body.jkkRiskGrade))))
      : row.jkkRiskGrade;
    const jkmRate = body.jkmRate !== undefined
      ? Math.max(0, Math.min(10000, Math.floor(Number(body.jkmRate))))
      : row.jkmRate;
    const bpjsKesehatanActive = body.bpjsKesehatanActive !== undefined
      ? Boolean(body.bpjsKesehatanActive)
      : row.bpjsKesehatanActive;
    const jpWageCap = body.jpWageCap !== undefined
      ? Math.max(0, Math.floor(Number(body.jpWageCap)))
      : row.jpWageCap;
    const bpjsKesWageCap = body.bpjsKesWageCap !== undefined
      ? Math.max(0, Math.floor(Number(body.bpjsKesWageCap)))
      : row.bpjsKesWageCap;
    const jhtWageCap = body.jhtWageCap !== undefined
      ? Math.max(0, Math.floor(Number(body.jhtWageCap)))
      : row.jhtWageCap;

    await db
      .update(salarySettings)
      .set({
        grossMonthly,
        payrollDay,
        ptkpCode,
        depositAccountId,
        terCategory,
        jkkRiskGrade,
        jkmRate,
        bpjsKesehatanActive,
        jpWageCap,
        bpjsKesWageCap,
        jhtWageCap,
        updatedAt: new Date(),
      })
      .where(eq(salarySettings.id, SINGLETON_ID));

    const updated = await getOrCreateRow();
    const settings = buildPayrollSettings(updated);
    const computed = estimatePayroll(updated.grossMonthly, updated.ptkpCode, 1, settings);
    return buildResponse(updated, computed);
  });
}
