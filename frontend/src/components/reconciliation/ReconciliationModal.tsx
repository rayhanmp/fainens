import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { useState, useMemo, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { CurrencyInput } from '../ui/CurrencyInput';
import { useConfirm } from '../ui/ConfirmDialog';
import { formatCurrency, parseSignedIdNominalToInt, cn, snapshotTimestampForLocalDate, toLocalDateInputValue } from '../../lib/utils';
import { AlertCircle, ArrowDownRight, ArrowUpRight, Building2, Check, CheckCircle2, ChevronDown, CircleHelp, Clock3, CreditCard, History, Search, ShieldCheck, Wallet } from 'lucide-react';
import { useAccountsLedgerQuery, useReconciliationHistoryQuery } from '../../features/accounts/queries';
import {
  useCreateRecoveryReconciliationMutation,
  useCreateReconciliationMutation,
  useVoidReconciliationMutation,
} from '../../features/reconciliation/queries';

type Account = {
  id: number;
  name: string;
  type: string;
  balance: number;
  icon?: string | null;
  systemKey?: string | null;
};

type ReconciliationRow = {
  accountId: number;
  accountName: string;
  accountType: 'asset' | 'liability';
  ledgerBalance: number;
  actualBalance: string;
  difference: number;
  isChecked: boolean;
  hasChanges: boolean;
  isValid: boolean;
};

type AccountFilter = 'all' | 'unchecked' | 'differences';

type ReconciliationSession = {
  id: number;
  asOfDate: number;
  status: 'reconciled' | 'adjusted' | 'needs_classification' | 'recovered';
  kind?: 'control' | 'recovery' | 'adjustment' | 'opening_balance';
  lifecycleStatus: 'active' | 'voided';
  voidedAt: number | null;
  voidReason: string | null;
  items: Array<{ id: number; accountId: number; accountName: string; ledgerBalance: number; actualBalance: number; difference: number; status: string }>;
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

function rowsFor(accounts: Account[], includeSystemAccounts = false): ReconciliationRow[] {
  return accounts.filter(a => (a.type === 'asset' || a.type === 'liability') && (includeSystemAccounts || !a.systemKey)).map(a => ({
    accountId: a.id,
    accountName: a.name,
    accountType: a.type as 'asset' | 'liability',
    ledgerBalance: a.balance,
    actualBalance: '',
    difference: 0,
    isChecked: false,
    hasChanges: false,
    isValid: true,
  }));
}

export function ReconciliationModal({ isOpen, onClose, accounts, onSuccess }: ReconciliationModalProps) {
  const { formatAmount } = useBalanceVisibility();
  const [rows, setRows] = useState<ReconciliationRow[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [voidingSessionId, setVoidingSessionId] = useState<number | null>(null);
  const [pendingVoidSessionId, setPendingVoidSessionId] = useState<number | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [isLoadingRecoveryAccounts, setIsLoadingRecoveryAccounts] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [acknowledgement, setAcknowledgement] = useState('');
  const [note, setNote] = useState('');
  const [noteExpanded, setNoteExpanded] = useState(false);
  const [accountFilter, setAccountFilter] = useState<AccountFilter>('all');
  const [accountSearch, setAccountSearch] = useState('');
  const [expandedSessionId, setExpandedSessionId] = useState<number | null>(null);
  const [asOfDate, setAsOfDate] = useState(() => toLocalDateInputValue());
  const { confirm } = useConfirm();
  const historyQuery = useReconciliationHistoryQuery();
  const allAccountsQuery = useAccountsLedgerQuery();
  const createReconciliationMutation = useCreateReconciliationMutation();
  const createRecoveryMutation = useCreateRecoveryReconciliationMutation();
  const voidReconciliationMutation = useVoidReconciliationMutation();
  const history = (historyQuery.data?.sessions ?? []) as ReconciliationSession[];

  const reconcilableAccounts = useMemo(() =>
    accounts.filter(a => (a.type === 'asset' || a.type === 'liability') && !a.systemKey),
    [accounts]
  );

  useEffect(() => {
    if (isOpen) {
      setRows(rowsFor(reconcilableAccounts));
      setError(null);
      setResultMessage(null);
      setRecoveryMode(false);
      setAcknowledgement('');
      setNote('');
      setNoteExpanded(false);
      setAccountFilter('all');
      setAccountSearch('');
      setPendingVoidSessionId(null);
      setVoidReason('');
      setExpandedSessionId(null);
      setAsOfDate(toLocalDateInputValue());
    }
  }, [isOpen, reconcilableAccounts]);

  const handleRecoveryModeChange = async (enabled: boolean) => {
    if (enabled === recoveryMode || isLoadingRecoveryAccounts) return;
    if (rows.some((row) => row.isChecked) || note.trim() || acknowledgement.trim()) {
      const confirmed = await confirm({
        title: 'Switch reconciliation flow?',
        message: 'Switching modes clears the balances entered in this draft. Continue?',
        confirmLabel: 'Switch flow',
        variant: 'warning',
      });
      if (!confirmed) return;
    }
    setError(null);
    setResultMessage(null);
    setNote('');
    setAcknowledgement('');
    setAccountFilter('all');
    setAccountSearch('');
    if (!enabled) {
      setRecoveryMode(false);
      setRows(rowsFor(reconcilableAccounts));
      return;
    }
    // A recovery snapshot must include all active assets/liabilities even if
    // the Accounts page is currently searched or filtered.
    setIsLoadingRecoveryAccounts(true);
    try {
      const result = await allAccountsQuery.refetch();
      if (result.error || !result.data) {
        setError(result.error?.message || 'Failed to load the complete recovery snapshot');
        return;
      }
      setRecoveryMode(true);
      setRows(rowsFor(result.data, true));
    } catch (err) {
      setError((err as Error).message || 'Failed to load the complete recovery snapshot');
    } finally {
      setIsLoadingRecoveryAccounts(false);
    }
  };

  const handleVoid = async (session: ReconciliationSession) => {
    setVoidingSessionId(session.id);
    setError(null);
    try {
      await voidReconciliationMutation.mutateAsync({ id: session.id, reason: voidReason.trim() });
      setPendingVoidSessionId(null);
      setVoidReason('');
    } catch (err) {
      setError((err as Error).message || 'Failed to void reconciliation');
    } finally {
      setVoidingSessionId(null);
    }
  };

  const handleActualBalanceChange = (index: number, value: string) => {
    const actual = parseSignedIdNominalToInt(value);
    const ledger = rows[index].ledgerBalance;
    const isChecked = value.trim().length > 0;
    const isValid = !isChecked || (Number.isSafeInteger(actual) && actual >= 0);
    const diff = isChecked && isValid ? actual - ledger : 0;

    const newRows = [...rows];
    newRows[index] = {
      ...newRows[index],
      actualBalance: value,
      difference: diff,
      isChecked,
      hasChanges: isChecked && isValid && diff !== 0,
      isValid,
    };
    setRows(newRows);
  };

  const handleUseLedgerBalance = (index: number) => {
    const row = rows[index];
    const newRows = [...rows];
    newRows[index] = {
      ...row,
      actualBalance: new Intl.NumberFormat('id-ID').format(row.ledgerBalance),
      difference: 0,
      isChecked: true,
      hasChanges: false,
      isValid: true,
    };
    setRows(newRows);
  };

  const handleClearBalance = (index: number) => {
    const row = rows[index];
    const newRows = [...rows];
    newRows[index] = { ...row, actualBalance: '', difference: 0, isChecked: false, hasChanges: false, isValid: true };
    setRows(newRows);
  };

  const selectedRows = useMemo(() => rows.filter((row) => row.isChecked), [rows]);
  const filteredRows = useMemo(() => rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => {
      if (accountFilter === 'unchecked' && row.isChecked) return false;
      if (accountFilter === 'differences' && !row.hasChanges) return false;
      return row.accountName.toLowerCase().includes(accountSearch.trim().toLowerCase());
    }), [rows, accountFilter, accountSearch]);

  const totals = useMemo(() => {
    return selectedRows.reduce(
      (acc, row) => {
        const actual = parseSignedIdNominalToInt(row.actualBalance);
        return {
          ledger: acc.ledger + row.ledgerBalance,
          actual: acc.actual + (Number.isSafeInteger(actual) ? actual : 0),
          ledgerAssets: acc.ledgerAssets + (row.accountType === 'asset' ? row.ledgerBalance : 0),
          actualAssets: acc.actualAssets + (row.accountType === 'asset' && Number.isSafeInteger(actual) ? actual : 0),
          ledgerLiabilities: acc.ledgerLiabilities + (row.accountType === 'liability' ? row.ledgerBalance : 0),
          actualLiabilities: acc.actualLiabilities + (row.accountType === 'liability' && Number.isSafeInteger(actual) ? actual : 0),
          diff: acc.diff + (Number.isFinite(row.difference) ? row.difference : 0),
          absoluteDiff: acc.absoluteDiff + (Number.isFinite(row.difference) ? Math.abs(row.difference) : 0),
          differentAccounts: acc.differentAccounts + (row.hasChanges ? 1 : 0),
        };
      },
      { ledger: 0, actual: 0, ledgerAssets: 0, actualAssets: 0, ledgerLiabilities: 0, actualLiabilities: 0, diff: 0, absoluteDiff: 0, differentAccounts: 0 }
    );
  }, [selectedRows]);

  const hasChanges = selectedRows.some((row) => row.hasChanges);
  const hasInvalid = selectedRows.some((row) => !row.isValid);
  const matchedCount = selectedRows.filter((row) => row.isValid && !row.hasChanges).length;
  const snapshotTimestamp = snapshotTimestampForLocalDate(asOfDate);

  const handleSubmit = async () => {
    if (selectedRows.length === 0) {
      setError('Check at least one account before saving this snapshot');
      return;
    }
    if (hasInvalid) {
      setError('Enter a valid non-negative whole-rupiah balance for every checked account');
      return;
    }
    if (snapshotTimestamp == null) {
      setError('Choose a valid snapshot date');
      return;
    }
    if (recoveryMode && selectedRows.length !== rows.length) {
      setError('A catch-up snapshot needs a real balance for every active asset and liability');
      return;
    }
    if (recoveryMode && acknowledgement.trim().length < 12) {
      setError('Acknowledge that the historical gap is untracked before posting a recovery bridge');
      return;
    }
    if (!recoveryMode && hasChanges) {
      const changedRows = selectedRows.filter((row) => row.hasChanges);
      const changedCount = changedRows.length;
      const changeList = changedRows.slice(0, 4).map((row) => `${row.accountName}: ${formatCurrency(row.ledgerBalance)} → ${formatCurrency(parseSignedIdNominalToInt(row.actualBalance))}`).join('; ');
      const moreChanges = changedRows.length > 4 ? `; and ${changedRows.length - 4} more` : '';
      const confirmed = await confirm({
        title: 'Align account balances?',
        message: `${changedCount} account${changedCount === 1 ? '' : 's'} differ (${changeList}${moreChanges}). The total absolute difference is ${formatCurrency(totals.absoluteDiff)}. Post these to Balance adjustments? They update balances without counting as income, expense, budget spending, or ordinary cash flow.`,
        confirmLabel: 'Align balances',
        variant: 'warning',
      });
      if (!confirmed) return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const balances = selectedRows.map(r => ({
          accountId: r.accountId,
          actualBalance: parseSignedIdNominalToInt(r.actualBalance),
        }));
      if (recoveryMode) {
        const response = await createRecoveryMutation.mutateAsync({
          balances,
          asOfDate: snapshotTimestamp,
          acknowledgement: acknowledgement.trim(),
          note: note.trim() || null,
          confirmed: true,
        });
        setResultMessage(response.message);
        onSuccess();
        onClose();
        return;
      }
      const response = await createReconciliationMutation.mutateAsync({
        balances,
        confirmed: hasChanges,
        asOfDate: snapshotTimestamp,
        note: note.trim() || null,
      });
      setResultMessage(response.message);
      if (response.success) {
        onSuccess();
        onClose();
      }
    } catch (err) {
      setError((err as Error).message || 'Failed to reconcile');
    } finally {
      setIsSubmitting(false);
    }
  };

  const reviewDisabled = isSubmitting || isLoadingRecoveryAccounts || rows.length === 0 || selectedRows.length === 0 || hasInvalid || snapshotTimestamp == null || (recoveryMode && (selectedRows.length !== rows.length || acknowledgement.trim().length < 12));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Reconcile balances"
      subtitle="Compare the balances you can verify with what Fainens has recorded."
      size="xl"
      className="max-h-[92vh]"
      footer={(
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--ref-outline)]">Snapshot summary</p>
            <p className="mt-1 text-sm text-[var(--ref-on-surface)]">
              <span className="font-semibold">{selectedRows.length} of {rows.length} verified</span>
              {hasChanges && <span className="ml-2 text-[var(--ref-error)]">· {totals.differentAccounts} need adjustment</span>}
            </p>
          </div>
          <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => void handleSubmit()} disabled={reviewDisabled} className="gap-2">
              {isSubmitting || isLoadingRecoveryAccounts ? <Clock3 className="h-4 w-4 animate-pulse" /> : recoveryMode ? <ShieldCheck className="h-4 w-4" /> : <Check className="h-4 w-4" />}
              {isSubmitting ? 'Saving snapshot…' : isLoadingRecoveryAccounts ? 'Loading accounts…' : recoveryMode ? 'Save catch-up snapshot' : hasChanges ? `Review ${totals.differentAccounts} adjustment${totals.differentAccounts === 1 ? '' : 's'}` : 'Save verified balances'}
            </Button>
          </div>
        </div>
      )}
    >
      <div className="space-y-5 pb-1">
        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-2xl border border-[var(--ref-error)]/25 bg-[var(--ref-error)]/5 p-3 text-sm text-[var(--ref-error)]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}
          </div>
        )}
        {resultMessage && (
          <div role="status" className="flex items-start gap-2 rounded-2xl border border-[var(--ref-secondary)]/25 bg-[var(--ref-secondary)]/5 p-3 text-sm text-[var(--ref-on-surface)]">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ref-secondary)]" />{resultMessage}
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2" aria-label="Choose reconciliation flow">
          <button
            type="button"
            aria-pressed={!recoveryMode}
            onClick={() => void handleRecoveryModeChange(false)}
            disabled={isLoadingRecoveryAccounts}
            className={cn(
              'rounded-2xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ref-primary)]',
              !recoveryMode ? 'border-[var(--ref-primary)] bg-[var(--ref-primary)]/5 ring-1 ring-[var(--ref-primary)]/20' : 'border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] hover:bg-[var(--ref-surface-container-low)]',
            )}
          >
            <span className="flex items-center gap-2 text-sm font-bold text-[var(--ref-on-surface)]"><CheckCircle2 className={cn('h-4 w-4', !recoveryMode ? 'text-[var(--ref-primary)]' : 'text-[var(--ref-outline)]')} />Routine check</span>
            <span className="mt-1 block pl-6 text-xs leading-5 text-[var(--ref-on-surface-variant)]">Verify any accounts you can check against a bank, wallet, or card balance.</span>
          </button>
          <button
            type="button"
            aria-pressed={recoveryMode}
            onClick={() => void handleRecoveryModeChange(true)}
            disabled={isLoadingRecoveryAccounts}
            className={cn(
              'rounded-2xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ref-primary)]',
              recoveryMode ? 'border-[var(--ref-primary)] bg-[var(--ref-primary)]/5 ring-1 ring-[var(--ref-primary)]/20' : 'border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] hover:bg-[var(--ref-surface-container-low)]',
            )}
          >
            <span className="flex items-center gap-2 text-sm font-bold text-[var(--ref-on-surface)]"><History className={cn('h-4 w-4', recoveryMode ? 'text-[var(--ref-primary)]' : 'text-[var(--ref-outline)]')} />Catch up after a gap</span>
            <span className="mt-1 block pl-6 text-xs leading-5 text-[var(--ref-on-surface-variant)]">Use only if you won’t backfill missed history. Requires every account.</span>
          </button>
        </div>

        {recoveryMode && (
          <div className="rounded-2xl border border-yellow-400/60 bg-yellow-100/60 p-4 text-sm text-black">
            <div className="flex items-start gap-3">
              <CircleHelp className="mt-0.5 h-5 w-5 shrink-0 text-yellow-800" />
              <div className="min-w-0 flex-1">
                <p className="font-bold">This records a one-time historical bridge</p>
                <p className="mt-1 text-xs leading-5 text-black/80">Choose this only when transactions from the missing period will not be entered. The adjustment is disclosed separately; it is not income or spending.</p>
                <div className="mt-3 max-w-xl">
                  <Input
                    label="Confirm you understand"
                    labelClassName="!text-black"
                    className="border-slate-400 bg-white text-black placeholder:text-slate-500"
                    value={acknowledgement}
                    onChange={(event) => setAcknowledgement(event.target.value)}
                    placeholder="I understand this period is untracked"
                    error={acknowledgement.length > 0 && acknowledgement.trim().length < 12 ? 'Please enter at least 12 characters.' : undefined}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        <section className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)]">
          <div className="flex flex-col gap-4 border-b border-[var(--color-border)] bg-[var(--ref-surface-container-low)]/60 p-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-[var(--ref-primary)]">Step 1 · Verify balances</p>
              <h3 className="mt-1 text-lg font-bold text-[var(--ref-on-surface)]">What do your accounts show?</h3>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--ref-on-surface-variant)]">Enter balances for checked accounts. Blank accounts are skipped.</p>
            </div>
            <div className="w-full sm:max-w-[190px]">
              <Input label="Balance date" type="date" value={asOfDate} max={toLocalDateInputValue()} onChange={(event) => setAsOfDate(event.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-3 border-b border-[var(--color-border)] p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter accounts">
              {([
                ['all', `All · ${rows.length}`],
                ['unchecked', `Not checked · ${rows.length - selectedRows.length}`],
                ['differences', `Differences · ${totals.differentAccounts}`],
              ] as Array<[AccountFilter, string]>).map(([filter, label]) => (
                <button
                  key={filter}
                  type="button"
                  aria-pressed={accountFilter === filter}
                  onClick={() => setAccountFilter(filter)}
                  className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors', accountFilter === filter ? 'border-[var(--ref-primary)] bg-[var(--ref-primary)] text-white' : 'border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]')}
                >{label}</button>
              ))}
            </div>
            <label className="relative block w-full lg:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ref-outline)]" aria-hidden />
              <input
                type="search"
                value={accountSearch}
                onChange={(event) => setAccountSearch(event.target.value)}
                placeholder="Find an account"
                aria-label="Find an account"
                className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] py-2 pl-9 pr-3 text-sm text-[var(--ref-on-surface)] placeholder:text-[var(--ref-outline)] focus:border-[var(--ref-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ref-primary)]/15"
              />
            </label>
          </div>

          <div className="hidden grid-cols-[minmax(0,1fr)_minmax(170px,220px)_150px] gap-3 px-5 pb-2 pt-4 text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--ref-outline)] sm:grid">
            <span>Account · balance in Fainens</span><span>Balance you verified</span><span className="text-right">Check result</span>
          </div>
          <div>
            {(['asset', 'liability'] as const).map((accountType) => {
              const groupRows = filteredRows.filter(({ row }) => row.accountType === accountType);
              if (groupRows.length === 0) return null;
              const isAsset = accountType === 'asset';
              return (
                <section key={accountType} aria-label={isAsset ? 'Asset accounts' : 'Liability accounts'}>
                  <div className="flex items-center justify-between gap-3 border-y border-[var(--color-border)] bg-[var(--ref-surface-container-low)]/70 px-4 py-3 sm:px-5">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className={cn('rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.12em]', isAsset ? 'bg-[#DBEAFE] text-[#1E40AF]' : 'bg-[#EDE9FE] text-[#5B21B6]')}>{isAsset ? 'Assets' : 'Liabilities'}</span>
                      <span className="truncate text-xs text-[var(--ref-on-surface-variant)]">{isAsset ? 'Money you own' : 'Money you owe'}</span>
                    </div>
                    <span className="shrink-0 text-[10px] font-semibold text-[var(--ref-outline)]">{groupRows.length} account{groupRows.length === 1 ? '' : 's'}</span>
                  </div>
                  <div className="divide-y divide-[var(--color-border)]">
                    {groupRows.map(({ row, index }) => (
              <div key={row.accountId} className={cn('grid grid-cols-1 gap-3 px-4 py-4 transition-colors sm:grid-cols-[minmax(0,1fr)_minmax(170px,220px)_150px] sm:items-center sm:px-5', row.hasChanges && 'bg-amber-50/50 dark:bg-amber-950/10')}>
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--ref-primary-container)] text-[var(--ref-on-primary-container)]"><AccountIcon name={row.accountName} /></div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-[var(--ref-on-surface)]">{row.accountName}</p>
                    <p className="mt-0.5 text-xs text-[var(--ref-on-surface-variant)]">In Fainens <span className="font-mono font-semibold text-[var(--ref-on-surface)]">{formatAmount(row.ledgerBalance)}</span></p>
                  </div>
                </div>
                <div>
                  <CurrencyInput
                    label={`Actual balance for ${row.accountName}`}
                    labelClassName="sr-only"
                    value={row.actualBalance}
                    onChange={(value) => handleActualBalanceChange(index, value)}
                    placeholder="0"
                    size="sm"
                    className="space-y-0"
                    showDivider={false}
                    error={row.isChecked && !row.isValid ? (parseSignedIdNominalToInt(row.actualBalance) < 0 ? 'Balance can’t be negative.' : 'Enter a valid whole-rupiah balance.') : undefined}
                  />
                  <button type="button" onClick={() => row.isChecked ? handleClearBalance(index) : handleUseLedgerBalance(index)} className="mt-1.5 text-[11px] font-semibold text-[var(--ref-primary)] hover:underline">
                    {row.isChecked ? 'Clear this check' : 'Mark as matching'}
                  </button>
                </div>
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold', !row.isChecked ? 'bg-[#E2E8F0] text-[#334155]' : !row.isValid ? 'bg-[#FEE2E2] text-[#991B1B]' : row.hasChanges ? 'bg-[#FEF3C7] text-[#78350F]' : 'bg-[#DCFCE7] text-[#166534]')}>
                    {!row.isChecked ? <><CircleHelp className="h-3.5 w-3.5" />Not checked</> : !row.isValid ? <><AlertCircle className="h-3.5 w-3.5" />Invalid amount</> : row.hasChanges ? <>{row.difference > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}{formatAmount(Math.abs(row.difference))} difference</> : <><CheckCircle2 className="h-3.5 w-3.5" />Matches</>}
                  </span>
                </div>
              </div>
                    ))}
                  </div>
                </section>
              );
            })}
            {filteredRows.length === 0 && (
              <div className="px-5 py-10 text-center text-sm text-[var(--ref-on-surface-variant)]">
                {rows.length === 0 ? 'No active asset or liability accounts to check.' : accountSearch ? 'No accounts match that search.' : accountFilter === 'differences' ? 'No differences found in the checked accounts.' : 'Every account has been checked.'}
              </div>
            )}
          </div>
        </section>

        <section className={cn('rounded-2xl border p-4 sm:p-5', hasChanges ? 'border-amber-300/80 bg-amber-50/60 dark:border-amber-800/60 dark:bg-amber-950/15' : 'border-[var(--color-border)] bg-[var(--ref-surface-container-low)]/60')}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--ref-outline)]">Step 2 · Review snapshot</p>
              <h3 className="mt-1 text-base font-bold text-[var(--ref-on-surface)]">{hasChanges ? 'Differences will be recorded separately' : selectedRows.length ? 'Verified balances are ready' : 'Check an account to get started'}</h3>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--ref-on-surface-variant)]">{hasChanges ? 'After you confirm, differences update account balances through Balance adjustments—not income, expenses, budgets, or ordinary cash flow.' : recoveryMode ? 'A one-time historical bridge is posted only after every account and the acknowledgement are complete.' : 'Blank accounts are skipped. You can reconcile the remaining accounts later.'}</p>
            </div>
            {hasChanges && <span className="rounded-full bg-amber-200/70 px-3 py-1.5 text-xs font-bold text-amber-950 dark:bg-amber-900/40 dark:text-amber-100">{totals.differentAccounts} adjustment{totals.differentAccounts === 1 ? '' : 's'}</span>}
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl bg-[var(--ref-surface-container-lowest)]/85 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--ref-outline)]">Verified</p><p className="mt-1 text-lg font-extrabold text-[var(--ref-on-surface)]">{selectedRows.length}<span className="ml-1 text-xs font-medium text-[var(--ref-outline)]">/ {rows.length}</span></p></div>
            <div className="rounded-xl bg-[var(--ref-surface-container-lowest)]/85 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--ref-outline)]">Matches</p><p className="mt-1 text-lg font-extrabold text-[var(--ref-on-surface)]">{matchedCount}</p></div>
            <div className="rounded-xl bg-[var(--ref-surface-container-lowest)]/85 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--ref-outline)]">Total difference</p><p className="mt-1 truncate font-mono text-lg font-extrabold text-[var(--ref-on-surface)]">{formatAmount(totals.absoluteDiff)}</p></div>
          </div>
          {selectedRows.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-[var(--ref-on-surface-variant)]">
              <span>Assets: {formatAmount(totals.actualAssets)} actual <span className="text-[var(--ref-outline)]">vs {formatAmount(totals.ledgerAssets)} in app</span></span>
              <span>Liabilities: {formatAmount(totals.actualLiabilities)} actual <span className="text-[var(--ref-outline)]">vs {formatAmount(totals.ledgerLiabilities)} in app</span></span>
            </div>
          )}
          {hasChanges && (
            <div className="mt-4 space-y-2 border-t border-amber-300/60 pt-3 dark:border-amber-800/50">
              <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-amber-900 dark:text-amber-100">Adjustments to review</p>
              {selectedRows.filter((row) => row.hasChanges).map((row) => (
                <div key={row.accountId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
                  <span className="min-w-0 font-semibold text-[var(--ref-on-surface)]">{row.accountName}<span className="ml-2 font-normal text-[var(--ref-on-surface-variant)]">{formatAmount(row.ledgerBalance)} → {formatAmount(parseSignedIdNominalToInt(row.actualBalance))}</span></span>
                  <span className="shrink-0 font-mono font-bold text-amber-900 dark:text-amber-100">{row.difference > 0 ? '+' : '−'}{formatAmount(Math.abs(row.difference))}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)]">
          <button type="button" aria-expanded={noteExpanded} onClick={() => setNoteExpanded((open) => !open)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
            <span className="text-sm font-semibold text-[var(--ref-on-surface)]">Add a note <span className="font-normal text-[var(--ref-outline)]">· optional</span></span><ChevronDown className={cn('h-4 w-4 text-[var(--ref-outline)] transition-transform', noteExpanded && 'rotate-180')} />
          </button>
          {noteExpanded && <div className="border-t border-[var(--color-border)] p-4"><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={2} className="w-full resize-y rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-3 text-sm text-[var(--ref-on-surface)] placeholder:text-[var(--ref-outline)] focus:border-[var(--ref-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ref-primary)]/15" placeholder={recoveryMode ? 'For example: Returned after a break; older statements are unavailable.' : 'For example: Checked BNI and e-Money balances against the app today.'} /></div>}
        </div>

        {history.length > 0 && (
          <details className="group rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2 text-sm font-semibold text-[var(--ref-on-surface)]"><History className="h-4 w-4 text-[var(--ref-primary)]" />Recent reconciliation history <span className="rounded-full bg-[var(--ref-surface-container-low)] px-2 py-0.5 text-[10px] text-[var(--ref-outline)]">{history.length}</span></span>
              <ChevronDown className="h-4 w-4 text-[var(--ref-outline)] transition-transform group-open:rotate-180" />
            </summary>
            <div className="space-y-2 border-t border-[var(--color-border)] p-3">
              {history.slice(0, 8).map((session) => {
                const adjusted = session.items.filter((item) => item.difference !== 0);
                const label = session.kind === 'opening_balance' ? 'Opening balance' : session.kind === 'adjustment' ? 'Balance adjustments' : session.kind === 'recovery' ? 'Catch-up bridge' : session.status === 'reconciled' ? 'Matched check' : session.status.replaceAll('_', ' ');
                return (
                  <article key={session.id} className="rounded-xl bg-[var(--ref-surface-container-low)] p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <button type="button" aria-expanded={expandedSessionId === session.id} onClick={() => setExpandedSessionId((current) => current === session.id ? null : session.id)} className="min-w-0 flex-1 text-left">
                        <span className="flex flex-wrap items-center gap-2"><span className="text-sm font-bold capitalize text-[var(--ref-on-surface)]">{label}</span><span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', session.lifecycleStatus === 'voided' ? 'bg-[var(--ref-error)]/10 text-[var(--ref-error)]' : adjusted.length ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/25 dark:text-emerald-100')}>{session.lifecycleStatus === 'voided' ? 'Voided' : adjusted.length ? `${adjusted.length} adjusted` : 'Matched'}</span></span>
                        <span className="mt-1 block text-xs text-[var(--ref-on-surface-variant)]">{new Date(session.asOfDate).toLocaleDateString('en-ID')} · {session.items.length} account{session.items.length === 1 ? '' : 's'}{adjusted.length ? ` · ${formatAmount(adjusted.reduce((sum, item) => sum + Math.abs(item.difference), 0))} total difference` : ''}</span>
                      </button>
                      {session.lifecycleStatus === 'active' && (session.kind ?? 'control') === 'control' && (
                        <button type="button" onClick={() => { setPendingVoidSessionId((current) => current === session.id ? null : session.id); setVoidReason(''); }} className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-[var(--ref-error)] hover:bg-[var(--ref-error)]/5">{pendingVoidSessionId === session.id ? 'Cancel void' : 'Void check'}</button>
                      )}
                    </div>
                    {pendingVoidSessionId === session.id && (
                      <div className="mt-3 flex flex-col gap-2 border-t border-[var(--color-border)] pt-3 sm:flex-row sm:items-end">
                        <div className="min-w-0 flex-1"><Input label="Why are you voiding this check?" value={voidReason} onChange={(event) => setVoidReason(event.target.value)} placeholder="For example: entered the wrong statement balance" /></div>
                        <Button size="sm" variant="danger" disabled={!voidReason.trim() || voidingSessionId !== null} onClick={() => void handleVoid(session)}>{voidingSessionId === session.id ? 'Voiding…' : 'Confirm void'}</Button>
                      </div>
                    )}
                    {expandedSessionId === session.id && (
                      <div className="mt-3 space-y-1.5 border-t border-[var(--color-border)] pt-3">
                        {session.items.map((item) => (
                          <div key={item.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                            <span className="min-w-0 text-[var(--ref-on-surface-variant)]">{item.accountName}<span className="mx-1.5 text-[var(--ref-outline)]">·</span>{formatAmount(item.ledgerBalance)} <span className="text-[var(--ref-outline)]">→</span> {formatAmount(item.actualBalance)}</span>
                            <span className={cn('shrink-0 font-mono font-semibold', item.difference > 0 ? 'text-[var(--ref-secondary)]' : item.difference < 0 ? 'text-[var(--ref-error)]' : 'text-[var(--ref-outline)]')}>{item.difference > 0 ? '+' : item.difference < 0 ? '−' : ''}{formatAmount(Math.abs(item.difference))}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </details>
        )}
      </div>
    </Modal>
  );
}
