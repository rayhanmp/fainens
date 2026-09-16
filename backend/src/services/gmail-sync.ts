import { and, eq } from "drizzle-orm";

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

function resolveFundingAccount(
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
  return match && match.score > 0 ? { id: match.row.id, name: match.row.name } : null;
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
    const [duplicate] = await db.select({ id: pendingTransactions.id })
      .from(pendingTransactions)
      .where(and(eq(pendingTransactions.source, GMAIL_BNI_SOURCE), eq(pendingTransactions.userMessageId, email.messageId)))
      .limit(1);
    if (duplicate) {
      skipped += 1;
      continue;
    }

    const originalAccountLabel = email.parsed.fromAccount;
    const fundingAccount = resolveFundingAccount(originalAccountLabel, walletRows);
    const parsed = {
      ...email.parsed,
      fromAccount: fundingAccount?.name ?? originalAccountLabel,
      fromAccountId: fundingAccount?.id ?? null,
      sourceAccountLabel: originalAccountLabel,
    };
    const [created] = await db.insert(pendingTransactions).values({
      rawMessage: email.rawMessage,
      parsedData: JSON.stringify(parsed),
      status: "pending",
      parseAttempts: 1,
      userMessageId: email.messageId,
      source: GMAIL_BNI_SOURCE,
    }).returning({ id: pendingTransactions.id });
    if (created) {
      imported += 1;
      pendingIds.push(created.id);
    }
  }

  const lastSyncedAt = new Date();
  await db.update(gmailConnections)
    .set({ lastSyncedAt, updatedAt: lastSyncedAt })
    .where(eq(gmailConnections.ownerEmail, ownerEmail));
  return { ownerEmail, imported, skipped, pendingIds, lastSyncedAt };
}

// Prevent a manual sync and the background poll from processing the same
// connection concurrently inside one API process.
const activeSyncs = new Map<string, Promise<GmailSyncResult | null>>();

export function syncGmailConnection(ownerEmail: string, days = 30): Promise<GmailSyncResult | null> {
  const normalizedOwnerEmail = ownerEmail.toLowerCase();
  const active = activeSyncs.get(normalizedOwnerEmail);
  if (active) return active;

  const promise = syncGmailConnectionOnce(normalizedOwnerEmail, days).finally(() => {
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
  for (const connection of connections) {
    const result = await syncGmailConnection(connection.ownerEmail, pollDays(connection.lastSyncedAt));
    if (!result) continue;
    imported += result.imported;
    skipped += result.skipped;
  }
  return { connections: connections.length, imported, skipped };
}
