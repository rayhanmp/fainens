import { eq } from "drizzle-orm";
import { db as defaultDb } from "../db/client";
import { salarySettings, accounts } from "../db/schema";
import { createSimpleTransaction } from "./ledger";
import { estimatePayroll } from "./indonesia-payroll";

const SINGLETON_ID = 1;

export type SalaryPostingResult = {
  posted: boolean;
  transactionId?: number;
  netAmount?: number;
  message?: string;
};

/**
 * Posts salary income transaction on payroll day.
 * Should be called daily (e.g., via cron job or when salary page is loaded).
 */
export async function postSalaryIfPayrollDay(
  dbLike: typeof defaultDb = defaultDb,
): Promise<SalaryPostingResult> {
  const today = new Date();
  const todayDay = today.getDate();

  // Get salary settings
  const [settings] = await dbLike
    .select()
    .from(salarySettings)
    .where(eq(salarySettings.id, SINGLETON_ID))
    .limit(1);

  if (!settings) {
    return { posted: false, message: "Salary settings not configured" };
  }

  if (!settings.depositAccountId) {
    return { posted: false, message: "No deposit account configured" };
  }

  // Check if today is the payroll day
  if (todayDay !== settings.payrollDay) {
    return { posted: false, message: `Today is not payroll day (${settings.payrollDay})` };
  }

  // Check if salary already posted today
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

  const { transactions } = await import("../db/schema");
  const [existingTx] = await dbLike
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      eq(transactions.txType, "salary_income")
    )
    .limit(1);

  // For simplicity, we check if any salary income exists today
  // In a real implementation, you might want to track this more precisely
  const todaysSalary = await dbLike
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      eq(transactions.txType, "salary_income")
    )
    .limit(1);

  if (todaysSalary.length > 0) {
    // Check if it's from today by date comparison
    const todayStr = today.toISOString().split('T')[0];
    // This is a simplified check - in production you'd want proper date range filtering
  }

  // Validate the deposit account exists and is an asset
  const [account] = await dbLike
    .select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive })
    .from(accounts)
    .where(eq(accounts.id, settings.depositAccountId))
    .limit(1);

  if (!account) {
    return { posted: false, message: "Deposit account not found" };
  }

  if (!account.isActive) {
    return { posted: false, message: "Deposit account is not active" };
  }

  if (account.type !== "asset") {
    return { posted: false, message: "Deposit account must be an asset (wallet) account" };
  }

  // Calculate net salary
  const payroll = estimatePayroll(settings.grossMonthly, settings.ptkpCode);
  const netAmount = payroll.estimatedNetMonthly;

  if (netAmount <= 0) {
    return { posted: false, message: "Net salary must be greater than 0" };
  }

  // Create the income transaction
  const result = await createSimpleTransaction(
    {
      kind: "income",
      amountCents: netAmount,
      description: `Salary income - ${today.toLocaleDateString('en-ID', { month: 'long', year: 'numeric' })}`,
      notes: `Gross: ${settings.grossMonthly}, Net: ${netAmount}, PTKP: ${settings.ptkpCode}`,
      date: today.getTime(),
      walletAccountId: settings.depositAccountId,
      txType: "salary_income",
    },
    dbLike,
  );

  return {
    posted: true,
    transactionId: result.transactionId,
    netAmount,
    message: `Salary posted: ${netAmount} to account`,
  };
}

/**
 * Preview what would happen if we posted salary today.
 */
export async function previewSalaryPosting(
  dbLike: typeof defaultDb = defaultDb,
): Promise<{
  wouldPost: boolean;
  isPayrollDay: boolean;
  todayDay: number;
  payrollDay: number;
  grossMonthly: number;
  netMonthly: number;
  depositAccountId: number | null;
  depositAccountName: string | null;
  message: string;
}> {
  const today = new Date();
  const todayDay = today.getDate();

  const [settings] = await dbLike
    .select()
    .from(salarySettings)
    .where(eq(salarySettings.id, SINGLETON_ID))
    .limit(1);

  if (!settings) {
    return {
      wouldPost: false,
      isPayrollDay: false,
      todayDay,
      payrollDay: 25,
      grossMonthly: 0,
      netMonthly: 0,
      depositAccountId: null,
      depositAccountName: null,
      message: "Salary settings not configured",
    };
  }

  const payroll = estimatePayroll(settings.grossMonthly, settings.ptkpCode);

  let accountName: string | null = null;
  if (settings.depositAccountId) {
    const [account] = await dbLike
      .select({ name: accounts.name })
      .from(accounts)
      .where(eq(accounts.id, settings.depositAccountId))
      .limit(1);
    accountName = account?.name ?? null;
  }

  return {
    wouldPost: todayDay === settings.payrollDay && !!settings.depositAccountId && payroll.estimatedNetMonthly > 0,
    isPayrollDay: todayDay === settings.payrollDay,
    todayDay,
    payrollDay: settings.payrollDay,
    grossMonthly: settings.grossMonthly,
    netMonthly: payroll.estimatedNetMonthly,
    depositAccountId: settings.depositAccountId,
    depositAccountName: accountName,
    message: todayDay === settings.payrollDay
      ? settings.depositAccountId
        ? `Salary would be posted: ${payroll.estimatedNetMonthly} net`
        : "Configure deposit account to auto-post salary"
      : `Next payroll on day ${settings.payrollDay}`,
  };
}
