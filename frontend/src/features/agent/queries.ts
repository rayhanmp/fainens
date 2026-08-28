import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { queryKeys } from '../core/query-keys';

export const useAgentConversationsQuery = (includeArchived = false) => useQuery({
  queryKey: queryKeys.agent.conversations(includeArchived),
  queryFn: () => api.agent.conversations.list({ includeArchived }),
});
export const useAgentMemoriesQuery = () => useQuery({ queryKey: queryKeys.agent.memories, queryFn: () => api.agent.memories.list() });
