import { callOpenRouter } from "./openrouter";
import { getAgentProviderConfig } from "./agent-provider-config";
import { parseIdrInteger } from "./money";

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
  /** Optional: source account name, when the message names one */
  fromAccount?: string;
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
  "fromAccount": "source account name if the message names one, or null",
  "toAccount": "for transfers only, or null",
  "confidence": 0.0-1.0
}

Rules:
- Parse the amount as IDR (Indonesian Rupiah)
- If no date provided, use null (will default to today)
- For transfers, use type "transfer" and specify fromAccount and toAccount when named
- Set confidence to 0.0-1.0 based on how clear the message is
- If unable to parse, return type: "unknown" with amount: 0 and confidence: 0

Respond ONLY with valid JSON, no explanation.`;

function unparsedTransaction(message: string): ParsedTransaction {
  return {
    type: "expense",
    amount: 0,
    description: message,
    category: "Others",
    confidence: 0,
  };
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Validate the model's JSON. A transfer stays a transfer (approval then needs
 * explicit accounts) instead of being booked as an expense, and an "unknown"
 * type or a missing/invalid amount is reported as a failed parse
 * (confidence 0) rather than a plausible-looking pending expense.
 */
export function normalizeParsedTransaction(value: unknown, message: string): ParsedTransaction {
  if (!value || typeof value !== "object" || Array.isArray(value)) return unparsedTransaction(message);
  const parsed = value as Record<string, unknown>;
  const type = parsed.type === "expense" || parsed.type === "income" || parsed.type === "transfer" ? parsed.type : null;
  const rawAmount = typeof parsed.amount === "number"
    ? parsed.amount
    : typeof parsed.amount === "string" ? parseIdrInteger(parsed.amount) : null;
  const amount = rawAmount != null && Number.isFinite(rawAmount) ? Math.floor(rawAmount) : 0;
  if (!type || !Number.isSafeInteger(amount) || amount <= 0) return unparsedTransaction(message);

  const confidence = typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
    ? Math.min(1, Math.max(0, parsed.confidence))
    : 0.5;
  return {
    type,
    amount,
    description: optionalText(parsed.description) ?? message.slice(0, 100),
    category: optionalText(parsed.category) ?? "Others",
    date: optionalText(parsed.date),
    place: optionalText(parsed.place),
    notes: optionalText(parsed.notes),
    fromAccount: optionalText(parsed.fromAccount),
    toAccount: optionalText(parsed.toAccount),
    confidence,
  };
}

export async function parseNaturalLanguageTransaction(message: string): Promise<ParsedTransaction> {
  const providerConfig = await getAgentProviderConfig();
  const apiKey = providerConfig.apiKey;
  
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY not configured");
  }

  const userPrompt = `Parse this transaction message: "${message}"`;

  const result = await callOpenRouter(SYSTEM_PROMPT, userPrompt, apiKey, providerConfig.model, providerConfig.baseUrl);

  try {
    // Try to extract JSON from the response
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }
    return normalizeParsedTransaction(JSON.parse(jsonMatch[0]), message);
  } catch (parseError) {
    console.error("Failed to parse LLM response:", result, parseError);
    return unparsedTransaction(message);
  }
}
