import { describe, expect, it } from 'vitest';
import { firstPayrollStartAfter, payrollPeriodEnd, payrollStart } from './period-cadence';

function localYmd(ms: number) {
  const date = new Date(ms);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()];
}

describe('payroll period cadence', () => {
  it('uses the configured 25th-to-24th calendar cycle, not a fixed 30-day duration', () => {
    const april25 = payrollStart(2026, 3, 25).getTime();
    expect(localYmd(payrollPeriodEnd(april25, 25))).toEqual([2026, 5, 24]);

    const august25 = payrollStart(2026, 7, 25).getTime();
    expect(localYmd(payrollPeriodEnd(august25, 25))).toEqual([2026, 9, 24]);
  });

  it('starts return backfill at the next payroll boundary after the last recorded period', () => {
    expect(localYmd(firstPayrollStartAfter(payrollStart(2026, 3, 25).getTime() - 24 * 60 * 60 * 1000, 25))).toEqual([2026, 4, 25]);
    expect(localYmd(firstPayrollStartAfter(new Date(2026, 3, 30).getTime(), 25))).toEqual([2026, 5, 25]);
  });

  it('clamps a payroll day that does not exist in a short month', () => {
    const january31 = payrollStart(2026, 0, 31).getTime();
    expect(localYmd(payrollPeriodEnd(january31, 31))).toEqual([2026, 2, 27]);
  });
});
