import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * While typing a nominal amount: insert Indonesian thousand separators (dots).
 * Pass the raw input value; non-digits are stripped.
 */
export function formatIdNominalInput(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits === '') return '';
  try {
    return BigInt(digits).toLocaleString('id-ID');
  } catch {
    return '';
  }
}

/** Parse a display string from {@link formatIdNominalInput} to integer rupiah. */
export function parseIdNominalToInt(formatted: string): number {
  const digits = formatted.replace(/\D/g, '');
  if (digits === '') return Number.NaN;
  return parseInt(digits, 10);
}

/** Parse a signed IDR display value such as "-Rp25.000" (or "-Rp 25.000") without losing its sign. */
export function parseSignedIdNominalToInt(formatted: string): number {
  let text = formatted.trim();
  if (!text) return Number.NaN;
  let negative = false;
  if (text.startsWith('(') && text.endsWith(')')) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.trimStart().startsWith('-')) negative = !negative;
  const digits = text.replace(/\D/g, '');
  if (!digits) return Number.NaN;
  const value = Number(digits);
  if (!Number.isSafeInteger(value)) return Number.NaN;
  return negative ? -value : value;
}

// Format the canonical integer-rupiah ledger unit.
export function formatCurrency(amount: number, currency = 'Rp'): string {
  const absolute = Math.abs(amount);
  const rupiah = Math.round(absolute); // IDR uses whole numbers, no cents
  const sign = amount < 0 ? '-' : '';
  
  // Format with Indonesian number format (dots for thousands, no decimals)
  const formatted = rupiah.toLocaleString('id-ID');
  return `${sign}${currency}${formatted}`;
}

// Format date (timestamp ms to locale date)
/** A plain number in the same Indonesian format as formatCurrency (dot thousands, comma decimals), e.g. "91,1". */
export function formatDecimal(value: number, maximumFractionDigits = 1, minimumFractionDigits = 0): string {
  return value.toLocaleString('id-ID', { minimumFractionDigits, maximumFractionDigits });
}

/** Date display preference from Settings → General ("How dates are displayed throughout Fainens"). */
export type DateFormatPreference = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' | 'DD MMM YYYY';
/** Fired by Settings after it saves, so date helpers pick up a changed preference without a reload. */
export const SETTINGS_CHANGED_EVENT = 'fainens:settings-changed';
const DATE_FORMATS: readonly DateFormatPreference[] = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD MMM YYYY'];
let cachedDateFormat: DateFormatPreference | null = null;

export function dateFormatPreference(): DateFormatPreference {
  if (cachedDateFormat) return cachedDateFormat;
  let stored: unknown;
  try {
    stored = (JSON.parse(localStorage.getItem('fainens-settings') ?? '{}') as { dateFormat?: unknown }).dateFormat;
  } catch {
    stored = undefined;
  }
  cachedDateFormat = DATE_FORMATS.includes(stored as DateFormatPreference) ? stored as DateFormatPreference : 'DD/MM/YYYY';
  return cachedDateFormat;
}

if (typeof window !== 'undefined') {
  const forget = () => { cachedDateFormat = null; };
  window.addEventListener('storage', forget);
  window.addEventListener(SETTINGS_CHANGED_EVENT, forget);
}

const pad = (value: number) => String(value).padStart(2, '0');
const monthName = (date: Date) => date.toLocaleDateString('en-US', { month: 'short' });
const weekdayName = (date: Date) => date.toLocaleDateString('en-US', { weekday: 'short' });
/** Formats that put the month first also put it first in shorter, written-out dates. */
const monthFirst = () => dateFormatPreference() === 'MM/DD/YYYY';

/** A calendar date in the user's chosen format, e.g. "18/10/2026" or "18 Oct 2026". */
export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  switch (dateFormatPreference()) {
    case 'MM/DD/YYYY': return `${pad(month)}/${pad(day)}/${year}`;
    case 'YYYY-MM-DD': return `${year}-${pad(month)}-${pad(day)}`;
    case 'DD MMM YYYY': return `${day} ${monthName(date)} ${year}`;
    default: return `${pad(day)}/${pad(month)}/${year}`;
  }
}

/** Day and month only, for compact labels and chart axes: "18 Oct" (or "Oct 18" for month-first users). */
export function formatDayMonth(timestamp: number): string {
  const date = new Date(timestamp);
  return monthFirst() ? `${monthName(date)} ${date.getDate()}` : `${date.getDate()} ${monthName(date)}`;
}

/** A written-out date with weekday, for list section headers: "Tue, 13 Oct 2026". */
export function formatWeekdayDate(timestamp: number): string {
  const date = new Date(timestamp);
  return monthFirst()
    ? `${weekdayName(date)}, ${monthName(date)} ${date.getDate()}, ${date.getFullYear()}`
    : `${weekdayName(date)}, ${date.getDate()} ${monthName(date)} ${date.getFullYear()}`;
}

/** 24-hour clock time, "17:04". */
export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export type PeriodDateRange = { startDate: number; endDate: number };

/** Return the active period whose calendar range contains the supplied date. */
/**
 * Last instant of a salary period. Period ends are stored as the start of the final calendar day
 * (local midnight, or UTC midnight for periods saved by an older UTC server), meaning "through the
 * end of that day"; any other value is an exact instant.
 */
export function inclusivePeriodEnd(endMs: number): number {
  const local = new Date(endMs);
  if (local.getHours() === 0 && local.getMinutes() === 0 && local.getSeconds() === 0 && local.getMilliseconds() === 0) {
    local.setHours(23, 59, 59, 999);
    return local.getTime();
  }
  if (endMs % 86_400_000 === 0) {
    const utc = new Date(endMs);
    return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(), 23, 59, 59, 999).getTime();
  }
  return endMs;
}

export function findCurrentPeriod<T extends PeriodDateRange>(periods: readonly T[], now = Date.now()): T | undefined {
  return periods
    .filter((period) => period.startDate <= now && now <= inclusivePeriodEnd(period.endDate))
    .sort((a, b) => b.startDate - a.startDate)[0];
}

/** Date and time in the user's date format, e.g. "18/10/2026, 17:04". Audit views pass `withSeconds`. */
export function formatDateTime(timestamp: number, { withSeconds = false }: { withSeconds?: boolean } = {}): string {
  const seconds = withSeconds ? `:${pad(new Date(timestamp).getSeconds())}` : '';
  return `${formatDate(timestamp)}, ${formatTime(timestamp)}${seconds}`;
}

/** A local calendar date suitable for a native `<input type="date">`. */
export function toLocalDateInputValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Turns a user-selected local calendar date into a snapshot instant. Historical
 * dates mean the end of that date; today means now, because tonight is not yet
 * a valid balance snapshot.
 */
export function snapshotTimestampForLocalDate(dateValue: string, now = Date.now()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  if (!match || !Number.isSafeInteger(now)) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const selected = new Date(year, month - 1, day);
  if (
    selected.getFullYear() !== year ||
    selected.getMonth() !== month - 1 ||
    selected.getDate() !== day
  ) return null;

  const today = toLocalDateInputValue(new Date(now));
  if (dateValue > today) return null;
  if (dateValue === today) return now;
  selected.setHours(23, 59, 59, 999);
  return selected.getTime();
}

// Format percentage
export function formatPercentage(value: number, decimals = 2): string {
  return `${value.toFixed(decimals)}%`;
}

// Format number with commas
export function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

// Get account type color (for UI badges)
export function getAccountTypeColor(type: string): string {
  const colors: Record<string, string> = {
    asset: 'bg-green-100 text-green-800',
    liability: 'bg-red-100 text-red-800',
    equity: 'bg-blue-100 text-blue-800',
    revenue: 'bg-purple-100 text-purple-800',
    expense: 'bg-orange-100 text-orange-800',
  };
  return colors[type] || 'bg-gray-100 text-gray-800';
}

// Get account type label
export function getAccountTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    asset: 'Asset',
    liability: 'Liability',
    equity: 'Equity',
    revenue: 'Revenue',
    expense: 'Expense',
  };
  return labels[type] || type;
}

// Format file size (bytes to human readable)
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Date utilities namespace
export const dateUtils = {
  // Convert timestamp (ms) to date input value (YYYY-MM-DD)
  toDateInputValue(ms: number): string {
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  // Convert date input value (YYYY-MM-DD) to timestamp (ms)
  fromDateInputValue(s: string): number {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
  },

  // Convert Date to datetime-local input value (YYYY-MM-DDTHH:MM)
  toDatetimeLocal(d: Date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  // Get start of local day in milliseconds
  startOfLocalDayMs(ms: number): number {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  },

  // Time constants (in milliseconds)
  timeConstants: {
    SECOND: 1000,
    MINUTE: 60 * 1000,
    HOUR: 60 * 60 * 1000,
    DAY: 24 * 60 * 60 * 1000,
    WEEK: 7 * 24 * 60 * 60 * 1000,
    MONTH: 30 * 24 * 60 * 60 * 1000, // Approximate
    YEAR: 365 * 24 * 60 * 60 * 1000, // Approximate
  },
};
