import { useQuery } from '@tanstack/react-query';
import { listAccounts } from '../../generated/client';
import { queryKeys } from '../core/query-keys';

export const useAccountsQuery = () => useQuery({
  queryKey: queryKeys.accounts.all,
  queryFn: async () => (await listAccounts()).data,
});
