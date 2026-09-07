import { and, eq, gte, inArray, lte, ne, or, sql } from "drizzle-orm";

import { db } from "../db/client";
import { accounts, backgroundTasks, categories, forecastPurchaseReviews, salaryPeriods, transactionCategoryAllocations, transactions, transactionLines } from "../db/schema";
import { callOpenRouterAgent } from "./agent-llm";
import { getAgentProviderConfig } from "./agent-provider-config";
import { getFinancialRevision } from "./financial-revision";
import { getBudgetOutlook } from "./budget-outlook";
import { createBackgroundTask } from "./background-tasks";

export const BUDGET_REVIEW_PROMPT_VERSION = "budget-pattern-review.v1";

type ReviewDecision = {
  transactionId: number;
  periodId: number;
  categoryId: number;
  amount: number;
  classification: "one_off" | "unusual" | "recurring" | "normal" | "unknown";
  weight: number;
  confidence: number;
  rationale: string;
  evidencePeriodIds?: number[];
};

/** Only purchases that should change the historical baseline are flags.
 * Recurring, normal, and unknown purchases remain part of the ordinary
 * spending pattern even when their amount happens to be large. */
function isPatternFlag(classification: ReviewDecision["classification"]): classification is "one_off" | "unusual" {
  return classification === "one_off" || classification === "unusual";
}

type LargePurchase = {
  id: number;
  periodId: number;
  date: number;
  description: string;
  categoryId: number | null;
  category: string | null;
  amount: number;
};

async function findLargeHistoricalPurchases(outlook: Awaited<ReturnType<typeof getBudgetOutlook>>): Promise<LargePurchase[]> {
  if (outlook.categories.length === 0 || outlook.categories.every((row) => row.evidencePeriodIds.length === 0)) return [];
  const periodIds = [...new Set(outlook.categories.flatMap((row) => row.evidencePeriodIds))];
  if (periodIds.length === 0) return [];
  const rows = await db.select({
    id: transactions.id,
    periodId: salaryPeriods.id,
    date: transactions.date,
    description: transactions.description,
    categoryId: sql<number | null>`coalesce(${transactionCategoryAllocations.categoryId}, ${transactions.categoryId})`,
    category: categories.name,
    amount: sql<number>`coalesce(sum(case when ${accounts.type} = 'expense' then ${transactionLines.debit} - ${transactionLines.credit} else 0 end), 0)`,
  }).from(transactions)
    .innerJoin(salaryPeriods, and(
      inArray(salaryPeriods.id, periodIds),
      gte(transactions.date, sql`${salaryPeriods.startDate}`),
      lte(transactions.date, sql`${salaryPeriods.endDate} + 86400000 - 1`),
    ))
    .leftJoin(transactionLines, eq(transactionLines.transactionId, transactions.id))
    .leftJoin(accounts, eq(accounts.id, transactionLines.accountId))
    .leftJoin(transactionCategoryAllocations, eq(transactionCategoryAllocations.transactionId, transactions.id))
    .leftJoin(categories, eq(categories.id, sql`coalesce(${transactionCategoryAllocations.categoryId}, ${transactions.categoryId})`))
    .where(and(
      eq(transactions.status, "posted"),
      ne(transactions.txType, "reversal"),
      ne(transactions.txType, "domain_reversal"),
      ne(transactions.txType, "historical_recovery_adjustment"),
    ))
    .groupBy(transactions.id, salaryPeriods.id, transactions.date, transactions.description, transactions.categoryId, transactionCategoryAllocations.categoryId, categories.name)
    .orderBy(sql`coalesce(sum(case when ${accounts.type} = 'expense' then ${transactionLines.debit} - ${transactionLines.credit} else 0 end), 0) DESC`)
    .limit(200);
  // Candidate selection is deliberately broad. A purchase can be material
  // even when its category has historically high totals, so do not let the
  // category median hide it from the model review.
  const categoryScale = new Map(outlook.categories.map((row) => [row.categoryId, Math.max(300_000, row.plannedAmount * 0.5)] as const));
  const plannedCategoryIds = new Set(outlook.categories.map((row) => row.categoryId));
  return rows.map((row) => ({ ...row, id: Number(row.id), periodId: Number(row.periodId), date: Number(row.date), amount: Number(row.amount) }))
    .filter((row) => row.categoryId != null && plannedCategoryIds.has(row.categoryId) && row.amount >= (categoryScale.get(row.categoryId) ?? 1_000_000))
    .slice(0, 40);
}

function parseReview(content: unknown): ReviewDecision[] {
  if (typeof content !== "string") return [];
  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Some providers prepend a short sentence despite the JSON-only request.
    // Extract the first complete object rather than discarding an otherwise
    // valid, bounded response.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return [];
    try { parsed = JSON.parse(cleaned.slice(start, end + 1)); } catch { return []; }
  }
  if (!parsed || typeof parsed !== "object") return [];
  const payload = parsed as { purchaseReviews?: unknown; reviews?: unknown; classifications?: unknown };
  const entries = Array.isArray(payload.purchaseReviews)
    ? payload.purchaseReviews
    : Array.isArray(payload.reviews) ? payload.reviews : payload.classifications;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((value): ReviewDecision[] => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    const transactionId = Number(row.transactionId);
    const periodId = Number(row.periodId);
    const categoryId = Number(row.categoryId);
    const amount = Number(row.amount);
    const weight = Number(row.weight);
    const confidence = Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : 0.6;
    const classification = row.classification;
    const rationale = typeof row.rationale === "string" ? row.rationale.trim().slice(0, 500) : "";
    if (!Number.isInteger(transactionId) || !Number.isInteger(periodId) || !Number.isInteger(categoryId) || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(weight) || !Number.isFinite(confidence) || !rationale) return [];
    if (!["one_off", "unusual", "recurring", "normal", "unknown"].includes(String(classification))) return [];
    return [{
      transactionId,
      periodId,
      categoryId,
      amount,
      classification: classification as ReviewDecision["classification"],
      weight: Math.max(0.05, Math.min(1, weight)),
      confidence: Math.max(0, Math.min(1, confidence)),
      rationale,
      evidencePeriodIds: Array.isArray(row.evidencePeriodIds)
        ? row.evidencePeriodIds.filter((id): id is number => Number.isInteger(id)).slice(0, 12)
        : [],
    }];
  }).slice(0, 100);
}

/** Ask the model to classify only deterministic outlier candidates, then persist
 * the validated conclusion. Failure is intentionally non-fatal to forecasting. */
export async function requestBudgetOutlierReview(periodId: number, ownerEmail?: string | null) {
  const expectedRevision = await getFinancialRevision();
  const task = await createBackgroundTask({
    queueName: "fainens-agent",
    jobName: "budget-outlier-review",
    dedupeKey: `budget-outlier-review:${periodId}:${expectedRevision}:${BUDGET_REVIEW_PROMPT_VERSION}`,
    ownerEmail,
    subjectType: "salary_period",
    subjectId: periodId,
    payload: { periodId, expectedRevision, promptVersion: BUDGET_REVIEW_PROMPT_VERSION },
    maxAttempts: 3,
  });
  return { taskId: task.id, periodId, status: task.status, expectedRevision };
}

export async function reviewBudgetOutlook(periodId: number, options: { expectedRevision?: number; signal?: AbortSignal } = {}) {
  const providerConfig = await getAgentProviderConfig();
  if (!providerConfig.apiKey) return { applied: false, reason: "provider_unavailable", reviews: [] };
  if (options.expectedRevision != null && await getFinancialRevision() !== options.expectedRevision) {
    return { applied: false, reason: "stale_revision", reviews: [] };
  }
  const outlook = await getBudgetOutlook(periodId);
  const largePurchases = await findLargeHistoricalPurchases(outlook);
  const candidates = outlook.categories
    .filter((row) => row.outlierCount > 0 && row.historicalSampleCount >= 2)
    .map((row) => ({
      categoryId: row.categoryId,
      category: row.categoryName,
      plannedAmount: row.plannedAmount,
      actualAmount: row.actualAmount,
      historicalSampleCount: row.historicalSampleCount,
      outlierCount: row.outlierCount,
      evidencePeriodIds: row.evidencePeriodIds,
      historicalSampleAmounts: row.historicalSampleAmounts,
      currentProjection: row.projectedAmount,
      largePurchases: largePurchases.filter((purchase) => purchase.categoryId === row.categoryId).map((purchase) => ({ id: purchase.id, date: purchase.date, description: purchase.description, amount: purchase.amount, periodId: purchase.periodId })),
    }));
  const candidateCategoryIds = new Set(candidates.map((row) => row.categoryId));
  for (const purchase of largePurchases) {
    if (purchase.categoryId == null || candidateCategoryIds.has(purchase.categoryId)) continue;
    const row = outlook.categories.find((category) => category.categoryId === purchase.categoryId);
    if (!row) continue;
    candidateCategoryIds.add(row.categoryId);
    candidates.push({
      categoryId: row.categoryId,
      category: row.categoryName,
      plannedAmount: row.plannedAmount,
      actualAmount: row.actualAmount,
      historicalSampleCount: row.historicalSampleCount,
      outlierCount: row.outlierCount,
      evidencePeriodIds: row.evidencePeriodIds,
      historicalSampleAmounts: row.historicalSampleAmounts,
      currentProjection: row.projectedAmount,
      largePurchases: [purchase].map((item) => ({ id: item.id, date: item.date, description: item.description, amount: item.amount, periodId: item.periodId })),
    });
  }
  if (candidates.length === 0) return { applied: false, reason: "no_candidates", reviews: [], largePurchaseCount: largePurchases.length };

  const response = await callOpenRouterAgent({
    apiKey: providerConfig.apiKey,
    model: providerConfig.model,
    baseUrl: providerConfig.baseUrl,
    tools: [],
    signal: options.signal,
    messages: [
      { role: "system", content: "You review individually large historical purchases for a personal-finance forecast. Return JSON only, with no markdown and no chain-of-thought, in the shape {purchaseReviews:[{transactionId,periodId,categoryId,amount,classification,weight,confidence,rationale}]}. Only return supplied purchase IDs that are genuine pattern flags. Classify flagged purchases only as one_off or unusual. Do not return recurring subscriptions, normal purchases, or uncertain purchases at all, even if their amount is large. Those remain part of the ordinary baseline and are not attention items. weight is that individual purchase's influence in the deterministic historical sample: one_off usually 0.05-0.25 and unusual 0.25-0.6. A large purchase is not automatically a flag. Never invent facts. rationale must be one short evidence-based sentence." },
      { role: "user", content: JSON.stringify({ promptVersion: BUDGET_REVIEW_PROMPT_VERSION, periodId, candidates }) },
    ],
  });
  const decisions = parseReview(response.message.content);
  const validPurchases = new Map(largePurchases.map((purchase) => [purchase.id, purchase]));
  const revision = await getFinancialRevision();
  if (options.expectedRevision != null && revision !== options.expectedRevision) {
    return { applied: false, reason: "stale_revision", reviews: [] };
  }
  const reviews = decisions.filter((decision) => {
    // The model may still mention a recurring/normal purchase for context,
    // but those are explicitly not review flags and must not be persisted or
    // shown as attention items.
    if (!isPatternFlag(decision.classification)) return false;
    const purchase = validPurchases.get(decision.transactionId);
    return purchase != null && purchase.periodId === decision.periodId && purchase.categoryId === decision.categoryId && purchase.amount === decision.amount;
  });
  for (const review of reviews) {
    await db.insert(forecastPurchaseReviews).values({
      transactionId: review.transactionId,
      transactionDate: validPurchases.get(review.transactionId)?.date ?? 0,
      periodId: review.periodId,
      categoryId: review.categoryId,
      amount: review.amount,
      evidenceRevision: revision,
      classification: review.classification,
      weight: review.weight,
      confidence: review.confidence,
      rationale: review.rationale,
      model: providerConfig.model,
      promptVersion: BUDGET_REVIEW_PROMPT_VERSION,
      status: "active",
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: forecastPurchaseReviews.transactionId,
      set: {
        periodId: review.periodId,
        transactionDate: validPurchases.get(review.transactionId)?.date ?? 0,
        categoryId: review.categoryId,
        amount: review.amount,
        evidenceRevision: revision,
        classification: review.classification,
        weight: review.weight,
        confidence: review.confidence,
        rationale: review.rationale,
      model: providerConfig.model,
        promptVersion: BUDGET_REVIEW_PROMPT_VERSION,
        status: "active",
        updatedAt: new Date(),
      },
    });
  }
  return {
    applied: reviews.length > 0,
    reason: reviews.length > 0 ? "validated" : "invalid_provider_output",
    reviews,
    largePurchaseCount: largePurchases.length,
  };
}

export async function getBudgetReviewStatus(periodId: number) {
  const revision = await getFinancialRevision();
  const rows = await db.select({ transactionId: forecastPurchaseReviews.transactionId, periodId: forecastPurchaseReviews.periodId, categoryId: forecastPurchaseReviews.categoryId, amount: forecastPurchaseReviews.amount, classification: forecastPurchaseReviews.classification, weight: forecastPurchaseReviews.weight, userWeight: forecastPurchaseReviews.userWeight, confidence: forecastPurchaseReviews.confidence, rationale: forecastPurchaseReviews.rationale, evidenceRevision: forecastPurchaseReviews.evidenceRevision, status: forecastPurchaseReviews.status })
    .from(forecastPurchaseReviews)
    .where(and(
      eq(forecastPurchaseReviews.periodId, periodId),
      or(eq(forecastPurchaseReviews.status, "active"), eq(forecastPurchaseReviews.status, "user_override")),
      inArray(forecastPurchaseReviews.classification, ["one_off", "unusual"]),
    ));
  const task = (await db.select({ id: backgroundTasks.id, status: backgroundTasks.status, attempts: backgroundTasks.attempts, maxAttempts: backgroundTasks.maxAttempts, lastError: backgroundTasks.lastError, createdAt: backgroundTasks.createdAt, updatedAt: backgroundTasks.updatedAt, completedAt: backgroundTasks.completedAt })
    .from(backgroundTasks)
    .where(and(
      eq(backgroundTasks.jobName, "budget-outlier-review"),
      eq(backgroundTasks.subjectType, "salary_period"),
      eq(backgroundTasks.subjectId, String(periodId)),
    ))
    .orderBy(sql`${backgroundTasks.createdAt} DESC`).limit(1))[0] ?? null;
  return { periodId, evidenceRevision: revision, reviews: rows.map((row) => ({ ...row, isCurrent: row.evidenceRevision === revision })), task };
}
