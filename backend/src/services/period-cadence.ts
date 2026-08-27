/** Calendar helpers for salary periods. Dates intentionally use the server's
 * local calendar because salary/payroll dates are human calendar boundaries. */
export function payrollStart(year: number, month: number, payrollDay: number): Date {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(payrollDay, lastDay));
}

export function followingPayrollStart(startDate: number, payrollDay: number): number {
  const start = new Date(startDate);
  return payrollStart(start.getFullYear(), start.getMonth() + 1, payrollDay).getTime();
}

/** First configured payroll boundary strictly after an inclusive period end. */
export function firstPayrollStartAfter(endDate: number, payrollDay: number): number {
  const dayAfterEnd = new Date(endDate);
  dayAfterEnd.setDate(dayAfterEnd.getDate() + 1);
  let candidate = payrollStart(dayAfterEnd.getFullYear(), dayAfterEnd.getMonth(), payrollDay);
  if (candidate.getTime() < dayAfterEnd.getTime()) {
    candidate = payrollStart(dayAfterEnd.getFullYear(), dayAfterEnd.getMonth() + 1, payrollDay);
  }
  return candidate.getTime();
}

/** End date of a payroll period: one local calendar day before next payroll day. */
export function payrollPeriodEnd(startDate: number, payrollDay: number): number {
  const end = new Date(followingPayrollStart(startDate, payrollDay));
  end.setDate(end.getDate() - 1);
  return end.getTime();
}
