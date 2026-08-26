import { eq, and, desc, sql, inArray, count, ne, notInArray, SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client";
import { transactions, transactionLines, transactionTags, transactionCategoryAllocations, tags, accounts, categories, auditLogs } from "../db/schema";
import {
  createJournalEntry,
  createSimpleTransaction,
  insertPreparedJournalEntrySync,
  prepareJournalEntry,
} from "../services/ledger";
import { invalidateOnTransactionMutation } from "../cache/invalidation";
import {
  deleteTransactionsAtomically,
  importTransactionsAtomically,
  TransactionMutationError,
  updateTransactionAtomically,
} from "../services/transaction-mutations";
import { processStorageDeletionOutbox } from "../services/storage-cleanup";
import { parseIdrInteger } from "../services/money";
import { findPeriodForDate } from "../services/period-locking";

// Pagination constants
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

// Helper to find period ID based on transaction date
async function findPeriodIdForDate(dateMs: number): Promise<number | null> {
  return (await findPeriodForDate(dateMs))?.id ?? null;
}

// Transaction columns selection - shared across all queries to avoid duplication
const transactionColumns = {
  id: transactions.id,
  date: transactions.date,
  dueDate: transactions.dueDate,
  description: transactions.description,
  reference: transactions.reference,
  notes: transactions.notes,
  place: transactions.place,
  txType: transactions.txType,
  status: transactions.status,
  periodId: transactions.periodId,
  linkedTxId: transactions.linkedTxId,
  reversalOfTxId: transactions.reversalOfTxId,
  categoryId: transactions.categoryId,
  installmentMonths: transactions.installmentMonths,
  interestRatePercent: transactions.interestRatePercent,
  adminFeeCents: transactions.adminFeeCents,
  totalInstallments: transactions.totalInstallments,
  originLat: transactions.originLat,
  originLng: transactions.originLng,
  originName: transactions.originName,
  destLat: transactions.destLat,
  destLng: transactions.destLng,
  destName: transactions.destName,
  distanceKm: transactions.distanceKm,
  createdAt: transactions.createdAt,
} as const;

// Validation helpers
function validatePagination(limit: string, offset: string): { limit: number; offset: number; error?: string } {
  const parsedLimit = parseInt(limit, 10);
  const parsedOffset = parseInt(offset, 10);

  if (isNaN(parsedLimit) || parsedLimit < 1) {
    return { limit: DEFAULT_LIMIT, offset: 0, error: "Limit must be a positive integer" };
  }

  if (isNaN(parsedOffset) || parsedOffset < 0) {
    return { limit: parsedLimit, offset: 0, error: "Offset must be a non-negative integer" };
  }

  // Enforce maximum limit to prevent resource exhaustion
  const clampedLimit = Math.min(parsedLimit, MAX_LIMIT);

  return { limit: clampedLimit, offset: parsedOffset };
}

function validateDate(dateStr: string): number | null {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    return null;
  }
  return date.getTime();
}

function parseIdParam(value: string | undefined): number | null {
  if (!value || value === "undefined") return null;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? null : parsed;
}

// Build base WHERE conditions for date range, txType, and periodId
function buildBaseConditions(
  startDate?: string,
  endDate?: string,
  txType?: string,
  periodId?: string,
  categoryId?: string
): { conditions: SQL[]; errors: string[] } {
  const conditions: SQL[] = [];
  const errors: string[] = [];

  if (startDate) {
    const startTime = validateDate(startDate);
    if (startTime === null) {
      errors.push("Invalid startDate format");
    } else {
      conditions.push(sql`${transactions.date} >= ${startTime}`);
    }
  }

  if (endDate) {
    const endTime = validateDate(endDate);
    if (endTime === null) {
      errors.push("Invalid endDate format");
    } else {
      conditions.push(sql`${transactions.date} <= ${endTime}`);
    }
  }

  if (txType) {
    conditions.push(eq(transactions.txType, txType));
  }

  const parsedPeriodId = parseIdParam(periodId);
  if (parsedPeriodId !== null) {
    conditions.push(eq(transactions.periodId, parsedPeriodId));
  }

  const parsedCategoryId = parseIdParam(categoryId);
  if (parsedCategoryId !== null) {
    conditions.push(eq(transactions.categoryId, parsedCategoryId));
  }

  return { conditions, errors };
}

// Fetch transaction details (lines and tags) in bulk to avoid N+1
async function fetchTransactionDetails(txIds: number[]) {
  if (txIds.length === 0) {
    return { linesByTxId: new Map(), tagsByTxId: new Map(), allocationsByTxId: new Map() };
  }

  // Fetch all lines for these transactions in one query
  const allLines = await db
    .select({
      id: transactionLines.id,
      transactionId: transactionLines.transactionId,
      accountId: transactionLines.accountId,
      debit: transactionLines.debit,
      credit: transactionLines.credit,
      description: transactionLines.description,
      cashFlowClass: transactionLines.cashFlowClass,
      // Keep account labels available for historical journals even after an
      // account is archived and omitted from the active account list.
      accountName: accounts.name,
      accountType: accounts.type,
      accountSystemKey: accounts.systemKey,
    })
    .from(transactionLines)
    .leftJoin(accounts, eq(transactionLines.accountId, accounts.id))
    .where(inArray(transactionLines.transactionId, txIds));

  // Fetch all tags for these transactions in one query
  const allTags = await db
    .select({
      transactionId: transactionTags.transactionId,
      tagId: transactionTags.tagId,
      name: tags.name,
      color: tags.color,
    })
    .from(transactionTags)
    .innerJoin(tags, eq(transactionTags.tagId, tags.id))
    .where(inArray(transactionTags.transactionId, txIds));

  const allAllocations = await db
    .select({
      transactionId: transactionCategoryAllocations.transactionId,
      categoryId: transactionCategoryAllocations.categoryId,
      amount: transactionCategoryAllocations.amount,
      categoryName: categories.name,
    })
    .from(transactionCategoryAllocations)
    .innerJoin(categories, eq(transactionCategoryAllocations.categoryId, categories.id))
    .where(inArray(transactionCategoryAllocations.transactionId, txIds));

  // Group by transaction ID
  const linesByTxId = new Map<number, typeof allLines>();
  const tagsByTxId = new Map<number, typeof allTags>();
  const allocationsByTxId = new Map<number, typeof allAllocations>();

  for (const line of allLines) {
    const existing = linesByTxId.get(line.transactionId) || [];
    existing.push(line);
    linesByTxId.set(line.transactionId, existing);
  }

  for (const tag of allTags) {
    const existing = tagsByTxId.get(tag.transactionId) || [];
    existing.push(tag);
    tagsByTxId.set(tag.transactionId, existing);
  }

  for (const allocation of allAllocations) {
    const existing = allocationsByTxId.get(allocation.transactionId) || [];
    existing.push(allocation);
    allocationsByTxId.set(allocation.transactionId, existing);
  }

  return { linesByTxId, tagsByTxId, allocationsByTxId };
}

// Return accounting effects once per journal, rather than making clients infer
// an amount from whichever line happens to be largest. These facets are used
// for display/filtering only; statements still come from the report read model.
async function fetchTransactionEffects(txIds: number[]) {
  if (txIds.length === 0) return new Map<number, { debitCents: number; creditCents: number; expenseCents: number; incomeCents: number }>();
  const rows = await db
    .select({
      transactionId: transactionLines.transactionId,
      debitCents: sql<number>`coalesce(sum(${transactionLines.debit}), 0)`,
      creditCents: sql<number>`coalesce(sum(${transactionLines.credit}), 0)`,
      expenseCents: sql<number>`coalesce(sum(case when ${accounts.type} = 'expense' then ${transactionLines.debit} - ${transactionLines.credit} else 0 end), 0)`,
      incomeCents: sql<number>`coalesce(sum(case when ${accounts.type} = 'revenue' then ${transactionLines.credit} - ${transactionLines.debit} else 0 end), 0)`,
    })
    .from(transactionLines)
    .innerJoin(accounts, eq(transactionLines.accountId, accounts.id))
    .where(inArray(transactionLines.transactionId, txIds))
    .groupBy(transactionLines.transactionId);
  return new Map(rows.map((row) => [row.transactionId, {
    debitCents: Number(row.debitCents ?? 0),
    creditCents: Number(row.creditCents ?? 0),
    expenseCents: Number(row.expenseCents ?? 0),
    incomeCents: Number(row.incomeCents ?? 0),
  }]));
}

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.post("/api/transactions/recommend-category", async (request, reply) => {
    const { name } = request.body as { name?: string };
    
    if (!name || name.trim().length < 2) {
      reply.code(400).send({ error: "Transaction name is required (min 2 characters)" });
      return;
    }

    const allCategories = await db.select().from(categories);
    
    if (allCategories.length === 0) {
      reply.code(500).send({ error: "No categories found in database" });
      return;
    }

    const categoryList = allCategories.map(c => `${c.icon || ''} ${c.name}`).join('\n');
    const systemPrompt = `You are a transaction categorizer. Given a transaction name/description, recommend the most appropriate category from the list below.
    
CATEGORIES:
${categoryList}

RULES:
- Return ONLY the exact category name (without icon) that best matches the transaction
- If uncertain, choose "Others"
- Do not explain your choice, just return the category name
- Match based on the main purpose of the transaction`;

    const userPrompt = `Transaction: "${name.trim()}"`;

    try {
      const { callOpenRouter } = await import('../services/openrouter');
      const { env } = await import('../lib/env');
      const apiKey = env.OPENROUTER_API_KEY;
      
      if (!apiKey) {
        reply.code(500).send({ error: "OpenRouter API key not configured" });
        return;
      }

      const recommendedName = await callOpenRouter(systemPrompt, userPrompt, apiKey);
      const matchedCategory = allCategories.find(
        c => c.name.toLowerCase() === recommendedName.trim().toLowerCase()
      );

      if (!matchedCategory) {
        const othersCategory = allCategories.find(c => c.name.toLowerCase() === 'others');
        if (othersCategory) {
          return { categoryId: othersCategory.id, categoryName: othersCategory.name };
        }
        return { categoryId: allCategories[0].id, categoryName: allCategories[0].name };
      }

      return { categoryId: matchedCategory.id, categoryName: matchedCategory.name };
    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({ error: "Failed to get category recommendation" });
    }
  });

  fastify.get("/api/transactions", async (request, reply) => {
    const {
      startDate,
      endDate,
      accountId,
      txType,
      periodId,
      categoryId,
      tagId,
      includeReversals: includeReversalsParam,
      limit: limitParam = String(DEFAULT_LIMIT),
      offset: offsetParam = "0",
    } = request.query as {
      startDate?: string;
      endDate?: string;
      accountId?: string;
      txType?: string;
      periodId?: string;
      categoryId?: string;
      tagId?: string;
      includeReversals?: string;
      limit?: string;
      offset?: string;
    };

    // Validate pagination parameters
    const { limit, offset, error: paginationError } = validatePagination(limitParam, offsetParam);
    if (paginationError) {
      reply.code(400).send({ error: paginationError });
      return;
    }

    // Build base conditions
    let periodIdToUse = periodId;
    
    // If periodId is "all", don't filter by period
    if (periodIdToUse === 'all') {
      periodIdToUse = undefined;
    }
    // If no periodId is provided AND no date range is specified, default to current period
    else if (!periodIdToUse && !startDate && !endDate) {
      const currentPeriod = await findPeriodForDate(Date.now());
      
      if (currentPeriod) {
        periodIdToUse = String(currentPeriod.id);
      }
    }
    
    const { conditions: baseConditions, errors: validationErrors } = buildBaseConditions(
      startDate,
      endDate,
      txType,
      periodIdToUse,
      categoryId
    );

    // The regular Transactions surface represents user activity, not the
    // internal bookkeeping mechanics of correcting a posted journal. Keep
    // inverse journals and their superseded originals out of the default
    // feed, while allowing audit/history consumers to opt in explicitly.
    if (includeReversalsParam !== "true") {
      baseConditions.push(
        notInArray(transactions.txType, ["reversal", "domain_reversal"]),
        ne(transactions.status, "reversed"),
      );
    }

    if (validationErrors.length > 0) {
      reply.code(400).send({ errors: validationErrors });
      return;
    }

    const parsedAccountId = parseIdParam(accountId);
    const parsedTagId = parseIdParam(tagId);

    // Validate that we don't have conflicting filters
    if (parsedAccountId !== null && parsedTagId !== null) {
      reply.code(400).send({ error: "Cannot filter by both accountId and tagId simultaneously" });
      return;
    }

    type TransactionRow = {
      id: number;
      date: Date;
      dueDate: Date | null;
      description: string;
      reference: string | null;
      notes: string | null;
      place: string | null;
      txType: string;
      status: string;
      periodId: number | null;
      linkedTxId: number | null;
      reversalOfTxId: number | null;
      categoryId: number | null;
      installmentMonths: number | null;
      interestRatePercent: number | null;
      adminFeeCents: number | null;
      totalInstallments: number | null;
      originLat: number | null;
      originLng: number | null;
      originName: string | null;
      destLat: number | null;
      destLng: number | null;
      destName: string | null;
      distanceKm: number | null;
      createdAt: Date;
    };

    let txList: TransactionRow[];
    let totalCount: number;

    if (parsedAccountId !== null) {
      // Query with account filter (uses DISTINCT to prevent duplicates from multiple lines)
      const accountCondition = eq(transactionLines.accountId, parsedAccountId);
      const whereCondition = baseConditions.length > 0
        ? and(accountCondition, ...baseConditions)
        : accountCondition;

      // Get total count for pagination
      const [countResult] = await db
        .select({ count: count() })
        .from(transactions)
        .innerJoin(transactionLines, eq(transactions.id, transactionLines.transactionId))
        .where(whereCondition);
      totalCount = countResult?.count || 0;

      // Get paginated results with DISTINCT
      txList = await db
        .selectDistinct(transactionColumns)
        .from(transactions)
        .innerJoin(transactionLines, eq(transactions.id, transactionLines.transactionId))
        .where(whereCondition)
        .orderBy(desc(transactions.date), desc(transactions.id))
        .limit(limit)
        .offset(offset);
    } else if (parsedTagId !== null) {
      // Query with tag filter
      const tagCondition = eq(transactionTags.tagId, parsedTagId);
      const whereCondition = baseConditions.length > 0
        ? and(tagCondition, ...baseConditions)
        : tagCondition;

      // Get total count for pagination
      const [countResult] = await db
        .select({ count: count() })
        .from(transactions)
        .innerJoin(transactionTags, eq(transactions.id, transactionTags.transactionId))
        .where(whereCondition);
      totalCount = countResult?.count || 0;

      // Get paginated results (no DISTINCT needed for tags - many-to-many but we select from transactions)
      txList = await db
        .selectDistinct(transactionColumns)
        .from(transactions)
        .innerJoin(transactionTags, eq(transactions.id, transactionTags.transactionId))
        .where(whereCondition)
        .orderBy(desc(transactions.date), desc(transactions.id))
        .limit(limit)
        .offset(offset);
    } else {
      // Base query without filters
      const whereCondition = baseConditions.length > 0 ? and(...baseConditions) : undefined;

      // Get total count for pagination
      const [countResult] = await db
        .select({ count: count() })
        .from(transactions)
        .where(whereCondition || sql`1=1`);
      totalCount = countResult?.count || 0;

      // Get paginated results
      txList = await db
        .select()
        .from(transactions)
        .where(whereCondition)
        .orderBy(desc(transactions.date), desc(transactions.id))
        .limit(limit)
        .offset(offset) as unknown as TransactionRow[];
    }

    // Fetch transaction details efficiently (bulk query, no N+1)
    const txIds = txList.map((tx) => tx.id).filter(Boolean);
    const { linesByTxId, tagsByTxId, allocationsByTxId } = await fetchTransactionDetails(txIds);
    const effectsByTxId = await fetchTransactionEffects(txIds);

    // Map transactions with their details
    const transactionsWithDetails = txList.map((tx) => ({
      ...tx,
      lines: linesByTxId.get(tx.id) || [],
      tags: tagsByTxId.get(tx.id) || [],
      categoryAllocations: allocationsByTxId.get(tx.id) || [],
      ...(effectsByTxId.get(tx.id) || { debitCents: 0, creditCents: 0, expenseCents: 0, incomeCents: 0 }),
    }));

    return {
      data: transactionsWithDetails,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: offset + txList.length < totalCount,
      },
    };
  });

  fastify.get("/api/transactions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsedId = parseInt(id, 10);

    if (isNaN(parsedId)) {
      reply.code(400).send({ error: "Invalid transaction ID" });
      return;
    }

    const [tx] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, parsedId))
      .limit(1);

    if (!tx) {
      reply.code(404).send({ error: "Transaction not found" });
      return;
    }

    const lines = await db
      .select()
      .from(transactionLines)
      .where(eq(transactionLines.transactionId, tx.id));
    const effects = (await fetchTransactionEffects([tx.id])).get(tx.id) || {
      debitCents: 0,
      creditCents: 0,
      expenseCents: 0,
      incomeCents: 0,
    };

    const txTagRows = await db
      .select({ tagId: transactionTags.tagId, name: tags.name, color: tags.color })
      .from(transactionTags)
      .innerJoin(tags, eq(transactionTags.tagId, tags.id))
      .where(eq(transactionTags.transactionId, tx.id));

    const categoryAllocationRows = await db
      .select({
        categoryId: transactionCategoryAllocations.categoryId,
        amount: transactionCategoryAllocations.amount,
        categoryName: categories.name,
      })
      .from(transactionCategoryAllocations)
      .innerJoin(categories, eq(transactionCategoryAllocations.categoryId, categories.id))
      .where(eq(transactionCategoryAllocations.transactionId, tx.id));

    return {
      ...tx,
      lines,
      tags: txTagRows,
      categoryAllocations: categoryAllocationRows,
      ...effects,
    };
  });

  fastify.post("/api/transactions", async (request, reply) => {
    const body = request.body as
      | {
          date: string;
          description: string;
          reference?: string | null;
          notes?: string | null;
          place?: string | null;
          txType?: string;
          periodId?: number | null;
          linkedTxId?: number | null;
          tagIds?: number[];
          categoryId?: number | null;
          categoryAllocations?: Array<{ categoryId: number; amount: number }>;
          lines: Array<{
            accountId: number;
            debit: number;
            credit: number;
            description?: string;
            cashFlowClass?: "operating" | "investing" | "financing" | "transfer" | "recovery" | null;
          }>;
        }
      | {
          kind: "expense" | "income" | "transfer";
          amountCents: number;
          description: string;
          notes?: string | null;
          place?: string | null;
          date: string;
          periodId?: number | null;
          categoryId?: number | null;
          tagIds?: number[];
          walletAccountId: number;
          toWalletAccountId?: number | null;
          linkedTxId?: number | null;
          originLat?: number | null;
          originLng?: number | null;
          originName?: string | null;
          destLat?: number | null;
          destLng?: number | null;
          destName?: string | null;
          distanceKm?: number | null;
          subscriptionId?: number;
        };

    try {
      if ("kind" in body) {
        const { kind, amountCents, description, notes, place, date, categoryId, tagIds, walletAccountId, toWalletAccountId, linkedTxId, originLat, originLng, originName, destLat, destLng, destName, distanceKm, subscriptionId } = body;
        if (subscriptionId !== undefined) {
          return reply.code(409).send({
            error: "Subscription payments must confirm a concrete renewal occurrence",
          });
        }
        
        // Auto-detect period based on transaction date
        const dateMs = new Date(date).getTime();
        const autoPeriodId = await findPeriodIdForDate(dateMs);
        
        if (kind === "transfer") {
          if (!toWalletAccountId) {
            reply.code(400).send({ error: "toWalletAccountId is required for transfers" });
            return;
          }
          const txResult = await createSimpleTransaction({
            kind: "transfer",
            amountCents,
            description,
            notes,
            place,
            date: new Date(date),
            periodId: autoPeriodId,
            categoryId,
            walletAccountId,
            toWalletAccountId,
            linkedTxId,
            tagIds,
          });

          reply.code(201).send({ id: txResult.transactionId, ...txResult });
          return;
        }
        const txResult = await createSimpleTransaction({
          kind,
          amountCents,
          description,
          notes,
          place,
          date: new Date(date),
          periodId: autoPeriodId,
          categoryId,
          walletAccountId,
          linkedTxId,
          originLat,
          originLng,
          originName,
          destLat,
          destLng,
          destName,
          distanceKm,
          tagIds,
        });

        reply.code(201).send({ id: txResult.transactionId, ...txResult });
        return;
      }

      const { date, description, reference, notes, place, txType, linkedTxId, tagIds, categoryId, categoryAllocations, lines } = body;
      if (txType != null && txType !== "manual") {
        return reply.code(400).send({ error: "Manual journal creation cannot choose a system transaction type" });
      }
      
      // Auto-detect period based on transaction date
      const dateMs = new Date(date).getTime();
      const autoPeriodId = await findPeriodIdForDate(dateMs);
      
      const txResult = await createJournalEntry({
        date: new Date(date),
        description,
        reference: reference ?? null,
        notes: notes ?? null,
        place: place ?? null,
        txType,
        periodId: autoPeriodId,
        linkedTxId,
        categoryId,
        categoryAllocations,
        tagIds,
        lines,
      });
      reply.code(201).send({ id: txResult.transactionId, ...txResult });
    } catch (err) {
      fastify.log.error(err);
      reply.code(400).send({ error: "Failed to create transaction" });
    }
  });

  /** Reverse a posted journal without erasing its audit history. */
  fastify.post("/api/transactions/:id/reverse", async (request, reply) => {
    const transactionId = parseIdParam((request.params as { id?: string }).id);
    if (transactionId === null) return reply.code(400).send({ error: "Invalid transaction ID" });
    try {
      const [original] = await db.select().from(transactions)
        .where(eq(transactions.id, transactionId)).limit(1);
      if (!original) return reply.code(404).send({ error: "Transaction not found" });
      if ([
        "salary_income", "salary_correction", "subscription_renewal", "subscription_correction",
        "paylater_recognition", "paylater_interest", "paylater_settlement",
        "loan_lending", "loan_payment", "loan_writeoff", "split_bill_lent", "split_bill_borrowed",
        "historical_recovery_adjustment",
      ].includes(original.txType)) {
        return reply.code(409).send({
          error: "This domain-owned transaction must use its dedicated correction workflow",
        });
      }
      if (original.status !== "posted") {
        return reply.code(409).send({ error: "Only a posted transaction can be reversed" });
      }
      const [existingReversal] = await db.select({ id: transactions.id })
        .from(transactions).where(eq(transactions.reversalOfTxId, transactionId)).limit(1);
      if (existingReversal) {
        return reply.code(409).send({ error: `Transaction already has reversal ${existingReversal.id}` });
      }
      const originalLines = await db.select().from(transactionLines)
        .where(eq(transactionLines.transactionId, transactionId));
      if (originalLines.length < 2) return reply.code(409).send({ error: "Cannot reverse an incomplete journal" });
      const originalAllocations = await db.select({
        categoryId: transactionCategoryAllocations.categoryId,
        amount: transactionCategoryAllocations.amount,
      }).from(transactionCategoryAllocations)
        .where(eq(transactionCategoryAllocations.transactionId, transactionId));
      const reversalDate = Date.now();
      const reversalPeriodId = await findPeriodIdForDate(reversalDate);
      const prepared = await prepareJournalEntry({
        date: reversalDate,
        description: `Reversal: ${original.description}`,
        reference: original.reference ? `REVERSAL:${original.reference}` : `REVERSAL:${original.id}`,
        notes: `Reverses posted transaction #${original.id}`,
        txType: "reversal",
        periodId: reversalPeriodId,
        reversalOfTxId: original.id,
        categoryId: original.categoryId,
        ...(originalAllocations.length > 0 ? {
          categoryAllocations: originalAllocations.map((allocation) => ({
            categoryId: allocation.categoryId,
            amount: -allocation.amount,
          })),
        } : {}),
        lines: originalLines.map((line) => ({
          accountId: line.accountId,
          debit: line.credit,
          credit: line.debit,
          description: `Reversal of ${line.description ?? original.description}`,
          cashFlowClass: line.cashFlowClass as "operating" | "investing" | "financing" | "transfer" | "recovery" | null,
        })),
      }, db);

      const result = db.transaction((tx) => {
        const fresh = tx.select().from(transactions)
          .where(eq(transactions.id, transactionId)).limit(1).all()[0];
        if (!fresh || fresh.status !== "posted") throw new Error("Transaction was changed; retry reversal");
        const [already] = tx.select({ id: transactions.id }).from(transactions)
          .where(eq(transactions.reversalOfTxId, transactionId)).limit(1).all();
        if (already) throw new Error(`Transaction already has reversal ${already.id}`);
        const reversalId = insertPreparedJournalEntrySync(tx, prepared);
        const updated = tx.update(transactions).set({ status: "reversed" })
          .where(and(eq(transactions.id, transactionId), eq(transactions.status, "posted"))).run();
        if (updated.changes !== 1) throw new Error("Failed to mark original transaction reversed");
        tx.insert(auditLogs).values({
          entityType: "transaction",
          entityId: transactionId,
          action: "update",
          beforeSnapshot: Buffer.from(JSON.stringify(fresh)),
          afterSnapshot: Buffer.from(JSON.stringify({ ...fresh, status: "reversed", reversalTransactionId: reversalId })),
        }).run();
        return reversalId;
      });
      await invalidateOnTransactionMutation({
        transactionId: result,
        affectedAccountIds: prepared.accountIds,
        affectedPeriodIds: reversalPeriodId == null ? undefined : [reversalPeriodId],
        revisionBumped: true,
      });
      return reply.code(201).send({ id: result, reversalOfTxId: transactionId });
    } catch (err) {
      fastify.log.error(err);
      return reply.code(409).send({ error: err instanceof Error ? err.message : "Failed to reverse transaction" });
    }
  });

  fastify.put("/api/transactions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      date?: string;
      description?: string;
      reference?: string | null;
      notes?: string | null;
      place?: string | null;
      txType?: string;
      categoryId?: number | null;
      tagIds?: number[];
      lines?: Array<{
        accountId: number;
        debit: number;
        credit: number;
        description?: string;
      }>;
    };

    try {
      const transactionId = parseIdParam(id);
      if (transactionId === null) {
        return reply.code(400).send({ error: "Invalid transaction ID" });
      }
      const updated = await updateTransactionAtomically(transactionId, body);
      return reply.code(200).send(updated);
    } catch (err) {
      fastify.log.error(err);
      const status = err instanceof TransactionMutationError ? err.statusCode : 500;
      return reply.code(status).send({
        error: err instanceof Error ? err.message : "Failed to update transaction",
      });
    }
  });

  fastify.delete("/api/transactions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const txId = parseIdParam(id);
      if (txId === null) return reply.code(400).send({ error: "Invalid transaction ID" });
      const result = await deleteTransactionsAtomically([txId]);
      // Cleanup is best-effort after commit; failures remain durable in the outbox.
      if (result.outboxIds.length > 0) void processStorageDeletionOutbox(result.outboxIds);
      return reply.code(204).send();
    } catch (err) {
      fastify.log.error(err);
      const status = err instanceof TransactionMutationError ? err.statusCode : 500;
      return reply.code(status).send({
        error: err instanceof Error ? err.message : "Failed to delete transaction",
      });
    }
  });

  // Bulk delete transactions
  fastify.post("/api/transactions/bulk-delete", async (request, reply) => {
    const { ids } = request.body as { ids: number[] };
    try {
      if (!Array.isArray(ids)) throw new TransactionMutationError("ids array is required", 400);
      const result = await deleteTransactionsAtomically(ids);
      if (result.outboxIds.length > 0) void processStorageDeletionOutbox(result.outboxIds);
      return reply.send({
        success: true,
        deletedCount: result.deletedCount,
        message: `Deleted ${result.deletedCount} transaction(s)`,
      });
    } catch (err) {
      fastify.log.error(err);
      const status = err instanceof TransactionMutationError ? err.statusCode : 500;
      return reply.code(status).send({
        error: err instanceof Error ? err.message : "Failed to bulk delete transactions",
      });
    }
  });

  // Import preview endpoint
  fastify.post("/api/transactions/import-preview", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute", groupId: "transaction-import" } },
  }, async (request, reply) => {
    const { csvText, mappings, hasHeader, accountId, dateFormat } = request.body as {
      csvText: string;
      mappings: Record<string, string>;
      hasHeader: boolean;
      accountId: number;
      dateFormat: string;
    };

    try {
      const lines = csvText.split("\n").filter((line) => line.trim());
      if (lines.length === 0) {
        reply.code(400).send({ error: "Empty CSV" });
        return;
      }

      const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().trim());
      const dataStartIndex = hasHeader ? 1 : 0;
      const rows = lines.slice(dataStartIndex);

      const preview = [];
      for (let i = 0; i < Math.min(rows.length, 5); i++) {
        const values = parseCSVLine(rows[i]);
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => {
          row[h] = values[idx] ?? "";
        });

        const dateRaw = row[mappings.date?.toLowerCase()] ?? "";
        const parsedDate = parseDateWithFormat(dateRaw, dateFormat);

        const amountRaw = row[mappings.amount?.toLowerCase()] ?? "";
        const amountCents = parseRupiah(amountRaw);

        const description = row[mappings.description?.toLowerCase()] ?? "";

        preview.push({
          rowNumber: dataStartIndex + i + 1,
          date: parsedDate,
          amountCents,
          description,
          raw: row,
        });
      }

      reply.send({ preview, totalRows: rows.length });
    } catch (err) {
      fastify.log.error(err);
      reply.code(400).send({ error: "Failed to preview import" });
    }
  });

  // Import confirm endpoint
  fastify.post("/api/transactions/import-confirm", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute", groupId: "transaction-import" } },
  }, async (request, reply) => {
    const { rows, accountId, defaultDescription, tagIds } = request.body as {
      rows: Array<{ date: string; amountCents: number; description: string }>;
      accountId: number;
      defaultDescription: string;
      tagIds?: number[];
    };

    try {
      const results = await importTransactionsAtomically({
        rows: rows.map((row) => ({
          date: row.date,
          amount: row.amountCents,
          description: row.description,
        })),
        accountId,
        defaultDescription,
        tagIds,
      });
      return reply.code(201).send({ imported: results.length, transactions: results });
    } catch (err) {
      fastify.log.error(err);
      const status = err instanceof TransactionMutationError ? err.statusCode : 500;
      return reply.code(status).send({
        error: err instanceof Error ? err.message : "Failed to import transactions",
      });
    }
  });
}

// CSV parsing utilities
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function parseDateWithFormat(dateStr: string, format: string): string | null {
  if (!dateStr) return null;

  // Simple date parsing - assumes format like "DD/MM/YYYY" or "MM/DD/YYYY"
  const parts = dateStr.split(/[\/\-\.]/);
  if (parts.length !== 3) return null;

  try {
    const formatParts = format.toUpperCase().split(/[\/\-\.]/);
    const dayIndex = formatParts.indexOf("DD");
    const monthIndex = formatParts.indexOf("MM");
    const yearIndex = formatParts.indexOf("YYYY");

    if (dayIndex === -1 || monthIndex === -1 || yearIndex === -1) {
      return null;
    }

    const day = parseInt(parts[dayIndex], 10);
    const month = parseInt(parts[monthIndex], 10);
    const year = parseInt(parts[yearIndex], 10);

    const date = new Date(year, month - 1, day);
    if (isNaN(date.getTime())) return null;

    return date.toISOString().split("T")[0];
  } catch {
    return null;
  }
}

function parseRupiah(amountStr: string): number {
  return parseIdrInteger(amountStr) ?? 0;
}
