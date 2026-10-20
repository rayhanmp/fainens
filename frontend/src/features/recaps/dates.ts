export const DAY_MS = 86_400_000;

/** Recap days are local midnights in the server's time zone. Noon of the same instant lands on the same
 * calendar date for any zone within ±12h, so dates read the same whether the server runs in WIB or UTC. */
export const recapDay = (ms: number) => new Date(ms + DAY_MS / 2);
export const recapDayKey = (ms: number) => recapDay(ms).toISOString().slice(0, 10);
export const formatRecapDay = (ms: number, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en', { ...options, timeZone: 'UTC' }).format(recapDay(ms));
/** Monday-first weekday index of a recap day. */
export const recapWeekday = (ms: number) => (recapDay(ms).getUTCDay() + 6) % 7;

export function periodDateRange(period: { startDate: number; endDate: number }) {
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  return `${formatRecapDay(period.startDate, options)} – ${formatRecapDay(period.endDate, options)}`;
}
