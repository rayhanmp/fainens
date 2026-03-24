import { useState, useMemo, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { api } from '../../lib/api';
import { formatCurrency, parseIdNominalToInt, cn } from '../../lib/utils';
import { Check, AlertCircle, Wallet, Building2, CreditCard } from 'lucide-react';

type Account = {
  id: number;
  name: string;
  type: string;
  balance: number;
  icon?: string | null;
};

type ReconciliationRow = {
  accountId: number;
  accountName: string;
  ledgerBalance: number;
  actualBalance: string;
  difference: number;
  hasChanges: boolean;
};

interface ReconciliationModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: Account[];
  onSuccess: () => void;
}

function AccountIcon({ name }: { name: string }) {
  const lowerName = name.toLowerCase();
  if (lowerName.includes('bank') || lowerName.includes('bca') || lowerName.includes('bni') || lowerName.includes('mandiri') || lowerName.includes('bri')) {
    return <Building2 className="w-4 h-4" />;
  }
  if (lowerName.includes('card') || lowerName.includes('kartu')) {
    return <CreditCard className="w-4 h-4" />;
  }
  return <Wallet className="w-4 h-4" />;
}

export function ReconciliationModal({ isOpen, onClose, accounts, onSuccess }: ReconciliationModalProps) {
  const [rows, setRows] = useState<ReconciliationRow[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assetAccounts = useMemo(() => 
    accounts.filter(a => a.type === 'asset'),
    [accounts]
  );

  useEffect(() => {
    if (isOpen) {
      setRows(assetAccounts.map(a => ({
        accountId: a.id,
        accountName: a.name,
        ledgerBalance: a.balance,
        actualBalance: formatCurrency(a.balance),
        difference: 0,
        hasChanges: false,
      })));
      setError(null);
    }
  }, [isOpen, assetAccounts]);

  const handleActualBalanceChange = (index: number, value: string) => {
    const actual = parseIdNominalToInt(value);
    const ledger = rows[index].ledgerBalance;
    const diff = actual - ledger;

    const newRows = [...rows];
    newRows[index] = {
      ...newRows[index],
      actualBalance: value,
      difference: diff,
      hasChanges: diff !== 0,
    };
    setRows(newRows);
  };

  const handleResetToLedger = (index: number) => {
    const row = rows[index];
    const newRows = [...rows];
    newRows[index] = {
      ...row,
      actualBalance: formatCurrency(row.ledgerBalance),
      difference: 0,
      hasChanges: false,
    };
    setRows(newRows);
  };

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        const actual = parseIdNominalToInt(row.actualBalance);
        return {
          ledger: acc.ledger + row.ledgerBalance,
          actual: acc.actual + actual,
          diff: acc.diff + row.difference,
        };
      },
      { ledger: 0, actual: 0, diff: 0 }
    );
  }, [rows]);

  const hasChanges = rows.some(r => r.hasChanges);

  const handleSubmit = async () => {
    if (!hasChanges) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const balances = rows
        .filter(r => r.hasChanges)
        .map(r => ({
          accountId: r.accountId,
          actualBalance: parseIdNominalToInt(r.actualBalance),
        }));

      if (balances.length === 0) {
        setError('No changes to reconcile');
        return;
      }

      await api.accounts.reconcile(balances);
      onSuccess();
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Failed to reconcile');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Reconciliation"
      subtitle="Enter actual balance from your bank/e-wallet. Differences create income or expense transactions."
      className="max-w-2xl"
    >
      <div className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="space-y-2">
          {rows.map((row, idx) => (
            <div 
              key={row.accountId} 
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg border transition-colors",
                row.hasChanges 
                  ? "bg-[var(--ref-secondary-container)]/30 border-[var(--ref-secondary)]/30" 
                  : "bg-[var(--ref-surface-container-lowest)] border-[var(--color-border)]"
              )}
            >
              <div className="w-8 h-8 rounded-full bg-[var(--ref-primary-container)] flex items-center justify-center text-[var(--ref-on-primary-container)]">
                <AccountIcon name={row.accountName} />
              </div>
              
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--ref-on-surface)] truncate">{row.accountName}</p>
                <p className="text-xs text-[var(--ref-on-surface-variant)]">
                  Ledger: <span className="font-mono">{formatCurrency(row.ledgerBalance)}</span>
                </p>
              </div>

              <div className="w-32">
                <Input
                  type="text"
                  value={row.actualBalance}
                  onChange={(e) => handleActualBalanceChange(idx, e.target.value)}
                  className={cn(
                    "text-right font-mono text-sm",
                    row.hasChanges && "font-bold"
                  )}
                />
              </div>

              <div className={cn(
                "w-24 text-right font-mono text-sm font-semibold",
                row.difference > 0 && "text-green-600",
                row.difference < 0 && "text-red-600",
                row.difference === 0 && "text-[var(--ref-on-surface-variant)]"
              )}>
                {row.hasChanges ? (
                  <>
                    {row.difference > 0 ? '+' : ''}{formatCurrency(row.difference)}
                  </>
                ) : (
                  <span className="text-xs">Matched</span>
                )}
              </div>

              {row.hasChanges && (
                <button
                  type="button"
                  onClick={() => handleResetToLedger(idx)}
                  className="text-xs text-[var(--ref-outline)] hover:text-[var(--ref-on-surface)] underline"
                >
                  Reset
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Summary */}
        <div className={cn(
          "flex items-center justify-between p-4 rounded-lg border",
          hasChanges 
            ? "bg-[var(--ref-secondary-container)] border-[var(--ref-secondary)]/30" 
            : "bg-[var(--ref-surface-container-lowest)] border-[var(--color-border)]"
        )}>
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-[var(--ref-on-surface)]">Summary</span>
            <span className="text-xs text-[var(--ref-on-surface-variant)]">
              Ledger Total: <span className="font-mono font-semibold">{formatCurrency(totals.ledger)}</span>
            </span>
            <span className="text-xs text-[var(--ref-on-surface-variant)]">
              Actual Total: <span className="font-mono font-semibold">{formatCurrency(totals.actual)}</span>
            </span>
          </div>
          <div className={cn(
            "font-mono font-bold",
            totals.diff > 0 && "text-green-600",
            totals.diff < 0 && "text-red-600",
            totals.diff === 0 && "text-[var(--ref-on-surface)]"
          )}>
            {totals.diff !== 0 ? (totals.diff > 0 ? '+' : '') + formatCurrency(totals.diff) : 'Balanced'}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!hasChanges || isSubmitting}
            className="gap-2"
          >
            {isSubmitting ? (
              'Processing...'
            ) : (
              <>
                <Check className="w-4 h-4" />
                Reconcile {hasChanges && `(${rows.filter(r => r.hasChanges).length})`}
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
