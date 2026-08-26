import { lte } from "drizzle-orm";

import { db } from "../db/client";
import { salaryPeriods } from "../db/schema";
import { inclusivePeriodEnd } from "./period-locking";

export type PeriodCoverage = {
  complete: number[];
  partial: number[];
  skipped: number[];
  unknown: number[];
  isComparable: boolean;
  warnings: string[];
};

/** Coverage is evidence about data completeness, never an inference from zero rows. */
export async function getPeriodCoverage(startMs: number, endMs: number): Promise<PeriodCoverage> {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) throw new Error("Invalid coverage range");
  const periods = await db.select({
    id: salaryPeriods.id,
    name: salaryPeriods.name,
    startDate: salaryPeriods.startDate,
    endDate: salaryPeriods.endDate,
    coverageStatus: salaryPeriods.coverageStatus,
  }).from(salaryPeriods).where(lte(salaryPeriods.startDate, endMs));
  const coverage: PeriodCoverage = {
    complete: [], partial: [], skipped: [], unknown: [], isComparable: true, warnings: [],
  };
  for (const period of periods) {
    if (Number(period.startDate) > endMs || inclusivePeriodEnd(Number(period.endDate)) < startMs) continue;
    const status = period.coverageStatus as keyof Pick<PeriodCoverage, "complete" | "partial" | "skipped" | "unknown">;
    (coverage[status] ?? coverage.unknown).push(period.id);
  }
  const incomplete = [...coverage.partial, ...coverage.skipped, ...coverage.unknown];
  coverage.isComparable = incomplete.length === 0;
  if (coverage.skipped.length) coverage.warnings.push("Selected range includes skipped periods; recorded activity is not zero activity.");
  if (coverage.partial.length) coverage.warnings.push("Selected range includes partially captured periods.");
  if (coverage.unknown.length) coverage.warnings.push("Selected range includes periods with unknown coverage.");
  return coverage;
}
