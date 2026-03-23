import { useState, useEffect } from 'react';
import { X, CheckCircle2, Calendar, CreditCard, FileText } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../ui/Button';
import { formatCurrency } from '../../lib/utils';

interface FulfillWishlistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  item: {
    id: number;
    name: string;
    description: string | null;
    amount: number;
    category: {
      id: number;
      name: string;
    } | null;
  };
}

export function FulfillWishlistModal({ isOpen, onClose, onSuccess, item }: FulfillWishlistModalProps) {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [accountId, setAccountId] = useState('');
  const [description, setDescription] = useState(item.name);
  const [notes, setNotes] = useState(item.description || '');
  const [accounts, setAccounts] = useState<Array<{ id: number; name: string; type: string; balance: number }>>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadAccounts();
    }
  }, [isOpen]);

  async function loadAccounts() {
    try {
      const data = await api.accounts.list();
      setAccounts(data.filter(a => a.type === 'asset'));
    } catch (err) {
      console.error('Failed to load accounts:', err);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId) return;

    try {
      setIsSubmitting(true);
      await api.wishlist.fulfill(item.id, {
        date,
        accountId: parseInt(accountId),
        description: description.trim() || item.name,
        notes: notes.trim() || undefined,
      });
      
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Failed to fulfill wishlist item:', err);
      alert('Failed to create transaction');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-[var(--ref-surface-container-lowest)] rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-[var(--color-border)]">
          <h2 className="text-xl font-bold text-[var(--color-text-primary)]">Mark as Fulfilled</h2>
          <button
            onClick={onClose}
            className="cursor-pointer p-2 hover:bg-[var(--ref-surface-container-high)] rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-[var(--color-muted)]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="bg-[var(--ref-surface-container-low)] rounded-xl p-4 mb-4">
            <div className="text-sm text-[var(--color-text-secondary)] mb-1">Wishlist Item</div>
            <div className="font-bold text-[var(--color-text-primary)]">{item.name}</div>
            <div className="text-lg font-bold text-[var(--color-accent)] mt-1">
              {formatCurrency(item.amount)}
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-[var(--color-text-primary)] mb-2 flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Transaction Date
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full bg-[var(--ref-surface-container-low)] border-none rounded-xl px-4 py-3 text-[var(--color-text-primary)] cursor-pointer"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-[var(--color-text-primary)] mb-2 flex items-center gap-2">
              <CreditCard className="w-4 h-4" />
              Payment Account
            </label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full bg-[var(--ref-surface-container-low)] border-none rounded-xl px-4 py-3 text-[var(--color-text-primary)] cursor-pointer"
              required
            >
              <option value="">Select account</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-[var(--color-text-primary)] mb-2">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Transaction description"
              className="w-full bg-[var(--ref-surface-container-low)] border-none rounded-xl px-4 py-3 text-[var(--color-text-primary)]"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-[var(--color-text-primary)] mb-2 flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Notes (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes..."
              rows={3}
              className="w-full bg-[var(--ref-surface-container-low)] border-none rounded-xl px-4 py-3 text-[var(--color-text-primary)] resize-none"
            />
          </div>

          <div className="flex gap-3 pt-4">
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
              type="submit"
              className="flex-1 rounded-full"
              disabled={isSubmitting || !accountId}
            >
              {isSubmitting ? (
                <span className="animate-pulse">Creating...</span>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Create Transaction
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
