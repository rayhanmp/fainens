import { describe, expect, it } from "vitest";

import { milestones, monthsToReach, streak } from "./goal-progress";

const at = (year: number, month: number, day = 5) => new Date(year, month, day).getTime();

describe("goal progress", () => {
  it("finds the first time each quarter of the target was reached", () => {
    const entries = [
      { amount: 3_000_000, kind: "assign", createdAt: at(2026, 0) },
      { amount: 3_000_000, kind: "assign", createdAt: at(2026, 1) },
      { amount: -2_000_000, kind: "release", createdAt: at(2026, 2) },
      { amount: 6_000_000, kind: "assign", createdAt: at(2026, 3) },
    ];
    expect(milestones(entries, 10_000_000)).toEqual([
      { share: 25, at: at(2026, 0) },
      { share: 50, at: at(2026, 1) },
      { share: 75, at: at(2026, 3) },
      { share: 100, at: at(2026, 3) },
    ]);
    expect(milestones(entries, 0)).toEqual([]);
  });

  it("counts months in a row that got the monthly amount, without a month under way breaking it", () => {
    const entries = [
      { amount: 1_000_000, kind: "assign", createdAt: at(2026, 6) },
      { amount: 1_000_000, kind: "assign", createdAt: at(2026, 7) },
      { amount: 600_000, kind: "assign", createdAt: at(2026, 8, 1) },
      { amount: 400_000, kind: "assign", createdAt: at(2026, 8, 20) },
      { amount: -5_000_000, kind: "release", createdAt: at(2026, 8, 21) },
    ];
    // October has nothing yet: July to September still count.
    expect(streak(entries, 1_000_000, at(2026, 9, 10))).toBe(3);
    expect(streak([...entries, { amount: 1_000_000, kind: "assign", createdAt: at(2026, 9, 2) }], 1_000_000, at(2026, 9, 10))).toBe(4);
    // A missed month ends it.
    expect(streak(entries, 1_000_000, at(2026, 10, 10))).toBe(0);
    expect(streak(entries, 0, at(2026, 9, 10))).toBe(0);
  });

  it("works out when a goal is reached, with what it earns", () => {
    expect(monthsToReach(0, 12_000_000, 1_000_000)).toBe(12);
    expect(monthsToReach(5_000_000, 5_000_000, 0)).toBe(0);
    expect(monthsToReach(0, 1, 0)).toBeNull();
    // Earning 6% a year gets there a little sooner than putting in alone.
    expect(monthsToReach(0, 60_000_000, 1_000_000, 6)).toBe(53);
  });
});
