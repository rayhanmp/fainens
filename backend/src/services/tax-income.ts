import { eq, inArray } from "drizzle-orm";

import { db } from "../db/client";
import { auditLogs, transactions } from "../db/schema";
import { getFinancialFacts } from "./financial-facts";

/**
 * How an income entry counts on the annual tax return. "taxable" adds to PKP and is what an
 * unmarked entry is; "final" was taxed at source (bank interest); "exempt" is not a tax object
 * (a gift from parents, a refund).
 */
export const TAX_TREATMENTS = ["taxable", "final", "exempt"] as const;
export type TaxTreatment = (typeof TAX_TREATMENTS)[number];

export class TaxIncomeError extends Error {
  constructor(message: string, readonly statusCode: 400 | 404) {
    super(message);
  }
}

export interface TaxYearIncomeRow {
  id: number;
  date: number;
  description: string;
  txType: string;
  incomeCents: number;
  taxTreatment: TaxTreatment;
  /** False while the entry still counts as taxable only because nobody marked it. */
  marked: boolean;
}

/** Every income entry in a calendar year, with how it counts on the return. */
export async function listTaxYearIncome(year: number): Promise<TaxYearIncomeRow[]> {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new TaxIncomeError("year must be a calendar year", 400);
  const facts = await getFinancialFacts({ startMs: new Date(year, 0, 1).getTime(), endMs: new Date(year + 1, 0, 1).getTime() - 1 });
  const income = facts.rows.filter((row) => row.status === "posted" && row.incomeCents > 0);
  if (income.length === 0) return [];
  const marks = new Map((await db.select({ id: transactions.id, taxTreatment: transactions.taxTreatment }).from(transactions)
    .where(inArray(transactions.id, income.map((row) => row.id)))).map((row) => [row.id, row.taxTreatment]));
  return income.map((row) => {
    const mark = marks.get(row.id);
    const valid = (TAX_TREATMENTS as readonly string[]).includes(mark ?? "");
    return {
      id: row.id,
      date: row.date,
      description: row.description,
      txType: row.txType,
      incomeCents: row.incomeCents,
      taxTreatment: valid ? (mark as TaxTreatment) : "taxable",
      marked: valid,
    };
  });
}

/**
 * Mark how an income entry counts for tax, or clear the mark (null) to treat it as taxable again.
 * The mark is reporting metadata: balances and the ledger are unaffected, so posted entries in
 * closed periods can be marked too.
 */
export async function setTaxTreatment(transactionId: number, taxTreatment: TaxTreatment | null): Promise<{ id: number; taxTreatment: TaxTreatment | null }> {
  if (taxTreatment != null && !(TAX_TREATMENTS as readonly string[]).includes(taxTreatment)) {
    throw new TaxIncomeError(`taxTreatment must be one of ${TAX_TREATMENTS.join(", ")} or null`, 400);
  }
  const [current] = await db.select().from(transactions).where(eq(transactions.id, transactionId)).limit(1);
  if (!current) throw new TaxIncomeError("Transaction not found", 404);
  if ((current.taxTreatment ?? null) === taxTreatment) return { id: current.id, taxTreatment };
  db.transaction((tx) => {
    tx.update(transactions).set({ taxTreatment }).where(eq(transactions.id, transactionId)).run();
    tx.insert(auditLogs).values({
      entityType: "transaction",
      entityId: transactionId,
      action: "update",
      beforeSnapshot: Buffer.from(JSON.stringify({ id: current.id, taxTreatment: current.taxTreatment ?? null })),
      afterSnapshot: Buffer.from(JSON.stringify({ id: current.id, taxTreatment })),
    }).run();
  });
  return { id: transactionId, taxTreatment };
}
