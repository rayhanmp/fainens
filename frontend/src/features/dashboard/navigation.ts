export type PeriodStep = 'older' | 'newer';

/** The period next to the selected one. Periods are listed newest first, as the period picker shows them. */
export function adjacentPeriodId(periods: readonly { id: number }[], selectedId: string, step: PeriodStep): string | null {
  const index = periods.findIndex((period) => String(period.id) === selectedId);
  if (index < 0) return null;
  const next = periods[step === 'older' ? index + 1 : index - 1];
  return next ? String(next.id) : null;
}

/** Which period a horizontal swipe asks for, or null when the gesture was too short or mostly vertical. */
export function swipeStep(dx: number, dy: number, threshold = 48): PeriodStep | null {
  if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  // Swiping left pulls in what is to the right, like the picker's "next" chevron.
  return dx < 0 ? 'newer' : 'older';
}

/** "Today" or "Yesterday" for recent timestamps in local time, otherwise null so the caller shows a date. */
export function relativeDay(timestamp: number, now: number): 'Today' | 'Yesterday' | null {
  const day = (ms: number) => {
    const date = new Date(ms);
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  };
  const diff = Math.round((day(now) - day(timestamp)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return null;
}
