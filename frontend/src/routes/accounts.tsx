import { createFileRoute, Link } from '@tanstack/react-router';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/ui/PageHeader';
import { PageContainer } from '../components/ui/PageContainer';
import { useConfirm } from '../components/ui/ConfirmDialog';
import { RequireAuth } from '../lib/auth';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import './accounts.css';
import { cn } from '../lib/utils';
import { useBalanceVisibility } from '../hooks/useBalanceVisibility';
import { BalanceVisibilityToggle } from '../components/ui/BalanceVisibilityToggle';
import { useQueryClient } from '@tanstack/react-query';
import { useAccountDashboardQuery, useAccountsLedgerQuery, useDeleteAccountMutation, useReconciliationHistoryQuery, useRestoreAccountMutation } from '../features/accounts/queries';
import { queryKeys } from '../features/core/query-keys';
import { AccountModal } from '../components/accounts/AccountModal';
import { useAccountViewPreferences } from '../features/accounts/use-view-preferences';
import { ReconciliationModal } from '../components/reconciliation/ReconciliationModal';
import {
  Plus,
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
  ArrowUpRight,
  Landmark,
  TrendingUp,
  RotateCcw,
  MoreHorizontal,
  List,
  LayoutGrid,
  Pin,
  PinOff,
  ChevronDown,
} from 'lucide-react';

export const Route = createFileRoute('/accounts')({
  component: AccountsPage,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

/** Account groups based on ledger type and liquidity treatment. */
type LedgerBucket = 'cash' | 'prepaid' | 'ewallet' | 'investment' | 'receivable' | 'creditcard' | 'paylater';

function bucketAccount(a: AccountRow): LedgerBucket {
  const n = `${a.name} ${a.provider ?? ''}`.toLowerCase();
  if (a.type === 'liability') {
    if (/pay\s*later|traveloka|kredivo|akulaku|split|defer|humm|afterpay|shopee\s*pay\s*later/.test(n)) {
      return 'paylater';
    }
    return 'creditcard';
  }
  if (/pay\s*later|traveloka|kredivo|akulaku/.test(n)) return 'paylater';
  if (/e[ -]?money|e[ -]?toll|tapcash|flazz|brizzi|prepaid|pre-paid|transit card|uang elektronik/.test(n)) return 'prepaid';
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

// TanStack Router exports its route configuration from this module.
// eslint-disable-next-line react-refresh/only-export-components
function AccountsPage() {
  const queryClient = useQueryClient();
  const { formatAmount } = useBalanceVisibility();
  const { preferences, updatePreferences } = useAccountViewPreferences();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isReconciliationOpen, setIsReconciliationOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AccountRow | null>(null);
  const { confirm } = useConfirm();

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'asset' | 'liability'>('all');
  const [sortBy, setSortBy] = useState<'default' | 'balance' | 'name'>('default');

  useEffect(() => {
    const closeOutsideMenus = (event: PointerEvent) => {
      document.querySelectorAll<HTMLDetailsElement>('.accounts-page details[open]').forEach((menu) => {
        if (!menu.contains(event.target as Node)) menu.open = false;
      });
    };
    const closeMenusOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      document.querySelectorAll<HTMLDetailsElement>('.accounts-page details[open]').forEach((menu) => {
        if (menu.contains(document.activeElement)) menu.querySelector('summary')?.focus();
        menu.open = false;
      });
    };
    document.addEventListener('pointerdown', closeOutsideMenus);
    document.addEventListener('keydown', closeMenusOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutsideMenus);
      document.removeEventListener('keydown', closeMenusOnEscape);
    };
  }, []);

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
  const accounts = useMemo(() => (accountsQuery.data ?? []) as AccountRow[], [accountsQuery.data]);
  const allAccounts = useMemo(() => (allAccountsQuery.data ?? []) as AccountRow[], [allAccountsQuery.data]);
  const reconciliationSessions = useMemo(() => reconciliationQuery.data?.sessions ?? [], [reconciliationQuery.data]);
  const isLoading = accountsQuery.isLoading || allAccountsQuery.isLoading || dashboardQuery.isLoading || reconciliationQuery.isLoading;
  const loadError = accountsQuery.error || allAccountsQuery.error || dashboardQuery.error || reconciliationQuery.error;
  const lastLoadedAt = Math.max(accountsQuery.dataUpdatedAt, allAccountsQuery.dataUpdatedAt, dashboardQuery.dataUpdatedAt, reconciliationQuery.dataUpdatedAt) || null;
  const dashboardSummary = dashboardQuery.data?.netWorth;
  const summary = dashboardSummary
    ? { totalAssets: dashboardSummary.totalAssets, totalLiabilities: dashboardSummary.totalLiabilities, netWorth: dashboardSummary.netWorth }
    : allAccounts.length > 0
      ? allAccounts.reduce((totals, account) => {
        if (account.systemKey || !account.isActive) return totals;
        if (account.type === 'asset') totals.totalAssets += account.balance;
        if (account.type === 'liability') totals.totalLiabilities += Math.abs(account.balance);
        totals.netWorth = totals.totalAssets - totals.totalLiabilities;
        return totals;
      }, { totalAssets: 0, totalLiabilities: 0, netWorth: 0 })
      : null;
  const loadAccounts = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
  ]);

  const userAccounts = useMemo(
    () => accounts.filter((a) => !a.systemKey),
    [accounts],
  );

  const isFilteredQuery =
    debouncedSearch.length > 0 || typeFilter !== 'all';

  const latestReconciliationByAccount = useMemo(() => {
    const result = new Map<number, { asOfDate: number; status: string; difference: number; kind: string }>();
    for (const session of reconciliationSessions) {
      if (session.lifecycleStatus === 'voided') continue;
      for (const item of session.items) {
        if (!result.has(item.accountId)) {
          result.set(item.accountId, {
            asOfDate: session.asOfDate,
            status: item.status,
            difference: item.difference,
            kind: session.kind ?? 'control',
          });
        }
      }
    }
    return result;
  }, [reconciliationSessions]);

  const reconciliationSummary = useMemo(() => {
    const activeAccounts = allAccounts.filter((account) => !account.systemKey && account.isActive);
    const checked = activeAccounts.filter((account) => latestReconciliationByAccount.has(account.id));
    const issues = checked.filter((account) => {
      const latestCheck = latestReconciliationByAccount.get(account.id);
      return latestCheck?.kind === 'control' && latestCheck.status !== 'adjusted' && (
        latestCheck.status === 'needs_classification' || latestCheck.difference !== 0
      );
    });
    const latest = checked
      .map((account) => latestReconciliationByAccount.get(account.id)?.asOfDate ?? 0)
      .filter(Boolean)
      .sort((a, b) => b - a)[0] ?? null;
    return { checked: checked.length, issues: issues.length, total: activeAccounts.length, latest };
  }, [latestReconciliationByAccount, allAccounts]);

  const buckets = useMemo(() => {
    const m: Record<LedgerBucket, AccountRow[]> = {
      cash: [],
      prepaid: [],
      ewallet: [],
      investment: [],
      receivable: [],
      creditcard: [],
      paylater: [],
    };
    for (const a of userAccounts) {
      m[bucketAccount(a)].push(a);
    }
    for (const rows of Object.values(m)) {
      if (sortBy === 'balance') rows.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
      if (sortBy === 'name') rows.sort((a, b) => a.name.localeCompare(b.name));
    }
    return m;
  }, [userAccounts, sortBy]);

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

  const sortedAccounts = useMemo(() => {
    const rows = [...userAccounts];
    if (sortBy === 'balance') rows.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
    if (sortBy === 'name') rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  }, [userAccounts, sortBy]);
  const pinnedIds = new Set(preferences.pinnedAccountIds);
  const pinnedAccounts = sortedAccounts.filter((account) => account.isActive && pinnedIds.has(account.id));
  const shelfAccounts = preferences.pinnedAccountIds
    .map((id) => allAccounts.find((account) => account.id === id && account.isActive && !account.systemKey))
    .filter((account): account is AccountRow => account !== undefined);
  const showPinnedShelf = preferences.showPinned && shelfAccounts.length > 0;
  const togglePin = (id: number) => updatePreferences({
    ...preferences,
    pinnedAccountIds: pinnedIds.has(id)
      ? preferences.pinnedAccountIds.filter((accountId) => accountId !== id)
      : [...preferences.pinnedAccountIds, id],
  });
  const renderAccount = (account: AccountRow, layout: 'row' | 'tile' | 'shelf') => (
    <AccountTile
      key={account.id}
      account={account}
      group={ACCOUNT_GROUPS.find((group) => group.key === bucketAccount(account))!}
      layout={layout}
      isPinned={pinnedIds.has(account.id)}
      onTogglePin={() => togglePin(account.id)}
      onEdit={() => openModal(account)}
      onDelete={() => void handleDelete(account.id)}
      onRestore={() => void handleRestore(account.id)}
      lifecyclePending={lifecyclePending}
      reconciliation={latestReconciliationByAccount.get(account.id)}
    />
  );
  const isInitialLoading = isLoading && allAccounts.length === 0;
  const isRefreshing = accountsQuery.isFetching || allAccountsQuery.isFetching || dashboardQuery.isFetching || reconciliationQuery.isFetching;
  const lifecyclePending = deleteAccountMutation.isPending || restoreAccountMutation.isPending;
  const activeAccounts = allAccounts.filter((account) => !account.systemKey && account.isActive);
  const assetCount = activeAccounts.filter((account) => account.type === 'asset').length;
  const liabilityCount = activeAccounts.filter((account) => account.type === 'liability').length;
  const listedAccounts = allAccounts.filter((account) => !account.systemKey);

  return (
    <RequireAuth>
      <PageContainer variant="full-width" className="accounts-page">
        <header className="accounts-header">
          <PageHeader subtext="" title="Accounts" description="Your money, in one place." />
          <div className="accounts-header-actions">
            <Button type="button" variant="secondary" className="rounded-full" onClick={() => setIsReconciliationOpen(true)} disabled={isInitialLoading || activeAccounts.length === 0}>
              <Scale className="h-4 w-4" aria-hidden />Reconcile
            </Button>
            <Button type="button" className="rounded-full" onClick={() => openModal()}>
              <Plus className="h-4 w-4" aria-hidden />Add account
            </Button>
          </div>
        </header>

        {loadError && (
          <div className="accounts-error" role="alert">
            <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
            <div>
              <strong>Couldn’t refresh account data</strong>
              <p>{lastLoadedAt
                ? 'Showing the last available snapshot, updated at ' + new Date(lastLoadedAt).toLocaleTimeString('en-ID', { hour: '2-digit', minute: '2-digit' }) + '.'
                : 'Your balances are unavailable. Try again when the connection is restored.'}</p>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => void loadAccounts()} disabled={isRefreshing}>Try again</Button>
          </div>
        )}

        {isInitialLoading ? (
          <div className="accounts-overview-skeleton animate-pulse" aria-label="Loading account overview" />
        ) : (
          <section className={cn('accounts-overview', showPinnedShelf && 'accounts-overview-has-pinned')} aria-label="Financial overview">
            {showPinnedShelf && <section className="accounts-pinned-shelf" aria-label="Pinned balances">
              <header><Pin className="h-3.5 w-3.5" aria-hidden /><h2>Pinned accounts</h2><span>{shelfAccounts.length}</span></header>
              <div className="accounts-pinned-balances">{shelfAccounts.map((account) => renderAccount(account, 'shelf'))}</div>
            </section>}
            <article className="accounts-position">
              <div className="accounts-worth-main">
                <div className="accounts-worth-heading"><span className="accounts-summary-label"><Wallet className="h-4 w-4" aria-hidden />Total net worth <span>IDR</span></span><BalanceVisibilityToggle inverted /></div>
                <p className="accounts-net-worth">{summary ? formatAmount(summary.netWorth) : 'Unavailable'}</p>
              </div>
              <div className="accounts-summary-stat">
                <span className="accounts-summary-label">Assets</span>
                <strong>{summary ? formatAmount(summary.totalAssets) : '—'}</strong>
                <small>{assetCount} active {assetCount === 1 ? 'account' : 'accounts'}</small>
              </div>
              <div className="accounts-summary-stat">
                <span className="accounts-summary-label">Liabilities</span>
                <strong>{summary ? formatAmount(summary.totalLiabilities) : '—'}</strong>
                <small>{liabilityCount} active {liabilityCount === 1 ? 'account' : 'accounts'}</small>
              </div>
            <div className={cn('accounts-health', reconciliationSummary.issues > 0 && 'accounts-status-warning')}>
              {reconciliationSummary.issues > 0 ? <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> : reconciliationSummary.checked < reconciliationSummary.total ? <Clock3 className="h-4 w-4 shrink-0" aria-hidden /> : <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />}
              <p>
                {reconciliationSummary.issues > 0
                  ? reconciliationSummary.issues + (reconciliationSummary.issues === 1 ? ' account needs review' : ' accounts need review')
                  : reconciliationSummary.total === 0
                    ? 'Add an account to start tracking balances.'
                    : <><span className="accounts-health-label-full">{reconciliationSummary.checked} of {reconciliationSummary.total} accounts checked</span><span className="accounts-health-label-short">{reconciliationSummary.checked}/{reconciliationSummary.total} checked</span></>}
              </p>
              {reconciliationSummary.latest && <span className="accounts-last-check">Last checked {formatShortDate(reconciliationSummary.latest)}</span>}
              <button type="button" className="accounts-text-action" onClick={() => setIsReconciliationOpen(true)} disabled={activeAccounts.length === 0}>
                Review balances<ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            </article>
          </section>
        )}

        <section className="accounts-ledger" aria-label="Your accounts">
          <div className="accounts-ledger-heading">
            <div className="flex items-center gap-3"><h2>Your accounts</h2><span className="accounts-count">{userAccounts.length}</span></div>
            <div className="accounts-ledger-actions">
              <details className="accounts-view-menu">
                <summary className="accounts-utility-action"><LayoutGrid className="h-4 w-4" aria-hidden />View<ChevronDown className="h-3 w-3" aria-hidden /></summary>
                <div className="accounts-view-popover">
                  <p>Layout</p>
                  <div role="group" aria-label="Account view">
                    {([
                      { value: 'list', label: 'Grouped list', icon: List },
                      { value: 'grid', label: 'Wallet grid', icon: LayoutGrid },
                    ] as const).map((view) => (
                      <button key={view.value} type="button" aria-pressed={preferences.view === view.value} className={cn('accounts-view-choice', preferences.view === view.value && 'is-selected')} onClick={(event) => { updatePreferences({ ...preferences, view: view.value }); event.currentTarget.closest('details')?.removeAttribute('open'); }}>
                        <view.icon className="h-4 w-4" aria-hidden /><span>{view.label}</span>{preferences.view === view.value && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
                      </button>
                    ))}
                  </div>
                  <label className="accounts-view-toggle">
                    <input type="checkbox" checked={preferences.showPinned} onChange={(event) => updatePreferences({ ...preferences, showPinned: event.target.checked })} />
                    <span>Show pinned accounts<small>Your main balances at a glance</small></span>
                  </label>
                  <label className="accounts-view-toggle accounts-view-toggle-plain">
                    <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
                    <span>Show archived accounts</span>
                  </label>
                  <label className="accounts-sort">
                    Sort by
                    <select aria-label="Sort accounts" value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)}>
                      <option value="default">Default order</option><option value="balance">Highest balance</option><option value="name">Account name</option>
                    </select>
                  </label>
                </div>
              </details>
              <button type="button" className="accounts-utility-action" disabled={isLoading || userAccounts.length === 0} onClick={() => downloadAccountsCsv(userAccounts)}>
                <Download className="h-4 w-4" aria-hidden />Export
              </button>
              <button type="button" className="accounts-utility-action" disabled={isRefreshing} onClick={() => void loadAccounts()}>
                <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} aria-hidden />Refresh
              </button>
            </div>
          </div>
          <div className="accounts-toolbar">
            <div className="accounts-filter-tabs" role="group" aria-label="Filter account type">
              {([
                { value: 'all', label: 'All accounts', count: listedAccounts.length },
                { value: 'asset', label: 'Assets', count: listedAccounts.filter((account) => account.type === 'asset').length },
                { value: 'liability', label: 'Liabilities', count: listedAccounts.filter((account) => account.type === 'liability').length },
              ] as const).map((filter) => (
                <button key={filter.value} type="button" aria-pressed={typeFilter === filter.value} className={cn('accounts-filter-tab', typeFilter === filter.value && 'is-selected')} onClick={() => setTypeFilter(filter.value)}>
                  {filter.label}<span>{filter.count}</span>
                </button>
              ))}
            </div>
            <div className="accounts-search">
              <Search className="h-4 w-4 shrink-0" aria-hidden />
              <input type="search" aria-label="Search accounts" placeholder="Search accounts…" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} />
              {searchInput && <button type="button" aria-label="Clear search" onClick={() => setSearchInput('')}><X className="h-4 w-4" aria-hidden /></button>}
            </div>
          </div>
          {showArchived && <button type="button" className="accounts-archive-indicator" onClick={() => setShowArchived(false)} aria-label="Hide archived accounts">
            <Archive className="h-3.5 w-3.5" aria-hidden />Including archived<X className="h-3 w-3" aria-hidden />
          </button>}
          {isInitialLoading ? (
            <div className={preferences.view === 'list' ? 'accounts-account-list' : 'accounts-card-grid'} aria-label="Loading accounts">
              {Array.from({ length: 6 }, (_, index) => <div key={index} className="accounts-card-skeleton animate-pulse" />)}
            </div>
          ) : userAccounts.length === 0 ? (
            <div className="accounts-empty">
              <span className="accounts-empty-icon">{loadError ? <AlertTriangle aria-hidden /> : isFilteredQuery ? <Search aria-hidden /> : <WalletCards aria-hidden />}</span>
              <h3>{loadError ? 'Account data is unavailable' : isFilteredQuery ? 'No matching accounts' : 'Make room for your money'}</h3>
              <p>{loadError ? 'Refresh to try loading your accounts again.' : isFilteredQuery ? 'Try another search or show all account types.' : 'Add your first bank account, wallet, or credit account to see your balances here.'}</p>
              {isFilteredQuery
                ? <Button variant="secondary" className="rounded-full" onClick={() => { setSearchInput(''); setTypeFilter('all'); }}>Clear filters</Button>
                : !loadError && <Button className="rounded-full" onClick={() => openModal()}><Plus className="h-4 w-4" aria-hidden />Add your first account</Button>}
            </div>
          ) : (
            <div className="accounts-results" aria-label={preferences.view === 'list' ? 'Grouped list' : 'Wallet grid'} aria-busy={accountsQuery.isFetching}>
              {preferences.view === 'grid' ? (
                <div className="accounts-card-grid">{sortedAccounts.map((account) => renderAccount(account, 'tile'))}</div>
              ) : (
                <div className="accounts-groups">
                  {preferences.showPinned && pinnedAccounts.length > 0 && <section className="accounts-pinned-group" aria-label="Pinned accounts">
                    <header className="accounts-group-heading"><div className="flex items-center gap-2"><Pin className="h-4 w-4" aria-hidden /><h3>Pinned accounts</h3><span className="accounts-group-count">{pinnedAccounts.length}</span></div></header>
                    <div className="accounts-card-grid">{pinnedAccounts.map((account) => renderAccount(account, 'tile'))}</div>
                  </section>}
                  {ACCOUNT_GROUPS.map((group) => {
                    const rows = buckets[group.key];
                    return rows.length > 0 && (
                      <section key={group.key} className="accounts-group" aria-label={group.title}>
                        <header className="accounts-group-heading">
                          <div className="flex min-w-0 items-center gap-2">
                            <group.icon className="h-4 w-4 shrink-0" aria-hidden /><h3>{group.title}</h3><span className="accounts-group-count">{rows.length}</span>
                          </div>
                          <p>{group.key === 'creditcard' || group.key === 'paylater' ? 'Total owed' : 'Total balance'}<strong>{formatAmount(rows.reduce((total, account) => total + (account.type === 'liability' ? Math.abs(account.balance) : account.balance), 0))}</strong></p>
                        </header>
                        <div className="accounts-account-list">{rows.map((account) => renderAccount(account, 'row'))}</div>
                      </section>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>

        <footer className="accounts-footer">
          <span><Scale className="h-3.5 w-3.5" aria-hidden />Balances reflect your recorded transactions.</span>
          <span>{lastLoadedAt ? 'Updated ' + new Date(lastLoadedAt).toLocaleTimeString('en-ID', { hour: '2-digit', minute: '2-digit' }) : 'Reconcile with your statements to keep them accurate.'}</span>
        </footer>
        <AccountModal isOpen={isModalOpen} onClose={closeModal} onSaved={loadAccounts} editingAccount={editingAccount} />
        <ReconciliationModal isOpen={isReconciliationOpen} onClose={() => setIsReconciliationOpen(false)} accounts={allAccounts.length > 0 ? allAccounts : accounts} onSuccess={loadAccounts} />
      </PageContainer>
    </RequireAuth>
  );
}

const ACCOUNT_GROUPS = [
  { key: 'cash', title: 'Cash & bank accounts', icon: Landmark, tone: 'blue' },
  { key: 'prepaid', title: 'E-money cards', icon: WalletCards, tone: 'teal' },
  { key: 'ewallet', title: 'E-wallets', icon: WalletCards, tone: 'teal' },
  { key: 'investment', title: 'Investments', icon: TrendingUp, tone: 'violet' },
  { key: 'receivable', title: 'Receivables', icon: Banknote, tone: 'teal' },
  { key: 'creditcard', title: 'Credit cards & loans', icon: CreditCard, tone: 'rose' },
  { key: 'paylater', title: 'Pay later', icon: Clock3, tone: 'rose' },
] as const satisfies readonly { key: LedgerBucket; title: string; icon: typeof Wallet; tone: string }[];

// Local presentation component used by the file route above.
// eslint-disable-next-line react-refresh/only-export-components
function AccountTile({
  account, group, layout, isPinned, onTogglePin, onEdit, onDelete, onRestore, lifecyclePending, reconciliation,
}: {
  account: AccountRow;
  group: (typeof ACCOUNT_GROUPS)[number];
  layout: 'row' | 'tile' | 'shelf';
  isPinned: boolean;
  onTogglePin: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRestore: () => void;
  lifecyclePending: boolean;
  reconciliation?: { asOfDate: number; status: string; difference: number; kind: string };
}) {
  const { formatAmount } = useBalanceVisibility();
  const identifier = maskAccountNumber(account.accountNumber);
  const isLiability = account.type === 'liability';
  const balance = isLiability ? Math.abs(account.balance) : account.balance;
  const needsReview = reconciliation != null && reconciliation.kind === 'control' && reconciliation.status !== 'adjusted' && (
    reconciliation.difference !== 0 || reconciliation.status === 'needs_classification'
  );
  const reconciliationLabel = !reconciliation
    ? 'Not checked yet'
    : needsReview
      ? reconciliation.difference !== 0
        ? 'Difference ' + formatAmount(Math.abs(reconciliation.difference))
        : 'Needs review'
      : (reconciliation.status === 'adjusted' ? 'Aligned ' : 'Checked ') + formatShortDate(reconciliation.asOfDate);
  const StatusIcon = !reconciliation ? Clock3 : needsReview ? AlertTriangle : CheckCircle2;
  const utilization = isLiability && account.creditLimit != null && account.creditLimit > 0
    ? Math.round(balance / account.creditLimit * 100)
    : null;

  return (
    <article className={cn('account-card', 'account-layout-' + layout, !account.isActive && 'account-card-archived')} style={account.color ? { '--account-accent': account.color } as CSSProperties : undefined}>
      <div className="account-avatar"><group.icon className="h-5 w-5" aria-hidden /></div>
      <div className="account-card-heading">
        <div className="account-card-name">
          <h4><Link to="/transactions" search={{ accountId: String(account.id) }} aria-label={'View activity for ' + account.name}>{account.name}</Link></h4>
          <p className="account-kind">{layout === 'shelf' && isLiability ? 'Amount owed · ' : ''}{group.title}{identifier ? ' · ' + identifier : ''}</p>
          {!account.isActive && <span className="account-archived-label">Archived</span>}
        </div>
      </div>
      <div className="account-card-controls">
        {account.isActive && <button type="button" className={cn('account-pin-button', isPinned && 'is-pinned')} aria-pressed={isPinned} aria-label={(isPinned ? 'Unpin ' : 'Pin ') + account.name} title={(isPinned ? 'Unpin ' : 'Pin ') + account.name} onClick={onTogglePin}>
          {isPinned ? <PinOff className="h-4 w-4" aria-hidden /> : <Pin className="h-4 w-4" aria-hidden />}
        </button>}
        <details className="account-actions">
          <summary aria-label={'Actions for ' + account.name} title="Account actions"><MoreHorizontal className="h-4 w-4" aria-hidden /></summary>
          <div className="account-actions-menu">
            <button type="button" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); onEdit(); }}>Edit account</button>
            <button type="button" disabled={lifecyclePending} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); (account.isActive ? onDelete : onRestore)(); }}>
              {account.isActive ? <><Archive className="h-3.5 w-3.5" aria-hidden />Archive account</> : <><RotateCcw className="h-3.5 w-3.5" aria-hidden />Restore account</>}
            </button>
          </div>
        </details>
      </div>
      <div className="account-card-balance">
        <p>{isLiability ? 'Amount owed' : group.key === 'investment' ? 'Current value' : group.key === 'receivable' ? 'Owed to you' : 'Available balance'}</p>
        <strong>{formatAmount(balance)}</strong>
      </div>
      <div className="account-card-meta">
        {identifier && <span className="account-row-identifier">{identifier}</span>}
        <span className={cn('account-check', !reconciliation ? 'account-check-pending' : needsReview ? 'accounts-status-warning' : 'account-check-verified')}>
          <StatusIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />{reconciliationLabel}
        </span>
        {account.creditLimit != null && <span className="account-credit-summary">Limit {formatAmount(account.creditLimit)}{utilization != null ? ' · ' + utilization + '% used' : ''}</span>}
      </div>
    </article>
  );
}
