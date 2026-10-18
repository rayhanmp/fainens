import { DAY_MS } from './commitments.ts';

export type PeriodPacing = {
  /** 1-based calendar day of the period that `now` falls on; 0 before it starts, `totalDays` after it ends. */
  dayIndex: number;
  totalDays: number;
  /** Share of the period's time that has passed, 0..1. */
  elapsedRatio: number;
  status: 'upcoming' | 'active' | 'ended';
};

export type PaceTone = 'ok' | 'warning' | 'danger';

/** Spending is flagged once it runs this far ahead of the elapsed time. */
export const PACE_WARNING_MARGIN = 0.1;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const startOfDay = (ms: number) => new Date(new Date(ms).setHours(0, 0, 0, 0)).getTime();

/**
 * Where `now` sits inside a period, counted in local calendar days.
 * `endDate` is inclusive: a period ending at midnight on the 31st still contains the 31st.
 */
export function periodPacing(period: { startDate: number; endDate: number }, now: number): PeriodPacing {
  const firstDay = startOfDay(period.startDate);
  const lastDay = startOfDay(Math.max(period.startDate, period.endDate));
  const totalDays = Math.max(1, Math.round((lastDay - firstDay) / DAY_MS) + 1);
  const today = startOfDay(now);
  const dayOffset = Math.round((today - firstDay) / DAY_MS);
  const status = dayOffset < 0 ? 'upcoming' : dayOffset >= totalDays ? 'ended' : 'active';
  const dayIndex = status === 'upcoming' ? 0 : status === 'ended' ? totalDays : dayOffset + 1;
  // The end of the last day, so a period's final day reads as nearly complete rather than finished at dawn.
  const periodEnd = lastDay + DAY_MS;
  const elapsedRatio = status === 'active' ? clamp((now - firstDay) / (periodEnd - firstDay), 0, 1) : status === 'ended' ? 1 : 0;
  return { dayIndex, totalDays, elapsedRatio, status };
}

/** Share of a plan used, or null when there is no plan to measure against. */
export function budgetUsedRatio(actual: number, planned: number): number | null {
  if (planned <= 0) return null;
  return Math.max(0, actual / planned);
}

/** How spending pace compares with time pace: over plan is danger, running well ahead of the calendar is a warning. */
export function paceTone(usedRatio: number, elapsedRatio: number): PaceTone {
  if (usedRatio > 1) return 'danger';
  if (usedRatio > elapsedRatio + PACE_WARNING_MARGIN) return 'warning';
  return 'ok';
}

export function formatPercent(ratio: number): string {
  return `${Math.round(clamp(ratio, 0, 9.99) * 100)}%`;
}
