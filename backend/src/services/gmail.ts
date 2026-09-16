import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { load } from "cheerio";
import { env } from "../lib/env";

export const GMAIL_BNI_SOURCE = "gmail:bni";
const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const DAY_MS = 24 * 60 * 60 * 1000;

type GmailHeader = { name: string; value: string };
type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
};

export type GmailMessage = {
  id: string;
  internalDate?: string;
  payload?: GmailPart;
};

export type ParsedWondrTransaction = {
  type: "expense";
  amount: number;
  description: string;
  category: string;
  date: string;
  place: string | null;
  notes: string;
  memo: string;
  fromAccount: string | null;
  toAccount: null;
  confidence: number;
  reference: string | null;
  transactionTime: string | null;
  transactionType: string | null;
  rrnCode: string | null;
};

export type ParsedWondrEmail = {
  messageId: string;
  parsed: ParsedWondrTransaction;
  rawMessage: string;
};

export class GmailApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "GmailApiError";
  }
}

function base64UrlEncode(value: Buffer): string {
  return value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="), "base64");
}

/** Encrypt long-lived OAuth credentials before they enter SQLite. */
export function encryptGmailRefreshToken(token: string): string {
  const key = createHash("sha256").update(env.SESSION_SECRET).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(base64UrlEncode).join(".");
}

export function decryptGmailRefreshToken(value: string): string {
  const [ivValue, tagValue, ciphertextValue] = value.split(".");
  if (!ivValue || !tagValue || !ciphertextValue) throw new Error("Invalid encrypted Gmail token");
  const key = createHash("sha256").update(env.SESSION_SECRET).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, base64UrlDecode(ivValue));
  decipher.setAuthTag(base64UrlDecode(tagValue));
  return Buffer.concat([decipher.update(base64UrlDecode(ciphertextValue)), decipher.final()]).toString("utf8");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function headerValue(headers: GmailHeader[] | undefined, name: string): string | null {
  const header = headers?.find((item) => item.name.toLowerCase() === name.toLowerCase());
  return header ? normalizeWhitespace(header.value) : null;
}

function decodeQuotedPrintable(value: string): string {
  const binary = value
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  return Buffer.from(binary, "latin1").toString("utf8");
}

function decodeBase64Url(value: string, transferEncoding?: string): string {
  const decoded = base64UrlDecode(value).toString("utf8");
  return transferEncoding?.toLowerCase() === "quoted-printable" ? decodeQuotedPrintable(decoded) : decoded;
}

function bodyParts(part: GmailPart | undefined): Array<{ mimeType: string; data: string; headers?: GmailHeader[] }> {
  if (!part) return [];
  const result: Array<{ mimeType: string; data: string; headers?: GmailHeader[] }> = [];
  if (part.body?.data) {
    result.push({
      mimeType: part.mimeType ?? "text/plain",
      data: decodeBase64Url(part.body.data, headerValue(part.headers, "Content-Transfer-Encoding") ?? undefined),
      headers: part.headers,
    });
  }
  for (const child of part.parts ?? []) result.push(...bodyParts(child));
  return result;
}

function sectionValues($: ReturnType<typeof load>, heading: string): string[] {
  const values: string[] = [];
  $("td.account-title").each((_index, element) => {
    if (normalizeWhitespace($(element).text()).toLowerCase() !== heading.toLowerCase()) return;
    const table = $(element).closest("table");
    table.find("tr").each((_rowIndex, row) => {
      const cells = $(row).children("td").map((_cellIndex, cell) => normalizeWhitespace($(cell).text())).get().filter(Boolean);
      if (cells.length === 1 && cells[0].toLowerCase() === heading.toLowerCase()) return;
      values.push(...cells);
    });
  });
  return [...new Set(values)];
}

function fieldValues($: ReturnType<typeof load>): Map<string, string> {
  const fields = new Map<string, string>();
  $("tr").each((_index, row) => {
    const cells = $(row).children("td").map((_cellIndex, cell) => normalizeWhitespace($(cell).text())).get().filter(Boolean);
    if (cells.length < 2) return;
    fields.set(cells[0].toLowerCase(), cells[cells.length - 1]);
  });
  return fields;
}

function parseRupiah(value: string | null): number | null {
  if (!value) return null;
  const digits = value.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const amount = Number(digits);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function parseLocalDate(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (!match) return null;
  const months: Record<string, number> = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9,
    sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  };
  const month = months[match[2].toLowerCase()];
  if (!month) return null;
  const day = Number(match[1]);
  const year = Number(match[3]);
  if (!Number.isInteger(day) || !Number.isInteger(year) || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateFromInternalDate(internalDate?: string): string {
  const timestamp = Number(internalDate);
  if (!Number.isFinite(timestamp)) return new Date().toISOString().slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(timestamp));
}

function suggestCategory(merchant: string): { name: string; confidence: number } {
  const normalized = merchant.toLowerCase();
  if (/sogogi|restaurant|resto|cafe|coffee|warung|mcd|starbucks|food|dining|bakery|pizza|sushi/.test(normalized)) {
    return { name: "Food & Dining", confidence: 0.9 };
  }
  if (/grab|gojek|bluebird|taxi|pertamina|shell|toll|transport/.test(normalized)) {
    return { name: "Transportation", confidence: 0.88 };
  }
  if (/tokopedia|shopee|lazada|indomaret|alfamart|shopping|mall/.test(normalized)) {
    return { name: "Shopping", confidence: 0.82 };
  }
  return { name: "Others", confidence: 0.55 };
}

/** Parse the structured HTML notification sent by wondr/BNI. */
export function parseWondrBniEmail(message: GmailMessage): ParsedWondrEmail | null {
  const headers = message.payload?.headers;
  const senderHeader = headerValue(headers, "From") ?? "";
  const senderMatch = senderHeader.match(/<([^>]+)>/);
  const sender = (senderMatch?.[1] ?? senderHeader).trim().toLowerCase();
  const subject = headerValue(headers, "Subject") ?? "";
  if (sender !== "wondr@bni.co.id" || !/transaction\s+successful/i.test(subject)) return null;

  const bodies = bodyParts(message.payload);
  const html = bodies.find((body) => body.mimeType.toLowerCase() === "text/html")?.data;
  const plain = bodies.find((body) => body.mimeType.toLowerCase() === "text/plain")?.data;
  const $ = load(html ?? `<pre>${plain ?? ""}</pre>`);
  const fields = fieldValues($);
  const recipient = sectionValues($, "Recipient");
  const sourceFunds = sectionValues($, "Source of funds");
  const description = recipient[0] ?? fields.get("recipient") ?? null;
  const amount = parseRupiah(fields.get("amount") ?? fields.get("total") ?? null);
  if (!description || amount == null) return null;

  const date = parseLocalDate(fields.get("date") ?? null) ?? dateFromInternalDate(message.internalDate);
  const time = fields.get("time") ?? null;
  const category = suggestCategory(description);
  const sourceAccount = sourceFunds.length > 0 ? sourceFunds.join(" • ") : null;
  const reference = fields.get("reference id") ?? null;
  const rrnCode = fields.get("rrn code") ?? null;
  const transactionType = fields.get("transaction type") ?? null;
  const notes = [
    "Imported from wondr by BNI email",
    transactionType ? `Type: ${transactionType}` : null,
    time ? `Time: ${time}` : null,
    reference ? `Reference ID: ${reference}` : null,
    rrnCode ? `RRN: ${rrnCode}` : null,
  ].filter(Boolean).join(" · ");
  const parsed: ParsedWondrTransaction = {
    type: "expense",
    amount,
    description,
    category: category.name,
    date,
    place: recipient[1] ?? null,
    notes,
    memo: notes,
    fromAccount: sourceAccount,
    toAccount: null,
    confidence: Math.min(0.99, 0.65 + category.confidence * 0.2 + (reference ? 0.08 : 0)),
    reference,
    transactionTime: time,
    transactionType,
    rrnCode,
  };
  const rawMessage = [
    `Gmail: ${sender}`,
    `Subject: ${subject}`,
    `Transaction: ${description}`,
    `Amount: Rp${amount.toLocaleString("id-ID")}`,
    `Date: ${date}${time ? ` ${time}` : ""}`,
  ].join("\n");
  return { messageId: message.id, parsed, rawMessage };
}

async function gmailFetch<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new GmailApiError(`Gmail API request failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`, response.status);
  }
  return response.json() as Promise<T>;
}

export async function refreshGmailAccessToken(refreshToken: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
  const data = await response.json().catch(() => ({})) as { access_token?: string; error?: string };
  if (!response.ok || !data.access_token) throw new GmailApiError(`Could not refresh Gmail access token${data.error ? `: ${data.error}` : ""}`, response.status);
  return data.access_token;
}

/** Revoke the Google grant when the user disconnects Gmail from Fainens. */
export async function revokeGmailToken(token: string): Promise<void> {
  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
  if (!response.ok) {
    throw new GmailApiError(`Could not revoke Gmail authorization (${response.status})`, response.status);
  }
}

export async function getGmailProfile(accessToken: string): Promise<{ emailAddress: string }> {
  return gmailFetch<{ emailAddress: string }>(accessToken, "profile");
}

export async function listWondrBniEmails(refreshToken: string, days = 30): Promise<ParsedWondrEmail[]> {
  const accessToken = await refreshGmailAccessToken(refreshToken);
  const since = new Date(Date.now() - days * DAY_MS);
  const dateQuery = `${since.getUTCFullYear()}/${String(since.getUTCMonth() + 1).padStart(2, "0")}/${String(since.getUTCDate()).padStart(2, "0")}`;
  const query = encodeURIComponent(`from:(wondr@bni.co.id) after:${dateQuery}`);
  const result: ParsedWondrEmail[] = [];
  let pageToken: string | undefined;
  // Keep a manual sync bounded even if the mailbox has a very large history.
  for (let page = 0; page < 10; page += 1) {
    const suffix = `messages?maxResults=100&q=${query}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const listed = await gmailFetch<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(accessToken, suffix);
    for (const listedMessage of listed.messages ?? []) {
      const message = await gmailFetch<GmailMessage>(accessToken, `messages/${encodeURIComponent(listedMessage.id)}?format=full`);
      const parsed = parseWondrBniEmail(message);
      if (parsed) result.push(parsed);
    }
    if (!listed.nextPageToken) break;
    pageToken = listed.nextPageToken;
  }
  return result;
}

export function gmailScope(): string {
  return GMAIL_READONLY_SCOPE;
}
