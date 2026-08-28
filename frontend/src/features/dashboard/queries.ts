import { useQuery } from '@tanstack/react-query';
import { getDashboardAnalytics } from '../../generated/client';
import { queryKeys } from '../core/query-keys';

export const useDashboardQuery = () => useQuery({
  queryKey: queryKeys.dashboard.analytics,
  queryFn: async () => (await getDashboardAnalytics()).data,
});
