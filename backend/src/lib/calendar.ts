/**
 * Calendar-day helpers in the app time zone (see app-timezone.ts). Salary periods store each
 * boundary as the start of a calendar day; these helpers turn that into the instants that
 * actually bound the day, and also understand values written by an older server running in UTC.
 */
export const DAY_MS = 86_400_000;

export function startOfLocalDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function endOfLocalDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

/** "YYYY-MM-DD" of the local calendar day containing `ms`. */
export function localDayKey(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Local midnight of a calendar date given as year, 1-based month and day. */
export function localDate(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day).getTime();
}

/**
 * The local midnight a stored period boundary means. Boundaries are local midnights, but a server
 * running in UTC wrote UTC midnights instead; those name the same calendar date in UTC.
 */
export function periodBoundaryDay(boundaryMs: number): number {
  if (boundaryMs === startOfLocalDay(boundaryMs)) return boundaryMs;
  if (boundaryMs % DAY_MS === 0) {
    const utc = new Date(boundaryMs);
    return localDate(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
  }
  return boundaryMs;
}

/** First instant of a period that starts on the stored boundary. */
export function inclusivePeriodStart(startMs: number): number {
  return periodBoundaryDay(startMs);
}

/** Last instant of a period whose end is stored as the start of its final day; other values are taken as exact. */
export function inclusivePeriodEnd(endMs: number): number {
  const isDayBoundary = endMs === startOfLocalDay(endMs) || endMs % DAY_MS === 0;
  return isDayBoundary ? endOfLocalDay(periodBoundaryDay(endMs)) : endMs;
}

/**
 * Adds whole months to `anchorMs`, keeping the anchor's day of month where it exists and clamping
 * to the month's last day otherwise. Always compute from the original anchor, never from a previous
 * clamped result, so a 31st-of-the-month schedule returns to the 31st after February.
 */
export function addMonthsFromAnchor(anchorMs: number, months: number): number {
  return addMonthsOnDay(anchorMs, months, new Date(anchorMs).getDate());
}

/** `ms` moved by whole months onto `dayOfMonth` (clamped to the month's length), keeping its time of day. */
export function addMonthsOnDay(ms: number, months: number, dayOfMonth: number): number {
  const source = new Date(ms);
  const target = new Date(source.getFullYear(), source.getMonth() + months, 1, source.getHours(), source.getMinutes(), source.getSeconds(), source.getMilliseconds());
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(Math.max(1, dayOfMonth), lastDay));
  return target.getTime();
}
