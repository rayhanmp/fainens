import { eq, inArray, or } from 'drizzle-orm';
import { db } from '../db/client';
import { loans, loanPayments, contacts } from '../db/schema';

export async function loadTransactionLoanActivity(transactionIds: number[]) {
  const result = new Map<number, { role: 'origin' | 'payment'; loans: Array<{
    id: number; contactName: string; direction: string; amountCents: number; remainingCents: number; status: string;
  }>; payment?: { amountCents: number; status: string } }>();
  if (!transactionIds.length) return result;
  const origins = await db.select({ loan: loans, contactName: contacts.name }).from(loans)
    .innerJoin(contacts, eq(loans.contactId, contacts.id))
    .where(or(inArray(loans.sourceTransactionId, transactionIds), inArray(loans.lendingTransactionId, transactionIds)))
    .orderBy(loans.id);
  const payments = await db.select({ payment: loanPayments, loan: loans, contactName: contacts.name }).from(loanPayments)
    .innerJoin(loans, eq(loanPayments.loanId, loans.id)).innerJoin(contacts, eq(loans.contactId, contacts.id))
    .where(inArray(loanPayments.transactionId, transactionIds));
  const identity = (loan: typeof loans.$inferSelect, contactName: string) => ({
    id: loan.id, contactName, direction: loan.direction, amountCents: loan.amountCents,
    remainingCents: loan.remainingCents, status: loan.status,
  });
  for (const { loan, contactName } of origins) {
    const sourceId = loan.sourceTransactionId ?? loan.lendingTransactionId;
    if (sourceId == null || !transactionIds.includes(sourceId)) continue;
    if (!result.has(sourceId)) result.set(sourceId, { role: 'origin', loans: [] });
    result.get(sourceId)!.loans.push(identity(loan, contactName));
  }
  for (const { loan, payment, contactName } of payments) {
    if (payment.transactionId == null) continue;
    result.set(payment.transactionId, { role: 'payment', loans: [identity(loan, contactName)],
      payment: { amountCents: payment.amountCents, status: payment.status } });
  }
  return result;
}
