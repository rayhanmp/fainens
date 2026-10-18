type TrendPoint = { label: string; asOfMs: number };

/** Labels of the first point in each calendar month, for the weekly ranges' axis; January (or a first tick in another year) also names the year. */
export function monthTicks(rows: readonly TrendPoint[]): Array<{ label: string; text: string }> {
  const out: Array<{ label: string; text: string }> = [];
  const spansYears = rows.length > 0 && rows.some((row) => new Date(row.asOfMs).getFullYear() !== new Date(rows[rows.length - 1].asOfMs).getFullYear());
  let previousMonth: string | null = null;
  for (const row of rows) {
    const date = new Date(row.asOfMs);
    const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
    if (monthKey === previousMonth) continue;
    previousMonth = monthKey;
    const withYear = date.getMonth() === 0 || (out.length === 0 && spansYears);
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    // "Nov '26" rather than "Nov 26", which reads as a day of the month.
    out.push({ label: row.label, text: withYear ? `${month} '${String(date.getFullYear()).slice(-2)}` : month });
  }
  return out;
}

/** The first point on or after each salary-period start inside the series, excluding the series' own first point. */
export function paydayMarkers(rows: readonly TrendPoint[], periods: readonly { name: string; startDate: number }[]): Array<{ label: string; name: string }> {
  if (rows.length < 2) return [];
  const first = rows[0].asOfMs;
  const last = rows[rows.length - 1].asOfMs;
  const seen = new Set<string>();
  const out: Array<{ label: string; name: string }> = [];
  for (const period of [...periods].sort((a, b) => a.startDate - b.startDate)) {
    if (period.startDate <= first || period.startDate > last) continue;
    const row = rows.find((candidate) => candidate.asOfMs >= period.startDate);
    if (!row || row === rows[0] || seen.has(row.label)) continue;
    seen.add(row.label);
    out.push({ label: row.label, name: period.name });
  }
  return out;
}
