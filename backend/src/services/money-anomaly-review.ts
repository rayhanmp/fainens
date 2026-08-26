import { desc, eq, inArray } from "drizzle-orm";

import { db } from "../db/client";
import { auditLogs, moneyAnomalyReviews, transactionLines, transactions } from "../db/schema";

type Candidate = {
  fingerprint: string;
  kind: "possible_100x_pair" | "legacy_reconciliation_plug";
  transactionId: number;
  relatedTransactionId: number | null;
  detectedAmount: number;
  reason: string;
};

function normalizedDescription(value: string | null): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/[^a-z#]+/g, " ")
    .trim();
}

/** Find candidates without altering ledger data. */
export async function scanMoneyAnomalies(): Promise<{ created: number; candidates: number }> {
  const rows = await db
    .select({
      transactionId: transactions.id,
      txType: transactions.txType,
      description: transactions.description,
      status: transactions.status,
      accountId: transactionLines.accountId,
      debit: transactionLines.debit,
      credit: transactionLines.credit,
    })
    .from(transactionLines)
    .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id));

  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const add = (candidate: Candidate) => {
    if (!seen.has(candidate.fingerprint)) {
      seen.add(candidate.fingerprint);
      candidates.push(candidate);
    }
  };

  for (const row of rows) {
    const haystack = `${row.txType} ${row.description}`.toLowerCase();
    if (haystack.includes("reconciliation")) {
      add({
        fingerprint: `legacy-reconciliation:${row.transactionId}`,
        kind: "legacy_reconciliation_plug",
        transactionId: row.transactionId,
        relatedTransactionId: null,
        detectedAmount: Math.abs(row.debit - row.credit),
        reason: "Historic reconciliation-related journal; review whether it is an old balancing plug rather than a real financial event.",
      });
    }
  }

  const grouped = new Map<string, Array<{ transactionId: number; amount: number }>>();
  for (const row of rows) {
    if (row.status === "draft") continue;
    const amount = Math.abs(row.debit - row.credit);
    const description = normalizedDescription(row.description);
    if (amount < 100 || !description) continue;
    const direction = row.debit > row.credit ? "debit" : "credit";
    const key = `${row.accountId}:${row.txType}:${direction}:${description}`;
    const group = grouped.get(key) ?? [];
    group.push({ transactionId: row.transactionId, amount });
    grouped.set(key, group);
  }
  for (const group of grouped.values()) {
    group.sort((a, b) => a.amount - b.amount || a.transactionId - b.transactionId);
    for (let smallIndex = 0; smallIndex < group.length; smallIndex += 1) {
      const small = group[smallIndex];
      for (let largeIndex = smallIndex + 1; largeIndex < group.length; largeIndex += 1) {
        const large = group[largeIndex];
        const ratio = large.amount / small.amount;
        if (ratio < 99.5) continue;
        if (ratio > 100.5) break;
        add({
          fingerprint: `100x:${small.transactionId}:${large.transactionId}`,
          kind: "possible_100x_pair",
          transactionId: large.transactionId,
          relatedTransactionId: small.transactionId,
          detectedAmount: large.amount,
          reason: `Same account, direction, type, and normalized description as transaction ${small.transactionId}, with a ${ratio.toFixed(2)}× line amount. Review before any correction.`,
        });
      }
    }
  }

  let created = 0;
  const now = Date.now();
  db.transaction((tx) => {
    for (const candidate of candidates) {
      const result = tx.insert(moneyAnomalyReviews).values({ ...candidate, createdAt: new Date(now) })
        .onConflictDoNothing().run();
      created += result.changes;
    }
  });
  return { created, candidates: candidates.length };
}

export async function listMoneyAnomalyReviews(status?: "open" | "resolved" | "dismissed") {
  const reviews = await db.select().from(moneyAnomalyReviews)
    .where(status ? eq(moneyAnomalyReviews.status, status) : undefined)
    .orderBy(desc(moneyAnomalyReviews.createdAt), desc(moneyAnomalyReviews.id));
  const ids = [...new Set(reviews.flatMap((review) => [review.transactionId, review.relatedTransactionId]).filter((id): id is number => id != null))];
  const transactionRows = ids.length === 0 ? [] : await db.select({ id: transactions.id, date: transactions.date, description: transactions.description, txType: transactions.txType, status: transactions.status })
    .from(transactions).where(inArray(transactions.id, ids));
  const transactionById = new Map(transactionRows.map((transaction) => [transaction.id, transaction]));
  return reviews.map((review) => ({
    ...review,
    transaction: transactionById.get(review.transactionId) ?? null,
    relatedTransaction: review.relatedTransactionId == null ? null : transactionById.get(review.relatedTransactionId) ?? null,
  }));
}

export async function reviewMoneyAnomaly(
  id: number,
  status: "resolved" | "dismissed",
  reviewNote: string,
) {
  const note = reviewNote.trim();
  if (!note || note.length > 1000) throw new Error("reviewNote is required and must be at most 1000 characters");
  return db.transaction((tx) => {
    const before = tx.select().from(moneyAnomalyReviews).where(eq(moneyAnomalyReviews.id, id)).limit(1).all()[0];
    if (!before) throw new Error("Money anomaly review not found");
    if (before.status !== "open") throw new Error("Money anomaly review is already closed");
    const after = tx.update(moneyAnomalyReviews).set({ status, reviewNote: note, reviewedAt: new Date() })
      .where(eq(moneyAnomalyReviews.id, id)).returning().all()[0];
    tx.insert(auditLogs).values({
      entityType: "money_anomaly_review",
      entityId: id,
      action: "update",
      beforeSnapshot: Buffer.from(JSON.stringify(before)),
      afterSnapshot: Buffer.from(JSON.stringify(after)),
    }).run();
    return after;
  });
}
