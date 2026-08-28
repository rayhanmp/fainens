import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { queryKeys } from '../core/query-keys';

export const useDashboardQuery = () => useQuery({ queryKey: queryKeys.dashboard.analytics, queryFn: () => api.analytics.dashboard() });
