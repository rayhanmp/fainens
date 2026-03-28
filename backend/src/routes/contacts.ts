import { eq, like, desc, and, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client";
import { contacts, loans } from "../db/schema";

// Sanitize search input to prevent SQL injection
function sanitizeSearchInput(input: string): string {
  return input.replace(/[%_\[\]]/g, '');
}

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  // GET /api/contacts - List all contacts with loan summary
  fastify.get("/api/contacts", async (request) => {
    const { search, includeInactive } = request.query as {
      search?: string;
      includeInactive?: string;
    };

    const conditions = [];
    
    // Filter by active status unless explicitly including inactive
    if (includeInactive !== 'true') {
      conditions.push(eq(contacts.isActive, true));
    }
    
    // Search by name
    if (search) {
      const sanitized = sanitizeSearchInput(search);
      if (sanitized) {
        conditions.push(like(contacts.name, `%${sanitized}%`));
      }
    }

    const allContacts = conditions.length > 0
      ? await db
          .select()
          .from(contacts)
          .where(and(...conditions))
          .orderBy(contacts.name)
      : await db
          .select()
          .from(contacts)
          .orderBy(contacts.name);

    // Get loan summary for each contact
    const contactsWithSummary = await Promise.all(
      allContacts.map(async (contact) => {
        const loanSummary = await db
          .select({
            totalLent: sql<number>`COALESCE(SUM(CASE WHEN ${loans.direction} = 'lent' AND ${loans.status} = 'active' THEN ${loans.remainingCents} ELSE 0 END), 0)`,
            totalBorrowed: sql<number>`COALESCE(SUM(CASE WHEN ${loans.direction} = 'borrowed' AND ${loans.status} = 'active' THEN ${loans.remainingCents} ELSE 0 END), 0)`,
            activeLoansCount: sql<number>`COUNT(CASE WHEN ${loans.status} = 'active' THEN 1 END)`,
          })
          .from(loans)
          .where(and(eq(loans.contactId, contact.id), eq(loans.isActive, true)));

        const summary = loanSummary[0];
        const netBalance = (summary?.totalLent || 0) - (summary?.totalBorrowed || 0);

        return {
          ...contact,
          totalLent: summary?.totalLent || 0,
          totalBorrowed: summary?.totalBorrowed || 0,
          netBalance,
          activeLoansCount: summary?.activeLoansCount || 0,
        };
      })
    );

    return contactsWithSummary;
  });

  // GET /api/contacts/:id - Get single contact with all loans
  fastify.get("/api/contacts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, parseInt(id)))
      .limit(1);

    if (!contact) {
      reply.code(404).send({ error: "Contact not found" });
      return;
    }

    // Get all loans for this contact
    const contactLoans = await db
      .select()
      .from(loans)
      .where(and(eq(loans.contactId, contact.id), eq(loans.isActive, true)))
      .orderBy(desc(loans.createdAt));

    // Get loan summary
    const loanSummary = await db
      .select({
        totalLent: sql<number>`COALESCE(SUM(CASE WHEN ${loans.direction} = 'lent' AND ${loans.status} = 'active' THEN ${loans.remainingCents} ELSE 0 END), 0)`,
        totalBorrowed: sql<number>`COALESCE(SUM(CASE WHEN ${loans.direction} = 'borrowed' AND ${loans.status} = 'active' THEN ${loans.remainingCents} ELSE 0 END), 0)`,
        activeLoansCount: sql<number>`COUNT(CASE WHEN ${loans.status} = 'active' THEN 1 END)`,
        repaidLoansCount: sql<number>`COUNT(CASE WHEN ${loans.status} = 'repaid' THEN 1 END)`,
        totalLentAllTime: sql<number>`COALESCE(SUM(CASE WHEN ${loans.direction} = 'lent' THEN ${loans.amountCents} ELSE 0 END), 0)`,
        totalBorrowedAllTime: sql<number>`COALESCE(SUM(CASE WHEN ${loans.direction} = 'borrowed' THEN ${loans.amountCents} ELSE 0 END), 0)`,
      })
      .from(loans)
      .where(and(eq(loans.contactId, contact.id), eq(loans.isActive, true)));

    const summary = loanSummary[0];

    return {
      ...contact,
      loans: contactLoans,
      summary: {
        totalLent: summary?.totalLent || 0,
        totalBorrowed: summary?.totalBorrowed || 0,
        netBalance: (summary?.totalLent || 0) - (summary?.totalBorrowed || 0),
        activeLoansCount: summary?.activeLoansCount || 0,
        repaidLoansCount: summary?.repaidLoansCount || 0,
        totalLentAllTime: summary?.totalLentAllTime || 0,
        totalBorrowedAllTime: summary?.totalBorrowedAllTime || 0,
      },
    };
  });

  // POST /api/contacts - Create new contact
  fastify.post("/api/contacts", async (request, reply) => {
    const body = request.body as {
      name: string;
      fullName?: string | null;
      email?: string | null;
      phone?: string | null;
      relationshipType?: string | null;
      notes?: string | null;
    };

    if (!body.name?.trim()) {
      reply.code(400).send({ error: "name is required" });
      return;
    }

    const [contact] = await db
      .insert(contacts)
      .values({
        name: body.name.trim(),
        fullName: body.fullName ?? null,
        email: body.email ?? null,
        phone: body.phone ?? null,
        relationshipType: body.relationshipType ?? null,
        notes: body.notes ?? null,
      })
      .returning();

    reply.code(201).send(contact);
  });

  // PATCH /api/contacts/:id - Update contact
  fastify.patch("/api/contacts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<{
      name: string;
      fullName: string | null;
      email: string | null;
      phone: string | null;
      relationshipType: string | null;
      notes: string | null;
    }>;

    const [existing] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, parseInt(id)))
      .limit(1);

    if (!existing) {
      reply.code(404).send({ error: "Contact not found" });
      return;
    }

    const [updated] = await db
      .update(contacts)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.fullName !== undefined && { fullName: body.fullName }),
        ...(body.email !== undefined && { email: body.email }),
        ...(body.phone !== undefined && { phone: body.phone }),
        ...(body.relationshipType !== undefined && { relationshipType: body.relationshipType }),
        ...(body.notes !== undefined && { notes: body.notes }),
        updatedAt: sql`(unixepoch('now') * 1000)`,
      })
      .where(eq(contacts.id, parseInt(id)))
      .returning();

    return updated;
  });

  // DELETE /api/contacts/:id - Soft delete contact
  fastify.delete("/api/contacts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const [existing] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, parseInt(id)))
      .limit(1);

    if (!existing) {
      reply.code(404).send({ error: "Contact not found" });
      return;
    }

    // Soft delete - mark as inactive
    await db
      .update(contacts)
      .set({ 
        isActive: false,
        updatedAt: sql`(unixepoch('now') * 1000)`,
      })
      .where(eq(contacts.id, parseInt(id)));

    reply.code(204).send();
  });
}
