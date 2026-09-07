import { createFileRoute, Link } from '@tanstack/react-router';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { PageHeader } from '../components/ui/PageHeader';
import { PageContainer } from '../components/ui/PageContainer';
import { useConfirm } from '../components/ui/ConfirmDialog';
import { RequireAuth } from '../lib/auth';
import { useEffect, useMemo, useState } from 'react';
import { formatCurrency, cn } from '../lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { useAccountDashboardQuery, useAccountsLedgerQuery, useDeleteAccountMutation, useReconciliationHistoryQuery, useRestoreAccountMutation } from '../features/accounts/queries';
import { queryKeys } from '../features/core/query-keys';
import { AccountModal } from '../components/accounts/AccountModal';
import { ReconciliationModal } from '../components/reconciliation/ReconciliationModal';
import {
  Plus,
  Edit2,
  Archive,
  Wallet,
  CreditCard,
  RefreshCw,
  Search,
  X,
  Download,
  Scale,
  WalletCards,
  Banknote,
  Clock3,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

export const Route = createFileRoute('/accounts')({
  component: AccountsPage,
} as any);

type AccountRow = {
  id: number;
  name: string;
  type: string;
  icon: string | null;
  color: string | null;
  sortOrder: number;
  systemKey: string | null;
  isActive: boolean;
  balance: number;
  parentId: number | null;
  liquidityClass: 'cash_equivalent' | 'receivable' | 'investment' | 'non_cash';
  description: string | null;
  creditLimit: number | null;
  accountNumber: string | null;
  provider: string | null;
};

/** Buckets aligned with Stitch Financial Command Center columns */
type LedgerBucket = 'cash' | 'ewallet' | 'investment' | 'receivable' | 'creditcard' | 'paylater';

function bucketAccount(a: AccountRow): LedgerBucket {
  const n = `${a.name} ${a.provider ?? ''}`.toLowerCase();
  if (a.type === 'liability') {
    if (/pay\s*later|traveloka|kredivo|akulaku|split|defer|humm|afterpay|shopee\s*pay\s*later/.test(n)) {
      return 'paylater';
    }
    return 'creditcard';
  }
  if (/pay\s*later|traveloka|kredivo|akulaku/.test(n)) return 'paylater';
  if (/credit|visa|mastercard|jcb|amex|kartu|precious|signature|platinum/.test(n)) return 'creditcard';
  if (a.liquidityClass === 'investment') return 'investment';
  if (a.liquidityClass === 'receivable') return 'receivable';
  if (/gopay|ovo|dana|shopee|linkaja|grabpay|gopay|e-?wallet|ewallet|tokopedia\s*pay/.test(n)) {
    return 'ewallet';
  }
  return 'cash';
}

function maskAccountNumber(accountNumber: string | null | undefined) {
  if (!accountNumber) return null;
  const compact = accountNumber.replace(/\s/g, '');
  return compact ? `•••• ${compact.slice(-4)}` : null;
}

function formatShortDate(value: number | null | undefined) {
  if (!value) return null;
  return new Intl.DateTimeFormat('en-ID', { day: 'numeric', month: 'short' }).format(new Date(value));
}

function downloadAccountsCsv(rows: AccountRow[]) {
  const header = 'Name,Type,Liquidity,Identifier,Balance (IDR)\n';
  const body = rows
    .map((a) => {
      const name = a.name.replace(/"/g, '""');
      const identifier = maskAccountNumber(a.accountNumber) ?? '';
      return `"${name}",${a.type},${a.liquidityClass},"${identifier}",${a.balance}`;
    })
    .join('\n');
  const blob = new Blob([header + body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const el = document.createElement('a');
  el.href = url;
  el.download = `accounts-${new Date().toISOString().slice(0, 10)}.csv`;
  el.click();
  URL.revokeObjectURL(url);
}

function AccountsPage() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isReconciliationOpen, setIsReconciliationOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AccountRow | null>(null);
  const { confirm } = useConfirm();

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'asset' | 'liability'>('all');

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(searchInput.trim()), 350);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  const accountParams = useMemo(() => {
    const params: { type?: string; search?: string; includeInactive?: boolean } = {};
    if (typeFilter !== 'all') params.type = typeFilter;
    if (debouncedSearch) params.search = debouncedSearch;
    if (showArchived) params.includeInactive = true;
    return params;
  }, [debouncedSearch, showArchived, typeFilter]);
  const accountsQuery = useAccountsLedgerQuery(accountParams);
  const allAccountsQuery = useAccountsLedgerQuery(showArchived ? { includeInactive: true } : undefined);
  const dashboardQuery = useAccountDashboardQuery();
  const reconciliationQuery = useReconciliationHistoryQuery(25);
  const deleteAccountMutation = useDeleteAccountMutation();
  const restoreAccountMutation = useRestoreAccountMutation();
  const accounts = (accountsQuery.data ?? []) as AccountRow[];
  const allAccounts = (allAccountsQuery.data ?? []) as AccountRow[];
  const reconciliationSessions = reconciliationQuery.data?.sessions ?? [];
  const isLoading = accountsQuery.isLoading || allAccountsQuery.isLoading || dashboardQuery.isLoading || reconciliationQuery.isLoading;
  const loadError = accountsQuery.error || allAccountsQuery.error || dashboardQuery.error || reconciliationQuery.error;
  const lastLoadedAt = Math.max(accountsQuery.dataUpdatedAt, allAccountsQuery.dataUpdatedAt, dashboardQuery.dataUpdatedAt, reconciliationQuery.dataUpdatedAt) || null;
  const dashboardSummary = dashboardQuery.data?.netWorth;
  const summary = dashboardSummary
    ? { totalAssets: dashboardSummary.totalAssets, totalLiabilities: dashboardSummary.totalLiabilities, netWorth: dashboardSummary.netWorth }
    : allAccounts.length > 0
      ? allAccounts.reduce((totals, account) => {
        if (account.systemKey) return totals;
        if (account.type === 'asset') totals.totalAssets += account.balance;
        if (account.type === 'liability') totals.totalLiabilities += Math.abs(account.balance);
        totals.netWorth = totals.totalAssets - totals.totalLiabilities;
        return totals;
      }, { totalAssets: 0, totalLiabilities: 0, netWorth: 0 })
      : null;
  const loadAccounts = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
  };

  const userAccounts = useMemo(
    () => accounts.filter((a) => !a.systemKey),
    [accounts],
  );

  const isFilteredQuery =
    debouncedSearch.length > 0 || typeFilter !== 'all';

  const latestReconciliationByAccount = useMemo(() => {
    const result = new Map<number, { asOfDate: number; status: string; difference: number }>();
    for (const session of reconciliationSessions) {
      if (session.lifecycleStatus === 'voided') continue;
      for (const item of session.items) {
        if (!result.has(item.accountId)) {
          result.set(item.accountId, {
            asOfDate: session.asOfDate,
            status: item.status,
            difference: item.difference,
          });
        }
      }
    }
    return result;
  }, [reconciliationSessions]);

  const reconciliationSummary = useMemo(() => {
    const checked = userAccounts.filter((account) => latestReconciliationByAccount.has(account.id));
    const issues = checked.filter((account) => latestReconciliationByAccount.get(account.id)?.difference !== 0);
    const latest = checked
      .map((account) => latestReconciliationByAccount.get(account.id)?.asOfDate ?? 0)
      .filter(Boolean)
      .sort((a, b) => b - a)[0] ?? null;
    return { checked: checked.length, issues: issues.length, total: userAccounts.length, latest };
  }, [latestReconciliationByAccount, userAccounts]);

  const buckets = useMemo(() => {
    const m: Record<LedgerBucket, AccountRow[]> = {
      cash: [],
      ewallet: [],
      investment: [],
      receivable: [],
      creditcard: [],
      paylater: [],
    };
    for (const a of userAccounts) {
      m[bucketAccount(a)].push(a);
    }
    return m;
  }, [userAccounts]);

  const handleDelete = async (id: number) => {
    const confirmed = await confirm({
      title: 'Archive account',
      message: 'Archive this account? Its history will be kept, but it will no longer be available for new entries.',
      confirmLabel: 'Archive',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await deleteAccountMutation.mutateAsync(id);
      await loadAccounts();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handleRestore = async (id: number) => {
    try {
      await restoreAccountMutation.mutateAsync(id);
      await loadAccounts();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const openModal = (account?: AccountRow) => {
    if (account) {
      setEditingAccount(account);
    } else {
      setEditingAccount(null);
    }
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingAccount(null);
  };

  const payLaterTotal = useMemo(
    () => buckets.paylater.reduce((s, a) => s + Math.abs(a.balance), 0),
    [buckets.paylater],
  );
  const isInitialLoading = isLoading && allAccounts.length === 0;

  return (
    <RequireAuth>
      <PageContainer>
        {/* Stitch: Command Center top bar (content only — shell has sidebar) */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <PageHeader
            subtext="Account overview"
            title="Accounts"
            description="See what you have, what you owe, and how recently each balance was checked."
          />
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            <div className="hidden min-w-0 flex-1 items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)]/80 px-3 py-1.5 sm:flex sm:max-w-xs md:max-w-sm">
              <Search className="h-3.5 w-3.5 shrink-0 text-[var(--ref-outline)]" aria-hidden />
              <input
                type="search"
                placeholder="Search wealth ledger…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="min-w-0 flex-1 border-0 bg-transparent text-xs font-medium text-[var(--ref-on-surface)] outline-none placeholder:text-[var(--ref-outline)]"
              />
              {searchInput ? (
                <button
                  type="button"
                  className="rounded-full p-1 text-[var(--ref-outline)] hover:bg-[var(--ref-surface-container-highest)]"
                  onClick={() => setSearchInput('')}
                  aria-label="Clear"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="rounded-full"
                disabled={isLoading || userAccounts.length === 0}
                onClick={() => downloadAccountsCsv(userAccounts)}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Export
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="rounded-full"
                disabled={isLoading}
                onClick={() => void loadAccounts()}
              >
                <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', isLoading && 'animate-spin')} />
                Refresh
              </Button>
              <Button type="button" size="sm" className="rounded-full" onClick={() => openModal()}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add account
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="rounded-full"
                onClick={() => setIsReconciliationOpen(true)}
              >
                <Scale className="mr-1.5 h-3.5 w-3.5" />
                Reconcile
              </Button>
            </div>
          </div>
        </div>

        {loadError && (
          <div className="flex flex-col gap-3 rounded-2xl border border-[var(--ref-error)]/30 bg-[var(--ref-error-container)]/20 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ref-error)]" aria-hidden />
              <div>
                <p className="text-sm font-semibold text-[var(--ref-on-surface)]">Couldn’t refresh account balances</p>
                <p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">
                  {lastLoadedAt
                    ? `Showing the last successful snapshot from ${new Date(lastLoadedAt).toLocaleTimeString('en-ID', { hour: '2-digit', minute: '2-digit' })}. Your balances were not replaced with zeroes.`
                    : 'No account snapshot is available yet. Your balances were not replaced with zeroes.'}
                </p>
              </div>
            </div>
            <Button type="button" variant="secondary" size="sm" className="rounded-full self-start sm:self-auto" onClick={() => void loadAccounts()}>
              Try again
            </Button>
          </div>
        )}

        {/* Mobile / sm search */}
        <div className="flex min-h-[40px] items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-3 py-2 sm:hidden">
          <Search className="h-4 w-4 shrink-0 text-[var(--ref-outline)]" aria-hidden />
          <input
            type="search"
            placeholder="Search wealth ledger…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="min-w-0 flex-1 border-0 bg-transparent text-sm text-[var(--ref-on-surface)] outline-none placeholder:text-[var(--ref-outline)]"
          />
        </div>

        {/* Position summary */}
        {isInitialLoading ? (
          <div className="h-40 animate-pulse rounded-3xl bg-[var(--ref-surface-container-highest)]/50" />
        ) : summary ? (
          <section className="mobile-summary-grid grid grid-cols-2 gap-2 md:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-2xl bg-[var(--ref-primary-container)] p-4 text-[var(--ref-on-primary-container)]"><Wallet className="h-4 w-4" /><p className="mt-3 text-[10px] font-extrabold uppercase tracking-[0.14em] opacity-70">Net worth</p><p className="mt-1 font-headline text-2xl font-extrabold tracking-tight">{formatCurrency(summary.netWorth)}</p><p className="mt-2 text-[11px] opacity-75">Assets less liabilities</p></article>
            <article className="rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-4"><Banknote className="h-4 w-4 text-[var(--ref-primary)]" /><p className="mt-3 text-[10px] font-extrabold uppercase tracking-[0.14em] text-[var(--ref-outline)]">Assets</p><p className="mt-1 font-headline text-xl font-extrabold tracking-tight text-[var(--ref-on-surface)]">{formatCurrency(summary.totalAssets)}</p><p className="mt-2 text-[11px] text-[var(--ref-on-surface-variant)]">Money and value you own</p></article>
            <article className="rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-4"><CreditCard className="h-4 w-4 text-rose-600 dark:text-rose-300" /><p className="mt-3 text-[10px] font-extrabold uppercase tracking-[0.14em] text-[var(--ref-outline)]">Liabilities</p><p className="mt-1 font-headline text-xl font-extrabold tracking-tight text-[var(--ref-on-surface)]">{formatCurrency(summary.totalLiabilities)}</p><p className="mt-2 text-[11px] text-[var(--ref-on-surface-variant)]">Cards, PayLater, and debts</p></article>
            <article className="rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] p-4"><CheckCircle2 className={cn('h-4 w-4', reconciliationSummary.issues > 0 ? 'text-[var(--ref-error)]' : 'text-[var(--ref-secondary)]')} /><p className="mt-3 text-[10px] font-extrabold uppercase tracking-[0.14em] text-[var(--ref-outline)]">Balance checks</p><p className="mt-1 font-headline text-xl font-extrabold tracking-tight text-[var(--ref-on-surface)]">{reconciliationSummary.checked}/{reconciliationSummary.total}</p><p className={cn('mt-2 text-[11px]', reconciliationSummary.issues > 0 ? 'text-[var(--ref-error)]' : 'text-[var(--ref-on-surface-variant)]')}>{reconciliationSummary.issues > 0 ? `${reconciliationSummary.issues} need attention` : lastLoadedAt ? `Updated ${new Date(lastLoadedAt).toLocaleTimeString('en-ID', { hour: '2-digit', minute: '2-digit' })}` : 'Reconcile to verify'}</p></article>
          </section>
        ) : null}

        {/* Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Select
            value={typeFilter === 'all' ? '' : typeFilter}
            onChange={(e) => {
              const v = e.target.value;
              setTypeFilter(!v ? 'all' : (v as 'asset' | 'liability'));
            }}
            options={[
              { value: '', label: 'All types' },
              { value: 'asset', label: 'Assets only' },
              { value: 'liability', label: 'Liabilities only' },
            ]}
            className="min-w-[168px] rounded-full border-[var(--color-border)] bg-[var(--ref-surface-container-low)] text-xs font-semibold"
          />
          <p className="text-xs text-[var(--ref-on-surface-variant)]">
            Grouped by account type and liquidity treatment.{' '}
            <span className="font-bold text-[var(--ref-on-surface)]">{userAccounts.length}</span> shown
          </p>
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--ref-on-surface-variant)]">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
        </div>

        {/* Account groups */}
        {isInitialLoading ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-4">
                <div className="h-4 w-32 animate-pulse rounded bg-[var(--ref-surface-container-highest)]/60" />
                <div className="h-28 animate-pulse rounded-xl bg-[var(--ref-surface-container-highest)]/40" />
                <div className="h-28 animate-pulse rounded-xl bg-[var(--ref-surface-container-highest)]/40" />
              </div>
            ))}
          </div>
        ) : userAccounts.length === 0 && loadError ? (
          <div className="rounded-2xl border border-dashed border-[var(--ref-error)]/30 bg-[var(--ref-surface-container-lowest)] px-6 py-14 text-center">
            <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-[var(--ref-error)] opacity-70" aria-hidden />
            <p className="font-headline text-base font-semibold text-[var(--ref-on-surface)]">Account data is unavailable</p>
            <p className="mt-2 text-sm text-[var(--ref-on-surface-variant)]">Try refreshing once the backend is reachable.</p>
          </div>
        ) : userAccounts.length === 0 && !isFilteredQuery ? (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-6 py-14 text-center editorial-shadow">
            <Wallet className="mx-auto mb-3 h-12 w-12 text-[var(--ref-outline)] opacity-50" aria-hidden />
            <p className="font-headline text-base font-semibold text-[var(--ref-on-surface)]">No accounts yet</p>
            <p className="mt-2 text-sm text-[var(--ref-on-surface-variant)]">
              Add wallets and liabilities to populate your command center.
            </p>
            <Button type="button" className="mt-6 rounded-full" onClick={() => openModal()}>
              <Plus className="mr-2 h-4 w-4" />
              Add account
            </Button>
          </div>
        ) : userAccounts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--color-border)] px-6 py-12 text-center">
            <Search className="mx-auto mb-2 h-10 w-10 text-[var(--ref-outline)] opacity-50" />
            <p className="font-headline font-semibold text-[var(--ref-on-surface)]">No matching accounts</p>
            <p className="mt-1 text-sm text-[var(--ref-on-surface-variant)]">Adjust search or filters.</p>
          </div>
        ) : (
          <section className="grid gap-4 xl:grid-cols-2">
            {buckets.cash.length > 0 && <LedgerColumn
              title="Cash & checking"
              accounts={buckets.cash}
              emptyHint="Bank, cash, savings"
              onEdit={openModal}
              onDelete={handleDelete}
              onRestore={handleRestore}
              cardVariant="cash"
              reconciliationByAccount={latestReconciliationByAccount}
            />}
            {buckets.ewallet.length > 0 && <LedgerColumn
              title="E-wallets"
              accounts={buckets.ewallet}
              emptyHint="GoPay, OVO, DANA…"
              onEdit={openModal}
              onDelete={handleDelete}
              onRestore={handleRestore}
              cardVariant="ewallet"
              reconciliationByAccount={latestReconciliationByAccount}
            />}
            {buckets.investment.length > 0 && (
              <LedgerColumn
                title="Investments"
                accounts={buckets.investment}
                emptyHint="Funds, stocks, crypto…"
                onEdit={openModal}
                onDelete={handleDelete}
                onRestore={handleRestore}
                cardVariant="investment"
                reconciliationByAccount={latestReconciliationByAccount}
              />
            )}
            {buckets.receivable.length > 0 && (
              <LedgerColumn
                title="Receivables"
                accounts={buckets.receivable}
                emptyHint="Money owed to you"
                onEdit={openModal}
                onDelete={handleDelete}
                onRestore={handleRestore}
                cardVariant="receivable"
                reconciliationByAccount={latestReconciliationByAccount}
              />
            )}
            {buckets.creditcard.length > 0 && <LedgerColumn
              title="Credit cards"
              accounts={buckets.creditcard}
              emptyHint="Cards & loans"
              onEdit={openModal}
              onDelete={handleDelete}
              onRestore={handleRestore}
              cardVariant="credit"
              reconciliationByAccount={latestReconciliationByAccount}
            />}
            {buckets.paylater.length > 0 && <LedgerColumn
              title="PayLater"
              accounts={buckets.paylater}
              emptyHint="Deferred liabilities"
              onEdit={openModal}
              onDelete={handleDelete}
              onRestore={handleRestore}
              cardVariant="paylater"
              footerSummary={payLaterTotal > 0 ? payLaterTotal : undefined}
              reconciliationByAccount={latestReconciliationByAccount}
            />}
          </section>
        )}

        <footer className="flex flex-col gap-2 border-t border-[var(--ref-outline-variant)]/20 pt-4 text-[10px] font-medium text-[var(--ref-outline)] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-4">
            <span className="uppercase tracking-tighter">Balances are ledger-based</span>
            <span className="uppercase tracking-tighter">Reconcile against your real statements</span>
          </div>
          <div className="flex flex-wrap gap-4 uppercase tracking-tighter">
            <span>Fainens · command center</span>
          </div>
        </footer>

        <AccountModal
          isOpen={isModalOpen}
          onClose={closeModal}
          onSaved={loadAccounts}
          editingAccount={editingAccount}
        />

        <ReconciliationModal
          isOpen={isReconciliationOpen}
          onClose={() => setIsReconciliationOpen(false)}
          accounts={allAccounts.length > 0 ? allAccounts : accounts}
          onSuccess={loadAccounts}
        />
      </PageContainer>
    </RequireAuth>
  );
}

function LedgerColumn({
  title,
  accounts,
  emptyHint,
  onEdit,
  onDelete,
  onRestore,
  cardVariant,
  footerSummary,
  reconciliationByAccount,
}: {
  title: string;
  accounts: AccountRow[];
  emptyHint: string;
  onEdit: (a: AccountRow) => void;
  onDelete: (id: number) => void;
  onRestore: (id: number) => void;
  cardVariant: 'cash' | 'ewallet' | 'investment' | 'receivable' | 'credit' | 'paylater';
  footerSummary?: number;
  reconciliationByAccount: Map<number, { asOfDate: number; status: string; difference: number }>;
}) {
  const countLabel =
    cardVariant === 'credit' && accounts.some((a) => a.type === 'liability')
      ? `${accounts.length} card${accounts.length === 1 ? '' : 's'}`
      : `${accounts.length} account${accounts.length === 1 ? '' : 's'}`;

  const total = accounts.reduce((sum, account) => sum + Math.abs(account.balance), 0);
  const accent = cardVariant === 'credit' || cardVariant === 'paylater'
    ? 'text-rose-600 dark:text-rose-300'
    : cardVariant === 'investment'
      ? 'text-violet-700 dark:text-violet-300'
      : 'text-[var(--ref-primary)]';

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-3 shadow-sm sm:p-4">
      <header className="flex items-start justify-between gap-4 border-b border-[var(--ref-outline-variant)]/20 pb-3">
        <div>
          <p className={cn('text-[10px] font-extrabold uppercase tracking-[0.16em]', accent)}>{title}</p>
          <p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">{accounts.length > 0 ? countLabel : emptyHint}</p>
        </div>
        {accounts.length > 0 && <div className="text-right"><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--ref-outline)]">{cardVariant === 'credit' || cardVariant === 'paylater' ? 'Total owed' : 'Total'}</p><p className="mt-1 font-headline text-base font-extrabold text-[var(--ref-on-surface)]">{formatCurrency(footerSummary ?? total)}</p></div>}
      </header>
      {accounts.length === 0 ? (
        <p className="py-5 text-center text-sm text-[var(--ref-on-surface-variant)]">No accounts here yet.</p>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {accounts.map((account) => <AccountTile key={account.id} account={account} variant={cardVariant} onEdit={() => onEdit(account)} onDelete={() => onDelete(account.id)} onRestore={() => onRestore(account.id)} reconciliation={reconciliationByAccount.get(account.id)} />)}
        </div>
      )}
    </section>
  );
}

function AccountTile({
  account: a,
  variant,
  darkCard,
  onEdit,
  onDelete,
  onRestore,
  reconciliation,
}: {
  account: AccountRow;
  variant: 'cash' | 'ewallet' | 'investment' | 'receivable' | 'credit' | 'paylater';
  darkCard?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onRestore: () => void;
  reconciliation?: { asOfDate: number; status: string; difference: number };
}) {
  const accent = a.color || 'var(--ref-primary-container)';
  const identifier = maskAccountNumber(a.accountNumber);

  const reconciliationLabel = reconciliation
    ? reconciliation.difference === 0
      ? `Checked ${formatShortDate(reconciliation.asOfDate)}`
      : `Review difference ${formatCurrency(Math.abs(reconciliation.difference))}`
    : 'Not checked yet';
  const reconciliationClass = reconciliation
    ? reconciliation.difference === 0
      ? 'text-[var(--ref-secondary)]'
      : 'text-[var(--ref-error)]'
    : 'text-[var(--ref-outline)]';

  const accountIdentifier = identifier ? `Account ${identifier}` : 'No account number added';
  const lifecycleAction = a.isActive ? onDelete : onRestore;
  const lifecycleLabel = a.isActive ? 'Archive' : 'Restore';
  const AccountIcon = variant === 'ewallet' ? WalletCards : variant === 'credit' ? CreditCard : variant === 'paylater' ? Clock3 : variant === 'investment' ? Scale : variant === 'receivable' ? Banknote : Wallet;
  const isLiability = a.type === 'liability';
  const displayBalance = isLiability ? Math.abs(a.balance) : a.balance;
  const tone = variant === 'credit' || variant === 'paylater'
    ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
    : variant === 'investment'
      ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300'
      : variant === 'ewallet'
        ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300'
        : 'bg-[var(--ref-primary)]/10 text-[var(--ref-primary)]';

  return (
    <article className="group rounded-xl border border-[var(--ref-outline-variant)]/20 bg-[var(--ref-surface-container-low)] p-3 transition-all hover:-translate-y-0.5 hover:border-[var(--ref-primary)]/25 hover:shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', tone)}>{a.icon ? <span className="text-base">{a.icon}</span> : <AccountIcon className="h-4 w-4" />}</div>
          <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ref-outline)]">{isLiability ? 'Liability' : variant === 'investment' ? 'Investment' : variant === 'receivable' ? 'Receivable' : 'Account'}</p><h4 className="truncate font-headline text-sm font-extrabold text-[var(--ref-on-surface)]">{a.name}</h4></div>
        </div>
        <button type="button" onClick={onEdit} className="rounded-lg p-1.5 text-[var(--ref-outline)] transition-colors hover:bg-[var(--ref-primary)]/10 hover:text-[var(--ref-primary)]" aria-label={`Edit ${a.name}`} title="Edit account"><Edit2 className="h-3.5 w-3.5" /></button>
      </div>
      <div className="mt-3"><p className="text-[11px] text-[var(--ref-on-surface-variant)]">{isLiability ? 'Amount owed' : variant === 'investment' ? 'Current value' : variant === 'receivable' ? 'Owed to you' : 'Available balance'}</p><p className="mt-0.5 font-headline text-xl font-extrabold tracking-tight text-[var(--ref-on-surface)]">{formatCurrency(displayBalance)}</p>{a.creditLimit != null && <p className="mt-0.5 text-[11px] text-[var(--ref-on-surface-variant)]">Limit {formatCurrency(a.creditLimit)}</p>}</div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--ref-outline-variant)]/20 pt-2"><span className={cn('min-w-0 truncate text-[10px] font-semibold', reconciliationClass)}>{reconciliationLabel}</span><Link to="/transactions" search={{ accountId: String(a.id) }} className="shrink-0 text-[11px] font-bold text-[var(--ref-primary)] hover:underline">Activity</Link></div>
      <div className="mt-2 flex items-center justify-between gap-3 text-[10px]"><span className="truncate text-[var(--ref-on-surface-variant)]">{accountIdentifier}</span><button type="button" onClick={lifecycleAction} className="inline-flex shrink-0 items-center gap-1 text-[var(--ref-outline)] transition-colors hover:text-[var(--ref-error)]"><Archive className="h-3 w-3" />{lifecycleLabel}</button></div>
    </article>
  );

  if (darkCard) {
    return (
      <article className="group relative overflow-hidden rounded-xl bg-[var(--ref-surface-container-highest)] p-5 text-[var(--color-text-primary)] transition-all hover:shadow-[0px_20px_40px_rgba(25,27,35,0.1)]">
        <div className="pointer-events-none absolute -right-4 -top-4 h-24 w-24 rounded-full bg-white/5 blur-2xl" />
        <div className="relative z-10">
          <div className="mb-4 flex items-start justify-between">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase text-[var(--color-text-secondary)]">
                {a.type === 'liability' ? 'Liability' : 'Asset'}
              </p>
              <h4 className="font-headline text-sm font-bold">{a.name}</h4>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="rounded p-1 text-[var(--color-text-secondary)] opacity-70 transition-opacity hover:text-[var(--color-text-primary)] md:opacity-0 md:group-hover:opacity-100"
                onClick={onEdit}
                aria-label={`Edit ${a.name}`}
                title="Edit account"
              >
                <Edit2 className="h-4 w-4" />
              </button>
              <CreditCard className="h-5 w-5 text-amber-400" aria-hidden />
            </div>
          </div>
          <p className="text-[10px] text-[var(--color-text-secondary)]">Amount owed</p>
          <p className="font-headline text-xl font-extrabold tracking-tight">{formatCurrency(a.balance)}</p>
          <div className="mt-4 flex items-center justify-between border-t border-[var(--color-border)] pt-3 text-[10px]">
            <span className={cn('truncate pr-2', reconciliationClass)}>{reconciliationLabel}</span>
            <Link
              to="/transactions"
              search={{ accountId: String(a.id) }}
              className="font-bold text-[var(--ref-on-primary-container)] hover:underline cursor-pointer"
            >
              Ledger
            </Link>
          </div>
          <p className="mt-2 truncate text-[10px] text-[var(--color-muted)]">{accountIdentifier}</p>
          <button
            type="button"
            onClick={lifecycleAction}
            className="mt-2 text-[10px] text-[var(--color-danger)] hover:opacity-80"
          >
            {lifecycleLabel}
          </button>
        </div>
      </article>
    );
  }

  if (variant === 'ewallet') {
    return (
      <article className="group rounded-xl bg-[var(--ref-surface-container-lowest)] p-4 transition-all hover:shadow-[0px_20px_40px_rgba(25,27,35,0.06)]">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                'bg-[var(--ref-secondary-container)]/20 text-[var(--ref-secondary)]',
              )}
            >
              <WalletCards className="h-4 w-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase text-[var(--ref-outline)]">E-wallet</p>
              <h4 className="font-headline text-xs font-bold text-[var(--ref-on-surface)]">{a.name}</h4>
            </div>
          </div>
          <button
            type="button"
            className="rounded p-1 text-[var(--ref-outline)] opacity-70 hover:text-[var(--ref-primary)] md:opacity-0 md:group-hover:opacity-100"
            onClick={onEdit}
            aria-label={`Edit ${a.name}`}
            title="Edit account"
          >
            <Edit2 className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-baseline justify-between">
          <p className="font-headline text-lg font-bold tracking-tight text-[var(--ref-on-surface)]">
            {formatCurrency(a.balance)}
          </p>
          <span className={cn('rounded bg-[var(--ref-surface-container)] px-2 py-0.5 text-[10px] font-semibold', reconciliationClass)}>
            {reconciliationLabel}
          </span>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-[var(--ref-outline-variant)]/15 pt-2">
          <span className="truncate pr-2 text-[10px] text-[var(--ref-on-surface-variant)]">{accountIdentifier}</span>
          <Link
            to="/transactions"
            search={{ accountId: String(a.id) }}
            className="text-[10px] font-bold text-[var(--ref-primary)] hover:underline"
          >
            Activity
          </Link>
          <button type="button" onClick={lifecycleAction} className="text-[10px] text-[var(--ref-error)] hover:underline cursor-pointer">
            {lifecycleLabel}
          </button>
        </div>
      </article>
    );
  }

  if (variant === 'investment' || variant === 'receivable') {
    const label = variant === 'investment' ? 'Investment' : 'Receivable';
    return (
      <article className="group rounded-xl border border-[var(--ref-outline-variant)]/25 bg-[var(--ref-surface-container-lowest)] p-4 transition-all hover:-translate-y-0.5 hover:shadow-[0px_16px_32px_rgba(25,27,35,0.08)]">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--ref-outline)]">{label}</p>
            <h4 className="truncate font-headline text-sm font-bold text-[var(--ref-on-surface)]">{a.name}</h4>
          </div>
          <button type="button" className="rounded p-1 text-[var(--ref-outline)] opacity-70 hover:text-[var(--ref-primary)] md:opacity-0 md:group-hover:opacity-100" onClick={onEdit} aria-label={`Edit ${a.name}`} title="Edit account">
            <Edit2 className="h-4 w-4" />
          </button>
        </div>
        <p className="text-[10px] text-[var(--ref-on-surface-variant)]">{variant === 'investment' ? 'Current value' : 'Amount owed to you'}</p>
        <p className="font-headline text-xl font-extrabold tracking-tight text-[var(--ref-on-surface)]">{formatCurrency(a.balance)}</p>
        <div className="mt-3 flex items-center justify-between border-t border-[var(--ref-outline-variant)]/15 pt-3 text-[10px]">
          <span className={cn('truncate pr-2', reconciliationClass)}>{reconciliationLabel}</span>
          <Link to="/transactions" search={{ accountId: String(a.id) }} className="font-bold text-[var(--ref-primary)] hover:underline">Activity</Link>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="truncate text-[10px] text-[var(--ref-on-surface-variant)]">{accountIdentifier}</span>
          <button type="button" onClick={lifecycleAction} className="text-[10px] text-[var(--ref-error)] hover:underline">{lifecycleLabel}</button>
        </div>
      </article>
    );
  }

  if (variant === 'paylater') {
    return (
      <article className="group rounded-xl border border-[var(--ref-outline-variant)]/30 bg-[var(--ref-surface-container)] p-4 transition-all hover:shadow-[0px_10px_25px_rgba(25,27,35,0.05)]">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase text-[var(--ref-on-surface-variant)]">PayLater</p>
            <h4 className="truncate font-headline text-sm font-bold text-[var(--ref-on-surface)]">{a.name}</h4>
          </div>
          <button
            type="button"
            className="rounded p-0.5 text-[var(--ref-outline)] opacity-70 hover:text-[var(--ref-primary)] md:opacity-0 md:group-hover:opacity-100 cursor-pointer"
            onClick={onEdit}
            aria-label={`Edit ${a.name}`}
            title="Edit account"
          >
            <Edit2 className="h-4 w-4" />
          </button>
        </div>
        <p className="text-[10px] text-[var(--ref-on-surface-variant)]">Amount owed</p>
        <p className="font-headline text-lg font-bold text-[var(--ref-on-surface)]">{formatCurrency(a.balance)}</p>
        {a.creditLimit != null && <p className="mt-1 text-[10px] text-[var(--ref-on-surface-variant)]">Limit {formatCurrency(a.creditLimit ?? 0)}</p>}
        <div className="mt-3 flex items-center justify-between text-[9px] font-semibold">
          <span className={cn('uppercase', reconciliationClass)}>{reconciliationLabel}</span>
          <Link to="/transactions" search={{ accountId: String(a.id) }} className="text-[var(--ref-primary)] hover:underline">
            Entries
          </Link>
        </div>
        <button type="button" onClick={lifecycleAction} className="mt-2 text-[var(--ref-error)] hover:underline cursor-pointer">
          {lifecycleLabel}
        </button>
      </article>
    );
  }

  /* cash + default credit light */
  const isCreditLight = variant === 'credit';
  return (
    <article
      className={cn(
        'group rounded-xl bg-[var(--ref-surface-container-lowest)] p-5 transition-all hover:shadow-[0px_20px_40px_rgba(25,27,35,0.06)]',
        isCreditLight
          ? 'border border-[var(--ref-outline-variant)]/30'
          : 'border-l-4',
      )}
      style={!isCreditLight ? { borderLeftColor: accent } : undefined}
    >
      <div className="mb-4 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase text-[var(--ref-outline)]">
            {a.type === 'asset' ? 'Account' : 'Liability'}
          </p>
          <h4 className="font-headline text-sm font-bold text-[var(--ref-on-surface)]">{a.name}</h4>
        </div>
        <button
          type="button"
          className="rounded p-1 text-[var(--ref-outline)] opacity-70 hover:text-[var(--ref-primary)] md:opacity-0 md:group-hover:opacity-100"
          onClick={onEdit}
          aria-label={`Edit ${a.name}`}
          title="Edit account"
        >
          <Edit2 className="h-4 w-4" />
        </button>
      </div>
      <p className="text-[10px] text-[var(--ref-on-surface-variant)]">{a.type === 'liability' ? 'Amount owed' : 'Available balance'}</p>
      <p className="font-headline text-xl font-extrabold tracking-tight text-[var(--ref-on-surface)]">
        {formatCurrency(a.balance)}
      </p>
      {isCreditLight && a.creditLimit != null && <p className="mt-1 text-[10px] text-[var(--ref-on-surface-variant)]">Limit {formatCurrency(a.creditLimit ?? 0)}</p>}
      <div className="mt-4 flex items-center justify-between border-t border-[var(--ref-outline-variant)]/15 pt-4 text-[10px] font-medium text-[var(--ref-on-surface-variant)]">
        <span className="flex items-center gap-1">
          <Banknote className="h-3 w-3" aria-hidden />
          {accountIdentifier}
        </span>
        <Link to="/transactions" search={{ accountId: String(a.id) }} className="font-bold text-[var(--ref-primary)] hover:underline">
          Ledger
        </Link>
      </div>
      <p className={cn('mt-2 text-[10px] font-semibold', reconciliationClass)}>{reconciliationLabel}</p>
      <button
        type="button"
        onClick={lifecycleAction}
        className="mt-2 text-[10px] font-medium text-[var(--ref-error)] hover:underline"
      >
        {a.isActive ? 'Archive account' : 'Restore account'}
      </button>
    </article>
  );
}
