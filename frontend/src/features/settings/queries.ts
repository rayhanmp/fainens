import { useMutation } from '@tanstack/react-query';
import {
  listAccounts,
  listAgentMemories,
  listBudgets,
  listCategories,
  listPeriods,
  listTags,
  listTransactions,
} from '../../generated/client';
import { unwrapGenerated } from '../core/generated-response';

export type ExportSelection = {
  transactions: boolean;
  accounts: boolean;
  categories: boolean;
  budgets: boolean;
  settings: boolean;
  memories: boolean;
};

/** Reads a consistent export snapshot through one feature-owned query command. */
export function useExportDataMutation() {
  return useMutation({
    mutationFn: async (selection: ExportSelection) => {
      const exportData: Record<string, unknown> = {};
      if (selection.transactions) {
        const transactions = await unwrapGenerated(listTransactions(), 200, 'Failed to export transactions');
        exportData.transactions = transactions.data;
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
