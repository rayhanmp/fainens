import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getStorageCleanupStatus,
  listAccounts,
  listAgentMemories,
  listBudgets,
  listCategories,
  listPeriods,
  listTags,
  listTransactions,
  retryStorageCleanup,
} from '../../generated/client';
import { unwrapGenerated } from '../core/generated-response';
import { queryKeys } from '../core/query-keys';

/** Deleted attachments and pictures that storage still holds after every retry. */
export function useStorageCleanupQuery() {
  return useQuery({
    queryKey: queryKeys.storageCleanup,
    queryFn: ({ signal }) => unwrapGenerated(getStorageCleanupStatus({ signal }), 200, 'Failed to load storage cleanup'),
    staleTime: 10 * 60_000,
  });
}

export function useRetryStorageCleanupMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrapGenerated(retryStorageCleanup(), 200, 'Could not try again'),
    onSuccess: (result) => queryClient.setQueryData(queryKeys.storageCleanup, { stuck: result.stuck, lastError: result.lastError }),
  });
}

export type ExportSelection = {
  transactions: boolean;
  accounts: boolean;
  categories: boolean;
  budgets: boolean;
  settings: boolean;
  memories: boolean;
};

const EXPORT_PAGE = 100;

/**
 * Every transaction, oldest first, page by page: all periods, drafts, and corrections with what they
 * corrected, so the export holds the whole ledger rather than the list's first page of this period.
 */
async function allTransactions() {
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += EXPORT_PAGE) {
    const page = await unwrapGenerated(
      listTransactions({ periodId: 'all', includeReversals: 'true', sort: 'oldest', limit: String(EXPORT_PAGE), offset: String(offset) }),
      200,
      'Failed to export transactions',
    );
    rows.push(...page.data);
    if (page.data.length < EXPORT_PAGE || rows.length >= page.pagination.total) return rows;
  }
}

/** Reads a consistent export snapshot through one feature-owned query command. */
export function useExportDataMutation() {
  return useMutation({
    mutationFn: async (selection: ExportSelection) => {
      const exportData: Record<string, unknown> = {};
      if (selection.transactions) {
        exportData.transactions = await allTransactions();
      }
      if (selection.accounts) {
        exportData.accounts = await unwrapGenerated(listAccounts(), 200, 'Failed to export accounts');
      }
      if (selection.categories) {
        const [categories, tags] = await Promise.all([
          unwrapGenerated(listCategories(), 200, 'Failed to export categories'),
          unwrapGenerated(listTags(), 200, 'Failed to export tags'),
        ]);
        exportData.categories = categories;
        exportData.tags = tags;
      }
      if (selection.budgets) {
        const [budgets, periods] = await Promise.all([
          unwrapGenerated(listBudgets(), 200, 'Failed to export budgets'),
          unwrapGenerated(listPeriods(), 200, 'Failed to export periods'),
        ]);
        exportData.budgets = budgets;
        exportData.periods = periods;
      }
      if (selection.memories) {
        const memories = await unwrapGenerated(listAgentMemories(), 200, 'Failed to export agent memories');
        exportData.agentMemories = memories.memories;
      }
      return exportData;
    },
  });
}
