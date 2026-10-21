import { and, eq, or, sql } from "drizzle-orm";

import { db } from "../db/client";
import { accounts, gmailConnections, pendingTransactions } from "../db/schema";
import {
  decryptGmailRefreshToken,
  GMAIL_BNI_SOURCE,
  listWondrBniEmails,
} from "./gmail";

const DAY_MS = 24 * 60 * 60 * 1000;

export type GmailSyncResult = {
  ownerEmail: string;
  imported: number;
  skipped: number;
  pendingIds: number[];
  lastSyncedAt: Date;
};

export function resolveFundingAccount(
  sourceLabel: string | null,
  rows: Array<{ id: number; name: string; accountNumber: string | null }>,
): { id: number; name: string } | null {
  if (!sourceLabel) return null;
  const normalized = sourceLabel.toLowerCase();
  const suffix = normalized.match(/([0-9]{3,})\s*$/)?.[1];
  const scored = rows.map((row) => {
    const name = row.name.toLowerCase();
    let score = 0;
    if (suffix && row.accountNumber && row.accountNumber.replace(/\D/g, "").endsWith(suffix)) score += 10;
    const nameTokens = normalized.replace(/[•*]/g, " ").split(/\s+/).filter((token) => token.length >= 4 && !/^\d+$/.test(token));
    score += nameTokens.filter((token) => name.includes(token)).length * 2;
    return { row, score };
  }).sort((left, right) => right.score - left.score);
  const match = scored[0];
  // A tie means the label does not identify one wallet; leave the account
  // unresolved so approval asks the user to pick it.
  if (!match || match.score <= 0 || scored[1]?.score === match.score) return null;
  return { id: match.row.id, name: match.row.name };
}

type GmailPendingInsert = {
  messageId: string;
  reference: string | null;
  rawMessage: string;
  parsedData: string;
};

/**
 * Insert one imported email unless it is already queued. The duplicate check
 * and the insert run in one IMMEDIATE SQLite transaction: the write lock is
 * taken before the check, so the background worker and a manual sync in
 * another process cannot both pass the check for the same email. Besides the
 * Gmail message ID, the bank's reference ID is matched so a re-sent or
 * forwarded notification for the same payment is not queued twice.
 */
export function insertGmailPendingTransactionOnce(input: GmailPendingInsert): number | null {
  const reference = input.reference?.trim() || null;
  return db.transaction((tx) => {
    const duplicate = tx.select({ id: pendingTransactions.id })
      .from(pendingTransactions)
      .where(and(
        eq(pendingTransactions.source, GMAIL_BNI_SOURCE),
        reference
          ? or(
              eq(pendingTransactions.userMessageId, input.messageId),
              sql`(CASE WHEN json_valid(${pendingTransactions.parsedData}) THEN json_extract(${pendingTransactions.parsedData}, '$.reference') END) = ${reference}`,
            )
          : eq(pendingTransactions.userMessageId, input.messageId),
      ))
      .limit(1)
      .all()[0];
    if (duplicate) return null;
    const created = tx.insert(pendingTransactions).values({
      rawMessage: input.rawMessage,
      parsedData: input.parsedData,
      status: "pending",
      parseAttempts: 1,
      userMessageId: input.messageId,
      source: GMAIL_BNI_SOURCE,
    }).returning({ id: pendingTransactions.id }).all()[0];
    return created?.id ?? null;
  }, { behavior: "immediate" });
}

async function syncGmailConnectionOnce(ownerEmail: string, days: number): Promise<GmailSyncResult | null> {
  const [connection] = await db.select().from(gmailConnections)
    .where(eq(gmailConnections.ownerEmail, ownerEmail))
    .limit(1);
  if (!connection) return null;

  const emails = await listWondrBniEmails(decryptGmailRefreshToken(connection.refreshToken), days);
  const walletRows = await db.select({ id: accounts.id, name: accounts.name, accountNumber: accounts.accountNumber })
    .from(accounts)
    .where(and(eq(accounts.type, "asset"), eq(accounts.isActive, true)));
  let imported = 0;
  let skipped = 0;
  const pendingIds: number[] = [];

  for (const email of emails) {
    const originalAccountLabel = email.parsed.fromAccount;
    const fundingAccount = resolveFundingAccount(originalAccountLabel, walletRows);
    const parsed = {
      ...email.parsed,
      fromAccount: fundingAccount?.name ?? originalAccountLabel,
      fromAccountId: fundingAccount?.id ?? null,
      sourceAccountLabel: originalAccountLabel,
    };
    const createdId = insertGmailPendingTransactionOnce({
      messageId: email.messageId,
      reference: email.parsed.reference,
      rawMessage: email.rawMessage,
      parsedData: JSON.stringify(parsed),
    });
    if (createdId == null) {
      skipped += 1;
      continue;
    }
    imported += 1;
    pendingIds.push(createdId);
  }

  const lastSyncedAt = new Date();
  await db.update(gmailConnections)
    .set({ lastSyncedAt, lastError: null, lastErrorAt: null, updatedAt: lastSyncedAt })
    .where(eq(gmailConnections.ownerEmail, ownerEmail));
  return { ownerEmail, imported, skipped, pendingIds, lastSyncedAt };
}

/** A sync failure in words for the person who connected Gmail. */
export function gmailErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/invalid_grant|revoked|unauthori[sz]ed|invalid_token|401/i.test(message)) {
    return "Google no longer lets Fainens read your Gmail. Connect it again.";
  }
  return `Gmail couldn't be checked: ${message}`;
}

/** Runs one sync and keeps why it failed on the connection, so the app can say so; a good sync clears it. */
async function syncAndRecord(ownerEmail: string, days: number): Promise<GmailSyncResult | null> {
  try {
    return await syncGmailConnectionOnce(ownerEmail, days);
  } catch (error) {
    const now = new Date();
    await db.update(gmailConnections)
      .set({ lastError: gmailErrorText(error), lastErrorAt: now, updatedAt: now })
      .where(eq(gmailConnections.ownerEmail, ownerEmail));
    throw error;
  }
}

// Prevent a manual sync and the background poll from processing the same
// connection concurrently inside one API process.
const activeSyncs = new Map<string, Promise<GmailSyncResult | null>>();

export function syncGmailConnection(ownerEmail: string, days = 30): Promise<GmailSyncResult | null> {
  const normalizedOwnerEmail = ownerEmail.toLowerCase();
  const active = activeSyncs.get(normalizedOwnerEmail);
  if (active) return active;

  const promise = syncAndRecord(normalizedOwnerEmail, days).finally(() => {
    if (activeSyncs.get(normalizedOwnerEmail) === promise) activeSyncs.delete(normalizedOwnerEmail);
  });
  activeSyncs.set(normalizedOwnerEmail, promise);
  return promise;
}

function pollDays(lastSyncedAt: Date | null): number {
  if (!lastSyncedAt) return 30;
  // Gmail's `after:` filter is date-based, so include a one-day overlap to
  // avoid missing messages around the local midnight boundary.
  return Math.min(365, Math.max(2, Math.ceil((Date.now() - lastSyncedAt.getTime()) / DAY_MS) + 1));
}

export async function pollConnectedGmail(): Promise<{ connections: number; imported: number; skipped: number }> {
  const connections = await db.select({ ownerEmail: gmailConnections.ownerEmail, lastSyncedAt: gmailConnections.lastSyncedAt })
    .from(gmailConnections);
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  for (const connection of connections) {
    // One connection failing (its error is kept on it) doesn't stop the others.
    const result = await syncGmailConnection(connection.ownerEmail, pollDays(connection.lastSyncedAt)).catch(() => {
      failed += 1;
      return null;
    });
    if (!result) continue;
    imported += result.imported;
    skipped += result.skipped;
  }
  if (failed && failed === connections.length) throw new Error("Gmail sync failed for every connection");
  return { connections: connections.length, imported, skipped };
}
