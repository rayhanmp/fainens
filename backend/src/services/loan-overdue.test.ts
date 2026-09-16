import { describe, expect, it } from "vitest";
import { getLoanOverdueStatus } from "./loan-overdue";

describe("loan API overdue flags", () => {
  const now = Date.UTC(2026, 8, 12, 12);
  it("returns false, not null, for active loans without due dates", () => {
    expect(getLoanOverdueStatus("active", null, now)).toEqual({ isOverdue: false, daysOverdue: 0 });
  });
  it("reports overdue days only for active loans with past due dates", () => {
    const due = new Date(now - 2 * 86_400_000);
    expect(getLoanOverdueStatus("active", due, now)).toEqual({ isOverdue: true, daysOverdue: 2 });
    expect(getLoanOverdueStatus("repaid", due, now)).toEqual({ isOverdue: false, daysOverdue: 0 });
    expect(getLoanOverdueStatus("written_off", due, now)).toEqual({ isOverdue: false, daysOverdue: 0 });
  });
  it("returns false for future dates and the exact due instant", () => {
    for (const due of [new Date(now), new Date(now + 86_400_000), new Date(NaN)]) {
      expect(getLoanOverdueStatus("active", due, now)).toEqual({ isOverdue: false, daysOverdue: 0 });
    }
  });
  it("does not treat the epoch timestamp as a missing date", () => {
    expect(getLoanOverdueStatus("active", new Date(0), 86_400_000)).toEqual({ isOverdue: true, daysOverdue: 1 });
  });
});
