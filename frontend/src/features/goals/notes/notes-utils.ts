/**
 * Plain helpers for a goal's notes: reading amounts written the Indonesian way, counting
 * checklist items, and reading a typed date for the `@` picker.
 */

const UNITS: Record<string, number> = { rb: 1_000, ribu: 1_000, k: 1_000, jt: 1_000_000, juta: 1_000_000, m: 1_000_000_000, miliar: 1_000_000_000, milyar: 1_000_000_000 };

/**
 * Every amount in the text: "Rp1.400.000", "Rp 1,4 jt", "1,4 juta", "250rb", "15k". A bare number
 * counts only with Rp before it or a unit after it, so dates and counts aren't added up.
 */
export function parseAmounts(text: string): number[] {
  const amounts: number[] = [];
  const pattern = /(Rp\.?\s?)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?\s?(rb|ribu|k|jt|juta|miliar|milyar|m)?\b/gi;
  for (const match of text.matchAll(pattern)) {
    const [, rupiah, whole, fraction, unit] = match;
    if (!rupiah && !unit) continue;
    const base = Number(`${whole!.replace(/\./g, '')}${fraction ? `.${fraction}` : ''}`);
    if (!Number.isFinite(base)) continue;
    amounts.push(Math.round(base * (unit ? UNITS[unit.toLowerCase()]! : 1)));
  }
  return amounts;
}

export const sumAmounts = (text: string) => parseAmounts(text).reduce((sum, value) => sum + value, 0);

/** How many checklist items a page has, and how many are ticked. */
export function checklistCount(markdown: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const line of markdown.split('\n')) {
    const item = /^\s*[-*+]\s+\[( |x|X)\]/.exec(line);
    if (!item) continue;
    total += 1;
    if (item[1] !== ' ') done += 1;
  }
  return { done, total };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTHS_ID: Record<string, number> = { mei: 4, agu: 7, agt: 7, okt: 9, des: 11 };

const day = (year: number, month: number, date: number) => {
  const value = new Date(year, month, date);
  return value.getMonth() === month && value.getDate() === date ? value : null;
};

/** The month a word names, in English or Indonesian ("mar", "maret", "okt"); -1 when none. */
function monthOf(word: string): number {
  const key = word.slice(0, 3).toLowerCase();
  const english = MONTHS.indexOf(key);
  return english >= 0 ? english : MONTHS_ID[key] ?? -1;
}

/**
 * A date from what was typed after `@`: "today", "tomorrow", "next week", "in 3 days", "14 mar",
 * "mar 14", "14/3", "14/3/2027" or "2027-03-14". A day and month without a year means the next one.
 */
export function parseDateInput(input: string, now = new Date()): Date | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const after = (days: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  if (text === 'today' || text === 'hari ini') return today;
  if (text === 'tomorrow' || text === 'besok') return after(1);
  if (text === 'next week') return after(7);
  if (text === 'next month') return new Date(today.getFullYear(), today.getMonth() + 1, today.getDate());
  const inDays = /^in (\d{1,3}) (day|days|week|weeks)$/.exec(text);
  if (inDays) return after(Number(inDays[1]) * (inDays[2]!.startsWith('week') ? 7 : 1));
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) return day(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  // Without a year: this year's, or next year's once it's past.
  const upcoming = (month: number, date: number, year?: number) => {
    if (year !== undefined) return day(year < 100 ? 2000 + year : year, month, date);
    const thisYear = day(today.getFullYear(), month, date);
    if (!thisYear) return null;
    return thisYear < today ? day(today.getFullYear() + 1, month, date) : thisYear;
  };
  const slash = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(text);
  if (slash) return upcoming(Number(slash[2]) - 1, Number(slash[1]), slash[3] ? Number(slash[3]) : undefined);
  const dayMonth = /^(\d{1,2})\s+([a-z]{3,9})(?:\s+(\d{2,4}))?$/.exec(text);
  if (dayMonth && monthOf(dayMonth[2]!) >= 0) return upcoming(monthOf(dayMonth[2]!), Number(dayMonth[1]), dayMonth[3] ? Number(dayMonth[3]) : undefined);
  const monthDay = /^([a-z]{3,9})\s+(\d{1,2})(?:\s+(\d{2,4}))?$/.exec(text);
  if (monthDay && monthOf(monthDay[1]!) >= 0) return upcoming(monthOf(monthDay[1]!), Number(monthDay[2]), monthDay[3] ? Number(monthDay[3]) : undefined);
  return null;
}

const unescapeHtml = (value: string) => value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * Notes as plain markdown, for previews and copying: the notes' own tags (links to parts, dates,
 * highlights, link cards, sized pictures) become their words, links and pictures.
 */
export function readableMarkdown(markdown: string): string {
  return markdown
    .replace(/<span data-goal-ref="[^"]*">([^<]*)<\/span>/g, '$1')
    .replace(/<span data-date="[^"]*">([^<]*)<\/span>/g, '$1')
    .replace(/<mark[^>]*>([\s\S]*?)<\/mark>/g, '$1')
    .replace(/<div data-link-card="[^"]*" data-href="([^"]*)" data-title="([^"]*)"[^>]*>[\s\S]*?<\/div>/g, (_match, href: string, title: string) => `[${unescapeHtml(title) || unescapeHtml(href)}](${unescapeHtml(href)})`)
    .replace(/<img src="([^"]*)" alt="([^"]*)"[^>]*>/g, (_match, src: string, alt: string) => `![${unescapeHtml(alt)}](${unescapeHtml(src)})`);
}

/** "2027-03-14", the form a date is stored in notes. */
export const isoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** A stored date as a Date at local noon, or null. */
export function fromIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? day(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}
