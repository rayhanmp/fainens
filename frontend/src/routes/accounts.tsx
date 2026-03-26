import { createFileRoute, Link } from '@tanstack/react-router';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { PageHeader } from '../components/ui/PageHeader';
import { RequireAuth } from '../lib/auth';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { formatCurrency, cn } from '../lib/utils';
import { AccountModal } from '../components/accounts/AccountModal';
import { ReconciliationModal } from '../components/reconciliation/ReconciliationModal';
import {
  Plus,
  Edit2,
  Wallet,
  CreditCard,
  RefreshCw,
  Search,
  X,
  Download,
  ArrowUp,
  Sparkles,
  NotebookPen,
  Scale,
  WalletCards,
  Banknote,
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
};

/** Buckets aligned with Stitch Financial Command Center columns */
type LedgerBucket = 'cash' | 'ewallet' | 'creditcard' | 'paylater';

function bucketAccount(a: AccountRow): LedgerBucket {
  const n = a.name.toLowerCase();
  if (a.type === 'liability') {
    if (/pay\s*later|traveloka|kredivo|akulaku|split|defer|humm|afterpay|shopee\s*pay\s*later/.test(n)) {
      return 'paylater';
    }
    return 'creditcard';
  }
  if (/pay\s*later|traveloka|kredivo|akulaku/.test(n)) return 'paylater';
  if (/credit|visa|mastercard|jcb|amex|kartu|precious|signature|platinum/.test(n)) return 'creditcard';
  if (/gopay|ovo|dana|shopee|linkaja|grabpay|gopay|e-?wallet|ewallet|tokopedia\s*pay/.test(n)) {
    return 'ewallet';
  }
  return 'cash';
}

function downloadAccountsCsv(rows: AccountRow[]) {
  const header = 'Name,Type,Balance (IDR)\n';
  const body = rows
    .map((a) => {
      const name = a.name.replace(/"/g, '""');
      return `"${name}",${a.type},${a.balance}`;
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
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [summary, setSummary] = useState<{
    totalAssets: number;
    totalLiabilities: number;
    netWorth: number;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isReconciliationOpen, setIsReconciliationOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AccountRow | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'asset' | 'liability'>('all');



  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(searchInput.trim()), 350);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  const loadAccounts = useCallback(async () => {
    setIsLoading(true);
    try {
      const params: { type?: string; search?: string } = {};
      if (typeFilter !== 'all') params.type = typeFilter;
      if (debouncedSearch) params.search = debouncedSearch;

      const [list, dash] = await Promise.all([
        api.accounts.list(Object.keys(params).length ? params : undefined),
        api.analytics.dashboard().catch(() => null),
      ]);
      setAccounts(list as AccountRow[]);

      if (dash?.netWorth) {
        setSummary({
          totalAssets: dash.netWorth.totalAssets,
          totalLiabilities: dash.netWorth.totalLiabilities,
          netWorth: dash.netWorth.netWorth,
        });
      } else {
        const full = (await api.accounts.list()) as AccountRow[];
        const ua = full.filter((a) => !a.systemKey);
        let totalAssets = 0;
        let totalLiabilities = 0;
        for (const a of ua) {
          if (a.type === 'asset') totalAssets += a.balance;
          else if (a.type === 'liability') totalLiabilities += Math.abs(a.balance);
        }
        setSummary({
          totalAssets,
          totalLiabilities,
          netWorth: totalAssets - totalLiabilities,
        });
      }
    } catch (e) {
      console.error(e);
      setSummary({ totalAssets: 0, totalLiabilities: 0, netWorth: 0 });
    } finally {
      setIsLoading(false);
    }
  }, [debouncedSearch, typeFilter]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const userAccounts = useMemo(
    () => accounts.filter((a) => !a.systemKey),
    [accounts],
  );

  const isFilteredQuery =
    debouncedSearch.length > 0 || typeFilter !== 'all';

  const buckets = useMemo(() => {
    const m: Record<LedgerBucket, AccountRow[]> = {
      cash: [],
      ewallet: [],
      creditcard: [],
      paylater: [],
    };
    for (const a of userAccounts) {
      m[bucketAccount(a)].push(a);
    }
    return m;
  }, [userAccounts]);

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this account? It will be hidden from the ledger.')) return;
    try {
      const result = await api.accounts.delete(id);
      console.log('Delete result:', result);
      await loadAccounts();
    } catch (err) {
      console.error('Delete error:', err);
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

  return (
    <RequireAuth>
      <div className="mx-auto max-w-7xl space-y-6 pb-10 sm:space-y-8">
        {/* Stitch: Command Center top bar (content only — shell has sidebar) */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <PageHeader
            subtext="Account overview"
            title="Accounts"
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

        {/* Slim metrics bar — Stitch */}
        {isLoading ? (
          <div className="h-24 animate-pulse rounded-xl bg-[var(--ref-surface-container-highest)]/50" />
        ) : summary ? (
          <section className="flex flex-wrap items-center justify-between gap-6 rounded-xl bg-[var(--ref-surface-container-lowest)] p-4 editorial-shadow">
            <div className="flex flex-wrap items-center gap-6 md:gap-8">
              <div>
                <p className="mb-1 font-body text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]">
                  Total net worth
                </p>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-headline text-2xl font-extrabold tracking-tight text-[var(--ref-on-surface)]">
                    {formatCurrency(summary.netWorth)}
                  </span>
                  <span className="inline-flex items-center gap-0.5 rounded bg-[var(--ref-secondary-container)]/30 px-1.5 py-0.5 text-[10px] font-bold text-[var(--ref-secondary)]">
                    <ArrowUp className="h-3 w-3" aria-hidden />
                    ledger
                  </span>
                </div>
              </div>
              <div className="hidden h-10 w-px bg-[var(--ref-outline-variant)]/40 sm:block" />
              <div className="hidden sm:block">
                <p className="mb-1 font-body text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]">
                  Assets
                </p>
                <p className="font-headline text-lg font-bold text-[var(--ref-on-surface)]">
                  {formatCurrency(summary.totalAssets)}
                </p>
              </div>
              <div className="hidden h-10 w-px bg-[var(--ref-outline-variant)]/40 sm:block" />
              <div className="hidden sm:block">
                <p className="mb-1 font-body text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]">
                  Liabilities
                </p>
                <p className="font-headline text-lg font-bold text-[var(--ref-error)]">
                  {formatCurrency(summary.totalLiabilities)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-[var(--ref-outline-variant)]/30 bg-[var(--ref-surface-container)] px-3 py-1.5">
              <NotebookPen className="h-3.5 w-3.5 text-[var(--ref-primary)]" aria-hidden />
              <span className="text-[10px] font-medium uppercase tracking-tighter text-[var(--ref-on-surface-variant)]">
                Manual ledger mode
              </span>
            </div>
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
            Accounts are grouped automatically (name hints).{' '}
            <span className="font-bold text-[var(--ref-on-surface)]">{userAccounts.length}</span> shown
          </p>
        </div>

        {/* 4-column ledger grid — Stitch */}
        {isLoading ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-4">
                <div className="h-4 w-32 animate-pulse rounded bg-[var(--ref-surface-container-highest)]/60" />
                <div className="h-28 animate-pulse rounded-xl bg-[var(--ref-surface-container-highest)]/40" />
                <div className="h-28 animate-pulse rounded-xl bg-[var(--ref-surface-container-highest)]/40" />
              </div>
            ))}
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
          <section className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
            <LedgerColumn
              title="Cash & checking"
              accounts={buckets.cash}
              emptyHint="Bank, cash, savings"
              onEdit={openModal}
              onDelete={handleDelete}
              cardVariant="cash"
            />
            <LedgerColumn
              title="E-wallets"
              accounts={buckets.ewallet}
              emptyHint="GoPay, OVO, DANA…"
              onEdit={openModal}
              onDelete={handleDelete}
              cardVariant="ewallet"
            />
            <LedgerColumn
              title="Credit cards"
              accounts={buckets.creditcard}
              emptyHint="Cards & loans"
              onEdit={openModal}
              onDelete={handleDelete}
              cardVariant="credit"
            />
            <LedgerColumn
              title="PayLater"
              accounts={buckets.paylater}
              emptyHint="Deferred liabilities"
              onEdit={openModal}
              onDelete={handleDelete}
              cardVariant="paylater"
              footerSummary={payLaterTotal > 0 ? payLaterTotal : undefined}
            />
          </section>
        )}

        {/* Market velocity + insights — Stitch footer strip */}
        {!isLoading && userAccounts.length > 0 && (
          <section className="grid grid-cols-1 gap-6 md:grid-cols-4">
            <div className="flex flex-col justify-between gap-4 rounded-xl border border-[var(--ref-outline-variant)]/20 bg-[var(--ref-surface-container-lowest)] p-6 md:col-span-3 md:flex-row md:items-center editorial-shadow">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <h3 className="font-headline text-xs font-extrabold uppercase tracking-widest text-[var(--ref-on-surface)]">
                    Market velocity
                  </h3>
                  <span className="rounded bg-[var(--ref-secondary-container)]/25 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--ref-secondary)]">
                    Ledger benchmark
                  </span>
                </div>
                <p className="max-w-lg text-[10px] text-[var(--ref-on-surface-variant)]">
                  Net position and account mix update as you post manual entries. Use transactions to keep balances in
                  sync with reality.
                </p>
              </div>
              <div className="flex h-16 shrink-0 items-end gap-1 px-2 md:w-1/3">
                {[40, 55, 70, 60, 85, 75, 95, 100].map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t-sm bg-[var(--ref-primary-container)]"
                    style={{ height: `${h}%`, opacity: 0.12 + i * 0.1 }}
                  />
                ))}
              </div>
            </div>
            <div className="relative flex flex-col justify-center overflow-hidden rounded-xl bg-[var(--ref-primary)] p-6 text-white editorial-shadow">
              <Sparkles className="absolute right-2 top-2 h-10 w-10 opacity-20" aria-hidden />
              <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">Insights</p>
              <p className="mt-1 text-xs font-semibold leading-relaxed">
                Review low-activity wallets and consolidate idle balances into your primary account.
              </p>
            </div>
          </section>
        )}

        <footer className="flex flex-col gap-2 border-t border-[var(--ref-outline-variant)]/20 pt-4 text-[10px] font-medium text-[var(--ref-outline)] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-4">
            <span className="uppercase tracking-tighter">Manual ledger: active</span>
            <span className="uppercase tracking-tighter">Data integrity: verified</span>
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
          accounts={accounts}
          onSuccess={loadAccounts}
        />
      </div>
    </RequireAuth>
  );
}

function LedgerColumn({
  title,
  accounts,
  emptyHint,
  onEdit,
  onDelete,
  cardVariant,
  footerSummary,
}: {
  title: string;
  accounts: AccountRow[];
  emptyHint: string;
  onEdit: (a: AccountRow) => void;
  onDelete: (id: number) => void;
  cardVariant: 'cash' | 'ewallet' | 'credit' | 'paylater';
  footerSummary?: number;
}) {
  const countLabel =
    cardVariant === 'credit' && accounts.some((a) => a.type === 'liability')
      ? `${accounts.length} card${accounts.length === 1 ? '' : 's'}`
      : `${accounts.length} account${accounts.length === 1 ? '' : 's'}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <h3 className="font-headline text-xs font-extrabold uppercase tracking-widest text-[var(--ref-primary)]">
          {title}
        </h3>
        <span className="font-body text-[10px] font-medium text-[var(--ref-outline)]">{countLabel}</span>
      </div>
      {accounts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--ref-outline-variant)]/40 px-3 py-6 text-center text-[10px] text-[var(--ref-outline)]">
          {emptyHint}
        </p>
      ) : (
        accounts.map((a, idx) => (
          <AccountTile
            key={a.id}
            account={a}
            variant={cardVariant}
            darkCard={cardVariant === 'credit' && a.type === 'liability' && idx === 0}
            onEdit={() => onEdit(a)}
            onDelete={() => onDelete(a.id)}
          />
        ))
      )}
      {footerSummary != null && footerSummary > 0 && (
        <div className="rounded-xl border border-[var(--ref-primary)]/15 bg-[var(--ref-primary)]/5 p-4">
          <p className="text-[9px] font-bold uppercase tracking-tighter text-[var(--ref-primary)]">
            Total PayLater dues
          </p>
          <p className="font-headline text-sm font-bold text-[var(--ref-primary)]">
            {formatCurrency(footerSummary)}
          </p>
        </div>
      )}
    </div>
  );
}

function AccountTile({
  account: a,
  variant,
  darkCard,
  onEdit,
  onDelete,
}: {
  account: AccountRow;
  variant: 'cash' | 'ewallet' | 'credit' | 'paylater';
  darkCard?: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const accent = a.color || 'var(--ref-primary-container)';
  const maskHint = `···${String(a.id).slice(-4).padStart(4, '0')}`;

  if (darkCard) {
    return (
      <article className="group relative overflow-hidden rounded-xl bg-[#2e3038] p-5 text-white transition-all hover:shadow-[0px_20px_40px_rgba(25,27,35,0.1)]">
        <div className="pointer-events-none absolute -right-4 -top-4 h-24 w-24 rounded-full bg-white/5 blur-2xl" />
        <div className="relative z-10">
          <div className="mb-4 flex items-start justify-between">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase text-white/50">
                {a.type === 'liability' ? 'Liability' : 'Asset'}
              </p>
              <h4 className="font-headline text-sm font-bold">{a.name}</h4>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="rounded p-1 text-white/50 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
                onClick={onEdit}
              >
                <Edit2 className="h-4 w-4" />
              </button>
              <CreditCard className="h-5 w-5 text-amber-400" aria-hidden />
            </div>
          </div>
          <p className="text-[10px] text-white/60">Ledger balance</p>
          <p className="font-headline text-xl font-extrabold tracking-tight">{formatCurrency(a.balance)}</p>
          <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-[10px]">
            <span className="text-white/50">Ref: {maskHint}</span>
            <Link
              to="/transactions"
              search={{ accountId: String(a.id) }}
              className="font-bold text-[var(--ref-on-primary-container)] hover:underline cursor-pointer"
            >
              Ledger
            </Link>
          </div>
          <button
            type="button"
            onClick={onDelete}
            className="mt-2 text-[10px] text-red-300 hover:text-red-100"
          >
            Remove
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
            className="rounded p-1 text-[var(--ref-outline)] opacity-0 hover:text-[var(--ref-primary)] group-hover:opacity-100"
            onClick={onEdit}
          >
            <Edit2 className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-baseline justify-between">
          <p className="font-headline text-lg font-bold tracking-tight text-[var(--ref-on-surface)]">
            {formatCurrency(a.balance)}
          </p>
          <span className="rounded bg-[var(--ref-surface-container)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ref-on-surface-variant)]">
            WALLET
          </span>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-[var(--ref-outline-variant)]/15 pt-2">
          <Link
            to="/transactions"
            search={{ accountId: String(a.id) }}
            className="text-[10px] font-bold text-[var(--ref-primary)] hover:underline"
          >
            Activity
          </Link>
          <button type="button" onClick={onDelete} className="text-[10px] text-[var(--ref-error)] hover:underline cursor-pointer">
            Remove
          </button>
        </div>
      </article>
    );
  }

  if (variant === 'paylater') {
    return (
      <article className="group rounded-xl border border-[var(--ref-outline-variant)]/30 bg-[var(--ref-surface-container)] p-4 transition-all hover:shadow-[0px_10px_25px_rgba(25,27,35,0.05)]">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase text-[var(--ref-on-surface-variant)]">PayLater</p>
          <button
            type="button"
            className="rounded p-0.5 text-[var(--ref-outline)] opacity-0 hover:text-[var(--ref-primary)] group-hover:opacity-100 cursor-pointer"
            onClick={onEdit}
          >
            <Edit2 className="h-4 w-4" />
          </button>
        </div>
        <p className="font-headline text-lg font-bold text-[var(--ref-on-surface)]">{formatCurrency(a.balance)}</p>
        <div className="mt-3 flex items-center justify-between text-[9px] font-semibold">
          <span className="uppercase text-[var(--ref-error)]">Ledger liability</span>
          <Link to="/transactions" search={{ accountId: String(a.id) }} className="text-[var(--ref-primary)] hover:underline">
            Entries
          </Link>
        </div>
        <button type="button" onClick={onDelete} className="mt-2 text-[10px] text-[var(--ref-error)] hover:underline cursor-pointer">
          Remove
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
          className="rounded p-1 text-[var(--ref-outline)] opacity-0 hover:text-[var(--ref-primary)] group-hover:opacity-100"
          onClick={onEdit}
        >
          <Edit2 className="h-4 w-4" />
        </button>
      </div>
      <p className="font-headline text-xl font-extrabold tracking-tight text-[var(--ref-on-surface)]">
        {formatCurrency(a.balance)}
      </p>
      <div className="mt-4 flex items-center justify-between border-t border-[var(--ref-outline-variant)]/15 pt-4 text-[10px] font-medium text-[var(--ref-on-surface-variant)]">
        <span className="flex items-center gap-1">
          <Banknote className="h-3 w-3" aria-hidden />
          Acc: {maskHint}
        </span>
        <Link to="/transactions" search={{ accountId: String(a.id) }} className="font-bold text-[var(--ref-primary)] hover:underline">
          Ledger
        </Link>
      </div>
      <button
        type="button"
        onClick={onDelete}
        className="mt-2 text-[10px] font-medium text-[var(--ref-error)] hover:underline"
      >
        Remove account
      </button>
    </article>
  );
}
