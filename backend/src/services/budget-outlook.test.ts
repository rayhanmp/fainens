import { describe, expect, it } from "vitest";

import { percentile, robustHistoricalStats } from "./budget-outlook-math";

describe("budget outlook percentiles", () => {
  it("uses an interpolated median so two completed periods do not copy either period wholesale", () => {
    expect(percentile([0, 300_000], 0.5)).toBe(150_000);
  });

  it("keeps a single large historical one-off from becoming the typical estimate once there are three periods", () => {
    expect(percentile([0, 0, 300_000], 0.5)).toBe(0);
  });

  it("returns null when there is no completed-period evidence", () => {
    expect(percentile([], 0.5)).toBeNull();
  });

  it("downweights a large one-off while preserving a repeated large category", () => {
    const oneOff = robustHistoricalStats([0, 0, 6_000_000], 350_000);
    const repeated = robustHistoricalStats([6_000_000, 6_000_000, 6_000_000], 8_000_000);
    expect(oneOff.outlierCount).toBe(1);
    expect(oneOff.typical).toBeLessThan(100_000);
    expect(oneOff.high).toBeLessThan(500_000);
    expect(repeated.outlierCount).toBe(0);
    expect(repeated.typical).toBe(6_000_000);
  });

  it("lets a validated pattern review change only the outlier influence", () => {
    const baseline = robustHistoricalStats([0, 0, 6_000_000], 350_000);
    const reviewed = robustHistoricalStats([0, 0, 6_000_000], 350_000, 1);
    expect(reviewed.typical).toBeGreaterThan(baseline.typical);
    expect(reviewed.outlierCount).toBe(baseline.outlierCount);
  });
});
