import { eq, like, desc, and, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { db } from "../db/client";
import { auditLogs, contacts, loans, reimbursementClaims } from "../db/schema";

const contactErrorSchema = z.object({ error: z.string() }).passthrough();
const contactIdParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const contactQuerySchema = z.object({ search: z.string().max(120).optional(), includeInactive: z.enum(["true", "false"]).optional() });
const contactTimestampSchema = z.union([z.date(), z.string(), z.number()]);
const contactKindSchema = z.enum(["person", "organization"]);
const contactSchema = z.object({ id: z.number().int(), name: z.string(), kind: contactKindSchema, fullName: z.string().nullable(), email: z.string().nullable(), phone: z.string().nullable(), relationshipType: z.string().nullable(), notes: z.string().nullable(), isActive: z.boolean(), createdAt: contactTimestampSchema, updatedAt: contactTimestampSchema }).passthrough();
const contactSummarySchema = z.object({ totalLent: z.number(), totalBorrowed: z.number(), netBalance: z.number(), activeLoansCount: z.number().int(), repaidLoansCount: z.number().int().optional(), totalLentAllTime: z.number().optional(), totalBorrowedAllTime: z.number().optional() }).passthrough();
const contactListItemSchema = contactSchema.extend({ totalLent: z.number(), totalBorrowed: z.number(), netBalance: z.number(), activeLoansCount: z.number().int() }).passthrough();
const contactBodySchema = z.object({ name: z.string().trim().min(1).max(200), kind: contactKindSchema.optional(), fullName: z.string().max(200).nullable().optional(), email: z.string().email().nullable().optional(), phone: z.string().max(80).nullable().optional(), relationshipType: z.string().max(100).nullable().optional(), notes: z.string().max(2000).nullable().optional() }).passthrough();
const contactUpdateBodySchema = contactBodySchema.partial().passthrough();

// Sanitize search input to prevent SQL injection
function sanitizeSearchInput(input: string): string {
  return input.replace(/[%_\[\]]/g, '');
}

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  // GET /api/contacts - List all contacts with loan summary
  fastify.get("/api/contacts", {
    schema: { operationId: "listContacts", tags: ["contacts"], querystring: contactQuerySchema, response: { 200: z.array(contactListItemSchema) } },
  }, async (request) => {
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
  fastify.get("/api/contacts/:id", {
    schema: { operationId: "getContact", tags: ["contacts"], params: contactIdParamsSchema, response: { 200: contactSchema.extend({ loans: z.array(z.unknown()), summary: contactSummarySchema }).passthrough(), 404: contactErrorSchema } },
  }, async (request, reply) => {
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
  fastify.post("/api/contacts", {
    schema: { operationId: "createContact", tags: ["contacts"], body: contactBodySchema, response: { 201: contactSchema, 400: contactErrorSchema } },
  }, async (request, reply) => {
    const body = request.body as {
      name: string;
      kind?: "person" | "organization";
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
        kind: body.kind ?? "person",
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
  fastify.patch("/api/contacts/:id", {
    schema: { operationId: "updateContact", tags: ["contacts"], params: contactIdParamsSchema, body: contactUpdateBodySchema, response: { 200: contactSchema, 404: contactErrorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<{
      name: string;
      kind: "person" | "organization";
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
        ...(body.kind !== undefined && { kind: body.kind }),
        ...(body.fullName !== undefined && { fullName: body.fullName }),
        ...(body.email !== undefined && { email: body.email }),
        ...(body.phone !== undefined && { phone: body.phone }),
        ...(body.relationshipType !== undefined && { relationshipType: body.relationshipType }),
        ...(body.notes !== undefined && { notes: body.notes }),
        updatedAt: sql`(unixepoch('now') * 1000)`,
      })
      .where(eq(contacts.id, parseInt(id)))
      .returning();

    // Keep the mutation response consistent with create/get so clients do not
    // need a special array-unwrapping path for a single contact update.
    return updated;
  });

  // DELETE /api/contacts/:id - Soft delete contact
  fastify.delete("/api/contacts/:id", {
    schema: { operationId: "archiveContact", tags: ["contacts"], params: contactIdParamsSchema, response: { 204: z.null(), 400: contactErrorSchema, 404: contactErrorSchema, 409: contactErrorSchema } },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const contactId = Number(id);
    if (!Number.isSafeInteger(contactId) || contactId <= 0) {
      return reply.code(400).send({ error: "Invalid contact ID" });
    }

    try {
      db.transaction((tx) => {
        const existing = tx.select().from(contacts).where(eq(contacts.id, contactId)).limit(1).all()[0];
        if (!existing) throw new Error("Contact not found");
        if (!existing.isActive) throw new Error("Contact is already archived");
        const activeLoans = tx.select({ id: loans.id }).from(loans)
          .where(and(eq(loans.contactId, contactId), eq(loans.isActive, true), eq(loans.status, "active")))
          .all();
        if (activeLoans.length > 0) {
          throw new Error(`Contact has ${activeLoans.length} active loan(s); settle, write off, or transfer them before archiving`);
        }
        const activeClaims = tx.select({ id: reimbursementClaims.id }).from(reimbursementClaims)
          .where(and(eq(reimbursementClaims.contactId, contactId), sql`${reimbursementClaims.status} IN ('draft', 'submitted', 'approved', 'partially_paid')`))
          .all();
        if (activeClaims.length > 0) {
          throw new Error(`Contact has ${activeClaims.length} active reimbursement claim(s); resolve them before archiving`);
        }
        const updated = tx.update(contacts)
          .set({ isActive: false, updatedAt: sql`(unixepoch('now') * 1000)` })
          .where(and(eq(contacts.id, contactId), eq(contacts.isActive, true)))
          .returning().all()[0];
        if (!updated) throw new Error("Contact was changed; retry archiving it");
        tx.insert(auditLogs).values({
          entityType: "contact",
          entityId: contactId,
          action: "archive",
          beforeSnapshot: Buffer.from(JSON.stringify(existing)),
          afterSnapshot: Buffer.from(JSON.stringify(updated)),
        }).run();
      });
      return reply.code(204).send();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to archive contact";
      return reply.code(message === "Contact not found" ? 404 : 409).send({ error: message });
    }
  });

  fastify.post("/api/contacts/:id/restore", {
    schema: { operationId: "restoreContact", tags: ["contacts"], params: contactIdParamsSchema, response: { 200: contactSchema, 400: contactErrorSchema, 404: contactErrorSchema, 409: contactErrorSchema } },
  }, async (request, reply) => {
    const contactId = Number((request.params as { id: string }).id);
    if (!Number.isSafeInteger(contactId) || contactId <= 0) {
      return reply.code(400).send({ error: "Invalid contact ID" });
    }
    try {
      const restored = db.transaction((tx) => {
        const existing = tx.select().from(contacts).where(eq(contacts.id, contactId)).limit(1).all()[0];
        if (!existing) throw new Error("Contact not found");
        if (existing.isActive) throw new Error("Contact is already active");
        const updated = tx.update(contacts)
          .set({ isActive: true, updatedAt: sql`(unixepoch('now') * 1000)` })
          .where(and(eq(contacts.id, contactId), eq(contacts.isActive, false)))
          .returning().all()[0];
        if (!updated) throw new Error("Contact was changed; retry restoring it");
        tx.insert(auditLogs).values({
          entityType: "contact",
          entityId: contactId,
          action: "restore",
          beforeSnapshot: Buffer.from(JSON.stringify(existing)),
          afterSnapshot: Buffer.from(JSON.stringify(updated)),
        }).run();
        return updated;
      });
      return reply.send(restored);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to restore contact";
      return reply.code(message === "Contact not found" ? 404 : 409).send({ error: message });
    }
  });
}
