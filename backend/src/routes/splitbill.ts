import { eq, desc } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client";
import { splitbillSessions, contacts, loans, accounts } from "../db/schema";
import { uploadFile, generatePresignedDownloadUrl } from "../services/r2";
import { callOpenRouterVision } from "../services/openrouter";
import { env } from "../lib/env";
import { createJournalEntry } from "../services/ledger";

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

async function createLoanFromSplit(
  contactId: number,
  direction: "lent" | "borrowed",
  amount: number,
  description: string,
  walletAccountId: number | undefined,
  expenseAmount: number,
  expenseCategoryName: string
) {
  const amountCents = amount * 100;
  const expenseAmountCents = expenseAmount * 100;
  const totalCashOutCents = amountCents + expenseAmountCents;

  const loansReceivable = await getOrCreateSystemAccount("loans-receivable", "Loans Receivable", "asset");
  const loansPayable = await getOrCreateSystemAccount("loans-payable", "Loans Payable", "liability");

  if (direction === "lent" && walletAccountId) {
    // Me paid → Cash goes out, record expense + loans receivable
    // Find or create expense category account
    const expenseAccount = await getOrCreateExpenseAccount(expenseCategoryName);

    await createJournalEntry({
      date: Date.now(),
      description,
      txType: "split_bill_lent",
      lines: [
        { accountId: loansReceivable.id, debit: amountCents, credit: 0 },
        { accountId: expenseAccount.id, debit: expenseAmountCents, credit: 0 },
        { accountId: walletAccountId, debit: 0, credit: totalCashOutCents },
      ],
    }, db);
  } else if (direction === "borrowed") {
    // Contact paid → I owe them, no cash impact, just create liability
    await createJournalEntry({
      date: Date.now(),
      description,
      txType: "split_bill_borrowed",
      lines: [
        { accountId: loansPayable.id, debit: 0, credit: amountCents },
      ],
    }, db);
  }

  const [loan] = await db
    .insert(loans)
    .values({
      contactId,
      direction,
      amountCents,
      remainingCents: amountCents,
      startDate: new Date(),
      status: "active",
      description,
      sourceType: "split_bill",
      walletAccountId: walletAccountId || null,
    })
    .returning();

  return loan;
}

async function getOrCreateExpenseAccount(categoryName: string): Promise<{ id: number }> {
  // Try to find existing account with this name
  const [existing] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.name, categoryName))
    .limit(1);

  if (existing) {
    return existing;
  }

  // Create new expense account
  const [created] = await db
    .insert(accounts)
    .values({
      name: categoryName,
      type: "expense",
      isActive: true,
    })
    .returning({ id: accounts.id });

  return created;
}

let systemAccountsCache: Record<string, { id: number }> = {};

async function getOrCreateSystemAccount(key: string, name: string, type: string): Promise<{ id: number }> {
  if (systemAccountsCache[key]) return systemAccountsCache[key];

  const [existing] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.systemKey, key))
    .limit(1);

  if (existing) {
    systemAccountsCache[key] = existing;
    return existing;
  }

  const [created] = await db
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

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.post<{ Body: { imageData: string; filename: string } }>(
    "/api/splitbill/scan",
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
          reply.code(500).send({ error: (err as Error).message || "Something went wrong while scanning. Please try again." });
          return;
        }

        reply.send({ parsed, r2Key: key });
      } catch (err) {
        console.error("Splitbill scan error:", err);
        reply.code(500).send({ error: (err as Error).message || "Failed to scan receipt. Please try again." });
      }
    }
  );

  fastify.post<{ Body: { items: ParsedReceiptItem[]; people: SplitBillPerson[]; assignments: ItemAssignment[]; tax: number; serviceFee: number; discount: number } }>(
    "/api/splitbill/calculate",
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
        reply.code(500).send({ error: (err as Error).message });
      }
    }
  );

  fastify.post<{ Body: { splitResults: PersonSplitResult[]; isBorrower: boolean; walletAccountId?: number; expenseCategory?: string } }>(
    "/api/splitbill/create-loans",
    async (request, reply) => {
      try {
        const { splitResults, isBorrower, walletAccountId, expenseCategory } = request.body;

        if (!splitResults) {
          reply.code(400).send({ error: "splitResults is required" });
          return;
        }

        if (!isBorrower && !walletAccountId) {
          reply.code(400).send({ error: "walletAccountId is required when you pay" });
          return;
        }

        const categoryName = expenseCategory || "Food & Dining";
        const createdLoans: typeof loans.$inferSelect[] = [];

        if (isBorrower) {
          // Contact paid → Create ONE loan FROM me TO the payer
          // The splitResults contains: { personId: 0, personName: "Me", total: myShare }
          const meResult = splitResults.find(r => r.personId === 0 && r.total > 0);
          if (meResult) {
            // Find who paid (the contact not in splitResults with personId !== 0)
            const payerResult = splitResults.find(r => r.personId !== 0);
            if (payerResult) {
              const loan = await createLoanFromSplit(
                payerResult.personId,
                "borrowed",
                meResult.total,
                `Borrowed from ${payerResult.personName} for split bill`,
                undefined, // no wallet impact
                0, // no expense for borrowed
                categoryName
              );
              createdLoans.push(loan);
            }
          }
        } else {
          // Me paid → Create loans FROM each contact TO me
          // personId = 0 is "Me", skip it
          // My share is an expense, rest is loans receivable
          const meResult = splitResults.find(r => r.personId === 0);
          const myExpense = meResult?.total || 0;

          for (const result of splitResults) {
            if (result.total <= 0) continue;
            if (result.personId === 0) continue; // Skip "me"

            const loan = await createLoanFromSplit(
              result.personId,
              "lent",
              result.total,
              `Lent to me for split bill`,
              walletAccountId!,
              myExpense, // My expense portion
              categoryName
            );

            createdLoans.push(loan);
          }
        }

        reply.code(201).send(createdLoans);
      } catch (err) {
        console.error("Create loans error:", err);
        reply.code(500).send({ error: (err as Error).message });
      }
    }
  );

  fastify.get("/api/splitbill/history", async (request) => {
    const sessions = await db
      .select()
      .from(splitbillSessions)
      .orderBy(desc(splitbillSessions.createdAt))
      .limit(50);

    return sessions;
  });

  fastify.get<{ Params: { id: string } }>("/api/splitbill/:id", async (request, reply) => {
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