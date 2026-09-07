import { asc, and, eq } from "drizzle-orm";

import { db } from "../db/client";
import { agentConversations, agentMessages } from "../db/schema";
import { generateConversationTitle } from "../services/agent-title";
import { getAgentProviderConfig } from "../services/agent-provider-config";
import { reviewBudgetOutlook } from "../services/budget-outlook-review";
import type { BackgroundTask } from "../services/background-tasks";

function parsePayload(task: BackgroundTask): Record<string, unknown> {
  try {
    const value = JSON.parse(task.payloadJson) as unknown;
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export async function processAgentTask(task: BackgroundTask, signal?: AbortSignal): Promise<unknown> {
  const payload = parsePayload(task);
  if (task.jobName === "conversation-title") {
    const conversationId = Number(payload.conversationId ?? task.subjectId);
    if (!Number.isInteger(conversationId) || conversationId <= 0) return { skipped: "invalid_conversation" };
    const conversation = (await db.select().from(agentConversations).where(eq(agentConversations.id, conversationId)).limit(1))[0];
    if (!conversation || (conversation.titleSource !== "auto" || conversation.title !== "New conversation")) {
      return { skipped: "conversation_already_titled_or_deleted" };
    }
    const firstUserMessage = (await db.select({ content: agentMessages.content }).from(agentMessages)
      .where(and(eq(agentMessages.conversationId, conversationId), eq(agentMessages.role, "user")))
      .orderBy(asc(agentMessages.id)).limit(1))[0];
    if (!firstUserMessage) return { skipped: "no_user_message" };
    const providerConfig = await getAgentProviderConfig();
    const assistantMessageId = Number(payload.assistantMessageId);
    const assistantMessage = Number.isInteger(assistantMessageId)
      ? (await db.select({ content: agentMessages.content }).from(agentMessages).where(and(eq(agentMessages.id, assistantMessageId), eq(agentMessages.conversationId, conversationId), eq(agentMessages.role, "assistant"))).limit(1))[0]
      : undefined;
    const generated = await generateConversationTitle({
      apiKey: providerConfig.apiKey,
      model: providerConfig.model,
      baseUrl: providerConfig.baseUrl,
      question: firstUserMessage.content,
      assistantAnswer: assistantMessage?.content ?? null,
      signal,
    });
    // Conditional update protects a manual rename made while the provider was
    // working. It also makes duplicate delivery harmless.
    const changed = db.update(agentConversations).set({ title: generated.title, titleSource: "auto", updatedAt: new Date() })
      .where(and(eq(agentConversations.id, conversationId), eq(agentConversations.titleSource, "auto"), eq(agentConversations.title, "New conversation"))).run();
    return { title: generated.title, generatedBy: generated.generatedBy, updated: changed.changes === 1 };
  }
  if (task.jobName === "budget-outlier-review") {
    const periodId = Number(payload.periodId ?? task.subjectId);
    const expectedRevision = payload.expectedRevision == null ? undefined : Number(payload.expectedRevision);
    if (!Number.isInteger(periodId) || periodId <= 0) return { skipped: "invalid_period" };
    const review = await reviewBudgetOutlook(periodId, { expectedRevision: Number.isInteger(expectedRevision) ? expectedRevision : undefined, signal });
    // Detailed decisions live in forecast_purchase_review and are available
    // through the scoped status endpoint. Keep the background receipt small so
    // a large-but-valid model response cannot make task completion fail after
    // the financial review rows were already persisted.
    return {
      periodId,
      expectedRevision: Number.isInteger(expectedRevision) ? expectedRevision : null,
      applied: review.applied,
      reason: review.reason,
      reviewCount: review.reviews.length,
      largePurchaseCount: review.largePurchaseCount ?? 0,
    };
  }
  return { skipped: "unsupported_agent_job" };
}
