import {
  createAgentConversation,
  createAgentMemory,
  deleteAgentConversation,
  deleteAgentMemory,
  executeAgentApproval,
  prepareAgentAction,
  rejectAgentApproval,
  reissueAgentApproval,
  updateAgentConversation,
  updateAgentMemory,
  updateAgentProfile,
  type CreateAgentConversationBody,
  type CreateAgentMemoryBody,
  type UpdateAgentConversationBody,
  type UpdateAgentMemoryBody,
} from '../../generated/client';
import type { AgentBudgetActionProposal, AgentTransactionActionProposal } from '../../lib/api';
import { unwrapGenerated } from '../core/generated-response';

export type AgentApprovalExecution = {
  receipt: {
    actionId: number;
    approvalId: number;
    kind: 'budget_plan_upsert' | 'transaction_journal_create';
    periodId?: number | null;
    transactionId?: number;
    changed?: Array<{ planId: number; categoryId: number; plannedAmountCents: number; operation: 'created' | 'updated' }>;
    changedCount?: number;
    auditLogIds: number[];
    financialRevision: number;
    executedAt: number;
  };
  replay: boolean;
};

/**
 * The agent route owns interaction state, while all durable agent mutations
 * live behind this feature command boundary. This keeps generated-client
 * status handling in one place and prevents the page from becoming a second
 * API facade.
 */
export const agentCommands = {
  profile: {
    update: (nickname: string | null) => unwrapGenerated(
      updateAgentProfile({ nickname }),
      200,
      'Could not save your preferred name.',
    ),
  },
  memories: {
    create: (input: CreateAgentMemoryBody) => unwrapGenerated(createAgentMemory(input), 201, 'Could not save agent memory.'),
    update: (id: number, input: UpdateAgentMemoryBody) => unwrapGenerated(updateAgentMemory(id, input), 200, 'Could not save agent memory.'),
    delete: (id: number) => unwrapGenerated(deleteAgentMemory(id), 204, 'Could not delete agent memory.'),
  },
  conversations: {
    create: (input: CreateAgentConversationBody = {}) => unwrapGenerated(createAgentConversation(input), 201, 'Could not create a conversation.'),
    update: (id: number, input: UpdateAgentConversationBody) => unwrapGenerated(updateAgentConversation(id, input), 200, 'Could not update that conversation.'),
    delete: (id: number) => unwrapGenerated(deleteAgentConversation(id), 204, 'Could not delete that conversation.'),
  },
  approvals: {
    execute: (id: number, token: string) => unwrapGenerated(executeAgentApproval(id, { token }), 200, 'Could not execute this approval.') as Promise<AgentApprovalExecution>,
    reissue: (id: number) => unwrapGenerated(reissueAgentApproval(id), 200, 'Could not restore this approval.'),
    reject: (id: number, token: string) => unwrapGenerated(rejectAgentApproval(id, { token }), 200, 'Could not dismiss this approval.'),
  },
  actions: {
    prepareBudget: async (input: {
      conversationId?: number | null;
      input: { periodId: number; plans: Array<{ categoryId: number; plannedAmountCents: number }> };
      assumptions?: string[];
      missingFields?: string[];
      idempotencyKey?: string;
    }) => unwrapGenerated(prepareAgentAction({ ...input, kind: 'budget_plan_upsert' }), 201, 'Could not prepare this budget change.') as Promise<AgentBudgetActionProposal>,
    prepareTransaction: async (input: {
      conversationId?: number | null;
      input: unknown;
      assumptions?: string[];
      missingFields?: string[];
      idempotencyKey?: string;
    }) => unwrapGenerated(prepareAgentAction({ ...input, kind: 'transaction_journal_create' }), 201, 'Could not prepare this transaction.') as Promise<AgentTransactionActionProposal>,
  },
};
