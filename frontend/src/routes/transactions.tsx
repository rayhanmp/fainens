import { Link, createFileRoute, redirect, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, ChevronLeft, ChevronRight, CircleAlert, Clock, Download, FileUp, Landmark, MoreHorizontal, Plus, Receipt, RotateCcw, Search, SlidersHorizontal, Trash2, Upload, Wallet, X } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { PageContainer } from '../components/ui/PageContainer';
import { PageHeader } from '../components/ui/PageHeader';
import { TransactionModal, type EditingTransaction, type WalletAccount } from '../components/transactions/TransactionModal';
import { ImportCSVModal } from '../components/transactions/ImportCSVModal';
import { PendingTransactionsModal } from '../components/transactions/PendingTransactionsModal';
import { useConfirm } from '../components/ui/ConfirmDialog';
import { RequireAuth } from '../lib/auth';
import { api } from '../lib/api';
import { cn, formatCurrency } from '../lib/utils';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { usePendingTransactionsQuery, useTransactionDetailQuery, useTransactionList } from '../features/transactions/queries';
import { useAccountsQuery } from '../features/accounts/queries';
import { useCategoriesQuery } from '../features/categories/queries';
import { usePeriodsQuery } from '../features/periods/queries';
import { invalidateFinancialSummaries } from '../features/core/query-keys';
import { useTags } from '../hooks/api';

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export const Route = createFileRoute('/transactions')({
  validateSearch: (search: Record<string, unknown>) => ({
    periodId: typeof search.periodId === 'string' ? search.periodId : undefined,
    accountId: typeof search.accountId === 'string' ? search.accountId : undefined,
    categoryId: typeof search.categoryId === 'string' ? search.categoryId : undefined,
    transactionId: typeof search.transactionId === 'string' ? search.transactionId : undefined,
    action: typeof search.action === 'string' ? search.action : undefined,
  }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  beforeLoad: async ({ search }: { search: any }) => {
    if (search.periodId === 'all' || (search.periodId && Number.isSafeInteger(Number(search.periodId)))) return;
    const periods = await api.periods.list();
    const now = Date.now();
    const current = periods.find((period) => period.startDate <= now && now <= period.endDate + DAY_MS - 1);
    if (current) throw redirect({ to: '/transactions', search: { ...search, periodId: String(current.id) }, replace: true });
  },
  component: TransactionsPage,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any);

interface Category { id: number; name: string; icon?: string | null; color?: string | null; }
interface Period { id: number; name: string; startDate: number; endDate: number; coverageStatus: 'complete' | 'partial' | 'skipped' | 'unknown'; coverageReason: string | null; }
type TransactionRow = Awaited<ReturnType<typeof api.transactions.list>>['data'][number];
type ActivityKind = 'expense' | 'income' | 'transfer' | 'loan' | 'other';

function formatDateTime(timestamp: number) {
  return new Date(timestamp).toLocaleString('en-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function formatDateInputEnd(value: string) { return value ? value + 'T23:59:59.999' : undefined; }
function getKind(transaction: TransactionRow): ActivityKind {
  if (transaction.txType.includes('loan')) return 'loan';
  if (transaction.txType === 'simple_transfer' || transaction.txType === 'transfer') return 'transfer';
  if (transaction.expenseCents > 0) return 'expense';
  if (transaction.incomeCents > 0) return 'income';
  return 'other';
}
function displayAmount(transaction: TransactionRow) {
  if (transaction.expenseCents > 0) return -transaction.expenseCents;
  if (transaction.incomeCents > 0) return transaction.incomeCents;
  return Math.max(transaction.debitCents, transaction.creditCents);
}
function isTransferFee(transaction: TransactionRow) {
  return transaction.linkedTxId != null && (
    /^transfer fee:/i.test(transaction.description) ||
    /^admin fee for transfer #\d+/i.test(transaction.notes ?? '')
  );
}
function coverageMessage(period: Period) {
  if (period.coverageStatus === 'skipped') return 'This period was skipped during an untracked break. An empty activity list is not proof of zero activity.';
  if (period.coverageStatus === 'partial') return 'Some activity is missing in this period. Recorded totals are not a full financial result.';
  return 'This period’s activity coverage has not been reviewed. Treat totals as recorded activity only.';
}
function categoryLabel(transaction: TransactionRow, categories: Category[]) {
  const allocations = transaction.categoryAllocations.filter((allocation) => allocation.amount !== 0);
  if (allocations.length > 1) return (allocations[0].categoryName ?? 'Allocated') + ' + ' + String(allocations.length - 1);
  if (allocations.length === 1) return allocations[0].categoryName ?? 'Allocated';
  return categories.find((category) => category.id === transaction.categoryId)?.name ?? null;
}
function downloadPageCsv(rows: TransactionRow[], categories: Category[]) {
  const quote = (value: string) => {
    const safe = /^[=+\-@]/.test(value) ? "'" + value : value;
    return '"' + safe.replace(/"/g, '""') + '"';
  };
  const body = rows.map((row) => [formatDateTime(row.date), row.description, categoryLabel(row, categories) ?? '', String(displayAmount(row)), getKind(row)].map(quote).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob(['Date,Description,Category,Amount (IDR),Type\n' + body], { type: 'text/csv;charset=utf-8;' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'transactions-page-' + new Date().toISOString().slice(0, 10) + '.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}

// Route modules necessarily export a route object beside their component.
// eslint-disable-next-line react-refresh/only-export-components
function TransactionsPage() {
  const search = useSearch({ from: '/transactions' }) as { periodId?: string; accountId?: string; categoryId?: string; transactionId?: string; action?: string };
  const navigate = useNavigate({ from: '/transactions' });
  const { confirm } = useConfirm();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const openedDeepLinkId = useRef<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [filterQuery, setFilterQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<ActivityKind | ''>('');
  const [categoryFilter, setCategoryFilter] = useState(search.categoryId ?? '');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'largest'>('newest');
  const [includeAdjustments, setIncludeAdjustments] = useState(false);
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<EditingTransaction | null>(null);
  const [modalInitialMode, setModalInitialMode] = useState<'view' | 'edit'>('edit');
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isPendingModalOpen, setIsPendingModalOpen] = useState(false);
  const [editingPendingTx, setEditingPendingTx] = useState<{ id: number; parsedData: { type: string; amount: number; description: string; category: string; date?: string; place?: string; memo?: string; fromAccount?: string; toAccount?: string; confidence: number } } | null>(null);
  const [isSplitBillModalOpen, setIsSplitBillModalOpen] = useState(false);
  const [isSplitLoading, setIsSplitLoading] = useState(false);
  const [splitError, setSplitError] = useState<string | null>(null);
  const splitFileInputRef = useRef<HTMLInputElement>(null);

  const queryClient = useQueryClient();
  const transactionFilters = useMemo(() => ({
    ...(search.periodId ? { periodId: search.periodId === 'all' ? 'all' : search.periodId } : {}),
    ...(search.accountId ? { accountId: search.accountId } : {}),
    ...(categoryFilter ? { categoryId: categoryFilter } : {}),
    ...(filterQuery.trim() ? { search: filterQuery.trim() } : {}),
    ...(kindFilter && kindFilter !== 'other' ? { kind: kindFilter } : {}),
    ...(startDate ? { startDate: startDate + 'T00:00:00' } : {}),
    ...(endDate ? { endDate: formatDateInputEnd(endDate) } : {}),
    ...(minAmount ? { minAmount } : {}),
    ...(maxAmount ? { maxAmount } : {}),
    ...(includeAdjustments ? { includeReversals: 'true' } : {}),
    sort, limit: String(pageSize), offset: String((page - 1) * pageSize),
  }), [search.periodId, search.accountId, categoryFilter, filterQuery, kindFilter, startDate, endDate, minAmount, maxAmount, includeAdjustments, sort, page, pageSize]);
  const transactionQuery = useTransactionList(transactionFilters);
  const pendingQuery = usePendingTransactionsQuery();
  const deepLinkTransactionId = search.transactionId && Number.isSafeInteger(Number(search.transactionId))
    ? Number(search.transactionId)
    : null;
  const deepLinkQuery = useTransactionDetailQuery(deepLinkTransactionId);
  const accountsQuery = useAccountsQuery();
  const categoriesQuery = useCategoriesQuery();
  const periodsQuery = usePeriodsQuery();
  const tagsQuery = useTags();
  const transactions = (transactionQuery.data?.data ?? []) as TransactionRow[];
  const accounts = (accountsQuery.data ?? []) as WalletAccount[];
  const categories = (categoriesQuery.data ?? []) as Category[];
  const tags = (tagsQuery.data ?? []) as Array<{ id: number; name: string; color: string }>;
  const periods = (periodsQuery.data ?? []) as unknown as Period[];
  const pendingCount = pendingQuery.data?.length ?? 0;
  const isLoading = transactionQuery.isLoading || accountsQuery.isLoading || categoriesQuery.isLoading || periodsQuery.isLoading || tagsQuery.isLoading;
  const total = transactionQuery.data?.pagination?.total ?? 0;
  const summary = transactionQuery.data?.summary ?? { expenseCents: 0, incomeCents: 0 };

  useKeyboardShortcuts({ isModalOpen, searchInputRef });

  const loadData = () => invalidateFinancialSummaries(queryClient);
  useEffect(() => { setCategoryFilter(search.categoryId ?? ''); }, [search.categoryId]);
  useEffect(() => { setPage(1); }, [search.periodId, search.accountId, categoryFilter, filterQuery, kindFilter, startDate, endDate, minAmount, maxAmount, includeAdjustments, sort, pageSize]);
  useEffect(() => {
    if (search.action !== 'new' || isModalOpen) return;
    openModal();
    navigate({ search: (previous) => ({ ...previous, action: undefined }) });
  }, [search.action, isModalOpen, navigate]);
  useEffect(() => {
    if (!search.transactionId || openedDeepLinkId.current === search.transactionId) return;
    if (deepLinkQuery.error) return;
    if (!deepLinkQuery.data) return;
    openedDeepLinkId.current = search.transactionId;
    const transaction = deepLinkQuery.data;
    openModal({ ...transaction, status: 'posted', periodId: null, linkedTxId: null, reversalOfTxId: null, debitCents: 0, creditCents: 0, expenseCents: 0, incomeCents: 0 } as unknown as TransactionRow, 'view');
  }, [search.transactionId, deepLinkQuery.data, deepLinkQuery.error]);

  const selectedPeriod = useMemo(() => periods.find((period) => String(period.id) === search.periodId) ?? null, [periods, search.periodId]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const periodLabel = selectedPeriod?.name ?? (search.periodId === 'all' ? 'All periods' : 'Current period');
  const transactionRows = useMemo(() => {
    const feesByParentId = new Map<number, number>();
    for (const transaction of transactions) {
      if (isTransferFee(transaction) && transaction.linkedTxId != null) {
        feesByParentId.set(transaction.linkedTxId, (feesByParentId.get(transaction.linkedTxId) ?? 0) + Math.abs(transaction.expenseCents));
      }
    }
    return transactions
      .filter((transaction) => !isTransferFee(transaction))
      .map((transaction) => ({ transaction, transferFee: feesByParentId.get(transaction.id) ?? 0 }));
  }, [transactions]);

  const openModal = (transaction?: TransactionRow, mode: 'view' | 'edit' = 'edit') => {
    setModalInitialMode(mode);
    setEditingTransaction(transaction ? { id: transaction.id, date: transaction.date, description: transaction.description, reference: transaction.reference ?? undefined, notes: transaction.notes ?? undefined, place: transaction.place ?? undefined, categoryId: transaction.categoryId, txType: transaction.txType, lines: transaction.lines, categoryAllocations: transaction.categoryAllocations, tags: transaction.tags } : null);
    setIsModalOpen(true);
  };
  const closeModal = () => { setIsModalOpen(false); setEditingTransaction(null); setEditingPendingTx(null); };
  const handleCorrect = async (transaction: TransactionRow) => {
    if (!await confirm({ title: 'Correct transaction', message: 'This keeps the original for audit history and posts an equal opposite correction. You can then add the replacement transaction.', confirmLabel: 'Correct transaction', variant: 'warning' })) return;
    try { await api.transactions.reverse(transaction.id); await loadData(); } catch (error) { alert((error as Error).message); }
  };
  const handleDeleteDraft = async (transaction: TransactionRow) => {
    if (!await confirm({ title: 'Delete draft', message: 'This draft has not affected reports or balances. Delete it?', confirmLabel: 'Delete draft', variant: 'danger' })) return;
    try { await api.transactions.delete(transaction.id); await loadData(); } catch (error) { alert((error as Error).message); }
  };
  const handleSplitFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    setIsSplitLoading(true); setSplitError(null);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const imageUrl = reader.result as string;
        const result = await api.splitbill.scan(imageUrl, file.name);
        localStorage.setItem('splitbill_parsed', JSON.stringify({ parsed: result.parsed, imageUrl }));
        navigate({ to: '/split' });
      } catch (error) { setSplitError((error as Error).message || 'Could not scan this receipt'); } finally { setIsSplitLoading(false); }
    };
    reader.onerror = () => { setSplitError('Could not read this receipt'); setIsSplitLoading(false); };
    reader.readAsDataURL(file);
  };
  const clearFilters = () => {
    setFilterQuery(''); setKindFilter(''); setCategoryFilter(''); setStartDate(''); setEndDate(''); setMinAmount(''); setMaxAmount(''); setSort('newest'); setIncludeAdjustments(false);
    navigate({ search: (previous) => ({ ...previous, accountId: undefined, categoryId: undefined }) });
  };

  return <RequireAuth><PageContainer>
    <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <PageHeader subtext="Recorded activity" title="Transactions" description={isLoading ? 'Loading activity…' : total.toLocaleString() + ' activit' + (total === 1 ? 'y' : 'ies') + ' in ' + periodLabel + '.'} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative"><Button variant="secondary" className="rounded-full px-3" onClick={() => setIsToolsOpen((open) => !open)}><MoreHorizontal className="h-4 w-4" /><span className="ml-2">More tools</span></Button>
          {isToolsOpen && <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-2 shadow-xl">
            <button type="button" onClick={() => { downloadPageCsv(transactions, categories); setIsToolsOpen(false); }} disabled={transactions.length === 0} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[var(--ref-surface-container-low)] disabled:opacity-40"><Download className="h-4 w-4" />Export this page</button>
            <button type="button" onClick={() => { setIsImportModalOpen(true); setIsToolsOpen(false); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[var(--ref-surface-container-low)]"><FileUp className="h-4 w-4" />Import CSV</button>
            <button type="button" onClick={() => { setIsSplitBillModalOpen(true); setIsToolsOpen(false); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[var(--ref-surface-container-low)]"><Receipt className="h-4 w-4" />Split a receipt</button>
            <button type="button" onClick={() => { setIsPendingModalOpen(true); setIsToolsOpen(false); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[var(--ref-surface-container-low)]"><Clock className="h-4 w-4" />Review pending {pendingCount > 0 ? '(' + pendingCount + ')' : ''}</button>
          </div>}
        </div>
        <Button className="rounded-full" onClick={() => openModal()}><Plus className="mr-2 h-4 w-4" />Add transaction</Button>
      </div>
    </div>

    {selectedPeriod && selectedPeriod.coverageStatus !== 'complete' && <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"><CircleAlert className="mt-0.5 h-5 w-5 shrink-0" /><div><strong>Read this activity carefully.</strong> {coverageMessage(selectedPeriod)} <Link to="/periods" className="ml-1 font-bold underline">Review period</Link></div></div>}
    <section className="mt-6 rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center"><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ref-outline)]" /><input ref={searchInputRef} type="search" value={filterQuery} onChange={(event) => setFilterQuery(event.target.value)} placeholder="Search description, place, note, tag, or category… (Press /)" className="w-full rounded-full bg-[var(--ref-surface-container-low)] py-2.5 pl-10 pr-4 text-sm outline-none ring-[var(--ref-primary)] focus:ring-2" /></div>
        <select value={search.periodId ?? ''} onChange={(event) => navigate({ search: (previous) => ({ ...previous, periodId: event.target.value || undefined }) })} className="rounded-full border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-4 py-2.5 text-sm font-semibold"><option value="all">All periods</option>{periods.map((period) => <option key={period.id} value={String(period.id)}>{period.name}</option>)}</select>
        <Button variant="secondary" className="rounded-full" onClick={() => setIsFiltersOpen((open) => !open)}><SlidersHorizontal className="mr-2 h-4 w-4" />Filters</Button>
      </div>
      {isFiltersOpen && <div className="mt-4 grid gap-3 border-t border-[var(--ref-outline-variant)]/20 pt-4 sm:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">Account<select value={search.accountId ?? ''} onChange={(event) => navigate({ search: (previous) => ({ ...previous, accountId: event.target.value || undefined }) })} className="mt-1.5 block w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm"><option value="">All accounts</option>{accounts.map((account) => <option key={account.id} value={String(account.id)}>{account.name}</option>)}</select></label>
        <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">Category<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="mt-1.5 block w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm"><option value="">All categories</option>{categories.map((category) => <option key={category.id} value={String(category.id)}>{category.name}</option>)}</select></label>
        <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">Activity type<select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as ActivityKind | '')} className="mt-1.5 block w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm"><option value="">All activity</option><option value="expense">Spending</option><option value="income">Income</option><option value="transfer">Transfers</option><option value="loan">Loans</option></select></label>
        <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">Sort<select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="mt-1.5 block w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="largest">Largest amount</option></select></label>
        <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">From<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-1.5 block w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm" /></label>
        <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">To<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="mt-1.5 block w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm" /></label>
        <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">Minimum amount<input inputMode="numeric" value={minAmount} onChange={(event) => setMinAmount(event.target.value.replace(/\D/g, ''))} placeholder="Rp 0" className="mt-1.5 block w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm" /></label>
        <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">Maximum amount<input inputMode="numeric" value={maxAmount} onChange={(event) => setMaxAmount(event.target.value.replace(/\D/g, ''))} placeholder="No limit" className="mt-1.5 block w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm" /></label>
        <div className="flex items-end"><button type="button" onClick={clearFilters} className="inline-flex items-center gap-1.5 pb-2 text-sm font-bold text-[var(--ref-primary)] hover:underline"><X className="h-4 w-4" />Clear filters</button></div>
      </div>}
    </section>
    <section className="mt-4 flex flex-col gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--ref-outline)]">Spending in this view</p><p className="mt-1 font-headline text-2xl font-extrabold text-[var(--ref-on-surface)]">{formatCurrency(summary.expenseCents)}</p></div><p className="max-w-md text-sm text-[var(--ref-on-surface-variant)]">{selectedPeriod?.coverageStatus === 'complete' || !selectedPeriod ? 'Based on the full active filter scope, not just this page.' : 'Recorded spending only; period coverage is incomplete.'}</p></section>
    <section className="mt-4 overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] shadow-sm">
      <div className="flex flex-col gap-3 border-b border-[var(--ref-outline-variant)]/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-headline font-bold text-[var(--ref-on-surface)]">Activity</p><p className="mt-0.5 text-xs text-[var(--ref-on-surface-variant)]">Normal day-to-day transactions</p></div><button type="button" role="switch" aria-checked={includeAdjustments} title="Include accounting corrections and recovery adjustments" onClick={() => setIncludeAdjustments((current) => !current)} className="inline-flex w-fit shrink-0 items-center gap-2.5 rounded-full border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-xs font-bold whitespace-nowrap text-[var(--ref-on-surface-variant)] transition-colors hover:border-[var(--ref-primary)]/40 hover:text-[var(--ref-on-surface)]"><span className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', includeAdjustments ? 'bg-[var(--ref-primary)]' : 'bg-[var(--ref-outline-variant)]')}><span className={cn('absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform', includeAdjustments ? 'translate-x-4' : 'translate-x-0')} /></span><span>{includeAdjustments ? 'Showing corrections' : 'Show corrections'}</span></button></div>
      {isLoading ? <div className="p-12 text-center text-sm text-[var(--ref-on-surface-variant)]">Loading activity…</div> : total === 0 ? <div className="p-12 text-center"><Wallet className="mx-auto mb-3 h-10 w-10 text-[var(--ref-outline)]" /><p className="font-headline font-bold">No activity in this view</p><p className="mt-1 text-sm text-[var(--ref-on-surface-variant)]">Try changing filters or add a transaction.</p></div> : <div className="divide-y divide-[var(--ref-outline-variant)]/20">
        {transactionRows.map(({ transaction, transferFee }) => {
          const kind = getKind(transaction); const amount = displayAmount(transaction); const category = categoryLabel(transaction, categories);
          const walletLine = transaction.lines.find((line) => kind === 'income' ? line.debit > 0 : line.credit > 0) ?? transaction.lines[0];
          const accountName = walletLine?.accountName ?? accounts.find((account) => account.id === walletLine?.accountId)?.name;
          const correction = transaction.status === 'reversed' || transaction.txType === 'reversal' || transaction.txType === 'domain_reversal' || transaction.txType === 'historical_recovery_adjustment';
          return <article key={transaction.id} className={cn('group flex cursor-pointer items-center gap-3 px-4 py-4 transition-colors hover:bg-[var(--ref-surface-container-low)] sm:px-6', correction && 'bg-[var(--ref-surface-container-low)]/60')} onClick={() => openModal(transaction, 'view')}>
            <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl', kind === 'income' ? 'bg-emerald-500/10 text-emerald-700' : kind === 'transfer' ? 'bg-sky-500/10 text-sky-700' : correction ? 'bg-amber-500/10 text-amber-800' : 'bg-[var(--ref-primary)]/10 text-[var(--ref-primary)]')}>{kind === 'transfer' ? <ArrowLeftRight className="h-5 w-5" /> : kind === 'income' ? <Landmark className="h-5 w-5" /> : <Receipt className="h-5 w-5" />}</div>
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-headline font-bold text-[var(--ref-on-surface)]">{transaction.description}</p>{correction && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200">Accounting correction</span>}</div><p className="mt-1 truncate text-xs text-[var(--ref-on-surface-variant)]">{formatDateTime(transaction.date)} · {accountName ?? 'Account not available'}{transaction.place ? ' · ' + transaction.place : ''}</p>{transferFee > 0 && <p className="mt-1 text-[11px] font-medium text-[var(--ref-on-surface-variant)]">Includes transfer fee {formatCurrency(transferFee)}</p>}</div>
            <div className="hidden min-w-32 text-right sm:block"><p className="text-xs font-semibold text-[var(--ref-on-surface-variant)]">{category ?? (kind === 'income' ? 'Income' : kind === 'transfer' ? 'Transfer' : kind === 'loan' ? 'Loan' : 'Unallocated')}</p>{transaction.categoryAllocations.length > 1 && <p className="mt-0.5 text-[10px] text-[var(--ref-outline)]">Split allocation</p>}</div>
            <div className={cn('min-w-24 text-right font-headline text-sm font-extrabold', amount > 0 ? 'text-[var(--color-success)]' : 'text-[var(--ref-on-surface)]')}>{amount > 0 ? '+' : ''}{formatCurrency(Math.abs(amount))}</div>
            <div className="flex shrink-0 items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100" onClick={(event) => event.stopPropagation()}>{transaction.status === 'draft' ? <button type="button" onClick={() => void handleDeleteDraft(transaction)} className="rounded-xl p-2 text-[var(--ref-error)] hover:bg-[var(--ref-error)]/10" title="Delete draft"><Trash2 className="h-4 w-4" /></button> : <button type="button" disabled={correction} onClick={() => void handleCorrect(transaction)} className={cn('rounded-xl p-2 text-amber-700 hover:bg-amber-500/10', correction && 'cursor-not-allowed opacity-40 hover:bg-transparent')} title={correction ? 'Corrections cannot be reversed' : 'Correct transaction'}><RotateCcw className="h-4 w-4" /></button>}</div>
          </article>;
        })}
      </div>}
      {total > 0 && <footer className="flex flex-col gap-3 border-t border-[var(--ref-outline-variant)]/20 bg-[var(--ref-surface-container-low)]/50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3 text-xs text-[var(--ref-on-surface-variant)]"><span>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString()}</span><select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="rounded-lg border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-2 py-1">{PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size} per page</option>)}</select></div><div className="flex items-center gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} className="rounded-lg p-2 disabled:opacity-30"><ChevronLeft className="h-5 w-5" /></button><span className="text-xs font-bold">{page} / {totalPages}</span><button type="button" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)} className="rounded-lg p-2 disabled:opacity-30"><ChevronRight className="h-5 w-5" /></button></div></footer>}
    </section>
    <TransactionModal isOpen={isModalOpen} onClose={closeModal} onSaved={loadData} onSuccess={() => { void loadData(); setEditingPendingTx(null); }} accounts={accounts} categories={categories} tags={tags} editingTransaction={editingTransaction} periodId={search.periodId && search.periodId !== 'all' ? Number(search.periodId) : null} initialMode={modalInitialMode} pendingTransaction={editingPendingTx} />
    <ImportCSVModal isOpen={isImportModalOpen} onClose={() => setIsImportModalOpen(false)} onSuccess={loadData} />
    <PendingTransactionsModal isOpen={isPendingModalOpen} onClose={() => setIsPendingModalOpen(false)} onEdit={(pending) => { setEditingPendingTx(pending); setIsPendingModalOpen(false); openModal(); }} onRefresh={() => { void pendingQuery.refetch(); }} />
    <Modal isOpen={isSplitBillModalOpen} onClose={() => setIsSplitBillModalOpen(false)} title="Split bill" subtitle="Upload a receipt to start a shared bill."><div className="flex flex-col items-center"><div className="w-full cursor-pointer rounded-2xl border-2 border-dashed border-[var(--color-border)] p-8 text-center hover:bg-[var(--ref-surface-container-low)]" onClick={() => splitFileInputRef.current?.click()}><input ref={splitFileInputRef} type="file" accept="image/*" className="hidden" onChange={handleSplitFileSelect} />{isSplitLoading ? <div className="py-4"><div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-[var(--ref-primary)] border-t-transparent" /><p className="mt-3 text-sm">Scanning receipt…</p></div> : <><Upload className="mx-auto mb-3 h-8 w-8 text-[var(--ref-primary)]" /><p className="font-bold">Upload receipt</p><p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">PNG or JPG</p></>}</div>{splitError && <p className="mt-3 text-sm text-[var(--ref-error)]">{splitError}</p>}</div></Modal>
  </PageContainer></RequireAuth>;
}
