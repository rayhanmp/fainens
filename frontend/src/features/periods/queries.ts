import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { queryKeys } from '../core/query-keys';

export const usePeriodsQuery = () => useQuery({ queryKey: queryKeys.periods.all, queryFn: () => api.periods.list() });
