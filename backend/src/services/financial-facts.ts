import { sql } from "drizzle-orm";

import { db } from "../db/client";
import { assignedOrLegacyPeriodMembership } from "./period-locking";

const DAY_MS = 86_400_000;

export interface FinancialFactRow {
  id: number;
  date: number;
  description: string;
  categoryId: number | null;
  category: string | null;
  txType: string;
  expenseCents: number;
  incomeCents: number;
}

export interface FinancialFacts {
  startMs: number;
  endMs: number;
  asOfMs: number;
  rows: FinancialFactRow[];
  totalSpentCents: number;
  totalIncomeCents: number;
  walletBalanceCents: number;
  byCategory: Array<{ categoryId: number | null; category: string; spentCents: number }>;
}

/**
 * Canonical read model for narrative/reporting consumers. Amounts come from
 * account normal balances, never from a transaction's arbitrary line side:
 * expense = expense debits minus credits and income = revenue credits minus
 * debits, so refunds and reversals net correctly.
 */
export async function getFinancialFacts(input: {
  startMs: number;
  endMs: number;
  asOfMs?: number;
  periodId?: number;
}): Promise<FinancialFacts> {
  if (!Number.isFinite(input.startMs) || !Number.isFinite(input.endMs) || input.endMs < input.startMs) {
    throw new Error("Invalid financial facts date range");
  }
  const asOfMs = input.asOfMs ?? input.endMs;
  const rows = await db.all(sql`
    SELECT
      t.id,
      t.date,
      t.description,
      t.category_id AS category_id,
      c.name AS category,
      t.tx_type AS tx_type,
      COALESCE(SUM(CASE WHEN a.type = 'expense' THEN tl.debit - tl.credit ELSE 0 END), 0) AS expense_cents,
      COALESCE(SUM(CASE WHEN a.type = 'revenue' THEN tl.credit - tl.debit ELSE 0 END), 0) AS income_cents
    FROM "transaction" t
    LEFT JOIN "transaction_line" tl ON tl.transaction_id = t.id
    LEFT JOIN account a ON a.id = tl.account_id
    LEFT JOIN category c ON c.id = t.category_id
    WHERE t.date >= ${input.startMs}
      AND t.date <= ${input.endMs}
      AND t.date <= ${asOfMs}
      AND t.status <> 'draft'
      ${input.periodId == null ? sql`` : sql`AND ${assignedOrLegacyPeriodMembership(input.periodId, sql`t.period_id`)}`}
    GROUP BY t.id, t.date, t.description, t.category_id, c.name, t.tx_type
    ORDER BY t.date ASC, t.id ASC
  `) as unknown as Array<Record<string, unknown>>;

  const normalizedRows: FinancialFactRow[] = rows.map((row) => ({
    id: Number(row.id),
    date: Number(row.date),
    description: String(row.description ?? ""),
    categoryId: row.category_id == null ? null : Number(row.category_id),
    category: row.category == null ? null : String(row.category),
    txType: String(row.tx_type ?? "manual"),
    expenseCents: Number(row.expense_cents ?? 0),
    incomeCents: Number(row.income_cents ?? 0),
  }));

  const byCategoryMap = new Map<string, { categoryId: number | null; category: string; spentCents: number }>();
  for (const row of normalizedRows) {
    if (row.expenseCents <= 0) continue;
    const category = row.category ?? "Uncategorized";
    const key = `${row.categoryId ?? "null"}:${category}`;
    const current = byCategoryMap.get(key) ?? { categoryId: row.categoryId, category, spentCents: 0 };
    current.spentCents += row.expenseCents;
    byCategoryMap.set(key, current);
  }

  const walletResult = await db.all(sql`
    SELECT COALESCE(SUM(CASE WHEN a.type = 'asset' THEN tl.debit - tl.credit ELSE 0 END), 0) AS balance
    FROM "transaction_line" tl
    INNER JOIN "transaction" t ON t.id = tl.transaction_id
    INNER JOIN account a ON a.id = tl.account_id
    WHERE t.date <= ${asOfMs}
      AND t.status <> 'draft'
      AND a.type = 'asset'
      AND (a.system_key IS NULL OR a.system_key <> 'loans-receivable')
  `);

  return {
    startMs: input.startMs,
    endMs: input.endMs,
    asOfMs,
    rows: normalizedRows,
    totalSpentCents: normalizedRows.reduce((sum, row) => sum + row.expenseCents, 0),
    totalIncomeCents: normalizedRows.reduce((sum, row) => sum + row.incomeCents, 0),
    walletBalanceCents: Number((walletResult[0] as { balance?: number } | undefined)?.balance ?? 0),
    byCategory: Array.from(byCategoryMap.values()).sort((a, b) => b.spentCents - a.spentCents),
  };
}

export async function getBudgetFacts(periodId: number): Promise<Array<{
  categoryId: number;
  category: string;
  plannedCents: number;
  spentCents: number;
  transactionCount: number;
}>> {
  const rows = await db.all(sql`
    SELECT
      bp.category_id AS category_id,
      c.name AS category,
      bp.planned_amount AS planned_cents,
      COALESCE(SUM(CASE WHEN a.type = 'expense' THEN tl.debit - tl.credit ELSE 0 END), 0) AS spent_cents,
      COUNT(DISTINCT CASE WHEN a.type = 'expense' AND tl.debit - tl.credit > 0 THEN t.id END) AS transaction_count
    FROM budget_plan bp
    INNER JOIN category c ON c.id = bp.category_id
    INNER JOIN salary_period sp ON sp.id = bp.period_id
    LEFT JOIN "transaction" t ON t.category_id = bp.category_id
      AND t.date >= sp.start_date
      AND t.date <= sp.end_date + ${DAY_MS - 1}
      AND ${assignedOrLegacyPeriodMembership(periodId, sql`t.period_id`)}
    LEFT JOIN "transaction_line" tl ON tl.transaction_id = t.id
    LEFT JOIN account a ON a.id = tl.account_id
    WHERE bp.period_id = ${periodId}
      AND (t.id IS NULL OR t.status <> 'draft')
    GROUP BY bp.id, bp.category_id, c.name, bp.planned_amount
    ORDER BY c.name ASC
  `) as unknown as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    categoryId: Number(row.category_id),
    category: String(row.category ?? "Uncategorized"),
    plannedCents: Number(row.planned_cents ?? 0),
    spentCents: Number(row.spent_cents ?? 0),
    transactionCount: Number(row.transaction_count ?? 0),
  }));
}
