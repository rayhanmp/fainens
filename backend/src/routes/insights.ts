import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { generateDashboardInsight, generateBudgetInsight } from "../services/insightGenerator";
import { getRedisClient } from "../cache/redis";

const CACHE_TTL_SECONDS = 24 * 60 * 60;

function getWeekDistribution(totalDays: number): number[] {
  const base = Math.floor(totalDays / 4);
  const remainder = totalDays % 4;
  const distribution = [0, 0, 0, 0];
  for (let i = 0; i < remainder; i++) {
    distribution[3 - i]++;
  }
  return distribution.map(d => base + d);
}

function getWeekBounds(periodStartMs: number, weekNumber: number): { start: number; end: number } {
  const weekDistribution = getWeekDistribution(Math.floor((periodStartMs + 31 * 24 * 60 * 60 * 1000 - periodStartMs) / (24 * 60 * 60 * 1000)));
  let start = periodStartMs;
  for (let i = 0; i < weekNumber - 1; i++) {
    start += weekDistribution[i] * 24 * 60 * 60 * 1000;
  }
  const daysInWeek = weekDistribution[weekNumber - 1] || 7;
  const end = start + (daysInWeek * 24 * 60 * 60 * 1000) - 1;
  return { start, end };
}

function getCurrentWeek(periodStartMs: number, today: Date, periodEndMs: number): number {
  const daysTotal = Math.floor((periodEndMs - periodStartMs) / (24 * 60 * 60 * 1000));
  const daysElapsed = Math.floor((today.getTime() - periodStartMs) / (24 * 60 * 60 * 1000)) + 1;
  const distribution = getWeekDistribution(daysTotal);
  let accumulatedDays = 0;
  for (let i = 0; i < distribution.length; i++) {
    accumulatedDays += distribution[i];
    if (daysElapsed <= accumulatedDays) {
      return i + 1;
    }
  }
  return 4;
}

function getDaysLeftInWeek(periodStartMs: number, today: Date, periodEndMs: number): number {
  const daysTotal = Math.floor((periodEndMs - periodStartMs) / (24 * 60 * 60 * 1000));
  const daysElapsed = Math.floor((today.getTime() - periodStartMs) / (24 * 60 * 60 * 1000)) + 1;
  const distribution = getWeekDistribution(daysTotal);
  let accumulatedDays = 0;
  for (const days of distribution) {
    accumulatedDays += days;
    if (daysElapsed <= accumulatedDays) {
      return Math.max(0, accumulatedDays - daysElapsed);
    }
  }
  return 0;
}

function getPreviousWeeks(currentWeek: number): number[] {
  if (currentWeek <= 1) return [];
  return Array.from({ length: currentWeek - 1 }, (_, i) => i + 1);
}

interface TransactionData {
  date: string;
  category: string;
  amount: number;
  description?: string;
}

interface BudgetData {
  category: string;
  planned: number;
  spent: number;
  spent_this_week?: number;
  transactions?: number;
}

interface DashboardInsightData {
  report_week: string;
  period_name: string;
  salary_period: string;
  today_date: string;
  days_elapsed: number;
  days_total: number;
  days_remaining: number;
  current_week: number;
  days_left_in_week: number;
  week_distribution: number[];
  week_transactions: TransactionData[];
  wallet_balance: number;
  monthly_income: number;
  total_spent: number;
  savings_rate: number;
  daily_burn_rate: number;
  expected_total_spend: number;
  budget_status: 'on_track' | 'over_budget' | 'under_budget';
  budgets: BudgetData[];
  previous_weeks: Array<{ week: number; total: number }>;
  spending_velocity: 'faster' | 'slower' | 'same' | 'unknown';
  top_spending_category: string;
  largest_transaction: { amount: number; description: string; category: string };
  budget_warnings: string[];
  positive_notes: string[];
}

interface BudgetInsightData {
  period: string;
  today_date: string;
  days_elapsed: number;
  days_total: number;
  days_remaining: number;
  current_week: number;
  days_left_in_week: number;
  week_distribution: number[];
  week_number: number;
  all_transactions: TransactionData[];
  total_spent: number;
  total_planned: number;
  savings_rate: number;
  daily_burn_rate: number;
  expected_end_spend: number;
  budget_status: 'on_track' | 'over_budget' | 'under_budget';
  budgets: BudgetData[];
  budget_warnings: string[];
  budget_successes: string[];
  last_month: {
    period: string;
    total_spent: number;
    budget_count: number;
  };
  savings_comparison: number;
}

export default async function insightsRoutes(fastify: FastifyInstance) {
  async function getCachedInsight(userId: string, type: string, periodId?: string): Promise<string | null> {
    const redis = getRedisClient();
    const cacheKey = periodId 
      ? `insights:${userId}:${type}:${periodId}`
      : `insights:${userId}:${type}`;
    return redis.get(cacheKey);
  }

  async function setCachedInsight(userId: string, type: string, content: string, periodId?: string) {
    const redis = getRedisClient();
    const cacheKey = periodId 
      ? `insights:${userId}:${type}:${periodId}`
      : `insights:${userId}:${type}`;
    await redis.setex(cacheKey, CACHE_TTL_SECONDS, content);
  }

  // POST /api/insights/dashboard - Generate dashboard insight
  fastify.post("/api/insights/dashboard", async (request, reply) => {
    const userId = (request.user as { id?: string })?.id || 'anonymous';
    const q = request.query as { periodId?: string };
    const periodId = q.periodId ? parseInt(q.periodId) : undefined;
    
    try {
      let currentPeriod;
      if (periodId) {
        const periodResult = await db.all(sql`SELECT * FROM salary_period WHERE id = ${periodId} LIMIT 1`);
        currentPeriod = periodResult[0] as any;
      } else {
        const currentPeriodResult = await db.all(sql`
          SELECT * FROM salary_period ORDER BY end_date DESC LIMIT 1
        `);
        currentPeriod = currentPeriodResult[0] as any;
      }

      if (!currentPeriod) {
        reply.code(404).send({ error: "No active period found" });
        return;
      }

      const today = new Date();
      const periodStartMs = currentPeriod.start_date;
      const periodEndMs = currentPeriod.end_date;
      const daysTotal = Math.max(1, Math.floor((periodEndMs - periodStartMs) / (1000 * 60 * 60 * 24)));
      const daysElapsed = Math.floor((today.getTime() - periodStartMs) / (1000 * 60 * 60 * 24)) + 1;
      const daysRemaining = Math.max(0, daysTotal - daysElapsed);
      const currentWeek = getCurrentWeek(periodStartMs, today, periodEndMs);
      const daysLeftInWeek = getDaysLeftInWeek(periodStartMs, today, periodEndMs);
      const weekDistribution = getWeekDistribution(daysTotal);

      // Wallet balance
      const walletBalanceResult = await db.all(sql`
        SELECT COALESCE(SUM(tl.debit - tl.credit), 0) as balance
        FROM account a
        LEFT JOIN "transaction_line" tl ON tl.account_id = a.id
        WHERE a.type = 'asset'
      `);
      const walletBalance = (walletBalanceResult[0] as any)?.balance || 0;

      // Monthly income
      const incomeResult = await db.all(sql`
        SELECT COALESCE(SUM(tl.debit), 0) as income
        FROM "transaction" t
        LEFT JOIN "transaction_line" tl ON tl.transaction_id = t.id
        WHERE t.period_id = ${currentPeriod.id}
        AND t.tx_type = 'income'
        AND (t.description IS NULL OR t.description NOT LIKE '%Reconciliation%')
      `);
      const monthlyIncome = (incomeResult[0] as any)?.income || 0;

      // Get all period transactions with category info (exclude Reconciliation and income)
      const allTransactionsResult = await db.all(sql`
        SELECT t.id, t.date, c.name as category, t.description,
               SUM(CASE WHEN tl.credit > 0 THEN tl.credit ELSE 0 END) as amount
        FROM "transaction" t
        LEFT JOIN "transaction_line" tl ON tl.transaction_id = t.id
        LEFT JOIN category c ON c.id = t.category_id
        WHERE t.period_id = ${currentPeriod.id}
        AND (t.description IS NULL OR t.description NOT LIKE '%Reconciliation%')
        AND (t.tx_type NOT LIKE '%income%' AND t.tx_type NOT LIKE '%Income%')
        GROUP BY t.id, c.name, t.description
      `);

      const txList = (allTransactionsResult as any[]);
      const totalSpent = txList.reduce((sum, t) => sum + (t.amount || 0), 0);
      const savingsRate = monthlyIncome > 0 ? ((monthlyIncome - totalSpent) / monthlyIncome) * 100 : 0;
      const dailyBurnRate = daysElapsed > 0 ? totalSpent / daysElapsed : 0;
      const expectedTotalSpend = dailyBurnRate * daysTotal;

      // Budget data
      const budgetsResult = await db.all(sql`
        SELECT bp.category_id, bp.planned_amount, COALESCE(SUM(tl.credit), 0) as spent
        FROM budget_plan bp
        LEFT JOIN "transaction" t ON t.period_id = bp.period_id AND t.category_id = bp.category_id
          AND (t.description IS NULL OR t.description NOT LIKE '%Reconciliation%')
          AND (t.tx_type NOT LIKE '%income%' AND t.tx_type NOT LIKE '%Income%')
        LEFT JOIN "transaction_line" tl ON tl.transaction_id = t.id
        WHERE bp.period_id = ${currentPeriod.id}
        GROUP BY bp.id, bp.category_id, bp.planned_amount
      `);

      const categoryIds = [...new Set((budgetsResult as any[]).map((b: any) => b.category_id))];
      let categoryMap = new Map<number, string>();
      
      if (categoryIds.length > 0) {
        const idList = categoryIds.join(',');
        const categoriesResult = await db.all(sql`
          SELECT id, name FROM category WHERE id IN (${sql.raw(idList)})
        `);
        categoryMap = new Map((categoriesResult as any[]).map((c: any) => [c.id, c.name]));
      }

      // Calculate budget status
      const budgets = (budgetsResult as any[]).map((b: any) => ({
        category: categoryMap.get(b.category_id) || 'Unknown',
        planned: b.planned_amount || 0,
        spent: b.spent || 0,
      }));

      const totalPlanned = budgets.reduce((sum, b) => sum + b.planned, 0);
      let budgetStatus: 'on_track' | 'over_budget' | 'under_budget' = 'on_track';
      const budgetWarnings: string[] = [];
      const positiveNotes: string[] = [];

      if (totalPlanned > 0) {
        const percentUsed = (totalSpent / totalPlanned) * 100;
        const expectedPercent = (daysElapsed / daysTotal) * 100;
        
        if (percentUsed > expectedPercent + 10) {
          budgetStatus = 'over_budget';
        } else if (percentUsed < expectedPercent - 10) {
          budgetStatus = 'under_budget';
        }

        for (const b of budgets) {
          const bPercent = b.planned > 0 ? (b.spent / b.planned) * 100 : 0;
          if (bPercent > 100) {
            budgetWarnings.push(`${b.category} exceeded budget by ${(bPercent - 100).toFixed(0)}%`);
          } else if (bPercent > expectedPercent + 15) {
            budgetWarnings.push(`${b.category} at ${bPercent.toFixed(0)}% used (on pace to exceed)`);
          } else if (bPercent < expectedPercent - 20 && b.spent > 0) {
            positiveNotes.push(`${b.category} well under budget at ${bPercent.toFixed(0)}%`);
          }
        }
      }

      // Top spending category
      const spendingByCategory = new Map<string, number>();
      for (const t of txList) {
        const cat = t.category || 'Uncategorized';
        spendingByCategory.set(cat, (spendingByCategory.get(cat) || 0) + (t.amount || 0));
      }
      let topCategory = 'None';
      let topAmount = 0;
      for (const [cat, amt] of spendingByCategory) {
        if (amt > topAmount) {
          topAmount = amt;
          topCategory = cat;
        }
      }

      // Largest transaction
      let largestTx = { amount: 0, description: '', category: '' };
      for (const t of txList) {
        if ((t.amount || 0) > largestTx.amount) {
          largestTx = {
            amount: t.amount || 0,
            description: t.description || 'No description',
            category: t.category || 'Uncategorized'
          };
        }
      }

      // Previous weeks
      const previousWeekNums = getPreviousWeeks(currentWeek);
      const previousWeeks = [];
      for (const weekNum of previousWeekNums) {
        const { start, end } = getWeekBounds(periodStartMs, weekNum);
        const weekTotalResult = await db.all(sql`
          SELECT COALESCE(SUM(tl.credit), 0) as total
          FROM "transaction" t
          LEFT JOIN "transaction_line" tl ON tl.transaction_id = t.id
          WHERE t.date >= ${start} AND t.date <= ${end}
          AND t.period_id = ${currentPeriod.id}
          AND (t.description IS NULL OR t.description NOT LIKE '%Reconciliation%')
          AND (t.tx_type NOT LIKE '%income%' AND t.tx_type NOT LIKE '%Income%')
        `);
        previousWeeks.push({ week: weekNum, total: (weekTotalResult[0] as any)?.total || 0 });
      }

      // Spending velocity
      let spendingVelocity: 'faster' | 'slower' | 'same' | 'unknown' = 'unknown';
      if (previousWeeks.length > 0) {
        const prevAvg = previousWeeks.reduce((s, w) => s + w.total, 0) / previousWeeks.length;
        const { start: currentStart, end: currentEnd } = getWeekBounds(periodStartMs, currentWeek);
        const currentWeekResult = await db.all(sql`
          SELECT COALESCE(SUM(tl.credit), 0) as total
          FROM "transaction" t
          LEFT JOIN "transaction_line" tl ON tl.transaction_id = t.id
          WHERE t.date >= ${currentStart} AND t.date <= ${currentEnd}
          AND t.period_id = ${currentPeriod.id}
          AND (t.description IS NULL OR t.description NOT LIKE '%Reconciliation%')
          AND (t.tx_type NOT LIKE '%income%' AND t.tx_type NOT LIKE '%Income%')
        `);
        const currentWeekTotal = (currentWeekResult[0] as any)?.total || 0;
        if (prevAvg > 0) {
          if (currentWeekTotal > prevAvg * 1.15) {
            spendingVelocity = 'faster';
          } else if (currentWeekTotal < prevAvg * 0.85) {
            spendingVelocity = 'slower';
          } else {
            spendingVelocity = 'same';
          }
        }
      }

      // This week's transactions
      const { start: weekStart, end: weekEnd } = getWeekBounds(periodStartMs, currentWeek);
      const weekTransactions = txList
        .filter(t => t.date >= weekStart && t.date <= weekEnd)
        .map(t => ({
          date: new Date(t.date).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
          category: t.category || 'Uncategorized',
          amount: t.amount || 0,
          description: t.description || undefined,
        }));

      const data: DashboardInsightData = {
        report_week: `Week ${currentWeek}`,
        period_name: currentPeriod.name,
        salary_period: `${new Date(currentPeriod.start_date).toLocaleDateString('id-ID')} - ${new Date(currentPeriod.end_date).toLocaleDateString('id-ID')}`,
        today_date: today.toISOString().split('T')[0],
        days_elapsed: daysElapsed,
        days_total: daysTotal,
        days_remaining: daysRemaining,
        current_week: currentWeek,
        days_left_in_week: daysLeftInWeek,
        week_distribution: weekDistribution,
        week_transactions: weekTransactions,
        wallet_balance: walletBalance,
        monthly_income: monthlyIncome,
        total_spent: totalSpent,
        savings_rate: savingsRate,
        daily_burn_rate: dailyBurnRate,
        expected_total_spend: expectedTotalSpend,
        budget_status: budgetStatus,
        budgets,
        previous_weeks: previousWeeks,
        spending_velocity: spendingVelocity,
        top_spending_category: topCategory,
        largest_transaction: largestTx,
        budget_warnings: budgetWarnings,
        positive_notes: positiveNotes,
      };

      const insight = await generateDashboardInsight(data);
      await setCachedInsight(userId, 'dashboard', insight, periodId?.toString());
      
      reply.send({ insight, generatedAt: new Date().toISOString() });
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: "Failed to generate insight" });
    }
  });

  // POST /api/insights/budget - Generate budget insight
  fastify.post("/api/insights/budget", async (request, reply) => {
    const userId = (request.user as { id?: string })?.id || 'anonymous';
    const { periodId } = request.body as { periodId?: number };
    
    try {
      let periodResult;
      if (periodId) {
        periodResult = await db.all(sql`SELECT * FROM salary_period WHERE id = ${periodId} LIMIT 1`);
      } else {
        periodResult = await db.all(sql`SELECT * FROM salary_period ORDER BY end_date DESC LIMIT 1`);
      }

      const period = periodResult[0] as any;

      if (!period) {
        reply.code(404).send({ error: "Period not found" });
        return;
      }

      const today = new Date();
      const daysTotal = Math.max(1, Math.floor((period.end_date - period.start_date) / (1000 * 60 * 60 * 24)));
      const daysElapsed = Math.floor((today.getTime() - period.start_date) / (1000 * 60 * 60 * 24)) + 1;
      const daysRemaining = Math.max(0, daysTotal - daysElapsed);
      const currentWeek = getCurrentWeek(period.start_date, today, period.end_date);
      const daysLeftInWeek = getDaysLeftInWeek(period.start_date, today, period.end_date);
      const weekDistribution = getWeekDistribution(daysTotal);

      // Get all transactions (exclude Reconciliation and income)
      const allTransactionsResult = await db.all(sql`
        SELECT t.id, t.date, c.name as category, t.description,
               SUM(CASE WHEN tl.credit > 0 THEN tl.credit ELSE 0 END) as amount
        FROM "transaction" t
        LEFT JOIN "transaction_line" tl ON tl.transaction_id = t.id
        LEFT JOIN category c ON c.id = t.category_id
        WHERE t.period_id = ${period.id}
        AND (t.description IS NULL OR t.description NOT LIKE '%Reconciliation%')
        AND (t.tx_type NOT LIKE '%income%' AND t.tx_type NOT LIKE '%Income%')
        GROUP BY t.id, c.name, t.description
      `);

      const txList = (allTransactionsResult as any[]);
      const totalSpent = txList.reduce((sum, t) => sum + (t.amount || 0), 0);

      // Budget status (exclude income transactions)
      const budgetsResult = await db.all(sql`
        SELECT bp.category_id, bp.planned_amount, COALESCE(SUM(tl.credit), 0) as spent, COUNT(DISTINCT t.id) as transaction_count
        FROM budget_plan bp
        LEFT JOIN "transaction" t ON t.period_id = bp.period_id AND t.category_id = bp.category_id
          AND (t.description IS NULL OR t.description NOT LIKE '%Reconciliation%')
          AND (t.tx_type NOT LIKE '%income%' AND t.tx_type NOT LIKE '%Income%')
        LEFT JOIN "transaction_line" tl ON tl.transaction_id = t.id
        WHERE bp.period_id = ${period.id}
        GROUP BY bp.id, bp.category_id, bp.planned_amount
      `);

      const categoryIds = [...new Set((budgetsResult as any[]).map((b: any) => b.category_id))];
      let categoryMap = new Map<number, string>();
      
      if (categoryIds.length > 0) {
        const idList = categoryIds.join(',');
        const categoriesResult = await db.all(sql`
          SELECT id, name FROM category WHERE id IN (${sql.raw(idList)})
        `);
        categoryMap = new Map(categoriesResult.map((c: any) => [c.id, c.name]));
      }

      const budgets = (budgetsResult as any[]).map((b: any) => ({
        category: categoryMap.get(b.category_id) || 'Unknown',
        planned: b.planned_amount || 0,
        spent: b.spent || 0,
        transactions: b.transaction_count || 0,
      }));

      const totalPlanned = budgets.reduce((sum, b) => sum + b.planned, 0);
      const savingsRate = totalPlanned > 0 ? ((totalPlanned - totalSpent) / totalPlanned) * 100 : 0;
      const dailyBurnRate = daysElapsed > 0 ? totalSpent / daysElapsed : 0;
      const expectedEndSpend = dailyBurnRate * daysTotal;

      let budgetStatus: 'on_track' | 'over_budget' | 'under_budget' = 'on_track';
      const budgetWarnings: string[] = [];
      const budgetSuccesses: string[] = [];
      const expectedPercent = (daysElapsed / daysTotal) * 100;

      for (const b of budgets) {
        const bPercent = b.planned > 0 ? (b.spent / b.planned) * 100 : 0;
        const remaining = b.planned - b.spent;
        const dailyAllowance = daysRemaining > 0 ? remaining / daysRemaining : remaining;

        if (bPercent > 100) {
          budgetWarnings.push(`${b.category} exceeded by Rp ${Math.abs(remaining).toLocaleString('id-ID')}`);
        } else if (bPercent > expectedPercent + 20) {
          budgetWarnings.push(`${b.category} will exceed at current pace (Rp ${dailyAllowance.toLocaleString('id-ID')}/day left)`);
        } else if (bPercent < expectedPercent - 25 && b.spent > 0) {
          budgetSuccesses.push(`${b.category} under control at ${bPercent.toFixed(0)}%`);
        }
      }

      if (totalPlanned > 0) {
        const totalPercent = (totalSpent / totalPlanned) * 100;
        if (totalPercent > expectedPercent + 15) {
          budgetStatus = 'over_budget';
        } else if (totalPercent < expectedPercent - 15) {
          budgetStatus = 'under_budget';
        }
      }

      // Last month comparison
      const lastMonthMs = period.start_date - (30 * 24 * 60 * 60 * 1000);
      const lastMonthPeriodResult = await db.all(sql`
        SELECT * FROM salary_period 
        WHERE start_date <= ${lastMonthMs} AND end_date >= ${lastMonthMs}
        LIMIT 1
      `);
      const lastMonthPeriod = lastMonthPeriodResult[0] as any;
      let lastMonthTotal = 0;
      if (lastMonthPeriod) {
        const lastMonthTotalResult = await db.all(sql`
          SELECT COALESCE(SUM(tl.credit), 0) as total
          FROM "transaction" t
          LEFT JOIN "transaction_line" tl ON tl.transaction_id = t.id
          WHERE t.period_id = ${lastMonthPeriod.id}
          AND (t.description IS NULL OR t.description NOT LIKE '%Reconciliation%')
          AND (t.tx_type NOT LIKE '%income%' AND t.tx_type NOT LIKE '%Income%')
        `);
        lastMonthTotal = (lastMonthTotalResult[0] as any)?.total || 0;
      }
      const savingsComparison = lastMonthTotal > 0 ? ((lastMonthTotal - totalSpent) / lastMonthTotal) * 100 : 0;

      const data: BudgetInsightData = {
        period: period.name,
        today_date: today.toISOString().split('T')[0],
        days_elapsed: daysElapsed,
        days_total: daysTotal,
        days_remaining: daysRemaining,
        current_week: currentWeek,
        days_left_in_week: daysLeftInWeek,
        week_distribution: weekDistribution,
        week_number: currentWeek,
        all_transactions: txList.map(t => ({
          date: new Date(t.date).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
          category: t.category || 'Uncategorized',
          amount: t.amount || 0,
        })),
        total_spent: totalSpent,
        total_planned: totalPlanned,
        savings_rate: savingsRate,
        daily_burn_rate: dailyBurnRate,
        expected_end_spend: expectedEndSpend,
        budget_status: budgetStatus,
        budgets,
        budget_warnings: budgetWarnings,
        budget_successes: budgetSuccesses,
        last_month: {
          period: lastMonthPeriod?.name || 'Last month',
          total_spent: lastMonthTotal,
          budget_count: budgets.length,
        },
        savings_comparison: savingsComparison,
      };

      const insight = await generateBudgetInsight(data);
      await setCachedInsight(userId, 'budget', insight, period.id.toString());
      
      reply.send({ insight, generatedAt: new Date().toISOString() });
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: "Failed to generate insight" });
    }
  });

  // GET /api/insights/dashboard/latest - Get cached dashboard insight
  fastify.get("/api/insights/dashboard/latest", async (request, reply) => {
    const userId = (request.user as { id?: string })?.id || 'anonymous';
    const { periodId } = request.query as { periodId?: string };
    
    try {
      const cached = await getCachedInsight(userId, 'dashboard', periodId);
      reply.send({ 
        insight: cached,
        generatedAt: cached ? new Date().toISOString() : null 
      });
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: "Failed to get insight" });
    }
  });

  // GET /api/insights/budget/latest - Get cached budget insight
  fastify.get("/api/insights/budget/latest", async (request, reply) => {
    const userId = (request.user as { id?: string })?.id || 'anonymous';
    const { periodId } = request.query as { periodId?: string };
    
    try {
      const cached = await getCachedInsight(userId, 'budget', periodId);
      reply.send({ 
        insight: cached,
        generatedAt: cached ? new Date().toISOString() : null 
      });
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: "Failed to get insight" });
    }
  });
}
