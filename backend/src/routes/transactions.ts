import { eq, and, desc, sql, inArray, count, SQL, lte, gte } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client";
import { transactions, transactionLines, transactionTags, tags, accounts, categories, salaryPeriods, loans } from "../db/schema";
import { createJournalEntry, createSimpleTransaction } from "../services/ledger";
import { auditCreate, auditUpdate, auditDelete } from "../services/audit";
import { invalidateOnTransactionMutation } from "../cache";

// Pagination constants
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

// Helper to find period ID based on transaction date
async function findPeriodIdForDate(dateMs: number): Promise<number | null> {
  const [period] = await db
    .select({ id: salaryPeriods.id })
    .from(salaryPeriods)
    .where(
      and(
        lte(salaryPeriods.startDate, dateMs),
        gte(salaryPeriods.endDate, dateMs)
      )
    )
    .limit(1);
  return period?.id ?? null;
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
  periodId: transactions.periodId,
  linkedTxId: transactions.linkedTxId,
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
  periodId?: string
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

  return { conditions, errors };
}

// Fetch transaction details (lines and tags) in bulk to avoid N+1
async function fetchTransactionDetails(txIds: number[]) {
  if (txIds.length === 0) {
    return { linesByTxId: new Map(), tagsByTxId: new Map() };
  }

  // Fetch all lines for these transactions in one query
  const allLines = await db
    .select()
    .from(transactionLines)
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

  // Group by transaction ID
  const linesByTxId = new Map<number, typeof allLines>();
  const tagsByTxId = new Map<number, typeof allTags>();

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

  return { linesByTxId, tagsByTxId };
}

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/transactions", async (request, reply) => {
    const {
      startDate,
      endDate,
      accountId,
      txType,
      periodId,
      tagId,
      limit: limitParam = String(DEFAULT_LIMIT),
      offset: offsetParam = "0",
    } = request.query as {
      startDate?: string;
      endDate?: string;
      accountId?: string;
      txType?: string;
      periodId?: string;
      tagId?: string;
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
      const now = Date.now();
      const [currentPeriod] = await db
        .select({ id: salaryPeriods.id })
        .from(salaryPeriods)
        .where(and(
          lte(salaryPeriods.startDate, now),
          gte(salaryPeriods.endDate, now)
        ))
        .limit(1);
      
      if (currentPeriod) {
        periodIdToUse = String(currentPeriod.id);
      }
    }
    
    const { conditions: baseConditions, errors: validationErrors } = buildBaseConditions(
      startDate,
      endDate,
      txType,
      periodIdToUse
    );

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
      periodId: number | null;
      linkedTxId: number | null;
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
        .orderBy(desc(transactions.date))
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
        .orderBy(desc(transactions.date))
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
        .orderBy(desc(transactions.date))
        .limit(limit)
        .offset(offset);
    }

    // Fetch transaction details efficiently (bulk query, no N+1)
    const txIds = txList.map((tx) => tx.id).filter(Boolean);
    const { linesByTxId, tagsByTxId } = await fetchTransactionDetails(txIds);

    // Map transactions with their details
    const transactionsWithDetails = txList.map((tx) => ({
      ...tx,
      lines: linesByTxId.get(tx.id) || [],
      tags: tagsByTxId.get(tx.id) || [],
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

    const txTagRows = await db
      .select({ tagId: transactionTags.tagId, name: tags.name, color: tags.color })
      .from(transactionTags)
      .innerJoin(tags, eq(transactionTags.tagId, tags.id))
      .where(eq(transactionTags.transactionId, tx.id));

    return {
      ...tx,
      lines,
      tags: txTagRows,
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
          lines: Array<{
            accountId: number;
            debit: number;
            credit: number;
            description?: string;
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
            subscriptionId,
          });
          
          // Handle tags separately since createSimpleTransaction doesn't support them
          if (tagIds && tagIds.length > 0) {
            await db.insert(transactionTags).values(tagIds.map((tagId) => ({ transactionId: txResult.transactionId, tagId })));
          }
          
          await auditCreate("transaction", txResult.transactionId, { description, amountCents, kind });
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
          subscriptionId,
        });
        
        // Handle tags separately since createSimpleTransaction doesn't support them
        if (tagIds && tagIds.length > 0) {
          await db.insert(transactionTags).values(tagIds.map((tagId) => ({ transactionId: txResult.transactionId, tagId })));
        }
        
        await auditCreate("transaction", txResult.transactionId, { description, amountCents, kind });
        reply.code(201).send({ id: txResult.transactionId, ...txResult });
        return;
      }

      const { date, description, reference, notes, place, txType, linkedTxId, tagIds, categoryId, lines } = body;
      
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
        lines,
      });

      if (tagIds && tagIds.length > 0) {
        await db.insert(transactionTags).values(tagIds.map((tagId) => ({ transactionId: txResult.transactionId, tagId })));
      }

      await auditCreate("transaction", txResult.transactionId, { description, lineCount: lines.length });
      reply.code(201).send({ id: txResult.transactionId, ...txResult });
    } catch (err) {
      fastify.log.error(err);
      reply.code(400).send({ error: (err as Error).message });
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
      periodId?: number | null;
      categoryId?: number | null;
      tagIds?: number[];
      lines?: Array<{
        accountId: number;
        debit: number;
        credit: number;
        description?: string;
      }>;
    };

    fastify.log.info({ body, params: request.params }, "PUT transaction request");

    const [existing] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, parseInt(id)))
      .limit(1);

    if (!existing) {
      return reply.code(404).send({ error: "Transaction not found" });
    }

    try {
      const updates: Record<string, unknown> = {};
      let newDateMs: number | null = null;
      
      if (body.date !== undefined) {
        try {
          const dateVal = new Date(body.date);
          if (isNaN(dateVal.getTime())) {
            throw new Error("Invalid date: " + body.date);
          }
          newDateMs = dateVal.getTime();
          updates.date = newDateMs;
        } catch (dateErr) {
          fastify.log.error({ err: dateErr, bodyDate: body.date }, "date parsing error");
          throw dateErr;
        }
      }
      if (body.description !== undefined) updates.description = body.description;
      if (body.reference !== undefined) updates.reference = body.reference;
      if (body.notes !== undefined) updates.notes = body.notes;
      if (body.place !== undefined) updates.place = body.place;
      if (body.txType !== undefined) updates.txType = body.txType;
      if (body.categoryId !== undefined) updates.categoryId = body.categoryId;

      // Auto-update periodId based on transaction date if date is changing
      if (newDateMs !== null) {
        const newPeriodId = await findPeriodIdForDate(newDateMs);
        updates.periodId = newPeriodId;
      }

      // Map camelCase to snake_case for database columns
      const columnMap: Record<string, string> = {
        date: 'date',
        description: 'description',
        reference: 'reference',
        notes: 'notes',
        place: 'place',
        txType: 'tx_type',
        periodId: 'period_id',
        categoryId: 'category_id',
      };

      if (Object.keys(updates).length > 0) {
        const setClauses: string[] = [];
        const values: unknown[] = [];
        for (const [key, value] of Object.entries(updates)) {
          const col = columnMap[key] || key;
          setClauses.push(`${col} = ?`);
          values.push(value);
        }
        const stmt = db.$client.prepare(`UPDATE "transaction" SET ${setClauses.join(', ')} WHERE id = ?`);
        stmt.run(...values, parseInt(id));
      }

      if (body.lines && body.lines.length > 0) {
        await db.delete(transactionLines).where(eq(transactionLines.transactionId, parseInt(id)));
        await db.insert(transactionLines).values(
          body.lines.map((line) => ({
            transactionId: parseInt(id),
            accountId: line.accountId,
            debit: line.debit,
            credit: line.credit,
            description: line.description ?? null,
          }))
        );
      }

      if (body.tagIds !== undefined) {
        await db.delete(transactionTags).where(eq(transactionTags.transactionId, parseInt(id)));
        if (body.tagIds.length > 0) {
          await db.insert(transactionTags).values(body.tagIds.map((tagId) => ({ transactionId: parseInt(id), tagId })));
        }
      }

      // await auditUpdate("transaction", parseInt(id), existing, updates);
      reply.code(200).send({ id: parseInt(id), ...updates });
    } catch (err) {
      fastify.log.error(err);
      reply.code(400).send({ error: (err as Error).message });
    }
  });

  fastify.delete("/api/transactions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const txId = parseInt(id);

    try {
      // Get affected account IDs before deleting
      const linesToDelete = await db
        .select({ accountId: transactionLines.accountId })
        .from(transactionLines)
        .where(eq(transactionLines.transactionId, txId));
      const affectedAccountIds = [...new Set(linesToDelete.map(l => l.accountId))];

      // Fetch transaction before deleting for audit log
      const [existing] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, txId))
        .limit(1);

      if (!existing) {
        reply.code(404).send({ error: "Transaction not found" });
        return;
      }

      // Check if this transaction is linked to a loan and delete the loan too
      const linkedLoans = await db
        .select()
        .from(loans)
        .where(eq(loans.lendingTransactionId, txId));
      
      // Soft delete linked loans
      for (const loan of linkedLoans) {
        await db
          .update(loans)
          .set({ 
            isActive: false,
            updatedAt: sql`(unixepoch('now') * 1000)`,
          })
          .where(eq(loans.id, loan.id));
      }

      await db.delete(transactionTags).where(eq(transactionTags.transactionId, txId));
      await db.delete(transactionLines).where(eq(transactionLines.transactionId, txId));
      await db.delete(transactions).where(eq(transactions.id, txId));

      await auditDelete("transaction", txId, existing);

      // Invalidate caches after successful deletion
      try {
        await invalidateOnTransactionMutation({
          transactionId: txId,
          affectedAccountIds,
        });
      } catch (cacheErr) {
        console.error('Cache invalidation error (transaction was deleted):', cacheErr);
      }

      reply.code(204).send();
    } catch (err) {
      fastify.log.error(err);
      console.error('Delete transaction error:', err);
      reply.code(500).send({ error: "Failed to delete transaction", details: (err as Error).message });
    }
  });

  // Bulk delete transactions
  fastify.post("/api/transactions/bulk-delete", async (request, reply) => {
    const { ids } = request.body as { ids: number[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      reply.code(400).send({ error: "ids array is required" });
      return;
    }

    try {
      let deletedCount = 0;
      for (const txId of ids) {
        // Get affected account IDs before deleting
        const linesToDelete = await db
          .select({ accountId: transactionLines.accountId })
          .from(transactionLines)
          .where(eq(transactionLines.transactionId, txId));
        const affectedAccountIds = [...new Set(linesToDelete.map(l => l.accountId))];

        const [existing] = await db
          .select()
          .from(transactions)
          .where(eq(transactions.id, txId))
          .limit(1);

        if (!existing) continue;

        // Check for linked loans
        const linkedLoans = await db
          .select()
          .from(loans)
          .where(eq(loans.lendingTransactionId, txId));
        
        for (const loan of linkedLoans) {
          await db
            .update(loans)
            .set({ 
              isActive: false,
              updatedAt: sql`(unixepoch('now') * 1000)`,
            })
            .where(eq(loans.id, loan.id));
        }

        await db.delete(transactionTags).where(eq(transactionTags.transactionId, txId));
        await db.delete(transactionLines).where(eq(transactionLines.transactionId, txId));
        await db.delete(transactions).where(eq(transactions.id, txId));
        
        await auditDelete("transaction", txId, existing);
        deletedCount++;

        // Invalidate cache for this transaction
        try {
          await invalidateOnTransactionMutation({
            transactionId: txId,
            affectedAccountIds,
          });
        } catch (cacheErr) {
          console.error('Cache invalidation error:', cacheErr);
        }
      }

      reply.send({ success: true, deletedCount, message: `Deleted ${deletedCount} transaction(s)` });
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ error: "Failed to bulk delete transactions" });
    }
  });

  // Import preview endpoint
  fastify.post("/api/transactions/import-preview", async (request, reply) => {
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
      reply.code(400).send({ error: (err as Error).message });
    }
  });

  // Import confirm endpoint
  fastify.post("/api/transactions/import-confirm", async (request, reply) => {
    const { rows, accountId, defaultDescription, tagIds, periodId } = request.body as {
      rows: Array<{ date: string; amountCents: number; description: string }>;
      accountId: number;
      defaultDescription: string;
      tagIds?: number[];
      periodId?: number | null;
    };

    try {
      // Use transaction for atomic bulk import
      const results = await db.transaction(async (tx) => {
        const imported: Array<{ id: number; transactionId: number; balancesByAccountId: Record<number, number> }> = [];
        
        for (const row of rows) {
          const kind: "expense" | "income" = row.amountCents >= 0 ? "expense" : "income";
          const absAmount = Math.abs(row.amountCents);

          const txResult = await createSimpleTransaction({
            kind,
            amountCents: absAmount,
            description: row.description || defaultDescription,
            date: new Date(row.date),
            periodId,
            walletAccountId: accountId,
          });
          
          // Handle tags separately
          if (tagIds && tagIds.length > 0) {
            await tx.insert(transactionTags).values(tagIds.map((tagId) => ({ transactionId: txResult.transactionId, tagId })));
          }
          
          imported.push({ id: txResult.transactionId, ...txResult });
        }
        
        return imported;
      });

      reply.code(201).send({ imported: results.length, transactions: results });
    } catch (err) {
      fastify.log.error(err);
      reply.code(400).send({ error: (err as Error).message });
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
  if (!amountStr) return 0;

  // Remove currency symbols, dots (thousand separators), and spaces
  const cleaned = amountStr.replace(/[Rp\s\.]/gi, "").replace(",", ".");
  const amount = parseFloat(cleaned);

  if (isNaN(amount)) return 0;

  // Convert to cents
  return Math.round(amount * 100);
}
