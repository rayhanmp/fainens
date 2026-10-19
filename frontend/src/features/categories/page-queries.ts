import { useQuery } from '@tanstack/react-query';
import { getClassificationUsage, getPeriodCategoryUsage, listAccounts, listCategories, listTagGroups, listTags, type ListCategories200Item, type ListTagGroups200Item, type ListTags200Item } from '../../generated/client';
import { queryKeys } from '../core/query-keys';
import { unwrapGenerated } from '../core/generated-response';

export type CategoriesPageData = {
  categories: ListCategories200Item[];
  tags: ListTags200Item[];
  tagGroups: ListTagGroups200Item[];
  /** Usage across the whole posted ledger, counted on the server. */
  usage: {
    byCategory: Record<number, number>;
    byTag: Record<number, number>;
    expenseCount: number;
    categorizedExpenseCount: number;
    transactionCount: number;
    taggedCount: number;
  };
  expenseAccounts: Array<{
    id: number;
    name: string;
    type: string;
    isActive: boolean;
  }>;
};

/** Spending and entries per category within a date range (inclusive, ms), for the breakdown. */
export function useCategoryBreakdownQuery(range: { from?: number; to?: number }, enabled = true) {
  return useQuery({
    enabled,
    queryKey: [...queryKeys.categories.all, 'breakdown', range.from ?? null, range.to ?? null] as const,
    queryFn: async () => {
      const usage = await unwrapGenerated(getClassificationUsage({ from: range.from, to: range.to }), 200, 'Failed to load the category breakdown');
      return usage.categories;
    },
    placeholderData: (previous) => previous,
  });
}

/** Spending per category in each of the latest salary periods, oldest first. */
export function usePeriodCategoryUsageQuery(count: number) {
  return useQuery({
    queryKey: [...queryKeys.categories.all, 'by-period', count] as const,
    queryFn: async () => (await unwrapGenerated(getPeriodCategoryUsage({ count }), 200, 'Failed to load spending by period')).periods,
    placeholderData: (previous) => previous,
  });
}

/** Loads classification records and the lookup data used by category management. */
export function useCategoriesPageQuery(includeInactive: boolean) {
  return useQuery<CategoriesPageData>({
    queryKey: queryKeys.categories.list(includeInactive),
    queryFn: async () => {
      const [categories, tags, tagGroups, usage, accounts] = await Promise.all([
        unwrapGenerated(listCategories(includeInactive ? { includeInactive: 'true' } : undefined), 200, 'Failed to load categories'),
        unwrapGenerated(listTags(), 200, 'Failed to load tags'),
        unwrapGenerated(listTagGroups(), 200, 'Failed to load tag groups'),
        unwrapGenerated(getClassificationUsage(), 200, 'Failed to load category usage'),
        unwrapGenerated(listAccounts({ type: 'expense' }), 200, 'Failed to load expense accounts'),
      ]);
      const result: CategoriesPageData = {
        categories,
        tags,
        tagGroups,
        usage: {
          byCategory: Object.fromEntries(usage.categories.map((row) => [row.categoryId, row.transactionCount])),
          byTag: Object.fromEntries(usage.tags.map((row) => [row.tagId, row.transactionCount])),
          expenseCount: usage.expenseCount,
          categorizedExpenseCount: usage.categorizedExpenseCount,
          transactionCount: usage.transactionCount,
          taggedCount: usage.taggedCount,
        },
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
