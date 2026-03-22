import { eq, and, sql } from "drizzle-orm";
import { db } from "../db/client";
import { accounts, transactions, transactionLines, salaryPeriods } from "../db/schema";
import { computeAccountBalanceRolledUp, computeTrialBalanceTotals } from "./ledger";

// Report types
export interface IncomeStatementItem {
  name: string;
  code?: string;
  amount: number;
  isTotal?: boolean;
  level: number;
}

export interface IncomeStatement {
  revenue: IncomeStatementItem[];
  expenses: IncomeStatementItem[];
  totalRevenue: number;
  totalExpenses: number;
  netIncome: number;
  periodName?: string;
  startDate?: number;
  endDate?: number;
}

export interface BalanceSheetItem {
  name: string;
  code: string;
  balance: number;
  level: number;
  isTotal?: boolean;
}

export interface BalanceSheet {
  assets: BalanceSheetItem[];
  liabilities: BalanceSheetItem[];
  equity: BalanceSheetItem[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  asOfDate: string;
}

export interface CashFlowItem {
  category: string;
  description: string;
  amount: number;
  type: "operating" | "investing" | "financing";
}

export interface CashFlowStatement {
  operating: CashFlowItem[];
  investing: CashFlowItem[];
  financing: CashFlowItem[];
  netOperating: number;
  netInvesting: number;
  netFinancing: number;
  netChange: number;
  beginningCash: number;
  endingCash: number;
  periodName?: string;
}

export interface SpendingBreakdown {
  category: string;
  accountId: number;
  amount: number;
  percentage: number;
}

// Generate Income Statement (Profit & Loss) for a period
export async function generateIncomeStatement(
  periodId?: number,
  startDate?: number,
  endDate?: number
): Promise<IncomeStatement> {
  let periodStart: number;
  let periodEnd: number;
  let periodName = "All Periods";

  if (periodId) {
    const [period] = await db
      .select({
        startDate: salaryPeriods.startDate,
        endDate: salaryPeriods.endDate,
        name: salaryPeriods.name,
      })
      .from(salaryPeriods)
      .where(eq(salaryPeriods.id, periodId))
      .limit(1);

    if (!period) throw new Error(`Period not found: ${periodId}`);
    periodStart = period.startDate;
    periodEnd = period.endDate;
    periodName = period.name;
  } else if (startDate && endDate) {
    periodStart = startDate;
    periodEnd = endDate;
    periodName = `${new Date(startDate).toLocaleDateString()} - ${new Date(
      endDate
    ).toLocaleDateString()}`;
  } else {
    // All time - get date range from all transactions
    const [range] = await db
      .select({
        minDate: sql<number>`min(${transactions.date})`,
        maxDate: sql<number>`max(${transactions.date})`,
      })
      .from(transactions);
    periodStart = range?.minDate || Date.now() - 365 * 24 * 60 * 60 * 1000;
    periodEnd = range?.maxDate || Date.now();
  }

  const revenueAccounts = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.type, "revenue"))
    .orderBy(accounts.name);

  const expenseAccounts = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.type, "expense"))
    .orderBy(accounts.name);

  // Get transaction lines for revenue in period
  const revenueLines = await db
    .select({
      accountId: transactionLines.accountId,
      credit: sql<number>`sum(${transactionLines.credit})`,
      debit: sql<number>`sum(${transactionLines.debit})`,
    })
    .from(transactionLines)
    .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
    .where(
      and(
        sql`${transactions.date} >= ${periodStart}`,
        sql`${transactions.date} <= ${periodEnd}`,
        sql`${transactionLines.accountId} IN (${sql.join(
          revenueAccounts.map((a) => a.id.toString()),
          sql`, `
        )})`
      )
    )
    .groupBy(transactionLines.accountId);

  // Get transaction lines for expenses in period
  const expenseLines = await db
    .select({
      accountId: transactionLines.accountId,
      debit: sql<number>`sum(${transactionLines.debit})`,
      credit: sql<number>`sum(${transactionLines.credit})`,
    })
    .from(transactionLines)
    .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
    .where(
      and(
        sql`${transactions.date} >= ${periodStart}`,
        sql`${transactions.date} <= ${periodEnd}`,
        sql`${transactionLines.accountId} IN (${sql.join(
          expenseAccounts.map((a) => a.id.toString()),
          sql`, `
        )})`
      )
    )
    .groupBy(transactionLines.accountId);

  // Build revenue report items
  const revenueItems: IncomeStatementItem[] = [];
  let totalRevenue = 0;

  for (const account of revenueAccounts) {
    const lines = revenueLines.filter((l) => l.accountId === account.id);
    const credit = lines[0]?.credit || 0;
    const debit = lines[0]?.debit || 0;
    const amount = credit - debit;

    revenueItems.push({
      name: account.name,
      code: String(account.id),
      amount,
      level: 0,
    });
    totalRevenue += amount;
  }

  // Build expense report items
  const expenseItems: IncomeStatementItem[] = [];
  let totalExpenses = 0;

  for (const account of expenseAccounts) {
    const lines = expenseLines.filter((l) => l.accountId === account.id);
    const debit = lines[0]?.debit || 0;
    const credit = lines[0]?.credit || 0;
    const amount = debit - credit;

    expenseItems.push({
      name: account.name,
      code: String(account.id),
      amount,
      level: 0,
    });
    totalExpenses += amount;
  }

  return {
    revenue: revenueItems,
    expenses: expenseItems,
    totalRevenue,
    totalExpenses,
    netIncome: totalRevenue - totalExpenses,
    periodName,
    startDate: periodStart,
    endDate: periodEnd,
  };
}

// Generate Balance Sheet as of a specific date
export async function generateBalanceSheet(asOfDate?: number): Promise<BalanceSheet> {
  const date = asOfDate || Date.now();
  const dateStr = new Date(date).toISOString().split("T")[0];

  // Get all accounts by type
  const allAccounts = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
    })
    .from(accounts)
    .where(sql`${accounts.type} IN ('asset', 'liability', 'equity')`)
    .orderBy(accounts.name);

  // Calculate balances for each account up to the date
  const assetItems: BalanceSheetItem[] = [];
  const liabilityItems: BalanceSheetItem[] = [];
  const equityItems: BalanceSheetItem[] = [];

  let totalAssets = 0;
  let totalLiabilities = 0;
  let totalEquity = 0;

  for (const account of allAccounts) {
    // Get balance up to date
    const lines = await db
      .select({
        debit: sql<number>`coalesce(sum(${transactionLines.debit}), 0)`,
        credit: sql<number>`coalesce(sum(${transactionLines.credit}), 0)`,
      })
      .from(transactionLines)
      .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
      .where(
        and(
          eq(transactionLines.accountId, account.id),
          sql`${transactions.date} <= ${date}`
        )
      );

    const debit = lines[0]?.debit || 0;
    const credit = lines[0]?.credit || 0;

    // Calculate balance based on account type
    let balance = 0;
    if (account.type === "asset") {
      balance = debit - credit; // Assets: debit increases
    } else if (account.type === "liability" || account.type === "equity") {
      balance = credit - debit; // Liabilities/Equity: credit increases
    }

    if (balance !== 0) {
      const item: BalanceSheetItem = {
        name: account.name,
        code: String(account.id),
        balance,
        level: 0,
      };

      if (account.type === "asset") {
        assetItems.push(item);
        totalAssets += balance;
      } else if (account.type === "liability") {
        liabilityItems.push(item);
        totalLiabilities += balance;
      } else {
        equityItems.push(item);
        totalEquity += balance;
      }
    }
  }

  // Add retained earnings (net income) to equity
  try {
    const incomeStmt = await generateIncomeStatement(undefined, 0, date);
    if (incomeStmt.netIncome !== 0) {
      equityItems.push({
        name: "Retained Earnings (Current Period)",
        code: "3900-RE",
        balance: incomeStmt.netIncome,
        level: 0,
      });
      totalEquity += incomeStmt.netIncome;
    }
  } catch {
    // Ignore if no transactions
  }

  return {
    assets: assetItems,
    liabilities: liabilityItems,
    equity: equityItems,
    totalAssets,
    totalLiabilities,
    totalEquity,
    asOfDate: dateStr,
  };
}

// Generate Cash Flow Statement
export async function generateCashFlowStatement(
  periodId?: number,
  startDate?: number,
  endDate?: number
): Promise<CashFlowStatement> {
  let periodStart: number;
  let periodEnd: number;
  let periodName = "All Periods";

  if (periodId) {
    const [period] = await db
      .select({
        startDate: salaryPeriods.startDate,
        endDate: salaryPeriods.endDate,
        name: salaryPeriods.name,
      })
      .from(salaryPeriods)
      .where(eq(salaryPeriods.id, periodId))
      .limit(1);

    if (!period) throw new Error(`Period not found: ${periodId}`);
    periodStart = period.startDate;
    periodEnd = period.endDate;
    periodName = period.name;
  } else if (startDate && endDate) {
    periodStart = startDate;
    periodEnd = endDate;
  } else {
    periodStart = Date.now() - 365 * 24 * 60 * 60 * 1000;
    periodEnd = Date.now();
  }

  const cashAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.type, "asset"));
  const cashAccountIds = cashAccounts.map((a) => a.id);

  if (cashAccountIds.length === 0) {
    return {
      operating: [],
      investing: [],
      financing: [],
      netOperating: 0,
      netInvesting: 0,
      netFinancing: 0,
      netChange: 0,
      beginningCash: 0,
      endingCash: 0,
      periodName,
    };
  }

  const [beginningLines] = await db
    .select({
      debit: sql<number>`coalesce(sum(${transactionLines.debit}), 0)`,
      credit: sql<number>`coalesce(sum(${transactionLines.credit}), 0)`,
    })
    .from(transactionLines)
    .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
    .where(
      and(
        sql`${transactions.date} < ${periodStart}`,
        sql`${transactionLines.accountId} IN (${sql.join(
          cashAccountIds.map(String),
          sql`, `
        )})`
      )
    );
  const beginningCash = (beginningLines?.debit || 0) - (beginningLines?.credit || 0);

  // Get all cash transactions in period
  const cashTxs = await db
    .select({
      description: transactions.description,
      txType: transactions.txType,
      debit: transactionLines.debit,
      credit: transactionLines.credit,
      counterpartyAccountId: sql<number>`(
        SELECT tl2.account_id 
        FROM transaction_line tl2 
        WHERE tl2.transaction_id = ${transactionLines.transactionId} 
        AND tl2.id != ${transactionLines.id} 
        LIMIT 1
      )`,
    })
    .from(transactionLines)
    .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
    .where(
      and(
        sql`${transactions.date} >= ${periodStart}`,
        sql`${transactions.date} <= ${periodEnd}`,
        sql`${transactionLines.accountId} IN (${sql.join(
          cashAccountIds.map(String),
          sql`, `
        )})`
      )
    );

  // Categorize cash flows
  const operating: CashFlowItem[] = [];
  const investing: CashFlowItem[] = [];
  const financing: CashFlowItem[] = [];

  let netOperating = 0;
  let netInvesting = 0;
  let netFinancing = 0;

  for (const tx of cashTxs) {
    const amount = (tx.debit || 0) - (tx.credit || 0);
    if (amount === 0) continue;

    // Determine category based on transaction type and counterparty
    let type: "operating" | "investing" | "financing" = "operating";
    let category = "Operating";

    if (tx.txType?.includes("paylater") || tx.txType?.includes("loan")) {
      type = "financing";
      category = "Financing";
    } else if (tx.txType?.includes("investment") || tx.txType?.includes("asset")) {
      type = "investing";
      category = "Investing";
    }

    const item: CashFlowItem = {
      category,
      description: tx.description || "Transaction",
      amount,
      type,
    };

    if (type === "operating") {
      operating.push(item);
      netOperating += amount;
    } else if (type === "investing") {
      investing.push(item);
      netInvesting += amount;
    } else {
      financing.push(item);
      netFinancing += amount;
    }
  }

  const netChange = netOperating + netInvesting + netFinancing;
  const endingCash = beginningCash + netChange;

  return {
    operating,
    investing,
    financing,
    netOperating,
    netInvesting,
    netFinancing,
    netChange,
    beginningCash,
    endingCash,
    periodName,
  };
}

// Generate spending breakdown by expense category
export async function generateSpendingBreakdown(
  periodId?: number,
  startDate?: number,
  endDate?: number
): Promise<SpendingBreakdown[]> {
  let periodStart: number;
  let periodEnd: number;

  if (periodId) {
    const [period] = await db
      .select({
        startDate: salaryPeriods.startDate,
        endDate: salaryPeriods.endDate,
      })
      .from(salaryPeriods)
      .where(eq(salaryPeriods.id, periodId))
      .limit(1);

    if (!period) throw new Error(`Period not found: ${periodId}`);
    periodStart = period.startDate;
    periodEnd = period.endDate;
  } else if (startDate && endDate) {
    periodStart = startDate;
    periodEnd = endDate;
  } else {
    periodStart = Date.now() - 30 * 24 * 60 * 60 * 1000; // Last 30 days
    periodEnd = Date.now();
  }

  // Get expense accounts with transactions
  const expenses = await db
    .select({
      accountId: accounts.id,
      accountName: accounts.name,
      total: sql<number>`coalesce(sum(${transactionLines.debit}), 0) - coalesce(sum(${transactionLines.credit}), 0)`,
    })
    .from(accounts)
    .leftJoin(
      transactionLines,
      eq(accounts.id, transactionLines.accountId)
    )
    .leftJoin(
      transactions,
      eq(transactionLines.transactionId, transactions.id)
    )
    .where(
      and(
        eq(accounts.type, "expense"),
        sql`${transactions.date} >= ${periodStart} OR ${transactions.date} IS NULL`,
        sql`${transactions.date} <= ${periodEnd} OR ${transactions.date} IS NULL`
      )
    )
    .groupBy(accounts.id, accounts.name)
    .orderBy(sql`sum(${transactionLines.debit}) DESC`);

  const totalExpenses = expenses.reduce((sum, e) => sum + (e.total || 0), 0);

  return expenses
    .filter((e) => e.total > 0)
    .map((e) => ({
      category: e.accountName,
      accountId: e.accountId,
      amount: e.total,
      percentage: totalExpenses > 0 ? (e.total / totalExpenses) * 100 : 0,
    }));
}

// Export report as CSV
export function exportReportToCSV(report: IncomeStatement | BalanceSheet | CashFlowStatement): string {
  const lines: string[] = [];

  if ("revenue" in report) {
    // Income Statement
    lines.push("INCOME STATEMENT");
    lines.push(`Period: ${report.periodName || "All Periods"}`);
    lines.push("");
    lines.push("REVENUE");
    for (const item of report.revenue) {
      lines.push(`${"  ".repeat(item.level)}${item.name},${item.amount}`);
    }
    lines.push(`TOTAL REVENUE,${report.totalRevenue}`);
    lines.push("");
    lines.push("EXPENSES");
    for (const item of report.expenses) {
      lines.push(`${"  ".repeat(item.level)}${item.name},${item.amount}`);
    }
    lines.push(`TOTAL EXPENSES,${report.totalExpenses}`);
    lines.push("");
    lines.push(`NET INCOME,${report.netIncome}`);
  } else if ("assets" in report) {
    // Balance Sheet
    lines.push("BALANCE SHEET");
    lines.push(`As of: ${report.asOfDate}`);
    lines.push("");
    lines.push("ASSETS");
    for (const item of report.assets) {
      lines.push(`${"  ".repeat(item.level)}${item.name},${item.balance}`);
    }
    lines.push(`TOTAL ASSETS,${report.totalAssets}`);
    lines.push("");
    lines.push("LIABILITIES");
    for (const item of report.liabilities) {
      lines.push(`${"  ".repeat(item.level)}${item.name},${item.balance}`);
    }
    lines.push(`TOTAL LIABILITIES,${report.totalLiabilities}`);
    lines.push("");
    lines.push("EQUITY");
    for (const item of report.equity) {
      lines.push(`${"  ".repeat(item.level)}${item.name},${item.balance}`);
    }
    lines.push(`TOTAL EQUITY,${report.totalEquity}`);
    lines.push("");
    lines.push(`TOTAL LIABILITIES + EQUITY,${report.totalLiabilities + report.totalEquity}`);
  }

  return lines.join("\n");
}
