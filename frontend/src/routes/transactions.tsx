import { Link, createFileRoute, redirect, useNavigate, useSearch } from '@tanstack/react-router';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, BarChart3, ChevronLeft, ChevronRight, CircleAlert, Clock, CopyPlus, Download, FileUp, HandCoins, Landmark, MoreHorizontal, Plus, Receipt, RotateCcw, Search, SlidersHorizontal, Trash2, Wallet, X } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { SwipeReveal } from '../components/ui/SwipeReveal';
import { PageContainer } from '../components/ui/PageContainer';
import { PageHeader } from '../components/ui/PageHeader';
import { TransactionActivityChart, type ActivityDay } from '../components/transactions/TransactionActivityChart';
import { TransactionCategoryOverview, type CategoryOverviewItem } from '../components/transactions/TransactionCategoryOverview';
import { TransactionModal, type EditingTransaction, type TransactionPrefill, type WalletAccount } from '../components/transactions/TransactionModal';
import { ImportCSVModal } from '../components/transactions/ImportCSVModal';
import { PendingTransactionsModal } from '../components/transactions/PendingTransactionsModal';
import { useConfirm } from '../components/ui/ConfirmDialog';
import { RequireAuth } from '../lib/auth';
import type { api } from '../lib/api';
import type { ListTransactionsParams } from '../generated/client';
import { cn, formatCurrency } from '../lib/utils';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useDeleteTransaction, usePendingTransactionsQuery, useReverseTransaction, useTransactionDetailQuery, useTransactionList, type PendingTransactionListItem } from '../features/transactions/queries';
import { useAccountsQuery } from '../features/accounts/queries';
import { useCategoriesQuery, useTagsQuery } from '../features/categories/queries';
import { fetchPeriods, usePeriodsQuery } from '../features/periods/queries';
import { invalidateFinancialSummaries } from '../features/core/query-keys';
import { useUiStore } from '../stores/ui-store';

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
    const periods = await fetchPeriods();
    const now = Date.now();
    const current = periods.find((period) => period.startDate <= now && now <= period.endDate + DAY_MS - 1);
    if (current) throw redirect({ to: '/transactions', search: { ...search, periodId: String(current.id) }, replace: true });
  },
  component: TransactionsPage,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any);

interface Category { id: number; name: string; icon?: string | null; color?: string | null; }
interface Period { id: number; name: string; startDate: number; endDate: number; coverageStatus: 'complete' | 'partial' | 'skipped' | 'unknown'; coverageReason: string | null; }
interface TransactionSummary {
  dailyActivity?: ActivityDay[];
  categoryBreakdown?: CategoryOverviewItem[];
  expenseCents: number;
  incomeCents: number;
  averageExpenseCents?: number;
  largestExpenseCents?: number;
  topCategoryName?: string | null;
}
type TransactionRow = Awaited<ReturnType<typeof api.transactions.list>>['data'][number];
type ActivityKind = 'expense' | 'income' | 'transfer' | 'loan' | 'other';

function formatDateTime(timestamp: number) {
  return new Date(timestamp).toLocaleString('en-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function formatDateInputEnd(value: string) { return value ? value + 'T23:59:59.999+07:00' : undefined; }
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
function remainingReimbursableExpense(transaction: TransactionRow) {
  return Number((transaction as TransactionRow & { remainingReimbursableExpense?: number }).remainingReimbursableExpense ?? 0);
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
  const isMobile = useMediaQuery('(max-width: 767px)');
  const search = useSearch({ from: '/transactions' }) as { periodId?: string; accountId?: string; categoryId?: string; transactionId?: string; action?: string };
  const navigate = useNavigate({ from: '/transactions' });
  const { confirm } = useConfirm();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const openedDeepLinkId = useRef<string | null>(null);
  const [chartAsOf] = useState(() => Date.now());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [filterQuery, setFilterQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [rowActionsId, setRowActionsId] = useState<number | null>(null);
  const [swipedRowId, setSwipedRowId] = useState<number | null>(null);
  const [mobileInsightsOpen, setMobileInsightsOpen] = useState(false);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(filterQuery), 300);
    return () => window.clearTimeout(timeout);
  }, [filterQuery]);
  const [kindFilter, setKindFilter] = useState<ActivityKind | ''>('');
  const [categoryFilter, setCategoryFilter] = useState(search.categoryId ?? '');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'largest'>('newest');
  const [includeAdjustments, setIncludeAdjustments] = useState(false);
  const { compactTables, activePanel, setCompactTables, setActivePanel } = useUiStore();
  const isToolsOpen = activePanel === 'transactions-tools';
  const isFiltersOpen = activePanel === 'transactions-filters';
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<EditingTransaction | null>(null);
  const [modalInitialMode, setModalInitialMode] = useState<'view' | 'edit'>('edit');
  const [modalPrefill, setModalPrefill] = useState<TransactionPrefill | undefined>();
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isPendingModalOpen, setIsPendingModalOpen] = useState(false);
  const [editingPendingTx, setEditingPendingTx] = useState<PendingTransactionListItem | null>(null);

  const queryClient = useQueryClient();
  const transactionFilters = useMemo<ListTransactionsParams>(() => ({
    ...(search.periodId ? { periodId: search.periodId === 'all' ? 'all' : search.periodId } : {}),
    ...(search.accountId ? { accountId: search.accountId } : {}),
    ...(categoryFilter ? { categoryId: categoryFilter } : {}),
    ...(debouncedQuery.trim() ? { search: debouncedQuery.trim() } : {}),
    ...(kindFilter && kindFilter !== 'other' ? { kind: kindFilter } : {}),
    ...(startDate ? { startDate: startDate + 'T00:00:00+07:00' } : {}),
    ...(endDate ? { endDate: formatDateInputEnd(endDate) } : {}),
    ...(minAmount ? { minAmount } : {}),
    ...(maxAmount ? { maxAmount } : {}),
    ...(includeAdjustments ? { includeReversals: 'true' as const } : {}),
    sort, limit: String(pageSize), offset: String((page - 1) * pageSize),
  }), [search.periodId, search.accountId, categoryFilter, debouncedQuery, kindFilter, startDate, endDate, minAmount, maxAmount, includeAdjustments, sort, page, pageSize]);
  const transactionQuery = useTransactionList(transactionFilters);
  const pendingQuery = usePendingTransactionsQuery();
  const deepLinkTransactionId = search.transactionId && Number.isSafeInteger(Number(search.transactionId))
    ? Number(search.transactionId)
    : null;
  const deepLinkQuery = useTransactionDetailQuery(deepLinkTransactionId);
  const accountsQuery = useAccountsQuery();
  const categoriesQuery = useCategoriesQuery();
  const periodsQuery = usePeriodsQuery();
  const tagsQuery = useTagsQuery();
  const reverseTransactionMutation = useReverseTransaction();
  const deleteTransactionMutation = useDeleteTransaction();
  const transactions = (transactionQuery.data?.data ?? []) as TransactionRow[];
  const actionTransaction = transactions.find((transaction) => transaction.id === rowActionsId) ?? null;
  const accounts = (accountsQuery.data ?? []) as WalletAccount[];
  const categories = (categoriesQuery.data ?? []) as Category[];
  const tags = (tagsQuery.data ?? []) as Array<{ id: number; name: string; color: string }>;
  const periods = (periodsQuery.data ?? []) as unknown as Period[];
  const pendingCount = pendingQuery.data?.length ?? 0;
  const isLoading = transactionQuery.isLoading || accountsQuery.isLoading || categoriesQuery.isLoading || periodsQuery.isLoading || tagsQuery.isLoading;
  const total = transactionQuery.data?.pagination?.total ?? 0;
  const summary = (transactionQuery.data?.summary ?? { expenseCents: 0, incomeCents: 0 }) as TransactionSummary;
  const categoryBreakdown = useMemo(() => (summary.categoryBreakdown ?? []).map((item) => ({
    ...item,
    color: item.color ?? categories.find((category) => category.name === item.name)?.color ?? null,
  })), [summary.categoryBreakdown, categories]);

  const openModal = useCallback((transaction?: TransactionRow, mode: 'view' | 'edit' = 'edit', prefill?: TransactionPrefill) => {
    setModalInitialMode(mode);
    setModalPrefill(prefill);
    setEditingTransaction(transaction ? { id: transaction.id, date: transaction.date, description: transaction.description, reference: transaction.reference ?? undefined, notes: transaction.notes ?? undefined, place: transaction.place ?? undefined, categoryId: transaction.categoryId, txType: transaction.txType, lines: transaction.lines, categoryAllocations: transaction.categoryAllocations, tags: transaction.tags } : null);
    setIsModalOpen(true);
  }, []);

  const repeatTransaction = (transaction: TransactionRow) => {
    const kind = getKind(transaction);
    const source = transaction.lines.find((line) => line.accountType === 'asset' && line.credit > 0);
    const destination = transaction.lines.find((line) => line.accountType === 'asset' && line.debit > 0);
    openModal(undefined, 'edit', {
      type: kind === 'income' ? 'income' : kind === 'transfer' ? 'transfer' : 'expense',
      amount: String(Math.abs(displayAmount(transaction))),
      description: transaction.description,
      categoryId: transaction.categoryId ?? transaction.categoryAllocations[0]?.categoryId,
      fromAccountId: source?.accountId,
      toAccountId: destination?.accountId,
    });
    setRowActionsId(null);
  };

  useKeyboardShortcuts({ isModalOpen: isModalOpen || isImportModalOpen || isPendingModalOpen, searchInputRef, onNewTransaction: () => openModal() });

  useEffect(() => () => setActivePanel(null), [setActivePanel]);

  const loadData = () => invalidateFinancialSummaries(queryClient);
  // Synchronize filters when navigation changes the route search parameters.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setCategoryFilter(search.categoryId ?? ''); }, [search.categoryId]);
  // Reset pagination when the server query scope changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPage(1); }, [search.periodId, search.accountId, categoryFilter, debouncedQuery, kindFilter, startDate, endDate, minAmount, maxAmount, includeAdjustments, sort, pageSize]);
  useEffect(() => {
    if (search.action !== 'new' || isModalOpen) return;
    // Route actions open the existing modal after navigation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    openModal();
    navigate({ search: (previous) => ({ ...previous, action: undefined }) });
  }, [search.action, isModalOpen, navigate, openModal]);
  useEffect(() => {
    if (!search.transactionId || openedDeepLinkId.current === search.transactionId) return;
    if (deepLinkQuery.error) return;
    if (!deepLinkQuery.data) return;
    openedDeepLinkId.current = search.transactionId;
    const transaction = deepLinkQuery.data;
    // Open a deep link once its asynchronously fetched details arrive.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    openModal({ ...transaction, status: 'posted', periodId: null, linkedTxId: null, reversalOfTxId: null, debitCents: 0, creditCents: 0, expenseCents: 0, incomeCents: 0 } as unknown as TransactionRow, 'view');
  }, [search.transactionId, deepLinkQuery.data, deepLinkQuery.error, openModal]);

  const selectedPeriod = periods.find((period) => String(period.id) === search.periodId) ?? null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // Reconcile the current page with the refreshed server result count.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!transactionQuery.isPlaceholderData && page > totalPages) setPage(totalPages); }, [page, totalPages, transactionQuery.isPlaceholderData]);
  const periodLabel = selectedPeriod?.name ?? (search.periodId === 'all' ? 'All periods' : 'Current period');
  // Preserve server pagination: linked fees are separate visible entries.
  const transactionRows = transactions;
  const activeFilters = [
    ...(filterQuery ? [{ label: `Search: ${filterQuery}`, clear: () => { setFilterQuery(''); setDebouncedQuery(''); } }] : []),
    ...(search.accountId ? [{ label: accounts.find((account) => String(account.id) === search.accountId)?.name ?? 'Account', clear: () => navigate({ search: (previous) => ({ ...previous, accountId: undefined }) }) }] : []),
    ...(categoryFilter ? [{ label: categories.find((category) => String(category.id) === categoryFilter)?.name ?? 'Category', clear: () => { setCategoryFilter(''); navigate({ search: (previous) => ({ ...previous, categoryId: undefined }) }); } }] : []),
    ...(startDate ? [{ label: `From ${startDate}`, clear: () => setStartDate('') }] : []),
    ...(endDate ? [{ label: `To ${endDate}`, clear: () => setEndDate('') }] : []),
    ...(minAmount ? [{ label: `Min ${formatCurrency(Number(minAmount))}`, clear: () => setMinAmount('') }] : []),
    ...(maxAmount ? [{ label: `Max ${formatCurrency(Number(maxAmount))}`, clear: () => setMaxAmount('') }] : []),
    ...(includeAdjustments ? [{ label: 'Corrections included', clear: () => setIncludeAdjustments(false) }] : []),
  ];
  const hasFilters = activeFilters.length > 0 || kindFilter !== '' || sort !== 'newest';
  const invalidRange = (startDate && endDate && startDate > endDate) || (minAmount && maxAmount && Number(minAmount) > Number(maxAmount));
  const closeModal = () => { setIsModalOpen(false); setEditingTransaction(null); setEditingPendingTx(null); setModalPrefill(undefined); };
  const handleCorrect = async (transaction: TransactionRow) => {
    if (!await confirm({ title: 'Correct transaction', message: 'This keeps the original for audit history and posts an equal opposite correction. You can then add the replacement transaction.', confirmLabel: 'Correct transaction', variant: 'warning' })) return;
    try { await reverseTransactionMutation.mutateAsync(transaction.id); await loadData(); } catch (error) { alert((error as Error).message); }
  };
  const handleDeleteDraft = async (transaction: TransactionRow) => {
    if (!await confirm({ title: 'Delete draft', message: 'This draft has not affected reports or balances. Delete it?', confirmLabel: 'Delete draft', variant: 'danger' })) return;
    try { await deleteTransactionMutation.mutateAsync(transaction.id); await loadData(); } catch (error) { alert((error as Error).message); }
  };
  const clearFilters = () => {
    setFilterQuery(''); setDebouncedQuery(''); setKindFilter(''); setCategoryFilter(''); setStartDate(''); setEndDate(''); setMinAmount(''); setMaxAmount(''); setSort('newest'); setIncludeAdjustments(false);
    navigate({ search: (previous) => ({ ...previous, accountId: undefined, categoryId: undefined }) });
  };
  const renderFilterFields = () => <>
    <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">Account<select value={search.accountId ?? ''} onChange={(event) => navigate({ search: (previous) => ({ ...previous, accountId: event.target.value || undefined }) })} className="mt-1.5 block min-h-11 w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm"><option value="">All accounts</option>{accounts.map((account) => <option key={account.id} value={String(account.id)}>{account.name}</option>)}</select></label>
    <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">Category<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="mt-1.5 block min-h-11 w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm"><option value="">All categories</option>{categories.map((category) => <option key={category.id} value={String(category.id)}>{category.name}</option>)}</select></label>
    <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">From<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-1.5 block min-h-11 w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm" /></label>
    <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">To<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="mt-1.5 block min-h-11 w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm" /></label>
    <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">Minimum amount<input inputMode="numeric" value={minAmount} onChange={(event) => setMinAmount(event.target.value.replace(/\D/g, ''))} placeholder="Rp 0" className="mt-1.5 block min-h-11 w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm" /></label>
    <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">Maximum amount<input inputMode="numeric" value={maxAmount} onChange={(event) => setMaxAmount(event.target.value.replace(/\D/g, ''))} placeholder="No limit" className="mt-1.5 block min-h-11 w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm" /></label>
    <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={includeAdjustments} onChange={(event) => setIncludeAdjustments(event.target.checked)} className="h-5 w-5" />Include corrections</label>
  </>;

  return <RequireAuth><PageContainer variant="compact">
    <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <PageHeader subtext="Recorded activity" title="Transactions" description={transactionQuery.isError ? 'Activity is currently unavailable.' : isLoading ? 'Loading activity…' : total.toLocaleString() + ' activit' + (total === 1 ? 'y' : 'ies') + ' in ' + periodLabel + '.'} />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" className="rounded-full" onClick={() => navigate({ to: '/reimbursements', search: { sourceTransactionId: undefined, expenseLineId: undefined, categoryId: undefined, amount: undefined } })}><HandCoins className="mr-2 h-4 w-4" />Reimbursements</Button>
        {pendingCount > 0 && <Button variant="secondary" className="rounded-full" onClick={() => setIsPendingModalOpen(true)}><Clock className="mr-2 h-4 w-4" />Review pending ({pendingCount})</Button>}
        <div className="relative"><Button variant="secondary" className="rounded-full px-3" onClick={() => setActivePanel(isToolsOpen ? null : 'transactions-tools')}><MoreHorizontal className="h-4 w-4" /><span className="ml-2">More tools</span></Button>
          {isToolsOpen && <div className="ui-popover absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-2 shadow-xl">
            <button type="button" onClick={() => { downloadPageCsv(transactions, categories); setActivePanel(null); }} disabled={transactions.length === 0} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[var(--ref-surface-container-low)] disabled:opacity-40"><Download className="h-4 w-4" />Export this page</button>
            <button type="button" onClick={() => { setIsImportModalOpen(true); setActivePanel(null); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[var(--ref-surface-container-low)]"><FileUp className="h-4 w-4" />Import CSV</button>
            <button type="button" onClick={() => { setActivePanel(null); navigate({ to: '/agent', search: { prompt: 'Help me split a bill. I will attach the receipt and tell you who shared it.' } }); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[var(--ref-surface-container-low)]"><Receipt className="h-4 w-4" />Split a receipt</button>
            <button type="button" onClick={() => { setIsPendingModalOpen(true); setActivePanel(null); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[var(--ref-surface-container-low)]"><Clock className="h-4 w-4" />Review pending {pendingCount > 0 ? '(' + pendingCount + ')' : ''}</button>
            <button type="button" onClick={() => setCompactTables(!compactTables)} className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[var(--ref-surface-container-low)]"><span>Compact rows</span><span className="text-xs text-[var(--ref-on-surface-variant)]">{compactTables ? 'On' : 'Off'}</span></button>
          </div>}
        </div>
        <Button className="rounded-full" onClick={() => openModal()}><Plus className="mr-2 h-4 w-4" />Add transaction</Button>
      </div>
    </div>

    {selectedPeriod && selectedPeriod.coverageStatus !== 'complete' && <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"><CircleAlert className="mt-0.5 h-5 w-5 shrink-0" /><div><strong>Read this activity carefully.</strong> {coverageMessage(selectedPeriod)} <Link to="/periods" className="ml-1 font-bold underline">Review period</Link></div></div>}
    <section className="mt-4 rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-3 shadow-sm sm:mt-6 sm:p-5">
      <div className="grid grid-cols-2 gap-2 lg:flex lg:items-center lg:gap-3"><div className="relative col-span-2 min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ref-outline)]" /><input ref={searchInputRef} type="search" value={filterQuery} onChange={(event) => setFilterQuery(event.target.value)} aria-label="Search transactions" placeholder="Search activity" className="w-full rounded-full bg-[var(--ref-surface-container-low)] py-2.5 pl-10 pr-4 text-sm outline-none ring-[var(--ref-primary)] focus:ring-2" /></div>
        <select aria-label="Period" value={search.periodId ?? ''} onChange={(event) => navigate({ search: (previous) => ({ ...previous, periodId: event.target.value || undefined }) })} className="rounded-full border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-4 py-2.5 text-sm font-semibold"><option value="all">All periods</option>{periods.map((period) => <option key={period.id} value={String(period.id)}>{period.name}</option>)}</select>
        <Button variant="secondary" className="rounded-full" aria-expanded={isFiltersOpen} aria-controls="transaction-filters" onClick={() => setActivePanel(isFiltersOpen ? null : 'transactions-filters')}><SlidersHorizontal className="mr-2 h-4 w-4" />Filters{activeFilters.length > 0 ? ` (${activeFilters.length})` : ''}</Button>
      </div>
      {isFiltersOpen && <div id="transaction-filters" className="mt-4 hidden gap-3 border-t border-[var(--ref-outline-variant)]/20 pt-4 sm:grid sm:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">Account<select value={search.accountId ?? ''} onChange={(event) => navigate({ search: (previous) => ({ ...previous, accountId: event.target.value || undefined }) })} className="mt-1.5 block w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm"><option value="">All accounts</option>{accounts.map((account) => <option key={account.id} value={String(account.id)}>{account.name}</option>)}</select></label>
        <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">Category<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="mt-1.5 block w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm"><option value="">All categories</option>{categories.map((category) => <option key={category.id} value={String(category.id)}>{category.name}</option>)}</select></label>
        <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">From<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-1.5 block w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm" /></label>
        <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">To<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="mt-1.5 block w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm" /></label>
        <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">Minimum amount<input inputMode="numeric" value={minAmount} onChange={(event) => setMinAmount(event.target.value.replace(/\D/g, ''))} placeholder="Rp 0" className="mt-1.5 block w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm" /></label>
        <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">Maximum amount<input inputMode="numeric" value={maxAmount} onChange={(event) => setMaxAmount(event.target.value.replace(/\D/g, ''))} placeholder="No limit" className="mt-1.5 block w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm" /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeAdjustments} onChange={(event) => setIncludeAdjustments(event.target.checked)} />Include corrections</label><div className="flex items-end"><button type="button" onClick={clearFilters} className="inline-flex items-center gap-1.5 pb-2 text-sm font-bold text-[var(--ref-primary)] hover:underline"><X className="h-4 w-4" />Clear filters</button></div>
      </div>}
      {activeFilters.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Active filters">{activeFilters.map((filter) => <button key={filter.label} type="button" onClick={filter.clear} aria-label={`Remove ${filter.label} filter`} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[var(--ref-surface-container-low)] px-3 py-1.5 text-xs font-semibold"><span className="truncate">{filter.label}</span><X className="h-3 w-3 shrink-0" /></button>)}<button type="button" onClick={clearFilters} className="px-2 py-1 text-xs font-bold text-[var(--ref-primary)]">Clear all</button></div>}
      {invalidRange && <p role="alert" className="mt-3 text-sm text-[var(--ref-error)]">The start of each range must be before or smaller than its end.</p>}
    </section>
    <Modal
      isOpen={isFiltersOpen}
      onClose={() => setActivePanel(null)}
      title="Filter transactions"
      subtitle="Results update as you choose filters."
      overlayClassName="sm:hidden"
      contentClassName="grid gap-4"
      footer={<div className="flex gap-3"><Button type="button" variant="secondary" className="min-h-11 flex-1" onClick={clearFilters}>Reset</Button><Button type="button" className="min-h-11 flex-1" onClick={() => setActivePanel(null)} disabled={Boolean(invalidRange)}>Show results</Button></div>}
    >
      {renderFilterFields()}
      {invalidRange && <p role="alert" className="text-sm text-[var(--ref-error)]">The start of each range must be before or smaller than its end.</p>}
    </Modal>
    <button type="button" onClick={() => setMobileInsightsOpen((open) => !open)} aria-expanded={mobileInsightsOpen} className="mt-3 flex min-h-11 w-full items-center justify-between rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-4 text-sm font-bold md:hidden"><span className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-[var(--ref-primary)]" />Insights</span><span className="text-xs font-medium text-[var(--ref-on-surface-variant)]">{mobileInsightsOpen ? 'Hide' : 'View charts'}</span></button>
    {mobileInsightsOpen && <section aria-label="Activity insights" className="mt-3 space-y-4 rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-4 md:hidden"><div className="grid grid-cols-2 gap-3"><div><p className="text-xs text-[var(--ref-on-surface-variant)]">Spending</p><p className="font-bold tabular-nums">{formatCurrency(summary.expenseCents)}</p></div><div><p className="text-xs text-[var(--ref-on-surface-variant)]">Income</p><p className="font-bold tabular-nums">{formatCurrency(summary.incomeCents)}</p></div></div>{(!kindFilter || kindFilter === 'expense') && <TransactionCategoryOverview items={categoryBreakdown} loading={transactionQuery.isLoading} updating={transactionQuery.isFetching} onSelect={(name) => { const category = categories.find((item) => item.name === name); if (category) { setCategoryFilter(String(category.id)); setPage(1); } }} />}<TransactionActivityChart days={summary.dailyActivity} kind={kindFilter} loading={transactionQuery.isLoading} updating={transactionQuery.isFetching} error={transactionQuery.isError} completeCoverage={selectedPeriod?.coverageStatus === 'complete'} startDate={startDate || undefined} endDate={endDate || undefined} onSelectDate={(date) => { setStartDate(date); setEndDate(date); setPage(1); }} onRetry={() => void transactionQuery.refetch()} /></section>}
    {!isMobile && <section aria-label="Filtered transaction summary" className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-5 py-3">
      <div><p className="text-xs text-[var(--ref-on-surface-variant)]">{kindFilter === 'income' ? 'Income' : kindFilter === 'transfer' || kindFilter === 'loan' ? 'Transactions' : 'Spending'} in this view</p><p className="text-xl font-bold tabular-nums">{isLoading || transactionQuery.isError ? '—' : kindFilter === 'income' ? formatCurrency(summary.incomeCents) : kindFilter === 'transfer' || kindFilter === 'loan' ? total.toLocaleString() : formatCurrency(summary.expenseCents)}</p></div>
      {!kindFilter && <div><p className="text-xs text-[var(--ref-on-surface-variant)]">Income</p><p className="font-bold tabular-nums">{isLoading || transactionQuery.isError ? '—' : formatCurrency(summary.incomeCents)}</p></div>}
      <p className="text-xs text-[var(--ref-on-surface-variant)]">{selectedPeriod && selectedPeriod.coverageStatus !== 'complete' ? 'Recorded activity only; coverage incomplete' : 'Across all matching results'}</p>
    <div className="flex w-full flex-wrap gap-5 sm:ml-auto sm:w-auto sm:flex-nowrap sm:items-center">
    {(!kindFilter || kindFilter === 'expense') && <TransactionCategoryOverview items={categoryBreakdown} loading={transactionQuery.isLoading} updating={transactionQuery.isFetching} onSelect={(name) => { const category = categories.find((item) => item.name === name); if (category) { setCategoryFilter(String(category.id)); setPage(1); } }} />}
    <TransactionActivityChart
      days={summary.dailyActivity}
      kind={kindFilter}
      loading={transactionQuery.isLoading}
      updating={transactionQuery.isFetching}
      error={transactionQuery.isError}
      completeCoverage={selectedPeriod?.coverageStatus === 'complete'}
      startDate={startDate || (selectedPeriod ? new Date(selectedPeriod.startDate + 7 * 60 * 60 * 1000).toISOString().slice(0, 10) : undefined)}
      endDate={endDate || (selectedPeriod ? new Date(Math.min(selectedPeriod.endDate, chartAsOf) + 7 * 60 * 60 * 1000).toISOString().slice(0, 10) : undefined)}
      onSelectDate={(date) => { setStartDate(date); setEndDate(date); setPage(1); }}
      onRetry={() => void transactionQuery.refetch()}
    />
    </div>
    </section>}
    <section className="mt-4 rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <div className="ui-segmented ui-segmented--5 ui-segmented--accent grid w-full max-w-xl grid-cols-5 gap-1 rounded-full bg-[var(--ref-surface-container-low)] p-1" data-segment-index={['', 'expense', 'income', 'transfer', 'loan'].indexOf(kindFilter)} aria-label="Activity type">{([['', 'All'], ['expense', 'Spending'], ['income', 'Income'], ['transfer', 'Transfers'], ['loan', 'Loans']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={kindFilter === value} onClick={() => setKindFilter(value)} className={cn('relative z-[1] min-w-0 rounded-full px-1 py-2 text-xs font-semibold whitespace-nowrap sm:px-3 sm:text-sm', kindFilter === value ? 'text-white' : 'text-[var(--ref-on-surface-variant)] hover:text-[var(--ref-on-surface)]')}>{label}</button>)}</div>
        <div className="flex items-center gap-3"><span role="status" className="text-xs text-[var(--ref-on-surface-variant)]">{transactionQuery.isFetching && !isLoading ? 'Updating…' : ''}</span><select aria-label="Sort transactions" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="rounded-lg bg-[var(--ref-surface-container-low)] px-2 py-2 text-xs"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="largest">Largest amount</option></select></div>
      </div>
      {transactionQuery.isError ? <div role="alert" className="p-10 text-center"><CircleAlert className="mx-auto mb-3 h-8 w-8 text-[var(--ref-error)]" /><p className="font-bold">Could not load transactions</p><p className="mb-4 mt-1 text-sm text-[var(--ref-on-surface-variant)]">Please try again.</p><Button variant="secondary" onClick={() => void transactionQuery.refetch()}>Retry</Button></div> :
      isLoading ? <div className="p-12 text-center text-sm text-[var(--ref-on-surface-variant)]">Loading activity…</div> : total === 0 ? <div className="p-12 text-center"><Wallet className="mx-auto mb-3 h-10 w-10 text-[var(--ref-outline)]" /><p className="font-headline font-bold">No activity in this view</p><p className="mt-1 text-sm text-[var(--ref-on-surface-variant)]">{hasFilters ? 'Try removing filters to see more activity.' : 'Add your first transaction for this period.'}</p><Button variant="secondary" className="mt-4" onClick={hasFilters ? clearFilters : () => openModal()}>{hasFilters ? 'Clear filters' : 'Add transaction'}</Button></div> : <div className="divide-y divide-[var(--ref-outline-variant)]/20">
        {transactionRows.map((transaction, index) => {
          const kind = getKind(transaction); const amount = displayAmount(transaction); const category = categoryLabel(transaction, categories);
          const reimbursementLine = transaction.lines.find((line) => line.accountType === 'expense' && line.debit > line.credit);
          const reimbursable = transaction.status === 'posted' && kind === 'expense' && reimbursementLine != null && remainingReimbursableExpense(transaction) > 0;
          const walletLine = transaction.lines.find((line) => kind === 'income' ? line.debit > 0 : line.credit > 0) ?? transaction.lines[0];
          const transferSource = transaction.lines.find((line) => line.credit > 0 && line.accountType === 'asset');
          const transferDestination = transaction.lines.find((line) => line.debit > 0 && line.accountType === 'asset');
          const accountName = walletLine?.accountName ?? accounts.find((account) => account.id === walletLine?.accountId)?.name;
          const correction = transaction.status === 'reversed' || transaction.txType === 'reversal' || transaction.txType === 'domain_reversal' || transaction.txType === 'historical_recovery_adjustment';
          const dateLabel = new Date(transaction.date).toLocaleDateString('en-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
          const showDate = sort !== 'largest' && (index === 0 || new Date(transactionRows[index - 1]!.date).toDateString() !== new Date(transaction.date).toDateString());
          return <Fragment key={transaction.id}>{showDate && <h2 className="bg-[var(--ref-surface-container-low)] px-5 py-2 text-xs font-semibold text-[var(--ref-on-surface-variant)]">{dateLabel}</h2>}<SwipeReveal
            label={transaction.description}
            open={swipedRowId === transaction.id}
            onOpenChange={(open) => setSwipedRowId(open ? transaction.id : null)}
            onActivate={() => openModal(transaction, 'view')}
            actions={<>
              {reimbursable && <button type="button" onClick={() => { setSwipedRowId(null); navigate({ to: '/reimbursements', search: { sourceTransactionId: String(transaction.id), expenseLineId: String(reimbursementLine.id), categoryId: transaction.categoryAllocations.length === 1 ? String(transaction.categoryAllocations[0]!.categoryId) : undefined, amount: String(remainingReimbursableExpense(transaction)) } }); }} className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 bg-[var(--ref-primary)] px-2 text-[11px] font-bold text-white"><HandCoins className="h-5 w-5" />Reimburse</button>}
              {transaction.status === 'draft'
                ? <button type="button" onClick={() => { setSwipedRowId(null); void handleDeleteDraft(transaction); }} className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 bg-[var(--ref-error)] px-2 text-[11px] font-bold text-white"><Trash2 className="h-5 w-5" />Delete</button>
                : <button type="button" disabled={correction} onClick={() => { setSwipedRowId(null); void handleCorrect(transaction); }} className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 bg-amber-600 px-2 text-[11px] font-bold text-white disabled:opacity-40"><RotateCcw className="h-5 w-5" />Correct</button>}
            </>}
          ><div className={cn('group grid grid-cols-[2.5rem_minmax(0,1fr)_2rem] cursor-pointer items-center gap-x-3 gap-y-1 px-4 sm:flex transition-colors hover:bg-[var(--ref-surface-container-low)] sm:px-6', compactTables ? 'py-2.5' : 'py-4', correction && 'bg-[var(--ref-surface-container-low)]/60')}>
            <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl', kind === 'income' ? 'bg-emerald-500/10 text-emerald-700' : kind === 'transfer' ? 'bg-sky-500/10 text-sky-700' : correction ? 'bg-amber-500/10 text-amber-800' : 'bg-[var(--ref-primary)]/10 text-[var(--ref-primary)]')}>{kind === 'transfer' ? <ArrowLeftRight className="h-5 w-5" /> : kind === 'income' ? <Landmark className="h-5 w-5" /> : <Receipt className="h-5 w-5" />}</div>
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={(event) => { event.stopPropagation(); openModal(transaction, 'view'); }} className="truncate text-left font-headline font-bold text-[var(--ref-on-surface)] focus-visible:outline-2 focus-visible:outline-[var(--ref-primary)]">{transaction.description}</button>{correction && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200">Accounting correction</span>}</div><p className="mt-1 truncate text-xs text-[var(--ref-on-surface-variant)]">{sort === 'largest' ? formatDateTime(transaction.date) : new Date(transaction.date).toLocaleTimeString('en-ID', { hour: '2-digit', minute: '2-digit' })} · {kind === 'transfer' && transferSource && transferDestination ? `${transferSource.accountName ?? accounts.find((account) => account.id === transferSource.accountId)?.name ?? 'Source'} → ${transferDestination.accountName ?? accounts.find((account) => account.id === transferDestination.accountId)?.name ?? 'Destination'}` : accountName ?? 'Account not available'}{transaction.place ? ' · ' + transaction.place : ''}</p><p className="mt-1 text-xs text-[var(--ref-on-surface-variant)] sm:hidden">{category ?? (kind === 'transfer' ? 'Transfer' : kind === 'income' ? 'Income' : 'Unallocated')}</p>{isTransferFee(transaction) && <p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">Linked transfer fee</p>}</div>
            <div className="hidden w-32 shrink-0 text-right sm:block"><p className="truncate text-xs font-semibold text-[var(--ref-on-surface-variant)]" title={category ?? undefined}>{category ?? (kind === 'income' ? 'Income' : kind === 'transfer' ? 'Transfer' : kind === 'loan' ? 'Loan' : 'Unallocated')}</p>{transaction.categoryAllocations.length > 1 && <p className="mt-0.5 text-[10px] text-[var(--ref-outline)]">Split allocation</p>}</div>
            <div className={cn('col-start-2 row-start-2 text-left sm:ml-auto sm:min-w-32 sm:shrink-0 sm:text-right font-headline text-sm font-extrabold tabular-nums', kind === 'income' ? 'text-[var(--color-success)]' : 'text-[var(--ref-on-surface)]')}>{kind === 'income' ? '+' : kind === 'expense' ? '−' : ''}{formatCurrency(Math.abs(amount))}</div>
            <div className="relative col-start-3 row-start-1 shrink-0" onClick={(event) => event.stopPropagation()}>
              <button type="button" aria-label={`Actions for ${transaction.description}`} aria-expanded={rowActionsId === transaction.id} onClick={() => setRowActionsId(transaction.id)} className="grid h-11 w-11 place-items-center rounded-xl hover:bg-[var(--ref-surface-container-low)]"><MoreHorizontal className="h-5 w-5" /></button>
            </div>
          </div></SwipeReveal></Fragment>;
        })}
      </div>}
      {total > 0 && !transactionQuery.isError && <>
        <footer className="hidden flex-col gap-3 border-t border-[var(--ref-outline-variant)]/20 bg-[var(--ref-surface-container-low)]/50 px-5 py-4 sm:flex sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3 text-xs text-[var(--ref-on-surface-variant)]"><span>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString()}</span><select aria-label="Transactions per page" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="rounded-lg border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-2 py-1">{PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size} per page</option>)}</select></div><div className="flex items-center gap-2"><button type="button" aria-label="Previous page" disabled={page <= 1 || transactionQuery.isFetching} onClick={() => setPage((current) => current - 1)} className="rounded-lg p-2 disabled:opacity-30"><ChevronLeft className="h-5 w-5" /></button><span className="text-xs font-bold">{page} / {totalPages}</span><button type="button" aria-label="Next page" disabled={page >= totalPages || transactionQuery.isFetching} onClick={() => setPage((current) => current + 1)} className="rounded-lg p-2 disabled:opacity-30"><ChevronRight className="h-5 w-5" /></button></div></footer>
        <footer className="border-t border-[var(--ref-outline-variant)]/20 p-4 sm:hidden">
          {pageSize < total ? <Button type="button" variant="secondary" className="min-h-12 w-full rounded-full" isLoading={transactionQuery.isFetching} onClick={() => setPageSize((size) => size + 25)}>Load more <span className="ml-1 text-xs opacity-70">({Math.min(pageSize, total)} of {total.toLocaleString()})</span></Button> : <p className="text-center text-xs text-[var(--ref-on-surface-variant)]">All {total.toLocaleString()} transactions loaded</p>}
        </footer>
      </>}
    </section>
    {actionTransaction && (() => {
      const kind = getKind(actionTransaction);
      const reimbursementLine = actionTransaction.lines.find((line) => line.accountType === 'expense' && line.debit > line.credit);
      const reimbursable = actionTransaction.status === 'posted' && kind === 'expense' && reimbursementLine != null && remainingReimbursableExpense(actionTransaction) > 0;
      const correction = actionTransaction.status === 'reversed' || actionTransaction.txType === 'reversal' || actionTransaction.txType === 'domain_reversal' || actionTransaction.txType === 'historical_recovery_adjustment';
      return <Modal isOpen onClose={() => setRowActionsId(null)} title="Transaction actions" subtitle={actionTransaction.description} contentClassName="p-3">
        <div className="space-y-1">
          <button type="button" onClick={() => { setRowActionsId(null); window.setTimeout(() => openModal(actionTransaction, 'view'), 0); }} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-bold hover:bg-[var(--ref-surface-container-low)]"><Receipt className="h-5 w-5 text-[var(--ref-primary)]" />View details</button>
          <button type="button" onClick={() => { setRowActionsId(null); window.setTimeout(() => repeatTransaction(actionTransaction), 0); }} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-bold hover:bg-[var(--ref-surface-container-low)]"><CopyPlus className="h-5 w-5 text-[var(--ref-primary)]" />Repeat transaction</button>
          {reimbursable && <button type="button" onClick={() => { setRowActionsId(null); navigate({ to: '/reimbursements', search: { sourceTransactionId: String(actionTransaction.id), expenseLineId: String(reimbursementLine.id), categoryId: actionTransaction.categoryAllocations.length === 1 ? String(actionTransaction.categoryAllocations[0]!.categoryId) : undefined, amount: String(remainingReimbursableExpense(actionTransaction)) } }); }} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-bold text-[var(--ref-primary)] hover:bg-[var(--ref-primary)]/10"><HandCoins className="h-5 w-5" />Mark reimbursable</button>}
          {actionTransaction.status === 'draft'
            ? <button type="button" onClick={() => { setRowActionsId(null); void handleDeleteDraft(actionTransaction); }} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-bold text-[var(--ref-error)] hover:bg-[var(--ref-error)]/10"><Trash2 className="h-5 w-5" />Delete draft</button>
            : <button type="button" disabled={correction} onClick={() => { setRowActionsId(null); void handleCorrect(actionTransaction); }} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-bold text-amber-700 hover:bg-amber-500/10 disabled:opacity-40"><RotateCcw className="h-5 w-5" />{correction ? 'Correction cannot be reversed' : 'Correct transaction'}</button>}
        </div>
      </Modal>;
    })()}
    <TransactionModal isOpen={isModalOpen} onClose={closeModal} onSaved={loadData} onSuccess={() => { void loadData(); setEditingPendingTx(null); }} accounts={accounts} categories={categories} tags={tags} editingTransaction={editingTransaction} periodId={search.periodId && search.periodId !== 'all' ? Number(search.periodId) : null} initialMode={modalInitialMode} pendingTransaction={editingPendingTx} initialPrefill={modalPrefill} />
    <ImportCSVModal isOpen={isImportModalOpen} onClose={() => setIsImportModalOpen(false)} onSuccess={loadData} />
    <PendingTransactionsModal isOpen={isPendingModalOpen} onClose={() => setIsPendingModalOpen(false)} onEdit={(pending) => { setEditingPendingTx(pending); setIsPendingModalOpen(false); openModal(); }} onRefresh={() => { void pendingQuery.refetch(); }} />
  </PageContainer></RequireAuth>;
}
