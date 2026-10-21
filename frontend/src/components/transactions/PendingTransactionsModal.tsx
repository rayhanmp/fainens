import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Check, X, Edit2, Loader2, RotateCcw } from 'lucide-react';
import {
  type PendingTransactionListItem,
  usePendingTransactionsQuery,
  useRetryPendingTransactionMutation,
  useUpdatePendingTransactionMutation,
} from '../../features/transactions/queries';
import { useAssetAccountsQuery } from '../../features/accounts/queries';
import { invalidateFinancialSummaries, queryKeys } from '../../features/core/query-keys';
import { approvePendingTransaction, rejectPendingTransaction } from '../../generated/client';

interface PendingTransactionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onEdit: (pendingTx: PendingTransactionListItem) => void;
  onRefresh: () => void;
}

type WalletOption = { id: number; name: string };

const normalizeAccountName = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Mirrors the server's approval rule: an explicit account ID, else exactly one
 * wallet with the same name, else the only wallet when the item names none.
 * Returns null when the user has to pick the account.
 */
function resolveWalletId(parsed: PendingTransactionListItem['parsedData'], wallets: WalletOption[]): number | null {
  const rawId = (parsed as Record<string, unknown>).fromAccountId;
  if (rawId != null && rawId !== '') {
    const id = Number(rawId);
    return wallets.some((wallet) => wallet.id === id) ? id : null;
  }
  const name = parsed.fromAccount ? normalizeAccountName(parsed.fromAccount) : '';
  if (name) {
    const matches = wallets.filter((wallet) => normalizeAccountName(wallet.name) === name);
    return matches.length === 1 ? matches[0].id : null;
  }
  return wallets.length === 1 ? wallets[0].id : null;
}

function serverError(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string') {
    return (data as { error: string }).error;
  }
  return fallback;
}

export function PendingTransactionsModal({
  isOpen,
  onClose,
  onEdit,
  onRefresh,
}: PendingTransactionsModalProps) {
  const { formatAmount } = useBalanceVisibility();
  const queryClient = useQueryClient();
  const pendingQuery = usePendingTransactionsQuery();
  const accountsQuery = useAssetAccountsQuery(isOpen);
  const updateMutation = useUpdatePendingTransactionMutation();
  const retryMutation = useRetryPendingTransactionMutation();
  const pendingTxs = pendingQuery.data ?? [];
  const wallets: WalletOption[] = (accountsQuery.data ?? [])
    .filter((account) => account.type === 'asset' && !account.systemKey && account.isActive !== false)
    .map((account) => ({ id: account.id, name: account.name }));
  const isLoading = pendingQuery.isPending && !pendingQuery.data;
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [actionError, setActionError] = useState('');
  const [itemErrors, setItemErrors] = useState<Record<number, string>>({});

  const setItemError = (id: number, message: string | null) => {
    setItemErrors((previous) => {
      const next = { ...previous };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  };

  const handleChooseAccount = async (tx: PendingTransactionListItem, accountId: string) => {
    const wallet = wallets.find((candidate) => candidate.id.toString() === accountId);
    if (!wallet) return;
    setActionLoading(tx.id);
    setActionError('');
    try {
      // The edit endpoint stores the explicit account; approval then uses it.
      await updateMutation.mutateAsync({
        id: tx.id,
        parsed: { ...tx.parsedData, fromAccount: wallet.name, fromAccountId: wallet.id },
      });
      setItemError(tx.id, null);
      onRefresh();
    } catch (err) {
      setItemError(tx.id, err instanceof Error ? err.message : 'Failed to save the account');
    } finally {
      setActionLoading(null);
    }
  };

  const handleApprove = async (tx: PendingTransactionListItem) => {
    // A transfer needs both wallets and maybe a fee; the review form posts it like any other transfer.
    if (tx.parsedData.type === 'transfer') {
      onEdit(tx);
      return;
    }
    if (wallets.length > 0 && resolveWalletId(tx.parsedData, wallets) == null) {
      setItemError(tx.id, 'Choose the account this transaction used before approving.');
      return;
    }
    setActionLoading(tx.id);
    setActionError('');
    try {
      const response = await approvePendingTransaction(tx.id);
      if (response.status !== 200) throw new Error(serverError(response.data, 'Failed to approve transaction'));
      setItemError(tx.id, null);
      await invalidateFinancialSummaries(queryClient);
      onRefresh();
    } catch (err) {
      console.error('Failed to approve:', err);
      setItemError(tx.id, err instanceof Error ? err.message : 'Failed to approve transaction');
    } finally {
      setActionLoading(null);
    }
  };

  /** Reads a message that couldn't be read again; says so when it still can't. */
  const handleRetry = async (tx: PendingTransactionListItem) => {
    setActionLoading(tx.id);
    setActionError('');
    try {
      const result = await retryMutation.mutateAsync(tx.id);
      setItemError(tx.id, result.success ? null : 'Still couldn’t read it. Fill it in yourself with Edit, or reject it.');
      onRefresh();
    } catch (err) {
      setItemError(tx.id, err instanceof Error ? err.message : 'Could not try again');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (id: number) => {
    setActionLoading(id);
    setActionError('');
    try {
      const response = await rejectPendingTransaction(id);
      if (response.status !== 200) throw new Error(serverError(response.data, 'Failed to reject transaction'));
      await queryClient.invalidateQueries({ queryKey: queryKeys.transactions.pending });
      onRefresh();
    } catch (err) {
      console.error('Failed to reject:', err);
      setActionError(err instanceof Error ? err.message : 'Failed to reject transaction');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Pending Transactions"
      subtitle="Review and approve AI-parsed transactions"
      size="xl"
    >
      {actionError && <div role="alert" className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600">{actionError}</div>}
      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--color-muted)]" />
        </div>
      ) : pendingQuery.isError ? (
        <div className="py-8 text-center">
          <p className="text-sm text-red-600">Could not load pending transactions.</p>
          <Button variant="secondary" onClick={() => void pendingQuery.refetch()} className="mt-4 rounded-full">
            Retry
          </Button>
        </div>
      ) : pendingTxs.length === 0 ? (
        <div className="py-8 text-center text-[var(--color-muted)]">
          No pending transactions
        </div>
      ) : (
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          {pendingTxs.map((tx) => {
            const resolvedWalletId = resolveWalletId(tx.parsedData, wallets);
            const needsAccount = tx.parsedData.type !== 'transfer' && wallets.length > 0 && resolvedWalletId == null;
            const itemError = itemErrors[tx.id];
            // A message that couldn't be read has nothing to approve yet.
            const unreadable = tx.status === 'failed';
            return (
            <div
              key={tx.id}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-[var(--color-muted)] mb-1">Original message</p>
                  <p className="text-sm text-[var(--color-text-primary)] font-medium truncate">
                    {tx.rawMessage}
                  </p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-600 dark:text-yellow-400">
                  {unreadable ? 'Couldn’t read' : `${Math.round(tx.parsedData.confidence * 100)}% confidence`}
                </span>
              </div>

              {unreadable ? (
                <p className="text-sm text-[var(--color-text-secondary)]">
                  This message couldn’t be read{tx.parseAttempts > 1 ? ` after ${tx.parseAttempts} tries` : ''}. Try again, fill it in yourself with Edit, or reject it.
                </p>
              ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--color-muted)]">Type</span>
                  <span className="capitalize font-medium">{tx.parsedData.type}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-muted)]">Amount</span>
                  <span className="font-medium">{formatAmount(tx.parsedData.amount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-muted)]">Category</span>
                  <span className="font-medium">{tx.parsedData.category}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor={`pending-account-${tx.id}`} className="text-[var(--color-muted)]">Account</label>
                  {tx.parsedData.type === 'transfer' || wallets.length === 0 ? (
                    <span className="font-medium">{tx.parsedData.fromAccount || '-'}</span>
                  ) : (
                    <select
                      id={`pending-account-${tx.id}`}
                      value={resolvedWalletId?.toString() ?? ''}
                      onChange={(event) => void handleChooseAccount(tx, event.target.value)}
                      disabled={actionLoading === tx.id}
                      aria-invalid={needsAccount || undefined}
                      className={`min-w-0 max-w-[60%] truncate rounded-lg border bg-[var(--color-surface)] px-2 py-1 text-right text-sm font-medium ${needsAccount ? 'border-red-500/60 text-red-600' : 'border-[var(--color-border)]'}`}
                    >
                      {resolvedWalletId == null && (
                        <option value="">{tx.parsedData.fromAccount ? `Choose (${tx.parsedData.fromAccount})` : 'Choose account'}</option>
                      )}
                      {wallets.map((wallet) => (
                        <option key={wallet.id} value={wallet.id}>{wallet.name}</option>
                      ))}
                    </select>
                  )}
                </div>
                {tx.parsedData.place && (
                  <div className="flex justify-between col-span-2">
                    <span className="text-[var(--color-muted)]">Place</span>
                    <span className="font-medium">{tx.parsedData.place}</span>
                  </div>
                )}
              </div>
              )}

              {itemError && (
                <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">{itemError}</p>
              )}

              <div className="flex gap-2 pt-2 border-t border-[var(--color-border)]">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onEdit(tx)}
                  className="flex-1 rounded-full"
                >
                  <Edit2 className="w-4 h-4 mr-1" />
                  Edit
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleReject(tx.id)}
                  disabled={actionLoading === tx.id}
                  className="flex-1 rounded-full text-red-500"
                >
                  {actionLoading === tx.id ? (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <X className="w-4 h-4 mr-1" />
                  )}
                  Reject
                </Button>
                <Button
                  size="sm"
                  onClick={() => (unreadable ? handleRetry(tx) : handleApprove(tx))}
                  disabled={actionLoading === tx.id}
                  isLoading={actionLoading === tx.id}
                  className="flex-1 rounded-full"
                >
                  {unreadable ? <RotateCcw className="w-4 h-4 mr-1" /> : <Check className="w-4 h-4 mr-1" />}
                  {unreadable ? 'Try again' : tx.parsedData.type === 'transfer' ? 'Review & approve' : 'Approve'}
                </Button>
              </div>
            </div>
            );
          })}
        </div>
      )}

      <div className="flex justify-end mt-4 pt-4 border-t border-[var(--color-border)]">
        <Button variant="secondary" onClick={onClose} className="rounded-full">
          Close
        </Button>
      </div>
    </Modal>
  );
}
