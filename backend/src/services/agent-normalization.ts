/** Canonical values shared by the agent's provider-facing adapters. */
export const DEFAULT_AGENT_TIMEZONE = "Asia/Jakarta";

type DateParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function safeTimeZone(value: unknown): string {
  const candidate = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_AGENT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return DEFAULT_AGENT_TIMEZONE;
  }
}

function isValidLocalDateTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? 0);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const calendar = new Date(Date.UTC(year, month - 1, day));
  return calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day;
}

function localPartsAtUtcInstant(instantMs: number, timeZone: string): DateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instantMs));
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function offsetForLocalDateTime(dateTime: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(dateTime);
  if (!match) return "+00:00";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? 0);
  const millisecond = Number((match[7] ?? "").padEnd(3, "0") || 0);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  if (!Number.isFinite(utcGuess)) return "+00:00";
  try {
    const local = localPartsAtUtcInstant(utcGuess, timeZone);
    const representedUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second, millisecond);
    const offsetMinutes = Math.round((representedUtc - utcGuess) / 60_000);
    const sign = offsetMinutes < 0 ? "-" : "+";
    const absolute = Math.abs(offsetMinutes);
    return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
  } catch {
    return timeZone === DEFAULT_AGENT_TIMEZONE ? "+07:00" : "+00:00";
  }
}

function hasExplicitOffset(value: string): boolean {
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
}

/** Normalize a local date or local date-time to a timezone-aware ISO value. */
export function normalizeAgentDateString(value: unknown, timeZone = DEFAULT_AGENT_TIMEZONE): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (hasExplicitOffset(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    if (!isValidLocalDateTime(`${trimmed}T00:00:00`)) return value;
    const local = `${trimmed}T12:00:00`;
    return `${local}${offsetForLocalDateTime(local, safeTimeZone(timeZone))}`;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(trimmed)) {
    if (!isValidLocalDateTime(trimmed)) return value;
    return `${trimmed}${offsetForLocalDateTime(trimmed, safeTimeZone(timeZone))}`;
  }
  return value;
}

/** Resolve a date boundary while preserving inclusive calendar-day semantics. */
export function normalizeAgentDateBoundary(value: unknown, edge: "start" | "end", timeZone = DEFAULT_AGENT_TIMEZONE): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    if (!isValidLocalDateTime(`${trimmed}T00:00:00`)) return value;
    const local = `${trimmed}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}`;
    const parsed = Date.parse(`${local}${offsetForLocalDateTime(local, safeTimeZone(timeZone))}`);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : value;
  }
  const normalized = normalizeAgentDateString(trimmed, timeZone);
  if (typeof normalized !== "string") return value;
  const parsed = Date.parse(normalized);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : value;
}

/** Normalize action payload date fields in one place. */
export function normalizeAgentDateInput(value: Record<string, unknown>, timeZone = DEFAULT_AGENT_TIMEZONE): Record<string, unknown> {
  const input = { ...value };
  if (typeof input.date === "string") {
    const trimmed = input.date.trim();
    if (!hasExplicitOffset(trimmed) && typeof input.dateMs === "number" && Number.isSafeInteger(input.dateMs) && input.dateMs >= 0) {
      input.date = new Date(input.dateMs).toISOString();
    } else {
      input.date = normalizeAgentDateString(trimmed, timeZone);
    }
    // `date` is canonical for action payloads. Keeping a second legacy
    // millisecond field invites models to emit two slightly different moments
    // and triggers an avoidable mismatch at execution time.
    delete input.dateMs;
  }
  if (typeof input.dueDate === "string") input.dueDate = normalizeAgentDateString(input.dueDate, timeZone);
  return input;
}
