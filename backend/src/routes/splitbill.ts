import { and, eq, desc, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { db } from "../db/client";
import { splitbillSessions, contacts, loans, loanPayments, accounts, auditLogs, transactions } from "../db/schema";
import { uploadFile, generatePresignedDownloadUrl } from "../services/r2";
import { callOpenRouterVision } from "../services/openrouter";
import { env } from "../lib/env";
import {
  insertPreparedJournalEntrySync,
  prepareJournalEntry,
} from "../services/ledger";
import { invalidateOnTransactionMutation } from "../cache/invalidation";
import { insertDomainReversalSync, prepareDomainReversal } from "../services/domain-reversal";

const GEMINI_MODEL = "google/gemini-3.1-flash-lite-preview";

const SYSTEM_PROMPT = `You are an expert receipt parser specializing in Indonesian restaurant receipts (nota/restoran).

## YOUR TASK
Extract structured data from receipt images. Your output MUST be valid JSON matching the specified schema.

## INPUT RECEIPTS TO HANDLE
- Indonesian restaurant receipts (most common)
- May include: merchant name, address, phone, date/time, tax numbers (NPWP)
- Items: food, drinks, servings with prices
- Additional charges: tax (PPN 10%), service charge (service 5-10%), discounts

## EXTRACTED DATA SCHEMA
{
  "merchantName": "string - restaurant/merchant name, extract from header",
  "receiptDate": "ISO 8601 string - when receipt was issued (YYYY-MM-DDTHH:MM:SSZ)",
  "expenseCategory": "string - the best expense category for this receipt. Choose from: 'Food & Dining', 'Groceries', 'Transportation', 'Shopping', 'Entertainment', 'Healthcare', 'Utilities', 'Education', 'Travel', 'Other'. Use 'Food & Dining' for restaurants/eateries, 'Groceries' for minimarkets/supermarkets.",
  "items": [
    {
      "name": "string - item name as written, in Indonesian/English",
      "quantity": number,
      "unitPrice": number - price per unit in Indonesian Rupiah (NOT cents),
      "totalPrice": number - quantity × unitPrice,
      "notes": "optional - e.g., 'pedas', 'manis'"
    }
  ],
  "subtotal": number - sum of all item totals in IDR,
  "tax": number - PPN 10% amount in IDR,
  "taxPercent": number - tax rate (usually 10),
  "serviceFee": number - service charge amount in IDR,
  "servicePercent": number - service charge rate (usually 5 or 10),
  "discount": number - total discount amount in IDR,
  "discountPercent": number - if discount is percentage-based,
  "total": number - final amount to pay (subtotal + tax + service - discount),
  "paymentMethod": "string - optional: cash, card, qris, etc",
  "currency": "IDR"
}

## CRITICAL EXTRACTION RULES

### 1. PRICE HANDLING
- All prices in Indonesian Rupiah (Rp), NOT cents
- Example: Rp 25,000 = 25000 (not 2500000)
- Handle thousand separators: 25.000, 25,000, 25000 all = 25000

### 2. ITEM PARSING
- Each line with a price is an item
- Combine items with identical names (e.g., 2x "Es Teh" → quantity: 2)
- Exclude: tax, service, discount lines from items array

### 3. EXPENSE CATEGORY
- Determine the best expense category based on merchant type:
  - Restaurant/cafe/eatery/food stall → "Food & Dining"
  - Minimarket/supermarket/convenience store → "Groceries"
  - Ride-hailing delivery (GoFood, GrabFood) → "Food & Dining"
  - Warung (small local shop) → "Food & Dining"
  - Modern retail → "Groceries"
  - Others → use your judgment

### 4. TAX & SERVICE DETECTION
- PPN: usually 10%, may be labeled "Pajak 10%" or shown in total
- Service: usually 5-10%, labeled "Service 5%" or "Pelayanan"

### 5. DATE EXTRACTION
- Format: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
- Return as ISO 8601: "2024-01-15T14:30:00Z"

## OUTPUT FORMAT
Return ONLY valid JSON. No markdown, no explanation.

## ERROR HANDLING
Only return an error if you are VERY confident the image is NOT a receipt. Examples of non-receipt images:
- Selfies, photos of people, landscapes, screenshots
- Credit card statements, bank statements (not actual receipts)
- Invoices that are not point-of-sale receipts
- Blurry or unreadable images

If the image is definitely NOT a receipt:
{
  "error": "not_a_receipt",
  "message": "Hmm, this doesn't look like a receipt. Please upload a photo of your receipt or bill."
}

If you see receipt-like content but cannot extract ANY items (e.g., image is too blurry/corrupted):
{
  "error": "no_items_found",
  "message": "Couldn't read the items from this image. You can fill them in manually below."
}

IMPORTANT: Only return error JSON if you are confident the image is not a receipt. If you can see ANY items, prices, or receipt-like content, parse it normally.`;

const USER_PROMPT = `Extract all data from this receipt image. Return JSON with the exact schema specified. Prices must be in Indonesian Rupiah (IDR), NOT cents.`;

const splitbillErrorSchema = z.object({ error: z.string(), message: z.string().optional() }).passthrough();
const splitbillSessionIdParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const splitbillTransactionParamsSchema = z.object({ transactionId: z.coerce.number().int().positive() });
const splitbillReasonBodySchema = z.object({ reason: z.string().trim().min(1).max(500) }).passthrough();
const parsedReceiptItemSchema = z.object({ name: z.string(), quantity: z.number(), unitPrice: z.number(), totalPrice: z.number(), notes: z.string().nullable().optional() }).passthrough();
const parsedReceiptSchema = z.object({ merchantName: z.string(), receiptDate: z.string(), expenseCategory: z.string(), items: z.array(parsedReceiptItemSchema), subtotal: z.number(), tax: z.number(), taxPercent: z.number(), serviceFee: z.number(), servicePercent: z.number(), discount: z.number(), discountPercent: z.number(), total: z.number(), paymentMethod: z.string().nullable(), currency: z.string() }).passthrough();
const splitbillPersonSchema = z.object({ id: z.number().int().optional(), name: z.string().trim().min(1), isNew: z.boolean().optional() }).passthrough();
const splitbillAssignmentSchema = z.object({ itemIndex: z.number().int().nonnegative(), personIds: z.array(z.number().int()).min(1) }).passthrough();
const splitbillPersonResultSchema = z.object({ personId: z.number().int(), personName: z.string(), assignedItems: z.array(parsedReceiptItemSchema), subtotal: z.number(), taxShare: z.number(), serviceShare: z.number(), discountShare: z.number(), total: z.number() }).passthrough();
const splitbillScanBodySchema = z.object({ imageData: z.string().min(1), filename: z.string().trim().min(1).max(255) }).passthrough();
const splitbillScanResponseSchema = z.object({ parsed: parsedReceiptSchema, r2Key: z.string() }).passthrough();
const splitbillCalculateBodySchema = z.object({ items: z.array(parsedReceiptItemSchema).min(1), people: z.array(splitbillPersonSchema).min(1), assignments: z.array(splitbillAssignmentSchema), tax: z.number().nonnegative(), serviceFee: z.number().nonnegative(), discount: z.number().nonnegative() }).passthrough();
const splitbillCreateLoansBodySchema = z.object({ splitResults: z.array(z.object({ personId: z.number().int().nonnegative(), personName: z.string().trim().min(1), total: z.number().nonnegative() }).passthrough()).min(1), isBorrower: z.boolean(), walletAccountId: z.number().int().positive().optional(), expenseCategory: z.string().max(120).optional(), receiptTotal: z.number().int().positive().optional(), merchantName: z.string().max(200).optional(), payerContactId: z.number().int().positive().optional() }).passthrough();
const splitbillLoanResponseSchema = z.object({ id: z.number().int(), contactId: z.number().int(), direction: z.string(), amountCents: z.number().int(), remainingCents: z.number().int(), status: z.string() }).passthrough();
const splitbillSessionSchema = z.object({ id: z.number().int(), merchantName: z.string().nullable(), receiptDate: z.union([z.date(), z.string(), z.number()]).nullable(), receiptImageR2Key: z.string().nullable(), parsedItemsJson: z.string().nullable(), subtotalCents: z.number().int().nullable(), taxCents: z.number().int().nullable(), serviceFeeCents: z.number().int().nullable(), discountCents: z.number().int().nullable(), totalCents: z.number().int(), peopleJson: z.string().nullable(), assignmentsJson: z.string().nullable(), splitResultJson: z.string().nullable(), loanIds: z.string().nullable(), status: z.string(), createdAt: z.union([z.date(), z.string(), z.number()]), updatedAt: z.union([z.date(), z.string(), z.number()]) }).passthrough();

interface ParsedReceiptItem {
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  notes: string | null;
}

interface ParsedReceipt {
  merchantName: string;
  receiptDate: string;
  expenseCategory: string;
  items: ParsedReceiptItem[];
  subtotal: number;
  tax: number;
  taxPercent: number;
  serviceFee: number;
  servicePercent: number;
  discount: number;
  discountPercent: number;
  total: number;
  paymentMethod: string | null;
  currency: string;
}

interface SplitBillPerson {
  id?: number;
  name: string;
  isNew?: boolean;
}

interface ItemAssignment {
  itemIndex: number;
  personIds: number[];
}

interface PersonSplitResult {
  personId: number;
  personName: string;
  assignedItems: ParsedReceiptItem[];
  subtotal: number;
  taxShare: number;
  serviceShare: number;
  discountShare: number;
  total: number;
}

function calculateSplit(
  items: ParsedReceiptItem[],
  people: SplitBillPerson[],
  assignments: ItemAssignment[],
  tax: number,
  serviceFee: number,
  discount: number
): PersonSplitResult[] {
  const personSubtotals: Record<number, number> = {};
  const personItems: Record<number, ParsedReceiptItem[]> = {};

  for (const person of people) {
    if (person.id) {
      personSubtotals[person.id] = 0;
      personItems[person.id] = [];
    }
  }

  for (const assignment of assignments) {
    const item = items[assignment.itemIndex];
    if (!item) continue;

    const sharePerPerson = Math.round(item.totalPrice / assignment.personIds.length);

    for (const personId of assignment.personIds) {
      if (personSubtotals[personId] !== undefined) {
        personSubtotals[personId] += sharePerPerson;
        personItems[personId].push({
          ...item,
          totalPrice: sharePerPerson,
          quantity: 1 / assignment.personIds.length,
        });
      }
    }
  }

  const totalItemSubtotal = items.reduce((sum, i) => sum + i.totalPrice, 0);
  if (totalItemSubtotal === 0) {
    return [];
  }

  const results: PersonSplitResult[] = [];

  for (const person of people) {
    if (!person.id) continue;

    const subtotal = personSubtotals[person.id] || 0;
    const proportion = subtotal / totalItemSubtotal;

    results.push({
      personId: person.id,
      personName: person.name,
      assignedItems: personItems[person.id] || [],
      subtotal,
      taxShare: Math.round(tax * proportion),
      serviceShare: Math.round(serviceFee * proportion),
      discountShare: Math.round(discount * proportion),
      total: subtotal + Math.round(tax * proportion) + Math.round(serviceFee * proportion) - Math.round(discount * proportion),
    });
  }

  return results.sort((a, b) => b.total - a.total);
}

async function getOrCreateExpenseAccount(categoryName: string): Promise<{ id: number }> {
  const [existing] = await db
    .select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive })
    .from(accounts)
    .where(eq(accounts.name, categoryName))
    .limit(1);
  if (existing) {
    if (existing.type !== "expense" || !existing.isActive) {
      throw new Error(`Expense account ${categoryName} must be an active expense account`);
    }
    return { id: existing.id };
  }
  const [created] = await db.insert(accounts).values({
    name: categoryName,
    type: "expense",
    isActive: true,
  }).returning({ id: accounts.id });
  if (!created) throw new Error("Failed to create expense account");
  return created;
}

async function getOrCreateSystemAccount(
  key: string,
  name: string,
  type: "asset" | "liability",
): Promise<{ id: number }> {
  const [existing] = await db
    .select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive })
    .from(accounts)
    .where(eq(accounts.systemKey, key))
    .limit(1);
  if (existing) {
    if (existing.type !== type || !existing.isActive) {
      throw new Error(`System account ${key} must be an active ${type} account`);
    }
    return { id: existing.id };
  }
  try {
    const [created] = await db.insert(accounts).values({
      name,
      type,
      isActive: true,
      systemKey: key,
    }).returning({ id: accounts.id });
    if (!created) throw new Error(`Failed to create system account ${key}`);
    return created;
  } catch (error) {
    const [winner] = await db.select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive })
      .from(accounts).where(eq(accounts.systemKey, key)).limit(1);
    if (!winner || winner.type !== type || !winner.isActive) throw error;
    return { id: winner.id };
  }
}

function normalizeLargestRemainder(
  rows: Array<{ personId: number; personName: string; total: number }>,
  targetTotal: number,
): Array<{ personId: number; personName: string; total: number }> {
  const floors = rows.map((row) => ({
    ...row,
    total: Math.floor(row.total),
    fraction: row.total - Math.floor(row.total),
  }));
  let remainder = targetTotal - floors.reduce((sum, row) => sum + row.total, 0);
  if (remainder < 0 || remainder > floors.length) throw new Error("Split totals cannot be reconciled to receipt total");
  floors.sort((a, b) => b.fraction - a.fraction || a.personId - b.personId);
  for (let i = 0; i < remainder; i++) floors[i].total += 1;
  return floors
    .sort((a, b) => a.personId - b.personId)
    .map(({ fraction: _fraction, ...row }) => row);
}

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.post<{ Body: { imageData: string; filename: string } }>(
    "/api/splitbill/scan",
    { schema: { operationId: "scanSplitBillReceipt", tags: ["splitbill"], body: splitbillScanBodySchema, response: { 200: splitbillScanResponseSchema, 400: splitbillErrorSchema, 422: splitbillErrorSchema, 500: splitbillErrorSchema } } },
    async (request, reply) => {
      try {
        const { imageData, filename } = request.body;

        if (!imageData || !filename) {
          reply.code(400).send({ error: "imageData and filename are required" });
          return;
        }

        const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, "base64");

        const contentType = filename.match(/\.png$/) ? "image/png" : "image/jpeg";
        const key = `splitbill/${Date.now()}_${filename.replace(/[^a-zA-Z0-9.-]/g, "_")}`;

        await uploadFile(key, buffer, contentType);

        const imageUrl = await generatePresignedDownloadUrl(key, 3600);

        if (!env.OPENROUTER_API_KEY) {
          reply.code(500).send({ error: "OpenRouter API key not configured" });
          return;
        }

        const response = await callOpenRouterVision(
          SYSTEM_PROMPT,
          imageUrl,
          USER_PROMPT,
          env.OPENROUTER_API_KEY,
          GEMINI_MODEL
        );

        let parsed: ParsedReceipt;
        try {
          const jsonMatch = response.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            throw new Error("The AI couldn't understand this image. Please try a clearer photo.");
          }
          const jsonResult = JSON.parse(jsonMatch[0]);
          
          if (jsonResult.error) {
            reply.code(422).send({ 
              error: jsonResult.error,
              message: jsonResult.message 
            });
            return;
          }
          
          parsed = jsonResult;
          
          if (!parsed.items || parsed.items.length === 0) {
            reply.code(422).send({ 
              error: "no_items_found",
              message: "Couldn't read any items from this receipt. Try filling them in manually below."
            });
            return;
          }
        } catch (err) {
          console.error("Failed to parse Gemini response:", response);
          reply.code(500).send({ error: "Something went wrong while scanning. Please try again." });
          return;
        }

        reply.send({ parsed, r2Key: key });
      } catch (err) {
        console.error("Splitbill scan error:", err);
        reply.code(500).send({ error: "Failed to scan receipt. Please try again." });
      }
    }
  );

  fastify.post<{ Body: { items: ParsedReceiptItem[]; people: SplitBillPerson[]; assignments: ItemAssignment[]; tax: number; serviceFee: number; discount: number } }>(
    "/api/splitbill/calculate",
    { schema: { operationId: "calculateSplitBill", tags: ["splitbill"], body: splitbillCalculateBodySchema, response: { 200: z.array(splitbillPersonResultSchema), 400: splitbillErrorSchema, 500: splitbillErrorSchema } } },
    async (request, reply) => {
      try {
        const { items, people, assignments, tax, serviceFee, discount } = request.body;

        if (!items || !people || !assignments) {
          reply.code(400).send({ error: "items, people, and assignments are required" });
          return;
        }

        const results = calculateSplit(items, people, assignments, tax, serviceFee, discount);
        reply.send(results);
      } catch (err) {
        reply.code(500).send({ error: "Failed to calculate split" });
      }
    }
  );

  fastify.post<{ Body: {
    splitResults: PersonSplitResult[];
    isBorrower: boolean;
    walletAccountId?: number;
    expenseCategory?: string;
    receiptTotal?: number;
    merchantName?: string;
    payerContactId?: number;
  } }>(
    "/api/splitbill/create-loans",
    { schema: { operationId: "createSplitBillLoans", tags: ["splitbill"], body: splitbillCreateLoansBodySchema, response: { 201: z.array(splitbillLoanResponseSchema), 400: splitbillErrorSchema } } },
    async (request, reply) => {
      try {
        const {
          splitResults,
          isBorrower,
          walletAccountId,
          expenseCategory,
          receiptTotal,
          merchantName,
          payerContactId,
        } = request.body;

        if (!Array.isArray(splitResults) || splitResults.length === 0) {
          reply.code(400).send({ error: "splitResults is required" });
          return;
        }

        if (typeof isBorrower !== "boolean") {
          reply.code(400).send({ error: "isBorrower is required" });
          return;
        }
        if (!isBorrower && (!Number.isSafeInteger(walletAccountId) || (walletAccountId as number) <= 0)) {
          reply.code(400).send({ error: "walletAccountId is required when you pay" });
          return;
        }

        const rawRows = splitResults.map((result) => {
          if (!Number.isSafeInteger(result.personId) || result.personId < 0) {
            throw new Error("Each split result needs a valid person id");
          }
          if (!result.personName || !Number.isFinite(result.total) || result.total < 0) {
            throw new Error("Each split result needs a finite non-negative total");
          }
          return { personId: result.personId, personName: result.personName, total: result.total };
        });
        if (new Set(rawRows.map((row) => row.personId)).size !== rawRows.length) {
          reply.code(400).send({ error: "Duplicate people in split results" });
          return;
        }
        const targetTotal = receiptTotal == null
          ? Math.round(rawRows.reduce((sum, row) => sum + row.total, 0))
          : receiptTotal;
        if (!Number.isSafeInteger(targetTotal) || targetTotal <= 0) {
          reply.code(400).send({ error: "receiptTotal must be a positive integer" });
          return;
        }
        const normalizedRows = normalizeLargestRemainder(rawRows, targetTotal);
        if (normalizedRows.reduce((sum, row) => sum + row.total, 0) !== targetTotal) {
          reply.code(400).send({ error: "Split totals must equal the receipt total" });
          return;
        }

        const categoryName = expenseCategory || "Food & Dining";
        const meResult = normalizedRows.find((row) => row.personId === 0);
        if (!meResult || meResult.total <= 0) {
          reply.code(400).send({ error: "A positive personal share is required" });
          return;
        }

        const contactRows = normalizedRows.filter((row) => row.personId !== 0 && row.total > 0);
        const allContactRows = normalizedRows.filter((row) => row.personId !== 0);
        const contactIds = allContactRows.map((row) => row.personId);
        if (isBorrower) {
          if (!Number.isSafeInteger(payerContactId) || (payerContactId as number) <= 0) {
            reply.code(400).send({ error: "payerContactId is required when someone else paid" });
            return;
          }
          if (!contactIds.includes(payerContactId as number)) {
            reply.code(400).send({ error: "payerContactId must be one of the split contacts" });
            return;
          }
        }

        // Fetch all contacts with a parameterized IN clause; avoid silently
        // creating loans for synthetic UI ids or inactive contacts.
        const foundContacts = contactIds.length > 0
          ? await db.select({ id: contacts.id, name: contacts.name, isActive: contacts.isActive })
            .from(contacts)
            .where(sql`${contacts.id} IN (${sql.join(contactIds.map((id) => sql`${id}`), sql`, `)})`)
          : [];
        if (foundContacts.length !== new Set(contactIds).size || foundContacts.some((contact) => !contact.isActive)) {
          reply.code(400).send({ error: "Every split contact must be an active saved contact" });
          return;
        }
        const contactById = new Map(foundContacts.map((contact) => [contact.id, contact]));

        const expenseAccount = await getOrCreateExpenseAccount(categoryName);
        const loansReceivable = !isBorrower
          ? await getOrCreateSystemAccount("loans-receivable", "Loans Receivable", "asset")
          : null;
        const loansPayable = isBorrower
          ? await getOrCreateSystemAccount("loans-payable", "Loans Payable", "liability")
          : null;

        let wallet: { id: number; type: string; isActive: boolean; liquidityClass: string } | null = null;
        if (!isBorrower) {
          [wallet] = await db.select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive, liquidityClass: accounts.liquidityClass })
            .from(accounts).where(eq(accounts.id, walletAccountId as number)).limit(1);
          if (!wallet || !wallet.isActive || wallet.type !== "asset") {
            reply.code(400).send({ error: "walletAccountId must be an active asset account" });
            return;
          }
        }

        const description = merchantName ? `Split bill - ${merchantName}` : "Split bill";
        const journalLines = isBorrower
          ? [
              { accountId: expenseAccount.id, debit: meResult.total, credit: 0, description: "Personal share" },
              { accountId: loansPayable!.id, debit: 0, credit: meResult.total, description: "Amount owed to payer" },
            ]
          : [
              ...(meResult.total > 0 ? [{ accountId: expenseAccount.id, debit: meResult.total, credit: 0, description: "Personal share" }] : []),
              ...contactRows.map((row) => ({ accountId: loansReceivable!.id, debit: row.total, credit: 0, description: `Receivable from ${row.personName}` })),
              { accountId: walletAccountId as number, debit: 0, credit: targetTotal, description: "Receipt payment", cashFlowClass: wallet!.liquidityClass === "cash_equivalent" ? "operating" as const : undefined },
            ];
        const prepared = await prepareJournalEntry({
          date: Date.now(),
          description,
          txType: isBorrower ? "split_bill_borrowed" : "split_bill_lent",
          lines: journalLines,
        }, db);

        const result = db.transaction((tx) => {
          const transactionId = insertPreparedJournalEntrySync(tx, prepared);
          const loansToCreate = isBorrower
            ? [{
                contactId: payerContactId as number,
                direction: "borrowed" as const,
                amountCents: meResult.total,
                description: `Borrowed from ${contactById.get(payerContactId as number)?.name ?? "payer"} for split bill`,
                walletAccountId: null,
              }]
            : contactRows.map((row) => ({
                contactId: row.personId,
                direction: "lent" as const,
                amountCents: row.total,
                description: `Lent to ${row.personName} for split bill`,
                walletAccountId: walletAccountId as number,
              }));
          const createdLoans: typeof loans.$inferSelect[] = [];
          for (const loanInput of loansToCreate) {
            const inserted = tx.insert(loans).values({
              ...loanInput,
              remainingCents: loanInput.amountCents,
              startDate: new Date(),
              status: "active",
              sourceType: "split_bill",
              sourceTransactionId: transactionId,
              lendingTransactionId: transactionId,
            }).returning().all();
            const loan = inserted[0];
            if (!loan) throw new Error("Failed to create split-bill loan");
            createdLoans.push(loan);
            tx.insert(auditLogs).values({
              entityType: "loan",
              entityId: loan.id,
              action: "create",
              afterSnapshot: Buffer.from(JSON.stringify({ loan, transactionId })),
            }).run();
          }
          return { transactionId, createdLoans };
        });
        await invalidateOnTransactionMutation({
          transactionId: result.transactionId,
          affectedAccountIds: prepared.accountIds,
          revisionBumped: true,
        });
        reply.code(201).send(result.createdLoans);
      } catch (err) {
        console.error("Create loans error:", err);
        reply.code(400).send({ error: (err as Error).message || "Failed to create loans" });
      }
    }
  );

  /** Reverse a split-bill journal and archive every untouched derived loan. */
  fastify.post("/api/splitbill/transactions/:transactionId/reverse", {
    schema: { operationId: "reverseSplitBill", tags: ["splitbill"], params: splitbillTransactionParamsSchema, body: splitbillReasonBodySchema, response: { 201: z.object({ reversalTransactionId: z.number().int(), reversedLoanIds: z.array(z.number().int()) }).passthrough(), 400: splitbillErrorSchema, 409: splitbillErrorSchema } },
  }, async (request, reply) => {
    const transactionId = Number((request.params as { transactionId?: string }).transactionId);
    const reason = String((request.body as { reason?: unknown } | undefined)?.reason ?? "").trim();
    if (!Number.isSafeInteger(transactionId) || transactionId <= 0) return reply.code(400).send({ error: "Invalid transaction id" });
    if (!reason || reason.length > 500) return reply.code(400).send({ error: "reason is required and must be at most 500 characters" });
    try {
      const [original] = await db.select().from(transactions).where(eq(transactions.id, transactionId)).limit(1);
      if (!original || !["split_bill_lent", "split_bill_borrowed"].includes(original.txType)) {
        return reply.code(409).send({ error: "A split-bill transaction is required" });
      }
      const reversal = await prepareDomainReversal(transactionId, reason, db);
      const result = db.transaction((tx) => {
        const current = tx.select().from(transactions).where(eq(transactions.id, transactionId)).limit(1).all()[0];
        if (!current || current.status !== "posted" || !["split_bill_lent", "split_bill_borrowed"].includes(current.txType)) {
          throw new Error("Split-bill transaction changed; retry reversal");
        }
        const derivedLoans = tx.select().from(loans).where(eq(loans.sourceTransactionId, transactionId)).all();
        if (derivedLoans.length === 0) throw new Error("No derived loans found for this split-bill transaction");
        for (const loan of derivedLoans) {
          if (!loan.isActive || loan.status !== "active" || loan.remainingCents !== loan.amountCents) {
            throw new Error("Only split-bill loans with no repayment or status change can be reversed");
          }
          const payments = tx.select({ id: loanPayments.id }).from(loanPayments).where(and(
            eq(loanPayments.loanId, loan.id), eq(loanPayments.status, "posted"),
          )).all();
          if (payments.length > 0) throw new Error("Reverse derived loan payments before reversing this split bill");
        }
        const reversalTransactionId = insertDomainReversalSync(tx, transactionId, reversal.prepared, reason);
        for (const loan of derivedLoans) {
          tx.update(loans).set({ isActive: false, status: "cancelled", updatedAt: new Date() })
            .where(eq(loans.id, loan.id)).run();
          tx.insert(auditLogs).values({
            entityType: "loan",
            entityId: loan.id,
            action: "reverse",
            beforeSnapshot: Buffer.from(JSON.stringify(loan)),
            afterSnapshot: Buffer.from(JSON.stringify({ ...loan, isActive: false, status: "cancelled", reversalTransactionId, reason })),
          }).run();
        }
        return { reversalTransactionId, reversedLoanIds: derivedLoans.map((loan) => loan.id) };
      });
      await invalidateOnTransactionMutation({
        transactionId: result.reversalTransactionId,
        affectedAccountIds: reversal.prepared.accountIds,
        affectedPeriodIds: reversal.periodId == null ? undefined : [reversal.periodId],
        revisionBumped: true,
      });
      return reply.code(201).send(result);
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "Failed to reverse split bill" });
    }
  });

  fastify.get("/api/splitbill/history", {
    schema: { operationId: "listSplitBillHistory", tags: ["splitbill"], response: { 200: z.array(splitbillSessionSchema) } },
  }, async (request) => {
    const sessions = await db
      .select()
      .from(splitbillSessions)
      .orderBy(desc(splitbillSessions.createdAt))
      .limit(50);

    return sessions;
  });

  fastify.get<{ Params: { id: string } }>("/api/splitbill/:id", {
    schema: { operationId: "getSplitBillSession", tags: ["splitbill"], params: splitbillSessionIdParamsSchema, response: { 200: splitbillSessionSchema, 404: splitbillErrorSchema } },
  }, async (request, reply) => {
    const { id } = request.params;

    const [session] = await db
      .select()
      .from(splitbillSessions)
      .where(eq(splitbillSessions.id, parseInt(id)))
      .limit(1);

    if (!session) {
      reply.code(404).send({ error: "Session not found" });
      return;
    }

    return session;
  });
}
