import { eq, desc, and, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client";
import { contacts, loans, loanPayments, accounts, auditLogs } from "../db/schema";
import {
  insertPreparedJournalEntrySync,
  prepareJournalEntry,
} from "../services/ledger";
import { invalidateOnTransactionMutation } from "../cache/invalidation";
import { bumpFinancialRevisionSync } from "../services/financial-revision";
import { insertDomainReversalSync, prepareDomainReversal } from "../services/domain-reversal";

// System account keys for loans
const SYSTEM_KEYS = {
  loansReceivable: "loans-receivable",
  loansPayable: "loans-payable",
  badDebtExpense: "bad-debt-expense",
  forgivenessIncome: "loan-forgiveness-income",
};

async function getOrCreateSystemAccount(
  dbLike: any,
  key: string,
  name: string,
  type: string
): Promise<{ id: number }> {
  const [existing] = await dbLike
    .select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive, liquidityClass: accounts.liquidityClass })
    .from(accounts)
    .where(eq(accounts.systemKey, key))
    .limit(1);

  if (existing) {
    if (!existing.isActive || existing.type !== type) {
      throw new Error(`System account ${key} must be an active ${type} account`);
    }
    return { id: existing.id };
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

async function getForgivenessIncomeAccount(dbLike: any = db) {
  return getOrCreateSystemAccount(dbLike, SYSTEM_KEYS.forgivenessIncome, "Loan Forgiveness Income", "revenue");
}

function assertPositiveSafeInteger(value: unknown, fieldName: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
}

async function getActiveWalletAccount(accountId: number) {
  const [account] = await db
    .select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive, liquidityClass: accounts.liquidityClass })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!account) throw new Error("Wallet account not found");
  if (!account.isActive || account.type !== "asset") throw new Error("Wallet must be an active asset account");
  return account;
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
      if (!Number.isSafeInteger(body.contactId) || body.contactId <= 0) {
        reply.code(400).send({ error: "contactId is required" });
        return;
      }

      if (!body.direction || !['lent', 'borrowed'].includes(body.direction)) {
        reply.code(400).send({ error: "direction must be 'lent' or 'borrowed'" });
        return;
      }

      if (!Number.isSafeInteger(body.amountCents) || body.amountCents <= 0) {
        reply.code(400).send({ error: "amountCents must be a positive integer" });
        return;
      }

      if (!Number.isSafeInteger(body.walletAccountId) || body.walletAccountId <= 0) {
        reply.code(400).send({ error: "walletAccountId is required" });
        return;
      }

      if (body.dueDate != null && (!Number.isFinite(body.dueDate) || body.dueDate <= 0)) {
        reply.code(400).send({ error: "dueDate must be a valid timestamp" });
        return;
      }

      // Verify contact exists
      const [contact] = await db
        .select()
        .from(contacts)
        .where(eq(contacts.id, body.contactId))
        .limit(1);

      if (!contact || !contact.isActive) {
        reply.code(404).send({ error: "Contact not found" });
        return;
      }

      const wallet = await getActiveWalletAccount(body.walletAccountId);

      // Get system accounts
      const [loansReceivable, loansPayable] = await Promise.all([
        getLoansReceivableAccount(db),
        getLoansPayableAccount(db),
      ]);

      const loanAccountId = body.direction === 'lent' ? loansReceivable.id : loansPayable.id;
      const journalInput = {
        date: Date.now(),
        description: body.description || `${body.direction === 'lent' ? 'Loan to' : 'Loan from'} ${contact.name}`,
        txType: 'loan_creation',
        lines: body.direction === 'lent'
          ? [
              { accountId: loanAccountId, debit: body.amountCents, credit: 0 },
              { accountId: body.walletAccountId, debit: 0, credit: body.amountCents, cashFlowClass: wallet.liquidityClass === "cash_equivalent" ? "investing" as const : undefined },
            ]
          : [
              { accountId: body.walletAccountId, debit: body.amountCents, credit: 0, cashFlowClass: wallet.liquidityClass === "cash_equivalent" ? "financing" as const : undefined },
              { accountId: loanAccountId, debit: 0, credit: body.amountCents },
            ],
      };
      const prepared = await prepareJournalEntry(journalInput, db);

      // The journal and subledger row share one synchronous commit. A failed
      // loan insert can therefore never leave an orphaned cash movement.
      const result = db.transaction((tx) => {
        const transactionId = insertPreparedJournalEntrySync(tx, prepared);
        const insertedLoans = tx.insert(loans).values({
          contactId: body.contactId,
          direction: body.direction,
          amountCents: body.amountCents,
          remainingCents: body.amountCents,
          startDate: new Date(),
          dueDate: body.dueDate ? new Date(body.dueDate) : null,
          status: 'active',
          description: body.description ?? null,
          walletAccountId: body.walletAccountId,
          lendingTransactionId: transactionId,
        }).returning().all();
        const loan = insertedLoans[0];
        if (!loan) throw new Error("Failed to create loan row");
        tx.insert(auditLogs).values({
          entityType: "loan",
          entityId: loan.id,
          action: "create",
          afterSnapshot: Buffer.from(JSON.stringify({ loan, transactionId })),
        }).run();
        return { loan, transactionId };
      });

      await invalidateOnTransactionMutation({
        transactionId: result.transactionId,
        affectedAccountIds: prepared.accountIds,
        revisionBumped: true,
      });

      reply.code(201).send(result.loan);
    } catch (err) {
      reply.code(400).send({ error: "Failed to create loan" });
    }
  });

  // POST /api/loans/:id/payments - Record a payment on a loan
  fastify.post("/api/loans/:id/payments", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const loanId = Number(id);
      const body = request.body as {
        amountCents: number;
        paymentDate?: number;
        notes?: string;
        walletAccountId: number;
      };

      if (!Number.isSafeInteger(loanId) || loanId <= 0) {
        reply.code(400).send({ error: "Invalid loan id" });
        return;
      }

      if (!Number.isSafeInteger(body.amountCents) || body.amountCents <= 0) {
        reply.code(400).send({ error: "amountCents must be a positive integer" });
        return;
      }

      if (!Number.isSafeInteger(body.walletAccountId) || body.walletAccountId <= 0) {
        reply.code(400).send({ error: "walletAccountId is required" });
        return;
      }

      if (body.paymentDate != null && (!Number.isFinite(body.paymentDate) || body.paymentDate <= 0)) {
        reply.code(400).send({ error: "paymentDate must be a valid timestamp" });
        return;
      }

      const wallet = await getActiveWalletAccount(body.walletAccountId);

      const [loanSnapshot] = await db
        .select()
        .from(loans)
        .where(and(eq(loans.id, loanId), eq(loans.isActive, true)))
        .limit(1);
      if (!loanSnapshot) {
        reply.code(404).send({ error: "Loan not found" });
        return;
      }
      if (loanSnapshot.status !== "active") {
        reply.code(400).send({ error: "Cannot record payment on a non-active loan" });
        return;
      }
      if (body.amountCents > loanSnapshot.remainingCents) {
        reply.code(400).send({ error: "Payment amount cannot exceed remaining balance" });
        return;
      }

      const [contact] = await db
        .select({ name: contacts.name })
        .from(contacts)
        .where(eq(contacts.id, loanSnapshot.contactId))
        .limit(1);
      const [loansReceivable, loansPayable] = await Promise.all([
        getLoansReceivableAccount(db),
        getLoansPayableAccount(db),
      ]);
      const loanAccountId = loanSnapshot.direction === "lent" ? loansReceivable.id : loansPayable.id;
      const journalInput = {
        date: body.paymentDate || Date.now(),
        description: `Payment on loan - ${contact?.name ?? "contact"}`,
        txType: "loan_payment",
        lines: loanSnapshot.direction === "lent"
          ? [
              { accountId: body.walletAccountId, debit: body.amountCents, credit: 0, cashFlowClass: wallet.liquidityClass === "cash_equivalent" ? "investing" as const : undefined },
              { accountId: loanAccountId, debit: 0, credit: body.amountCents },
            ]
          : [
              { accountId: loanAccountId, debit: body.amountCents, credit: 0 },
              { accountId: body.walletAccountId, debit: 0, credit: body.amountCents, cashFlowClass: wallet.liquidityClass === "cash_equivalent" ? "financing" as const : undefined },
            ],
      };
      const prepared = await prepareJournalEntry(journalInput, db);

      const result = db.transaction((tx) => {
        // Re-read under the write transaction. This prevents two concurrent
        // repayments from both spending the same remaining balance.
        const current = tx.select().from(loans)
          .where(and(eq(loans.id, loanId), eq(loans.isActive, true)))
          .limit(1).all()[0];
        if (!current) throw new Error("Loan not found");
        if (current.status !== "active") throw new Error("Cannot record payment on a non-active loan");
        if (body.amountCents > current.remainingCents) {
          throw new Error("Payment amount cannot exceed remaining balance");
        }

        const transactionId = insertPreparedJournalEntrySync(tx, prepared);
        const insertedPayments = tx.insert(loanPayments).values({
          loanId: current.id,
          amountCents: body.amountCents,
          principalCents: body.amountCents,
          paymentDate: body.paymentDate ? new Date(body.paymentDate) : new Date(),
          transactionId,
          notes: body.notes ?? null,
        }).returning().all();
        const payment = insertedPayments[0];
        if (!payment) throw new Error("Failed to create payment row");

        const newRemaining = current.remainingCents - body.amountCents;
        const newStatus = newRemaining === 0 ? "repaid" : "active";
        const updateResult = tx.update(loans).set({
          remainingCents: newRemaining,
          status: newStatus,
          updatedAt: sql`(unixepoch('now') * 1000)`,
        }).where(and(eq(loans.id, current.id), eq(loans.status, "active"), sql`${loans.remainingCents} >= ${body.amountCents}`)).run();
        if (updateResult.changes !== 1) throw new Error("Loan balance changed; retry payment");
        tx.insert(auditLogs).values({
          entityType: "loan_payment",
          entityId: payment.id,
          action: "create",
          afterSnapshot: Buffer.from(JSON.stringify({ payment, loanId: current.id, transactionId })),
        }).run();
        tx.insert(auditLogs).values({
          entityType: "loan",
          entityId: current.id,
          action: "update",
          beforeSnapshot: Buffer.from(JSON.stringify(current)),
          afterSnapshot: Buffer.from(JSON.stringify({ ...current, remainingCents: newRemaining, status: newStatus })),
        }).run();
        return { payment, loan: current, newRemaining, newStatus, transactionId };
      });

      await invalidateOnTransactionMutation({
        transactionId: result.transactionId,
        affectedAccountIds: prepared.accountIds,
        revisionBumped: true,
      });

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
      reply.code(400).send({ error: "Failed to record payment" });
    }
  });

  /** Reverse a payment and restore the loan subledger in the same commit. */
  fastify.post("/api/loans/payments/:paymentId/reverse", async (request, reply) => {
    const paymentId = Number((request.params as { paymentId?: string }).paymentId);
    const reason = String((request.body as { reason?: unknown } | undefined)?.reason ?? "").trim();
    if (!Number.isSafeInteger(paymentId) || paymentId <= 0) return reply.code(400).send({ error: "Invalid payment id" });
    if (!reason || reason.length > 500) return reply.code(400).send({ error: "reason is required and must be at most 500 characters" });
    try {
      const [payment] = await db.select().from(loanPayments).where(eq(loanPayments.id, paymentId)).limit(1);
      if (!payment?.transactionId || payment.status !== "posted") {
        return reply.code(409).send({ error: "A posted loan payment is required for reversal" });
      }
      const reversal = await prepareDomainReversal(payment.transactionId, reason, db);
      const result = db.transaction((tx) => {
        const currentPayment = tx.select().from(loanPayments).where(eq(loanPayments.id, paymentId)).limit(1).all()[0];
        if (!currentPayment || currentPayment.status !== "posted" || currentPayment.transactionId !== payment.transactionId) {
          throw new Error("Loan payment changed; retry reversal");
        }
        const currentLoan = tx.select().from(loans).where(eq(loans.id, currentPayment.loanId)).limit(1).all()[0];
        if (!currentLoan || !currentLoan.isActive || ["defaulted", "written_off"].includes(currentLoan.status)) {
          throw new Error("Only an active, non-written-off loan payment can be reversed");
        }
        const restoredRemaining = currentLoan.remainingCents + currentPayment.principalCents;
        if (!Number.isSafeInteger(restoredRemaining) || restoredRemaining > currentLoan.amountCents) {
          throw new Error("Loan balance is inconsistent; cannot safely reverse this payment");
        }
        const reversalTransactionId = insertDomainReversalSync(tx, payment.transactionId!, reversal.prepared, reason);
        const paymentChanged = tx.update(loanPayments).set({
          status: "reversed",
          reversalTransactionId,
          reversedAt: new Date(),
          reversalReason: reason,
        }).where(and(eq(loanPayments.id, paymentId), eq(loanPayments.status, "posted"))).run();
        if (paymentChanged.changes !== 1) throw new Error("Loan payment changed; retry reversal");
        const loanChanged = tx.update(loans).set({
          remainingCents: restoredRemaining,
          status: "active",
          updatedAt: new Date(),
        }).where(eq(loans.id, currentLoan.id)).run();
        if (loanChanged.changes !== 1) throw new Error("Loan changed; retry reversal");
        tx.insert(auditLogs).values({
          entityType: "loan_payment",
          entityId: paymentId,
          action: "reverse",
          beforeSnapshot: Buffer.from(JSON.stringify(currentPayment)),
          afterSnapshot: Buffer.from(JSON.stringify({ ...currentPayment, status: "reversed", reversalTransactionId, reason })),
        }).run();
        tx.insert(auditLogs).values({
          entityType: "loan",
          entityId: currentLoan.id,
          action: "update",
          beforeSnapshot: Buffer.from(JSON.stringify(currentLoan)),
          afterSnapshot: Buffer.from(JSON.stringify({ ...currentLoan, remainingCents: restoredRemaining, status: "active" })),
        }).run();
        return { reversalTransactionId, loanId: currentLoan.id, remainingCents: restoredRemaining };
      });
      await invalidateOnTransactionMutation({
        transactionId: result.reversalTransactionId,
        affectedAccountIds: reversal.prepared.accountIds,
        affectedPeriodIds: reversal.periodId == null ? undefined : [reversal.periodId],
        revisionBumped: true,
      });
      return reply.code(201).send(result);
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "Failed to reverse loan payment" });
    }
  });

  /** Reverse the original lending/borrowing event before any repayment exists. */
  fastify.post("/api/loans/:id/reverse-origin", async (request, reply) => {
    const loanId = Number((request.params as { id?: string }).id);
    const reason = String((request.body as { reason?: unknown } | undefined)?.reason ?? "").trim();
    if (!Number.isSafeInteger(loanId) || loanId <= 0) return reply.code(400).send({ error: "Invalid loan id" });
    if (!reason || reason.length > 500) return reply.code(400).send({ error: "reason is required and must be at most 500 characters" });
    try {
      const [loan] = await db.select().from(loans).where(eq(loans.id, loanId)).limit(1);
      if (!loan?.lendingTransactionId || !loan.isActive || loan.status !== "active" || loan.remainingCents !== loan.amountCents) {
        return reply.code(409).send({ error: "Only an untouched active loan can have its original event reversed" });
      }
      if (loan.sourceType === "split_bill") {
        return reply.code(409).send({ error: "Split-bill loans must be reversed through the split-bill workflow" });
      }
      const [payment] = await db.select({ id: loanPayments.id }).from(loanPayments).where(and(
        eq(loanPayments.loanId, loanId),
        eq(loanPayments.status, "posted"),
      )).limit(1);
      if (payment) return reply.code(409).send({ error: "Reverse posted loan payments before reversing the original loan" });
      const reversal = await prepareDomainReversal(loan.lendingTransactionId, reason, db);
      const result = db.transaction((tx) => {
        const current = tx.select().from(loans).where(eq(loans.id, loanId)).limit(1).all()[0];
        if (!current || !current.isActive || current.status !== "active" || current.remainingCents !== current.amountCents) {
          throw new Error("Loan changed; retry reversal");
        }
        const payments = tx.select({ id: loanPayments.id }).from(loanPayments).where(and(
          eq(loanPayments.loanId, loanId), eq(loanPayments.status, "posted"),
        )).all();
        if (payments.length > 0) throw new Error("Reverse posted loan payments before reversing the original loan");
        const reversalTransactionId = insertDomainReversalSync(tx, current.lendingTransactionId!, reversal.prepared, reason);
        tx.update(loans).set({
          isActive: false,
          status: "cancelled",
          updatedAt: new Date(),
        }).where(eq(loans.id, loanId)).run();
        tx.insert(auditLogs).values({
          entityType: "loan",
          entityId: loanId,
          action: "reverse",
          beforeSnapshot: Buffer.from(JSON.stringify(current)),
          afterSnapshot: Buffer.from(JSON.stringify({ ...current, isActive: false, status: "cancelled", reversalTransactionId, reason })),
        }).run();
        return { reversalTransactionId };
      });
      await invalidateOnTransactionMutation({
        transactionId: result.reversalTransactionId,
        affectedAccountIds: reversal.prepared.accountIds,
        affectedPeriodIds: reversal.periodId == null ? undefined : [reversal.periodId],
        revisionBumped: true,
      });
      return reply.code(201).send(result);
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "Failed to reverse loan origin" });
    }
  });

  // PATCH /api/loans/:id - Update loan status (mark as defaulted, written off, etc.)
  fastify.patch("/api/loans/:id", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const loanId = Number(id);
      const body = request.body as {
        status?: 'active' | 'repaid' | 'defaulted' | 'written_off';
        description?: string;
      };

      if (!Number.isSafeInteger(loanId) || loanId <= 0) {
        reply.code(400).send({ error: "Invalid loan id" });
        return;
      }
      if (body.status && !['active', 'repaid', 'defaulted', 'written_off'].includes(body.status)) {
        reply.code(400).send({ error: "Invalid loan status" });
        return;
      }

      const [loan] = await db
        .select()
        .from(loans)
        .where(and(eq(loans.id, loanId), eq(loans.isActive, true)))
        .limit(1);

      if (!loan) {
        reply.code(404).send({ error: "Loan not found" });
        return;
      }

      if (body.status === "repaid" && loan.remainingCents !== 0) {
        reply.code(409).send({ error: "A loan can be marked repaid only after its balance reaches zero" });
        return;
      }
      if (body.status === "active" && loan.remainingCents === 0) {
        reply.code(409).send({ error: "A zero-balance loan cannot be reopened as active" });
        return;
      }
      if (body.status === "written_off" && loan.status !== "active") {
        reply.code(409).send({ error: "Only an active loan can be written off" });
        return;
      }

      const changingToWriteoff = body.status === "written_off" && loan.remainingCents > 0;
      let prepared: Awaited<ReturnType<typeof prepareJournalEntry>> | null = null;
      if (changingToWriteoff) {
        const [contact] = await db.select({ name: contacts.name }).from(contacts)
          .where(eq(contacts.id, loan.contactId)).limit(1);
        const loansReceivable = await getLoansReceivableAccount(db);
        const journalLines = loan.direction === "lent"
          ? [
              { accountId: (await getBadDebtExpenseAccount(db)).id, debit: loan.remainingCents, credit: 0 },
              { accountId: loansReceivable.id, debit: 0, credit: loan.remainingCents },
            ]
          : [
              { accountId: (await getLoansPayableAccount(db)).id, debit: loan.remainingCents, credit: 0 },
              { accountId: (await getForgivenessIncomeAccount(db)).id, debit: 0, credit: loan.remainingCents },
            ];
        prepared = await prepareJournalEntry({
          date: Date.now(),
          description: loan.direction === "lent"
            ? `Write off bad debt - ${contact?.name ?? "contact"}`
            : `Forgive loan payable - ${contact?.name ?? "contact"}`,
          txType: "loan_writeoff",
          lines: journalLines,
        }, db);
      }

      const result = db.transaction((tx) => {
        const current = tx.select().from(loans)
          .where(and(eq(loans.id, loan.id), eq(loans.isActive, true)))
          .limit(1).all()[0];
        if (!current) throw new Error("Loan not found");
        if (current.status !== loan.status || current.remainingCents !== loan.remainingCents) {
          throw new Error("Loan changed; retry update");
        }
        const transactionId = prepared ? insertPreparedJournalEntrySync(tx, prepared) : null;
        const nextRemaining = changingToWriteoff ? 0 : current.remainingCents;
        const nextStatus = body.status ?? current.status;
        const updateResult = tx.update(loans).set({
          ...(body.status && { status: nextStatus }),
          remainingCents: nextRemaining,
          ...(body.description !== undefined && { description: body.description }),
          updatedAt: sql`(unixepoch('now') * 1000)`,
        }).where(and(eq(loans.id, current.id), eq(loans.status, current.status), eq(loans.remainingCents, current.remainingCents))).run();
        if (updateResult.changes !== 1) throw new Error("Loan changed; retry update");
        tx.insert(auditLogs).values({
          entityType: "loan",
          entityId: current.id,
          action: "update",
          beforeSnapshot: Buffer.from(JSON.stringify(current)),
          afterSnapshot: Buffer.from(JSON.stringify({ ...current, status: nextStatus, remainingCents: nextRemaining, description: body.description ?? current.description })),
        }).run();
        if (!prepared) bumpFinancialRevisionSync(tx);
        return { transactionId, nextStatus, nextRemaining };
      });

      await invalidateOnTransactionMutation({
        transactionId: result.transactionId ?? loan.lendingTransactionId ?? loan.id,
        affectedAccountIds: prepared?.accountIds ?? [],
        revisionBumped: Boolean(result.transactionId && prepared),
      });

      const [updated] = await db
        .select()
        .from(loans)
        .where(eq(loans.id, loanId))
        .limit(1);

      return updated;
    } catch (err) {
      reply.code(400).send({ error: "Failed to update loan" });
    }
  });

  // DELETE /api/loans/:id - Soft delete loan and its transaction
  fastify.delete("/api/loans/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const loanId = parseInt(id);

    const [loan] = await db.select({ id: loans.id }).from(loans).where(eq(loans.id, loanId)).limit(1);
    if (!loan) return reply.code(404).send({ error: "Loan not found" });
    return reply.code(409).send({
      error: "Posted loans cannot be deleted; record repayment, write-off, or a dedicated reversal",
    });
  });
}
