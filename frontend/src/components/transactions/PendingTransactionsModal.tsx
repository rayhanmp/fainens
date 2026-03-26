import { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { api } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { Check, X, Edit2, Loader2 } from 'lucide-react';

interface PendingTransaction {
  id: number;
  rawMessage: string;
  parsedData: {
    type: string;
    amount: number;
    description: string;
    category: string;
    date?: string;
    place?: string;
    memo?: string;
    fromAccount?: string;
    toAccount?: string;
    confidence: number;
  };
  status: string;
  parseAttempts: number;
  lastError: string | null;
  createdAt: number;
}

interface PendingTransactionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onEdit: (pendingTx: PendingTransaction) => void;
  onRefresh: () => void;
}

export function PendingTransactionsModal({
  isOpen,
  onClose,
  onEdit,
  onRefresh,
}: PendingTransactionsModalProps) {
  const [pendingTxs, setPendingTxs] = useState<PendingTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadPendingTransactions();
    }
  }, [isOpen]);

  const loadPendingTransactions = async () => {
    setIsLoading(true);
    try {
      const data = await api.pendingTransactions.list();
      setPendingTxs(data);
    } catch (err) {
      console.error('Failed to load pending transactions:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async (id: number) => {
    setActionLoading(id);
    try {
      await api.pendingTransactions.approve(id);
      setPendingTxs((prev) => prev.filter((tx) => tx.id !== id));
      onRefresh();
    } catch (err) {
      console.error('Failed to approve:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (id: number) => {
    setActionLoading(id);
    try {
      await api.pendingTransactions.reject(id);
      setPendingTxs((prev) => prev.filter((tx) => tx.id !== id));
      onRefresh();
    } catch (err) {
      console.error('Failed to reject:', err);
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
      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--color-muted)]" />
        </div>
      ) : pendingTxs.length === 0 ? (
        <div className="py-8 text-center text-[var(--color-muted)]">
          No pending transactions
        </div>
      ) : (
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          {pendingTxs.map((tx) => (
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
                  {Math.round(tx.parsedData.confidence * 100)}% confidence
                </span>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--color-muted)]">Type</span>
                  <span className="capitalize font-medium">{tx.parsedData.type}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-muted)]">Amount</span>
                  <span className="font-medium">{formatCurrency(tx.parsedData.amount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-muted)]">Category</span>
                  <span className="font-medium">{tx.parsedData.category}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-muted)]">Account</span>
                  <span className="font-medium">{tx.parsedData.fromAccount || '-'}</span>
                </div>
                {tx.parsedData.place && (
                  <div className="flex justify-between col-span-2">
                    <span className="text-[var(--color-muted)]">Place</span>
                    <span className="font-medium">{tx.parsedData.place}</span>
                  </div>
                )}
              </div>

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
                  onClick={() => handleApprove(tx.id)}
                  disabled={actionLoading === tx.id}
                  isLoading={actionLoading === tx.id}
                  className="flex-1 rounded-full"
                >
                  <Check className="w-4 h-4 mr-1" />
                  Approve
                </Button>
              </div>
            </div>
          ))}
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
