import { DAY_MS, periodBoundaryDay, startOfLocalDay } from "../lib/calendar";

/**
 * Undated loans are never overdue; API flags must always be booleans. A loan becomes overdue on the
 * calendar day after its due date (WIB), however the due date was stored (local or UTC midnight).
 */
export function getLoanOverdueStatus(status: string, dueDate: Date | null, now = Date.now()): { isOverdue: boolean; daysOverdue: number } {
  const dueDateMs = dueDate?.getTime() ?? null;
  if (status !== "active" || dueDateMs === null || !Number.isFinite(dueDateMs)) return { isOverdue: false, daysOverdue: 0 };
  const daysOverdue = Math.round((startOfLocalDay(now) - startOfLocalDay(periodBoundaryDay(dueDateMs))) / DAY_MS);
  return daysOverdue > 0 ? { isOverdue: true, daysOverdue } : { isOverdue: false, daysOverdue: 0 };
}
