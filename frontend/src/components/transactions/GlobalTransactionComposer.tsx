import { useQueryClient } from '@tanstack/react-query';
import { TransactionModal, type WalletAccount } from './TransactionModal';
import { useAccountsQuery } from '../../features/accounts/queries';
import { useCategoriesQuery, useTagsQuery } from '../../features/categories/queries';
import { invalidateFinancialSummaries } from '../../features/core/query-keys';
import { useUiStore } from '../../stores/ui-store';
import { usePeriodsQuery } from '../../features/periods/queries';
import { findCurrentPeriod } from '../../lib/utils';

export function GlobalTransactionComposer() {
  const queryClient = useQueryClient();
  const { transactionComposer, closeTransactionComposer } = useUiStore();
  const accountsQuery = useAccountsQuery();
  const categoriesQuery = useCategoriesQuery();
  const tagsQuery = useTagsQuery();
  const periodsQuery = usePeriodsQuery();
  const currentPeriod = findCurrentPeriod(periodsQuery.data ?? []);

  return (
    <TransactionModal
      isOpen={transactionComposer.isOpen}
      onClose={closeTransactionComposer}
      onSaved={() => {
        void invalidateFinancialSummaries(queryClient);
        closeTransactionComposer();
      }}
      accounts={(accountsQuery.data ?? []) as WalletAccount[]}
      categories={categoriesQuery.data ?? []}
      tags={tagsQuery.data ?? []}
      editingTransaction={null}
      periodId={transactionComposer.prefill?.periodId ?? currentPeriod?.id ?? null}
      initialPrefill={transactionComposer.prefill}
    />
  );
}
