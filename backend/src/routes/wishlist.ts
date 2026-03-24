import { eq, and, desc, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client";
import { wishlist, transactions, transactionLines, categories, salaryPeriods } from "../db/schema";
import { auditCreate, auditUpdate, auditDelete } from "../services/audit";

// SSRF Protection: Allowed domains for web scraping
const ALLOWED_SCRAPE_DOMAINS = [
  "tokopedia.com",
  "shopee.co.id",
  "blibli.com",
  "lazada.co.id",
  "bukalapak.com",
  "amazon.com",
  "ebay.com",
  "aliexpress.com",
  "shopify.com",
  "woocommerce.com",
  "example.com", // For testing
];

// SSRF Protection: Blocked IP ranges (private networks)
const BLOCKED_IP_PATTERNS = [
  /^127\./, // Loopback
  /^10\./, // Private Class A
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Private Class B
  /^192\.168\./, // Private Class C
  /^169\.254\./, // Link-local
  /^0\./, // Current network
  /^::1$/, // IPv6 loopback
  /^fc00:/i, // IPv6 unique local
  /^fe80:/i, // IPv6 link-local
];

/**
 * Validates URL to prevent SSRF attacks
 * - Must be HTTP or HTTPS protocol
 * - Must not be an IP address (prevents internal network scanning)
 * - Must not be localhost or private ranges
 * - Domain must be in allowlist (optional, can be disabled)
 */
function validateScrapeUrl(url: string): { valid: boolean; error?: string } {
  try {
    const parsed = new URL(url);

    // Check protocol
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { valid: false, error: "URL must use HTTP or HTTPS protocol" };
    }

    // Check for IP addresses
    const hostname = parsed.hostname;
    const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Pattern = /^(\[)?[0-9a-fA-F:]+(\])?$/;

    if (ipv4Pattern.test(hostname) || ipv6Pattern.test(hostname)) {
      return { valid: false, error: "IP addresses are not allowed. Please use a domain name" };
    }

    // Check for localhost
    if (hostname === "localhost" || hostname.endsWith(".localhost")) {
      return { valid: false, error: "Localhost URLs are not allowed" };
    }

    // Check blocked IP patterns (in case of DNS rebinding)
    for (const pattern of BLOCKED_IP_PATTERNS) {
      if (pattern.test(hostname)) {
        return { valid: false, error: "Private network URLs are not allowed" };
      }
    }

    // Check domain allowlist
    const domainAllowed = ALLOWED_SCRAPE_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));

    if (!domainAllowed) {
      return {
        valid: false,
        error: `Domain not allowed for scraping. Allowed domains: ${ALLOWED_SCRAPE_DOMAINS.join(", ")}`,
      };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }
}

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

    // SSRF Protection: Validate URL
    const validation = validateScrapeUrl(url);
    if (!validation.valid) {
      reply.code(400).send({
        success: false,
        attempts: [],
        requiresAdvancedScraping: false,
        error: {
          code: 'forbidden_url',
          message: validation.error,
          suggestions: ['Please provide a URL from an allowed e-commerce site'],
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

    // SSRF Protection: Validate URL
    const validation = validateScrapeUrl(url);
    if (!validation.valid) {
      reply.code(400).send({
        success: false,
        attempts: [],
        requiresAdvancedScraping: false,
        error: {
          code: 'forbidden_url',
          message: validation.error,
          suggestions: ['Please provide a URL from an allowed e-commerce site'],
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
