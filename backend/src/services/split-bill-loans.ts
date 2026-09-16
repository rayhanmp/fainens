import { eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db/client";
import { accounts, auditLogs, contacts, loans, splitbillSessions, tags, transactions, transactionTags } from "../db/schema";
import { getOrCreateAutoExpenseAccount, prepareJournalEntry, type PreparedJournalEntry } from "./ledger";
import { normalizeContactName } from "./agent-contact-search";

const isoDate = z.string().trim().max(64).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/)
  .refine((value) => Number.isSafeInteger(Date.parse(value)) && Date.parse(value) >= 0, "Invalid date/time");

export const splitBillLoanInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  date: isoDate,
  walletAccountId: z.number().int().positive(),
  personalShareCents: z.number().int().nonnegative(),
  receiptTotalCents: z.number().int().positive(),
  categoryId: z.number().int().positive().optional(),
  periodId: z.number().int().positive().optional(),
  dueDate: isoDate.nullable().optional(),
  notes: z.string().trim().max(2000).optional(),
  receivables: z.array(z.object({
    contactId: z.number().int().positive().optional(),
    name: z.string().trim().min(1).max(120),
    amountCents: z.number().int().positive(),
  }).strict()).min(1).max(30),
  tagNames: z.array(z.string().trim().min(1).max(100)).max(10).default([]),
}).strict().superRefine((value, context) => {
  const total = value.personalShareCents + value.receivables.reduce((sum, row) => sum + row.amountCents, 0);
  if (!Number.isSafeInteger(total) || total !== value.receiptTotalCents) context.addIssue({ code: "custom", message: "Personal share plus receivables must equal the receipt total" });
  const keys = value.receivables.map((row) => normalizeContactName(row.name));
  if (new Set(keys).size !== keys.length) context.addIssue({ code: "custom", message: "Each split participant must appear only once" });
});

export type SplitBillLoanInput = z.infer<typeof splitBillLoanInputSchema>;
type ResolvedReceivable = { contactId: number | null; name: string; amountCents: number; createsContact: boolean };

export function splitBillTagNames(title: string, date: string, extra: string[] = []): string[] {
  const group = `Split bill · ${title.trim().slice(0, 70)} · ${date.slice(0, 10)}`;
  return [...new Map(["Split bill", group, ...extra].map((name) => [name.trim().toLocaleLowerCase(), name.trim()])).values()];
}

export function ensureSplitBillTagsSync(tx: any, names: string[]): number[] {
  const existing = tx.select().from(tags).all() as Array<{ id: number; name: string }>;
  return names.map((name) => {
    const match = existing.find((tag) => tag.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase());
    if (match) return match.id;
    const created = tx.insert(tags).values({ name, color: "#2563EB" }).returning().all()[0];
    if (!created) throw new Error("Could not create split-bill tag");
    existing.push(created);
    return created.id as number;
  });
}

/** An exact bill reference remains distinct even for same-merchant, same-day receipts. */
export function linkSplitBillReferenceTagSync(tx: any, transactionId: number): number {
  const [tagId] = ensureSplitBillTagsSync(tx, [`Split bill #${transactionId}`]);
  tx.insert(transactionTags).values({ transactionId, tagId }).onConflictDoNothing().run();
  tx.insert(auditLogs).values({ entityType: "transaction", entityId: transactionId, action: "link_split_bill", afterSnapshot: Buffer.from(JSON.stringify({ tagId, sourceTransactionId: transactionId })) }).run();
  return tagId;
}

async function resolveReceivables(input: SplitBillLoanInput): Promise<ResolvedReceivable[]> {
  const saved = await db.select().from(contacts);
  const rows = input.receivables.map((row): ResolvedReceivable => {
    const matches = row.contactId != null
      ? saved.filter((contact) => contact.id === row.contactId)
      : saved.filter((contact) => [contact.name, contact.fullName].some((name) => name != null && normalizeContactName(name) === normalizeContactName(row.name)));
    if (matches.length > 1) throw new Error(`Ambiguous contact ${row.name}; select the saved contact ID`);
    if (row.contactId != null && matches.length === 0) throw new Error(`Contact not found: ${row.contactId}`);
    if (matches[0] && !matches[0].isActive) throw new Error(`Contact ${row.name} is archived; restore it before creating a loan`);
    return { contactId: matches[0]?.id ?? null, name: matches[0]?.name ?? row.name, amountCents: row.amountCents, createsContact: !matches[0] };
  });
  const ids = rows.flatMap((row) => row.contactId == null ? [] : [row.contactId]);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate saved contact in split bill");
  return rows;
}

export async function prepareSplitBillLoans(input: SplitBillLoanInput) {
  const [wallet] = await db.select().from(accounts).where(eq(accounts.id, input.walletAccountId)).limit(1);
  if (!wallet?.isActive || wallet.type !== "asset" || wallet.liquidityClass !== "cash_equivalent") throw new Error("Select the active cash/bank wallet that paid the receipt");
  const receivables = await resolveReceivables(input);
  let [receivableAccount] = await db.select().from(accounts).where(eq(accounts.systemKey, "loans-receivable")).limit(1);
  if (!receivableAccount) [receivableAccount] = await db.insert(accounts).values({ name: "Loans Receivable", type: "asset", systemKey: "loans-receivable", liquidityClass: "receivable", isActive: true }).returning();
  if (!receivableAccount?.isActive || receivableAccount.type !== "asset") throw new Error("Loans Receivable account is unavailable");
  const expense = input.personalShareCents > 0 ? await getOrCreateAutoExpenseAccount(db) : null;
  const totalReceivableCents = receivables.reduce((sum, row) => sum + row.amountCents, 0);
  const prepared = await prepareJournalEntry({
    date: Date.parse(input.date),
    description: `Split bill - ${input.title}`,
    notes: input.notes,
    txType: "split_bill_lent",
    periodId: input.periodId,
    categoryId: expense ? input.categoryId : undefined,
    lines: [
      ...(expense ? [{ accountId: expense.id, debit: input.personalShareCents, credit: 0, description: "Personal share" }] : []),
      ...receivables.map((row) => ({ accountId: receivableAccount!.id, debit: row.amountCents, credit: 0, description: `Receivable from ${row.name}` })),
      { accountId: wallet.id, debit: 0, credit: input.receiptTotalCents, description: "Receipt payment", cashFlowClass: "operating" },
    ],
  }, db);
  const tagNames = splitBillTagNames(input.title, input.date, input.tagNames);
  return {
    prepared,
    receivables,
    tagNames,
    details: { title: input.title, dateMs: prepared.dateMs, walletAccountId: wallet.id, walletName: wallet.name, personalShareCents: input.personalShareCents, receiptTotalCents: input.receiptTotalCents, totalReceivableCents, receivables, tagNames },
  };
}

export function insertSplitBillLoansSync(tx: any, input: SplitBillLoanInput, draft: Awaited<ReturnType<typeof prepareSplitBillLoans>>, insertJournal: (tx: any, prepared: PreparedJournalEntry) => number) {
  const tagIds = ensureSplitBillTagsSync(tx, draft.tagNames);
  const transactionId = insertJournal(tx, { ...draft.prepared, tagIds });
  tagIds.push(linkSplitBillReferenceTagSync(tx, transactionId));
  const loanIds: number[] = [];
  const contactIds = new Set<number>();
  const people: Array<{ id: number; name: string; total: number }> = [{ id: 0, name: "Personal share", total: input.personalShareCents }];
  for (const row of draft.receivables) {
    // Re-resolve inside the commit to handle contacts created since review.
    const saved = tx.select().from(contacts).all() as Array<{ id: number; name: string; fullName: string | null; isActive: boolean }>;
    const matches = row.contactId == null
      ? saved.filter((contact) => [contact.name, contact.fullName].some((name) => name != null && normalizeContactName(name) === normalizeContactName(row.name)))
      : saved.filter((contact) => contact.id === row.contactId);
    if (matches.length > 1 || (matches[0] && !matches[0].isActive) || (row.contactId != null && !matches[0])) throw new Error(`Contact ${row.name} changed; review a fresh proposal`);
    let contact = matches[0];
    if (!contact) {
      contact = tx.insert(contacts).values({ name: row.name, relationshipType: "friend" }).returning().all()[0];
      if (!contact) throw new Error("Could not create split-bill contact");
      tx.insert(auditLogs).values({ entityType: "contact", entityId: contact.id, action: "create", afterSnapshot: Buffer.from(JSON.stringify(contact)) }).run();
    }
    if (contactIds.has(contact.id)) throw new Error("Duplicate saved contact in split bill; review a fresh proposal");
    contactIds.add(contact.id);
    const loan = tx.insert(loans).values({ contactId: contact.id, direction: "lent", amountCents: row.amountCents, remainingCents: row.amountCents, startDate: new Date(draft.prepared.dateMs), dueDate: input.dueDate ? new Date(input.dueDate) : null, status: "active", description: `Split bill - ${input.title}`, sourceType: "split_bill", sourceTransactionId: transactionId, lendingTransactionId: transactionId, walletAccountId: input.walletAccountId }).returning().all()[0];
    if (!loan) throw new Error("Could not create split-bill loan");
    loanIds.push(loan.id);
    people.push({ id: contact.id, name: contact.name, total: row.amountCents });
    tx.insert(auditLogs).values({ entityType: "loan", entityId: loan.id, action: "create", afterSnapshot: Buffer.from(JSON.stringify({ loan, transactionId, tagIds })) }).run();
  }
  const session = tx.insert(splitbillSessions).values({ merchantName: input.title, receiptDate: new Date(draft.prepared.dateMs), totalCents: input.receiptTotalCents, peopleJson: JSON.stringify(people), splitResultJson: JSON.stringify(people.map((person) => ({ personId: person.id, personName: person.name, total: person.total }))), loanIds: JSON.stringify(loanIds), status: "completed" }).returning().all()[0];
  if (!session) throw new Error("Could not create split-bill history");
  tx.insert(auditLogs).values({ entityType: "splitbill_session", entityId: session.id, action: "create", afterSnapshot: Buffer.from(JSON.stringify({ session, transactionId, loanIds, tagIds })) }).run();
  return { transactionId, loanIds, tagIds, splitBillId: session.id as number };
}

/** Loans inherit the source journal's tags and group identity, without copying metadata. */
export async function loadLoanSourceLinks(rows: Array<{ sourceTransactionId: number | null; lendingTransactionId: number | null }>) {
  const ids = [...new Set(rows.flatMap((row) => { const id = row.sourceTransactionId ?? row.lendingTransactionId; return id == null ? [] : [id]; }))];
  const byId = new Map<number, { sourceDescription: string; tags: Array<{ id: number; name: string; color: string }> }>();
  if (ids.length === 0) return byId;
  const sources = await db.select({ id: transactions.id, description: transactions.description }).from(transactions).where(inArray(transactions.id, ids));
  for (const source of sources) byId.set(source.id, { sourceDescription: source.description, tags: [] });
  const associations = await db.select({ transactionId: transactionTags.transactionId, id: tags.id, name: tags.name, color: tags.color }).from(transactionTags).innerJoin(tags, eq(tags.id, transactionTags.tagId)).where(inArray(transactionTags.transactionId, ids));
  for (const association of associations) byId.get(association.transactionId)?.tags.push({ id: association.id, name: association.name, color: association.color });
  return byId;
}
