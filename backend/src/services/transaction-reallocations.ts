import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { auditLogs, transactionReallocations } from "../db/schema";
import { invalidateOnTransactionMutation } from "../cache/invalidation";
import { bumpFinancialRevisionSync } from "./financial-revision";
import { adjustedPersonalEffects } from "./reallocation-effects";

export class ReallocationError extends Error {
  constructor(message: string, public readonly statusCode: 400 | 404 | 409 = 409) { super(message); }
}

export type ReallocationMetadata = {
  id: number; counterpartTransactionId: number; counterpartDescription: string;
  amount: number; reason: string; role: "incoming" | "outgoing";
};

type Candidate = {
  id: number; description: string; periodId: number | null; role: "incoming" | "outgoing" | null;
  amount: number; expenseCents: number; incomeCents: number;
  reallocation: ReallocationMetadata | null;
};

/** Bulk eligibility and metadata read; also used inside the atomic write transaction. */
export function loadReallocationCandidates(ids: number[], executor: any = db): Map<number, Candidate> {
  if (!ids.length) return new Map();
  const rows = executor.all(sql`
    SELECT t.id, t.period_id, t.description,
      coalesce(sum(case when a.type = 'expense' then tl.debit - tl.credit else 0 end), 0) AS expense,
      coalesce(sum(case when a.type = 'revenue' then tl.credit - tl.debit else 0 end), 0) AS income,
      CASE WHEN t.status = 'posted' AND t.tx_type IN ('manual', 'simple_expense', 'simple_income')
        AND t.subscription_id IS NULL AND t.linked_tx_id IS NULL AND t.reversal_of_tx_id IS NULL
        AND count(tl.id) = 2
        AND sum(case when a.type = 'asset' AND a.liquidity_class = 'cash_equivalent' then 1 else 0 end) = 1
        AND sum(case when a.type IN ('expense', 'revenue') then 1 else 0 end) = 1
        AND (select count(*) from transaction_category_allocation ca where ca.transaction_id = t.id) <= 1
        AND NOT EXISTS (select 1 from "transaction" other where other.linked_tx_id = t.id OR other.reversal_of_tx_id = t.id)
        AND NOT EXISTS (select 1 from loan l where l.source_transaction_id = t.id OR l.lending_transaction_id = t.id)
        AND NOT EXISTS (select 1 from loan_payment lp where lp.transaction_id = t.id)
        AND NOT EXISTS (select 1 from paylater_installment p where p.recognition_tx_id = t.id OR p.paid_tx_id = t.id)
        AND NOT EXISTS (select 1 from wishlist w where w.fulfilled_transaction_id = t.id)
        AND NOT EXISTS (select 1 from reimbursement_claim_source s where s.source_transaction_id = t.id OR s.recognition_transaction_id = t.id)
        AND NOT EXISTS (select 1 from reimbursement_claim claim where claim.writeoff_transaction_id = t.id)
        AND NOT EXISTS (select 1 from reimbursement_receipt receipt where receipt.transaction_id = t.id OR receipt.reversal_transaction_id = t.id)
      THEN 1 ELSE 0 END AS eligible,
      r.id AS pair_id, r.amount, r.reason, r.incoming_transaction_id, r.outgoing_transaction_id,
      counterpart.description AS counterpart_description
    FROM "transaction" t
    LEFT JOIN transaction_line tl ON tl.transaction_id = t.id
    LEFT JOIN account a ON a.id = tl.account_id
    LEFT JOIN transaction_reallocation r ON r.incoming_transaction_id = t.id OR r.outgoing_transaction_id = t.id
    LEFT JOIN "transaction" counterpart ON counterpart.id = CASE WHEN r.incoming_transaction_id = t.id THEN r.outgoing_transaction_id ELSE r.incoming_transaction_id END
    WHERE t.id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
    GROUP BY t.id
  `) as Array<any>;
  return new Map(rows.map(row => {
    const expenseCents = Number(row.expense), incomeCents = Number(row.income);
    const role = row.eligible && incomeCents === 0 && expenseCents > 0 ? "outgoing"
      : row.eligible && ((expenseCents === 0 && incomeCents > 0) || (incomeCents === 0 && expenseCents < 0)) ? "incoming" : null;
    const pairRole = Number(row.incoming_transaction_id) === Number(row.id) ? "incoming" : "outgoing";
    return [Number(row.id), {
      id: Number(row.id), description: String(row.description), periodId: row.period_id == null ? null : Number(row.period_id), role,
      amount: Math.abs(expenseCents || incomeCents), expenseCents, incomeCents,
      reallocation: row.pair_id == null ? null : {
        id: Number(row.pair_id), amount: Number(row.amount), reason: String(row.reason), role: pairRole,
        counterpartTransactionId: Number(pairRole === "incoming" ? row.outgoing_transaction_id : row.incoming_transaction_id),
        counterpartDescription: String(row.counterpart_description),
      },
    } as Candidate];
  }));
}

export function reallocationReportingFields(candidate: Candidate | undefined) {
  if (!candidate) return { reallocation: null, reallocationEligibleRole: null };
  const effects = candidate.reallocation
    ? adjustedPersonalEffects(candidate.expenseCents, candidate.incomeCents, candidate.reallocation.role, candidate.reallocation.amount)
    : { personalExpenseCents: candidate.expenseCents, personalIncomeCents: candidate.incomeCents };
  return { ...effects, reallocation: candidate.reallocation, reallocationEligibleRole: candidate.reallocation ? null : candidate.role };
}

export function assertNotReallocated(transactionId: number, executor: any = db) {
  const pair = executor.select({ id: transactionReallocations.id }).from(transactionReallocations)
    .where(sql`${transactionReallocations.incomingTransactionId} = ${transactionId} OR ${transactionReallocations.outgoingTransactionId} = ${transactionId}`).limit(1).all()[0];
  if (pair) throw new ReallocationError("Unlink the reallocation before correcting this transaction or claiming reimbursement");
}

export async function linkReallocation(transactionId: number, counterpartTransactionId: number, reason: string) {
  if (transactionId === counterpartTransactionId) throw new ReallocationError("Choose a different transaction", 400);
  if (!reason.trim() || reason.trim().length > 500) throw new ReallocationError("Provide a reason of 1 to 500 characters", 400);
  const result = db.transaction(tx => {
    const candidates = loadReallocationCandidates([transactionId, counterpartTransactionId], tx);
    const first = candidates.get(transactionId), second = candidates.get(counterpartTransactionId);
    if (!first || !second) throw new ReallocationError("Transaction not found", 404);
    if (first.reallocation || second.reallocation) throw new ReallocationError("Transaction already belongs to a reallocation");
    if (!first.role || !second.role || first.role === second.role) throw new ReallocationError("Choose one ordinary incoming transaction and one outgoing expense");
    const incoming = first.role === "incoming" ? first : second;
    const outgoing = first.role === "outgoing" ? first : second;
    const pair = tx.insert(transactionReallocations).values({ incomingTransactionId: incoming.id, outgoingTransactionId: outgoing.id, amount: Math.min(incoming.amount, outgoing.amount), reason: reason.trim() }).returning().all()[0];
    tx.insert(auditLogs).values({ entityType: "transaction_reallocation", entityId: pair.id, action: "create", afterSnapshot: Buffer.from(JSON.stringify(pair)) }).run();
    bumpFinancialRevisionSync(tx);
    const metadata: ReallocationMetadata = {
      id: pair.id, amount: pair.amount, reason: pair.reason, role: first.role,
      counterpartTransactionId: second.id, counterpartDescription: second.description,
    };
    return { metadata, periods: [first.periodId, second.periodId].filter((id): id is number => id != null) };
  });
  await invalidateOnTransactionMutation({ transactionId, affectedAccountIds: [], affectedPeriodIds: result.periods, revisionBumped: true });
  return result.metadata;
}

export async function unlinkReallocation(transactionId: number) {
  const periods = db.transaction(tx => {
    const candidate = loadReallocationCandidates([transactionId], tx).get(transactionId);
    if (!candidate) throw new ReallocationError("Transaction not found", 404);
    if (!candidate.reallocation) throw new ReallocationError("This transaction has no reallocation", 404);
    const other = loadReallocationCandidates([candidate.reallocation.counterpartTransactionId], tx).get(candidate.reallocation.counterpartTransactionId)!;
    const pair = tx.select().from(transactionReallocations).where(eq(transactionReallocations.id, candidate.reallocation.id)).all()[0];
    tx.delete(transactionReallocations).where(eq(transactionReallocations.id, pair.id)).run();
    tx.insert(auditLogs).values({ entityType: "transaction_reallocation", entityId: pair.id, action: "delete", beforeSnapshot: Buffer.from(JSON.stringify(pair)) }).run();
    bumpFinancialRevisionSync(tx);
    return [candidate.periodId, other.periodId].filter((id): id is number => id != null);
  });
  await invalidateOnTransactionMutation({ transactionId, affectedAccountIds: [], affectedPeriodIds: periods, revisionBumped: true });
}
