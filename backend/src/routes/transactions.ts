import { eq, and, desc, sql, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client";
import { transactions, transactionLines, transactionTags, tags, accounts, categories, salaryPeriods } from "../db/schema";
import { createJournalEntry, createSimpleTransaction } from "../services/ledger";
import { auditCreate, auditUpdate, auditDelete } from "../services/audit";

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/transactions", async (request) => {
    const {
      startDate,
      endDate,
      accountId,
      txType,
      periodId,
      tagId,
      limit = "50",
      offset = "0",
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

    const conditions: any[] = [];

    if (startDate) {
      conditions.push(sql`${transactions.date} >= ${new Date(startDate).getTime()}`);
    }

    if (endDate) {
      conditions.push(sql`${transactions.date} <= ${new Date(endDate).getTime()}`);
    }

    if (txType) {
      conditions.push(eq(transactions.txType, txType));
    }

    if (periodId && periodId !== "undefined" && !isNaN(parseInt(periodId))) {
      conditions.push(eq(transactions.periodId, parseInt(periodId)));
    }

    let txList;
    if (accountId) {
      const results = await db
        .select({ id: transactions.id })
        .from(transactions)
        .innerJoin(transactionLines, eq(transactions.id, transactionLines.transactionId))
        .where(
          and(
            eq(transactionLines.accountId, parseInt(accountId)),
            conditions.length > 0 ? and(...conditions) : undefined,
          ),
        )
        .orderBy(desc(transactions.date))
        .limit(parseInt(limit))
        .offset(parseInt(offset));

      txList = await Promise.all(
        results.map(async (r) => {
          const [tx] = await db.select().from(transactions).where(eq(transactions.id, r.id)).limit(1);
          return tx;
        }),
      );
    } else if (tagId) {
      const results = await db
        .select({ id: transactions.id })
        .from(transactions)
        .innerJoin(transactionTags, eq(transactions.id, transactionTags.transactionId))
        .where(
          and(
            eq(transactionTags.tagId, parseInt(tagId)),
            conditions.length > 0 ? and(...conditions) : undefined,
          ),
        )
        .orderBy(desc(transactions.date))
        .limit(parseInt(limit))
        .offset(parseInt(offset));

      txList = await Promise.all(
        results.map(async (r) => {
          const [tx] = await db.select().from(transactions).where(eq(transactions.id, r.id)).limit(1);
          return tx;
        }),
      );
    } else {
      txList = await db
        .select()
        .from(transactions)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(transactions.date))
        .limit(parseInt(limit))
        .offset(parseInt(offset));
    }

    const transactionsWithDetails = await Promise.all(
      txList.map(async (tx) => {
        if (!tx) return null;
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
      }),
    );

    return transactionsWithDetails.filter(Boolean);
  });

  fastify.get("/api/transactions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const [tx] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, parseInt(id)))
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
          toWalletAccountId?: number;
          linkedTxId?: number | null;
          // Transport location fields
          originLat?: number | null;
          originLng?: number | null;
          originName?: string | null;
          destLat?: number | null;
          destLng?: number | null;
          destName?: string | null;
          distanceKm?: number | null;
        };

    try {
      let result: { transactionId: number; balancesByAccountId: Record<number, number> };

      if ("lines" in body && body.lines) {
        result = await createJournalEntry({
          date: new Date(body.date),
          description: body.description,
          reference: body.reference,
          notes: body.notes,
          place: body.place ?? null,
          txType: body.txType ?? "manual",
          periodId: body.periodId,
          linkedTxId: body.linkedTxId,
          categoryId: body.categoryId ?? null,
          lines: body.lines,
        });
      } else if ("kind" in body) {
        result = await createSimpleTransaction({
          kind: body.kind,
          amountCents: body.amountCents,
          description: body.description,
          notes: body.notes ?? null,
          place: body.place ?? null,
          date: new Date(body.date),
          periodId: body.periodId ?? null,
          categoryId: body.categoryId ?? null,
          linkedTxId: body.linkedTxId ?? null,
          txType:
            body.kind === "transfer"
              ? "simple_transfer"
              : `simple_${body.kind}`,
          walletAccountId: body.walletAccountId,
          toWalletAccountId: body.toWalletAccountId,
          // Transport location fields
          originLat: body.originLat ?? null,
          originLng: body.originLng ?? null,
          originName: body.originName ?? null,
          destLat: body.destLat ?? null,
          destLng: body.destLng ?? null,
          destName: body.destName ?? null,
          distanceKm: body.distanceKm ?? null,
        });
      } else {
        reply.code(400).send({ error: "Provide either journal lines or a simple transaction (kind, amountCents, ...)" });
        return;
      }

      const tagIds = "tagIds" in body && body.tagIds ? body.tagIds : [];
      if (tagIds.length > 0) {
        await db.insert(transactionTags).values(
          tagIds.map((tagId) => ({
            transactionId: result.transactionId,
            tagId,
          })),
        );
      }

      const [tx] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, result.transactionId))
        .limit(1);

      const lines = await db
        .select()
        .from(transactionLines)
        .where(eq(transactionLines.transactionId, tx!.id));

      await auditCreate("transaction", tx!.id, {
        ...tx,
        lines,
        tagIds,
      });

      reply.code(201).send({
        ...tx,
        lines,
        balancesByAccountId: result.balancesByAccountId,
      });
    } catch (err) {
      fastify.log.error(err);
      reply.code(400).send({ error: (err as Error).message });
    }
  });

  fastify.patch("/api/transactions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<{
      description: string;
      reference: string | null;
      notes: string | null;
      place: string | null;
      date: string;
      tagIds: number[];
      categoryId: number | null;
      // Transport location fields
      originLat: number | null;
      originLng: number | null;
      originName: string | null;
      destLat: number | null;
      destLng: number | null;
      destName: string | null;
      distanceKm: number | null;
    }>;

    const [existing] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, parseInt(id)))
      .limit(1);

    if (!existing) {
      reply.code(404).send({ error: "Transaction not found" });
      return;
    }

    const updates: any = {};
    if (body.description) updates.description = body.description;
    if (body.reference !== undefined) updates.reference = body.reference;
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.place !== undefined) updates.place = body.place;
    if (body.date) updates.date = new Date(body.date);
    if (body.categoryId !== undefined) updates.categoryId = body.categoryId;
    // Location fields for transport
    if (body.originLat !== undefined) updates.originLat = body.originLat;
    if (body.originLng !== undefined) updates.originLng = body.originLng;
    if (body.originName !== undefined) updates.originName = body.originName;
    if (body.destLat !== undefined) updates.destLat = body.destLat;
    if (body.destLng !== undefined) updates.destLng = body.destLng;
    if (body.destName !== undefined) updates.destName = body.destName;
    if (body.distanceKm !== undefined) updates.distanceKm = body.distanceKm;

    const [updated] = await db
      .update(transactions)
      .set(updates)
      .where(eq(transactions.id, parseInt(id)))
      .returning();

    if (body.tagIds !== undefined) {
      await db.delete(transactionTags).where(eq(transactionTags.transactionId, parseInt(id)));

      if (body.tagIds.length > 0) {
        await db.insert(transactionTags).values(
          body.tagIds.map((tagId) => ({
            transactionId: parseInt(id),
            tagId,
          })),
        );
      }
    }

    await auditUpdate("transaction", parseInt(id), existing, updated);

    return updated;
  });

  fastify.delete("/api/transactions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const [existing] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, parseInt(id)))
      .limit(1);

    if (!existing) {
      reply.code(404).send({ error: "Transaction not found" });
      return;
    }

    // Check if this is a fee transaction (has a parent/linked transaction)
    if (existing.linkedTxId) {
      reply.code(400).send({ 
        error: "Cannot delete fee transaction independently. Delete the parent transfer transaction instead." 
      });
      return;
    }

    const lines = await db
      .select()
      .from(transactionLines)
      .where(eq(transactionLines.transactionId, parseInt(id)));

    await auditDelete("transaction", parseInt(id), {
      ...existing,
      lines,
    });

    // Cascade delete: also delete any linked child transactions (e.g., transfer fees)
    const linkedTransactions = await db
      .select()
      .from(transactions)
      .where(eq(transactions.linkedTxId, parseInt(id)));

    for (const linkedTx of linkedTransactions) {
      const linkedLines = await db
        .select()
        .from(transactionLines)
        .where(eq(transactionLines.transactionId, linkedTx.id));
      
      await auditDelete("transaction", linkedTx.id, {
        ...linkedTx,
        lines: linkedLines,
      });
      
      await db.delete(transactions).where(eq(transactions.id, linkedTx.id));
    }

    await db.delete(transactions).where(eq(transactions.id, parseInt(id)));

    reply.code(204).send();
  });

  // Bulk delete transactions
  fastify.post("/api/transactions/bulk-delete", async (request, reply) => {
    const { ids } = request.body as { ids: number[] };
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      reply.code(400).send({ error: "No transaction IDs provided" });
      return;
    }
    
    // Verify all transactions exist
    const existingTransactions = await db
      .select()
      .from(transactions)
      .where(inArray(transactions.id, ids));
    
    if (existingTransactions.length !== ids.length) {
      reply.code(404).send({ 
        error: "Some transactions not found",
        requested: ids.length,
        found: existingTransactions.length 
      });
      return;
    }
    
    // Delete linked transactions first
    for (const id of ids) {
      const linkedTransactions = await db
        .select()
        .from(transactions)
        .where(eq(transactions.linkedTxId, id));
      
      for (const linkedTx of linkedTransactions) {
        const linkedLines = await db
          .select()
          .from(transactionLines)
          .where(eq(transactionLines.transactionId, linkedTx.id));
        
        await auditDelete("transaction", linkedTx.id, {
          ...linkedTx,
          lines: linkedLines,
        });
        
        await db.delete(transactions).where(eq(transactions.id, linkedTx.id));
      }
    }
    
    // Audit and delete main transactions
    for (const tx of existingTransactions) {
      const lines = await db
        .select()
        .from(transactionLines)
        .where(eq(transactionLines.transactionId, tx.id));
      
      await auditDelete("transaction", tx.id, { ...tx, lines });
    }
    
    // Perform bulk delete
    await db.delete(transactions).where(inArray(transactions.id, ids));
    
    reply.code(200).send({ 
      success: true, 
      deletedCount: ids.length,
      message: `${ids.length} transaction(s) deleted successfully` 
    });
  });

  // CSV Import - Preview endpoint
  fastify.post("/api/transactions/import/preview", async (request, reply) => {
    const { csvText } = request.body as { csvText: string };
    
    if (!csvText || typeof csvText !== 'string') {
      reply.code(400).send({ error: "CSV text is required" });
      return;
    }

    try {
      // Parse CSV
      const lines = csvText.split('\n').filter(line => line.trim());
      if (lines.length < 2) {
        reply.code(400).send({ error: "CSV must have at least a header row and one data row" });
        return;
      }

      // Parse header
      const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
      const requiredColumns = ['date', 'amount', 'description', 'type', 'account'];
      const missingColumns = requiredColumns.filter(col => !headers.includes(col));
      
      if (missingColumns.length > 0) {
        reply.code(400).send({ 
          error: `Missing required columns: ${missingColumns.join(', ')}` 
        });
        return;
      }
      
      // Check if period column is provided
      const hasPeriodColumn = headers.includes('period');

      // Get existing categories, accounts, and periods for matching
      const existingCategories = await db.select().from(categories);
      const existingAccounts = await db.select().from(accounts);
      const existingPeriods = await db.select().from(salaryPeriods);
      const uniquePeriods = new Set<string>();

      // Parse data rows
      const rows: any[] = [];
      const uniqueAccounts = new Set<string>();
      const uniqueCategories = new Set<string>();
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const values = parseCSVLine(line);
        const rowData: any = {
          rowNumber: i,
          errors: [],
          warnings: []
        };

        // Map columns
        headers.forEach((header, index) => {
          if (index < values.length) {
            rowData[header] = values[index].trim();
          }
        });

        // Parse and validate date (DD/MM/YYYY)
        const dateResult = parseDate(rowData.date);
        if (dateResult === null) {
          rowData.errors.push(`Invalid date format: "${rowData.date}". Expected DD/MM/YYYY`);
          rowData.isValid = false;
        } else {
          rowData.date = dateResult;
          rowData.isValid = true;
        }

        // Parse and validate amount (Rp format)
        const amountResult = parseAmount(rowData.amount);
        if (amountResult === null) {
          rowData.errors.push(`Invalid amount: "${rowData.amount}"`);
          rowData.isValid = false;
        } else {
          rowData.amount = amountResult;
        }

        // Validate type
        const validType = rowData.type?.toLowerCase();
        if (validType !== 'expense' && validType !== 'income') {
          rowData.errors.push(`Invalid type: "${rowData.type}". Must be 'expense' or 'income'`);
          rowData.isValid = false;
        } else {
          rowData.type = validType;
        }

        // Validate description
        if (!rowData.description || rowData.description.trim() === '') {
          rowData.errors.push('Description is required');
          rowData.isValid = false;
        }

        // Validate account
        if (!rowData.account || rowData.account.trim() === '') {
          rowData.errors.push('Account is required');
          rowData.isValid = false;
        } else {
          rowData.accountName = rowData.account.trim();
          uniqueAccounts.add(rowData.accountName);
          
          // Try to match account
          const matchedAccount = existingAccounts.find(
            a => a.name.toLowerCase() === rowData.accountName.toLowerCase()
          );
          rowData.accountMatched = !!matchedAccount;
          rowData.accountId = matchedAccount?.id || null;
          
          if (!rowData.accountMatched) {
            rowData.warnings.push(`Account "${rowData.accountName}" not found`);
          }
        }

        // Validate period (optional - will auto-infer from date if not provided)
        if (hasPeriodColumn && rowData.period && rowData.period.trim() !== '') {
          rowData.periodName = rowData.period.trim();
          uniquePeriods.add(rowData.periodName);
          
          // Try to match period by name
          const matchedPeriod = existingPeriods.find(
            p => p.name.toLowerCase() === rowData.periodName.toLowerCase()
          );
          rowData.periodMatched = !!matchedPeriod;
          rowData.periodId = matchedPeriod?.id || null;
          
          if (!rowData.periodMatched) {
            rowData.warnings.push(`Period "${rowData.periodName}" not found`);
          }
        } else {
          // Auto-infer period from transaction date
          const txDate = new Date(rowData.date);
          const inferredPeriod = existingPeriods.find(p => {
            const startDate = new Date(p.startDate);
            const endDate = new Date(p.endDate);
            return txDate >= startDate && txDate <= endDate;
          });
          
          if (inferredPeriod) {
            rowData.periodId = inferredPeriod.id;
            rowData.periodName = inferredPeriod.name;
            rowData.periodMatched = true;
          } else {
            rowData.periodId = null;
            rowData.periodName = null;
            rowData.periodMatched = false;
            rowData.warnings.push('No period found for transaction date');
          }
        }

        // Handle category (optional)
        if (rowData.category && rowData.category.trim() !== '') {
          rowData.categoryName = rowData.category.trim();
          uniqueCategories.add(rowData.categoryName);
          
          // Try to match category
          const matchedCategory = existingCategories.find(
            c => c.name.toLowerCase() === rowData.categoryName.toLowerCase()
          );
          rowData.categoryMatched = !!matchedCategory;
          rowData.categoryId = matchedCategory?.id || null;
          
          if (!rowData.categoryMatched) {
            rowData.warnings.push(`Category "${rowData.categoryName}" not found`);
          }
        } else {
          rowData.categoryName = null;
          rowData.categoryMatched = false;
          rowData.categoryId = null;
        }

        // Handle optional fields
        rowData.notes = rowData.notes || null;
        rowData.reference = rowData.reference || null;

        rows.push(rowData);
      }

      // Calculate summary
      const summary = {
        totalRows: rows.length,
        validRows: rows.filter(r => r.isValid && r.errors.length === 0).length,
        warningRows: rows.filter(r => r.warnings.length > 0).length,
        errorRows: rows.filter(r => r.errors.length > 0).length,
        totalIncome: rows
          .filter(r => r.type === 'income' && r.amount && !isNaN(r.amount))
          .reduce((sum, r) => sum + r.amount, 0),
        totalExpense: rows
          .filter(r => r.type === 'expense' && r.amount && !isNaN(r.amount))
          .reduce((sum, r) => sum + r.amount, 0),
        uniqueAccounts: Array.from(uniqueAccounts),
        uniqueCategories: Array.from(uniqueCategories),
        uniquePeriods: Array.from(uniquePeriods),
        missingAccounts: Array.from(uniqueAccounts).filter(
          name => !existingAccounts.some(a => a.name.toLowerCase() === name.toLowerCase())
        ),
        missingCategories: Array.from(uniqueCategories).filter(
          name => !existingCategories.some(c => c.name.toLowerCase() === name.toLowerCase())
        ),
        missingPeriods: Array.from(uniquePeriods).filter(
          name => !existingPeriods.some(p => p.name.toLowerCase() === name.toLowerCase())
        )
      };

      reply.code(200).send({
        rows,
        summary,
        existingCategories: existingCategories.map(c => ({ id: c.id, name: c.name })),
        existingAccounts: existingAccounts.map(a => ({ id: a.id, name: a.name })),
        existingPeriods: existingPeriods.map(p => ({ id: p.id, name: p.name }))
      });
    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({ 
        error: error instanceof Error ? error.message : 'Failed to parse CSV' 
      });
    }
  });

  // CSV Import - Confirm endpoint
  fastify.post("/api/transactions/import/confirm", async (request, reply) => {
    const { rows, categoryMappings, accountMappings, periodMappings } = request.body as {
      rows: Array<{
        date: string;
        description: string;
        amount: number;
        type: 'expense' | 'income';
        accountId: number;
        periodId?: number | null;
        categoryId?: number | null;
        notes?: string | null;
        reference?: string | null;
      }>;
      categoryMappings?: Record<string, number | null>;
      accountMappings?: Record<string, number | null>;
      periodMappings?: Record<string, number | null>;
    };

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      reply.code(400).send({ error: "No transactions to import" });
      return;
    }

    const imported: Array<{ id: number; description: string; amount: number }> = [];
    const errors: Array<{ row: number; message: string }> = [];
    let skipped = 0;

    try {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        
        try {
          // Determine final account, category, and period IDs
          const accountId = row.accountId;
          const categoryId = row.categoryId ?? null;
          const periodId = row.periodId ?? null;

          if (!accountId) {
            errors.push({ row: i + 1, message: "Account ID is required" });
            skipped++;
            continue;
          }

          // Create transaction using simple transaction pattern
          const result = await createSimpleTransaction({
            kind: row.type,
            amountCents: row.amount,
            description: row.description,
            notes: row.notes || null,
            place: null,
            date: new Date(row.date),
            periodId: periodId,
            categoryId: categoryId,
            linkedTxId: null,
            txType: `simple_${row.type}`,
            walletAccountId: accountId,
            toWalletAccountId: undefined,
            originLat: null,
            originLng: null,
            originName: null,
            destLat: null,
            destLng: null,
            destName: null,
            distanceKm: null
          });

          imported.push({
            id: result.transactionId,
            description: row.description,
            amount: row.amount
          });
        } catch (err) {
          errors.push({ 
            row: i + 1, 
            message: (err as Error).message 
          });
          skipped++;
        }
      }

      reply.code(200).send({
        imported: imported.length,
        skipped,
        errors,
        transactions: imported
      });
    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({ 
        error: error instanceof Error ? error.message : 'Failed to import transactions' 
      });
    }
  });
}

// Import CSV parsing functions
import { parseCSVLine, parseDate, parseAmount } from "../services/csvParser";
