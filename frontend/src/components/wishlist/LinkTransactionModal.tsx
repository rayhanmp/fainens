import { useState, useEffect } from 'react';
import { X, Link, Search, Calendar } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../ui/Button';
import { formatCurrency } from '../../lib/utils';

interface LinkTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  item: {
    id: number;
    name: string;
    amount: number;
  };
}

export function LinkTransactionModal({ isOpen, onClose, onSuccess, item }: LinkTransactionModalProps) {
  const [transactions, setTransactions] = useState<Array<{
    id: number;
    description: string;
    amount: number;
    date: number;
    accountName: string;
  }>>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTransactionId, setSelectedTransactionId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (isOpen) {
      loadTransactions();
    }
  }, [isOpen]);

  async function loadTransactions() {
    try {
      setIsLoading(true);
      const data = await api.transactions.list({ limit: '50' });
      setTransactions(data.map((t) => {
        // Calculate amount from transaction lines
        const amount = t.lines?.reduce((sum, line) => sum + (line.debit || 0), 0) || 0;
        return {
          id: t.id,
          description: t.description,
          amount,
          date: t.date,
          accountName: 'Unknown', // Would need to lookup account name
        };
      }));
    } catch (err) {
      console.error('Failed to load transactions:', err);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTransactionId) return;

    try {
      setIsSubmitting(true);
      await api.wishlist.link(item.id, selectedTransactionId);
      
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Failed to link transaction:', err);
      alert('Failed to link transaction');
    } finally {
      setIsSubmitting(false);
    }
  }

  const filteredTransactions = transactions.filter(t => 
    t.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.amount.toString().includes(searchQuery)
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-[var(--ref-surface-container-lowest)] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-[var(--color-border)]">
          <div>
            <h2 className="text-xl font-bold text-[var(--color-text-primary)]">Link to Transaction</h2>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">
              Connect "{item.name}" to an existing transaction
            </p>
          </div>
          <button
            onClick={onClose}
            className="cursor-pointer p-2 hover:bg-[var(--ref-surface-container-high)] rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-[var(--color-muted)]" />
          </button>
        </div>

        <div className="p-6 space-y-4 flex-1 overflow-hidden flex flex-col">
          <div className="bg-[var(--ref-surface-container-low)] rounded-xl p-4">
            <div className="text-sm text-[var(--color-text-secondary)] mb-1">Wishlist Item</div>
            <div className="font-bold text-[var(--color-text-primary)]">{item.name}</div>
            <div className="text-lg font-bold text-[var(--color-accent)] mt-1">
              {formatCurrency(item.amount)}
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search transactions..."
              className="w-full bg-[var(--ref-surface-container-low)] border-none rounded-xl pl-10 pr-4 py-3 text-[var(--color-text-primary)] placeholder:text-[var(--color-muted)]"
            />
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 min-h-[200px]">
            {isLoading ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-accent)]" />
              </div>
            ) : filteredTransactions.length === 0 ? (
              <div className="text-center py-8 text-[var(--color-text-secondary)]">
                No transactions found
              </div>
            ) : (
              filteredTransactions.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedTransactionId(t.id)}
                  className={`cursor-pointer w-full text-left p-4 rounded-xl transition-colors border-2 ${
                    selectedTransactionId === t.id
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                      : 'border-transparent hover:bg-[var(--ref-surface-container-high)]'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-semibold text-[var(--color-text-primary)]">
                        {t.description}
                      </div>
                      <div className="text-sm text-[var(--color-text-secondary)] flex items-center gap-2 mt-1">
                        <Calendar className="w-3 h-3" />
                        {new Date(t.date).toLocaleDateString()}
                        <span className="text-[var(--color-muted)]">|</span>
                        {t.accountName}
                      </div>
                    </div>
                    <div className="font-bold text-[var(--color-text-primary)]">
                      {formatCurrency(t.amount)}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="p-6 border-t border-[var(--color-border)] flex gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            className="flex-1 rounded-full"
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            className="flex-1 rounded-full"
            disabled={isSubmitting || !selectedTransactionId}
          >
            {isSubmitting ? (
              <span className="animate-pulse">Linking...</span>
            ) : (
              <>
                <Link className="w-4 h-4 mr-2" />
                Link Transaction
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
