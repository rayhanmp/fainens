import { Link, createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Calendar, CalendarCheck2, CalendarClock, ChevronRight, Edit2, History, Lock, LockOpen, Plus, RotateCcw, Wallet } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { PageContainer } from '../components/ui/PageContainer';
import { PageHeader } from '../components/ui/PageHeader';
import { RequireAuth } from '../lib/auth';
import { api } from '../lib/api';
import { formatCurrency, formatDate, snapshotTimestampForLocalDate, toLocalDateInputValue } from '../lib/utils';
import { useConfirm } from '../components/ui/ConfirmDialog';

// TanStack routes are module-level exports rather than React components.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute('/periods')({ component: PeriodsPage } as any);

const DAY_MS = 24 * 60 * 60 * 1000;

interface Period {
  id: number;
  name: string;
  startDate: number;
  endDate: number;
  status: 'open' | 'closed';
  closedAt: number | null;
  reopenedAt: number | null;
  isActive: boolean;
  archivedAt: number | null;
  coverageStatus: 'complete' | 'partial' | 'skipped' | 'unknown';
  coverageReason: string | null;
}

interface PeriodDetail extends Period {
  summary?: { income: number; expenses: number; net: number; savingsRate: number } | null;
  budgets?: Array<{ id: number; categoryId: number; plannedAmount: number; categoryName: string }>;
}

function isTracked(period: Period) {
  return period.coverageStatus === 'complete' || period.coverageStatus === 'partial';
}

function coverageCopy(period: Period) {
  if (period.coverageStatus === 'complete') return 'Activity fully tracked';
  if (period.coverageStatus === 'partial') return 'Some activity is missing';
  if (period.coverageStatus === 'skipped') return 'Skipped during an untracked break';
  return 'Coverage has not been reviewed';
}

function coverageClasses(status: Period['coverageStatus']) {
  if (status === 'complete') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'partial') return 'bg-amber-500/10 text-amber-800 dark:text-amber-200';
  if (status === 'skipped') return 'bg-slate-500/10 text-slate-700 dark:text-slate-300';
  return 'bg-[var(--ref-surface-container)] text-[var(--ref-on-surface-variant)]';
}

function lifecycleCopy(period: Period) {
  if (!period.isActive) return 'Archived';
  return period.status === 'open' ? 'Open' : 'Closed';
}

function lifecycleClasses(period: Period) {
  if (!period.isActive) return 'border-[var(--ref-outline-variant)] text-[var(--ref-on-surface-variant)]';
  return period.status === 'open'
    ? 'border-[var(--ref-primary)]/40 text-[var(--ref-primary)]'
    : 'border-[var(--ref-outline-variant)] text-[var(--ref-on-surface-variant)]';
}

// Route modules necessarily export a route object beside their component.
// eslint-disable-next-line react-refresh/only-export-components
function PeriodsPage() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<Period | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<Period | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<PeriodDetail | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const { confirm } = useConfirm();
  const [suggestedDates, setSuggestedDates] = useState<{ suggestedName: string; suggestedStartDate: string; suggestedEndDate: string } | null>(null);
  const [formData, setFormData] = useState({ name: '', startDate: '', endDate: '' });
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [returnDate, setReturnDate] = useState(() => toLocalDateInputValue());
  const [returnPreview, setReturnPreview] = useState<Array<{ name: string; startDate: number; endDate: number; isCurrent: boolean }>>([]);
  const [returnPayrollDay, setReturnPayrollDay] = useState<number | null>(null);
  const [returnError, setReturnError] = useState('');
  const [returnStartedAtPeriodStart, setReturnStartedAtPeriodStart] = useState(false);
  const [coveragePeriod, setCoveragePeriod] = useState<Period | null>(null);
  const [coverageStatus, setCoverageStatus] = useState<'partial' | 'complete' | 'skipped'>('partial');
  const [coverageReason, setCoverageReason] = useState('');
  const [coverageReviewed, setCoverageReviewed] = useState(false);
  const [coverageError, setCoverageError] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [periodsData, suggestion] = await Promise.all([
        api.periods.list({ includeInactive: showArchived }),
        api.periods.suggestNext(),
      ]);
      setPeriods(periodsData as Period[]);
      setSuggestedDates(suggestion);
    } finally {
      setIsLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    setIsLoading(true);
    void loadData();
  }, [loadData]);

  const currentPeriod = useMemo(() => {
    const now = Date.now();
    const active = periods.filter((period) => period.isActive);
    return active.find((period) => period.startDate <= now && now <= period.endDate + DAY_MS - 1)
      ?? active.find((period) => period.status === 'open')
      ?? active[0]
      ?? null;
  }, [periods]);

  const historyPeriods = useMemo(() => periods.filter((period) => period.id !== currentPeriod?.id), [periods, currentPeriod]);

  const openDetails = async (period: Period) => {
    setSelectedPeriod(period);
    setSelectedDetail(null);
    setIsDetailLoading(true);
    try {
      setSelectedDetail(await api.periods.get(period.id) as PeriodDetail);
    } catch {
      setSelectedDetail(null);
    } finally {
      setIsDetailLoading(false);
    }
  };

  const closeDetails = () => {
    setSelectedPeriod(null);
    setSelectedDetail(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError('');
    if (new Date(formData.endDate) <= new Date(formData.startDate)) {
      setFormError('End date must be after start date');
      return;
    }
    setIsSubmitting(true);
    try {
      if (editingPeriod) await api.periods.update(editingPeriod.id, formData);
      else await api.periods.create(formData);
      await loadData();
      setIsModalOpen(false);
      setEditingPeriod(null);
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAutoCreate = async () => {
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/periods/auto-create', { method: 'POST', credentials: 'include' });
      if (!response.ok) throw new Error((await response.json().catch(() => ({ error: 'Could not create the next period' }))).error);
      await loadData();
    } catch (error) {
      alert((error as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = async (period: Period) => {
    if (!await confirm({ title: 'Close accounting period', message: `Close ${period.name}? New or backdated transactions and budget changes will be blocked until you reopen it.`, confirmLabel: 'Close period', variant: 'warning' })) return;
    try { await api.periods.close(period.id); await loadData(); if (selectedPeriod?.id === period.id) void openDetails({ ...period, status: 'closed' }); } catch (error) { alert((error as Error).message); }
  };

  const handleReopen = async (period: Period) => {
    if (!await confirm({ title: 'Reopen accounting period', message: `Reopen ${period.name}? This permits historical corrections and budget changes again.`, confirmLabel: 'Reopen period', variant: 'warning' })) return;
    try { await api.periods.reopen(period.id); await loadData(); if (selectedPeriod?.id === period.id) void openDetails({ ...period, status: 'open' }); } catch (error) { alert((error as Error).message); }
  };

  const handleArchive = async (period: Period) => {
    if (!await confirm({ title: 'Archive period', message: `${period.name} will be hidden from everyday period pickers but kept for reports and audit history. You can restore it later.`, confirmLabel: 'Archive period', variant: 'warning' })) return;
    try { await api.periods.archive(period.id); closeDetails(); await loadData(); } catch (error) { alert((error as Error).message); }
  };

  const handleRestore = async (period: Period) => {
    try { await api.periods.restore(period.id); await loadData(); if (selectedPeriod?.id === period.id) void openDetails({ ...period, isActive: true }); } catch (error) { alert((error as Error).message); }
  };

  const openModal = (period?: Period) => {
    setEditingPeriod(period ?? null);
    setFormData(period
      ? { name: period.name, startDate: toLocalDateInputValue(new Date(period.startDate)), endDate: toLocalDateInputValue(new Date(period.endDate)) }
      : suggestedDates ?? { name: '', startDate: '', endDate: '' });
    setFormError('');
    setIsModalOpen(true);
  };

  const loadReturnPreview = async (date = returnDate) => {
    setReturnError('');
    const asOfDate = snapshotTimestampForLocalDate(date);
    if (asOfDate == null) { setReturnPreview([]); setReturnError('Choose a current or historical return date'); return; }
    try {
      const result = await api.periods.returnPreview(asOfDate);
      setReturnPreview(result.reason ? [] : result.candidates);
      setReturnPayrollDay(result.payrollDay ?? null);
      setReturnError(result.reason ?? '');
    } catch (error) { setReturnPreview([]); setReturnPayrollDay(null); setReturnError((error as Error).message); }
  };

  const openReturnModal = () => {
    const date = toLocalDateInputValue();
    setReturnDate(date); setReturnPreview([]); setReturnPayrollDay(null); setReturnError(''); setReturnStartedAtPeriodStart(false); setIsReturnModalOpen(true);
    void loadReturnPreview(date);
  };

  const createReturnBackfill = async () => {
    const asOfDate = snapshotTimestampForLocalDate(returnDate);
    if (asOfDate == null) { setReturnError('Choose a current or historical return date'); return; }
    setIsSubmitting(true);
    try { await api.periods.createReturnBackfill(asOfDate, returnStartedAtPeriodStart ? 'complete' : 'partial'); setIsReturnModalOpen(false); await loadData(); } catch (error) { setReturnError((error as Error).message); } finally { setIsSubmitting(false); }
  };

  const openCoverage = (period: Period) => {
    setCoveragePeriod(period);
    setCoverageStatus(period.coverageStatus === 'complete' || period.coverageStatus === 'skipped' ? period.coverageStatus : 'partial');
    setCoverageReason(period.coverageReason ?? '');
    setCoverageReviewed(false);
    setCoverageError('');
  };

  const saveCoverage = async () => {
    if (!coveragePeriod) return;
    setCoverageError('');
    try {
      await api.periods.setCoverage(coveragePeriod.id, { coverageStatus, reason: coverageReason, reviewed: coverageStatus === 'partial' ? undefined : coverageReviewed });
      setCoveragePeriod(null);
      await loadData();
      if (selectedPeriod?.id === coveragePeriod.id) void openDetails({ ...coveragePeriod, coverageStatus, coverageReason });
    } catch (error) { setCoverageError((error as Error).message); }
  };

  const renderTimelineRow = (period: Period) => (
    <button key={period.id} type="button" onClick={() => void openDetails(period)} className="group flex w-full items-center gap-3 border-b border-[var(--ref-outline-variant)]/20 px-1 py-4 text-left last:border-b-0 hover:bg-[var(--ref-surface-container-low)] sm:px-3">
      <div className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${period.coverageStatus === 'complete' ? 'bg-emerald-500' : period.coverageStatus === 'partial' ? 'bg-amber-500' : period.coverageStatus === 'skipped' ? 'bg-slate-400' : 'bg-[var(--ref-outline)]'}`} aria-hidden />
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><p className="font-headline font-bold text-[var(--ref-on-surface)]">{period.name}</p><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${coverageClasses(period.coverageStatus)}`}>{period.coverageStatus}</span></div><p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">{formatDate(period.startDate)} – {formatDate(period.endDate)} · {coverageCopy(period)}</p></div>
      <span className={`hidden rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wide sm:inline-flex ${lifecycleClasses(period)}`}>{lifecycleCopy(period)}</span><ChevronRight className="h-4 w-4 shrink-0 text-[var(--ref-outline)] transition-transform group-hover:translate-x-0.5" aria-hidden />
    </button>
  );

  return <RequireAuth><PageContainer>
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between"><PageHeader subtext="Accounting timeline" title="Salary periods" description="Review what each period means before budgets, reports, and insights use it." /><div className="flex flex-wrap gap-2 lg:justify-end"><Button variant="secondary" className="rounded-full" onClick={openReturnModal}><History className="mr-2 h-4 w-4" />Resume tracking</Button><Button variant="secondary" className="rounded-full" onClick={handleAutoCreate} isLoading={isSubmitting}><CalendarCheck2 className="mr-2 h-4 w-4" />Create next</Button><Button className="rounded-full" onClick={() => openModal()}><Plus className="mr-2 h-4 w-4" />New period</Button></div></div>

    {isLoading ? <div className="mt-8 space-y-4"><div className="h-56 animate-pulse rounded-3xl bg-[var(--ref-surface-container)]" /><div className="h-64 animate-pulse rounded-3xl bg-[var(--ref-surface-container)]" /></div> : periods.length === 0 ? <section className="mt-8 rounded-3xl border border-dashed border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-6 py-14 text-center"><Calendar className="mx-auto mb-4 h-12 w-12 text-[var(--ref-outline)]" /><h2 className="font-headline text-xl font-extrabold text-[var(--ref-on-surface)]">Start your first period</h2><p className="mx-auto mt-2 max-w-md text-sm text-[var(--ref-on-surface-variant)]">Periods give budgets and reports a clear time boundary. They do not create transactions or balances.</p><div className="mt-6 flex flex-wrap justify-center gap-3"><Button className="rounded-full" onClick={handleAutoCreate} isLoading={isSubmitting}>Create this period</Button><Button className="rounded-full" variant="secondary" onClick={() => openModal()}>Choose custom dates</Button></div></section> : <>
      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]"><section className="rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-5 shadow-sm sm:p-6"><div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between"><div className="flex min-w-0 gap-4"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--ref-primary)]/10 text-[var(--ref-primary)]"><CalendarClock className="h-6 w-6" /></div><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--ref-secondary)]">Current period</p><h2 className="mt-1 font-headline text-2xl font-extrabold text-[var(--ref-on-surface)]">{currentPeriod?.name ?? 'No current period'}</h2>{currentPeriod && <p className="mt-1 text-sm text-[var(--ref-on-surface-variant)]">{formatDate(currentPeriod.startDate)} – {formatDate(currentPeriod.endDate)}</p>}</div></div>{currentPeriod && <div className="flex flex-wrap gap-2 sm:justify-end"><span className={`rounded-full border px-3 py-1 text-xs font-bold ${lifecycleClasses(currentPeriod)}`}>{lifecycleCopy(currentPeriod)}</span><span className={`rounded-full px-3 py-1 text-xs font-bold ${coverageClasses(currentPeriod.coverageStatus)}`}>{coverageCopy(currentPeriod)}</span></div>}</div>{currentPeriod ? <><div className="mt-6 rounded-2xl bg-[var(--ref-surface-container-low)] p-4 text-sm text-[var(--ref-on-surface-variant)]">{currentPeriod.coverageStatus === 'skipped' ? 'This period is intentionally excluded from activity totals. Empty reports do not mean zero spending.' : currentPeriod.coverageStatus === 'partial' ? 'Recorded activity may be incomplete. Use reconciliation to establish today’s balances before relying on trends.' : currentPeriod.coverageStatus === 'unknown' ? 'Review coverage before relying on period totals.' : 'Budgets and reports can use this period’s recorded activity.'}</div><div className="mt-5 flex flex-wrap gap-2"><Button className="rounded-full" onClick={() => void openDetails(currentPeriod)}>Open period</Button><Link to="/budget" search={{ periodId: String(currentPeriod.id) }} className="inline-flex items-center rounded-full border border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-[var(--ref-on-surface)] hover:bg-[var(--ref-surface-container-low)]">View budget</Link><Link to="/transactions" search={{ periodId: String(currentPeriod.id) }} className="inline-flex items-center rounded-full border border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-[var(--ref-on-surface)] hover:bg-[var(--ref-surface-container-low)]">View activity</Link></div></> : <div className="mt-6 rounded-2xl bg-[var(--ref-surface-container-low)] p-4 text-sm text-[var(--ref-on-surface-variant)]">Create the next period when you are ready to plan a new salary cycle.</div>}</section>
      <aside className="rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-5 sm:p-6"><div className="flex items-start gap-3"><Wallet className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ref-primary)]" /><div><h2 className="font-headline text-lg font-extrabold text-[var(--ref-on-surface)]">How periods stay trustworthy</h2><p className="mt-1 text-sm text-[var(--ref-on-surface-variant)]">A closed period protects recorded history. Coverage tells you whether activity totals are safe to interpret.</p></div></div><div className="mt-5 space-y-3 text-sm"><p><span className="font-bold text-[var(--ref-on-surface)]">Open / closed</span><span className="text-[var(--ref-on-surface-variant)]"> controls whether new changes are allowed.</span></p><p><span className="font-bold text-[var(--ref-on-surface)]">Complete / partial / skipped</span><span className="text-[var(--ref-on-surface-variant)]"> describes activity coverage, not money.</span></p><Link to="/accounts" className="inline-flex items-center gap-1 font-bold text-[var(--ref-primary)] hover:underline">Reconcile balances <ChevronRight className="h-4 w-4" /></Link></div></aside></div>
      <section className="mt-6 rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-5 sm:p-6"><div className="flex flex-col gap-3 border-b border-[var(--ref-outline-variant)]/20 pb-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--ref-secondary)]">Timeline</p><h2 className="mt-1 font-headline text-xl font-extrabold text-[var(--ref-on-surface)]">Period history</h2></div><label className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--ref-on-surface-variant)]"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Show archived</label></div><div className="mt-1">{historyPeriods.length > 0 ? historyPeriods.map(renderTimelineRow) : <p className="py-8 text-center text-sm text-[var(--ref-on-surface-variant)]">No earlier periods to review.</p>}</div></section>
    </>}

    <Modal isOpen={selectedPeriod != null} onClose={closeDetails} title={selectedPeriod?.name ?? 'Period'} subtitle={selectedPeriod ? `${formatDate(selectedPeriod.startDate)} – ${formatDate(selectedPeriod.endDate)}` : undefined} size="xl">{selectedPeriod && <div className="space-y-6"><div className="flex flex-wrap gap-2"><span className={`rounded-full border px-3 py-1 text-xs font-bold ${lifecycleClasses(selectedPeriod)}`}>{lifecycleCopy(selectedPeriod)}</span><span className={`rounded-full px-3 py-1 text-xs font-bold ${coverageClasses(selectedPeriod.coverageStatus)}`}>{coverageCopy(selectedPeriod)}</span></div>{isDetailLoading ? <div className="h-40 animate-pulse rounded-2xl bg-[var(--ref-surface-container)]" /> : <><div className="rounded-2xl bg-[var(--ref-surface-container-low)] p-4"><p className="text-sm font-bold text-[var(--ref-on-surface)]">Activity coverage</p><p className="mt-1 text-sm text-[var(--ref-on-surface-variant)]">{selectedPeriod.coverageReason || coverageCopy(selectedPeriod)}.</p></div>{isTracked(selectedPeriod) && selectedDetail?.summary ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><div className="rounded-2xl border border-[var(--ref-outline-variant)]/25 p-4"><p className="text-xs font-bold uppercase tracking-wide text-[var(--ref-outline)]">Income</p><p className="mt-2 font-headline text-xl font-extrabold">{formatCurrency(selectedDetail.summary.income)}</p></div><div className="rounded-2xl border border-[var(--ref-outline-variant)]/25 p-4"><p className="text-xs font-bold uppercase tracking-wide text-[var(--ref-outline)]">Spending</p><p className="mt-2 font-headline text-xl font-extrabold">{formatCurrency(selectedDetail.summary.expenses)}</p></div><div className="rounded-2xl border border-[var(--ref-outline-variant)]/25 p-4"><p className="text-xs font-bold uppercase tracking-wide text-[var(--ref-outline)]">Net</p><p className="mt-2 font-headline text-xl font-extrabold">{formatCurrency(selectedDetail.summary.net)}</p></div></div> : <div className="rounded-2xl border border-dashed border-[var(--ref-outline-variant)]/40 p-4 text-sm text-[var(--ref-on-surface-variant)]">Activity totals are not shown because this period’s coverage is not reliable enough to interpret as a financial result.</div>}<div className="flex flex-wrap gap-2"><Link to="/budget" search={{ periodId: String(selectedPeriod.id) }} className="inline-flex items-center rounded-full border border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-[var(--ref-on-surface)] hover:bg-[var(--ref-surface-container-low)]">View budget{selectedDetail?.budgets ? ` (${selectedDetail.budgets.length})` : ''}</Link><Link to="/transactions" search={{ periodId: String(selectedPeriod.id) }} className="inline-flex items-center rounded-full border border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-[var(--ref-on-surface)] hover:bg-[var(--ref-surface-container-low)]">View activity</Link></div><div className="border-t border-[var(--ref-outline-variant)]/20 pt-5"><p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-[var(--ref-outline)]">Manage period</p><div className="flex flex-wrap gap-2">{selectedPeriod.isActive && <Button variant="secondary" className="rounded-full" onClick={() => openCoverage(selectedPeriod)}>Review coverage</Button>}{selectedPeriod.isActive && selectedPeriod.status === 'open' && <><Button variant="secondary" className="rounded-full" onClick={() => openModal(selectedPeriod)}><Edit2 className="mr-2 h-4 w-4" />Edit</Button><Button variant="secondary" className="rounded-full" onClick={() => void handleClose(selectedPeriod)}><Lock className="mr-2 h-4 w-4" />Close period</Button></>}{selectedPeriod.isActive && selectedPeriod.status === 'closed' && <><Button variant="secondary" className="rounded-full" onClick={() => void handleReopen(selectedPeriod)}><LockOpen className="mr-2 h-4 w-4" />Reopen</Button><Button variant="secondary" className="rounded-full" onClick={() => void handleArchive(selectedPeriod)}><Archive className="mr-2 h-4 w-4" />Archive</Button></>}{!selectedPeriod.isActive && <Button variant="secondary" className="rounded-full" onClick={() => void handleRestore(selectedPeriod)}><RotateCcw className="mr-2 h-4 w-4" />Restore</Button>}</div>{selectedPeriod.isActive && selectedPeriod.status === 'open' && <p className="mt-3 text-xs text-[var(--ref-on-surface-variant)]">Dates can be changed only before this period has posted activity or budget plans. This protects recorded history from being silently reframed.</p>}</div></>}</div>}</Modal>

    <Modal isOpen={isReturnModalOpen} onClose={() => setIsReturnModalOpen(false)} title="Resume tracking" subtitle="Mark the time away explicitly, then reconcile your real balances. No transactions or opening balances are fabricated."><div className="space-y-4"><Input label="Date you returned / took a balance snapshot" type="date" value={returnDate} max={toLocalDateInputValue()} onChange={(event) => { setReturnDate(event.target.value); void loadReturnPreview(event.target.value); }} />{returnError && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{returnError}</p>}{!returnError && <div className="rounded-xl border border-[var(--color-border)] p-3 text-sm">{returnPayrollDay != null && <p className="mb-2 font-semibold text-[var(--ref-on-surface)]">Using your payroll cycle: the {returnPayrollDay}th through the {returnPayrollDay === 1 ? 'last day' : `${returnPayrollDay - 1}th`}.</p>}{returnPreview.length === 0 ? <p className="text-[var(--color-text-secondary)]">No missing periods were found before this date.</p> : <><p className="font-semibold">{returnPreview.length} period{returnPreview.length === 1 ? '' : 's'} will be created</p><ul className="mt-2 max-h-44 space-y-1 overflow-auto text-[var(--color-text-secondary)]">{returnPreview.map((period) => <li key={period.startDate}>{formatDate(period.startDate)} – {formatDate(period.endDate)} · {period.isCurrent ? 'current period remains open' : 'skipped coverage'}</li>)}</ul></>}</div>}{returnPreview.some((period) => period.isCurrent) && !returnError && <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--color-border)] p-3 text-sm"><input type="checkbox" checked={returnStartedAtPeriodStart} onChange={(event) => setReturnStartedAtPeriodStart(event.target.checked)} className="mt-1" /><span><strong className="block">I resumed tracking at the start of this current period</strong><span className="mt-1 block text-[var(--color-text-secondary)]">Mark only this current period as complete. Earlier missing periods stay skipped.</span></span></label>}<p className="text-xs text-[var(--color-text-secondary)]">Next: use Accounts → Reconciliation and choose the return-after-break option to record actual balances.</p><div className="flex justify-end gap-3"><Button variant="secondary" onClick={() => setIsReturnModalOpen(false)}>Cancel</Button><Button onClick={createReturnBackfill} isLoading={isSubmitting} disabled={returnPreview.length === 0 || !!returnError}>{returnStartedAtPeriodStart ? 'Create and mark current complete' : 'Create skipped periods'}</Button></div></div></Modal>

    <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingPeriod ? 'Edit period' : 'New salary period'} subtitle={editingPeriod ? 'Changing dates is allowed only while this period has no posted activity or budget plans.' : 'Create a period boundary for a salary cycle.'}><form onSubmit={handleSubmit} className="space-y-4"><Input label="Period name" value={formData.name} onChange={(event) => setFormData({ ...formData, name: event.target.value })} placeholder="e.g., August 2026" required /><div className="grid grid-cols-2 gap-4"><Input label="Start date" type="date" value={formData.startDate} onChange={(event) => setFormData({ ...formData, startDate: event.target.value })} required /><Input label="End date" type="date" value={formData.endDate} onChange={(event) => setFormData({ ...formData, endDate: event.target.value })} required /></div>{formError && <p className="text-sm text-[var(--color-danger)]">{formError}</p>}<div className="flex justify-end gap-3 pt-2"><Button type="button" variant="secondary" onClick={() => setIsModalOpen(false)}>Cancel</Button><Button type="submit" isLoading={isSubmitting}>{editingPeriod ? 'Save changes' : 'Create period'}</Button></div></form></Modal>

    <Modal isOpen={coveragePeriod != null} onClose={() => setCoveragePeriod(null)} title="Review activity coverage" subtitle="This describes the completeness of activity data. It does not change balances or fabricate transactions."><div className="space-y-4"><label className="block text-sm font-semibold text-[var(--color-text-primary)]">Coverage<select value={coverageStatus} onChange={(event) => setCoverageStatus(event.target.value as 'partial' | 'complete' | 'skipped')} className="mt-2 block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"><option value="partial">Partial — some activity is missing</option><option value="complete">Complete — all activity was reviewed</option><option value="skipped">Skipped — I did not track this period</option></select></label>{coverageStatus === 'skipped' && <p className="rounded-xl border border-slate-300 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200">Skipped periods are excluded from activity insights. This is available only when the period has no posted transactions or budget plans.</p>}<label className="block text-sm font-semibold text-[var(--color-text-primary)]">Why is this coverage status accurate?<textarea value={coverageReason} onChange={(event) => setCoverageReason(event.target.value)} rows={3} className="mt-2 block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm" placeholder={coverageStatus === 'skipped' ? 'e.g., I did not track finances during this period.' : 'e.g., Started tracking on the 8th after returning from a break.'} /></label>{coverageStatus !== 'partial' && <label className="flex items-start gap-3 rounded-xl border border-[var(--color-border)] p-3 text-sm"><input type="checkbox" checked={coverageReviewed} onChange={(event) => setCoverageReviewed(event.target.checked)} className="mt-1" /><span>{coverageStatus === 'complete' ? 'I reviewed this period and confirm its activity is complete.' : 'I confirm I did not track this period and understand that it will be excluded from activity insights.'}</span></label>}{coverageError && <p className="text-sm text-[var(--color-danger)]">{coverageError}</p>}<div className="flex justify-end gap-3"><Button variant="secondary" onClick={() => setCoveragePeriod(null)}>Cancel</Button><Button onClick={saveCoverage}>Save coverage</Button></div></div></Modal>
  </PageContainer></RequireAuth>;
}
