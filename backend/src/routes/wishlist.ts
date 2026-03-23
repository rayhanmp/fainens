import { eq, and, desc, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client";
import { wishlist, transactions, transactionLines, categories, salaryPeriods } from "../db/schema";
import { auditCreate, auditUpdate, auditDelete } from "../services/audit";

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  // Get all wishlist items with optional filtering
  fastify.get("/api/wishlist", async (request) => {
    const { status, categoryId, periodId } = request.query as { 
      status?: string; 
      categoryId?: string;
      periodId?: string;
    };

    let query = db
      .select({
        id: wishlist.id,
        name: wishlist.name,
        description: wishlist.description,
        amount: wishlist.amount,
        status: wishlist.status,
        createdAt: wishlist.createdAt,
        updatedAt: wishlist.updatedAt,
        fulfilledAt: wishlist.fulfilledAt,
        fulfilledTransactionId: wishlist.fulfilledTransactionId,
        categoryId: wishlist.categoryId,
        periodId: wishlist.periodId,
        imageUrl: wishlist.imageUrl,
        category: {
          id: categories.id,
          name: categories.name,
          icon: categories.icon,
          color: categories.color,
        },
        period: {
          id: salaryPeriods.id,
          name: salaryPeriods.name,
          startDate: salaryPeriods.startDate,
          endDate: salaryPeriods.endDate,
        },
      })
      .from(wishlist)
      .leftJoin(categories, eq(wishlist.categoryId, categories.id))
      .leftJoin(salaryPeriods, eq(wishlist.periodId, salaryPeriods.id))
      .$dynamic();

    const conditions = [];
    
    if (status) {
      conditions.push(eq(wishlist.status, status));
    }
    
    if (categoryId) {
      conditions.push(eq(wishlist.categoryId, parseInt(categoryId)));
    }
    
    if (periodId) {
      conditions.push(eq(wishlist.periodId, parseInt(periodId)));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    const items = await query.orderBy(desc(wishlist.createdAt));
    return items;
  });

  // Get a single wishlist item
  fastify.get("/api/wishlist/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const [item] = await db
      .select({
        id: wishlist.id,
        name: wishlist.name,
        description: wishlist.description,
        amount: wishlist.amount,
        status: wishlist.status,
        createdAt: wishlist.createdAt,
        updatedAt: wishlist.updatedAt,
        fulfilledAt: wishlist.fulfilledAt,
        fulfilledTransactionId: wishlist.fulfilledTransactionId,
        categoryId: wishlist.categoryId,
        periodId: wishlist.periodId,
        imageUrl: wishlist.imageUrl,
        category: {
          id: categories.id,
          name: categories.name,
          icon: categories.icon,
          color: categories.color,
        },
        period: {
          id: salaryPeriods.id,
          name: salaryPeriods.name,
          startDate: salaryPeriods.startDate,
          endDate: salaryPeriods.endDate,
        },
      })
      .from(wishlist)
      .leftJoin(categories, eq(wishlist.categoryId, categories.id))
      .leftJoin(salaryPeriods, eq(wishlist.periodId, salaryPeriods.id))
      .where(eq(wishlist.id, parseInt(id)))
      .limit(1);

    if (!item) {
      reply.code(404).send({ error: "Wishlist item not found" });
      return;
    }

    return item;
  });

  // Create a new wishlist item
  fastify.post("/api/wishlist", async (request, reply) => {
    const body = request.body as {
      name: string;
      description?: string | null;
      amount: number;
      categoryId?: number | null;
      periodId?: number | null;
      imageUrl?: string | null;
    };

    // Validation
    if (!body.name || body.name.trim() === '') {
      reply.code(400).send({ error: 'Wishlist item name is required' });
      return;
    }

    if (body.amount === undefined || body.amount === null || isNaN(body.amount) || body.amount < 0) {
      reply.code(400).send({ error: 'Valid amount is required' });
      return;
    }

    try {
      const [item] = await db
        .insert(wishlist)
        .values({
          name: body.name.trim(),
          description: body.description ?? null,
          amount: body.amount,
          categoryId: body.categoryId ?? null,
          periodId: body.periodId ?? null,
          imageUrl: body.imageUrl ?? null,
          status: "active",
        })
        .returning();

      await auditCreate("wishlist", item.id, { 
        name: item.name, 
        amount: item.amount,
        categoryId: item.categoryId,
        periodId: item.periodId,
      });

      reply.code(201).send(item);
    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({ error: error instanceof Error ? error.message : 'Failed to create wishlist item' });
    }
  });

  // Update a wishlist item
  fastify.patch("/api/wishlist/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<{
      name: string;
      description: string | null;
      amount: number;
      categoryId: number | null;
      periodId: number | null;
      status: string;
    }>;

    const [existing] = await db
      .select()
      .from(wishlist)
      .where(eq(wishlist.id, parseInt(id)))
      .limit(1);

    if (!existing) {
      reply.code(404).send({ error: "Wishlist item not found" });
      return;
    }

    const [updated] = await db
      .update(wishlist)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.amount !== undefined && { amount: body.amount }),
        ...(body.categoryId !== undefined && { categoryId: body.categoryId }),
        ...(body.periodId !== undefined && { periodId: body.periodId }),
        ...(body.status !== undefined && { status: body.status }),
        updatedAt: sql`(unixepoch('now') * 1000)`,
      })
      .where(eq(wishlist.id, parseInt(id)))
      .returning();

    await auditUpdate("wishlist", parseInt(id), existing, updated);

    return updated;
  });

  // Delete a wishlist item
  fastify.delete("/api/wishlist/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const [existing] = await db
      .select()
      .from(wishlist)
      .where(eq(wishlist.id, parseInt(id)))
      .limit(1);

    if (!existing) {
      reply.code(404).send({ error: "Wishlist item not found" });
      return;
    }

    await db.delete(wishlist).where(eq(wishlist.id, parseInt(id)));

    await auditDelete("wishlist", parseInt(id), existing);

    reply.code(204).send();
  });

  // Fulfill a wishlist item by creating a real transaction
  fastify.post("/api/wishlist/:id/fulfill", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      date: string; // ISO date string
      accountId: number;
      description?: string;
      notes?: string;
    };

    // Get the wishlist item
    const [item] = await db
      .select()
      .from(wishlist)
      .where(eq(wishlist.id, parseInt(id)))
      .limit(1);

    if (!item) {
      reply.code(404).send({ error: "Wishlist item not found" });
      return;
    }

    if (item.status === "fulfilled") {
      reply.code(400).send({ error: "Wishlist item is already fulfilled" });
      return;
    }

    // Create the actual transaction
    const [transaction] = await db
      .insert(transactions)
      .values({
        date: sql`${new Date(body.date).getTime()}`,
        description: body.description || item.name,
        notes: body.notes || item.description,
        txType: "simple_expense",
        categoryId: item.categoryId,
      })
      .returning();

    // Create transaction line for the expense
    await db.insert(transactionLines).values({
      transactionId: transaction.id,
      accountId: body.accountId,
      debit: item.amount,
      credit: 0,
      description: body.description || item.name,
    });

    // Update wishlist item as fulfilled
    const fulfilledAt = Date.now();
    const [updated] = await db
      .update(wishlist)
      .set({
        status: "fulfilled",
        fulfilledAt: sql`${fulfilledAt}`,
        fulfilledTransactionId: transaction.id,
        updatedAt: sql`${fulfilledAt}`,
      })
      .where(eq(wishlist.id, parseInt(id)))
      .returning();

    await auditUpdate("wishlist", parseInt(id), item, updated);
    await auditCreate("transaction", transaction.id, { 
      wishlistId: item.id,
      description: transaction.description,
      amount: item.amount,
    });

    return {
      wishlist: updated,
      transaction,
    };
  });

  // Link wishlist item to existing transaction
  fastify.post("/api/wishlist/:id/link", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      transactionId: number;
    };

    // Get the wishlist item
    const [item] = await db
      .select()
      .from(wishlist)
      .where(eq(wishlist.id, parseInt(id)))
      .limit(1);

    if (!item) {
      reply.code(404).send({ error: "Wishlist item not found" });
      return;
    }

    if (item.status === "fulfilled") {
      reply.code(400).send({ error: "Wishlist item is already fulfilled" });
      return;
    }

    // Verify the transaction exists
    const [existingTransaction] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, body.transactionId))
      .limit(1);

    if (!existingTransaction) {
      reply.code(404).send({ error: "Transaction not found" });
      return;
    }

    // Update wishlist item as fulfilled with link to existing transaction
    const fulfilledAt = Date.now();
    const [updated] = await db
      .update(wishlist)
      .set({
        status: "fulfilled",
        fulfilledAt: sql`${fulfilledAt}`,
        fulfilledTransactionId: body.transactionId,
        updatedAt: sql`${fulfilledAt}`,
      })
      .where(eq(wishlist.id, parseInt(id)))
      .returning();

    await auditUpdate("wishlist", parseInt(id), item, updated);

    return {
      wishlist: updated,
      transaction: existingTransaction,
    };
  });

  // Scrape product data from URL
  fastify.post("/api/wishlist/scrape", async (request, reply) => {
    const { url } = request.body as { url: string };
    
    if (!url || typeof url !== 'string') {
      reply.code(400).send({
        success: false,
        attempts: [],
        requiresAdvancedScraping: false,
        error: {
          code: 'invalid_url',
          message: 'URL is required',
          suggestions: ['Please provide a valid product URL'],
        },
      });
      return;
    }
    
    // Import enhanced scraper
    const { scrapeProduct } = await import('../services/scraper-enhanced');
    const result = await scrapeProduct(url);
    
    if (!result.success) {
      reply.code(400).send(result);
      return;
    }
    
    return result;
  });

  // Advanced scraping with Puppeteer
  fastify.post("/api/wishlist/scrape-advanced", async (request, reply) => {
    const { url } = request.body as { url: string };
    
    if (!url || typeof url !== 'string') {
      reply.code(400).send({
        success: false,
        attempts: [],
        requiresAdvancedScraping: false,
        error: {
          code: 'invalid_url',
          message: 'URL is required',
          suggestions: ['Please provide a valid product URL'],
        },
      });
      return;
    }
    
    // Import enhanced scraper
    const { scrapeProductAdvanced } = await import('../services/scraper-enhanced');
    
    // Execute puppeteer scraping
    const result = await scrapeProductAdvanced(url);
    
    if (!result.success) {
      reply.code(400).send(result);
      return;
    }
    
    return result;
  });
}
