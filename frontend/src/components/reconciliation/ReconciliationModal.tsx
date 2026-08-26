import { useState, useMemo, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { api } from '../../lib/api';
import { formatCurrency, parseSignedIdNominalToInt, cn, snapshotTimestampForLocalDate, toLocalDateInputValue } from '../../lib/utils';
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
  isValid: boolean;
};

type ReconciliationSession = {
  id: number;
  asOfDate: number;
  status: 'reconciled' | 'needs_classification' | 'recovered';
  kind?: 'control' | 'recovery';
  lifecycleStatus: 'active' | 'voided';
  voidedAt: number | null;
  voidReason: string | null;
  items: Array<{ id: number; accountId: number; accountName: string; difference: number }>;
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

function rowsFor(accounts: Account[]): ReconciliationRow[] {
  return accounts.filter(a => a.type === 'asset' || a.type === 'liability').map(a => ({
    accountId: a.id,
    accountName: a.name,
    ledgerBalance: a.balance,
    actualBalance: formatCurrency(a.balance),
    difference: 0,
    hasChanges: false,
    isValid: true,
  }));
}

export function ReconciliationModal({ isOpen, onClose, accounts, onSuccess }: ReconciliationModalProps) {
  const [rows, setRows] = useState<ReconciliationRow[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<ReconciliationSession[]>([]);
  const [voidingSessionId, setVoidingSessionId] = useState<number | null>(null);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [acknowledgement, setAcknowledgement] = useState('');
  const [recoveryNote, setRecoveryNote] = useState('');
  const [asOfDate, setAsOfDate] = useState(() => toLocalDateInputValue());

  const reconcilableAccounts = useMemo(() =>
    accounts.filter(a => a.type === 'asset' || a.type === 'liability'),
    [accounts]
  );

  useEffect(() => {
    if (isOpen) {
      setRows(rowsFor(reconcilableAccounts));
      setError(null);
      setResultMessage(null);
      setRecoveryMode(false);
      setAcknowledgement('');
      setRecoveryNote('');
      setAsOfDate(toLocalDateInputValue());
      void api.accounts.reconciliationHistory().then(({ sessions }) => setHistory(sessions)).catch(() => setHistory([]));
    }
  }, [isOpen, reconcilableAccounts]);

  const handleRecoveryModeChange = async (enabled: boolean) => {
    setRecoveryMode(enabled);
    setError(null);
    if (!enabled) return;
    try {
      // A recovery snapshot must include all active assets/liabilities even if
      // the Accounts page is currently searched or filtered.
      const allAccounts = await api.accounts.list();
      setRows(rowsFor(allAccounts));
    } catch (err) {
      setRecoveryMode(false);
      setError((err as Error).message || 'Failed to load the complete recovery snapshot');
    }
  };

  const handleVoid = async (session: ReconciliationSession) => {
    const reason = window.prompt(`Why should reconciliation #${session.id} be voided?`);
    if (reason == null) return;
    if (!reason.trim()) {
      setError('A reason is required to void a reconciliation check');
      return;
    }
    setVoidingSessionId(session.id);
    setError(null);
    try {
      await api.accounts.voidReconciliation(session.id, reason.trim());
      const { sessions } = await api.accounts.reconciliationHistory();
      setHistory(sessions);
    } catch (err) {
      setError((err as Error).message || 'Failed to void reconciliation');
    } finally {
      setVoidingSessionId(null);
    }
  };

  const handleActualBalanceChange = (index: number, value: string) => {
    const actual = parseSignedIdNominalToInt(value);
    const ledger = rows[index].ledgerBalance;
    const isValid = Number.isSafeInteger(actual) && (!recoveryMode || actual >= 0);
    const diff = isValid ? actual - ledger : Number.NaN;

    const newRows = [...rows];
    newRows[index] = {
      ...newRows[index],
      actualBalance: value,
      difference: diff,
      hasChanges: isValid && diff !== 0,
      isValid,
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
      isValid: true,
    };
    setRows(newRows);
  };

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        const actual = parseSignedIdNominalToInt(row.actualBalance);
        return {
          ledger: acc.ledger + row.ledgerBalance,
          actual: acc.actual + (Number.isSafeInteger(actual) ? actual : 0),
          diff: acc.diff + (Number.isFinite(row.difference) ? row.difference : 0),
        };
      },
      { ledger: 0, actual: 0, diff: 0 }
    );
  }, [rows]);

  const hasChanges = rows.some(r => r.hasChanges);
  const hasInvalid = rows.some(r => !r.isValid);

  const handleSubmit = async () => {
    if (hasInvalid || rows.length === 0) {
      setError(recoveryMode
        ? 'Enter a valid non-negative whole-rupiah balance for every account'
        : 'Enter a valid signed whole-rupiah balance for every account');
      return;
    }
    if (recoveryMode && acknowledgement.trim().length < 12) {
      setError('Acknowledge that the historical gap is untracked before posting a recovery bridge');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const balances = rows.map(r => ({
          accountId: r.accountId,
          actualBalance: parseSignedIdNominalToInt(r.actualBalance),
        }));
      if (recoveryMode) {
        const snapshotAt = snapshotTimestampForLocalDate(asOfDate);
        if (snapshotAt == null) {
          throw new Error('Choose a current or historical snapshot date');
        }
        const response = await api.accounts.recoveryReconcile({
          balances,
          asOfDate: snapshotAt,
          acknowledgement: acknowledgement.trim(),
          note: recoveryNote.trim() || null,
          confirmed: true,
        });
        setResultMessage(response.message);
        onSuccess();
        onClose();
        return;
      }
      const response = await api.accounts.reconcile(balances);
      setResultMessage(response.message);
      if (response.success) {
        onSuccess();
        onClose();
      } else {
        setRows(current => current.map(row => {
          const result = response.results.find(item => item.accountId === row.accountId);
          return result ? { ...row, difference: result.difference, hasChanges: result.difference !== 0 } : row;
        }));
      }
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
      subtitle={recoveryMode
        ? "Record your return snapshot. Every asset and liability is required; differences post once to a disclosed historical-recovery equity bridge."
        : "Record a dated balance check. Differences are flagged for review and never auto-posted as income or expense."}
      className="max-w-2xl"
    >
      <div className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}
        {resultMessage && !error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 text-amber-800 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {resultMessage}
          </div>
        )}

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-3">
          <label className="flex cursor-pointer items-start gap-3 text-sm text-[var(--ref-on-surface)]">
            <input
              type="checkbox"
              checked={recoveryMode}
              onChange={(event) => void handleRecoveryModeChange(event.target.checked)}
              className="mt-1"
            />
            <span>
              <span className="font-semibold">I am returning after an untracked period</span>
              <span className="mt-1 block text-xs text-[var(--ref-on-surface-variant)]">
                Use this only when you will not backfill the gap. It updates balances through an auditable equity bridge, never income or spending.
              </span>
            </span>
          </label>
          {recoveryMode && (
            <div className="mt-3 space-y-3 border-t border-[var(--color-border)] pt-3">
              <Input label="Balance snapshot date" type="date" value={asOfDate} max={toLocalDateInputValue()} onChange={(event) => setAsOfDate(event.target.value)} />
              <Input
                label="Acknowledgement"
                value={acknowledgement}
                onChange={(event) => setAcknowledgement(event.target.value)}
                placeholder="I understand this gap is historically untracked"
              />
              <label className="block text-sm font-medium text-[var(--ref-on-surface)]">
                Optional note
                <textarea
                  value={recoveryNote}
                  onChange={(event) => setRecoveryNote(event.target.value)}
                  maxLength={1000}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-transparent p-2 text-sm"
                  placeholder="For example: Returned after May–August break; statements not being imported."
                />
              </label>
            </div>
          )}
        </div>

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
                    row.hasChanges && "font-bold",
                    !row.isValid && "border-red-500"
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

        {history.length > 0 && (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ref-on-surface-variant)]">Recent balance checks</p>
            <div className="space-y-2">
              {history.slice(0, 5).map((session) => (
                <div key={session.id} className="flex items-center justify-between gap-3 text-xs">
                  <span className="min-w-0 text-[var(--ref-on-surface-variant)]">
                    {new Date(session.asOfDate).toLocaleDateString('en-ID')} · {session.items.length} accounts · {session.status.replace('_', ' ')}
                    {session.lifecycleStatus === 'voided' && ' · VOIDED'}
                  </span>
                  {session.lifecycleStatus === 'active' && session.kind !== 'recovery' && (
                    <button
                      type="button"
                      onClick={() => handleVoid(session)}
                      disabled={voidingSessionId !== null}
                      className="shrink-0 text-[var(--color-danger)] underline disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {voidingSessionId === session.id ? 'Voiding…' : 'Void'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={hasInvalid || rows.length === 0 || isSubmitting}
            className="gap-2"
          >
            {isSubmitting ? (
              'Processing...'
            ) : recoveryMode ? (
              <>
                <Check className="w-4 h-4" />
                Post recovery bridge {hasChanges && `(${rows.filter(r => r.hasChanges).length} differences)`}
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                Record check {hasChanges && `(${rows.filter(r => r.hasChanges).length} differences)`}
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
