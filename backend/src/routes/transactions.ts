import { eq, and, desc, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client";
import { transactions, transactionLines, transactionTags, tags } from "../db/schema";
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
}
