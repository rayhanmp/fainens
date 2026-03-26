import { eq, desc, and, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client";
import { contacts, loans, loanPayments, accounts, transactions, transactionLines } from "../db/schema";
import { createJournalEntry } from "../services/ledger";

// System account keys for loans
const SYSTEM_KEYS = {
  loansReceivable: "loans-receivable",
  loansPayable: "loans-payable",
  badDebtExpense: "bad-debt-expense",
};

// Cache for system accounts
let systemAccountsCache: Record<string, { id: number }> = {};

async function getOrCreateSystemAccount(
  dbLike: any,
  key: string,
  name: string,
  type: string
): Promise<{ id: number }> {
  if (systemAccountsCache[key]) return systemAccountsCache[key];

  const [existing] = await dbLike
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.systemKey, key))
    .limit(1);

  if (existing) {
    systemAccountsCache[key] = existing;
    return existing;
  }

  const [created] = await dbLike
    .insert(accounts)
    .values({
      name,
      type,
      isActive: true,
      systemKey: key,
    })
    .returning({ id: accounts.id });

  systemAccountsCache[key] = created;
  return created;
}

async function getLoansReceivableAccount(dbLike: any = db) {
  return getOrCreateSystemAccount(dbLike, SYSTEM_KEYS.loansReceivable, "Loans Receivable", "asset");
}

async function getLoansPayableAccount(dbLike: any = db) {
  return getOrCreateSystemAccount(dbLike, SYSTEM_KEYS.loansPayable, "Loans Payable", "liability");
}

async function getBadDebtExpenseAccount(dbLike: any = db) {
  return getOrCreateSystemAccount(dbLike, SYSTEM_KEYS.badDebtExpense, "Bad Debt Expense", "expense");
}

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  // GET /api/loans - List all loans with contact info
  fastify.get("/api/loans", async (request) => {
    const { direction, status, contactId, includeHistory } = request.query as {
      direction?: 'lent' | 'borrowed';
      status?: 'active' | 'repaid' | 'defaulted' | 'written_off';
      contactId?: string;
      includeHistory?: string;
    };

    const conditions = [eq(loans.isActive, true)];

    if (direction) {
      conditions.push(eq(loans.direction, direction));
    }

    if (status) {
      conditions.push(eq(loans.status, status));
    } else if (includeHistory !== 'true') {
      // Default to showing only active loans
      conditions.push(eq(loans.status, 'active'));
    }

    if (contactId) {
      conditions.push(eq(loans.contactId, parseInt(contactId)));
    }

    const allLoans = await db
      .select({
        loan: loans,
        contact: contacts,
      })
      .from(loans)
      .innerJoin(contacts, eq(loans.contactId, contacts.id))
      .where(and(...conditions))
      .orderBy(desc(loans.createdAt));

    // Check for overdue loans
    const now = Date.now();
    const loansWithOverdue = allLoans.map(({ loan, contact }) => {
      const dueDateMs = loan.dueDate ? loan.dueDate.getTime() : null;
      const isOverdue = loan.status === 'active' && 
                        dueDateMs && 
                        dueDateMs < now;
      
      return {
        ...loan,
        contact: {
          id: contact.id,
          name: contact.name,
        },
        isOverdue,
        daysOverdue: isOverdue && dueDateMs 
          ? Math.floor((now - dueDateMs) / (1000 * 60 * 60 * 24))
          : 0,
      };
    });

    return loansWithOverdue;
  });

  // GET /api/loans/summary - Get loan summary statistics
  fastify.get("/api/loans/summary", async () => {
    const summary = await db
      .select({
        totalLent: sql<number>`COALESCE(SUM(CASE WHEN ${loans.direction} = 'lent' AND ${loans.status} = 'active' THEN ${loans.remainingCents} ELSE 0 END), 0)`,
        totalBorrowed: sql<number>`COALESCE(SUM(CASE WHEN ${loans.direction} = 'borrowed' AND ${loans.status} = 'active' THEN ${loans.remainingCents} ELSE 0 END), 0)`,
        totalRepaid: sql<number>`COALESCE(SUM(CASE WHEN ${loans.direction} = 'lent' AND ${loans.status} = 'repaid' THEN ${loans.amountCents} ELSE 0 END), 0)`,
        activeLoansCount: sql<number>`COUNT(CASE WHEN ${loans.status} = 'active' THEN 1 END)`,
        repaidLoansCount: sql<number>`COUNT(CASE WHEN ${loans.status} = 'repaid' THEN 1 END)`,
        defaultedLoansCount: sql<number>`COUNT(CASE WHEN ${loans.status} IN ('defaulted', 'written_off') THEN 1 END)`,
      })
      .from(loans)
      .where(eq(loans.isActive, true));

    const data = summary[0];
    const netPosition = (data?.totalLent || 0) - (data?.totalBorrowed || 0);

    return {
      totalLent: data?.totalLent || 0,
      totalBorrowed: data?.totalBorrowed || 0,
      netPosition,
      totalRepaid: data?.totalRepaid || 0,
      activeLoansCount: data?.activeLoansCount || 0,
      repaidLoansCount: data?.repaidLoansCount || 0,
      defaultedLoansCount: data?.defaultedLoansCount || 0,
    };
  });

  // GET /api/loans/:id - Get single loan with payment history
  fastify.get("/api/loans/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const [loanResult] = await db
      .select({
        loan: loans,
        contact: contacts,
      })
      .from(loans)
      .innerJoin(contacts, eq(loans.contactId, contacts.id))
      .where(and(eq(loans.id, parseInt(id)), eq(loans.isActive, true)))
      .limit(1);

    if (!loanResult) {
      reply.code(404).send({ error: "Loan not found" });
      return;
    }

    const { loan, contact } = loanResult;

    // Get payment history
    const payments = await db
      .select()
      .from(loanPayments)
      .where(eq(loanPayments.loanId, loan.id))
      .orderBy(desc(loanPayments.paymentDate));

    // Calculate if overdue
    const now = Date.now();
    const dueDateMs = loan.dueDate ? loan.dueDate.getTime() : null;
    const isOverdue = loan.status === 'active' && 
                      dueDateMs && 
                      dueDateMs < now;

    return {
      ...loan,
      contact: {
        id: contact.id,
        name: contact.name,
      },
      payments,
      isOverdue,
      daysOverdue: isOverdue && dueDateMs 
        ? Math.floor((now - dueDateMs) / (1000 * 60 * 60 * 24))
        : 0,
    };
  });

  // POST /api/loans - Create new loan
  fastify.post("/api/loans", async (request, reply) => {
    try {
      const body = request.body as {
        contactId: number;
        direction: 'lent' | 'borrowed';
        amountCents: number;
        description?: string;
        dueDate?: number | null;
        walletAccountId: number;
      };

      // Validate required fields
      if (!body.contactId) {
        reply.code(400).send({ error: "contactId is required" });
        return;
      }

      if (!body.direction || !['lent', 'borrowed'].includes(body.direction)) {
        reply.code(400).send({ error: "direction must be 'lent' or 'borrowed'" });
        return;
      }

      if (!body.amountCents || body.amountCents <= 0) {
        reply.code(400).send({ error: "amountCents must be a positive number" });
        return;
      }

      if (!body.walletAccountId) {
        reply.code(400).send({ error: "walletAccountId is required" });
        return;
      }

      // Verify contact exists
      const [contact] = await db
        .select()
        .from(contacts)
        .where(eq(contacts.id, body.contactId))
        .limit(1);

      if (!contact) {
        reply.code(404).send({ error: "Contact not found" });
        return;
      }

      // Get system accounts
      const [loansReceivable, loansPayable] = await Promise.all([
        getLoansReceivableAccount(db),
        getLoansPayableAccount(db),
      ]);

      // Create the journal entry for the loan
      const loanAccountId = body.direction === 'lent' ? loansReceivable.id : loansPayable.id;
      
      const journalEntry = await createJournalEntry({
        date: Date.now(),
        description: body.description || `${body.direction === 'lent' ? 'Loan to' : 'Loan from'} ${contact.name}`,
        txType: 'loan_creation',
        lines: body.direction === 'lent'
          ? [
              { accountId: loanAccountId, debit: body.amountCents, credit: 0 },
              { accountId: body.walletAccountId, debit: 0, credit: body.amountCents },
            ]
          : [
              { accountId: body.walletAccountId, debit: body.amountCents, credit: 0 },
              { accountId: loanAccountId, debit: 0, credit: body.amountCents },
            ],
      }, db);

      // Create the loan record
      const [loan] = await db
        .insert(loans)
        .values({
          contactId: body.contactId,
          direction: body.direction,
          amountCents: body.amountCents,
          remainingCents: body.amountCents,
          startDate: new Date(),
          dueDate: body.dueDate ? new Date(body.dueDate) : null,
          status: 'active',
          description: body.description ?? null,
          walletAccountId: body.walletAccountId,
          lendingTransactionId: journalEntry.transactionId,
        })
        .returning();

      reply.code(201).send(loan);
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message });
    }
  });

  // POST /api/loans/:id/payments - Record a payment on a loan
  fastify.post("/api/loans/:id/payments", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as {
        amountCents: number;
        paymentDate?: number;
        notes?: string;
        walletAccountId: number;
      };

      if (!body.amountCents || body.amountCents <= 0) {
        reply.code(400).send({ error: "amountCents must be a positive number" });
        return;
      }

      if (!body.walletAccountId) {
        reply.code(400).send({ error: "walletAccountId is required" });
        return;
      }

      // Get the loan and process payment in a transaction
      const result = await db.transaction(async (tx) => {
        const [loan] = await tx
          .select()
          .from(loans)
          .where(and(eq(loans.id, parseInt(id)), eq(loans.isActive, true)))
          .limit(1);

        if (!loan) {
          reply.code(404).send({ error: "Loan not found" });
          return null;
        }

        if (loan.status !== 'active') {
          reply.code(400).send({ error: "Cannot record payment on a non-active loan" });
          return null;
        }

        if (body.amountCents > loan.remainingCents) {
          reply.code(400).send({ error: "Payment amount cannot exceed remaining balance" });
          return null;
        }

        // Get contact and system accounts
        const [contact, loansReceivable, loansPayable] = await Promise.all([
          tx.select().from(contacts).where(eq(contacts.id, loan.contactId)).limit(1),
          getLoansReceivableAccount(tx),
          getLoansPayableAccount(tx),
        ]);

        const loanAccountId = loan.direction === 'lent' ? loansReceivable.id : loansPayable.id;

        // Create the journal entry for the payment
        const journalEntry = await createJournalEntry({
          date: body.paymentDate || Date.now(),
          description: `Payment on loan - ${contact[0]?.name}`,
          txType: 'loan_payment',
          lines: loan.direction === 'lent'
            ? [
                { accountId: body.walletAccountId, debit: body.amountCents, credit: 0 },
                { accountId: loanAccountId, debit: 0, credit: body.amountCents },
              ]
            : [
                { accountId: loanAccountId, debit: body.amountCents, credit: 0 },
                { accountId: body.walletAccountId, debit: 0, credit: body.amountCents },
              ],
        }, tx);

        // Create the payment record
        const [payment] = await tx
          .insert(loanPayments)
          .values({
            loanId: loan.id,
            amountCents: body.amountCents,
            principalCents: body.amountCents,
            paymentDate: body.paymentDate ? new Date(body.paymentDate) : new Date(),
            transactionId: journalEntry.transactionId,
            notes: body.notes ?? null,
          })
          .returning();

        // Update loan remaining balance
        const newRemaining = loan.remainingCents - body.amountCents;
        const newStatus = newRemaining === 0 ? 'repaid' : 'active';

        await tx
          .update(loans)
          .set({
            remainingCents: newRemaining,
            status: newStatus,
            updatedAt: sql`(unixepoch('now') * 1000)`,
          })
          .where(eq(loans.id, loan.id));

        return { payment, loan, newRemaining, newStatus };
      });

      if (!result) return;

      const { payment, loan, newRemaining, newStatus } = result;

      reply.code(201).send({
        payment,
        loan: {
          ...loan,
          remainingCents: newRemaining,
          status: newStatus,
        },
      });
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message });
    }
  });

  // PATCH /api/loans/:id - Update loan status (mark as defaulted, written off, etc.)
  fastify.patch("/api/loans/:id", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as {
        status?: 'active' | 'repaid' | 'defaulted' | 'written_off';
        description?: string;
      };

      const [loan] = await db
        .select()
        .from(loans)
        .where(and(eq(loans.id, parseInt(id)), eq(loans.isActive, true)))
        .limit(1);

      if (!loan) {
        reply.code(404).send({ error: "Loan not found" });
        return;
      }

      // Handle write-off (bad debt)
      if (body.status === 'written_off' && loan.status === 'active' && loan.remainingCents > 0) {
        const [contact, loansReceivable, badDebtExpense] = await Promise.all([
          db.select().from(contacts).where(eq(contacts.id, loan.contactId)).limit(1),
          getLoansReceivableAccount(db),
          getBadDebtExpenseAccount(db),
        ]);

        // Only write off loans you've lent (assets)
        if (loan.direction === 'lent') {
          await createJournalEntry({
            date: Date.now(),
            description: `Write off bad debt - ${contact[0]?.name}`,
            txType: 'loan_writeoff',
            lines: [
              { accountId: badDebtExpense.id, debit: loan.remainingCents, credit: 0 },
              { accountId: loansReceivable.id, debit: 0, credit: loan.remainingCents },
            ],
          }, db);
        }

        // Update loan to written off status and zero out remaining
        await db
          .update(loans)
          .set({
            status: 'written_off',
            remainingCents: 0,
            updatedAt: sql`(unixepoch('now') * 1000)`,
            ...(body.description !== undefined && { description: body.description }),
          })
          .where(eq(loans.id, loan.id));
      } else {
        // Simple status update
        await db
          .update(loans)
          .set({
            ...(body.status && { status: body.status }),
            ...(body.description !== undefined && { description: body.description }),
            updatedAt: sql`(unixepoch('now') * 1000)`,
          })
          .where(eq(loans.id, loan.id));
      }

      const [updated] = await db
        .select()
        .from(loans)
        .where(eq(loans.id, parseInt(id)))
        .limit(1);

      return updated;
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message });
    }
  });

  // DELETE /api/loans/:id - Soft delete loan and its transaction
  fastify.delete("/api/loans/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const loanId = parseInt(id);

    try {
      await db.transaction(async (tx) => {
        const [loan] = await tx
          .select()
          .from(loans)
          .where(eq(loans.id, loanId))
          .limit(1);

        if (!loan) {
          reply.code(404).send({ error: "Loan not found" });
          return;
        }

        // Only allow deletion of loans with no payments
        const [paymentCount] = await tx
          .select({ count: sql<number>`COUNT(*)` })
          .from(loanPayments)
          .where(eq(loanPayments.loanId, loanId));

        if (paymentCount.count > 0) {
          throw new Error("Cannot delete loan with recorded payments. Mark it as written off instead.");
        }

        // Delete the related transaction if it exists
        if (loan.lendingTransactionId) {
          await tx.delete(transactionLines).where(eq(transactionLines.transactionId, loan.lendingTransactionId));
          await tx.delete(transactions).where(eq(transactions.id, loan.lendingTransactionId));
        }

        // Soft delete the loan
        await tx
          .update(loans)
          .set({ 
            isActive: false,
            updatedAt: sql`(unixepoch('now') * 1000)`,
          })
          .where(eq(loans.id, loanId));
      });

      reply.code(204).send();
    } catch (err) {
      fastify.log.error(err);
      const errorMessage = (err as Error).message;
      if (errorMessage.includes("Cannot delete loan with recorded payments")) {
        reply.code(400).send({ error: errorMessage });
      } else {
        reply.code(500).send({ error: "Failed to delete loan" });
      }
    }
  });
}
