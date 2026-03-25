import { callOpenRouter } from "./openrouter";
import { env } from "../lib/env";

export interface ParsedTransaction {
  /** Transaction type: expense, income, transfer */
  type: "expense" | "income" | "transfer";
  /** Amount in IDR (whole number, not cents) */
  amount: number;
  /** Transaction description */
  description: string;
  /** Category name (will be matched to existing category) */
  category: string;
  /** Optional: date in YYYY-MM-DD format */
  date?: string;
  /** Optional: place/location */
  place?: string;
  /** Optional: notes */
  notes?: string;
  /** Optional: for transfers - destination account name */
  toAccount?: string;
  /** Confidence score 0-1 */
  confidence: number;
}

const SYSTEM_PROMPT = `You are a transaction parser for a personal finance app. Parse the user's message into a structured transaction.

Categories available (match as closely as possible):
- Food & Dining (makan, lunch, dinner, breakfast, food, restaurant, cafe)
- Transportation (bensin, gojek, grab, taxi, parkiran, tol)
- Shopping (belanja, grocery, supermarket)
- Entertainment (nonton, bioskop, streaming, game)
- Healthcare (dokter, obat, RS, clinic, bpjs)
- Utilities (listrik, air, internet, phone prepaid)
- Fashion (pakaian, shoes, tas)
- Gifts (hadiah, oleh-oleh)
- Subscriptions (langganan, netflix, spotify)
- Technology (gadget, internet)
- Hobbies (hobi, olahraga)
- Others (lainnya)
- Reconciliation (rekonsiliasi)
- Debts (utang, piutang)

Transaction types:
- expense: spending money
- income: receiving money (salary, selling, etc)
- transfer: moving money between accounts

Return JSON in this exact format:
{
  "type": "expense|income|transfer",
  "amount": number,
  "description": "brief description",
  "category": "category name",
  "date": "YYYY-MM-DD or null",
  "place": "location or null",
  "notes": "additional notes or null",
  "toAccount": "for transfers only, or null",
  "confidence": 0.0-1.0
}

Rules:
- Parse the amount as IDR (Indonesian Rupiah)
- If no date provided, use null (will default to today)
- For transfers, use type "transfer" and specify toAccount
- Set confidence to 0.0-1.0 based on how clear the message is
- If unable to parse, return type: "unknown" with amount: 0 and confidence: 0

Respond ONLY with valid JSON, no explanation.`;

export async function parseNaturalLanguageTransaction(message: string): Promise<ParsedTransaction> {
  const apiKey = env.OPENROUTER_API_KEY;
  
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY not configured");
  }

  const userPrompt = `Parse this transaction message: "${message}"`;

  const result = await callOpenRouter(SYSTEM_PROMPT, userPrompt, apiKey);

  try {
    // Try to extract JSON from the response
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }

    const parsed = JSON.parse(jsonMatch[0]) as ParsedTransaction;
    
    // Validate type
    const validTypes = ["expense", "income", "transfer"];
    if (!parsed.type || !validTypes.includes(parsed.type)) {
      parsed.type = "expense";
    }

    // Ensure required fields have defaults
    const finalType = parsed.type === "expense" ? "expense" : parsed.type === "income" ? "income" : "expense";
    return {
      type: finalType,
      amount: Math.max(0, Math.floor(parsed.amount || 0)),
      description: parsed.description || message.slice(0, 100),
      category: parsed.category || "Others",
      date: parsed.date || undefined,
      place: parsed.place || undefined,
      notes: parsed.notes || undefined,
      toAccount: parsed.toAccount || undefined,
      confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
    };
  } catch (parseError) {
    console.error("Failed to parse LLM response:", result, parseError);
    return {
      type: "expense",
      amount: 0,
      description: message,
      category: "Others",
      confidence: 0,
    };
  }
}