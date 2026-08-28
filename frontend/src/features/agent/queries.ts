import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { queryKeys } from '../core/query-keys';

export const useAgentConversationsQuery = (includeArchived = false) => useQuery({
  queryKey: queryKeys.agent.conversations(includeArchived),
  queryFn: () => api.agent.conversations.list({ includeArchived }),
});
export const useAgentMemoriesQuery = () => useQuery({
  queryKey: queryKeys.agent.memories,
  queryFn: () => api.agent.memories.list(),
  placeholderData: (previous) => previous,
});

export const useAgentProfileQuery = () => useQuery({
  queryKey: queryKeys.agent.profile,
  queryFn: () => api.agent.profile.get(),
  placeholderData: (previous) => previous,
});

export const useAgentConversationQuery = (conversationId: number | null) => useQuery({
  queryKey: queryKeys.agent.conversation(conversationId ?? 0),
  queryFn: () => api.agent.conversations.get(conversationId!),
  enabled: conversationId != null,
});
