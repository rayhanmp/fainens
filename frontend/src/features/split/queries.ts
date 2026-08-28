import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { queryKeys } from '../core/query-keys';

export type SplitLookups = {
  accounts: Array<{ id: number; name: string; type: string; balance: number }>;
  contacts: Array<{ id: number; name: string; fullName?: string | null; nickname?: string | null; relationship?: string }>;
};

/** Shared wallet/contact lookups for the split-bill workflow. */
export function useSplitLookupsQuery() {
  return useQuery<SplitLookups>({
    queryKey: queryKeys.split.all,
    queryFn: async () => {
      const [accounts, contacts] = await Promise.all([api.accounts.list(), api.contacts.list()]);
      return {
        accounts: accounts
          .filter((account) => account.type === 'asset')
          .map((account) => ({ id: account.id, name: account.name, type: account.type, balance: account.balance })),
        contacts,
      };
    },
    placeholderData: (previous) => previous,
  });
}
