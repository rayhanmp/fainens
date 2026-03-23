import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { CurrencyInput } from '../ui/CurrencyInput';
import { api } from '../../lib/api';
import { cn, parseIdNominalToInt } from '../../lib/utils';
import { Wallet, CreditCard } from 'lucide-react';

type AccountType = 'asset' | 'liability';

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  editingAccount?: {
    id: number;
    name: string;
    type: string;
    description?: string | null;
    accountNumber?: string | null;
    creditLimit?: number | null;
    interestRate?: number | null;
    billingDate?: number | null;
    provider?: string | null;
  } | null;
}

const PROVIDERS = [
  { value: '', label: 'Select provider (optional)' },
  { value: 'Kredivo', label: 'Kredivo' },
  { value: 'SPayLater', label: 'SPayLater (Shopee)' },
  { value: 'Traveloka PayLater', label: 'Traveloka PayLater' },
  { value: 'GoPayLater', label: 'GoPayLater' },
  { value: 'Credit Card', label: 'Credit Card (Generic)' },
  { value: 'Other', label: 'Other' },
];

export function AccountModal({ isOpen, onClose, onSaved, editingAccount }: AccountModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    type: 'asset' as AccountType,
    description: '',
    accountNumber: '',
    creditLimit: '',
    interestRate: '',
    billingDate: '',
    provider: '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (isOpen) {
      if (editingAccount) {
        setFormData({
          name: editingAccount.name,
          type: editingAccount.type as AccountType,
          description: editingAccount.description || '',
          accountNumber: editingAccount.accountNumber || '',
          creditLimit: editingAccount.creditLimit ? String(editingAccount.creditLimit) : '',
          interestRate: editingAccount.interestRate ? String(editingAccount.interestRate) : '',
          billingDate: editingAccount.billingDate ? String(editingAccount.billingDate) : '',
          provider: editingAccount.provider || '',
        });
      } else {
        setFormData({
          name: '',
          type: 'asset',
          description: '',
          accountNumber: '',
          creditLimit: '',
          interestRate: '',
          billingDate: '',
          provider: '',
        });
      }
      setFormError('');
    }
  }, [isOpen, editingAccount]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setFormError('Account name is required');
      return;
    }

    setIsSubmitting(true);
    setFormError('');

    try {
      const payload: any = {
        name: formData.name.trim(),
        type: formData.type,
        description: formData.description || null,
        accountNumber: formData.accountNumber || null,
        provider: formData.provider || null,
      };

      // Add liability-specific fields
      if (formData.type === 'liability') {
        if (formData.creditLimit) {
          payload.creditLimit = parseIdNominalToInt(formData.creditLimit);
        }
        if (formData.interestRate) {
          payload.interestRate = parseFloat(formData.interestRate);
        }
        if (formData.billingDate) {
          payload.billingDate = parseInt(formData.billingDate, 10);
        }
      }

      if (editingAccount) {
        await api.accounts.update(editingAccount.id, payload);
      } else {
        await api.accounts.create(payload);
      }

      onSaved();
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save account');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingAccount ? 'Edit account' : 'New account'}
      subtitle={editingAccount ? 'Update your account details' : 'Create a new wallet, bank account, or credit card'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Account Type Toggle */}
        <div className="inline-flex p-0.5 bg-[var(--ref-surface-container)] rounded-full">
          {[
            { value: 'asset', label: 'Asset', icon: Wallet },
            { value: 'liability', label: 'Liability', icon: CreditCard },
          ].map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setFormData({ ...formData, type: t.value as AccountType })}
                className={cn(
                  'cursor-pointer inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm transition-all',
                  formData.type === t.value
                    ? 'bg-[var(--ref-surface-container-lowest)] text-[var(--color-accent)] font-bold shadow-sm'
                    : 'text-[var(--color-text-secondary)] font-medium hover:text-[var(--color-accent)]',
                )}
              >
                <Icon className="w-4 h-4" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Account Name */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
            Account name
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder={formData.type === 'asset' ? 'e.g. BCA Savings, GoPay' : 'e.g. BNI Credit Card, Kredivo'}
            className="w-full bg-[var(--ref-surface-container-low)] border-none rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-[var(--color-accent)]/20 text-[var(--color-text-primary)] transition-all"
            required
          />
        </div>

        {/* Account Number */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
            Account number (optional)
          </label>
          <input
            type="text"
            value={formData.accountNumber}
            onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
            placeholder={formData.type === 'liability' ? 'e.g. ****1234' : 'e.g. 1234567890'}
            className="w-full bg-[var(--ref-surface-container-low)] border-none rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-[var(--color-accent)]/20 text-[var(--color-text-primary)] transition-all"
          />
        </div>

        {/* Provider (Liability only) */}
        {formData.type === 'liability' && (
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
              Provider (optional)
            </label>
            <div className="relative">
              <select
                value={formData.provider}
                onChange={(e) => setFormData({ ...formData, provider: e.target.value })}
                className="w-full appearance-none bg-[var(--ref-surface-container-low)] border-none rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-[var(--color-accent)]/20 text-[var(--color-text-primary)] transition-all"
              >
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]">
                ▾
              </span>
            </div>
          </div>
        )}

        {/* Liability-specific fields */}
        {formData.type === 'liability' && (
          <div className="grid grid-cols-3 gap-3">
            <CurrencyInput
              label="Credit limit"
              value={formData.creditLimit}
              onChange={(value) => setFormData({ ...formData, creditLimit: value })}
              size="sm"
              showDivider={false}
            />

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
                Interest %
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.interestRate}
                onChange={(e) => setFormData({ ...formData, interestRate: e.target.value })}
                placeholder="0%"
                className="w-full bg-[var(--ref-surface-container-low)] border-none rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-[var(--color-accent)]/20 text-[var(--color-text-primary)] transition-all text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
                Billing date
              </label>
              <input
                type="number"
                min="1"
                max="31"
                value={formData.billingDate}
                onChange={(e) => setFormData({ ...formData, billingDate: e.target.value })}
                placeholder="Day"
                className="w-full bg-[var(--ref-surface-container-low)] border-none rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-[var(--color-accent)]/20 text-[var(--color-text-primary)] transition-all text-sm"
              />
            </div>
          </div>
        )}

        {/* Description */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
            Notes (optional)
          </label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Add notes about this account..."
            rows={2}
            className="w-full bg-[var(--ref-surface-container-low)] border-none rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-[var(--color-accent)]/20 text-[var(--color-text-primary)] transition-all resize-none"
          />
        </div>

        {/* Footer */}
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} className="rounded-full py-2">
            Cancel
          </Button>
          <Button
            type="submit"
            isLoading={isSubmitting}
            className="rounded-full py-2 shadow-lg"
          >
            {editingAccount ? 'Save changes' : 'Create account'}
          </Button>
        </div>

        {formError && (
          <p className="text-sm text-[var(--color-danger)] text-center">{formError}</p>
        )}
      </form>
    </Modal>
  );
}
