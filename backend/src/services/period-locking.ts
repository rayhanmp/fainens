import { eq, lte } from "drizzle-orm";

import { db as defaultDb } from "../db/client";
import { salaryPeriods } from "../db/schema";

export const DAY_MS = 24 * 60 * 60 * 1000;

export type PeriodState = {
  id: number;
  startDate: number;
  endDate: number;
  status: string;
};

export class PeriodLockedError extends Error {
  constructor(public readonly periodId: number) {
    super(`Period ${periodId} is closed; reopen it before changing its accounting history`);
  }
}

export function inclusivePeriodEnd(endMs: number): number {
  return endMs % DAY_MS === 0 ? endMs + DAY_MS - 1 : endMs;
}

export function periodContainsDate(period: Pick<PeriodState, "startDate" | "endDate">, dateMs: number): boolean {
  return dateMs >= Number(period.startDate) && dateMs <= inclusivePeriodEnd(Number(period.endDate));
}

/**
 * Canonical read-side membership for a selected salary period.
 *
 * A null period ID means the journal has not been assigned. It must never be
 * silently attributed to every period whose date range happens to contain it:
 * old reversals and recovery adjustments are commonly dated when they were
 * entered, rather than when the corrected activity occurred. Callers that
 * need unassigned history should query it explicitly as its own bucket.
 */
export function assignedPeriodMembership(periodId: number | null | undefined, periodColumn: any) {
  return periodId == null ? undefined : eq(periodColumn, periodId);
}

export async function findPeriodForDate(dateMs: number, dbLike: any = defaultDb): Promise<PeriodState | null> {
  if (!Number.isFinite(dateMs)) throw new Error("Invalid period lookup date");
  const candidates = await dbLike
    .select({
      id: salaryPeriods.id,
      startDate: salaryPeriods.startDate,
      endDate: salaryPeriods.endDate,
      status: salaryPeriods.status,
    })
    .from(salaryPeriods)
    .where(lte(salaryPeriods.startDate, dateMs));
  const period = candidates
    .filter((candidate: PeriodState) => periodContainsDate(candidate, dateMs))
    .sort((a: PeriodState, b: PeriodState) => Number(b.startDate) - Number(a.startDate))[0];
  return period ?? null;
}

/**
 * Resolve the only valid period for a journal date and refuse a closed period.
 * Callers cannot use a supplied period ID to smuggle a backdated journal into
 * a different (open) period.
 */
export async function assertJournalPeriodOpen(
  dateMs: number,
  requestedPeriodId: number | null | undefined,
  dbLike: any = defaultDb,
): Promise<number | null> {
  const datedPeriod = await findPeriodForDate(dateMs, dbLike);
  if (requestedPeriodId != null) {
    const selected = (await dbLike
      .select({
        id: salaryPeriods.id,
        startDate: salaryPeriods.startDate,
        endDate: salaryPeriods.endDate,
        status: salaryPeriods.status,
      })
      .from(salaryPeriods)
      .where(eq(salaryPeriods.id, requestedPeriodId))
      .limit(1))[0] as PeriodState | undefined;
    if (!selected) throw new Error(`Period not found: ${requestedPeriodId}`);
    if (!periodContainsDate(selected, dateMs)) {
      throw new Error(`Period ${requestedPeriodId} does not contain the journal date`);
    }
    if (datedPeriod && datedPeriod.id !== selected.id) {
      throw new Error("Journal date belongs to a different period");
    }
  }
  const resolved = datedPeriod ?? null;
  if (resolved?.status === "closed") throw new PeriodLockedError(resolved.id);
  return resolved?.id ?? null;
}

/** Same policy as above, rechecked inside a synchronous SQLite write transaction. */
export function assertPreparedJournalPeriodOpenSync(
  tx: any,
  input: { dateMs: number; periodId: number | null },
): void {
  const candidates = tx
    .select({
      id: salaryPeriods.id,
      startDate: salaryPeriods.startDate,
      endDate: salaryPeriods.endDate,
      status: salaryPeriods.status,
    })
    .from(salaryPeriods)
    .where(lte(salaryPeriods.startDate, input.dateMs))
    .all() as PeriodState[];
  const datedPeriod = candidates
    .filter((candidate) => periodContainsDate(candidate, input.dateMs))
    .sort((a, b) => Number(b.startDate) - Number(a.startDate))[0];
  if ((datedPeriod?.id ?? null) !== input.periodId) {
    throw new Error("Journal period changed while posting; retry");
  }
  if (datedPeriod?.status === "closed") throw new PeriodLockedError(datedPeriod.id);
}

export async function assertPeriodOpen(periodId: number, dbLike: any = defaultDb): Promise<PeriodState> {
  const period = (await dbLike
    .select({
      id: salaryPeriods.id,
      startDate: salaryPeriods.startDate,
      endDate: salaryPeriods.endDate,
      status: salaryPeriods.status,
    })
    .from(salaryPeriods)
    .where(eq(salaryPeriods.id, periodId))
    .limit(1))[0] as PeriodState | undefined;
  if (!period) throw new Error(`Period not found: ${periodId}`);
  if (period.status === "closed") throw new PeriodLockedError(period.id);
  return period;
}
