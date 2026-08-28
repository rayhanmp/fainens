import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { queryKeys } from '../core/query-keys';

export const useAccountsQuery = () => useQuery({ queryKey: queryKeys.accounts.all, queryFn: () => api.accounts.list() });
