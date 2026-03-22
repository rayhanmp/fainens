import { createFileRoute, Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Button } from '../components/ui/Button';
import { RequireAuth } from '../lib/auth';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { formatCurrency, cn } from '../lib/utils';
import {
  Plus,
  Edit2,
  Trash2,
  Wallet,
  Search,
  Download,
  SlidersHorizontal,
  ShoppingCart,
  UtensilsCrossed,
  Car,
  Briefcase,
  ArrowLeftRight,
  Landmark,
  MoreHorizontal,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  CircleDot,
} from 'lucide-react';
import {
  TransactionModal,
  type EditingTransaction,
  type WalletAccount,
} from '../components/transactions/TransactionModal';

export const Route = createFileRoute('/transactions')({
  validateSearch: (search: Record<string, unknown>) => ({
    periodId: typeof search.periodId === 'string' ? search.periodId : undefined,
    accountId: typeof search.accountId === 'string' ? search.accountId : undefined,
  }),
  component: TransactionsPage,
} as any);

interface TransactionRow {
  id: number;
  date: number;
  description: string;
  reference?: string;
  notes?: string;
  txType: string;
  categoryId: number | null;
  periodId: number | null;
  linkedTxId: number | null;
  lines: Array<{
    id: number;
    accountId: number;
    debit: number;
    credit: number;
    description?: string;
  }>;
  tags: Array<{ tagId: number; name: string; color: string }>;
}

interface Category {
  id: number;
  name: string;
  icon?: string | null;
  color?: string | null;
}

const PAGE_SIZE = 10;

function formatTxTableDate(ts: number) {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTxTime(ts: number) {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function pickCategoryIcon(categoryName: string | undefined, kind: string) {
  const n = (categoryName ?? '').toLowerCase();
  if (kind === 'income') return Briefcase;
  if (kind === 'transfer') return ArrowLeftRight;
  if (n.includes('food') || n.includes('dining') || n.includes('meal')) return UtensilsCrossed;
  if (n.includes('transport') || n.includes('taxi') || n.includes('grab')) return Car;
  if (n.includes('shop') || n.includes('retail')) return ShoppingCart;
  if (n.includes('bank') || n.includes('salary')) return Landmark;
  return ShoppingCart;
}

function downloadTransactionsCsv(
  rows: TransactionRow[],
  getDisplay: (tx: TransactionRow) => { kind: string; amount: number; detail: string },
  categories: Category[],
) {
  const header = 'Date,Description,Category,Amount (IDR),Type\n';
  const body = rows
    .map((tx) => {
      const d = getDisplay(tx);
      const cat = tx.categoryId
        ? categories.find((c) => c.id === tx.categoryId)?.name ?? ''
        : '';
      const desc = tx.description.replace(/"/g, '""');
      return `${formatTxTableDate(tx.date)},"${desc}","${cat.replace(/"/g, '""')}",${d.amount},${d.kind}`;
    })
    .join('\n');
  const blob = new Blob([header + body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function TransactionsPage() {
  const search = useSearch({ from: '/transactions' }) as { periodId?: string; accountId?: string };
  const navigate = useNavigate({ from: '/transactions' });

  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [accounts, setAccounts] = useState<WalletAccount[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Array<{ id: number; name: string; color: string }>>([]);
  const [periods, setPeriods] = useState<
    Array<{ id: number; name: string; startDate: number; endDate: number }>
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<EditingTransaction | null>(null);
  const [modalInitialMode, setModalInitialMode] = useState<'view' | 'edit'>('edit');
  const [filterQuery, setFilterQuery] = useState('');
  const [txTypeFilter, setTxTypeFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    loadData();
  }, [search.periodId, search.accountId]);

  useEffect(() => {
    api.periods
      .list()
      .then(setPeriods)
      .catch(() => setPeriods([]));
  }, []);

  const loadData = async () => {
    try {
      const periodId =
        search.periodId && search.periodId !== 'undefined' && !isNaN(parseInt(search.periodId, 10))
          ? search.periodId
          : undefined;

      const accountId =
        search.accountId && search.accountId !== 'undefined' && !isNaN(parseInt(search.accountId, 10))
          ? search.accountId
          : undefined;

      const [txData, accData, catData, tagData] = await Promise.all([
        api.transactions.list({
          limit: '500',
          ...(periodId && { periodId }),
          ...(accountId && { accountId }),
        }),
        api.accounts.list(),
        api.categories.list(),
        api.tags.list(),
      ]);
      setTransactions(txData as TransactionRow[]);
      setAccounts(accData as WalletAccount[]);
      setCategories(catData);
      setTags(tagData);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this transaction?')) return;
    try {
      await api.transactions.delete(id);
      await loadData();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const openModal = (transaction?: TransactionRow, mode: 'view' | 'edit' = 'edit') => {
    setModalInitialMode(mode);
    if (transaction) {
      setEditingTransaction({
        id: transaction.id,
        date: transaction.date,
        description: transaction.description,
        notes: transaction.notes,
        categoryId: transaction.categoryId,
        txType: transaction.txType,
        lines: transaction.lines,
        tags: transaction.tags,
      });
    } else {
      setEditingTransaction(null);
    }
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingTransaction(null);
  };

  const getTransactionDisplay = useCallback(
    (tx: TransactionRow) => {
      const amount =
        tx.lines.length > 0
          ? Math.max(...tx.lines.map((l) => Math.max(l.debit, l.credit)))
          : 0;

      if (tx.categoryId) {
        const cat = categories.find((c) => c.id === tx.categoryId);
        const walletLine = tx.lines.find((l) => l.credit > 0 && l.debit === 0);
        const acc = walletLine ? accounts.find((a) => a.id === walletLine.accountId) : undefined;
        return {
          kind: 'expense' as const,
          amount,
          detail: cat ? `${cat.name} · ${acc?.name ?? 'Wallet'}` : tx.description,
        };
      }

      if (tx.txType?.includes('transfer') || tx.txType === 'simple_transfer') {
        const deb = tx.lines.find((l) => l.debit > 0);
        const cred = tx.lines.find((l) => l.credit > 0);
        const from = cred ? accounts.find((a) => a.id === cred.accountId) : undefined;
        const to = deb ? accounts.find((a) => a.id === deb.accountId) : undefined;
        return {
          kind: 'transfer' as const,
          amount,
          detail: `${from?.name ?? '?'} → ${to?.name ?? '?'}`,
        };
      }

      if (tx.txType?.includes('income') || tx.txType === 'simple_income') {
        const walletLine = tx.lines.find((l) => l.debit > 0);
        const acc = walletLine ? accounts.find((a) => a.id === walletLine.accountId) : undefined;
        return {
          kind: 'income' as const,
          amount,
          detail: acc?.name ?? tx.description,
        };
      }

      return {
        kind: 'other' as const,
        amount,
        detail: tx.description,
      };
    },
    [categories, accounts],
  );

  const filtered = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    return transactions.filter((tx) => {
      const d = getTransactionDisplay(tx);
      const kind = d.kind;
      if (txTypeFilter === 'expense' && kind !== 'expense') return false;
      if (txTypeFilter === 'income' && kind !== 'income') return false;
      if (txTypeFilter === 'transfer' && kind !== 'transfer') return false;
      if (categoryFilter && String(tx.categoryId ?? '') !== categoryFilter) return false;
      if (!q) return true;
      return (
        tx.description.toLowerCase().includes(q) ||
        d.detail.toLowerCase().includes(q) ||
        tx.tags.some((t) => t.name.toLowerCase().includes(q))
      );
    });
  }, [transactions, filterQuery, txTypeFilter, categoryFilter, getTransactionDisplay]);

  useEffect(() => {
    setPage(1);
  }, [filterQuery, txTypeFilter, categoryFilter, search.periodId, search.accountId]);

  const monthlyExpenseTotal = useMemo(() => {
    return filtered.reduce((sum, tx) => {
      const d = getTransactionDisplay(tx);
      if (d.kind === 'expense') return sum + d.amount;
      return sum;
    }, 0);
  }, [filtered, getTransactionDisplay]);

  const paginated = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const periodLabel = useMemo(() => {
    if (!search.periodId) return null;
    const p = periods.find((x) => String(x.id) === search.periodId);
    return p?.name ?? null;
  }, [search.periodId, periods]);

  const accountFilterLabel = useMemo(() => {
    if (!search.accountId) return null;
    const id = parseInt(search.accountId, 10);
    if (isNaN(id)) return null;
    const a = accounts.find((x) => x.id === id);
    return a?.name ?? `Account #${id}`;
  }, [search.accountId, accounts]);

  const scrollToFilters = () => {
    document.getElementById('tx-filters')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <RequireAuth>
      <div className="space-y-6 lg:space-y-8 pb-8">
        {/* Hero — Stitch Localized Transactions */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <h1 className="font-headline text-3xl sm:text-4xl font-extrabold tracking-tight text-[var(--color-text-primary)] mb-2">
              Transactions
            </h1>
            <p className="text-sm text-[var(--color-text-secondary)] font-body">
              {isLoading
                ? 'Loading activity…'
                : `Reviewing ${filtered.length} activit${filtered.length === 1 ? 'y' : 'ies'}${
                    periodLabel ? ` · ${periodLabel}` : ''
                  }${accountFilterLabel ? ` · ${accountFilterLabel}` : ''}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={filtered.length === 0}
              onClick={() => downloadTransactionsCsv(filtered, getTransactionDisplay, categories)}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-5 py-2.5 text-sm font-semibold text-[var(--color-text-primary)] shadow-sm transition-colors hover:bg-[var(--ref-surface-container-low)] disabled:opacity-40"
            >
              <Download className="h-4 w-4" />
              Download CSV
            </button>
            <button
              type="button"
              onClick={scrollToFilters}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--color-accent)] px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[var(--color-accent)]/15 transition-opacity hover:opacity-90"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filters
            </button>
            <Button onClick={() => openModal()} className="rounded-full px-5 py-2.5">
              <Plus className="w-4 h-4 mr-2" />
              Add transaction
            </Button>
          </div>
        </div>

        {accountFilterLabel && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-4 py-3 sm:px-5">
            <p className="text-sm text-[var(--color-text-primary)]">
              Showing ledger lines touching{' '}
              <span className="font-headline font-bold">{accountFilterLabel}</span>
            </p>
            <Link
              to="/transactions"
              search={search.periodId ? { periodId: search.periodId } : {}}
              className="text-sm font-semibold text-[var(--ref-primary)] hover:underline"
            >
              Clear account filter
            </Link>
          </div>
        )}

        {/* Search — pill */}
        <div className="relative max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]" />
          <input
            type="search"
            placeholder="Search transactions…"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            className="w-full rounded-full border-none bg-[var(--ref-surface-container-highest)] py-2.5 pl-10 pr-4 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-muted)] focus:ring-2 focus:ring-[var(--color-accent)]/20"
          />
        </div>

        {/* Bento filters */}
        <div id="tx-filters" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl bg-[var(--ref-surface-container-lowest)] p-5 shadow-sm">
            <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
              Period
            </label>
            <select
              value={search.periodId ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                navigate({
                  search: (prev: { periodId?: string }) => ({
                    ...prev,
                    periodId: v || undefined,
                  }),
                });
              }}
              className="w-full cursor-pointer border-none bg-transparent p-0 text-sm font-semibold text-[var(--color-text-primary)] focus:ring-0"
            >
              <option value="">All periods</option>
              {periods.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="rounded-xl bg-[var(--ref-surface-container-lowest)] p-5 shadow-sm">
            <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
              Category
            </label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full cursor-pointer border-none bg-transparent p-0 text-sm font-semibold text-[var(--color-text-primary)] focus:ring-0"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="rounded-xl bg-[var(--ref-surface-container-lowest)] p-5 shadow-sm">
            <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
              Type
            </label>
            <select
              value={txTypeFilter}
              onChange={(e) => setTxTypeFilter(e.target.value)}
              className="w-full cursor-pointer border-none bg-transparent p-0 text-sm font-semibold text-[var(--color-text-primary)] focus:ring-0"
            >
              <option value="">All types</option>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
              <option value="transfer">Transfer</option>
            </select>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-[var(--ref-tertiary-container)] p-5 text-[#e8e7ff] shadow-sm">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider opacity-90">Expense total</p>
              <p className="font-headline text-xl font-extrabold tracking-tight">
                {formatCurrency(monthlyExpenseTotal)}
              </p>
            </div>
            <TrendingUp className="h-10 w-10 shrink-0 opacity-40" aria-hidden />
          </div>
        </div>

        {isLoading ? (
          <div className="rounded-xl bg-[var(--ref-surface-container-lowest)] p-12 text-center shadow-sm">
            <p className="text-[var(--color-text-secondary)]">Loading transactions…</p>
          </div>
        ) : transactions.length === 0 ? (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-12 text-center shadow-sm">
            <Wallet className="mx-auto mb-4 h-12 w-12 text-[var(--color-muted)]" />
            <p className="mb-2 text-[var(--color-text-secondary)]">
              No transactions yet. Add your first expense or income.
            </p>
            <Button onClick={() => openModal()} className="mt-4 rounded-full">
              <Plus className="mr-2 h-4 w-4" />
              Add transaction
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl bg-[var(--ref-surface-container-lowest)] p-12 text-center shadow-sm">
            <p className="text-[var(--color-text-secondary)]">No matches for your filters.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left">
                <thead>
                  <tr className="bg-[var(--ref-surface-container-highest)]">
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-[var(--color-text-secondary)] sm:px-6">
                      Date
                    </th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-[var(--color-text-secondary)] sm:px-6">
                      Description
                    </th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-[var(--color-text-secondary)] sm:px-6">
                      Category
                    </th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-widest text-[var(--color-text-secondary)] sm:px-6">
                      Amount
                    </th>
                    <th className="hidden px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-[var(--color-text-secondary)] md:table-cell sm:px-6">
                      Status
                    </th>
                    <th className="px-4 py-3 sm:px-6" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {paginated.map((tx) => {
                    const display = getTransactionDisplay(tx);
                    const cat = tx.categoryId
                      ? categories.find((c) => c.id === tx.categoryId)
                      : null;
                    const Icon = pickCategoryIcon(cat?.name, display.kind);
                    const subLine = `${display.detail} · ${formatTxTime(tx.date)}`;

                    const amountSigned =
                      display.kind === 'income'
                        ? display.amount
                        : display.kind === 'expense'
                          ? -display.amount
                          : display.amount;

                    const categoryPillClass =
                      display.kind === 'income'
                        ? 'bg-[var(--ref-secondary-container)] text-[var(--ref-on-secondary-container)]'
                        : display.kind === 'transfer'
                          ? 'bg-[var(--ref-surface-container-highest)] text-[var(--color-text-secondary)]'
                          : cat?.color
                            ? 'border border-[var(--color-border)]'
                            : 'bg-[var(--ref-secondary-container)] text-[var(--ref-on-secondary-container)]';

                    return (
                      <tr
                        key={tx.id}
                        className="group transition-colors hover:bg-[var(--ref-surface-container-low)]"
                      >
                        <td className="whitespace-nowrap px-4 py-4 text-sm font-medium text-[var(--color-muted)] sm:px-6 sm:py-5">
                          {formatTxTableDate(tx.date)}
                        </td>
                        <td className="px-4 py-4 sm:px-6 sm:py-5">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--ref-surface-container-highest)]">
                              <Icon
                                className={cn(
                                  'h-5 w-5',
                                  display.kind === 'expense' && 'text-[var(--color-accent)]',
                                  display.kind === 'income' && 'text-[var(--color-success)]',
                                  display.kind === 'transfer' && 'text-[var(--ref-tertiary)]',
                                  display.kind === 'other' && 'text-[var(--color-muted)]',
                                )}
                              />
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-[var(--color-text-primary)]">
                                {tx.description}
                                {tx.linkedTxId && (
                                  <span className="ml-2 inline-flex items-center rounded-full bg-[var(--color-warning)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--color-warning)]">
                                    Transfer Fee
                                  </span>
                                )}
                              </p>
                              <p className="truncate text-[11px] font-medium text-[var(--color-muted)]">
                                {subLine}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 sm:px-6 sm:py-5">
                          <span
                            className={cn(
                              'inline-block rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-tight',
                              categoryPillClass,
                            )}
                            style={
                              display.kind === 'expense' && cat?.color
                                ? { backgroundColor: `${cat.color}22`, color: cat.color }
                                : undefined
                            }
                          >
                            {cat?.name ?? display.kind}
                          </span>
                        </td>
                        <td
                          className={cn(
                            'whitespace-nowrap px-4 py-4 text-right font-headline text-sm font-extrabold sm:px-6 sm:py-5',
                            amountSigned > 0 && 'text-[var(--color-success)]',
                            amountSigned < 0 && 'text-[var(--color-text-primary)]',
                          )}
                        >
                          {amountSigned > 0 ? '+' : ''}
                          {formatCurrency(Math.abs(amountSigned))}
                        </td>
                        <td className="hidden px-4 py-4 md:table-cell sm:px-6 sm:py-5">
                          <div className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--color-success)]">
                            <CircleDot className="h-3.5 w-3.5 fill-[var(--color-success)] text-[var(--color-success)]" />
                            Posted
                          </div>
                        </td>
                        <td className="px-2 py-4 text-right opacity-100 transition-opacity sm:px-4 sm:opacity-0 sm:group-hover:opacity-100 md:px-6 md:py-5">
                          <div className="inline-flex items-center gap-0.5">
                            {tx.linkedTxId && (
                              <button
                                type="button"
                                onClick={() => {
                                  const parentTx = transactions.find(t => t.id === tx.linkedTxId);
                                  if (parentTx) openModal(parentTx);
                                }}
                                className="rounded-lg p-2 text-[var(--color-warning)] hover:bg-[var(--color-warning)]/10"
                                title="View parent transfer"
                              >
                                <ArrowLeftRight className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => openModal(tx, 'view')}
                              className="rounded-lg p-2 text-[var(--color-muted)] hover:bg-[var(--color-accent)]/10 hover:text-[var(--color-accent)]"
                              title="Edit"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(tx.id)}
                              className="rounded-lg p-2 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                            <span className="hidden sm:inline">
                              <MoreHorizontal className="h-4 w-4 text-[var(--color-muted)] opacity-50" />
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {filtered.length > PAGE_SIZE && (
              <div className="flex flex-col gap-3 border-t border-[var(--color-border)] bg-[var(--ref-surface-container-low)]/50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
                <p className="text-xs font-medium text-[var(--color-muted)]">
                  Showing{' '}
                  <span className="font-bold text-[var(--color-text-primary)]">
                    {(page - 1) * PAGE_SIZE + 1} – {Math.min(page * PAGE_SIZE, filtered.length)}
                  </span>{' '}
                  of {filtered.length} transactions
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="rounded-lg p-2 text-[var(--color-muted)] hover:bg-[var(--ref-surface-container-highest)] disabled:opacity-30"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <span className="px-2 text-xs font-bold text-[var(--color-text-secondary)]">
                    {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="rounded-lg p-2 text-[var(--color-muted)] hover:bg-[var(--ref-surface-container-highest)] disabled:opacity-30"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Contextual insight — compact */}
        {!isLoading && transactions.length > 0 && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="relative flex min-h-[200px] flex-col justify-between overflow-hidden rounded-xl bg-[var(--color-accent)] p-6 text-white shadow-md lg:col-span-2">
              <div className="relative z-10">
                <h3 className="mb-2 font-headline text-xl font-extrabold">Spending snapshot</h3>
                <p className="max-w-lg text-sm leading-relaxed opacity-90">
                  Filter by period and category to focus this list. Export CSV for spreadsheets or
                  your accountant.
                </p>
              </div>
              <div className="relative z-10 pt-4">
                <button
                  type="button"
                  onClick={scrollToFilters}
                  className="rounded-full bg-white px-5 py-2 text-sm font-bold text-[var(--color-accent)] transition-colors hover:bg-[var(--ref-surface-container-low)]"
                >
                  Adjust filters
                </button>
              </div>
              <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-white/10" />
            </div>
            <div className="flex flex-col items-center justify-center rounded-xl border-t-4 border-[var(--color-success)] bg-[var(--ref-surface-container-lowest)] p-6 text-center shadow-sm">
              <CircleDot className="mb-3 h-10 w-10 text-[var(--color-success)]" />
              <h3 className="mb-1 font-headline text-lg font-extrabold text-[var(--color-text-primary)]">
                Ledger in sync
              </h3>
              <p className="text-xs font-medium text-[var(--color-text-secondary)]">
                Amounts reflect your recorded journal entries for the selected filters.
              </p>
            </div>
          </div>
        )}

        <TransactionModal
          isOpen={isModalOpen}
          onClose={closeModal}
          onSaved={loadData}
          accounts={accounts}
          categories={categories}
          tags={tags}
          editingTransaction={editingTransaction}
          periodId={search.periodId ? parseInt(search.periodId, 10) : null}
          initialMode={modalInitialMode}
        />
      </div>
    </RequireAuth>
  );
}
