import { weekdayIndex } from '../../lib/utils';

export const ACTIVITY_WEEKS = 12;

export type ActivityDay = { day: string; count: number; removed: number };

/** A local calendar day as the server keys it: "2026-10-19". */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Midnight at the start of the first week the grid shows, in this browser's time. */
export function activityStart(now = new Date()): number {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - weekdayIndex(start) - (ACTIVITY_WEEKS - 1) * 7);
  return start.getTime();
}

export const entries = (count: number) => `${count.toLocaleString('id-ID')} ${count === 1 ? 'entry' : 'entries'}`;
