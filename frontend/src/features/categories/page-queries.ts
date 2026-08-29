import { useQuery } from '@tanstack/react-query';
import { listAccounts, listCategories, listTags, listTransactions, type ListCategories200Item, type ListTags200Item } from '../../generated/client';
import { queryKeys } from '../core/query-keys';
import { unwrapGenerated } from '../core/generated-response';

export type CategoriesPageData = {
  categories: ListCategories200Item[];
  tags: ListTags200Item[];
  transactions: Array<{ id: number; categoryId: number | null; tags: Array<{ tagId: number; name: string; color: string }> }>;
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
        unwrapGenerated(listCategories(includeInactive ? { includeInactive: 'true' } : undefined), 200, 'Failed to load categories'),
        unwrapGenerated(listTags(), 200, 'Failed to load tags'),
        unwrapGenerated(listTransactions({ limit: '2000' }), 200, 'Failed to load transactions'),
        unwrapGenerated(listAccounts({ type: 'expense' }), 200, 'Failed to load expense accounts'),
      ]);
      const result: CategoriesPageData = {
        categories,
        tags,
        transactions: transactionResponse.data.map((transaction) => ({
          id: transaction.id,
          categoryId: transaction.categoryId ?? null,
          tags: transaction.tags ?? [],
        })),
        expenseAccounts: accounts
          .filter((account) => account.type === 'expense' && account.isActive)
          .map((account) => ({
            id: account.id,
            name: account.name,
            type: account.type,
            isActive: true,
          })),
      };
      return result;
    },
    placeholderData: (previous) => previous,
  });
}
