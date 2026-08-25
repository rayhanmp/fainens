import { describe, expect, it } from "vitest";

import { addOneMonth, addOneYear, monthlyOccurrenceDate } from "./recurrence-calendar";

function localDate(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day, 12, 30, 0, 0).getTime();
}

describe("clamped recurring calendar arithmetic", () => {
  it("clamps January 31 to February month-end without drifting into March", () => {
    const result = new Date(addOneMonth(localDate(2025, 1, 31)));
    expect([result.getFullYear(), result.getMonth() + 1, result.getDate()]).toEqual([2025, 2, 28]);
  });

  it("clamps to leap-day in a leap year", () => {
    const result = new Date(addOneMonth(localDate(2024, 1, 31)));
    expect([result.getFullYear(), result.getMonth() + 1, result.getDate()]).toEqual([2024, 2, 29]);
  });

  it("clamps a leap-day annual occurrence to February 28", () => {
    const result = new Date(addOneYear(localDate(2024, 2, 29)));
    expect([result.getFullYear(), result.getMonth() + 1, result.getDate()]).toEqual([2025, 2, 28]);
  });

  it("preserves local wall-clock time", () => {
    const result = new Date(addOneMonth(localDate(2025, 5, 15)));
    expect([result.getHours(), result.getMinutes()]).toEqual([12, 30]);
  });

  it("treats payroll day 31 as month-end in a short month", () => {
    const result = new Date(monthlyOccurrenceDate(2025, 1, 31));
    expect([result.getFullYear(), result.getMonth() + 1, result.getDate()]).toEqual([2025, 2, 28]);
  });
});
