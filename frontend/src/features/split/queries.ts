import { useQuery } from '@tanstack/react-query';
import { listAccounts, listContacts } from '../../generated/client';
import { unwrapGenerated } from '../core/generated-response';
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
      const [accounts, contacts] = await Promise.all([
        unwrapGenerated(listAccounts(), 200, 'Failed to load accounts'),
        unwrapGenerated(listContacts(), 200, 'Failed to load contacts'),
      ]);
      return {
        accounts: accounts
          .filter((account) => account.type === 'asset')
          .map((account) => ({ id: account.id, name: account.name, type: String(account.type), balance: account.balance ?? 0 })),
        contacts,
      };
    },
    placeholderData: (previous) => previous,
  });
}
