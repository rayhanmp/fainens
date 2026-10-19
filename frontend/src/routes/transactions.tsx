import { useBalanceVisibility } from '../hooks/useBalanceVisibility';
import { ReallocationModal } from "../components/transactions/ReallocationModal";
import { personalActivityKind, reallocationCashAmount } from "../features/transactions/reallocation";
import { Link, createFileRoute, redirect, useNavigate, useSearch } from '@tanstack/react-router';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, ArrowUpDown, Ban, Loader2, BarChart3, CalendarClock, ChevronLeft, ChevronRight, CircleAlert, Clock, CopyPlus, Download, FileUp, History, HandCoins, Landmark, Mail, MoreHorizontal, ArrowRightLeft, Plus, Receipt, RotateCcw, Search, SlidersHorizontal, Trash2, Wallet, X } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { SwipeReveal } from '../components/ui/SwipeReveal';
import { MenuSelect } from '../components/ui/MenuSelect';
import { PeriodPicker } from '../components/ui/PeriodPicker';
import { PageContainer } from '../components/ui/PageContainer';
import { PageHeader } from '../components/ui/PageHeader';
import { TransactionActivityChart, type ActivityDay } from '../components/transactions/TransactionActivityChart';
import { TransactionCategoryOverview, type CategoryOverviewItem } from '../components/transactions/TransactionCategoryOverview';
import { TransactionModal, type EditingTransaction, type TransactionPrefill, type WalletAccount } from '../components/transactions/TransactionModal';
import { ImportCSVModal } from '../components/transactions/ImportCSVModal';
import { PendingTransactionsModal } from '../components/transactions/PendingTransactionsModal';
import { useConfirm } from '../components/ui/ConfirmDialog';
import { CategoryIcon } from '../features/categories/CategoryIcon';
import { toast, errorMessage } from '../components/ui/useToast';
import { RequireAuth } from '../lib/auth';
import { api } from '../lib/api';
import type { ListTransactionsParams } from '../generated/client';
import { cn, formatDateTime, formatIdNominalInput, formatTime, formatWeekdayDate } from '../lib/utils';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { usePhoneSheets } from '../hooks/usePhoneSheets';
import { subscriptionRenewalOf, useAlignReversal, useDeleteTransaction, usePendingTransactionsQuery, useReverseTransaction, useTransactionDetailQuery, useTransactionList, useVoidSubscriptionRenewal, type PendingTransactionListItem } from '../features/transactions/queries';
import { useAccountsQuery } from '../features/accounts/queries';
import { useCategoriesQuery, useTagsQuery } from '../features/categories/queries';
import { fetchPeriods, usePeriodsQuery } from '../features/periods/queries';
import { invalidateFinancialSummaries } from '../features/core/query-keys';
import { useUiStore } from '../stores/ui-store';
import { transactionActivityAmount, compactLoanActivityLabel, splitBillActivityRows, type LoanActivity, type SplitBillDisplayPart } from '../features/transactions/loan-activity';

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'largest', label: 'Largest amount' },
] as const;

/** Placeholder rows shaped like the real list, so the page does not jump when activity arrives. */
function TransactionRowsSkeleton({ compact }: { compact: boolean }) {
  const widths = ['w-2/5', 'w-1/2', 'w-1/3', 'w-3/5', 'w-2/5', 'w-1/2'];
  return <div role="status" aria-label="Loading activity" className="divide-y divide-[var(--ref-outline-variant)]/20">
    <div className="h-8 animate-pulse bg-[var(--ref-surface-container-low)]" />
    {widths.map((width, index) => <div key={index} className={cn('flex items-center gap-3 px-4 sm:px-6', compact ? 'py-2.5' : 'py-4')}>
      <div className="h-10 w-10 shrink-0 animate-pulse rounded-2xl bg-[var(--ref-surface-container-low)]" />
      <div className="min-w-0 flex-1 space-y-2"><div className={cn('h-3.5 animate-pulse rounded-full bg-[var(--ref-surface-container-low)]', width)} /><div className="h-2.5 w-1/4 animate-pulse rounded-full bg-[var(--ref-surface-container-low)]" /></div>
      <div className="hidden h-3 w-20 animate-pulse rounded-full bg-[var(--ref-surface-container-low)] sm:block" />
      <div className="h-3.5 w-24 animate-pulse rounded-full bg-[var(--ref-surface-container-low)]" />
    </div>)}
  </div>;
}

export const Route = createFileRoute('/transactions')({
  validateSearch: (search: Record<string, unknown>): { periodId?: string; accountId?: string; categoryId?: string; transactionId?: string; tagId?: string; action?: string } => ({
    periodId: typeof search.periodId === 'string' ? search.periodId : undefined,
    accountId: typeof search.accountId === 'string' ? search.accountId : undefined,
    categoryId: typeof search.categoryId === 'string' ? search.categoryId : undefined,
    transactionId: typeof search.transactionId === 'string' ? search.transactionId : undefined,
    tagId: typeof search.tagId === 'string' && /^\d+$/.test(search.tagId) ? search.tagId : undefined,
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
});

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
type TransactionRow = Awaited<ReturnType<typeof api.transactions.list>>['data'][number] & { loanActivity?: LoanActivity | null; displayPart?: SplitBillDisplayPart };
type ActivityKind = 'expense' | 'income' | 'transfer' | 'loan' | 'other';

function formatGmailSyncTime(value: number | string | null | undefined) {
  if (value == null) return 'Never';
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? formatDateTime(time) : 'Unknown';
}
function formatDateInputEnd(value: string) { return value ? value + 'T23:59:59.999+07:00' : undefined; }
function getKind(transaction: TransactionRow): ActivityKind {
  if (transaction.displayPart) return transaction.displayPart;
  if (transaction.txType.includes('loan') || transaction.txType === 'split_bill_lent' || transaction.txType === 'split_bill_borrowed') return 'loan';
  if (transaction.txType === 'simple_transfer' || transaction.txType === 'transfer') return 'transfer';
  return personalActivityKind(transaction);
}
function displayAmount(transaction: TransactionRow) {
  return reallocationCashAmount(transaction) ?? transactionActivityAmount(transaction);
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
/** The category a row is drawn with: its first allocation, or its single category. */
function primaryCategory(transaction: TransactionRow, categories: Category[]) {
  const allocation = transaction.categoryAllocations.find((item) => item.amount !== 0);
  const id = allocation?.categoryId ?? transaction.categoryId;
  return id == null ? null : categories.find((category) => category.id === id) ?? null;
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
  const { formatAmount, maskAmounts } = useBalanceVisibility();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const search = useSearch({ from: '/transactions' }) as { periodId?: string; accountId?: string; categoryId?: string; tagId?: string; transactionId?: string; action?: string };
  const navigate = useNavigate({ from: '/transactions' });
  const { confirm } = useConfirm();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const openedDeepLinkId = useRef<string | null>(null);
  const [chartAsOf] = useState(() => Date.now());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [filterQuery, setFilterQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [reallocationTransaction, setReallocationTransaction] = useState<TransactionRow | null>(null);
  // Keyed by row, not transaction: a split bill shows one transaction as two rows.
  const [rowActionsKey, setRowActionsKey] = useState<string | null>(null);
  const rowActionsId = rowActionsKey ? Number(rowActionsKey.split(':')[0]) : null;
  const [swipedRowId, setSwipedRowId] = useState<string | null>(null);
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
  const [isGmailModalOpen, setIsGmailModalOpen] = useState(false);
  const [gmailSyncing, setGmailSyncing] = useState(false);
  const [gmailDisconnecting, setGmailDisconnecting] = useState(false);

  const queryClient = useQueryClient();
  const transactionFilters = useMemo<ListTransactionsParams>(() => ({
    ...(search.periodId ? { periodId: search.periodId === 'all' ? 'all' : search.periodId } : {}),
    ...(search.accountId ? { accountId: search.accountId } : {}),
    ...(search.tagId ? { tagId: search.tagId } : {}),
    ...(categoryFilter ? { categoryId: categoryFilter } : {}),
    ...(debouncedQuery.trim() ? { search: debouncedQuery.trim() } : {}),
    ...(kindFilter && kindFilter !== 'other' ? { kind: kindFilter } : {}),
    ...(startDate ? { startDate: startDate + 'T00:00:00+07:00' } : {}),
    ...(endDate ? { endDate: formatDateInputEnd(endDate) } : {}),
    ...(minAmount ? { minAmount } : {}),
    ...(maxAmount ? { maxAmount } : {}),
    ...(includeAdjustments ? { includeReversals: 'true' as const } : {}),
    sort, limit: String(pageSize), offset: String((page - 1) * pageSize),
  }), [search.periodId, search.accountId, search.tagId, categoryFilter, debouncedQuery, kindFilter, startDate, endDate, minAmount, maxAmount, includeAdjustments, sort, page, pageSize]);
  const transactionQuery = useTransactionList(transactionFilters);
  const pendingQuery = usePendingTransactionsQuery();
  const gmailStatusQuery = useQuery({ queryKey: ['integrations', 'gmail'], queryFn: api.gmail.status, staleTime: 5 * 60 * 1000 });
  const deepLinkTransactionId = search.transactionId && Number.isSafeInteger(Number(search.transactionId))
    ? Number(search.transactionId)
    : null;
  const deepLinkQuery = useTransactionDetailQuery(deepLinkTransactionId);
  const accountsQuery = useAccountsQuery();
  const categoriesQuery = useCategoriesQuery();
  const periodsQuery = usePeriodsQuery();
  const tagsQuery = useTagsQuery();
  const reverseTransactionMutation = useReverseTransaction();
  const alignReversalMutation = useAlignReversal();
  const voidRenewalMutation = useVoidSubscriptionRenewal();
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
    setEditingTransaction(transaction ? { id: transaction.id, date: transaction.date, description: transaction.description, reference: transaction.reference ?? undefined, notes: transaction.notes ?? undefined, place: transaction.place ?? undefined, categoryId: transaction.categoryId, txType: transaction.txType, status: transaction.status, batchId: transaction.batchId ?? null, displayPart: transaction.displayPart, expenseCents: transaction.expenseCents, incomeCents: transaction.incomeCents, reallocation: transaction.reallocation, lines: transaction.lines, categoryAllocations: transaction.categoryAllocations, tags: transaction.tags } : null);
    setIsModalOpen(true);
  }, []);

  const repeatTransaction = (transaction: TransactionRow) => {
    const kind = getKind(transaction);
    if (kind === 'loan') return;
    const source = transaction.lines.find((line) => line.accountType === 'asset' && line.credit > 0);
    const destination = transaction.lines.find((line) => line.accountType === 'asset' && line.debit > 0);
    openModal(undefined, 'edit', {
      type: kind === 'income' ? 'income' : kind === 'transfer' ? 'transfer' : 'expense',
      amount: formatIdNominalInput(String(Math.abs(displayAmount(transaction)))),
      description: transaction.description,
      categoryId: transaction.categoryId ?? transaction.categoryAllocations[0]?.categoryId,
      fromAccountId: source?.accountId,
      toAccountId: destination?.accountId,
    });
    setRowActionsKey(null);
  };

  useKeyboardShortcuts({ isModalOpen: isModalOpen || isImportModalOpen || isPendingModalOpen, searchInputRef, onNewTransaction: () => openModal() });

  useEffect(() => () => setActivePanel(null), [setActivePanel]);

  const toolsRef = useRef<HTMLDivElement>(null);
  // Phones get the tools as a bottom sheet (the sheet handles its own closing); wider screens a popover.
  const toolsAsSheet = usePhoneSheets();
  const toolsSurface = (items: ReactNode) => toolsAsSheet
    ? <Modal isOpen onClose={() => setActivePanel(null)} title="More tools" contentClassName="p-3 [&_button]:min-h-12"><div role="menu" className="space-y-0.5">{items}</div></Modal>
    : <div role="menu" className="ui-popover absolute right-0 z-20 mt-2 w-60 overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-2 shadow-xl">{items}</div>;
  // The tools menu closes on an outside press or Escape, like every other popover.
  useEffect(() => {
    if (!isToolsOpen || toolsAsSheet) return undefined;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !toolsRef.current?.contains(event.target)) setActivePanel(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setActivePanel(null);
      toolsRef.current?.querySelector('button')?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isToolsOpen, toolsAsSheet, setActivePanel]);
  const clearSearch = () => { setFilterQuery(''); setDebouncedQuery(''); };
  // Typing ahead of the debounce, or waiting on the server for a new search, both read as "searching".
  const isSearching = filterQuery.trim() !== debouncedQuery.trim() || (debouncedQuery.trim() !== '' && transactionQuery.isFetching);
  const openReimbursements = () => navigate({ to: '/reimbursements', search: { sourceTransactionId: undefined, expenseLineId: undefined, categoryId: undefined, amount: undefined } });
  const gmailLabel = gmailStatusQuery.data?.connected ? 'Gmail sync' : 'Connect Gmail';

  // The desktop row menu closes on an outside press or Escape, returning focus to its trigger.
  useEffect(() => {
    if (!rowActionsKey || isMobile) return undefined;
    const anchor = () => document.querySelector<HTMLElement>(`[data-row-actions="${CSS.escape(rowActionsKey)}"]`);
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !anchor()?.contains(event.target)) setRowActionsKey(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      anchor()?.querySelector('button')?.focus();
      setRowActionsKey(null);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [rowActionsKey, isMobile]);

  /** One action list for the phone sheet and the desktop menu. */
  const renderRowActions = (transaction: TransactionRow, surface: 'sheet' | 'menu') => {
    const kind = getKind(transaction);
    const reimbursementLine = transaction.lines.find((line) => line.accountType === 'expense' && line.debit > line.credit);
    const reimbursable = transaction.status === 'posted' && kind === 'expense' && reimbursementLine != null && remainingReimbursableExpense(transaction) > 0;
    const correction = transaction.reallocation != null || transaction.status === 'reversed' || transaction.txType === 'reversal' || transaction.txType === 'domain_reversal' || transaction.txType === 'historical_recovery_adjustment' || transaction.txType === 'balance_adjustment';
    const item = cn('flex w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-bold disabled:opacity-40', surface === 'sheet' ? 'min-h-12' : 'min-h-10');
    const icon = surface === 'sheet' ? 'h-5 w-5' : 'h-4 w-4';
    const role = surface === 'menu' ? 'menuitem' : undefined;
    const renewal = subscriptionRenewalOf(transaction);
    const lateReversal = transaction.txType === 'reversal' && transaction.status === 'posted' && transaction.reversalOfTxId != null;
    // Let the menu close before opening the next layer, so focus restoration does not fight it.
    const then = (action: () => void) => { setRowActionsKey(null); window.setTimeout(action, 0); };
    return <div className="space-y-0.5">
      <button type="button" role={role} onClick={() => then(() => openModal(transaction, 'view'))} className={cn(item, 'hover:bg-[var(--ref-surface-container-low)]')}><Receipt className={cn(icon, 'text-[var(--ref-primary)]')} />View details</button>
      {transaction.reallocationEligibleRole && !transaction.reallocation && <button type="button" role={role} onClick={() => then(() => setReallocationTransaction(transaction))} className={cn(item, 'text-[var(--ref-primary)] hover:bg-[var(--ref-primary)]/10')}><ArrowRightLeft className={icon} />Link as reallocation</button>}
      {kind !== 'loan' && <button type="button" role={role} onClick={() => then(() => repeatTransaction(transaction))} className={cn(item, 'hover:bg-[var(--ref-surface-container-low)]')}><CopyPlus className={cn(icon, 'text-[var(--ref-primary)]')} />Repeat transaction</button>}
      {reimbursable && <button type="button" role={role} onClick={() => { setRowActionsKey(null); navigate({ to: '/reimbursements', search: { sourceTransactionId: String(transaction.id), expenseLineId: String(reimbursementLine.id), categoryId: transaction.categoryAllocations.length === 1 ? String(transaction.categoryAllocations[0]!.categoryId) : undefined, amount: String(remainingReimbursableExpense(transaction)) } }); }} className={cn(item, 'text-[var(--ref-primary)] hover:bg-[var(--ref-primary)]/10')}><HandCoins className={icon} />Mark reimbursable</button>}
      {surface === 'menu' && <div className="my-1 h-px bg-[var(--color-border)]" role="separator" />}
      {renewal && <button type="button" role={role} onClick={() => then(() => void handleVoidRenewal(transaction, renewal))} className={cn(item, 'text-amber-700 hover:bg-amber-500/10 dark:text-amber-300')}><Ban className={icon} />Void renewal (never charged)</button>}
      {lateReversal && <button type="button" role={role} onClick={() => then(() => void handleAlignReversal(transaction))} className={cn(item, 'text-amber-700 hover:bg-amber-500/10 dark:text-amber-300')}><CalendarClock className={icon} />Move to the original's date</button>}
      {transaction.status === 'draft'
        ? <button type="button" role={role} onClick={() => then(() => void handleDeleteDraft(transaction))} className={cn(item, 'text-[var(--ref-error)] hover:bg-[var(--ref-error)]/10')}><Trash2 className={icon} />Delete draft</button>
        : <button type="button" role={role} disabled={correction} onClick={() => then(() => void handleCorrect(transaction))} className={cn(item, 'text-amber-700 hover:bg-amber-500/10 dark:text-amber-300')}><RotateCcw className={icon} />{transaction.reallocation ? 'Unlink before correcting' : correction ? 'Correction cannot be reversed' : 'Correct transaction'}</button>}
    </div>;
  };

  const loadData = () => invalidateFinancialSummaries(queryClient);
  const handleGmailSync = async () => {
    setGmailSyncing(true);
    try {
      const result = await api.gmail.sync(30);
      await pendingQuery.refetch();
      await gmailStatusQuery.refetch();
      const skipped = result.skipped > 0 ? ` ${result.skipped} already processed ${result.skipped === 1 ? 'email was' : 'emails were'} skipped.` : '';
      if (result.imported > 0) {
        setIsGmailModalOpen(false);
        toast.show({
          type: 'success',
          title: `${result.imported} BNI ${result.imported === 1 ? 'email' : 'emails'} imported`,
          message: `Ready for review before posting.${skipped}`,
          duration: 8000,
          action: { label: 'Review now', onClick: () => setIsPendingModalOpen(true) },
        });
      } else {
        toast.info('No new BNI emails', skipped.trim() || 'Everything from the last 30 days is already in Fainens.');
      }
    } catch (error) {
      toast.error('Gmail sync failed', errorMessage(error, 'Could not read Gmail.'));
    } finally {
      setGmailSyncing(false);
    }
  };
  const handleGmailDisconnect = async () => {
    if (!await confirm({
      title: 'Disconnect Gmail?',
      message: 'Fainens will stop reading this Gmail account. Existing pending and posted transactions will not be deleted.',
      confirmLabel: 'Disconnect Gmail',
      variant: 'danger',
    })) return;
    setGmailDisconnecting(true);
    try {
      await api.gmail.disconnect();
      await gmailStatusQuery.refetch();
      setIsGmailModalOpen(false);
      toast.success('Gmail disconnected', 'Existing transactions were kept.');
    } catch (error) {
      toast.error('Could not disconnect Gmail', errorMessage(error));
    } finally {
      setGmailDisconnecting(false);
    }
  };
  // Synchronize filters when navigation changes the route search parameters.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setCategoryFilter(search.categoryId ?? ''); }, [search.categoryId]);
  // Reset pagination when the server query scope changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPage(1); }, [search.periodId, search.accountId, search.tagId, categoryFilter, debouncedQuery, kindFilter, startDate, endDate, minAmount, maxAmount, includeAdjustments, sort, pageSize]);
  useEffect(() => {
    if ((search.action !== 'new' && search.action !== 'new-income') || isModalOpen) return;
    // Route actions open the existing modal after navigation; "new-income" lands on the Income tab.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    openModal(undefined, 'edit', search.action === 'new-income' ? { type: 'income' } : undefined);
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
    openModal({ ...transaction, debitCents: transaction.debitCents ?? 0, creditCents: transaction.creditCents ?? 0, expenseCents: transaction.expenseCents ?? 0, incomeCents: transaction.incomeCents ?? 0 } as unknown as TransactionRow, 'view');
  }, [search.transactionId, deepLinkQuery.data, deepLinkQuery.error, openModal]);

  const selectedPeriod = periods.find((period) => String(period.id) === search.periodId) ?? null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // Reconcile the current page with the refreshed server result count.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!transactionQuery.isPlaceholderData && page > totalPages) setPage(totalPages); }, [page, totalPages, transactionQuery.isPlaceholderData]);
  const periodLabel = selectedPeriod?.name ?? (search.periodId === 'all' ? 'All periods' : 'Current period');
  // Preserve server pagination: linked fees are separate visible entries.
  const transactionRows = splitBillActivityRows(transactions, kindFilter);
  const activeFilters = [
    ...(search.tagId ? [{ label: tags.find((tag) => String(tag.id) === search.tagId)?.name ?? 'Tag', clear: () => navigate({ search: (previous) => ({ ...previous, tagId: undefined }) }) }] : []),
    ...(filterQuery ? [{ label: `Search: ${filterQuery}`, clear: () => { setFilterQuery(''); setDebouncedQuery(''); } }] : []),
    ...(search.accountId ? [{ label: accounts.find((account) => String(account.id) === search.accountId)?.name ?? 'Account', clear: () => navigate({ search: (previous) => ({ ...previous, accountId: undefined }) }) }] : []),
    ...(categoryFilter ? [{ label: categories.find((category) => String(category.id) === categoryFilter)?.name ?? 'Category', clear: () => { setCategoryFilter(''); navigate({ search: (previous) => ({ ...previous, categoryId: undefined }) }); } }] : []),
    ...(startDate ? [{ label: `From ${startDate}`, clear: () => setStartDate('') }] : []),
    ...(endDate ? [{ label: `To ${endDate}`, clear: () => setEndDate('') }] : []),
    ...(minAmount ? [{ label: `Min ${formatAmount(Number(minAmount))}`, clear: () => setMinAmount('') }] : []),
    ...(maxAmount ? [{ label: `Max ${formatAmount(Number(maxAmount))}`, clear: () => setMaxAmount('') }] : []),
    ...(includeAdjustments ? [{ label: 'Corrections included', clear: () => setIncludeAdjustments(false) }] : []),
  ];
  const hasFilters = activeFilters.length > 0 || kindFilter !== '' || sort !== 'newest';
  const invalidRange = (startDate && endDate && startDate > endDate) || (minAmount && maxAmount && Number(minAmount) > Number(maxAmount));
  const closeModal = () => { setIsModalOpen(false); setEditingTransaction(null); setEditingPendingTx(null); setModalPrefill(undefined); };
  const handleCorrect = async (transaction: TransactionRow) => {
    if (!await confirm({ title: 'Correct transaction', message: 'This keeps the original for audit history and posts an equal opposite correction. You can then add the replacement transaction.', confirmLabel: 'Correct transaction', variant: 'warning' })) return;
    try {
      await reverseTransactionMutation.mutateAsync(transaction.id);
      await loadData();
      toast.show({
        type: 'success',
        title: 'Correction posted',
        message: 'Add the replacement transaction now?',
        duration: 8000,
        action: { label: 'Add replacement', onClick: () => repeatTransaction(transaction) },
      });
    } catch (error) { toast.error('Could not correct transaction', errorMessage(error)); }
  };
  const handleVoidRenewal = async (transaction: TransactionRow, renewal: { subscriptionId: number; dueAt: number }) => {
    if (!await confirm({ title: 'Void renewal', message: `Use this when "${transaction.description}" was never actually charged. It is reversed on its own date and the subscription won't post this renewal again.`, confirmLabel: 'Void renewal', variant: 'warning' })) return;
    try {
      await voidRenewalMutation.mutateAsync({ ...renewal, reason: 'Never charged: no matching payment on any statement' });
      await loadData();
      toast.success('Renewal voided');
    } catch (error) { toast.error('Could not void the renewal', errorMessage(error)); }
  };
  const handleAlignReversal = async (transaction: TransactionRow) => {
    if (!await confirm({ title: "Move to the original's date", message: 'The reversal moves onto the date of the entry it reverses, so the months in between no longer count the mistake. Both periods must be open.', confirmLabel: 'Move reversal', variant: 'warning' })) return;
    try {
      await alignReversalMutation.mutateAsync(transaction.id);
      await loadData();
      toast.success("Reversal moved to the original's date");
    } catch (error) { toast.error('Could not move the reversal', errorMessage(error)); }
  };
  const handleDeleteDraft = async (transaction: TransactionRow) => {
    if (!await confirm({ title: 'Delete draft', message: 'This draft has not affected reports or balances. Delete it?', confirmLabel: 'Delete draft', variant: 'danger' })) return;
    try { await deleteTransactionMutation.mutateAsync(transaction.id); await loadData(); toast.success('Draft deleted'); } catch (error) { toast.error('Could not delete draft', errorMessage(error)); }
  };
  const clearFilters = () => {
    setFilterQuery(''); setDebouncedQuery(''); setKindFilter(''); setCategoryFilter(''); setStartDate(''); setEndDate(''); setMinAmount(''); setMaxAmount(''); setSort('newest'); setIncludeAdjustments(false);
    navigate({ search: (previous) => ({ ...previous, accountId: undefined, categoryId: undefined, tagId: undefined }) });
  };
  const renderFilterFields = () => <>
    <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">Tag / split bill<select value={search.tagId ?? ''} onChange={(event) => navigate({ search: (previous) => ({ ...previous, tagId: event.target.value || undefined }) })} className="mt-1.5 block min-h-11 w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm"><option value="">All tags</option>{tags.map((tag) => <option key={tag.id} value={String(tag.id)}>{tag.name}</option>)}</select></label>
    <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">Account<select value={search.accountId ?? ''} onChange={(event) => navigate({ search: (previous) => ({ ...previous, accountId: event.target.value || undefined }) })} className="mt-1.5 block min-h-11 w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm"><option value="">All accounts</option>{accounts.map((account) => <option key={account.id} value={String(account.id)}>{account.name}</option>)}</select></label>
    <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">Category<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="mt-1.5 block min-h-11 w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm"><option value="">All categories</option>{categories.map((category) => <option key={category.id} value={String(category.id)}>{category.name}</option>)}</select></label>
    <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">From<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-1.5 block min-h-11 w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm" /></label>
    <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">To<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="mt-1.5 block min-h-11 w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm" /></label>
    <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">Minimum amount<input inputMode="numeric" value={minAmount} onChange={(event) => setMinAmount(event.target.value.replace(/\D/g, ''))} placeholder="Rp0" className="mt-1.5 block min-h-11 w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm" /></label>
    <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">Maximum amount<input inputMode="numeric" value={maxAmount} onChange={(event) => setMaxAmount(event.target.value.replace(/\D/g, ''))} placeholder="No limit" className="mt-1.5 block min-h-11 w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm" /></label>
    <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={includeAdjustments} onChange={(event) => setIncludeAdjustments(event.target.checked)} className="h-5 w-5" />Include corrections</label>
  </>;

  return <RequireAuth><PageContainer variant="compact">
    {/* Phones get the title and one overflow button; the dock already has Add. */}
    <div className="flex items-start justify-between gap-4 md:flex-col md:items-stretch lg:flex-row lg:items-end">
      <PageHeader className="min-w-0" subtext="Recorded activity" title="Transactions" description={transactionQuery.isError ? 'Activity is currently unavailable.' : isLoading ? 'Loading activity…' : total.toLocaleString() + ' activit' + (total === 1 ? 'y' : 'ies') + ' in ' + periodLabel + '.'} />
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button variant="secondary" className="hidden rounded-full md:inline-flex" onClick={openReimbursements}><HandCoins className="mr-2 h-4 w-4" />Reimbursements</Button>
        <Button variant="secondary" className="hidden rounded-full md:inline-flex" onClick={() => setIsGmailModalOpen(true)} disabled={gmailStatusQuery.isLoading}><Mail className="mr-2 h-4 w-4" />{gmailLabel}</Button>
        {pendingCount > 0 && <Button variant="secondary" className="hidden rounded-full md:inline-flex" onClick={() => setIsPendingModalOpen(true)}><Clock className="mr-2 h-4 w-4" />Review pending ({pendingCount})</Button>}
        <div ref={toolsRef} className="relative"><Button variant="secondary" className="relative h-11 w-11 rounded-full p-0 md:h-auto md:w-auto md:px-3 md:py-2" aria-label="More tools" aria-haspopup="menu" aria-expanded={isToolsOpen} onClick={() => setActivePanel(isToolsOpen ? null : 'transactions-tools')}><MoreHorizontal className="mx-auto h-4 w-4" /><span className="ml-2 hidden md:inline">More tools</span>{pendingCount > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-[var(--ref-surface-container-lowest)] md:hidden" aria-hidden />}</Button>
          {isToolsOpen && toolsSurface(<>
            <button type="button" onClick={() => { setActivePanel(null); openReimbursements(); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[var(--ref-surface-container-low)] md:hidden"><HandCoins className="h-4 w-4" />Reimbursements</button>
            <button type="button" onClick={() => { setActivePanel(null); setIsGmailModalOpen(true); }} disabled={gmailStatusQuery.isLoading} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[var(--ref-surface-container-low)] disabled:opacity-40 md:hidden"><Mail className="h-4 w-4" />{gmailLabel}</button>
            <button type="button" onClick={() => { downloadPageCsv(transactions, categories); setActivePanel(null); }} disabled={transactions.length === 0} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[var(--ref-surface-container-low)] disabled:opacity-40"><Download className="h-4 w-4" />Export this page</button>
            <button type="button" onClick={() => { setIsImportModalOpen(true); setActivePanel(null); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[var(--ref-surface-container-low)]"><FileUp className="h-4 w-4" />Import CSV</button>
            <button type="button" onClick={() => { setActivePanel(null); navigate({ to: '/backfill' }); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[var(--ref-surface-container-low)]"><History className="h-4 w-4" />Backfill history</button>
            <button type="button" onClick={() => { setActivePanel(null); navigate({ to: '/agent', search: { prompt: 'Help me split a bill. I will attach the receipt and tell you who shared it.' } }); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[var(--ref-surface-container-low)]"><Receipt className="h-4 w-4" />Split a receipt</button>
            <button type="button" onClick={() => { setIsPendingModalOpen(true); setActivePanel(null); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[var(--ref-surface-container-low)]"><Clock className="h-4 w-4" />Review pending {pendingCount > 0 ? '(' + pendingCount + ')' : ''}</button>
            <button type="button" onClick={() => setCompactTables(!compactTables)} className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[var(--ref-surface-container-low)]"><span>Compact rows</span><span className="text-xs text-[var(--ref-on-surface-variant)]">{compactTables ? 'On' : 'Off'}</span></button>
          </>)}
        </div>
        <Button className="hidden rounded-full md:inline-flex" onClick={() => openModal()}><Plus className="mr-2 h-4 w-4" />Add transaction</Button>
      </div>
    </div>


    <Modal
      isOpen={isGmailModalOpen}
      onClose={() => { if (!gmailSyncing && !gmailDisconnecting) setIsGmailModalOpen(false); }}
      title="Gmail sync"
      subtitle="Import BNI transaction emails into pending review."
    >
      {gmailStatusQuery.isLoading ? (
        <div className="py-8 text-center text-sm text-[var(--color-text-secondary)]">Loading Gmail connection…</div>
      ) : gmailStatusQuery.data?.connected ? (
        <div className="space-y-5">
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] p-4">
            <div className="flex items-start gap-3">
              <Mail className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ref-primary)]" />
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-secondary)]">Connected account</p>
                <p className="mt-1 truncate text-sm font-semibold">{gmailStatusQuery.data.email}</p>
                <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Last sync: {formatGmailSyncTime(gmailStatusQuery.data.lastSyncedAt)}</p>
              </div>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">Sync reads only transaction-success emails from <span className="font-semibold">wondr@bni.co.id</span>. It creates pending items for review; it does not post transactions automatically.</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="button" onClick={() => void handleGmailSync()} isLoading={gmailSyncing} disabled={gmailDisconnecting} className="flex-1 rounded-full">
              <Mail className="mr-2 h-4 w-4" />Sync now
            </Button>
            {pendingCount > 0 && <Button type="button" variant="secondary" onClick={() => { setIsGmailModalOpen(false); setIsPendingModalOpen(true); }} disabled={gmailSyncing || gmailDisconnecting} className="flex-1 rounded-full">
              <Clock className="mr-2 h-4 w-4" />Review pending ({pendingCount})
            </Button>}
          </div>
          <div className="border-t border-[var(--color-border)] pt-4">
            <Button type="button" variant="secondary" onClick={() => void handleGmailDisconnect()} isLoading={gmailDisconnecting} disabled={gmailSyncing} className="w-full rounded-full text-red-600">
              Disconnect Gmail
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">Connect the authorized Gmail account to import transaction-success emails from BNI. Fainens requests read-only Gmail access.</p>
          <Button type="button" onClick={() => window.location.assign(api.gmail.connectUrl())} className="w-full rounded-full">
            <Mail className="mr-2 h-4 w-4" />Connect Gmail
          </Button>
        </div>
      )}
    </Modal>

    {selectedPeriod && selectedPeriod.coverageStatus !== 'complete' && <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"><CircleAlert className="mt-0.5 h-5 w-5 shrink-0" /><div><strong>Read this activity carefully.</strong> {coverageMessage(selectedPeriod)} <Link to="/periods" className="ml-1 font-bold underline">Review period</Link></div></div>}
    <section className="mt-4 rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-3 shadow-sm sm:mt-6 sm:p-5">
      <div className="grid grid-cols-2 gap-2 lg:flex lg:items-center lg:gap-3"><div className="relative col-span-2 min-w-0 flex-1">
          {isSearching
            ? <Loader2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[var(--ref-primary)]" aria-hidden />
            : <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ref-outline)]" aria-hidden />}
          <input ref={searchInputRef} type="search" value={filterQuery} onChange={(event) => setFilterQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape' && filterQuery) { event.preventDefault(); event.stopPropagation(); clearSearch(); } }} aria-label="Search transactions" aria-busy={isSearching || undefined} placeholder="Search activity" className="w-full rounded-full bg-[var(--ref-surface-container-low)] py-2.5 pl-10 pr-10 text-sm outline-none ring-[var(--ref-primary)] focus:ring-2 [&::-webkit-search-cancel-button]:appearance-none" />
          {filterQuery && <button type="button" onClick={() => { clearSearch(); searchInputRef.current?.focus(); }} aria-label="Clear search" className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-high)] hover:text-[var(--ref-on-surface)]"><X className="h-4 w-4" /></button>}
          <span className="sr-only" role="status">{!isSearching && debouncedQuery.trim() ? `${total.toLocaleString()} matching ${total === 1 ? 'activity' : 'activities'}` : ''}</span>
        </div>
        <PeriodPicker periods={periods} value={search.periodId ?? 'all'} onChange={(value) => navigate({ search: (previous) => ({ ...previous, periodId: value }) })} allOption={{ value: 'all', label: 'All periods' }} ariaLabel="Period" />
        <Button variant="secondary" className="rounded-full" aria-expanded={isFiltersOpen} aria-controls="transaction-filters" onClick={() => setActivePanel(isFiltersOpen ? null : 'transactions-filters')}><SlidersHorizontal className="mr-2 h-4 w-4" />Filters{activeFilters.length > 0 ? ` (${activeFilters.length})` : ''}</Button>
      </div>
      {isFiltersOpen && <div id="transaction-filters" className="mt-4 hidden gap-3 border-t border-[var(--ref-outline-variant)]/20 pt-4 md:grid md:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">Account<select value={search.accountId ?? ''} onChange={(event) => navigate({ search: (previous) => ({ ...previous, accountId: event.target.value || undefined }) })} className="mt-1.5 block w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm"><option value="">All accounts</option>{accounts.map((account) => <option key={account.id} value={String(account.id)}>{account.name}</option>)}</select></label>
        <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">Category<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="mt-1.5 block w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm"><option value="">All categories</option>{categories.map((category) => <option key={category.id} value={String(category.id)}>{category.name}</option>)}</select></label>
        <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">From<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-1.5 block w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm" /></label>
        <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">To<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="mt-1.5 block w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm" /></label>
        <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">Minimum amount<input inputMode="numeric" value={minAmount} onChange={(event) => setMinAmount(event.target.value.replace(/\D/g, ''))} placeholder="Rp0" className="mt-1.5 block w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm" /></label>
        <label className="text-xs font-bold text-[var(--ref-on-surface-variant)]">Maximum amount<input inputMode="numeric" value={maxAmount} onChange={(event) => setMaxAmount(event.target.value.replace(/\D/g, ''))} placeholder="No limit" className="mt-1.5 block w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm" /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeAdjustments} onChange={(event) => setIncludeAdjustments(event.target.checked)} />Include corrections</label><div className="flex items-end"><button type="button" onClick={clearFilters} className="inline-flex items-center gap-1.5 pb-2 text-sm font-bold text-[var(--ref-primary)] hover:underline"><X className="h-4 w-4" />Clear filters</button></div>
      </div>}
      {activeFilters.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Active filters">{activeFilters.map((filter) => <button key={filter.label} type="button" onClick={filter.clear} aria-label={`Remove ${filter.label} filter`} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[var(--ref-surface-container-low)] px-3 py-1.5 text-xs font-semibold"><span className="truncate">{filter.label}</span><X className="h-3 w-3 shrink-0" /></button>)}<button type="button" onClick={clearFilters} className="px-2 py-1 text-xs font-bold text-[var(--ref-primary)]">Clear all</button></div>}
      {invalidRange && <p role="alert" className="mt-3 text-sm text-[var(--ref-error)]">The start of each range must be before or smaller than its end.</p>}
    </section>
    <Modal
      // Phones only. Mounting it hidden on desktop would still lock page scrolling.
      isOpen={isFiltersOpen && isMobile}
      onClose={() => setActivePanel(null)}
      title="Filter transactions"
      subtitle="Results update as you choose filters."
      contentClassName="grid gap-4"
      footer={<div className="flex gap-3"><Button type="button" variant="secondary" className="min-h-11 flex-1" onClick={clearFilters}>Reset</Button><Button type="button" className="min-h-11 flex-1" onClick={() => setActivePanel(null)} disabled={Boolean(invalidRange)}>Show results</Button></div>}
    >
      {renderFilterFields()}
      {invalidRange && <p role="alert" className="text-sm text-[var(--ref-error)]">The start of each range must be before or smaller than its end.</p>}
    </Modal>
    <button type="button" onClick={() => setMobileInsightsOpen((open) => !open)} aria-expanded={mobileInsightsOpen} className="mt-3 flex min-h-11 w-full items-center justify-between rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-4 text-sm font-bold md:hidden"><span className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-[var(--ref-primary)]" />Insights</span><span className="text-xs font-medium text-[var(--ref-on-surface-variant)]">{mobileInsightsOpen ? 'Hide' : 'View charts'}</span></button>
    {mobileInsightsOpen && <section aria-label="Activity insights" className="mt-3 space-y-4 rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-4 md:hidden"><div className="grid grid-cols-2 gap-3"><div><p className="text-xs text-[var(--ref-on-surface-variant)]">Spending</p><p className="font-bold tabular-nums">{formatAmount(summary.expenseCents)}</p></div><div><p className="text-xs text-[var(--ref-on-surface-variant)]">Income</p><p className="font-bold tabular-nums">{formatAmount(summary.incomeCents)}</p></div></div>{(!kindFilter || kindFilter === 'expense') && <TransactionCategoryOverview items={categoryBreakdown} loading={transactionQuery.isLoading} updating={transactionQuery.isFetching} onSelect={(name) => { const category = categories.find((item) => item.name === name); if (category) { setCategoryFilter(String(category.id)); setPage(1); } }} />}<TransactionActivityChart days={summary.dailyActivity} kind={kindFilter} loading={transactionQuery.isLoading} updating={transactionQuery.isFetching} error={transactionQuery.isError} completeCoverage={selectedPeriod?.coverageStatus === 'complete'} startDate={startDate || undefined} endDate={endDate || undefined} onSelectDate={(date) => { setStartDate(date); setEndDate(date); setPage(1); }} onRetry={() => void transactionQuery.refetch()} /></section>}
    {!isMobile && <section aria-label="Filtered transaction summary" className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-5 py-3">
      <div><p className="text-xs text-[var(--ref-on-surface-variant)]">{kindFilter === 'income' ? 'Income' : kindFilter === 'transfer' || kindFilter === 'loan' ? 'Transactions' : 'Spending'} in this view</p><p className="text-xl font-bold tabular-nums">{isLoading || transactionQuery.isError ? '—' : kindFilter === 'income' ? formatAmount(summary.incomeCents) : kindFilter === 'transfer' || kindFilter === 'loan' ? total.toLocaleString() : formatAmount(summary.expenseCents)}</p></div>
      {!kindFilter && <div><p className="text-xs text-[var(--ref-on-surface-variant)]">Income</p><p className="font-bold tabular-nums">{isLoading || transactionQuery.isError ? '—' : formatAmount(summary.incomeCents)}</p></div>}
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
      {/* One row on phones too: the tabs shrink and the sort collapses to an icon beside them. */}
      <div className="flex items-center justify-between gap-1.5 border-b border-[var(--color-border)] px-2 py-3 sm:gap-3 sm:px-4">
        <div className="ui-segmented ui-segmented--5 ui-segmented--accent grid min-w-0 flex-1 max-w-xl grid-cols-5 gap-1 rounded-full bg-[var(--ref-surface-container-low)] p-1" data-segment-index={['', 'expense', 'income', 'transfer', 'loan'].indexOf(kindFilter)} aria-label="Activity type">{([['', 'All'], ['expense', 'Spending'], ['income', 'Income'], ['transfer', 'Transfers'], ['loan', 'Loans']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={kindFilter === value} onClick={() => setKindFilter(value)} className={cn('relative z-[1] min-w-0 rounded-full px-0 py-2 text-[11px] font-semibold tracking-tight whitespace-nowrap min-[400px]:px-1 min-[400px]:text-xs sm:px-3 sm:text-sm sm:tracking-normal', kindFilter === value ? 'text-white' : 'text-[var(--ref-on-surface-variant)] hover:text-[var(--ref-on-surface)]')}>{label}</button>)}</div>
        <div className="flex shrink-0 items-center gap-3"><span role="status" className="text-xs text-[var(--ref-on-surface-variant)] max-sm:sr-only">{transactionQuery.isFetching && !isLoading ? 'Updating…' : ''}</span><MenuSelect compactOnMobile ariaLabel="Sort transactions" value={sort} onChange={setSort} align="right" icon={<ArrowUpDown className="h-3.5 w-3.5 text-[var(--ref-on-surface-variant)]" aria-hidden />} options={SORT_OPTIONS} /></div>
      </div>
      {transactionQuery.isError ? <div role="alert" className="p-10 text-center"><CircleAlert className="mx-auto mb-3 h-8 w-8 text-[var(--ref-error)]" /><p className="font-bold">Could not load transactions</p><p className="mb-4 mt-1 text-sm text-[var(--ref-on-surface-variant)]">Please try again.</p><Button variant="secondary" onClick={() => void transactionQuery.refetch()}>Retry</Button></div> :
      isLoading ? <TransactionRowsSkeleton compact={compactTables} /> : total === 0 ? <div className="p-12 text-center"><Wallet className="mx-auto mb-3 h-10 w-10 text-[var(--ref-outline)]" /><p className="font-headline font-bold">No activity in this view</p><p className="mt-1 text-sm text-[var(--ref-on-surface-variant)]">{hasFilters ? 'Try removing filters to see more activity.' : 'Add your first transaction for this period.'}</p><Button variant="secondary" className="mt-4" onClick={hasFilters ? clearFilters : () => openModal()}>{hasFilters ? 'Clear filters' : 'Add transaction'}</Button></div> : <div className="divide-y divide-[var(--ref-outline-variant)]/20">
        {transactionRows.map((transaction, index) => {
          const kind = getKind(transaction); const amount = displayAmount(transaction); const category = transaction.displayPart === 'loan' ? 'Loan' : categoryLabel(transaction, categories);
          // Expenses show their category's icon; corrections and uncategorised rows keep the plain receipt.
          const rowCategory = kind === 'expense' && transaction.displayPart !== 'loan' && transaction.status !== 'reversed' && transaction.txType !== 'reversal' && transaction.txType !== 'domain_reversal' ? primaryCategory(transaction, categories) : null;
          const loanLabel = kind === 'loan' ? compactLoanActivityLabel(transaction).replace(/^Split bill/, 'Loans') : null;
          const rowKey = `${transaction.id}:${transaction.displayPart ?? 'transaction'}`;
          const isCashIn = transaction.reallocation?.role === 'incoming' || transaction.expenseCents < 0 || kind === 'income' || (kind === 'loan' && amount > 0 && transaction.loanActivity != null && transaction.txType !== 'split_bill_borrowed');
          const reimbursementLine = transaction.lines.find((line) => line.accountType === 'expense' && line.debit > line.credit);
          const reimbursable = transaction.status === 'posted' && kind === 'expense' && reimbursementLine != null && remainingReimbursableExpense(transaction) > 0;
          const walletLine = transaction.lines.find((line) => line.accountType === 'asset' && line.cashFlowClass != null)
            ?? transaction.lines.find((line) => isCashIn ? line.debit > 0 : line.credit > 0) ?? transaction.lines[0];
          const transferSource = transaction.lines.find((line) => line.credit > 0 && line.accountType === 'asset');
          const transferDestination = transaction.lines.find((line) => line.debit > 0 && line.accountType === 'asset');
          const accountName = walletLine?.accountName ?? accounts.find((account) => account.id === walletLine?.accountId)?.name;
          const correction = transaction.status === 'reversed' || transaction.txType === 'reversal' || transaction.txType === 'domain_reversal' || transaction.txType === 'historical_recovery_adjustment' || transaction.txType === 'balance_adjustment';
          const dateLabel = formatWeekdayDate(transaction.date);
          const showDate = sort !== 'largest' && (index === 0 || new Date(transactionRows[index - 1]!.date).toDateString() !== new Date(transaction.date).toDateString());
          return <Fragment key={rowKey}>{showDate && <h2 className="bg-[var(--ref-surface-container-low)] px-5 py-2 text-xs font-semibold text-[var(--ref-on-surface-variant)]">{dateLabel}</h2>}<SwipeReveal
            className={rowActionsKey === rowKey && !isMobile ? 'z-20' : undefined}
            label={maskAmounts(transaction.description)}
            open={swipedRowId === rowKey}
            onOpenChange={(open) => setSwipedRowId(open ? rowKey : null)}
            onActivate={() => openModal(transaction, 'view')}
            actions={<>
              {reimbursable && <button type="button" onClick={() => { setSwipedRowId(null); navigate({ to: '/reimbursements', search: { sourceTransactionId: String(transaction.id), expenseLineId: String(reimbursementLine.id), categoryId: transaction.categoryAllocations.length === 1 ? String(transaction.categoryAllocations[0]!.categoryId) : undefined, amount: String(remainingReimbursableExpense(transaction)) } }); }} className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 bg-[var(--ref-primary)] px-2 text-[11px] font-bold text-white"><HandCoins className="h-5 w-5" />Reimburse</button>}
              {transaction.status === 'draft'
                ? <button type="button" onClick={() => { setSwipedRowId(null); void handleDeleteDraft(transaction); }} className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 bg-[var(--ref-error)] px-2 text-[11px] font-bold text-white"><Trash2 className="h-5 w-5" />Delete</button>
                : <button type="button" disabled={correction || Boolean(transaction.reallocation)} onClick={() => { setSwipedRowId(null); void handleCorrect(transaction); }} className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 bg-amber-600 px-2 text-[11px] font-bold text-white disabled:opacity-40"><RotateCcw className="h-5 w-5" />Correct</button>}
            </>}
          ><div className={cn('group grid grid-cols-[2.5rem_minmax(0,1fr)_2rem] cursor-pointer items-center gap-x-3 gap-y-1 px-4 sm:flex transition-colors hover:bg-[var(--ref-surface-container-low)] sm:px-6', compactTables ? 'py-2.5' : 'py-4', correction && 'bg-[var(--ref-surface-container-low)]/60')}>
            <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl', kind === 'income' ? 'bg-emerald-500/10 text-emerald-700' : kind === 'transfer' ? 'bg-sky-500/10 text-sky-700' : correction ? 'bg-amber-500/10 text-amber-800' : !rowCategory && 'bg-[var(--ref-primary)]/10 text-[var(--ref-primary)]')} style={rowCategory ? { backgroundColor: `color-mix(in srgb, ${rowCategory.color ?? 'var(--ref-primary)'} 12%, transparent)` } : undefined}>{kind === 'transfer' ? <ArrowLeftRight className="h-5 w-5" /> : kind === 'income' ? <Landmark className="h-5 w-5" /> : rowCategory ? <CategoryIcon name={rowCategory.name} color={rowCategory.color ?? 'var(--ref-primary)'} className="h-5 w-5" /> : <Receipt className="h-5 w-5" />}</div>
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={(event) => { event.stopPropagation(); openModal(transaction, 'view'); }} className="line-clamp-2 text-left font-headline font-bold sm:line-clamp-none sm:truncate text-[var(--ref-on-surface)] focus-visible:outline-2 focus-visible:outline-[var(--ref-primary)]">{maskAmounts(transaction.description)}</button>{correction && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200">Accounting correction</span>}</div><p className="mt-1 truncate text-xs text-[var(--ref-on-surface-variant)]">{sort === 'largest' ? formatDateTime(transaction.date) : formatTime(transaction.date)} · {kind === 'transfer' && transferSource && transferDestination ? `${transferSource.accountName ?? accounts.find((account) => account.id === transferSource.accountId)?.name ?? 'Source'} → ${transferDestination.accountName ?? accounts.find((account) => account.id === transferDestination.accountId)?.name ?? 'Destination'}` : accountName ?? 'Account not available'}{transaction.place ? ' · ' + transaction.place : ''}</p><p className="mt-1 text-xs text-[var(--ref-on-surface-variant)] sm:hidden">{category ?? (kind === 'transfer' ? 'Transfer' : kind === 'income' ? 'Income' : 'Unallocated')}</p>{isTransferFee(transaction) && <p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">Linked transfer fee</p>}</div>
            <div className="hidden w-32 shrink-0 text-right sm:block"><p className="truncate text-xs font-semibold text-[var(--ref-on-surface-variant)]" title={category ?? undefined}>{category ?? (kind === 'income' ? 'Income' : kind === 'transfer' ? 'Transfer' : kind === 'loan' ? 'Loan' : 'Unallocated')}</p>{transaction.categoryAllocations.length > 1 && <p className="mt-0.5 text-[10px] text-[var(--ref-outline)]">Split allocation</p>}</div>
            <div className="col-start-2 row-start-2 text-left sm:ml-auto sm:min-w-32 sm:shrink-0 sm:text-right">
              <p className={cn('font-headline text-sm font-extrabold tabular-nums', isCashIn ? 'text-[var(--color-success)]' : 'text-[var(--ref-on-surface)]')}>{amount < 0 ? '−' : isCashIn ? '+' : ''}{formatAmount(Math.abs(amount))}</p>
              {transaction.reallocation && <p className="mt-1 text-[10px] font-semibold text-[var(--ref-primary)]">Reallocation</p>}
              {loanLabel && <p className="mt-1 text-[10px] text-[var(--ref-on-surface-variant)]">{maskAmounts(loanLabel)}</p>}
            </div>
            <div className="relative col-start-3 row-start-1 shrink-0" data-row-actions={rowKey} onClick={(event) => event.stopPropagation()}>
              <button type="button" aria-label={`Actions for ${maskAmounts(transaction.description)}`} aria-haspopup="menu" aria-expanded={rowActionsKey === rowKey} onClick={() => setRowActionsKey(rowActionsKey === rowKey ? null : rowKey)} className={cn('grid h-11 w-11 place-items-center rounded-xl hover:bg-[var(--ref-surface-container-low)]', rowActionsKey === rowKey && 'bg-[var(--ref-surface-container-low)]')}><MoreHorizontal className="h-5 w-5" /></button>
              {!isMobile && rowActionsKey === rowKey && <div role="menu" aria-label="Transaction actions" className={cn('ui-popover absolute right-0 z-30 w-64 rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-1.5 shadow-xl', index >= transactionRows.length - 2 && index > 2 ? 'bottom-full mb-1' : 'top-full mt-1')}>
                {renderRowActions(transaction, 'menu')}
              </div>}
            </div>
          </div></SwipeReveal>
          </Fragment>;
        })}
      </div>}
      {total > 0 && !transactionQuery.isError && <>
        <footer className="hidden flex-col gap-3 border-t border-[var(--ref-outline-variant)]/20 bg-[var(--ref-surface-container-low)]/50 px-5 py-4 sm:flex sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3 text-xs text-[var(--ref-on-surface-variant)]"><span>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString()}</span><select aria-label="Transactions per page" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="rounded-lg border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-2 py-1">{PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size} per page</option>)}</select></div><div className="flex items-center gap-2"><button type="button" aria-label="Previous page" disabled={page <= 1 || transactionQuery.isFetching} onClick={() => setPage((current) => current - 1)} className="rounded-lg p-2 disabled:opacity-30"><ChevronLeft className="h-5 w-5" /></button><span className="text-xs font-bold">{page} / {totalPages}</span><button type="button" aria-label="Next page" disabled={page >= totalPages || transactionQuery.isFetching} onClick={() => setPage((current) => current + 1)} className="rounded-lg p-2 disabled:opacity-30"><ChevronRight className="h-5 w-5" /></button></div></footer>
        <footer className="border-t border-[var(--ref-outline-variant)]/20 p-4 sm:hidden">
          {pageSize < total ? <Button type="button" variant="secondary" className="min-h-12 w-full rounded-full" isLoading={transactionQuery.isFetching} onClick={() => setPageSize((size) => size + 25)}>Load more <span className="ml-1 text-xs opacity-70">({Math.min(pageSize, total)} of {total.toLocaleString()})</span></Button> : <p className="text-center text-xs text-[var(--ref-on-surface-variant)]">All {total.toLocaleString()} transactions loaded</p>}
        </footer>
      </>}
    </section>
    {actionTransaction && isMobile && <Modal isOpen onClose={() => setRowActionsKey(null)} title="Transaction actions" subtitle={actionTransaction.description} contentClassName="p-3">
      {renderRowActions(actionTransaction, 'sheet')}
    </Modal>}
    {reallocationTransaction && <ReallocationModal transaction={reallocationTransaction} onClose={() => setReallocationTransaction(null)} onSaved={() => void loadData()} />}
    <TransactionModal isOpen={isModalOpen} onClose={closeModal} onSaved={loadData} onSuccess={() => { void loadData(); setEditingPendingTx(null); }} accounts={accounts} categories={categories} tags={tags} editingTransaction={editingTransaction} periodId={search.periodId && search.periodId !== 'all' ? Number(search.periodId) : null} initialMode={modalInitialMode} pendingTransaction={editingPendingTx} initialPrefill={modalPrefill} />
    <ImportCSVModal isOpen={isImportModalOpen} onClose={() => setIsImportModalOpen(false)} onSuccess={loadData} />
    <PendingTransactionsModal isOpen={isPendingModalOpen} onClose={() => setIsPendingModalOpen(false)} onEdit={(pending) => { setEditingPendingTx(pending); setIsPendingModalOpen(false); openModal(); }} onRefresh={() => { void pendingQuery.refetch(); }} />
  </PageContainer></RequireAuth>;
}
