import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "../db/client";
import { agentApprovals, agentConversations, agentPendingActions, auditLogs, budgetPlans, categories, salaryPeriods } from "../db/schema";
import { invalidateAllAnalytics, invalidateAllInsights, invalidatePeriodSummary } from "../cache/invalidation";
import { bumpFinancialRevisionSync, getFinancialRevision, getFinancialRevisionSync } from "./financial-revision";

export const AGENT_BUDGET_ACTION_KIND = "budget_plan_upsert" as const;
const ACTION_TTL_MS = 15 * 60 * 1000;
const MAX_PLAN_ITEMS = 100;
const MAX_ASSUMPTIONS = 20;
const MAX_ASSUMPTION_LENGTH = 500;

type BudgetPlanItem = { categoryId: number; plannedAmountCents: number };
type BudgetActionInput = { periodId: number; plans: BudgetPlanItem[] };

export class AgentActionError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = "AgentActionError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestampMs(value: unknown): number {
  return value instanceof Date ? value.getTime() : Number(value);
}

function parseJson(value: string | null | undefined, fallback: unknown): unknown {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function parseAssumptions(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_ASSUMPTIONS) {
    throw new AgentActionError(400, `assumptions must be an array of at most ${MAX_ASSUMPTIONS} strings`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0 || item.length > MAX_ASSUMPTION_LENGTH) {
      throw new AgentActionError(400, `assumptions[${index}] must be a non-empty string of at most ${MAX_ASSUMPTION_LENGTH} characters`);
    }
    return item.trim();
  });
}

function parseBudgetActionInput(value: unknown): BudgetActionInput {
  if (!isRecord(value)) throw new AgentActionError(400, "input must be an object");
  const periodId = value.periodId;
  if (typeof periodId !== "number" || !Number.isSafeInteger(periodId) || periodId <= 0) {
    throw new AgentActionError(400, "input.periodId must be a positive integer");
  }
  if (!Array.isArray(value.plans) || value.plans.length === 0 || value.plans.length > MAX_PLAN_ITEMS) {
    throw new AgentActionError(400, `input.plans must contain 1-${MAX_PLAN_ITEMS} items`);
  }
  const seen = new Set<number>();
  const plans = value.plans.map((candidate, index): BudgetPlanItem => {
    if (!isRecord(candidate)) throw new AgentActionError(400, `input.plans[${index}] must be an object`);
    const categoryId = candidate.categoryId;
    const plannedAmountCents = candidate.plannedAmountCents;
    if (typeof categoryId !== "number" || !Number.isSafeInteger(categoryId) || categoryId <= 0) {
      throw new AgentActionError(400, `input.plans[${index}].categoryId must be a positive integer`);
    }
    if (typeof plannedAmountCents !== "number" || !Number.isSafeInteger(plannedAmountCents) || plannedAmountCents < 0) {
      throw new AgentActionError(400, `input.plans[${index}].plannedAmountCents must be a non-negative integer`);
    }
    if (seen.has(categoryId)) throw new AgentActionError(400, `input.plans contains duplicate category ${categoryId}`);
    seen.add(categoryId);
    return { categoryId, plannedAmountCents };
  }).sort((a, b) => a.categoryId - b.categoryId);
  return { periodId, plans };
}

function normalizeInput(kind: string, input: unknown): string {
  if (kind !== AGENT_BUDGET_ACTION_KIND) throw new AgentActionError(400, `Unsupported agent action kind: ${kind}`);
  return JSON.stringify(parseBudgetActionInput(input));
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function idempotencyKey(ownerEmail: string, kind: string, normalizedInput: string, revision: number, supplied?: unknown): string {
  if (supplied != null) {
    if (typeof supplied !== "string" || supplied.trim().length < 8 || supplied.length > 200) {
      throw new AgentActionError(400, "idempotencyKey must be 8-200 characters");
    }
    return createHash("sha256").update(`${ownerEmail}\0${supplied.trim()}`, "utf8").digest("hex");
  }
  return createHash("sha256").update(`${ownerEmail}\0${kind}\0${revision}\0${normalizedInput}`, "utf8").digest("hex");
}

function actionView(
  action: typeof agentPendingActions.$inferSelect,
  approval: typeof agentApprovals.$inferSelect,
  details: Array<{ categoryId: number; category: string; plannedAmountCents: number }>,
  approvalToken: string | null,
) {
  return {
    pendingActionId: action.id,
    approvalId: approval.id,
    kind: action.kind,
    status: action.status,
    input: parseJson(action.normalizedInput, {}),
    assumptions: parseJson(action.assumptions, []),
    missingFields: parseJson(action.missingFields, []),
    details,
    baseFinancialRevision: action.baseFinancialRevision,
    createdAt: timestampMs(action.createdAt),
    expiresAt: timestampMs(approval.expiresAt),
    approvalToken,
    tokenAlreadyIssued: approvalToken == null,
  };
}

async function loadBudgetDetails(input: BudgetActionInput) {
  const ids = input.plans.map((plan) => plan.categoryId);
  const rows = await db.select({ id: categories.id, name: categories.name }).from(categories).where(inArray(categories.id, ids));
  const byId = new Map(rows.map((row) => [row.id, row.name]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) throw new AgentActionError(404, `Category not found: ${missing.join(", ")}`);
  return input.plans.map((plan) => ({ categoryId: plan.categoryId, category: byId.get(plan.categoryId) as string, plannedAmountCents: plan.plannedAmountCents }));
}

async function ownedConversation(conversationId: number | null | undefined, ownerEmail: string) {
  if (conversationId == null) return null;
  if (!Number.isSafeInteger(conversationId) || conversationId <= 0) throw new AgentActionError(400, "conversationId must be a positive integer");
  const [conversation] = await db.select({ id: agentConversations.id }).from(agentConversations)
    .where(and(eq(agentConversations.id, conversationId), eq(agentConversations.ownerEmail, ownerEmail))).limit(1);
  if (!conversation) throw new AgentActionError(404, "Conversation not found");
  return conversation.id;
}

export async function prepareAgentAction(args: {
  ownerEmail: string;
  conversationId?: number | null;
  kind: unknown;
  input: unknown;
  assumptions?: unknown;
  missingFields?: unknown;
  idempotencyKey?: unknown;
}) {
  if (!args.ownerEmail.trim()) throw new AgentActionError(401, "Authenticated user email is unavailable");
  if (typeof args.kind !== "string") throw new AgentActionError(400, "kind is required");
  const kind = args.kind;
  const input = parseBudgetActionInput(args.input);
  const normalizedInput = normalizeInput(kind, input);
  const assumptions = parseAssumptions(args.assumptions);
  const missingFields = parseAssumptions(args.missingFields);
  const conversationId = await ownedConversation(args.conversationId, args.ownerEmail);

  const [period] = await db.select({ id: salaryPeriods.id, name: salaryPeriods.name, status: salaryPeriods.status, isActive: salaryPeriods.isActive })
    .from(salaryPeriods).where(eq(salaryPeriods.id, input.periodId)).limit(1);
  if (!period) throw new AgentActionError(404, "Salary period not found");
  if (period.status !== "open" || !period.isActive) throw new AgentActionError(409, "Budget proposals can only target an active open period");
  const details = await loadBudgetDetails(input);
  const revision = await getFinancialRevision();
  const key = idempotencyKey(args.ownerEmail, kind, normalizedInput, revision, args.idempotencyKey);
  const [existingApproval] = await db.select().from(agentApprovals).where(eq(agentApprovals.idempotencyKey, key)).limit(1);
  if (existingApproval) {
    if (existingApproval.ownerEmail !== args.ownerEmail) throw new AgentActionError(409, "That idempotency key is already in use");
    const [existingAction] = await db.select().from(agentPendingActions).where(eq(agentPendingActions.id, existingApproval.pendingActionId)).limit(1);
    if (!existingAction) throw new AgentActionError(409, "Existing approval is missing its pending action");
    if (existingAction.kind !== kind || existingAction.normalizedInput !== normalizedInput) {
      throw new AgentActionError(409, "That idempotency key is already bound to a different proposal");
    }
    const existingInput = parseBudgetActionInput(parseJson(existingAction.normalizedInput, {}));
    const existingDetails = await loadBudgetDetails(existingInput);
    return actionView(existingAction, existingApproval, existingDetails, null);
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + ACTION_TTL_MS);
  const rawToken = randomBytes(32).toString("base64url");
  const created = db.transaction((tx) => {
    const action = tx.insert(agentPendingActions).values({
      ownerEmail: args.ownerEmail,
      conversationId: conversationId ?? null,
      kind,
      normalizedInput,
      assumptions: JSON.stringify(assumptions),
      missingFields: JSON.stringify(missingFields),
      baseFinancialRevision: revision,
      status: "pending",
      expiresAt,
      createdAt: now,
      updatedAt: now,
    }).returning().all()[0];
    if (!action) throw new AgentActionError(500, "Failed to create pending agent action");
    const approval = tx.insert(agentApprovals).values({
      pendingActionId: action.id,
      ownerEmail: args.ownerEmail,
      tokenHash: tokenHash(rawToken),
      idempotencyKey: key,
      status: "pending",
      expiresAt,
      createdAt: now,
    }).returning().all()[0];
    if (!approval) throw new AgentActionError(500, "Failed to create agent approval");
    return { action, approval };
  });
  return actionView(created.action, created.approval, details, rawToken);
}

type ExecutionReceipt = {
  actionId: number;
  approvalId: number;
  kind: typeof AGENT_BUDGET_ACTION_KIND;
  periodId: number;
  changed: Array<{ planId: number; categoryId: number; plannedAmountCents: number; operation: "created" | "updated" }>;
  changedCount: number;
  auditLogIds: number[];
  financialRevision: number;
  executedAt: number;
};

function parseStoredBudgetInput(action: typeof agentPendingActions.$inferSelect): BudgetActionInput {
  try { return parseBudgetActionInput(JSON.parse(action.normalizedInput)); }
  catch (error) { throw new AgentActionError(409, error instanceof Error ? error.message : "Pending action payload is invalid"); }
}

export async function executeAgentApproval(args: { ownerEmail: string; approvalId: number; token: unknown }) {
  if (!Number.isSafeInteger(args.approvalId) || args.approvalId <= 0) throw new AgentActionError(400, "Invalid approval ID");
  if (typeof args.token !== "string" || args.token.length < 20 || args.token.length > 200) throw new AgentActionError(401, "A valid approval token is required");
  const suppliedHash = tokenHash(args.token);
  const result = db.transaction((tx) => {
    const approval = tx.select().from(agentApprovals)
      .where(and(eq(agentApprovals.id, args.approvalId), eq(agentApprovals.ownerEmail, args.ownerEmail), eq(agentApprovals.tokenHash, suppliedHash))).limit(1).all()[0];
    if (!approval) return { error: new AgentActionError(404, "Approval not found") } as const;
    if (approval.status === "executed" && approval.executionReceipt) {
      return { receipt: JSON.parse(approval.executionReceipt) as ExecutionReceipt, replay: true } as const;
    }
    if (approval.status !== "pending") return { error: new AgentActionError(409, `Approval is ${approval.status}; it cannot be executed`) } as const;
    const nowMs = Date.now();
    if (nowMs >= timestampMs(approval.expiresAt)) {
      tx.update(agentApprovals).set({ status: "expired" }).where(eq(agentApprovals.id, approval.id)).run();
      tx.update(agentPendingActions).set({ status: "expired", updatedAt: new Date(nowMs) }).where(eq(agentPendingActions.id, approval.pendingActionId)).run();
      return { error: new AgentActionError(410, "Approval expired; prepare a fresh proposal") } as const;
    }
    const action = tx.select().from(agentPendingActions).where(eq(agentPendingActions.id, approval.pendingActionId)).limit(1).all()[0];
    if (!action || action.status !== "pending") return { error: new AgentActionError(409, "Pending action is no longer executable") } as const;
    const currentRevision = getFinancialRevisionSync(tx);
    if (currentRevision !== action.baseFinancialRevision) {
      tx.update(agentApprovals).set({ status: "superseded" }).where(eq(agentApprovals.id, approval.id)).run();
      tx.update(agentPendingActions).set({ status: "superseded", updatedAt: new Date(nowMs) }).where(eq(agentPendingActions.id, action.id)).run();
      return { error: new AgentActionError(409, "Financial data changed since this proposal; review a fresh proposal") } as const;
    }
    if (action.kind !== AGENT_BUDGET_ACTION_KIND) return { error: new AgentActionError(409, "Unsupported pending action kind") } as const;
    const input = parseStoredBudgetInput(action);
    const period = tx.select().from(salaryPeriods).where(eq(salaryPeriods.id, input.periodId)).limit(1).all()[0];
    if (!period || period.status !== "open" || !period.isActive) return { error: new AgentActionError(409, "The target period is no longer open and active") } as const;
    const categoryRows = tx.select({ id: categories.id, name: categories.name }).from(categories)
      .where(inArray(categories.id, input.plans.map((plan) => plan.categoryId))).all();
    const categoryIds = new Set(categoryRows.map((row) => row.id));
    const missing = input.plans.map((plan) => plan.categoryId).filter((id) => !categoryIds.has(id));
    if (missing.length > 0) return { error: new AgentActionError(409, `A proposed category no longer exists: ${missing.join(", ")}`) } as const;

    const changed: ExecutionReceipt["changed"] = [];
    const auditLogIds: number[] = [];
    for (const plan of input.plans) {
      const existing = tx.select().from(budgetPlans)
        .where(and(eq(budgetPlans.periodId, input.periodId), eq(budgetPlans.categoryId, plan.categoryId))).limit(1).all()[0];
      if (existing && existing.plannedAmount === plan.plannedAmountCents) continue;
      if (existing) {
        const updated = tx.update(budgetPlans).set({ plannedAmount: plan.plannedAmountCents })
          .where(and(eq(budgetPlans.id, existing.id), eq(budgetPlans.plannedAmount, existing.plannedAmount))).returning().all()[0];
        if (!updated) return { error: new AgentActionError(409, "A budget plan changed while approval was being applied") } as const;
        const audit = tx.insert(auditLogs).values({ entityType: "budget_plan", entityId: existing.id, action: "agent_update", beforeSnapshot: Buffer.from(JSON.stringify(existing)), afterSnapshot: Buffer.from(JSON.stringify(updated)) }).returning().all()[0];
        if (audit) auditLogIds.push(audit.id);
        changed.push({ planId: updated.id, categoryId: updated.categoryId, plannedAmountCents: updated.plannedAmount, operation: "updated" });
      } else {
        const inserted = tx.insert(budgetPlans).values({ periodId: input.periodId, categoryId: plan.categoryId, plannedAmount: plan.plannedAmountCents }).returning().all()[0];
        if (!inserted) return { error: new AgentActionError(409, "Could not create a budget plan") } as const;
        const audit = tx.insert(auditLogs).values({ entityType: "budget_plan", entityId: inserted.id, action: "agent_create", afterSnapshot: Buffer.from(JSON.stringify(inserted)) }).returning().all()[0];
        if (audit) auditLogIds.push(audit.id);
        changed.push({ planId: inserted.id, categoryId: inserted.categoryId, plannedAmountCents: inserted.plannedAmount, operation: "created" });
      }
    }
    const financialRevision = changed.length > 0 ? bumpFinancialRevisionSync(tx) : currentRevision;
    const receipt: ExecutionReceipt = { actionId: action.id, approvalId: approval.id, kind: AGENT_BUDGET_ACTION_KIND, periodId: input.periodId, changed, changedCount: changed.length, auditLogIds, financialRevision, executedAt: nowMs };
    tx.update(agentApprovals).set({ status: "executed", approvedAt: new Date(nowMs), executedAt: new Date(nowMs), executionReceipt: JSON.stringify(receipt) }).where(and(eq(agentApprovals.id, approval.id), eq(agentApprovals.status, "pending"))).run();
    tx.update(agentPendingActions).set({ status: "executed", updatedAt: new Date(nowMs) }).where(and(eq(agentPendingActions.id, action.id), eq(agentPendingActions.status, "pending"))).run();
    return { receipt, replay: false } as const;
  });
  if ("error" in result) throw result.error;
  if (!result.replay && result.receipt.changedCount > 0) {
    await invalidatePeriodSummary(result.receipt.periodId);
    await invalidateAllAnalytics();
    await invalidateAllInsights();
  }
  return result;
}

export async function rejectAgentApproval(args: { ownerEmail: string; approvalId: number; token: unknown }) {
  if (!Number.isSafeInteger(args.approvalId) || args.approvalId <= 0) throw new AgentActionError(400, "Invalid approval ID");
  if (typeof args.token !== "string" || args.token.length < 20 || args.token.length > 200) throw new AgentActionError(401, "A valid approval token is required");
  const token = args.token;
  const result = db.transaction((tx) => {
    const approval = tx.select().from(agentApprovals).where(and(eq(agentApprovals.id, args.approvalId), eq(agentApprovals.ownerEmail, args.ownerEmail), eq(agentApprovals.tokenHash, tokenHash(token)))).limit(1).all()[0];
    if (!approval) throw new AgentActionError(404, "Approval not found");
    if (approval.status === "rejected") return { status: "rejected" as const, approvalId: approval.id };
    if (approval.status !== "pending") throw new AgentActionError(409, `Approval is ${approval.status}; it cannot be rejected`);
    const now = new Date();
    tx.update(agentApprovals).set({ status: "rejected" }).where(and(eq(agentApprovals.id, approval.id), eq(agentApprovals.status, "pending"))).run();
    tx.update(agentPendingActions).set({ status: "rejected", updatedAt: now }).where(and(eq(agentPendingActions.id, approval.pendingActionId), eq(agentPendingActions.status, "pending"))).run();
    return { status: "rejected" as const, approvalId: approval.id };
  });
  return result;
}

export async function listAgentActions(ownerEmail: string, conversationId?: number) {
  const actions = await db.select().from(agentPendingActions).where(conversationId == null
    ? eq(agentPendingActions.ownerEmail, ownerEmail)
    : and(eq(agentPendingActions.ownerEmail, ownerEmail), eq(agentPendingActions.conversationId, conversationId)))
    .orderBy(agentPendingActions.createdAt).limit(100);
  return actions.map((action) => ({
    pendingActionId: action.id,
    conversationId: action.conversationId,
    kind: action.kind,
    status: action.status,
    input: parseJson(action.normalizedInput, {}),
    assumptions: parseJson(action.assumptions, []),
    missingFields: parseJson(action.missingFields, []),
    baseFinancialRevision: action.baseFinancialRevision,
    createdAt: timestampMs(action.createdAt),
    expiresAt: timestampMs(action.expiresAt),
  }));
}
