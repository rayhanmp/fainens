import { useLocation } from '@tanstack/react-router';

const idFrom = (value: unknown) => (typeof value === 'string' && Number.isSafeInteger(Number(value)) ? Number(value) : undefined);

/** Account, category and period from the current page's URL, so a new transaction starts where the user is looking. */
export function useContextualTransactionPrefill() {
  const search = useLocation().search as Record<string, unknown>;
  return {
    accountId: idFrom(search.accountId),
    categoryId: idFrom(search.categoryId),
    periodId: idFrom(search.periodId),
  };
}
