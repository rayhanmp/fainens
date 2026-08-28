import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { queryKeys } from '../core/query-keys';

export type CategoriesPageData = {
  categories: Awaited<ReturnType<typeof api.categories.list>>;
  tags: Awaited<ReturnType<typeof api.tags.list>>;
  transactions: Awaited<ReturnType<typeof api.transactions.list>>['data'];
  expenseAccounts: Array<{
    id: number;
    name: string;
    type: string;
    isActive: boolean;
  }>;
};

/** Loads classification records and the lookup data used by category management. */
export function useCategoriesPageQuery(includeInactive: boolean) {
  return useQuery<CategoriesPageData>({
    queryKey: queryKeys.categories.list(includeInactive),
    queryFn: async () => {
      const [categories, tags, transactionResponse, accounts] = await Promise.all([
        api.categories.list(includeInactive ? { includeInactive: true } : undefined),
        api.tags.list(),
        api.transactions.list({ limit: '2000' }),
        api.accounts.list({ type: 'expense' }),
      ]);
      return {
        categories,
        tags,
        transactions: transactionResponse.data,
        expenseAccounts: accounts
          .filter((account) => account.type === 'expense' && account.isActive)
          .map((account) => ({
            id: account.id,
            name: account.name,
            type: account.type,
            isActive: account.isActive,
          })),
      };
    },
    placeholderData: (previous) => previous,
  });
}
