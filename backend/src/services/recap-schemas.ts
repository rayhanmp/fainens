import { z } from "zod";

export const recapPeriodIdSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const recapPeriodSchema = z.object({ id: z.number().int().positive(), name: z.string(), startDate: z.number(), endDate: z.number() });
export const recapSchema = z.object({
  period: recapPeriodSchema, startMs: z.number(), endMs: z.number(), generatedAt: z.number(),
  isPartial: z.boolean(), coverageComplete: z.boolean(),
  income: z.number(), expenses: z.number(), net: z.number(),
  activityCount: z.number().int(), purchaseCount: z.number().int(), spendingDays: z.number().int(),
  purchaseProfile: z.object({ totalAmount: z.number().positive(), medianAmount: z.number().positive() }).nullable().optional(),
  highlights: z.object({
    averagePurchaseAmount: z.number().nonnegative().nullable(),
    peakSpendingDay: z.object({ date: z.number(), amount: z.number().positive(), purchaseCount: z.number().int().nonnegative() }).nullable(),
    topPurchases: z.array(z.object({ description: z.string(), amount: z.number().positive(), date: z.number(), category: z.string() })).max(3).optional(),
    repeatPurchases: z.array(z.object({ description: z.string(), occurrences: z.number().int().positive(), totalAmount: z.number().positive(), category: z.string() })).max(2).optional(),
  }).optional(),
  categories: z.array(z.object({ name: z.string(), amount: z.number() })),
  baseline: z.object({
    periodCount: z.number().int().min(1).max(3), matchedElapsed: z.boolean(),
    income: z.number(), expenses: z.number(), purchaseCount: z.number().nonnegative(), purchaseTotal: z.number().nonnegative().optional(),
  }).nullable().optional(),
  budget: z.object({
    planned: z.number().nonnegative(), spent: z.number(), remaining: z.number(), percentUsed: z.number().nullable(),
    categoryCount: z.number().int().nonnegative(), unbudgetedExpenses: z.number(), overBudgetCategoryCount: z.number().int().nonnegative(),
    overBudgetCategories: z.array(z.object({ name: z.string(), planned: z.number().nonnegative(), spent: z.number(), over: z.number().positive() })).max(3),
  }).nullable().optional(),
  largestPurchase: z.object({ description: z.string(), amount: z.number(), date: z.number() }).nullable(),
  comparison: z.object({ periodId: z.number().int().positive(), periodName: z.string(), previousExpenses: z.number(), changePercent: z.number() }).nullable(),
});
export const chapterIdSchema = z.enum(["intro", "overview", "budget", "categories", "spotlight", "variety", "rhythm", "purchases", "peak", "moment", "balance", "comparison", "closing"]);
export const recapCopySchema = z.object({
  shortLabels: z.record(z.string(), z.string().trim().min(1).max(28)).optional(),
  headline: z.string().min(1).max(80), deck: z.string().min(1).max(180),
  chapters: z.array(z.object({
    id: chapterIdSchema, eyebrow: z.string().min(1).max(48), title: z.string().min(1).max(100), body: z.string().min(1).max(260),
  })).min(3).max(13),
});
export const savedRecapStorySchema = z.object({
  personalization: z.object({ preferredName: z.string().nullable(), language: z.enum(["en", "id"]) }).optional(),
  snapshot: recapSchema, copy: recapCopySchema, savedAt: z.number(), source: z.enum(["ai", "template"]), seed: z.number().int().nonnegative(),
});
export type RecapCopy = z.infer<typeof recapCopySchema>;
export type SavedRecapStory = z.infer<typeof savedRecapStorySchema>;
