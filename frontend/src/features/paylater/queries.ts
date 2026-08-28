import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { queryKeys } from '../core/query-keys';

export type PaylaterPageData = {
  obligations: Awaited<ReturnType<typeof api.paylater.obligations>>;
  accounts: Array<{ id: number; name: string; type: string; systemKey: string | null }>;
};

/** Loads PayLater obligations and the wallet lookup used by its settlement form. */
export function usePaylaterQuery() {
  return useQuery<PaylaterPageData>({
    queryKey: queryKeys.paylater.all,
    queryFn: async () => {
      const [obligations, accounts] = await Promise.all([
        api.paylater.obligations(),
        api.accounts.list(),
      ]);
      return {
        obligations,
        accounts: accounts.map((account) => ({
          id: account.id,
          name: account.name,
          type: account.type,
          systemKey: account.systemKey,
        })),
      };
    },
    placeholderData: (previous) => previous,
  });
}
