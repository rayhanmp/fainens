import { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { CurrencyInput } from '../ui/CurrencyInput';
import { api } from '../../lib/api';
import { formatCurrency, cn } from '../../lib/utils';
import { ArrowUpRight, ArrowDownRight, Wallet, Landmark, Banknote, CheckCircle2 } from 'lucide-react';

interface Loan {
  id: number;
  contactId: number;
  direction: 'lent' | 'borrowed';
  amountCents: number;
  remainingCents: number;
  contact: { id: number; name: string };
}

interface RecordPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  loan: Loan;
}

const WALLET_ICONS = [Landmark, Wallet, Banknote] as const;

export function RecordPaymentModal({ isOpen, onClose, onSuccess, loan }: RecordPaymentModalProps) {
  const [accounts, setAccounts] = useState<Array<{ id: number; name: string; type: string }>>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  
  const [formData, setFormData] = useState({
    amount: (loan.remainingCents / 100).toLocaleString('id-ID'),
    rawAmount: loan.remainingCents.toString(),
    paymentDate: new Date().toISOString().split('T')[0],
    paymentTime: new Date().toTimeString().slice(0, 5),
    notes: '',
    walletAccountId: '',
  });

  useEffect(() => {
    if (isOpen) {
      api.accounts.list({ type: 'asset' }).then((data) => {
        setAccounts(data.filter(a => a.type === 'asset' && !a.systemKey));
      });
    }
  }, [isOpen]);

  const handleAmountChange = (value: string) => {
    const rawValue = value.replace(/[^\d]/g, '');
    setFormData({ 
      ...formData, 
      amount: value,
      rawAmount: rawValue
    });
  };

  const handleFullPayment = () => {
    setFormData({
      ...formData,
      amount: (loan.remainingCents / 100).toLocaleString('id-ID'),
      rawAmount: loan.remainingCents.toString(),
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!formData.rawAmount || !formData.walletAccountId) {
      setError('Please fill in all required fields');
      return;
    }

    const amountCents = parseInt(formData.rawAmount);
    if (amountCents <= 0 || isNaN(amountCents)) {
      setError('Amount must be greater than 0');
      return;
    }

    if (amountCents > loan.remainingCents) {
      setError(`Amount cannot exceed remaining balance of ${formatCurrency(loan.remainingCents)}`);
      return;
    }

    setIsSubmitting(true);
    try {
      const [hours, minutes] = formData.paymentTime.split(':').map(Number);
    const paymentDateWithTime = new Date(formData.paymentDate);
    paymentDateWithTime.setHours(hours, minutes, 0, 0);
    
    await api.loans.recordPayment(loan.id, {
        amountCents,
        paymentDate: paymentDateWithTime.getTime(),
        notes: formData.notes || undefined,
        walletAccountId: parseInt(formData.walletAccountId),
      });
      
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record payment');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isRepaying = loan.direction === 'borrowed';
  const amountCents = parseInt(formData.rawAmount) || 0;
  const selectedWallet = accounts.find(a => a.id.toString() === formData.walletAccountId);

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      title={isRepaying ? 'Repay Loan' : 'Record Payment'}
      subtitle={isRepaying ? `Pay back ${loan.contact.name}` : `Receive payment from ${loan.contact.name}`}
      size="xl"
      className="max-w-3xl"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          <Button 
            type="button" 
            variant="secondary"
            onClick={onClose}
            className="rounded-full py-3 sm:min-w-[120px]"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="payment-form"
            isLoading={isSubmitting}
            className="rounded-full py-3 shadow-lg sm:min-w-[200px]"
          >
            <CheckCircle2 className="w-5 h-5 mr-2" />
            {isRepaying ? 'Confirm Payment' : 'Record Payment'}
          </Button>
        </div>
      }
    >
      <form id="payment-form" onSubmit={handleSubmit} className="flex flex-col gap-0">
        {error && (
          <div className="p-4 bg-[var(--ref-error-container)] text-[var(--ref-on-error-container)] rounded-xl text-sm font-medium mb-4">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
          {/* Main Content - Left Column */}
          <div className="lg:col-span-8 space-y-6 lg:space-y-8">
            {/* Direction Indicator */}
            <div className="inline-flex p-0.5 bg-[var(--ref-surface-container)] rounded-full">
              <div className={cn(
                'inline-flex items-center gap-1.5 px-4 sm:px-5 py-2 rounded-full text-sm font-bold',
                isRepaying 
                  ? 'bg-[var(--ref-error)] text-white' 
                  : 'bg-[var(--ref-secondary)] text-white'
              )}>
                {isRepaying ? (
                  <>
                    <ArrowDownRight className="w-3.5 h-3.5" />
                    Repaying
                  </>
                ) : (
                  <>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                    Receiving
                  </>
                )}
              </div>
            </div>

            {/* Amount */}
            <div className="relative">
              <CurrencyInput
                label="Payment Amount"
                value={formData.amount}
                onChange={handleAmountChange}
                size="lg"
                required
              />
              <button
                type="button"
                onClick={handleFullPayment}
                className="absolute right-0 top-8 text-sm text-[var(--color-accent)] hover:underline font-medium"
              >
                Full amount
              </button>
            </div>

            {/* Payment Date & Time */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
                Payment Date & Time
              </label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={formData.paymentDate}
                  onChange={(e) => setFormData({ ...formData, paymentDate: e.target.value })}
                  className="flex-1 bg-[var(--ref-surface-container-low)] border-none rounded-xl px-3 py-3 focus:ring-2 focus:ring-[var(--color-accent)]/20 text-[var(--color-text-primary)] transition-all"
                  required
                />
                <input
                  type="time"
                  value={formData.paymentTime}
                  onChange={(e) => setFormData({ ...formData, paymentTime: e.target.value })}
                  className="w-32 bg-[var(--ref-surface-container-low)] border-none rounded-xl px-3 py-3 focus:ring-2 focus:ring-[var(--color-accent)]/20 text-[var(--color-text-primary)] transition-all"
                  required
                />
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
                Notes <span className="text-[var(--color-muted)]">(optional)</span>
              </label>
              <input
                type="text"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="e.g., Bank transfer, Cash payment"
                className="w-full bg-[var(--ref-surface-container-low)] border-none rounded-xl px-3 py-3 focus:ring-2 focus:ring-[var(--color-accent)]/20 text-[var(--color-text-primary)] transition-all"
              />
            </div>

            {/* Wallet Selection */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
                {isRepaying ? 'Pay from' : 'Receive to'}
              </label>
              <div className="grid grid-cols-1 gap-2">
                {accounts.map((account, idx) => {
                  const Icon = WALLET_ICONS[idx % 3];
                  const selected = formData.walletAccountId === account.id.toString();
                  return (
                    <button
                      key={account.id}
                      type="button"
                      onClick={() => setFormData({ ...formData, walletAccountId: account.id.toString() })}
                      className={cn(
                        'flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left',
                        selected
                          ? 'border-[var(--ref-primary)] bg-[var(--ref-surface-container-low)]'
                          : 'border-transparent bg-[var(--ref-surface-container-low)] hover:border-[var(--ref-primary)]/30'
                      )}
                    >
                      <div className={cn(
                        'w-8 h-8 rounded-lg flex items-center justify-center',
                        selected ? 'bg-[var(--ref-primary-container)]' : 'bg-[var(--ref-surface-container-high)]'
                      )}>
                        <Icon className={cn(
                          'w-4 h-4',
                          selected ? 'text-[var(--ref-on-primary-container)]' : 'text-[var(--color-muted)]'
                        )} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          'font-medium text-sm truncate',
                          selected ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-primary)]'
                        )}>
                          {account.name}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Sidebar - Right Column */}
          <div className="lg:col-span-4 space-y-6">
            {/* Loan Summary */}
            <div className="p-5 bg-[var(--ref-surface-container-low)] rounded-xl border border-[var(--color-border)]">
              <p className="font-label text-xs text-[var(--color-muted)] uppercase tracking-wider mb-4">Loan Summary</p>
              
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-[var(--color-muted)]">Contact</span>
                  <span className="font-semibold text-sm">{loan.contact.name}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-[var(--color-muted)]">Original</span>
                  <span className="font-medium text-sm">{formatCurrency(loan.amountCents)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-[var(--color-muted)]">Remaining</span>
                  <span className="font-bold text-sm text-[var(--color-primary)]">{formatCurrency(loan.remainingCents)}</span>
                </div>
              </div>
            </div>

            {/* Transaction Preview */}
            {(formData.walletAccountId || amountCents > 0) && (
              <div className="p-5 bg-[var(--ref-surface-container-low)] rounded-xl border border-[var(--color-border)]">
                <p className="font-label text-xs text-[var(--color-muted)] uppercase tracking-wider mb-3">Transaction Preview</p>
                <div className="space-y-2 text-sm">
                  {!isRepaying ? (
                    <>
                      <div className="flex justify-between">
                        <span className="text-[var(--color-muted)]">Debit</span>
                        <span className="font-medium">{selectedWallet?.name || 'Selected Wallet'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--color-muted)]">Credit</span>
                        <span className="font-medium">Loans Receivable</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex justify-between">
                        <span className="text-[var(--color-muted)]">Debit</span>
                        <span className="font-medium">Loans Payable</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--color-muted)]">Credit</span>
                        <span className="font-medium">{selectedWallet?.name || 'Selected Wallet'}</span>
                      </div>
                    </>
                  )}
                  {amountCents > 0 && (
                    <div className="pt-2 border-t border-[var(--color-border)] flex justify-between">
                      <span className="font-label text-xs text-[var(--color-muted)] uppercase">Amount</span>
                      <span className="font-headline font-bold text-[var(--color-primary)]">
                        {formatCurrency(amountCents)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </form>
    </Modal>
  );
}
