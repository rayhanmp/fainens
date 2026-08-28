import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { queryKeys } from '../core/query-keys';

export function useMoneyAnomaliesQuery(status: 'open' | 'resolved' | 'dismissed') {
  return useQuery({
    queryKey: queryKeys.anomalies.list(status),
    queryFn: () => api.anomalies.money(status),
    placeholderData: (previous) => previous,
  });
}
