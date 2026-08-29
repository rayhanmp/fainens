import { useQuery } from '@tanstack/react-query';
import { getAgentConversation, getAgentProfile, listAgentConversations, listAgentMemories } from '../../generated/client';
import { queryKeys } from '../core/query-keys';

export const useAgentConversationsQuery = (includeArchived = false) => useQuery({
  queryKey: queryKeys.agent.conversations(includeArchived),
  queryFn: async ({ signal }) => {
    const response = await listAgentConversations({ includeArchived: includeArchived ? 'true' : 'false' }, { signal });
    if (response.status !== 200) throw new Error('Failed to load conversations');
    return response.data;
  },
});
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
