import { eq, sql, desc } from "drizzle-orm";
import { db } from "../db/client";
import { auditLogs } from "../db/schema";

// Entity types that can be audited
export type EntityType =
  | "account"
  | "transaction"
  | "transaction_line"
  | "category"
  | "tag"
  | "salary_period"
  | "budget_plan"
  | "attachment"
  | "subscription"
  | "wishlist"
  | "reconciliation_session";

export type AuditAction = "create" | "update" | "delete";

export interface AuditLogEntry {
  id: number;
  entityType: EntityType;
  entityId: number;
  action: AuditAction;
  beforeSnapshot: Record<string, unknown> | null;
  afterSnapshot: Record<string, unknown> | null;
  createdAt: number;
}

export interface CreateAuditLogInput {
  entityType: EntityType;
  entityId: number;
  action: AuditAction;
  beforeSnapshot?: Record<string, unknown> | null;
  afterSnapshot?: Record<string, unknown> | null;
}

// Create an audit log entry
export async function createAuditLog(input: CreateAuditLogInput): Promise<number> {
  const result = await db.insert(auditLogs).values({
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    beforeSnapshot: input.beforeSnapshot ? Buffer.from(JSON.stringify(input.beforeSnapshot)) : null,
    afterSnapshot: input.afterSnapshot ? Buffer.from(JSON.stringify(input.afterSnapshot)) : null,
  }).returning({ id: auditLogs.id });

  return result[0]?.id ?? 0;
}

// Get paginated audit logs with optional filters
export interface AuditLogFilters {
  entityType?: EntityType;
  entityId?: number;
  /** An exact action, or "other" for every workflow step that isn't a create, update or delete. */
  action?: AuditAction | "other" | (string & {});
  startDate?: number;
  endDate?: number;
  /** Case-insensitive match on resource type, id, or action (partial) */
  search?: string;
}

export interface PaginatedAuditLogs {
  entries: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getAuditLogs(
  filters: AuditLogFilters = {},
  page: number = 1,
  pageSize: number = 50
): Promise<PaginatedAuditLogs> {
  const offset = (page - 1) * pageSize;

  // Build where conditions
  const conditions: any[] = [];
  if (filters.entityType) {
    conditions.push(eq(auditLogs.entityType, filters.entityType));
  }
  if (filters.entityId !== undefined) {
    conditions.push(eq(auditLogs.entityId, filters.entityId));
  }
  if (filters.action === "other") {
    conditions.push(sql`${auditLogs.action} NOT IN ('create', 'update', 'delete')`);
  } else if (filters.action) {
    conditions.push(eq(auditLogs.action, filters.action));
  }
  if (filters.startDate !== undefined) {
    conditions.push(sql`${auditLogs.createdAt} >= ${filters.startDate}`);
  }
  if (filters.endDate !== undefined) {
    conditions.push(sql`${auditLogs.createdAt} <= ${filters.endDate}`);
  }
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`;
    // The snapshots hold the names people search by ("Chateraise", "April 2026"), not only the type and id.
    conditions.push(
      sql`(
        ${auditLogs.entityType} LIKE ${term} OR
        CAST(${auditLogs.entityId} AS TEXT) LIKE ${term} OR
        ${auditLogs.action} LIKE ${term} OR
        CAST(${auditLogs.beforeSnapshot} AS TEXT) LIKE ${term} OR
        CAST(${auditLogs.afterSnapshot} AS TEXT) LIKE ${term}
      )`,
    );
  }

  const whereClause = conditions.length > 0
    ? sql`${conditions.map((c, i) => i === 0 ? c : sql` AND ${c}`).reduce((a, b) => sql`${a}${b}`)}`
    : sql`1=1`;

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(auditLogs)
    .where(whereClause);
  const total = countResult[0]?.count ?? 0;

  // Get entries
  const rows = await db
    .select({
      id: auditLogs.id,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      action: auditLogs.action,
      beforeSnapshot: auditLogs.beforeSnapshot,
      afterSnapshot: auditLogs.afterSnapshot,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(whereClause)
    .orderBy(desc(auditLogs.createdAt))
    .limit(pageSize)
    .offset(offset);

  const entries: AuditLogEntry[] = rows.map((row) => ({
    id: row.id,
    entityType: row.entityType as EntityType,
    entityId: row.entityId,
    action: row.action as AuditAction,
    beforeSnapshot: row.beforeSnapshot
      ? JSON.parse(row.beforeSnapshot.toString())
      : null,
    afterSnapshot: row.afterSnapshot
      ? JSON.parse(row.afterSnapshot.toString())
      : null,
    createdAt:
      row.createdAt instanceof Date ? row.createdAt.getTime() : Number(row.createdAt),
  }));

  return {
    entries,
    total,
    page,
    pageSize,
  };
}

/**
 * How many entries each day since `since`, and how many of them were deletions. Days are the
 * viewer's calendar days: `utcOffsetMinutes` is how far their clock is ahead of UTC.
 */
export async function getAuditActivity(since: number, utcOffsetMinutes: number): Promise<Array<{ day: string; count: number; removed: number }>> {
  const shiftSeconds = Math.round(utcOffsetMinutes) * 60;
  const day = sql<string>`date(${auditLogs.createdAt} / 1000 + ${shiftSeconds}, 'unixepoch')`;
  const rows = await db
    .select({
      day,
      count: sql<number>`count(*)`,
      removed: sql<number>`sum(case when ${auditLogs.action} = 'delete' then 1 else 0 end)`,
    })
    .from(auditLogs)
    .where(sql`${auditLogs.createdAt} >= ${since}`)
    .groupBy(day)
    .orderBy(day);
  return rows.map((row) => ({ day: row.day, count: Number(row.count), removed: Number(row.removed) }));
}

// Get audit history for a specific entity
export async function getEntityAuditHistory(
  entityType: EntityType,
  entityId: number
): Promise<AuditLogEntry[]> {
  const result = await getAuditLogs({ entityType, entityId }, 1, 100);
  return result.entries;
}

// Helper to audit a create operation
export async function auditCreate(
  entityType: EntityType,
  entityId: number,
  afterSnapshot: Record<string, unknown>
): Promise<void> {
  await createAuditLog({
    entityType,
    entityId,
    action: "create",
    afterSnapshot,
  });
}

// Helper to audit an update operation
export async function auditUpdate(
  entityType: EntityType,
  entityId: number,
  beforeSnapshot: Record<string, unknown>,
  afterSnapshot: Record<string, unknown>
): Promise<void> {
  await createAuditLog({
    entityType,
    entityId,
    action: "update",
    beforeSnapshot,
    afterSnapshot,
  });
}

// Helper to audit a delete operation
export async function auditDelete(
  entityType: EntityType,
  entityId: number,
  beforeSnapshot: Record<string, unknown>
): Promise<void> {
  await createAuditLog({
    entityType,
    entityId,
    action: "delete",
    beforeSnapshot,
  });
}
