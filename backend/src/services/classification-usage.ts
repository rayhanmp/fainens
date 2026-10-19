import { and, desc, eq, lte, sql, type SQL } from "drizzle-orm";

import { db } from "../db/client";
import { salaryPeriods } from "../db/schema";
import { inclusivePeriodEnd, inclusivePeriodStart } from "../lib/calendar";

export interface PeriodCategoryUsage {
  periods: Array<{
    id: number;
    name: string;
    startDate: number;
    endDate: number;
    categories: Array<{ categoryId: number; transactionCount: number; amount: number }>;
  }>;
}

/** Spending per category in each of the latest salary periods that have started, oldest first. */
export async function getPeriodCategoryUsage(count: number, now = Date.now()): Promise<PeriodCategoryUsage> {
  const periods = await db.select({ id: salaryPeriods.id, name: salaryPeriods.name, startDate: salaryPeriods.startDate, endDate: salaryPeriods.endDate })
    .from(salaryPeriods)
    .where(and(eq(salaryPeriods.isActive, true), lte(salaryPeriods.startDate, now)))
    .orderBy(desc(salaryPeriods.startDate))
    .limit(count);
  const result = [];
  for (const period of periods.reverse()) {
    const from = inclusivePeriodStart(Number(period.startDate));
    const to = inclusivePeriodEnd(Number(period.endDate));
    const usage = await getClassificationUsage({ from, to });
    result.push({ id: period.id, name: period.name, startDate: from, endDate: to, categories: usage.categories });
  }
  return { periods: result };
}

export interface ClassificationUsage {
  /** Entries per category, and the spending allocated to it (net of refunds and reimbursements). */
  categories: Array<{ categoryId: number; transactionCount: number; amount: number }>;
  tags: Array<{ tagId: number; transactionCount: number }>;
  /** Posted spending entries, and how many of them carry a category. */
  expenseCount: number;
  categorizedExpenseCount: number;
  /** Posted entries of any kind, and how many of them carry a tag. */
  transactionCount: number;
  taggedCount: number;
}

/**
 * How each category and tag is used across the posted ledger, split allocations included,
 * optionally within a date range (inclusive, ms since epoch).
 */
export async function getClassificationUsage(range: { from?: number; to?: number } = {}): Promise<ClassificationUsage> {
  // Entries that count as activity: posted, not a reversal, and inside the range.
  const active: SQL = sql`t.status = 'posted' AND t.tx_type NOT IN ('reversal', 'domain_reversal')
    ${range.from != null ? sql`AND t.date >= ${range.from}` : sql``}
    ${range.to != null ? sql`AND t.date <= ${range.to}` : sql``}`;
  const netExpense = (transactionId: SQL) => sql`(SELECT COALESCE(SUM(l.debit - l.credit), 0) FROM transaction_line l
    JOIN account acc ON acc.id = l.account_id WHERE l.transaction_id = ${transactionId} AND acc.type = 'expense')`;

  // An entry's spending goes to its allocations when it has them, otherwise to its single category.
  const categoryRows = await db.all(sql`
    SELECT category_id, COUNT(DISTINCT CASE WHEN amount > 0 THEN transaction_id END) AS n, COALESCE(SUM(amount), 0) AS amount FROM (
      SELECT tca.category_id AS category_id, t.id AS transaction_id, tca.amount AS amount
      FROM transaction_category_allocation tca JOIN "transaction" t ON t.id = tca.transaction_id
      WHERE ${active} AND tca.amount <> 0
      UNION ALL
      SELECT t.category_id, t.id, ${netExpense(sql`t.id`)}
      FROM "transaction" t
      WHERE ${active} AND t.category_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM transaction_category_allocation x WHERE x.transaction_id = t.id AND x.amount <> 0)
    ) GROUP BY category_id
  `) as Array<{ category_id: number; n: number; amount: number }>;
  const tagRows = await db.all(sql`
    SELECT tt.tag_id AS tag_id, COUNT(DISTINCT t.id) AS n
    FROM transaction_tag tt JOIN "transaction" t ON t.id = tt.transaction_id
    WHERE ${active} GROUP BY tt.tag_id
  `) as Array<{ tag_id: number; n: number }>;
  const [totals] = await db.all(sql`
    WITH active AS (SELECT t.id, t.category_id FROM "transaction" t WHERE ${active}),
    spending AS (SELECT a.id, a.category_id FROM active a WHERE ${netExpense(sql`a.id`)} > 0)
    SELECT
      (SELECT COUNT(*) FROM spending) AS expense_count,
      (SELECT COUNT(*) FROM spending s WHERE s.category_id IS NOT NULL
         OR EXISTS (SELECT 1 FROM transaction_category_allocation tca WHERE tca.transaction_id = s.id AND tca.amount <> 0)) AS categorized_count,
      (SELECT COUNT(*) FROM active) AS transaction_count,
      (SELECT COUNT(*) FROM active a WHERE EXISTS (SELECT 1 FROM transaction_tag tt WHERE tt.transaction_id = a.id)) AS tagged_count
  `) as Array<{ expense_count: number; categorized_count: number; transaction_count: number; tagged_count: number }>;
  return {
    categories: categoryRows.map((row) => ({ categoryId: Number(row.category_id), transactionCount: Number(row.n), amount: Number(row.amount) })),
    tags: tagRows.map((row) => ({ tagId: Number(row.tag_id), transactionCount: Number(row.n) })),
    expenseCount: Number(totals?.expense_count ?? 0),
    categorizedExpenseCount: Number(totals?.categorized_count ?? 0),
    transactionCount: Number(totals?.transaction_count ?? 0),
    taggedCount: Number(totals?.tagged_count ?? 0),
  };
}
