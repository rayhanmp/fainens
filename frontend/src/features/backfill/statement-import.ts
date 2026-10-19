/**
 * Turning a bank statement export into draft-ready rows: parsing the CSV, guessing which column
 * is which, reading Indonesian dates and amounts, spotting rows the ledger already has, and
 * pairing a debit on one account with the matching credit on another as a transfer.
 */

export type ParsedCsv = { headers: string[]; rows: string[][]; delimiter: string };

/** Splits CSV text on the delimiter that gives the most consistent column count across lines. */
export function parseCsv(text: string): ParsedCsv {
  // Excel and some banks prefix exports with a byte-order mark; drop it so the first header parses.
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = withoutBom.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [], delimiter: ',' };
  const candidates = [',', ';', '\t', '|'];
  const delimiter = candidates
    .map((candidate) => {
      const counts = lines.slice(0, 20).map((line) => splitLine(line, candidate).length);
      const mode = counts.sort((a, b) => a - b)[Math.floor(counts.length / 2)];
      const consistent = counts.filter((count) => count === mode).length;
      return { candidate, mode, consistent };
    })
    .filter((item) => item.mode > 1)
    .sort((a, b) => b.consistent - a.consistent || b.mode - a.mode)[0]?.candidate ?? ',';
  const table = lines.map((line) => splitLine(line, delimiter));
  const width = Math.max(...table.map((row) => row.length));
  const padded = table.map((row) => [...row, ...Array.from({ length: width - row.length }, () => '')]);
  return { headers: padded[0]!, rows: padded.slice(1), delimiter };
}

function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

export type DateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' | 'DD MMM YYYY';
export const DATE_FORMATS: DateFormat[] = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD MMM YYYY'];

export type AmountMode = 'signed' | 'split';

export type ColumnMapping = {
  date: number | null;
  /** Separate time column; a time written in the date cell itself is read without it. */
  time: number | null;
  description: number | null;
  /** Second description column, appended when present (statements often split merchant and note). */
  detail: number | null;
  dateFormat: DateFormat;
  amountMode: AmountMode;
  /** Signed mode: the one amount column. */
  amount: number | null;
  /** Signed mode: statements that write money out as a positive number. */
  negateSigned: boolean;
  /** Split mode: money out and money in. */
  debit: number | null;
  credit: number | null;
  /** Hand-kept lists name the account per row, so one file can cover every account. */
  account: number | null;
  /** A row naming a destination account is a transfer out of `account`. */
  toAccount: number | null;
  category: number | null;
  /** Expense/income (or DB/CR) per row; when set it decides the sign and the amount column may be all positive. */
  type: number | null;
};

const OUT_TYPES = /^(expense|pengeluaran|keluar|out|debit|debet|db|dr|withdrawal|transfer|tf)$/i;
const IN_TYPES = /^(income|pemasukan|masuk|in|credit|kredit|cr|deposit)$/i;

const match = (headers: string[], patterns: RegExp[]): number | null => {
  for (const pattern of patterns) {
    const index = headers.findIndex((header) => pattern.test(header));
    if (index >= 0) return index;
  }
  return null;
};

/** Best-effort mapping from header names; English and Indonesian bank wording are both covered. */
export function guessMapping(headers: string[]): ColumnMapping {
  const lower = headers.map((header) => header.trim().toLowerCase());
  const toAccount = match(lower, [/^(to account|to wallet|ke akun|ke rekening|akun tujuan|rekening tujuan|tujuan|destination|to)$/, /\b(to|ke)\b.*\b(account|wallet|akun|rekening)\b|tujuan|destination/]);
  const account = match(lower.map((header, index) => (index === toAccount ? '' : header)), [/^(account|wallet|akun|rekening|dompet|from account|dari akun|from|source)$/, /account|wallet|akun|rekening|dompet/]);
  const category = match(lower, [/^(category|kategori)$/, /category|kategori/]);
  const type = match(lower, [/^(type|jenis|tipe|kind|db\/cr|d\/k)$/, /transaction type|jenis transaksi/]);
  const time = match(lower, [/^(time|jam|pukul|waktu)$/, /^(time|jam|pukul)\b/]);
  const date = match(lower.map((header, index) => (index === time ? '' : header)), [/^(tanggal|tgl|date|posting date|transaction date|waktu)/, /date|tanggal|tgl/]);
  const debit = match(lower, [/^(debit|debet|withdrawal|keluar|dr)\b/, /debit|debet|withdraw|keluar/]);
  const credit = match(lower, [/^(credit|kredit|deposit|masuk|cr)\b/, /credit|kredit|deposit|masuk/]);
  const amount = match(lower, [/^(amount|nominal|jumlah|mutasi|nilai)/, /amount|nominal|jumlah|mutasi/]);
  const description = match(lower, [/^(description|keterangan|uraian|deskripsi|narasi|remark|transaksi|merchant|detail)/, /descr|keterangan|uraian|narasi|remark|memo|detail|transaksi/]);
  const detail = lower.findIndex((header, index) => index !== description && /detail|keterangan 2|note|catatan|reference|referensi/.test(header));
  const split = debit != null && credit != null && debit !== credit;
  const sample = lower.join(' ');
  const dateFormat: DateFormat = /yyyy-mm-dd|iso/.test(sample) ? 'YYYY-MM-DD' : 'DD/MM/YYYY';
  return {
    date,
    time,
    description,
    detail: detail >= 0 ? detail : null,
    dateFormat,
    amountMode: split ? 'split' : 'signed',
    amount: split ? null : amount ?? debit ?? credit,
    negateSigned: false,
    debit: split ? debit : null,
    credit: split ? credit : null,
    account,
    toAccount,
    category,
    type,
  };
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, mei: 4, jun: 5, jul: 6, aug: 7, agu: 7, agt: 7, sep: 8, sept: 8, oct: 9, okt: 9, nov: 10, dec: 11, des: 11,
  january: 0, februari: 1, february: 1, maret: 2, march: 2, april: 3, juni: 5, june: 5, juli: 6, july: 6, agustus: 7, august: 7, september: 8, oktober: 9, october: 9, november: 10, desember: 11, december: 11,
};

const TIME = String.raw`(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?(?:\.\d+)?\s*(am|pm)?`;
// A trailing zone ("Z", "+07:00", "WIB") is ignored: statement times are read as local time.
const TIME_ZONE = String.raw`(?:\s*(?:z|[+-]\d{2}:?\d{2}|wib|wita|wit))?`;

/** Hours, minutes and seconds from "14:22", "14.22", "14:22:01" or "2:22 PM"; null when it is not a time. */
export function parseStatementTime(value: string): [number, number, number] | null {
  const parts = value.trim().match(new RegExp(`^${TIME}${TIME_ZONE}$`, 'i'));
  return parts ? timeFromParts(parts[1]!, parts[2]!, parts[3], parts[4]) : null;
}

function timeFromParts(hourText: string, minuteText: string, secondText: string | undefined, meridiem: string | undefined): [number, number, number] | null {
  let hours = Number(hourText);
  const minutes = Number(minuteText);
  const seconds = Number(secondText ?? 0);
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0);
  }
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return [hours, minutes, seconds];
}

/** Moves a local-midnight timestamp to the given time of that day. */
export function withTime(dateMs: number, [hours, minutes, seconds]: [number, number, number]): number {
  const date = new Date(dateMs);
  date.setHours(hours, minutes, seconds, 0);
  return date.getTime();
}

/**
 * A local timestamp for a statement date, or null when the text does not fit the format. A time
 * after the date ("10/03/2026 14:22", "2026-03-10T14:22:01") is kept; without one it is midnight.
 */
export function parseStatementDate(value: string, format: DateFormat): number | null {
  const split = value.trim().match(new RegExp(`^(.*?)(?:(?:\\s+|T)${TIME}${TIME_ZONE})?$`, 'i'));
  const text = split?.[1]?.trim() ?? '';
  if (!text) return null;
  const time = split?.[3] != null ? timeFromParts(split[2]!, split[3], split[4], split[5]) : [0, 0, 0] as [number, number, number];
  if (!time) return null;
  let year: number; let month: number; let day: number;
  if (format === 'DD MMM YYYY') {
    const parts = text.match(/^(\d{1,2})[\s-]+([A-Za-z]+)[\s-]+(\d{2,4})$/);
    if (!parts) return null;
    const monthIndex = MONTHS[parts[2]!.toLowerCase()];
    if (monthIndex == null) return null;
    day = Number(parts[1]); month = monthIndex; year = Number(parts[3]);
  } else {
    const parts = text.split(/[/.-]/).map((part) => part.trim());
    if (parts.length !== 3 || parts.some((part) => !/^\d+$/.test(part))) return null;
    const numbers = parts.map(Number) as [number, number, number];
    if (format === 'YYYY-MM-DD') [year, month, day] = [numbers[0], numbers[1] - 1, numbers[2]];
    else if (format === 'MM/DD/YYYY') [month, day, year] = [numbers[0] - 1, numbers[1], numbers[2]];
    else [day, month, year] = [numbers[0], numbers[1] - 1, numbers[2]];
  }
  if (year < 100) year += 2000;
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const date = new Date(year, month, day);
  if (date.getMonth() !== month || date.getDate() !== day) return null;
  return withTime(date.getTime(), time);
}

/**
 * Whole rupiah from statement text. Handles "1.234.567,00", "1,234,567.00", "(1.234)", "-1.234",
 * "Rp 1.234", "1234.00 DB". Returns null for blanks and for anything that is not a number.
 */
export function parseStatementAmount(value: string): number | null {
  let text = value.trim();
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1); }
  if (/\b(db|dr)\b/i.test(text)) negative = true;
  if (/\bcr\b/i.test(text)) negative = false;
  text = text.replace(/\b(db|dr|cr)\b/gi, '').replace(/^(?:rp\.?|idr)\s*/i, '').replace(/\s/g, '');
  if (text.startsWith('-')) { negative = !negative; text = text.slice(1); }
  else if (text.startsWith('+')) text = text.slice(1);
  if (!/^[0-9]+(?:[.,][0-9]+)*$/.test(text)) return null;
  const lastSeparator = Math.max(text.lastIndexOf('.'), text.lastIndexOf(','));
  let integerPart = text;
  if (lastSeparator >= 0) {
    const fraction = text.slice(lastSeparator + 1);
    // A final group of three digits is a thousands group; one or two digits are decimals.
    if (fraction.length !== 3) integerPart = text.slice(0, lastSeparator);
  }
  const digits = integerPart.replace(/[.,]/g, '');
  if (!digits) return null;
  const amount = Number(digits);
  if (!Number.isSafeInteger(amount)) return null;
  return negative ? -amount : amount;
}

export type ParsedStatementRow = {
  rowNumber: number;
  dateMs: number | null;
  description: string;
  /** Negative is money out of the account, positive is money in. */
  amount: number | null;
  /** Raw names from the account, destination and category columns; empty when unmapped or blank. */
  accountText: string;
  toAccountText: string;
  categoryText: string;
  errors: string[];
};

/** Reads every data row through the mapping; rows that do not parse keep their errors and come along for review. */
export function parseStatementRows(rows: string[][], mapping: ColumnMapping): ParsedStatementRow[] {
  return rows.map((cells, index) => {
    const errors: string[] = [];
    const dateText = mapping.date == null ? '' : cells[mapping.date] ?? '';
    let dateMs = mapping.date == null ? null : parseStatementDate(dateText, mapping.dateFormat);
    if (dateMs == null) errors.push(mapping.date == null ? 'No date column' : `Unreadable date "${dateText}"`);
    const timeText = mapping.time == null ? '' : (cells[mapping.time] ?? '').trim();
    if (timeText) {
      const time = parseStatementTime(timeText);
      if (!time) errors.push(`Unreadable time "${timeText}"`);
      else if (dateMs != null) dateMs = withTime(dateMs, time);
    }
    const description = [mapping.description, mapping.detail]
      .filter((column): column is number => column != null)
      .map((column) => (cells[column] ?? '').trim())
      .filter(Boolean)
      .join(' · ');
    if (!description) errors.push('No description');
    let amount: number | null = null;
    if (mapping.amountMode === 'signed') {
      const text = mapping.amount == null ? '' : cells[mapping.amount] ?? '';
      amount = mapping.amount == null ? null : parseStatementAmount(text);
      if (amount != null && mapping.negateSigned) amount = -amount;
      if (amount == null) errors.push(mapping.amount == null ? 'No amount column' : `Unreadable amount "${text}"`);
    } else {
      const debitText = mapping.debit == null ? '' : cells[mapping.debit] ?? '';
      const creditText = mapping.credit == null ? '' : cells[mapping.credit] ?? '';
      const debit = debitText.trim() ? parseStatementAmount(debitText) : 0;
      const credit = creditText.trim() ? parseStatementAmount(creditText) : 0;
      if (debit == null || credit == null) errors.push(`Unreadable amount "${debit == null ? debitText : creditText}"`);
      else amount = Math.abs(credit) - Math.abs(debit);
    }
    const typeText = mapping.type == null ? '' : (cells[mapping.type] ?? '').trim();
    if (typeText && amount != null) {
      if (OUT_TYPES.test(typeText)) amount = -Math.abs(amount);
      else if (IN_TYPES.test(typeText)) amount = Math.abs(amount);
      else errors.push(`Unknown type "${typeText}"`);
    }
    if (amount === 0) errors.push('Amount is zero');
    const cell = (column: number | null) => (column == null ? '' : (cells[column] ?? '').trim());
    return {
      rowNumber: index + 2,
      dateMs,
      description,
      amount,
      accountText: cell(mapping.account),
      toAccountText: cell(mapping.toAccount),
      categoryText: cell(mapping.category),
      errors,
    };
  });
}

export type LedgerMatchCandidate = { id: number; dateMs: number; amount: number; description: string };

const DAY_MS = 86_400_000;

/**
 * Rows the ledger already has: same account, same signed amount, within a day of each other. Each
 * existing transaction can only absorb one statement row, so two identical coffees stay separate.
 */
export function findExistingMatches(
  rows: Array<{ key: string; dateMs: number | null; amount: number | null }>,
  existing: LedgerMatchCandidate[],
): Map<string, LedgerMatchCandidate> {
  const matches = new Map<string, LedgerMatchCandidate>();
  const taken = new Set<number>();
  for (const row of rows) {
    const rowDate = row.dateMs;
    const rowAmount = row.amount;
    if (rowDate == null || rowAmount == null) continue;
    const candidate = existing
      .filter((item) => !taken.has(item.id) && item.amount === rowAmount && Math.abs(item.dateMs - rowDate) <= DAY_MS)
      .sort((a, b) => Math.abs(a.dateMs - rowDate) - Math.abs(b.dateMs - rowDate))[0];
    if (candidate) {
      matches.set(row.key, candidate);
      taken.add(candidate.id);
    }
  }
  return matches;
}

export type TransferPair = { outKey: string; inKey: string };

/**
 * A debit on one account and an equal credit on another within `windowDays` are one transfer.
 * Closest dates pair first; each row pairs at most once.
 */
export function pairTransfers(
  rows: Array<{ key: string; accountId: number; dateMs: number | null; amount: number | null }>,
  windowDays = 2,
): TransferPair[] {
  const outs = rows.filter((row) => row.amount != null && row.amount < 0 && row.dateMs != null);
  const ins = rows.filter((row) => row.amount != null && row.amount > 0 && row.dateMs != null);
  const candidates: Array<{ out: typeof outs[number]; in: typeof ins[number]; gap: number }> = [];
  for (const out of outs) {
    for (const incoming of ins) {
      if (incoming.accountId === out.accountId || incoming.amount !== -out.amount!) continue;
      const gap = Math.abs(incoming.dateMs! - out.dateMs!);
      if (gap <= windowDays * DAY_MS) candidates.push({ out, in: incoming, gap });
    }
  }
  candidates.sort((a, b) => a.gap - b.gap);
  const used = new Set<string>();
  const pairs: TransferPair[] = [];
  for (const candidate of candidates) {
    if (used.has(candidate.out.key) || used.has(candidate.in.key)) continue;
    used.add(candidate.out.key);
    used.add(candidate.in.key);
    pairs.push({ outKey: candidate.out.key, inKey: candidate.in.key });
  }
  return pairs;
}

/** Finds an account or category by name, ignoring case, spacing and punctuation ("BNI", "bni ", "B.N.I"). */
export function matchByName<T extends { id: number; name: string }>(items: T[], name: string): T | undefined {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = normalize(name);
  if (!target) return undefined;
  return items.find((item) => normalize(item.name) === target);
}

/** A stable reference for a statement row so a re-import can be recognised later. */
export function statementReference(accountId: number, dateMs: number, amount: number, description: string): string {
  let hash = 0;
  for (const char of `${description}`) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  // Local date and time, as written on the statement; the UTC date would be a day early before 07:00 WIB.
  const date = new Date(dateMs);
  const pad = (value: number) => String(value).padStart(2, '0');
  const when = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `stmt:${accountId}:${when}:${amount}:${hash.toString(36)}`;
}
