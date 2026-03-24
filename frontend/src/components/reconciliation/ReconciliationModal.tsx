import { useState, useMemo, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { api } from '../../lib/api';
import { formatCurrency, parseIdNominalToInt } from '../../lib/utils';
import { Check, AlertCircle } from 'lucide-react';

type Account = {
  id: number;
  name: string;
  type: string;
  balance: number;
};

type ReconciliationRow = {
  accountId: number;
  accountName: string;
  ledgerBalance: number;
  actualBalance: string;
  difference: number;
};

interface ReconciliationModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: Account[];
  onSuccess: () => void;
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
        actualBalance: '',
        difference: 0,
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

  const hasChanges = rows.some(r => r.difference !== 0);

  const handleSubmit = async () => {
    if (!hasChanges) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const balances = rows
        .filter(r => r.difference !== 0 && r.actualBalance !== '')
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
      subtitle="Enter the actual balance from your bank/e-wallet apps. Differences will be created as income or expense transactions."
      className="max-w-2xl"
    >
      <div className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--ref-surface-container)]">
              <tr>
                <th className="text-left p-3 font-semibold text-[var(--ref-on-surface)]">Account</th>
                <th className="text-right p-3 font-semibold text-[var(--ref-on-surface)]">Ledger Balance</th>
                <th className="text-right p-3 font-semibold text-[var(--ref-on-surface)]">Actual Balance</th>
                <th className="text-right p-3 font-semibold text-[var(--ref-on-surface)]">Difference</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={row.accountId} className="border-t border-[var(--color-border)]">
                  <td className="p-3 text-[var(--ref-on-surface)]">{row.accountName}</td>
                  <td className="p-3 text-right font-mono text-[var(--ref-on-surface)]">
                    {formatCurrency(row.ledgerBalance)}
                  </td>
                  <td className="p-2">
                    <Input
                      type="text"
                      value={row.actualBalance}
                      onChange={(e) => handleActualBalanceChange(idx, e.target.value)}
                      placeholder="Enter actual"
                      className="text-right font-mono"
                    />
                  </td>
                  <td className={`p-3 text-right font-mono font-semibold ${
                    row.difference > 0 ? 'text-green-600' : 
                    row.difference < 0 ? 'text-red-600' : 
                    'text-[var(--ref-on-surface-variant)]'
                  }`}>
                    {row.difference !== 0 ? (row.difference > 0 ? '+' : '') + formatCurrency(row.difference) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-[var(--ref-surface-container-lowest)] font-semibold">
              <tr>
                <td className="p-3 text-[var(--ref-on-surface)]">Total</td>
                <td className="p-3 text-right font-mono text-[var(--ref-on-surface)]">
                  {formatCurrency(totals.ledger)}
                </td>
                <td className="p-3"></td>
                <td className={`p-3 text-right font-mono ${
                  totals.diff > 0 ? 'text-green-600' : 
                  totals.diff < 0 ? 'text-red-600' : 
                  'text-[var(--ref-on-surface-variant)]'
                }`}>
                  {totals.diff !== 0 ? (totals.diff > 0 ? '+' : '') + formatCurrency(totals.diff) : '—'}
                </td>
              </tr>
            </tfoot>
          </table>
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
                Reconcile {hasChanges && `(${rows.filter(r => r.difference !== 0).length} accounts)`}
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
