import { eq, and, asc, desc, sql, inArray, count, ne, notInArray, or, SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { db } from "../db/client";
import { transactions, transactionLines, transactionTags, transactionCategoryAllocations, tags, accounts, categories, auditLogs, salaryPeriods } from "../db/schema";
import {
  createJournalEntry,
  createSimpleTransaction,
  insertPreparedJournalEntrySync,
  prepareJournalEntry,
} from "../services/ledger";
import { invalidateOnTransactionMutation } from "../cache/invalidation";
import {
  deleteTransactionsAtomically,
  importTransactionsAtomically,
  TransactionMutationError,
  updateTransactionAtomically,
} from "../services/transaction-mutations";
import { processStorageDeletionOutbox } from "../services/storage-cleanup";
import { parseIdrInteger } from "../services/money";
import { findPeriodForDate, inclusivePeriodEnd } from "../services/period-locking";

// Pagination constants
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

const transactionErrorSchema = z.object({
  error: z.string().optional(),
  errors: z.array(z.string()).optional(),
}).passthrough();
const timestampValueSchema = z.union([z.date(), z.string(), z.number()]);
const transactionLineSchema = z.object({
  id: z.number().int().optional(),
  transactionId: z.number().int().optional(),
  accountId: z.number().int(),
  debit: z.number(),
  credit: z.number(),
  description: z.string().nullable().optional(),
  cashFlowClass: z.enum(["operating", "investing", "financing", "transfer", "recovery"]).nullable().optional(),
}).passthrough();
const transactionTagSchema = z.object({
  tagId: z.number().int(),
  name: z.string(),
  color: z.string(),
}).passthrough();
const transactionAllocationSchema = z.object({
  categoryId: z.number().int(),
  amount: z.number(),
  categoryName: z.string().nullable().optional(),
}).passthrough();
const transactionRecordSchema = z.object({
  id: z.number().int(),
  date: timestampValueSchema,
  description: z.string(),
  reference: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  place: z.string().nullable().optional(),
  txType: z.string().optional(),
  status: z.string().optional(),
  periodId: z.number().int().nullable().optional(),
  linkedTxId: z.number().int().nullable().optional(),
  reversalOfTxId: z.number().int().nullable().optional(),
  categoryId: z.number().int().nullable().optional(),
  dueDate: timestampValueSchema.nullable().optional(),
  createdAt: timestampValueSchema.optional(),
  debitCents: z.number().optional(),
  creditCents: z.number().optional(),
  expenseCents: z.number().optional(),
  incomeCents: z.number().optional(),
  lines: z.array(transactionLineSchema).optional(),
  tags: z.array(transactionTagSchema).optional(),
  categoryAllocations: z.array(transactionAllocationSchema).optional(),
}).passthrough();
const transactionListResponseSchema = z.object({
  data: z.array(transactionRecordSchema),
  pagination: z.object({
    total: z.number().int(),
    limit: z.number().int(),
    offset: z.number().int(),
    hasMore: z.boolean(),
  }).passthrough(),
  summary: z.object({ expenseCents: z.number(), incomeCents: z.number() }).passthrough(),
}).passthrough();
const transactionListQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  accountId: z.string().regex(/^\d+$/).optional(),
  txType: z.string().optional(),
  periodId: z.union([z.string().regex(/^\d+$/), z.literal("all")]).optional(),
  categoryId: z.string().regex(/^\d+$/).optional(),
  tagId: z.string().regex(/^\d+$/).optional(),
  search: z.string().max(120).optional(),
  kind: z.enum(["expense", "income", "transfer", "loan"]).optional(),
  minAmount: z.string().optional(),
  maxAmount: z.string().optional(),
  sort: z.enum(["newest", "oldest", "largest"]).optional(),
  includeReversals: z.enum(["true", "false"]).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  offset: z.string().regex(/^\d+$/).optional(),
});
const transactionIdParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const journalLineBodySchema = z.object({
  accountId: z.number().int().positive(),
  debit: z.number().int().nonnegative(),
  credit: z.number().int().nonnegative(),
  description: z.string().optional(),
  cashFlowClass: z.enum(["operating", "investing", "financing", "transfer", "recovery"]).nullable().optional(),
}).passthrough();
const simpleTransactionBodySchema = z.object({
  kind: z.enum(["expense", "income", "transfer"]),
  amountCents: z.number().int().positive(),
  description: z.string().trim().min(1),
  notes: z.string().nullable().optional(),
  place: z.string().nullable().optional(),
  date: z.string().min(1),
  periodId: z.number().int().positive().nullable().optional(),
  categoryId: z.number().int().positive().nullable().optional(),
  tagIds: z.array(z.number().int().positive()).optional(),
  walletAccountId: z.number().int().positive(),
  toWalletAccountId: z.number().int().positive().nullable().optional(),
  linkedTxId: z.number().int().positive().nullable().optional(),
  originLat: z.number().nullable().optional(),
  originLng: z.number().nullable().optional(),
  originName: z.string().nullable().optional(),
  destLat: z.number().nullable().optional(),
  destLng: z.number().nullable().optional(),
  destName: z.string().nullable().optional(),
  distanceKm: z.number().nonnegative().nullable().optional(),
  subscriptionId: z.number().int().positive().optional(),
}).passthrough();
const journalTransactionBodySchema = z.object({
  date: z.string().min(1),
  description: z.string().trim().min(1),
  reference: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  place: z.string().nullable().optional(),
  txType: z.literal("manual").optional(),
  periodId: z.number().int().positive().nullable().optional(),
  linkedTxId: z.number().int().positive().nullable().optional(),
  tagIds: z.array(z.number().int().positive()).optional(),
  categoryId: z.number().int().positive().nullable().optional(),
  categoryAllocations: z.array(z.object({ categoryId: z.number().int().positive(), amount: z.number().int() }).passthrough()).optional(),
  lines: z.array(journalLineBodySchema).min(2),
}).passthrough();
const transactionCreateBodySchema = z.union([simpleTransactionBodySchema, journalTransactionBodySchema]);
const transactionUpdateBodySchema = z.object({
  date: z.string().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  reference: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  place: z.string().nullable().optional(),
  txType: z.string().optional(),
  categoryId: z.number().int().positive().nullable().optional(),
  tagIds: z.array(z.number().int().positive()).optional(),
  lines: z.array(journalLineBodySchema).min(2).optional(),
}).passthrough();
const transactionMutationResponseSchema = z.object({ id: z.number().int(), transactionId: z.number().int().optional() }).passthrough();
const bulkDeleteResponseSchema = z.object({ success: z.literal(true), deletedCount: z.number().int(), message: z.string() }).passthrough();
const importPreviewBodySchema = z.object({
  csvText: z.string().min(1).max(2_000_000), mappings: z.record(z.string(), z.string()).default({}), hasHeader: z.boolean().default(true), accountId: z.number().int().positive(), dateFormat: z.string().min(1).max(40),
}).passthrough();
const importPreviewResponseSchema = z.object({
  preview: z.array(z.object({ rowNumber: z.number().int(), date: z.string().nullable(), amountCents: z.number().int(), description: z.string(), raw: z.record(z.string(), z.string()) }).passthrough()), totalRows: z.number().int().nonnegative(),
}).passthrough();
const legacyImportPreviewBodySchema = z.object({ csvText: z.string().min(1).max(2_000_000) }).passthrough();
const legacyImportPreviewRowSchema = z.object({
  rowNumber: z.number().int().positive(), date: z.string(), description: z.string(), amount: z.number().int(), type: z.enum(["expense", "income"]),
  accountName: z.string(), categoryName: z.string().nullable(), periodName: z.string(), notes: z.string().nullable(), reference: z.string().nullable(),
  isValid: z.boolean(), errors: z.array(z.string()), warnings: z.array(z.string()), accountMatched: z.boolean(), categoryMatched: z.boolean(), periodMatched: z.boolean(),
  accountId: z.number().int().positive().nullable(), categoryId: z.number().int().positive().nullable(), periodId: z.number().int().positive().nullable(),
}).passthrough();
const legacyImportPreviewResponseSchema = z.object({
  rows: z.array(legacyImportPreviewRowSchema),
  summary: z.object({ totalRows: z.number().int().nonnegative(), validRows: z.number().int().nonnegative(), warningRows: z.number().int().nonnegative(), errorRows: z.number().int().nonnegative(), totalIncome: z.number().int(), totalExpense: z.number().int(), uniqueAccounts: z.array(z.string()), uniqueCategories: z.array(z.string()), uniquePeriods: z.array(z.string()), missingAccounts: z.array(z.string()), missingCategories: z.array(z.string()), missingPeriods: z.array(z.string()) }).passthrough(),
  existingCategories: z.array(z.object({ id: z.number().int().positive(), name: z.string() }).passthrough()),
  existingAccounts: z.array(z.object({ id: z.number().int().positive(), name: z.string() }).passthrough()),
  existingPeriods: z.array(z.object({ id: z.number().int().positive(), name: z.string() }).passthrough()),
}).passthrough();
const importPreviewResponseUnionSchema = z.union([importPreviewResponseSchema, legacyImportPreviewResponseSchema]);
const importConfirmBodySchema = z.object({
  rows: z.array(z.object({ date: z.string().min(1), amountCents: z.number().int(), description: z.string() }).passthrough()).min(1).max(1000), accountId: z.number().int().positive(), defaultDescription: z.string().trim().min(1).max(500), tagIds: z.array(z.number().int().positive()).max(100).optional(),
}).passthrough();
const legacyImportConfirmBodySchema = z.object({
  rows: z.array(z.object({ date: z.string().min(1), description: z.string(), amount: z.number().int(), type: z.enum(["expense", "income"]), accountId: z.number().int().positive(), periodId: z.number().int().positive().nullable().optional(), categoryId: z.number().int().positive().nullable().optional(), notes: z.string().nullable().optional(), reference: z.string().nullable().optional() }).passthrough()).min(1).max(1000),
  categoryMappings: z.record(z.string(), z.number().int().positive().nullable()).optional(), accountMappings: z.record(z.string(), z.number().int().positive().nullable()).optional(), periodMappings: z.record(z.string(), z.number().int().positive().nullable()).optional(),
}).passthrough();
const importConfirmBodyUnionSchema = z.union([importConfirmBodySchema, legacyImportConfirmBodySchema]);
const importConfirmResponseSchema = z.object({ imported: z.number().int().nonnegative(), skipped: z.number().int().nonnegative().default(0), errors: z.array(z.object({ row: z.number().int().positive(), message: z.string() }).passthrough()).default([]), transactions: z.array(transactionMutationResponseSchema) }).passthrough();

type TransactionRouteErrorStatus = 400 | 404 | 409 | 500;
function transactionRouteErrorStatus(status: number): TransactionRouteErrorStatus {
  return status === 400 || status === 404 || status === 409 || status === 500 ? status : 500;
}

// Helper to find period ID based on transaction date
async function findPeriodIdForDate(dateMs: number): Promise<number | null> {
  return (await findPeriodForDate(dateMs))?.id ?? null;
}

// Transaction columns selection - shared across all queries to avoid duplication
const transactionColumns = {
  id: transactions.id,
  date: transactions.date,
  dueDate: transactions.dueDate,
  description: transactions.description,
  reference: transactions.reference,
  notes: transactions.notes,
  place: transactions.place,
  txType: transactions.txType,
  status: transactions.status,
  periodId: transactions.periodId,
  linkedTxId: transactions.linkedTxId,
  reversalOfTxId: transactions.reversalOfTxId,
  categoryId: transactions.categoryId,
  installmentMonths: transactions.installmentMonths,
  interestRatePercent: transactions.interestRatePercent,
  adminFeeCents: transactions.adminFeeCents,
  totalInstallments: transactions.totalInstallments,
  originLat: transactions.originLat,
  originLng: transactions.originLng,
  originName: transactions.originName,
  destLat: transactions.destLat,
  destLng: transactions.destLng,
  destName: transactions.destName,
  distanceKm: transactions.distanceKm,
  createdAt: transactions.createdAt,
} as const;

// Validation helpers
function validatePagination(limit: string, offset: string): { limit: number; offset: number; error?: string } {
  const parsedLimit = parseInt(limit, 10);
  const parsedOffset = parseInt(offset, 10);

  if (isNaN(parsedLimit) || parsedLimit < 1) {
    return { limit: DEFAULT_LIMIT, offset: 0, error: "Limit must be a positive integer" };
  }

  if (isNaN(parsedOffset) || parsedOffset < 0) {
    return { limit: parsedLimit, offset: 0, error: "Offset must be a non-negative integer" };
  }

  // Enforce maximum limit to prevent resource exhaustion
  const clampedLimit = Math.min(parsedLimit, MAX_LIMIT);

  return { limit: clampedLimit, offset: parsedOffset };
}

function validateDate(dateStr: string): number | null {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    return null;
  }
  return date.getTime();
}

function parseIdParam(value: string | undefined): number | null {
  if (!value || value === "undefined") return null;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? null : parsed;
}

function normalizeImportHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function firstImportValue(row: Record<string, string>, aliases: string[]): string {
  for (const alias of aliases) {
    const value = row[normalizeImportHeader(alias)];
    if (value != null && value.trim() !== "") return value.trim();
  }
  return "";
}

function parseLegacyImportDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // CSV exports commonly use DD/MM/YYYY. Parse that shape explicitly before
  // handing the value to the runtime parser, whose locale-independent
  // interpretation of slash dates is MM/DD/YYYY.
  if (/^\d{1,2}[\\/.\-]\d{1,2}[\\/.\-]\d{4}$/.test(trimmed)) {
    const parsed = parseDateWithFormat(trimmed, "DD/MM/YYYY");
    if (parsed) return new Date(`${parsed}T00:00:00.000Z`).toISOString();
  }
  const iso = new Date(trimmed);
  if (Number.isFinite(iso.getTime())) return iso.toISOString();
  return null;
}

async function buildLegacyImportPreview(csvText: string) {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new TransactionMutationError("CSV must include a header and at least one data row", 400);
  if (lines.length - 1 > 1000) throw new TransactionMutationError("Import must contain no more than 1000 rows", 400);

  const headers = parseCSVLine(lines[0]).map(normalizeImportHeader);
  const existingAccounts = await db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(and(eq(accounts.type, "asset"), eq(accounts.isActive, true)));
  const existingCategories = await db.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.isActive, true));
  const existingPeriods = await db.select({ id: salaryPeriods.id, name: salaryPeriods.name, startDate: salaryPeriods.startDate, endDate: salaryPeriods.endDate, status: salaryPeriods.status }).from(salaryPeriods);
  const accountsByName = new Map(existingAccounts.map((account) => [account.name.trim().toLowerCase(), account]));
  const categoriesByName = new Map(existingCategories.map((category) => [category.name.trim().toLowerCase(), category]));
  const periodsByName = new Map(existingPeriods.map((period) => [period.name.trim().toLowerCase(), period]));

  const rows = lines.slice(1).map((line, index) => {
    const values = parseCSVLine(line);
    const raw: Record<string, string> = {};
    headers.forEach((header, valueIndex) => { raw[header] = values[valueIndex] ?? ""; });
    const dateRaw = firstImportValue(raw, ["date", "transaction date", "when"]);
    const amountRaw = firstImportValue(raw, ["amount", "value", "total"]);
    const description = firstImportValue(raw, ["description", "transaction", "name", "memo"]);
    const accountName = firstImportValue(raw, ["account", "account name", "wallet", "payment account"]);
    const categoryNameRaw = firstImportValue(raw, ["category", "category name"]);
    const periodNameRaw = firstImportValue(raw, ["period", "period name", "month"]);
    const typeRaw = firstImportValue(raw, ["type", "transaction type"]).toLowerCase();
    const notes = firstImportValue(raw, ["notes", "note"]) || null;
    const reference = firstImportValue(raw, ["reference", "ref"]) || null;
    const parsedAmount = parseRupiah(amountRaw);
    const date = parseLegacyImportDate(dateRaw);
    const type = typeRaw === "income" ? "income" : "expense" as const;
    const account = accountsByName.get(accountName.toLowerCase());
    const category = categoryNameRaw ? categoriesByName.get(categoryNameRaw.toLowerCase()) : undefined;
    const namedPeriod = periodNameRaw ? periodsByName.get(periodNameRaw.toLowerCase()) : undefined;
    const dateMs = date ? new Date(date).getTime() : NaN;
    const inferredPeriod = !namedPeriod && Number.isFinite(dateMs)
      ? existingPeriods.find((period) => dateMs >= Number(period.startDate) && dateMs <= inclusivePeriodEnd(Number(period.endDate)))
      : undefined;
    const period = namedPeriod ?? inferredPeriod;
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!date) errors.push("Invalid date");
    if (parsedAmount == null || parsedAmount === 0) errors.push("Amount must be a non-zero integer rupiah value");
    if (!description) errors.push("Description is required");
    if (!account) errors.push("Account not found");
    if (!typeRaw) errors.push("Type is required");
    if (typeRaw && typeRaw !== "expense" && typeRaw !== "income") errors.push("Type must be expense or income");
    if (categoryNameRaw && !category) warnings.push("Category not found; choose one before importing");
    if (periodNameRaw && !namedPeriod) warnings.push("Period not found; the period will be inferred from the date");
    if (!period) warnings.push("No matching period; the transaction will remain unassigned");
    const normalizedType = typeRaw === "income" ? "income" : "expense";
    const amount = parsedAmount == null ? 0 : Math.abs(parsedAmount);
    return {
      rowNumber: index + 2,
      date: date ?? "",
      description,
      amount,
      type: normalizedType,
      accountName,
      categoryName: categoryNameRaw || null,
      periodName: period?.name ?? periodNameRaw,
      notes,
      reference,
      isValid: errors.length === 0,
      errors,
      warnings,
      accountMatched: !!account,
      categoryMatched: !categoryNameRaw || !!category,
      periodMatched: !!period,
      accountId: account?.id ?? null,
      categoryId: category?.id ?? null,
      periodId: period?.id ?? null,
    };
  });

  const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
  return {
    rows,
    summary: {
      totalRows: rows.length,
      validRows: rows.filter((row) => row.isValid).length,
      warningRows: rows.filter((row) => row.warnings.length > 0 && row.isValid).length,
      errorRows: rows.filter((row) => row.errors.length > 0).length,
      totalIncome: rows.filter((row) => row.type === "income").reduce((sum, row) => sum + row.amount, 0),
      totalExpense: rows.filter((row) => row.type === "expense").reduce((sum, row) => sum + row.amount, 0),
      uniqueAccounts: unique(rows.map((row) => row.accountName)),
      uniqueCategories: unique(rows.map((row) => row.categoryName ?? "")),
      uniquePeriods: unique(rows.map((row) => row.periodName)),
      missingAccounts: unique(rows.filter((row) => !row.accountMatched).map((row) => row.accountName)),
      missingCategories: unique(rows.filter((row) => row.categoryName && !row.categoryMatched).map((row) => row.categoryName ?? "")),
      missingPeriods: unique(rows.filter((row) => row.periodName && !row.periodMatched).map((row) => row.periodName)),
    },
    existingCategories,
    existingAccounts,
    existingPeriods: existingPeriods.map(({ id, name }) => ({ id, name })),
  };
}

// Build base WHERE conditions for date range, txType, and periodId
function buildBaseConditions(
  startDate?: string,
  endDate?: string,
  txType?: string,
  periodId?: string,
  categoryId?: string
): { conditions: SQL[]; errors: string[] } {
  const conditions: SQL[] = [];
  const errors: string[] = [];

  if (startDate) {
    const startTime = validateDate(startDate);
    if (startTime === null) {
      errors.push("Invalid startDate format");
    } else {
      conditions.push(sql`${transactions.date} >= ${startTime}`);
    }
  }

  if (endDate) {
    const endTime = validateDate(endDate);
    if (endTime === null) {
      errors.push("Invalid endDate format");
    } else {
      conditions.push(sql`${transactions.date} <= ${endTime}`);
    }
  }

  if (txType) {
    conditions.push(eq(transactions.txType, txType));
  }

  const parsedPeriodId = parseIdParam(periodId);
  if (parsedPeriodId !== null) {
    conditions.push(eq(transactions.periodId, parsedPeriodId));
  }

  const parsedCategoryId = parseIdParam(categoryId);
  if (parsedCategoryId !== null) {
    // A category can be the legacy/simple primary category or one of the
    // explicit allocations on a multi-category journal.
    conditions.push(or(
      eq(transactions.categoryId, parsedCategoryId),
      sql`exists (select 1 from transaction_category_allocation allocation_filter where allocation_filter.transaction_id = ${transactions.id} and allocation_filter.category_id = ${parsedCategoryId})`,
    )!);
  }

  return { conditions, errors };
}

function activityKindCondition(kind: string): SQL | null {
  if (kind === "expense") {
    return sql`exists (select 1 from transaction_line kind_line inner join account kind_account on kind_account.id = kind_line.account_id where kind_line.transaction_id = ${transactions.id} and kind_account.type = 'expense' and kind_line.debit > kind_line.credit)`;
  }
  if (kind === "income") {
    return sql`exists (select 1 from transaction_line kind_line inner join account kind_account on kind_account.id = kind_line.account_id where kind_line.transaction_id = ${transactions.id} and kind_account.type = 'revenue' and kind_line.credit > kind_line.debit)`;
  }
  if (kind === "transfer") return sql`${transactions.txType} in ('simple_transfer', 'transfer')`;
  if (kind === "loan") return sql`${transactions.txType} like '%loan%'`;
  return null;
}

/** The largest journal line is a display/filter convenience, not a statement calculation. */
const transactionDisplayAmount = sql<number>`coalesce((select max(case when amount_line.debit > amount_line.credit then amount_line.debit else amount_line.credit end) from transaction_line amount_line where amount_line.transaction_id = ${transactions.id}), 0)`;

// Fetch transaction details (lines and tags) in bulk to avoid N+1
async function fetchTransactionDetails(txIds: number[]) {
  if (txIds.length === 0) {
    return { linesByTxId: new Map(), tagsByTxId: new Map(), allocationsByTxId: new Map() };
  }

  // Fetch all lines for these transactions in one query
  const allLines = await db
    .select({
      id: transactionLines.id,
      transactionId: transactionLines.transactionId,
      accountId: transactionLines.accountId,
      debit: transactionLines.debit,
      credit: transactionLines.credit,
      description: transactionLines.description,
      cashFlowClass: transactionLines.cashFlowClass,
      // Keep account labels available for historical journals even after an
      // account is archived and omitted from the active account list.
      accountName: accounts.name,
      accountType: accounts.type,
      accountSystemKey: accounts.systemKey,
    })
    .from(transactionLines)
    .leftJoin(accounts, eq(transactionLines.accountId, accounts.id))
    .where(inArray(transactionLines.transactionId, txIds));

  // Fetch all tags for these transactions in one query
  const allTags = await db
    .select({
      transactionId: transactionTags.transactionId,
      tagId: transactionTags.tagId,
      name: tags.name,
      color: tags.color,
    })
    .from(transactionTags)
    .innerJoin(tags, eq(transactionTags.tagId, tags.id))
    .where(inArray(transactionTags.transactionId, txIds));

  const allAllocations = await db
    .select({
      transactionId: transactionCategoryAllocations.transactionId,
      categoryId: transactionCategoryAllocations.categoryId,
      amount: transactionCategoryAllocations.amount,
      categoryName: categories.name,
    })
    .from(transactionCategoryAllocations)
    .innerJoin(categories, eq(transactionCategoryAllocations.categoryId, categories.id))
    .where(inArray(transactionCategoryAllocations.transactionId, txIds));

  // Group by transaction ID
  const linesByTxId = new Map<number, typeof allLines>();
  const tagsByTxId = new Map<number, typeof allTags>();
  const allocationsByTxId = new Map<number, typeof allAllocations>();

  for (const line of allLines) {
    const existing = linesByTxId.get(line.transactionId) || [];
    existing.push(line);
    linesByTxId.set(line.transactionId, existing);
  }

  for (const tag of allTags) {
    const existing = tagsByTxId.get(tag.transactionId) || [];
    existing.push(tag);
    tagsByTxId.set(tag.transactionId, existing);
  }

  for (const allocation of allAllocations) {
    const existing = allocationsByTxId.get(allocation.transactionId) || [];
    existing.push(allocation);
    allocationsByTxId.set(allocation.transactionId, existing);
  }

  return { linesByTxId, tagsByTxId, allocationsByTxId };
}

// Return accounting effects once per journal, rather than making clients infer
// an amount from whichever line happens to be largest. These facets are used
// for display/filtering only; statements still come from the report read model.
async function fetchTransactionEffects(txIds: number[]) {
  if (txIds.length === 0) return new Map<number, { debitCents: number; creditCents: number; expenseCents: number; incomeCents: number }>();
  const rows = await db
    .select({
      transactionId: transactionLines.transactionId,
      debitCents: sql<number>`coalesce(sum(${transactionLines.debit}), 0)`,
      creditCents: sql<number>`coalesce(sum(${transactionLines.credit}), 0)`,
      expenseCents: sql<number>`coalesce(sum(case when ${accounts.type} = 'expense' then ${transactionLines.debit} - ${transactionLines.credit} else 0 end), 0)`,
      incomeCents: sql<number>`coalesce(sum(case when ${accounts.type} = 'revenue' then ${transactionLines.credit} - ${transactionLines.debit} else 0 end), 0)`,
    })
    .from(transactionLines)
    .innerJoin(accounts, eq(transactionLines.accountId, accounts.id))
    .where(inArray(transactionLines.transactionId, txIds))
    .groupBy(transactionLines.transactionId);
  return new Map(rows.map((row) => [row.transactionId, {
    debitCents: Number(row.debitCents ?? 0),
    creditCents: Number(row.creditCents ?? 0),
    expenseCents: Number(row.expenseCents ?? 0),
    incomeCents: Number(row.incomeCents ?? 0),
  }]));
}

export default async function (fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.post("/api/transactions/recommend-category", {
    schema: {
      operationId: "recommendTransactionCategory",
      tags: ["transactions"],
      body: z.object({ name: z.string().trim().min(2) }).passthrough(),
      response: {
        200: z.object({ categoryId: z.number().int(), categoryName: z.string() }).passthrough(),
        400: transactionErrorSchema,
        500: transactionErrorSchema,
      },
    },
  }, async (request, reply) => {
    const { name } = request.body as { name?: string };
    
    if (!name || name.trim().length < 2) {
      reply.code(400).send({ error: "Transaction name is required (min 2 characters)" });
      return;
    }

    const allCategories = await db.select().from(categories);
    
    if (allCategories.length === 0) {
      reply.code(500).send({ error: "No categories found in database" });
      return;
    }

    const categoryList = allCategories.map(c => `${c.icon || ''} ${c.name}`).join('\n');
    const systemPrompt = `You are a transaction categorizer. Given a transaction name/description, recommend the most appropriate category from the list below.
    
CATEGORIES:
${categoryList}

RULES:
- Return ONLY the exact category name (without icon) that best matches the transaction
- If uncertain, choose "Others"
- Do not explain your choice, just return the category name
- Match based on the main purpose of the transaction`;

    const userPrompt = `Transaction: "${name.trim()}"`;

    try {
      const { callOpenRouter } = await import('../services/openrouter');
      const { env } = await import('../lib/env');
      const apiKey = env.OPENROUTER_API_KEY;
      
      if (!apiKey) {
        reply.code(500).send({ error: "OpenRouter API key not configured" });
        return;
      }

      const recommendedName = await callOpenRouter(systemPrompt, userPrompt, apiKey);
      const matchedCategory = allCategories.find(
        c => c.name.toLowerCase() === recommendedName.trim().toLowerCase()
      );

      if (!matchedCategory) {
        const othersCategory = allCategories.find(c => c.name.toLowerCase() === 'others');
        if (othersCategory) {
          return { categoryId: othersCategory.id, categoryName: othersCategory.name };
        }
        return { categoryId: allCategories[0].id, categoryName: allCategories[0].name };
      }

      return { categoryId: matchedCategory.id, categoryName: matchedCategory.name };
    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({ error: "Failed to get category recommendation" });
    }
  });

  fastify.get("/api/transactions", {
    schema: {
      operationId: "listTransactions",
      tags: ["transactions"],
      querystring: transactionListQuerySchema,
      response: { 200: transactionListResponseSchema, 400: transactionErrorSchema },
    },
  }, async (request, reply) => {
    const {
      startDate,
      endDate,
      accountId,
      txType,
      periodId,
      categoryId,
      tagId,
      search,
      kind,
      minAmount,
      maxAmount,
      sort = "newest",
      includeReversals: includeReversalsParam,
      limit: limitParam = String(DEFAULT_LIMIT),
      offset: offsetParam = "0",
    } = request.query as {
      startDate?: string;
      endDate?: string;
      accountId?: string;
      txType?: string;
      periodId?: string;
      categoryId?: string;
      tagId?: string;
      search?: string;
      kind?: string;
      minAmount?: string;
      maxAmount?: string;
      sort?: "newest" | "oldest" | "largest";
      includeReversals?: string;
      limit?: string;
      offset?: string;
    };

    // Validate pagination parameters
    const { limit, offset, error: paginationError } = validatePagination(limitParam, offsetParam);
    if (paginationError) {
      reply.code(400).send({ error: paginationError });
      return;
    }

    // Build base conditions
    let periodIdToUse = periodId;
    
    // If periodId is "all", don't filter by period
    if (periodIdToUse === 'all') {
      periodIdToUse = undefined;
    }
    // If no periodId is provided AND no date range is specified, default to current period
    else if (!periodIdToUse && !startDate && !endDate) {
      const currentPeriod = await findPeriodForDate(Date.now());
      
      if (currentPeriod) {
        periodIdToUse = String(currentPeriod.id);
      }
    }
    
    const { conditions: baseConditions, errors: validationErrors } = buildBaseConditions(
      startDate,
      endDate,
      txType,
      periodIdToUse,
      categoryId
    );

    // The regular Transactions surface represents user activity, not the
    // internal bookkeeping mechanics of correcting a posted journal. Keep
    // inverse journals and their superseded originals out of the default
    // feed, while allowing audit/history consumers to opt in explicitly.
    if (includeReversalsParam !== "true") {
      baseConditions.push(
        notInArray(transactions.txType, ["reversal", "domain_reversal", "historical_recovery_adjustment"]),
        ne(transactions.status, "reversed"),
      );
    }

    if (validationErrors.length > 0) {
      reply.code(400).send({ errors: validationErrors });
      return;
    }

    const parsedAccountId = parseIdParam(accountId);
    const parsedTagId = parseIdParam(tagId);
    if (parsedAccountId !== null) {
      baseConditions.push(sql`exists (select 1 from transaction_line account_filter where account_filter.transaction_id = ${transactions.id} and account_filter.account_id = ${parsedAccountId})`);
    }
    if (parsedTagId !== null) {
      baseConditions.push(sql`exists (select 1 from transaction_tag tag_filter where tag_filter.transaction_id = ${transactions.id} and tag_filter.tag_id = ${parsedTagId})`);
    }

    const normalizedSearch = search?.trim().toLowerCase();
    if (normalizedSearch) {
      if (normalizedSearch.length > 120) return reply.code(400).send({ error: "search must be 120 characters or fewer" });
      const searchPattern = `%${normalizedSearch}%`;
      baseConditions.push(sql`(
        lower(${transactions.description}) like ${searchPattern}
        or lower(coalesce(${transactions.notes}, '')) like ${searchPattern}
        or lower(coalesce(${transactions.place}, '')) like ${searchPattern}
        or lower(coalesce(${transactions.reference}, '')) like ${searchPattern}
        or exists (select 1 from transaction_tag search_tag inner join tag search_tag_name on search_tag_name.id = search_tag.tag_id where search_tag.transaction_id = ${transactions.id} and lower(search_tag_name.name) like ${searchPattern})
        or exists (select 1 from transaction_category_allocation search_allocation inner join category search_category on search_category.id = search_allocation.category_id where search_allocation.transaction_id = ${transactions.id} and lower(search_category.name) like ${searchPattern})
      )`);
    }

    if (kind) {
      const kindCondition = activityKindCondition(kind);
      if (!kindCondition) return reply.code(400).send({ error: "kind must be expense, income, transfer, or loan" });
      baseConditions.push(kindCondition);
    }

    const parsedMinAmount = minAmount == null || minAmount === "" ? null : Number(minAmount);
    const parsedMaxAmount = maxAmount == null || maxAmount === "" ? null : Number(maxAmount);
    if ((parsedMinAmount != null && (!Number.isSafeInteger(parsedMinAmount) || parsedMinAmount < 0)) || (parsedMaxAmount != null && (!Number.isSafeInteger(parsedMaxAmount) || parsedMaxAmount < 0))) {
      return reply.code(400).send({ error: "minAmount and maxAmount must be non-negative whole rupiah amounts" });
    }
    if (parsedMinAmount != null && parsedMaxAmount != null && parsedMinAmount > parsedMaxAmount) {
      return reply.code(400).send({ error: "minAmount cannot exceed maxAmount" });
    }
    if (parsedMinAmount != null) baseConditions.push(sql`${transactionDisplayAmount} >= ${parsedMinAmount}`);
    if (parsedMaxAmount != null) baseConditions.push(sql`${transactionDisplayAmount} <= ${parsedMaxAmount}`);
    if (!['newest', 'oldest', 'largest'].includes(sort)) return reply.code(400).send({ error: "sort must be newest, oldest, or largest" });

    type TransactionRow = {
      id: number;
      date: Date;
      dueDate: Date | null;
      description: string;
      reference: string | null;
      notes: string | null;
      place: string | null;
      txType: string;
      status: string;
      periodId: number | null;
      linkedTxId: number | null;
      reversalOfTxId: number | null;
      categoryId: number | null;
      installmentMonths: number | null;
      interestRatePercent: number | null;
      adminFeeCents: number | null;
      totalInstallments: number | null;
      originLat: number | null;
      originLng: number | null;
      originName: string | null;
      destLat: number | null;
      destLng: number | null;
      destName: string | null;
      distanceKm: number | null;
      createdAt: Date;
    };

    const whereCondition = baseConditions.length > 0 ? and(...baseConditions) : undefined;
    const [countRows, summaryRows] = await Promise.all([
      db.select({ count: count() }).from(transactions).where(whereCondition || sql`1=1`),
      db.select({
        expenseCents: sql<number>`coalesce(sum(case when ${accounts.type} = 'expense' then ${transactionLines.debit} - ${transactionLines.credit} else 0 end), 0)`,
        incomeCents: sql<number>`coalesce(sum(case when ${accounts.type} = 'revenue' then ${transactionLines.credit} - ${transactionLines.debit} else 0 end), 0)`,
      }).from(transactions).innerJoin(transactionLines, eq(transactions.id, transactionLines.transactionId)).innerJoin(accounts, eq(transactionLines.accountId, accounts.id)).where(whereCondition || sql`1=1`),
    ]);
    const totalCount = countRows[0]?.count || 0;
    const orderBy = sort === 'oldest'
      ? [asc(transactions.date), asc(transactions.id)]
      : sort === 'largest'
        ? [desc(transactionDisplayAmount), desc(transactions.date), desc(transactions.id)]
        : [desc(transactions.date), desc(transactions.id)];
    const txList = await db.select(transactionColumns).from(transactions).where(whereCondition).orderBy(...orderBy).limit(limit).offset(offset) as unknown as TransactionRow[];

    // Fetch transaction details efficiently (bulk query, no N+1)
    const txIds = txList.map((tx) => tx.id).filter(Boolean);
    const { linesByTxId, tagsByTxId, allocationsByTxId } = await fetchTransactionDetails(txIds);
    const effectsByTxId = await fetchTransactionEffects(txIds);

    // Map transactions with their details
    const transactionsWithDetails = txList.map((tx) => ({
      ...tx,
      lines: linesByTxId.get(tx.id) || [],
      tags: tagsByTxId.get(tx.id) || [],
      categoryAllocations: allocationsByTxId.get(tx.id) || [],
      ...(effectsByTxId.get(tx.id) || { debitCents: 0, creditCents: 0, expenseCents: 0, incomeCents: 0 }),
    }));

    return {
      data: transactionsWithDetails,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: offset + txList.length < totalCount,
      },
      summary: {
        expenseCents: Number(summaryRows[0]?.expenseCents ?? 0),
        incomeCents: Number(summaryRows[0]?.incomeCents ?? 0),
      },
    };
  });

  fastify.get("/api/transactions/:id", {
    schema: {
      operationId: "getTransaction",
      tags: ["transactions"],
      params: transactionIdParamsSchema,
      response: { 200: transactionRecordSchema, 400: transactionErrorSchema, 404: transactionErrorSchema },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsedId = parseInt(id, 10);

    if (isNaN(parsedId)) {
      reply.code(400).send({ error: "Invalid transaction ID" });
      return;
    }

    const [tx] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, parsedId))
      .limit(1);

    if (!tx) {
      reply.code(404).send({ error: "Transaction not found" });
      return;
    }

    const lines = await db
      .select()
      .from(transactionLines)
      .where(eq(transactionLines.transactionId, tx.id));
    const effects = (await fetchTransactionEffects([tx.id])).get(tx.id) || {
      debitCents: 0,
      creditCents: 0,
      expenseCents: 0,
      incomeCents: 0,
    };

    const txTagRows = await db
      .select({ tagId: transactionTags.tagId, name: tags.name, color: tags.color })
      .from(transactionTags)
      .innerJoin(tags, eq(transactionTags.tagId, tags.id))
      .where(eq(transactionTags.transactionId, tx.id));

    const categoryAllocationRows = await db
      .select({
        categoryId: transactionCategoryAllocations.categoryId,
        amount: transactionCategoryAllocations.amount,
        categoryName: categories.name,
      })
      .from(transactionCategoryAllocations)
      .innerJoin(categories, eq(transactionCategoryAllocations.categoryId, categories.id))
      .where(eq(transactionCategoryAllocations.transactionId, tx.id));

    return {
      ...tx,
      lines,
      tags: txTagRows,
      categoryAllocations: categoryAllocationRows,
      ...effects,
    };
  });

  fastify.post("/api/transactions", {
    schema: {
      operationId: "createTransaction",
      tags: ["transactions"],
      body: transactionCreateBodySchema,
      response: { 201: transactionMutationResponseSchema, 400: transactionErrorSchema, 409: transactionErrorSchema },
    },
  }, async (request, reply) => {
    const body = request.body as
      | {
          date: string;
          description: string;
          reference?: string | null;
          notes?: string | null;
          place?: string | null;
          txType?: string;
          periodId?: number | null;
          linkedTxId?: number | null;
          tagIds?: number[];
          categoryId?: number | null;
          categoryAllocations?: Array<{ categoryId: number; amount: number }>;
          lines: Array<{
            accountId: number;
            debit: number;
            credit: number;
            description?: string;
            cashFlowClass?: "operating" | "investing" | "financing" | "transfer" | "recovery" | null;
          }>;
        }
      | {
          kind: "expense" | "income" | "transfer";
          amountCents: number;
          description: string;
          notes?: string | null;
          place?: string | null;
          date: string;
          periodId?: number | null;
          categoryId?: number | null;
          tagIds?: number[];
          walletAccountId: number;
          toWalletAccountId?: number | null;
          linkedTxId?: number | null;
          originLat?: number | null;
          originLng?: number | null;
          originName?: string | null;
          destLat?: number | null;
          destLng?: number | null;
          destName?: string | null;
          distanceKm?: number | null;
          subscriptionId?: number;
        };

    try {
      if ("kind" in body) {
        const { kind, amountCents, description, notes, place, date, categoryId, tagIds, walletAccountId, toWalletAccountId, linkedTxId, originLat, originLng, originName, destLat, destLng, destName, distanceKm, subscriptionId } = body;
        if (subscriptionId !== undefined) {
          return reply.code(409).send({
            error: "Subscription payments must confirm a concrete renewal occurrence",
          });
        }
        
        // Auto-detect period based on transaction date
        const dateMs = new Date(date).getTime();
        const autoPeriodId = await findPeriodIdForDate(dateMs);
        
        if (kind === "transfer") {
          if (!toWalletAccountId) {
            reply.code(400).send({ error: "toWalletAccountId is required for transfers" });
            return;
          }
          const txResult = await createSimpleTransaction({
            kind: "transfer",
            amountCents,
            description,
            notes,
            place,
            date: new Date(date),
            periodId: autoPeriodId,
            categoryId,
            walletAccountId,
            toWalletAccountId,
            linkedTxId,
            tagIds,
          });

          reply.code(201).send({ id: txResult.transactionId, ...txResult });
          return;
        }
        const txResult = await createSimpleTransaction({
          kind,
          amountCents,
          description,
          notes,
          place,
          date: new Date(date),
          periodId: autoPeriodId,
          categoryId,
          walletAccountId,
          linkedTxId,
          originLat,
          originLng,
          originName,
          destLat,
          destLng,
          destName,
          distanceKm,
          tagIds,
        });

        reply.code(201).send({ id: txResult.transactionId, ...txResult });
        return;
      }

      const { date, description, reference, notes, place, txType, linkedTxId, tagIds, categoryId, categoryAllocations, lines } = body;
      if (txType != null && txType !== "manual") {
        return reply.code(400).send({ error: "Manual journal creation cannot choose a system transaction type" });
      }
      
      // Auto-detect period based on transaction date
      const dateMs = new Date(date).getTime();
      const autoPeriodId = await findPeriodIdForDate(dateMs);
      
      const txResult = await createJournalEntry({
        date: new Date(date),
        description,
        reference: reference ?? null,
        notes: notes ?? null,
        place: place ?? null,
        txType,
        periodId: autoPeriodId,
        linkedTxId,
        categoryId,
        categoryAllocations,
        tagIds,
        lines,
      });
      reply.code(201).send({ id: txResult.transactionId, ...txResult });
    } catch (err) {
      fastify.log.error(err);
      reply.code(400).send({
        error: err instanceof Error ? err.message : "Failed to create transaction",
      });
    }
  });

  /** Reverse a posted journal without erasing its audit history. */
  fastify.post("/api/transactions/:id/reverse", {
    schema: {
      operationId: "reverseTransaction",
      tags: ["transactions"],
      params: transactionIdParamsSchema,
      response: { 201: z.object({ id: z.number().int(), reversalOfTxId: z.number().int() }).passthrough(), 400: transactionErrorSchema, 404: transactionErrorSchema, 409: transactionErrorSchema },
    },
  }, async (request, reply) => {
    const transactionId = parseIdParam((request.params as { id?: string }).id);
    if (transactionId === null) return reply.code(400).send({ error: "Invalid transaction ID" });
    try {
      const [original] = await db.select().from(transactions)
        .where(eq(transactions.id, transactionId)).limit(1);
      if (!original) return reply.code(404).send({ error: "Transaction not found" });
      if ([
        "salary_income", "salary_correction", "subscription_renewal", "subscription_correction",
        "paylater_recognition", "paylater_interest", "paylater_settlement",
        "loan_lending", "loan_payment", "loan_writeoff", "split_bill_lent", "split_bill_borrowed",
        "historical_recovery_adjustment",
      ].includes(original.txType)) {
        return reply.code(409).send({
          error: "This domain-owned transaction must use its dedicated correction workflow",
        });
      }
      if (original.status !== "posted") {
        return reply.code(409).send({ error: "Only a posted transaction can be reversed" });
      }
      const [existingReversal] = await db.select({ id: transactions.id })
        .from(transactions).where(eq(transactions.reversalOfTxId, transactionId)).limit(1);
      if (existingReversal) {
        return reply.code(409).send({ error: `Transaction already has reversal ${existingReversal.id}` });
      }
      const originalLines = await db.select().from(transactionLines)
        .where(eq(transactionLines.transactionId, transactionId));
      if (originalLines.length < 2) return reply.code(409).send({ error: "Cannot reverse an incomplete journal" });
      const originalAllocations = await db.select({
        categoryId: transactionCategoryAllocations.categoryId,
        amount: transactionCategoryAllocations.amount,
      }).from(transactionCategoryAllocations)
        .where(eq(transactionCategoryAllocations.transactionId, transactionId));
      const reversalDate = Date.now();
      const reversalPeriodId = await findPeriodIdForDate(reversalDate);
      const prepared = await prepareJournalEntry({
        date: reversalDate,
        description: `Reversal: ${original.description}`,
        reference: original.reference ? `REVERSAL:${original.reference}` : `REVERSAL:${original.id}`,
        notes: `Reverses posted transaction #${original.id}`,
        txType: "reversal",
        periodId: reversalPeriodId,
        reversalOfTxId: original.id,
        categoryId: original.categoryId,
        ...(originalAllocations.length > 0 ? {
          categoryAllocations: originalAllocations.map((allocation) => ({
            categoryId: allocation.categoryId,
            amount: -allocation.amount,
          })),
        } : {}),
        lines: originalLines.map((line) => ({
          accountId: line.accountId,
          debit: line.credit,
          credit: line.debit,
          description: `Reversal of ${line.description ?? original.description}`,
          cashFlowClass: line.cashFlowClass as "operating" | "investing" | "financing" | "transfer" | "recovery" | null,
        })),
      }, db);

      const result = db.transaction((tx) => {
        const fresh = tx.select().from(transactions)
          .where(eq(transactions.id, transactionId)).limit(1).all()[0];
        if (!fresh || fresh.status !== "posted") throw new Error("Transaction was changed; retry reversal");
        const [already] = tx.select({ id: transactions.id }).from(transactions)
          .where(eq(transactions.reversalOfTxId, transactionId)).limit(1).all();
        if (already) throw new Error(`Transaction already has reversal ${already.id}`);
        const reversalId = insertPreparedJournalEntrySync(tx, prepared);
        const updated = tx.update(transactions).set({ status: "reversed" })
          .where(and(eq(transactions.id, transactionId), eq(transactions.status, "posted"))).run();
        if (updated.changes !== 1) throw new Error("Failed to mark original transaction reversed");
        tx.insert(auditLogs).values({
          entityType: "transaction",
          entityId: transactionId,
          action: "update",
          beforeSnapshot: Buffer.from(JSON.stringify(fresh)),
          afterSnapshot: Buffer.from(JSON.stringify({ ...fresh, status: "reversed", reversalTransactionId: reversalId })),
        }).run();
        return reversalId;
      });
      await invalidateOnTransactionMutation({
        transactionId: result,
        affectedAccountIds: prepared.accountIds,
        affectedPeriodIds: reversalPeriodId == null ? undefined : [reversalPeriodId],
        revisionBumped: true,
      });
      return reply.code(201).send({ id: result, reversalOfTxId: transactionId });
    } catch (err) {
      fastify.log.error(err);
      return reply.code(409).send({ error: err instanceof Error ? err.message : "Failed to reverse transaction" });
    }
  });

  fastify.put("/api/transactions/:id", {
    schema: {
      operationId: "updateTransaction",
      tags: ["transactions"],
      params: transactionIdParamsSchema,
      body: transactionUpdateBodySchema,
      response: { 200: transactionRecordSchema, 400: transactionErrorSchema, 404: transactionErrorSchema, 409: transactionErrorSchema, 500: transactionErrorSchema },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      date?: string;
      description?: string;
      reference?: string | null;
      notes?: string | null;
      place?: string | null;
      txType?: string;
      categoryId?: number | null;
      tagIds?: number[];
      lines?: Array<{
        accountId: number;
        debit: number;
        credit: number;
        description?: string;
      }>;
    };

    try {
      const transactionId = parseIdParam(id);
      if (transactionId === null) {
        return reply.code(400).send({ error: "Invalid transaction ID" });
      }
      const updated = await updateTransactionAtomically(transactionId, body);
      return reply.code(200).send(updated);
    } catch (err) {
      fastify.log.error(err);
      const status = transactionRouteErrorStatus(err instanceof TransactionMutationError ? err.statusCode : 500);
      return reply.code(status).send({
        error: err instanceof Error ? err.message : "Failed to update transaction",
      });
    }
  });

  fastify.delete("/api/transactions/:id", {
    schema: {
      operationId: "deleteTransaction",
      tags: ["transactions"],
      params: transactionIdParamsSchema,
      response: { 204: z.null(), 400: transactionErrorSchema, 404: transactionErrorSchema, 409: transactionErrorSchema, 500: transactionErrorSchema },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const txId = parseIdParam(id);
      if (txId === null) return reply.code(400).send({ error: "Invalid transaction ID" });
      const result = await deleteTransactionsAtomically([txId]);
      // Cleanup is best-effort after commit; failures remain durable in the outbox.
      if (result.outboxIds.length > 0) void processStorageDeletionOutbox(result.outboxIds);
      return reply.code(204).send();
    } catch (err) {
      fastify.log.error(err);
      const status = transactionRouteErrorStatus(err instanceof TransactionMutationError ? err.statusCode : 500);
      return reply.code(status).send({
        error: err instanceof Error ? err.message : "Failed to delete transaction",
      });
    }
  });

  // Bulk delete transactions
  fastify.post("/api/transactions/bulk-delete", {
    schema: {
      operationId: "bulkDeleteTransactions",
      tags: ["transactions"],
      body: z.object({ ids: z.array(z.number().int().positive()).min(1) }).passthrough(),
      response: { 200: bulkDeleteResponseSchema, 400: transactionErrorSchema, 404: transactionErrorSchema, 409: transactionErrorSchema, 500: transactionErrorSchema },
    },
  }, async (request, reply) => {
    const { ids } = request.body as { ids: number[] };
    try {
      if (!Array.isArray(ids)) throw new TransactionMutationError("ids array is required", 400);
      const result = await deleteTransactionsAtomically(ids);
      if (result.outboxIds.length > 0) void processStorageDeletionOutbox(result.outboxIds);
      return reply.send({
        success: true,
        deletedCount: result.deletedCount,
        message: `Deleted ${result.deletedCount} transaction(s)`,
      });
    } catch (err) {
      fastify.log.error(err);
      const status = transactionRouteErrorStatus(err instanceof TransactionMutationError ? err.statusCode : 500);
      return reply.code(status).send({
        error: err instanceof Error ? err.message : "Failed to bulk delete transactions",
      });
    }
  });

  // Import preview endpoint
  fastify.post("/api/transactions/import-preview", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute", groupId: "transaction-import" } },
      schema: { operationId: "previewTransactionImport", tags: ["transactions"], body: z.union([importPreviewBodySchema, legacyImportPreviewBodySchema]), response: { 200: importPreviewResponseUnionSchema, 400: transactionErrorSchema } },
  }, async (request, reply) => {
    const body = request.body as {
      csvText: string;
      mappings?: Record<string, string>;
      hasHeader?: boolean;
      accountId?: number;
      dateFormat?: string;
    };
    if (!body.mappings && body.accountId == null && body.dateFormat == null) {
      try {
        return reply.send(await buildLegacyImportPreview(body.csvText));
      } catch (err) {
        if (err instanceof TransactionMutationError) return reply.code(400).send({ error: err.message });
        fastify.log.error(err);
        return reply.code(400).send({ error: "Failed to preview import" });
      }
    }
    const { csvText, mappings = {}, hasHeader = true, accountId, dateFormat = "DD/MM/YYYY" } = body as {
      csvText: string;
      mappings: Record<string, string>;
      hasHeader: boolean;
      accountId: number;
      dateFormat: string;
    };

    try {
      const lines = csvText.split("\n").filter((line) => line.trim());
      if (lines.length === 0) {
        reply.code(400).send({ error: "Empty CSV" });
        return;
      }

      const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().trim());
      const dataStartIndex = hasHeader ? 1 : 0;
      const rows = lines.slice(dataStartIndex);

      const preview = [];
      for (let i = 0; i < Math.min(rows.length, 5); i++) {
        const values = parseCSVLine(rows[i]);
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => {
          row[h] = values[idx] ?? "";
        });

        const dateRaw = row[mappings.date?.toLowerCase()] ?? "";
        const parsedDate = parseDateWithFormat(dateRaw, dateFormat);

        const amountRaw = row[mappings.amount?.toLowerCase()] ?? "";
        const amountCents = parseRupiah(amountRaw);

        const description = row[mappings.description?.toLowerCase()] ?? "";

        preview.push({
          rowNumber: dataStartIndex + i + 1,
          date: parsedDate,
          amountCents,
          description,
          raw: row,
        });
      }

      reply.send({ preview, totalRows: rows.length });
    } catch (err) {
      fastify.log.error(err);
      reply.code(400).send({ error: "Failed to preview import" });
    }
  });

  // Import confirm endpoint
  fastify.post("/api/transactions/import-confirm", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute", groupId: "transaction-import" } },
    schema: { operationId: "confirmTransactionImport", tags: ["transactions"], body: importConfirmBodyUnionSchema, response: { 201: importConfirmResponseSchema, 400: transactionErrorSchema, 404: transactionErrorSchema, 409: transactionErrorSchema, 500: transactionErrorSchema } },
  }, async (request, reply) => {
    const body = request.body as {
      rows: Array<{ date: string; amountCents?: number; amount?: number; description: string; type?: "expense" | "income"; accountId?: number; periodId?: number | null; categoryId?: number | null; notes?: string | null; reference?: string | null }>;
      accountId?: number;
      defaultDescription?: string;
      tagIds?: number[];
    };
    const { rows, accountId, defaultDescription = "Imported transaction", tagIds } = body;
    const hasLegacyRows = rows.some((row) => row.amount != null || row.type != null || row.accountId != null || row.categoryId != null || row.periodId != null);
    const importRows = rows.map((row) => ({
      date: row.date,
      amount: row.amount != null ? row.amount : row.amountCents!,
      description: row.description,
      ...(row.type ? { type: row.type } : {}),
      ...(row.accountId != null ? { accountId: row.accountId } : {}),
      ...(row.periodId !== undefined ? { periodId: row.periodId } : {}),
      ...(row.categoryId !== undefined ? { categoryId: row.categoryId } : {}),
      ...(row.notes !== undefined ? { notes: row.notes } : {}),
      ...(row.reference !== undefined ? { reference: row.reference } : {}),
    }));

    try {
      const results = await importTransactionsAtomically({
        rows: importRows,
        accountId,
        defaultDescription,
        tagIds,
      });
      return reply.code(201).send({ imported: results.length, skipped: 0, errors: [], transactions: results, legacyRows: hasLegacyRows });
    } catch (err) {
      fastify.log.error(err);
      const status = transactionRouteErrorStatus(err instanceof TransactionMutationError ? err.statusCode : 500);
      return reply.code(status).send({
        error: err instanceof Error ? err.message : "Failed to import transactions",
      });
    }
  });
}

// CSV parsing utilities
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function parseDateWithFormat(dateStr: string, format: string): string | null {
  if (!dateStr) return null;

  // Simple date parsing - assumes format like "DD/MM/YYYY" or "MM/DD/YYYY"
  const parts = dateStr.split(/[\/\-\.]/);
  if (parts.length !== 3) return null;

  try {
    const formatParts = format.toUpperCase().split(/[\/\-\.]/);
    const dayIndex = formatParts.indexOf("DD");
    const monthIndex = formatParts.indexOf("MM");
    const yearIndex = formatParts.indexOf("YYYY");

    if (dayIndex === -1 || monthIndex === -1 || yearIndex === -1) {
      return null;
    }

    const day = parseInt(parts[dayIndex], 10);
    const month = parseInt(parts[monthIndex], 10);
    const year = parseInt(parts[yearIndex], 10);
    if (![day, month, year].every(Number.isInteger) || month < 1 || month > 12 || day < 1 || day > 31) {
      return null;
    }

    const date = new Date(year, month - 1, day);
    if (isNaN(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      return null;
    }

    return date.toISOString().split("T")[0];
  } catch {
    return null;
  }
}

function parseRupiah(amountStr: string): number {
  return parseIdrInteger(amountStr) ?? 0;
}
