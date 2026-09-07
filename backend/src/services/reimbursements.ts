import { createHash } from "crypto";
import { and, eq, inArray, sql } from "drizzle-orm";

import { invalidateOnTransactionMutation } from "../cache/invalidation";
import { db } from "../db/client";
import {
  accounts,
  auditLogs,
  contacts,
  reimbursementClaimSources,
  reimbursementClaims,
  reimbursementOperations,
  reimbursementReceiptAllocations,
  reimbursementReceipts,
  transactionCategoryAllocations,
  transactionLines,
  transactions,
} from "../db/schema";
import { computeAccountBalance, insertPreparedJournalEntrySync, prepareJournalEntry, type PreparedJournalEntry } from "./ledger";
import { prepareDomainReversal, insertDomainReversalSync } from "./domain-reversal";

const CONTROL_ACCOUNT_KEY = "reimbursements-receivable";
const ACTIVE_CLAIM_STATUSES = ["approved", "partially_paid", "settled"] as const;

export type ReimbursementSourceInput = {
  sourceTransactionId: number;
  expenseLineId: number;
  categoryId?: number | null;
  amount: number;
};

export type CreateClaimInput = {
  contactId: number;
  title: string;
  dueDate?: number | null;
  notes?: string | null;
  sources: ReimbursementSourceInput[];
};

export class ReimbursementError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = "ReimbursementError";
  }
}

function asMs(value: Date | number | null | undefined): number | null {
  if (value == null) return null;
  return value instanceof Date ? value.getTime() : Number(value);
}

function checksum(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function priorOperation(idempotencyKey: string, operation: string, request: unknown) {
  const [existing] = await db.select().from(reimbursementOperations)
    .where(eq(reimbursementOperations.idempotencyKey, idempotencyKey)).limit(1);
  if (!existing) return null;
  if (existing.operation !== operation || existing.requestHash !== checksum(request)) {
    throw new ReimbursementError("idempotencyKey has already been used for a different reimbursement command", 409);
  }
  return JSON.parse(existing.resultJson);
}

function persistOperation(tx: any, idempotencyKey: string, operation: string, request: unknown, result: unknown) {
  tx.insert(reimbursementOperations).values({
    idempotencyKey,
    operation,
    requestHash: checksum(request),
    resultJson: JSON.stringify(result),
  }).run();
}

function assertPositiveInt(value: unknown, field: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new ReimbursementError(`${field} must be a positive whole-IDR amount`);
}

function assertId(value: unknown, field: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new ReimbursementError(`${field} must be a positive integer`);
}

async function controlAccount(dbLike: any = db): Promise<{ id: number }> {
  const [account] = await dbLike.select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive, liquidityClass: accounts.liquidityClass })
    .from(accounts).where(eq(accounts.systemKey, CONTROL_ACCOUNT_KEY)).limit(1);
  if (!account || account.type !== "asset" || !account.isActive || account.liquidityClass !== "receivable") {
    throw new ReimbursementError("Reimbursements Receivable control account is unavailable", 409);
  }
  return { id: account.id };
}

/** The subledger is authoritative only while it reconciles to its control account. */
async function assertControlReconciled() {
  const control = await controlAccount();
  const [recognised] = await db.select({ value: sql<number>`coalesce(sum(${reimbursementClaimSources.amount}), 0)` })
    .from(reimbursementClaimSources)
    .innerJoin(reimbursementClaims, eq(reimbursementClaimSources.claimId, reimbursementClaims.id))
    .where(and(inArray(reimbursementClaims.status, [...ACTIVE_CLAIM_STATUSES]), sql`${reimbursementClaimSources.recognitionTransactionId} is not null`));
  const [received] = await db.select({ value: sql<number>`coalesce(sum(${reimbursementReceiptAllocations.amount}), 0)` })
    .from(reimbursementReceiptAllocations)
    .innerJoin(reimbursementReceipts, eq(reimbursementReceiptAllocations.receiptId, reimbursementReceipts.id))
    .innerJoin(reimbursementClaims, eq(reimbursementReceiptAllocations.claimId, reimbursementClaims.id))
    .where(and(eq(reimbursementReceipts.status, "posted"), inArray(reimbursementClaims.status, [...ACTIVE_CLAIM_STATUSES])));
  const expected = Number(recognised?.value ?? 0) - Number(received?.value ?? 0);
  const actual = await computeAccountBalance(control.id);
  if (actual !== expected) {
    throw new ReimbursementError(`Reimbursement control account is out of balance (expected ${expected}, found ${actual})`, 409);
  }
}

async function validateDraftInput(input: CreateClaimInput, dbLike: any = db) {
  assertId(input.contactId, "contactId");
  if (!input.title?.trim()) throw new ReimbursementError("title is required");
  if (!Array.isArray(input.sources) || input.sources.length === 0) throw new ReimbursementError("At least one expense source is required");
  const unique = new Set<string>();
  for (const source of input.sources) {
    assertId(source.sourceTransactionId, "sourceTransactionId");
    assertId(source.expenseLineId, "expenseLineId");
    assertPositiveInt(source.amount, "source amount");
    const key = `${source.sourceTransactionId}:${source.expenseLineId}:${source.categoryId ?? "none"}`;
    if (unique.has(key)) throw new ReimbursementError("A source line/category may appear only once per claim");
    unique.add(key);
  }
  const [contact] = await dbLike.select({ id: contacts.id, isActive: contacts.isActive }).from(contacts).where(eq(contacts.id, input.contactId)).limit(1);
  if (!contact || !contact.isActive) throw new ReimbursementError("Payer contact is not active", 404);
}

/** Outstanding recognised balance; draft and submitted sources deliberately do not count. */
async function claimOutstanding(claimId: number, dbLike: any = db): Promise<number> {
  const [claim] = await dbLike.select({ status: reimbursementClaims.status }).from(reimbursementClaims).where(eq(reimbursementClaims.id, claimId)).limit(1);
  if (!claim || !ACTIVE_CLAIM_STATUSES.includes(claim.status as typeof ACTIVE_CLAIM_STATUSES[number])) return 0;
  const [recognised] = await dbLike.select({ value: sql<number>`coalesce(sum(${reimbursementClaimSources.amount}), 0)` })
    .from(reimbursementClaimSources).where(and(eq(reimbursementClaimSources.claimId, claimId), sql`${reimbursementClaimSources.recognitionTransactionId} is not null`));
  const [received] = await dbLike.select({ value: sql<number>`coalesce(sum(${reimbursementReceiptAllocations.amount}), 0)` })
    .from(reimbursementReceiptAllocations)
    .innerJoin(reimbursementReceipts, eq(reimbursementReceiptAllocations.receiptId, reimbursementReceipts.id))
    .where(and(eq(reimbursementReceiptAllocations.claimId, claimId), eq(reimbursementReceipts.status, "posted")));
  return Math.max(0, Number(recognised?.value ?? 0) - Number(received?.value ?? 0));
}

async function assertSourceAvailable(source: ReimbursementSourceInput, dbLike: any = db) {
  const [line] = await dbLike.select({
    id: transactionLines.id,
    transactionId: transactionLines.transactionId,
    accountId: transactionLines.accountId,
    debit: transactionLines.debit,
    credit: transactionLines.credit,
    accountType: accounts.type,
    status: transactions.status,
  }).from(transactionLines)
    .innerJoin(accounts, eq(transactionLines.accountId, accounts.id))
    .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
    .where(and(eq(transactionLines.id, source.expenseLineId), eq(transactionLines.transactionId, source.sourceTransactionId)))
    .limit(1);
  if (!line || line.status !== "posted" || line.accountType !== "expense" || line.debit <= line.credit) {
    throw new ReimbursementError(`Source line ${source.expenseLineId} must be a posted positive expense line`, 409);
  }
  const [already] = await dbLike.select({ value: sql<number>`coalesce(sum(${reimbursementClaimSources.amount}), 0)` })
    .from(reimbursementClaimSources)
    .innerJoin(reimbursementClaims, eq(reimbursementClaimSources.claimId, reimbursementClaims.id))
    .where(and(eq(reimbursementClaimSources.expenseLineId, source.expenseLineId), inArray(reimbursementClaims.status, [...ACTIVE_CLAIM_STATUSES])));
  if (Number(already?.value ?? 0) + source.amount > line.debit - line.credit) {
    throw new ReimbursementError("Reimbursement allocation exceeds the remaining expense on its source line", 409);
  }
  const categoryRows = await dbLike.select({ categoryId: transactionCategoryAllocations.categoryId, amount: transactionCategoryAllocations.amount })
    .from(transactionCategoryAllocations).where(eq(transactionCategoryAllocations.transactionId, source.sourceTransactionId));
  if (categoryRows.length === 0) {
    if (source.categoryId != null) throw new ReimbursementError("Uncategorised expenses cannot include a category allocation");
    return line;
  }
  if (source.categoryId == null) throw new ReimbursementError("Categorised expenses require an explicit category allocation");
  const category = categoryRows.find((row: any) => row.categoryId === source.categoryId);
  if (!category || category.amount <= 0) throw new ReimbursementError("Source category is not available on the transaction", 409);
  const [categoryAlready] = await dbLike.select({ value: sql<number>`coalesce(sum(${reimbursementClaimSources.amount}), 0)` })
    .from(reimbursementClaimSources)
    .innerJoin(reimbursementClaims, eq(reimbursementClaimSources.claimId, reimbursementClaims.id))
    .where(and(
      eq(reimbursementClaimSources.sourceTransactionId, source.sourceTransactionId),
      eq(reimbursementClaimSources.categoryId, source.categoryId),
      inArray(reimbursementClaims.status, [...ACTIVE_CLAIM_STATUSES]),
    ));
  if (Number(categoryAlready?.value ?? 0) + source.amount > category.amount) {
    throw new ReimbursementError("Reimbursement allocation exceeds the remaining amount in its source category", 409);
  }
  return line;
}

function audit(tx: any, entityType: string, entityId: number, action: string, before: unknown, after: unknown) {
  tx.insert(auditLogs).values({
    entityType,
    entityId,
    action,
    beforeSnapshot: before == null ? null : Buffer.from(JSON.stringify(before)),
    afterSnapshot: after == null ? null : Buffer.from(JSON.stringify(after)),
  }).run();
}

async function prepareRecognition(claim: any, sources: ReimbursementSourceInput[], dbLike: any) {
  const control = await controlAccount(dbLike);
  const grouped = new Map<number, ReimbursementSourceInput[]>();
  for (const source of sources) {
    await assertSourceAvailable(source, dbLike);
    const group = grouped.get(source.sourceTransactionId) ?? [];
    group.push(source);
    grouped.set(source.sourceTransactionId, group);
  }
  const prepared = new Map<number, PreparedJournalEntry>();
  for (const [sourceTransactionId, entries] of grouped) {
    const [sourceTx] = await dbLike.select().from(transactions).where(eq(transactions.id, sourceTransactionId)).limit(1);
    if (!sourceTx) throw new ReimbursementError("Source transaction was not found", 404);
    const lineAmounts = new Map<number, number>();
    const categoryAmounts = new Map<number, number>();
    for (const entry of entries) {
      lineAmounts.set(entry.expenseLineId, (lineAmounts.get(entry.expenseLineId) ?? 0) + entry.amount);
      if (entry.categoryId != null) categoryAmounts.set(entry.categoryId, (categoryAmounts.get(entry.categoryId) ?? 0) + entry.amount);
    }
    const total = entries.reduce((sum, entry) => sum + entry.amount, 0);
    const sourceLineIds = [...lineAmounts.keys()];
    const sourceLines = await dbLike.select({ id: transactionLines.id, accountId: transactionLines.accountId })
      .from(transactionLines).where(inArray(transactionLines.id, sourceLineIds));
    const accountIdByLine = new Map<number, number>(sourceLines.map((line: any) => [Number(line.id), Number(line.accountId)]));
    if (accountIdByLine.size !== sourceLineIds.length) throw new ReimbursementError("Source expense line disappeared; reload and retry", 409);
    prepared.set(sourceTransactionId, await prepareJournalEntry({
      date: asMs(sourceTx.date)!,
      description: `Reimbursement approved: ${claim.title}`,
      reference: `REIMBURSEMENT:${claim.id}`,
      notes: claim.notes ?? null,
      txType: "reimbursement_recognition",
      linkedTxId: sourceTransactionId,
      categoryAllocations: [...categoryAmounts.entries()].map(([categoryId, amount]) => ({ categoryId, amount: -amount })),
      lines: [
        { accountId: control.id, debit: total, credit: 0, description: claim.title },
        ...[...lineAmounts.entries()].map(([sourceLineId, amount]) => ({ accountId: accountIdByLine.get(sourceLineId)!, debit: 0, credit: amount, description: `Reclassified to reimbursement claim #${claim.id}` })),
      ],
    }, dbLike));
  }
  return prepared;
}

export async function createReimbursementClaim(input: CreateClaimInput) {
  await validateDraftInput(input);
  const result = db.transaction((tx) => {
    const claim = tx.insert(reimbursementClaims).values({ contactId: input.contactId, title: input.title.trim(), dueDate: input.dueDate ? new Date(input.dueDate) : null, notes: input.notes ?? null }).returning().all()[0];
    if (!claim) throw new Error("Failed to create reimbursement claim");
    tx.insert(reimbursementClaimSources).values(input.sources.map((source) => ({ claimId: claim.id, sourceTransactionId: source.sourceTransactionId, expenseLineId: source.expenseLineId, categoryId: source.categoryId ?? null, amount: source.amount }))).run();
    audit(tx, "reimbursement_claim", claim.id, "create", null, { claim, sources: input.sources });
    return claim;
  });
  return getReimbursementClaim(result.id);
}

export async function updateReimbursementClaim(id: number, input: CreateClaimInput) {
  assertId(id, "claim id");
  await validateDraftInput(input);
  db.transaction((tx) => {
    const current = tx.select().from(reimbursementClaims).where(eq(reimbursementClaims.id, id)).limit(1).all()[0];
    if (!current) throw new ReimbursementError("Claim not found", 404);
    if (!['draft', 'submitted'].includes(current.status)) throw new ReimbursementError("Only draft or submitted claims can be edited", 409);
    tx.delete(reimbursementClaimSources).where(eq(reimbursementClaimSources.claimId, id)).run();
    tx.insert(reimbursementClaimSources).values(input.sources.map((source) => ({ claimId: id, sourceTransactionId: source.sourceTransactionId, expenseLineId: source.expenseLineId, categoryId: source.categoryId ?? null, amount: source.amount }))).run();
    const next = tx.update(reimbursementClaims).set({ contactId: input.contactId, title: input.title.trim(), dueDate: input.dueDate ? new Date(input.dueDate) : null, notes: input.notes ?? null, status: 'draft', version: current.version + 1, updatedAt: new Date() }).where(eq(reimbursementClaims.id, id)).returning().all()[0];
    audit(tx, "reimbursement_claim", id, "update", current, next);
  });
  return getReimbursementClaim(id);
}

export async function transitionReimbursementClaim(id: number, action: "submit" | "reject" | "cancel") {
  assertId(id, "claim id");
  const target = action === "submit" ? "submitted" : action === "reject" ? "rejected" : "cancelled";
  db.transaction((tx) => {
    const current = tx.select().from(reimbursementClaims).where(eq(reimbursementClaims.id, id)).limit(1).all()[0];
    if (!current) throw new ReimbursementError("Claim not found", 404);
    if (action === "submit" && current.status !== "draft") throw new ReimbursementError("Only drafts can be submitted", 409);
    if ((action === "reject" || action === "cancel") && !["draft", "submitted"].includes(current.status)) throw new ReimbursementError("Only unrecognised claims can be rejected or cancelled", 409);
    const next = tx.update(reimbursementClaims).set({ status: target, submittedAt: action === "submit" ? new Date() : current.submittedAt, version: current.version + 1, updatedAt: new Date() }).where(eq(reimbursementClaims.id, id)).returning().all()[0];
    audit(tx, "reimbursement_claim", id, action, current, next);
  });
  return getReimbursementClaim(id);
}

export async function approveReimbursementClaim(id: number, idempotencyKey: string) {
  assertId(id, "claim id");
  if (!idempotencyKey?.trim()) throw new ReimbursementError("idempotencyKey is required");
  const request = { id };
  const existing = await priorOperation(idempotencyKey, "approve", request);
  if (existing) return existing;
  const claim = (await db.select().from(reimbursementClaims).where(eq(reimbursementClaims.id, id)).limit(1))[0];
  if (!claim) throw new ReimbursementError("Claim not found", 404);
  if (!['draft', 'submitted'].includes(claim.status)) throw new ReimbursementError("Only draft or submitted claims can be approved", 409);
  const sourceRows = await db.select().from(reimbursementClaimSources).where(eq(reimbursementClaimSources.claimId, id));
  const sourceInput = sourceRows.map((row: any) => ({ sourceTransactionId: row.sourceTransactionId, expenseLineId: row.expenseLineId, categoryId: row.categoryId, amount: row.amount }));
  const prepared = await prepareRecognition(claim, sourceInput, db);
  const result = db.transaction((tx) => {
    const current = tx.select().from(reimbursementClaims).where(eq(reimbursementClaims.id, id)).limit(1).all()[0];
    if (!current || !['draft', 'submitted'].includes(current.status)) throw new ReimbursementError("Claim changed; reload and retry", 409);
    const recognitionIds: number[] = [];
    for (const [sourceTransactionId, journal] of prepared) {
      const transactionId = insertPreparedJournalEntrySync(tx, journal);
      recognitionIds.push(transactionId);
      tx.update(reimbursementClaimSources).set({ recognitionTransactionId: transactionId }).where(and(eq(reimbursementClaimSources.claimId, id), eq(reimbursementClaimSources.sourceTransactionId, sourceTransactionId))).run();
    }
    const next = tx.update(reimbursementClaims).set({ status: "approved", approvedAt: new Date(), version: current.version + 1, updatedAt: new Date() }).where(eq(reimbursementClaims.id, id)).returning().all()[0];
    audit(tx, "reimbursement_claim", id, "approve", current, { ...next, recognitionIds });
    const receipt = { claimId: id, recognitionTransactionIds: recognitionIds };
    persistOperation(tx, idempotencyKey, "approve", request, receipt);
    return receipt;
  });
  const control = await controlAccount();
  await invalidateOnTransactionMutation({ transactionId: result.recognitionTransactionIds[0] ?? id, affectedAccountIds: [control.id], revisionBumped: true });
  await assertControlReconciled();
  return result;
}

export async function recordReimbursementReceipt(input: { date: number; walletAccountId: number; allocations: Array<{ claimId: number; amount: number }>; notes?: string | null; idempotencyKey: string }) {
  if (!input.idempotencyKey?.trim()) throw new ReimbursementError("idempotencyKey is required");
  const existing = await priorOperation(input.idempotencyKey, "receipt", input);
  if (existing) return existing;
  assertId(input.walletAccountId, "walletAccountId");
  if (!Number.isFinite(input.date)) throw new ReimbursementError("date is required");
  if (!Array.isArray(input.allocations) || input.allocations.length === 0) throw new ReimbursementError("At least one claim allocation is required");
  const claimIds = input.allocations.map((item) => item.claimId);
  if (new Set(claimIds).size !== claimIds.length) throw new ReimbursementError("A receipt may allocate to each claim only once");
  for (const item of input.allocations) { assertId(item.claimId, "claimId"); assertPositiveInt(item.amount, "receipt amount"); }
  const [wallet] = await db.select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive, liquidityClass: accounts.liquidityClass }).from(accounts).where(eq(accounts.id, input.walletAccountId)).limit(1);
  if (!wallet || !wallet.isActive || wallet.type !== "asset" || wallet.liquidityClass !== "cash_equivalent") throw new ReimbursementError("Receipt account must be an active cash-equivalent asset", 409);
  for (const allocation of input.allocations) {
    if (allocation.amount > await claimOutstanding(allocation.claimId)) throw new ReimbursementError("Receipt allocation exceeds claim outstanding balance", 409);
  }
  const control = await controlAccount();
  const total = input.allocations.reduce((sum, item) => sum + item.amount, 0);
  const prepared = await prepareJournalEntry({ date: input.date, description: "Reimbursement received", notes: input.notes ?? null, txType: "reimbursement_receipt", lines: [
    { accountId: wallet.id, debit: total, credit: 0, cashFlowClass: "operating" },
    { accountId: control.id, debit: 0, credit: total },
  ] }, db);
  const result = db.transaction((tx) => {
    // Re-check inside the write transaction so a concurrent receipt cannot
    // overpay a claim between the preview and journal insertion.
    for (const allocation of input.allocations) {
      const recognised = Number(tx.select({ value: sql<number>`coalesce(sum(${reimbursementClaimSources.amount}), 0)` })
        .from(reimbursementClaimSources).where(and(eq(reimbursementClaimSources.claimId, allocation.claimId), sql`${reimbursementClaimSources.recognitionTransactionId} is not null`)).all()[0]?.value ?? 0);
      const paid = Number(tx.select({ value: sql<number>`coalesce(sum(${reimbursementReceiptAllocations.amount}), 0)` })
        .from(reimbursementReceiptAllocations).innerJoin(reimbursementReceipts, eq(reimbursementReceiptAllocations.receiptId, reimbursementReceipts.id))
        .where(and(eq(reimbursementReceiptAllocations.claimId, allocation.claimId), eq(reimbursementReceipts.status, "posted"))).all()[0]?.value ?? 0);
      const claim = tx.select({ status: reimbursementClaims.status }).from(reimbursementClaims).where(eq(reimbursementClaims.id, allocation.claimId)).limit(1).all()[0];
      if (!claim || !["approved", "partially_paid", "settled"].includes(claim.status) || allocation.amount > recognised - paid) {
        throw new ReimbursementError("Receipt allocation exceeds the claim's current outstanding balance", 409);
      }
    }
    const transactionId = insertPreparedJournalEntrySync(tx, prepared);
    const receipt = tx.insert(reimbursementReceipts).values({ transactionId, receiptDate: new Date(input.date), amount: total, notes: input.notes ?? null }).returning().all()[0];
    if (!receipt) throw new Error("Failed to create reimbursement receipt");
    tx.insert(reimbursementReceiptAllocations).values(input.allocations.map((item) => ({ receiptId: receipt.id, claimId: item.claimId, amount: item.amount }))).run();
    for (const allocation of input.allocations) {
      const sources = tx.select({ value: sql<number>`coalesce(sum(${reimbursementClaimSources.amount}), 0)` }).from(reimbursementClaimSources).where(and(eq(reimbursementClaimSources.claimId, allocation.claimId), sql`${reimbursementClaimSources.recognitionTransactionId} is not null`)).all()[0]?.value ?? 0;
      const paid = tx.select({ value: sql<number>`coalesce(sum(${reimbursementReceiptAllocations.amount}), 0)` }).from(reimbursementReceiptAllocations).innerJoin(reimbursementReceipts, eq(reimbursementReceiptAllocations.receiptId, reimbursementReceipts.id)).where(and(eq(reimbursementReceiptAllocations.claimId, allocation.claimId), eq(reimbursementReceipts.status, "posted"))).all()[0]?.value ?? 0;
      tx.update(reimbursementClaims).set({ status: paid >= sources ? "settled" : "partially_paid", version: sql`${reimbursementClaims.version} + 1`, updatedAt: new Date() }).where(eq(reimbursementClaims.id, allocation.claimId)).run();
    }
    audit(tx, "reimbursement_receipt", receipt.id, "create", null, { receipt, allocations: input.allocations });
    const response = { receiptId: receipt.id, transactionId };
    persistOperation(tx, input.idempotencyKey, "receipt", input, response);
    return response;
  });
  await invalidateOnTransactionMutation({ transactionId: result.transactionId, affectedAccountIds: [wallet.id, control.id], revisionBumped: true });
  await assertControlReconciled();
  return result;
}

/** Adds new approved whole-IDR portions without changing the immutable original approval. */
export async function amendReimbursementApproval(input: { claimId: number; sources: ReimbursementSourceInput[]; idempotencyKey: string }) {
  assertId(input.claimId, "claimId");
  if (!input.idempotencyKey?.trim()) throw new ReimbursementError("idempotencyKey is required");
  if (!Array.isArray(input.sources) || input.sources.length === 0) throw new ReimbursementError("An approval amendment needs at least one added source allocation");
  for (const source of input.sources) {
    assertId(source.sourceTransactionId, "sourceTransactionId");
    assertId(source.expenseLineId, "expenseLineId");
    assertPositiveInt(source.amount, "source amount");
  }
  const prior = await priorOperation(input.idempotencyKey, "amend_approval", input);
  if (prior) return prior;
  const claim = (await db.select().from(reimbursementClaims).where(eq(reimbursementClaims.id, input.claimId)).limit(1))[0];
  if (!claim || !["approved", "partially_paid", "settled"].includes(claim.status)) {
    throw new ReimbursementError("Only approved claims can be increased by amendment", 409);
  }
  const prepared = await prepareRecognition(claim, input.sources, db);
  const result = db.transaction((tx) => {
    const current = tx.select().from(reimbursementClaims).where(eq(reimbursementClaims.id, input.claimId)).limit(1).all()[0];
    if (!current || !["approved", "partially_paid", "settled"].includes(current.status)) throw new ReimbursementError("Claim changed; reload and retry", 409);
    const recognitionTransactionIds: number[] = [];
    for (const [sourceTransactionId, journal] of prepared) {
      const transactionId = insertPreparedJournalEntrySync(tx, journal);
      recognitionTransactionIds.push(transactionId);
      tx.insert(reimbursementClaimSources).values(input.sources.filter((source) => source.sourceTransactionId === sourceTransactionId)
        .map((source) => ({ claimId: input.claimId, sourceTransactionId: source.sourceTransactionId, expenseLineId: source.expenseLineId, categoryId: source.categoryId ?? null, amount: source.amount, recognitionTransactionId: transactionId }))).run();
    }
    const recognised = Number(tx.select({ value: sql<number>`coalesce(sum(${reimbursementClaimSources.amount}), 0)` }).from(reimbursementClaimSources)
      .where(and(eq(reimbursementClaimSources.claimId, input.claimId), sql`${reimbursementClaimSources.recognitionTransactionId} is not null`)).all()[0]?.value ?? 0);
    const paid = Number(tx.select({ value: sql<number>`coalesce(sum(${reimbursementReceiptAllocations.amount}), 0)` }).from(reimbursementReceiptAllocations)
      .innerJoin(reimbursementReceipts, eq(reimbursementReceiptAllocations.receiptId, reimbursementReceipts.id))
      .where(and(eq(reimbursementReceiptAllocations.claimId, input.claimId), eq(reimbursementReceipts.status, "posted"))).all()[0]?.value ?? 0);
    const status = paid >= recognised ? "settled" : paid > 0 ? "partially_paid" : "approved";
    const next = tx.update(reimbursementClaims).set({ status, version: current.version + 1, updatedAt: new Date() }).where(eq(reimbursementClaims.id, input.claimId)).returning().all()[0];
    audit(tx, "reimbursement_claim", input.claimId, "amend_approval", current, { ...next, recognitionTransactionIds, sources: input.sources });
    const response = { claimId: input.claimId, recognitionTransactionIds };
    persistOperation(tx, input.idempotencyKey, "amend_approval", input, response);
    return response;
  });
  const control = await controlAccount();
  await invalidateOnTransactionMutation({ transactionId: result.recognitionTransactionIds[0]!, affectedAccountIds: [control.id], revisionBumped: true });
  await assertControlReconciled();
  return result;
}

export async function reverseReimbursementReceipt(receiptId: number, reason: string, idempotencyKey?: string) {
  assertId(receiptId, "receipt id");
  if (!reason?.trim()) throw new ReimbursementError("reason is required");
  if (!idempotencyKey?.trim()) throw new ReimbursementError("idempotencyKey is required");
  const request = { receiptId, reason };
  const prior = await priorOperation(idempotencyKey, "reverse_receipt", request);
  if (prior) return prior;
  const receipt = (await db.select().from(reimbursementReceipts).where(eq(reimbursementReceipts.id, receiptId)).limit(1))[0];
  if (!receipt || receipt.status !== "posted") throw new ReimbursementError("Posted receipt not found", 404);
  const [writtenOffAllocation] = await db.select({ id: reimbursementReceiptAllocations.id })
    .from(reimbursementReceiptAllocations)
    .innerJoin(reimbursementClaims, eq(reimbursementReceiptAllocations.claimId, reimbursementClaims.id))
    .where(and(eq(reimbursementReceiptAllocations.receiptId, receiptId), eq(reimbursementClaims.status, "written_off")))
    .limit(1);
  if (writtenOffAllocation) throw new ReimbursementError("Reverse the write-off before reversing a receipt allocated to that claim", 409);
  const reversal = await prepareDomainReversal(receipt.transactionId, reason, db);
  const result = db.transaction((tx) => {
    const reversalTransactionId = insertDomainReversalSync(tx, receipt.transactionId, reversal.prepared, reason);
    tx.update(reimbursementReceipts).set({ status: "reversed", reversalTransactionId, reversalReason: reason }).where(eq(reimbursementReceipts.id, receiptId)).run();
    const allocations = tx.select().from(reimbursementReceiptAllocations).where(eq(reimbursementReceiptAllocations.receiptId, receiptId)).all();
    for (const allocation of allocations) {
      const recognised = Number(tx.select({ value: sql<number>`coalesce(sum(${reimbursementClaimSources.amount}), 0)` })
        .from(reimbursementClaimSources)
        .where(and(eq(reimbursementClaimSources.claimId, allocation.claimId), sql`${reimbursementClaimSources.recognitionTransactionId} is not null`)).all()[0]?.value ?? 0);
      const paid = Number(tx.select({ value: sql<number>`coalesce(sum(${reimbursementReceiptAllocations.amount}), 0)` })
        .from(reimbursementReceiptAllocations)
        .innerJoin(reimbursementReceipts, eq(reimbursementReceiptAllocations.receiptId, reimbursementReceipts.id))
        .where(and(eq(reimbursementReceiptAllocations.claimId, allocation.claimId), eq(reimbursementReceipts.status, "posted"))).all()[0]?.value ?? 0);
      tx.update(reimbursementClaims).set({ status: paid >= recognised ? "settled" : paid > 0 ? "partially_paid" : "approved", version: sql`${reimbursementClaims.version} + 1`, updatedAt: new Date() }).where(eq(reimbursementClaims.id, allocation.claimId)).run();
    }
    audit(tx, "reimbursement_receipt", receiptId, "reverse", receipt, { reversalTransactionId, reason });
    const response = { reversalTransactionId };
    persistOperation(tx, idempotencyKey, "reverse_receipt", request, response);
    return response;
  });
  const control = await controlAccount();
  const lines = await db.select({ accountId: transactionLines.accountId }).from(transactionLines).where(eq(transactionLines.transactionId, receipt.transactionId));
  await invalidateOnTransactionMutation({ transactionId: result.reversalTransactionId, affectedAccountIds: [...new Set([...lines.map((line) => line.accountId), control.id])], revisionBumped: true });
  await assertControlReconciled();
  return result;
}

export async function writeOffReimbursementClaim(input: { claimId: number; date: number; notes?: string | null; idempotencyKey: string }) {
  assertId(input.claimId, "claimId");
  if (!Number.isFinite(input.date)) throw new ReimbursementError("date is required");
  if (!input.idempotencyKey?.trim()) throw new ReimbursementError("idempotencyKey is required");
  const prior = await priorOperation(input.idempotencyKey, "writeoff", input);
  if (prior) return prior;
  const claim = (await db.select().from(reimbursementClaims).where(eq(reimbursementClaims.id, input.claimId)).limit(1))[0];
  if (!claim || !["approved", "partially_paid"].includes(claim.status)) throw new ReimbursementError("Only unpaid approved claims can be written off", 409);
  const outstanding = await claimOutstanding(input.claimId);
  if (outstanding <= 0) throw new ReimbursementError("Claim has no outstanding amount to write off", 409);
  const sources = await db.select().from(reimbursementClaimSources)
    .where(and(eq(reimbursementClaimSources.claimId, input.claimId), sql`${reimbursementClaimSources.recognitionTransactionId} is not null`))
    .orderBy(reimbursementClaimSources.id);
  let remaining = outstanding;
  const portions = sources.map((source: any) => {
    const amount = Math.min(remaining, source.amount);
    remaining -= amount;
    return { ...source, amount };
  }).filter((source: any) => source.amount > 0);
  if (remaining !== 0) throw new ReimbursementError("Claim source allocations cannot cover its outstanding amount", 409);
  const lines = await db.select({ id: transactionLines.id, accountId: transactionLines.accountId })
    .from(transactionLines).where(inArray(transactionLines.id, portions.map((source: any) => source.expenseLineId)));
  const lineAccounts = new Map<number, number>(lines.map((line: any) => [Number(line.id), Number(line.accountId)]));
  if (lineAccounts.size !== portions.length) throw new ReimbursementError("Claim source expense line is unavailable", 409);
  const control = await controlAccount();
  const accountAmounts = new Map<number, number>();
  const categoryAmounts = new Map<number, number>();
  for (const portion of portions) {
    const accountId = lineAccounts.get(portion.expenseLineId)!;
    accountAmounts.set(accountId, (accountAmounts.get(accountId) ?? 0) + portion.amount);
    if (portion.categoryId != null) categoryAmounts.set(portion.categoryId, (categoryAmounts.get(portion.categoryId) ?? 0) + portion.amount);
  }
  const prepared = await prepareJournalEntry({
    date: input.date,
    description: `Reimbursement written off: ${claim.title}`,
    reference: `REIMBURSEMENT:WRITEOFF:${claim.id}`,
    notes: input.notes ?? null,
    txType: "reimbursement_writeoff",
    categoryAllocations: [...categoryAmounts.entries()].map(([categoryId, amount]) => ({ categoryId, amount })),
    lines: [
      ...[...accountAmounts.entries()].map(([accountId, amount]) => ({ accountId, debit: amount, credit: 0, description: `Unpaid reimbursement claim #${claim.id}` })),
      { accountId: control.id, debit: 0, credit: outstanding, description: claim.title },
    ],
  }, db);
  const result = db.transaction((tx) => {
    const current = tx.select().from(reimbursementClaims).where(eq(reimbursementClaims.id, input.claimId)).limit(1).all()[0];
    if (!current || !["approved", "partially_paid"].includes(current.status)) throw new ReimbursementError("Claim changed; reload and retry", 409);
    const transactionId = insertPreparedJournalEntrySync(tx, prepared);
    const next = tx.update(reimbursementClaims).set({ status: "written_off", writtenOffAt: new Date(input.date), writeoffTransactionId: transactionId, version: current.version + 1, updatedAt: new Date() })
      .where(eq(reimbursementClaims.id, input.claimId)).returning().all()[0];
    audit(tx, "reimbursement_claim", input.claimId, "writeoff", current, { ...next, transactionId, outstanding });
    const response = { claimId: input.claimId, transactionId, amount: outstanding };
    persistOperation(tx, input.idempotencyKey, "writeoff", input, response);
    return response;
  });
  await invalidateOnTransactionMutation({ transactionId: result.transactionId, affectedAccountIds: [...new Set([...accountAmounts.keys(), control.id])], revisionBumped: true });
  await assertControlReconciled();
  return result;
}

export async function reverseReimbursementWriteOff(input: { claimId: number; reason: string; idempotencyKey: string }) {
  assertId(input.claimId, "claimId");
  if (!input.reason?.trim()) throw new ReimbursementError("reason is required");
  if (!input.idempotencyKey?.trim()) throw new ReimbursementError("idempotencyKey is required");
  const prior = await priorOperation(input.idempotencyKey, "reverse_writeoff", input);
  if (prior) return prior;
  const claim = (await db.select().from(reimbursementClaims).where(eq(reimbursementClaims.id, input.claimId)).limit(1))[0];
  if (!claim || claim.status !== "written_off" || !claim.writeoffTransactionId) throw new ReimbursementError("Only a written-off claim can have its write-off reversed", 409);
  const reversal = await prepareDomainReversal(claim.writeoffTransactionId, input.reason, db);
  const result = db.transaction((tx) => {
    const current = tx.select().from(reimbursementClaims).where(eq(reimbursementClaims.id, input.claimId)).limit(1).all()[0];
    if (!current || current.status !== "written_off" || !current.writeoffTransactionId) throw new ReimbursementError("Claim changed; reload and retry", 409);
    const reversalTransactionId = insertDomainReversalSync(tx, current.writeoffTransactionId, reversal.prepared, input.reason);
    const recognised = Number(tx.select({ value: sql<number>`coalesce(sum(${reimbursementClaimSources.amount}), 0)` }).from(reimbursementClaimSources)
      .where(and(eq(reimbursementClaimSources.claimId, input.claimId), sql`${reimbursementClaimSources.recognitionTransactionId} is not null`)).all()[0]?.value ?? 0);
    const paid = Number(tx.select({ value: sql<number>`coalesce(sum(${reimbursementReceiptAllocations.amount}), 0)` }).from(reimbursementReceiptAllocations)
      .innerJoin(reimbursementReceipts, eq(reimbursementReceiptAllocations.receiptId, reimbursementReceipts.id))
      .where(and(eq(reimbursementReceiptAllocations.claimId, input.claimId), eq(reimbursementReceipts.status, "posted"))).all()[0]?.value ?? 0);
    const next = tx.update(reimbursementClaims).set({ status: paid > 0 ? "partially_paid" : "approved", writtenOffAt: null, writeoffTransactionId: null, version: current.version + 1, updatedAt: new Date() })
      .where(eq(reimbursementClaims.id, input.claimId)).returning().all()[0];
    audit(tx, "reimbursement_claim", input.claimId, "reverse_writeoff", current, { ...next, reversalTransactionId, recognised, paid, reason: input.reason });
    const response = { claimId: input.claimId, reversalTransactionId };
    persistOperation(tx, input.idempotencyKey, "reverse_writeoff", input, response);
    return response;
  });
  const control = await controlAccount();
  await invalidateOnTransactionMutation({ transactionId: result.reversalTransactionId, affectedAccountIds: [control.id], revisionBumped: true });
  await assertControlReconciled();
  return result;
}

export async function reverseReimbursementApproval(input: { claimId: number; reason: string; idempotencyKey: string }) {
  assertId(input.claimId, "claimId");
  if (!input.reason?.trim()) throw new ReimbursementError("reason is required");
  if (!input.idempotencyKey?.trim()) throw new ReimbursementError("idempotencyKey is required");
  const prior = await priorOperation(input.idempotencyKey, "reverse_approval", input);
  if (prior) return prior;
  const claim = (await db.select().from(reimbursementClaims).where(eq(reimbursementClaims.id, input.claimId)).limit(1))[0];
  if (!claim || claim.status !== "approved") throw new ReimbursementError("Only unpaid approved claims can have their approval reversed", 409);
  const [receiptCount] = await db.select({ value: sql<number>`count(*)` }).from(reimbursementReceiptAllocations)
    .innerJoin(reimbursementReceipts, eq(reimbursementReceiptAllocations.receiptId, reimbursementReceipts.id))
    .where(and(eq(reimbursementReceiptAllocations.claimId, input.claimId), eq(reimbursementReceipts.status, "posted")));
  if (Number(receiptCount?.value ?? 0) > 0) throw new ReimbursementError("A claim with receipts must write off its unpaid balance instead of reversing approval", 409);
  const sourceRows = await db.select({ recognitionTransactionId: reimbursementClaimSources.recognitionTransactionId })
    .from(reimbursementClaimSources).where(eq(reimbursementClaimSources.claimId, input.claimId));
  const recognitionIds = [...new Set(sourceRows.map((row: any) => row.recognitionTransactionId).filter(Boolean))] as number[];
  if (recognitionIds.length === 0) throw new ReimbursementError("Claim has no approval journals to reverse", 409);
  const reversals = await Promise.all(recognitionIds.map((transactionId) => prepareDomainReversal(transactionId, input.reason, db)));
  const result = db.transaction((tx) => {
    const current = tx.select().from(reimbursementClaims).where(eq(reimbursementClaims.id, input.claimId)).limit(1).all()[0];
    if (!current || current.status !== "approved") throw new ReimbursementError("Claim changed; reload and retry", 409);
    const reversalTransactionIds = reversals.map((reversal, index) => insertDomainReversalSync(tx, recognitionIds[index]!, reversal.prepared, input.reason));
    const next = tx.update(reimbursementClaims).set({ status: "draft", approvedAt: null, version: current.version + 1, updatedAt: new Date() })
      .where(eq(reimbursementClaims.id, input.claimId)).returning().all()[0];
    audit(tx, "reimbursement_claim", input.claimId, "reverse_approval", current, { ...next, reversalTransactionIds, reason: input.reason });
    const response = { claimId: input.claimId, reversalTransactionIds };
    persistOperation(tx, input.idempotencyKey, "reverse_approval", input, response);
    return response;
  });
  const control = await controlAccount();
  await invalidateOnTransactionMutation({ transactionId: result.reversalTransactionIds[0]!, affectedAccountIds: [control.id], revisionBumped: true });
  await assertControlReconciled();
  return result;
}

export async function getReimbursementClaim(id: number) {
  const [claim] = await db.select().from(reimbursementClaims).where(eq(reimbursementClaims.id, id)).limit(1);
  if (!claim) throw new ReimbursementError("Claim not found", 404);
  const [contact] = await db.select({ id: contacts.id, name: contacts.name, kind: contacts.kind, email: contacts.email }).from(contacts).where(eq(contacts.id, claim.contactId)).limit(1);
  const sources = await db.select().from(reimbursementClaimSources).where(eq(reimbursementClaimSources.claimId, id));
  const receipts = await db.select({ receipt: reimbursementReceipts, allocation: reimbursementReceiptAllocations })
    .from(reimbursementReceiptAllocations).innerJoin(reimbursementReceipts, eq(reimbursementReceiptAllocations.receiptId, reimbursementReceipts.id))
    .where(eq(reimbursementReceiptAllocations.claimId, id));
  return { ...claim, contact, sources, receipts, proposedAmount: sources.reduce((sum: number, source: any) => sum + source.amount, 0), recognisedAmount: sources.filter((source: any) => source.recognitionTransactionId != null).reduce((sum: number, source: any) => sum + source.amount, 0), outstandingAmount: await claimOutstanding(id) };
}

export async function listReimbursementClaims(filters: { status?: string; contactId?: number } = {}) {
  const conditions: any[] = [];
  if (filters.status) conditions.push(eq(reimbursementClaims.status, filters.status));
  if (filters.contactId) conditions.push(eq(reimbursementClaims.contactId, filters.contactId));
  const rows = conditions.length ? await db.select().from(reimbursementClaims).where(and(...conditions)).orderBy(sql`${reimbursementClaims.updatedAt} desc`) : await db.select().from(reimbursementClaims).orderBy(sql`${reimbursementClaims.updatedAt} desc`);
  return Promise.all(rows.map((claim) => getReimbursementClaim(claim.id)));
}
