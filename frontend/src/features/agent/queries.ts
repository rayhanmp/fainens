import { useQuery } from '@tanstack/react-query';
import { executeAgentTool, getAgentConversation, getAgentProfile, listAgentConversations, listAgentMemories, type ExecuteAgentToolBody } from '../../generated/client';
import type { AgentFinancialFacts } from '../../lib/api';
import { unwrapGenerated } from '../core/generated-response';
import { queryKeys } from '../core/query-keys';

export const useAgentConversationsQuery = (includeArchived = false) => useQuery({
  queryKey: queryKeys.agent.conversations(includeArchived),
  queryFn: async ({ signal }) => {
    const response = await listAgentConversations({ includeArchived: includeArchived ? 'true' : 'false' }, { signal });
    if (response.status !== 200) throw new Error('Failed to load conversations');
    return response.data;
  },
});

export type FinancialFactsInput = { periodId?: number; startDate?: number; endDate?: number };

export async function fetchFinancialFacts(input: FinancialFactsInput = {}, options?: RequestInit): Promise<AgentFinancialFacts> {
  const payload: ExecuteAgentToolBody = { name: 'get_financial_facts', input };
  return unwrapGenerated(executeAgentTool(payload, options), 200, 'Failed to load financial facts') as Promise<AgentFinancialFacts>;
}

export function useFinancialFactsQuery(input: FinancialFactsInput, enabled = true) {
  return useQuery({
    queryKey: [...queryKeys.dashboard.all, 'financial-facts', input] as const,
    queryFn: ({ signal }) => fetchFinancialFacts(input, { signal }),
    enabled,
    placeholderData: (previous) => previous,
  });
}
export const useAgentMemoriesQuery = () => useQuery({
  queryKey: queryKeys.agent.memories,
  queryFn: async ({ signal }) => {
    const response = await listAgentMemories({ signal });
    if (response.status !== 200) throw new Error('Failed to load memories');
    return response.data;
  },
  placeholderData: (previous) => previous,
});

export const useAgentProfileQuery = () => useQuery({
  queryKey: queryKeys.agent.profile,
  queryFn: async ({ signal }) => {
    const response = await getAgentProfile({ signal });
    if (response.status !== 200) throw new Error('Failed to load agent profile');
    return response.data;
  },
  placeholderData: (previous) => previous,
});

export const useAgentConversationQuery = (conversationId: number | null) => useQuery({
  queryKey: queryKeys.agent.conversation(conversationId ?? 0),
  queryFn: async ({ signal }) => {
    const response = await getAgentConversation(conversationId!, { signal });
    if (response.status !== 200) throw new Error('Failed to load conversation');
    return response.data;
  },
  enabled: conversationId != null,
});
