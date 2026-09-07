import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Check, CheckCircle2, ChevronDown, Clock3, FilePlus2, HandCoins, ReceiptText, Search, Send, Trash2, Wallet, X } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { PageContainer } from '../components/ui/PageContainer';
import { PageHeader } from '../components/ui/PageHeader';
import { useConfirm } from '../components/ui/ConfirmDialog';
import { ToastContainer, useToast } from '../components/ui/Toast';
import { ClaimComposer, PaymentDialog } from '../components/reimbursements/ClaimDialogs';
import { RequireAuth } from '../lib/auth';
import { api } from '../lib/api';
import { cn, formatCurrency } from '../lib/utils';
import { queryKeys, invalidateFinancialSummaries } from '../features/core/query-keys';

export const Route = createFileRoute('/reimbursements')({
  validateSearch: (search: Record<string, unknown>) => ({
    sourceTransactionId: typeof search.sourceTransactionId === 'string' ? search.sourceTransactionId : undefined,
    expenseLineId: typeof search.expenseLineId === 'string' ? search.expenseLineId : undefined,
    categoryId: typeof search.categoryId === 'string' ? search.categoryId : undefined,
    amount: typeof search.amount === 'string' ? search.amount : undefined,
  }),
  component: ReimbursementsPage,
});

type Claim = Awaited<ReturnType<typeof api.reimbursements.list>>[number];
type View = 'all' | 'draft' | 'submitted' | 'outstanding' | 'overdue' | 'settled' | 'partially_paid' | 'rejected' | 'written_off' | 'cancelled';
const views: { value: View; label: string }[] = [
  { value: 'all', label: 'All claims' }, { value: 'draft', label: 'Drafts' },
  { value: 'submitted', label: 'Submitted' }, { value: 'outstanding', label: 'Awaiting payment' },
  { value: 'overdue', label: 'Overdue' }, { value: 'settled', label: 'Settled' },
];
const statusLabels: Record<string, string> = { draft: 'Draft', submitted: 'Submitted', approved: 'Approved', partially_paid: 'Partially paid', settled: 'Settled', rejected: 'Rejected', written_off: 'Written off', cancelled: 'Cancelled' };
const statusColors: Record<string, string> = {
  draft: 'bg-[var(--ref-surface-container)] text-[var(--ref-on-surface-variant)]',
  submitted: 'bg-violet-500/10 text-[var(--ref-tertiary)]',
  approved: 'bg-blue-500/10 text-[var(--ref-primary)]',
  partially_paid: 'bg-amber-500/10 text-[var(--color-warning)]',
  settled: 'bg-emerald-500/10 text-[var(--ref-secondary)]',
  rejected: 'bg-red-500/10 text-[var(--ref-error)]',
};
function displayDate(value: number | string) {
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function overdue(claim: Claim) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return claim.dueDate != null && new Date(claim.dueDate).getTime() < today.getTime() && claim.outstandingAmount > 0;
}
function matchesView(claim: Claim, view: View) {
  if (view === 'all') return true;
  if (view === 'outstanding') return claim.outstandingAmount > 0;
  if (view === 'overdue') return overdue(claim);
  return claim.status === view;
}

// TanStack Router manages hot reload for components registered through Route.
// eslint-disable-next-line react-refresh/only-export-components
function ReimbursementsPage() {
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useConfirm();
  const claimsQuery = useQuery({ queryKey: queryKeys.reimbursements.list(), queryFn: () => api.reimbursements.list() });
  const claims = claimsQuery.data ?? [];
  const [view, setView] = useState<View>('all');
  const [searchText, setSearchText] = useState('');
  const [sort, setSort] = useState('newest');
  const [composerOpen, setComposerOpen] = useState(Boolean(search.sourceTransactionId));
  const [useSource, setUseSource] = useState(Boolean(search.sourceTransactionId));
  const [payment, setPayment] = useState<{ claimId?: number } | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.reimbursements.all }),
      queryClient.invalidateQueries({ queryKey: ['reimbursement-expense'] }),
      invalidateFinancialSummaries(queryClient),
    ]);
  };
  const action = useMutation({
    mutationFn: ({ claim, kind }: { claim: Claim; kind: 'submit' | 'approve' | 'cancel' }) => kind === 'approve'
      ? api.reimbursements.approve(claim.id, crypto.randomUUID()) : api.reimbursements[kind](claim.id),
    onSuccess: async (_, { kind }) => { toast.success(kind === 'submit' ? 'Claim submitted' : kind === 'approve' ? 'Claim approved' : 'Claim cancelled'); await refresh(); },
    onError: (error) => toast.error('Could not update claim', error.message),
  });
  const performAction = async (claim: Claim, kind: 'submit' | 'approve' | 'cancel') => {
    if (kind !== 'submit' && !await confirm({
      title: kind === 'approve' ? 'Approve reimbursement?' : 'Cancel this claim?',
      message: kind === 'approve' ? `Approve ${formatCurrency(claim.proposedAmount)} for “${claim.title}”? This moves the approved expense amount to money owed to you. Record a payment when it arrives.` : `“${claim.title}” will be cancelled. Its original expense will stay unchanged.`,
      confirmLabel: kind === 'approve' ? 'Approve claim' : 'Cancel claim',
      cancelLabel: 'Go back', variant: kind === 'cancel' ? 'danger' : 'default',
    })) return;
    action.mutate({ claim, kind });
  };
  const outstanding = claims.reduce((sum, claim) => sum + claim.outstandingAmount, 0);
  const awaiting = claims.filter((claim) => claim.status === 'submitted');
  const late = claims.filter(overdue);
  const paid = claims.reduce((sum, claim) => sum + claim.receipts.filter((row) => row.receipt.status === 'posted').reduce((total, row) => total + row.allocation.amount, 0), 0);
  const filtered = claims.filter((claim) => matchesView(claim, view) && `${claim.title} ${claim.contact?.name ?? ''} ${claim.id}`.toLowerCase().includes(searchText.trim().toLowerCase()))
    .sort((a, b) => sort === 'amount' ? b.proposedAmount - a.proposedAmount : sort === 'due' ? (a.dueDate == null ? Infinity : new Date(a.dueDate).getTime()) - (b.dueDate == null ? Infinity : new Date(b.dueDate).getTime()) : b.id - a.id);
  const newClaim = () => { setUseSource(false); setComposerOpen(true); };
  const summaryValue = (value: string) => claimsQuery.isPending ? '…' : claimsQuery.isError && !claimsQuery.data ? '—' : value;

  return <RequireAuth><PageContainer>
    <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <PageHeader subtext="Money coming back" title="Reimbursements" description="From out-of-pocket to paid back. Keep every claim in sight." />
      <div className="flex gap-2"><Button variant="secondary" disabled={!claims.some((claim) => claim.outstandingAmount > 0)} onClick={() => setPayment({})}><Wallet className="mr-2 h-4 w-4" />Record payment</Button><Button onClick={newClaim}><FilePlus2 className="mr-2 h-4 w-4" />New claim</Button></div>
    </header>

    <section aria-label="Reimbursement summary" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      {[
        { label: 'Awaiting payment', value: formatCurrency(outstanding), detail: `${claims.filter((claim) => claim.outstandingAmount > 0).length} approved claims to collect`, icon: HandCoins, target: 'outstanding' as View, primary: true },
        { label: 'Awaiting approval', value: formatCurrency(awaiting.reduce((sum, claim) => sum + claim.proposedAmount, 0)), detail: `${awaiting.length} submitted claims`, icon: Clock3, target: 'submitted' as View },
        { label: 'Overdue', value: formatCurrency(late.reduce((sum, claim) => sum + claim.outstandingAmount, 0)), detail: late.length ? `${late.length} claims need a follow-up` : 'No overdue payments', icon: ReceiptText, target: 'overdue' as View },
        { label: 'Received to date', value: formatCurrency(paid), detail: 'Payments across all claims', icon: ArrowDownLeft, target: null },
      ].map((card) => {
        const content = <><div className="flex items-center justify-between"><span className={cn('text-xs font-bold uppercase tracking-wider', card.primary ? 'text-white/80' : 'text-[var(--ref-on-surface-variant)]')}>{card.label}</span><card.icon className={cn('h-5 w-5', card.primary ? 'text-white/80' : 'text-[var(--ref-secondary)]')} /></div><p className="mt-5 break-words text-xl font-extrabold sm:text-2xl tracking-tight tabular-nums">{summaryValue(card.value)}</p><div className={cn('mt-3 flex items-center justify-between text-xs', card.primary ? 'text-white/80' : 'text-[var(--ref-on-surface-variant)]')}><span>{claimsQuery.isPending ? 'Loading summary' : card.detail}</span>{card.target && <ArrowUpRight className="h-4 w-4" />}</div></>;
        const className = cn('rounded-2xl p-4 text-left sm:p-5', card.primary ? 'bg-[var(--ref-primary-container)] text-white shadow-md' : 'border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)]');
        return card.target ? <button key={card.label} type="button" onClick={() => setView(card.target!)} className={cn(className, 'transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ref-primary)]')}>{content}</button> : <div key={card.label} className={className}>{content}</div>;
      })}
    </section>

    <section className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 sm:px-6"><div className="flex items-center gap-2"><h2 className="text-lg font-extrabold">Your claims</h2><span className="rounded-full bg-[var(--ref-surface-container-low)] px-2 py-0.5 text-xs font-semibold">{claims.length}</span></div><span className="text-xs text-[var(--ref-outline)]">Draft → Submitted → Approved → Paid</span></div>
      <div className="mt-4 flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-b border-[var(--color-border)] px-4" aria-label="Filter claims">
        {views.map((item) => <button key={item.value} type="button" aria-pressed={view === item.value} onClick={() => setView(item.value)} className={cn('flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-[var(--ref-primary)]', view === item.value ? 'border-[var(--ref-primary)] text-[var(--ref-primary)]' : 'border-transparent text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]')}>
          {item.label}<span className="rounded-md bg-[var(--ref-surface-container-low)] px-1.5 py-0.5 text-[10px] tabular-nums">{claims.filter((claim) => matchesView(claim, item.value)).length}</span>
        </button>)}
      </div>
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:px-6">
        <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[var(--ref-outline)]" /><input aria-label="Search claims" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search claims or payers…" className="w-full rounded-xl border border-[var(--color-border)] bg-transparent py-2.5 pl-9 pr-9 text-sm focus:outline-2 focus:outline-[var(--ref-primary)]" />{searchText && <button aria-label="Clear search" onClick={() => setSearchText('')} className="absolute right-2 top-2 rounded-md p-1"><X className="h-4 w-4" /></button>}</div>
        <select aria-label="Additional status filters" value={['partially_paid', 'rejected', 'written_off', 'cancelled'].includes(view) ? view : ''} onChange={(event) => setView((event.target.value || 'all') as View)} className="rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-3 py-2 text-sm"><option value="">More statuses</option><option value="partially_paid">Partially paid</option><option value="rejected">Rejected</option><option value="written_off">Written off</option><option value="cancelled">Cancelled</option></select>
        <select aria-label="Sort claims" value={sort} onChange={(event) => setSort(event.target.value)} className="rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-3 py-2 text-sm"><option value="newest">Newest first</option><option value="due">Due date first</option><option value="amount">Highest amount</option></select>
      </div>
      {claimsQuery.isError && <div role="alert" className="mx-6 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-red-500/10 p-4 text-sm text-[var(--ref-error)]"><span>Could not load claims. {claimsQuery.error.message}</span><Button size="sm" variant="secondary" onClick={() => void claimsQuery.refetch()}>Try again</Button></div>}
      {claimsQuery.isPending ? <div role="status" aria-label="Loading claims" className="space-y-4 p-6">{[1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-[var(--ref-surface-container-low)]" />)}</div> : !claimsQuery.isError && filtered.length === 0 ? <div className="flex flex-col items-center px-6 py-16 text-center"><div className="mb-4 rounded-2xl bg-[var(--ref-surface-container-low)] p-4"><ReceiptText className="h-7 w-7 text-[var(--ref-primary)]" /></div><h3 className="text-lg font-bold">{claims.length ? 'No matching claims' : 'Your next payback starts here'}</h3><p className="mt-2 max-w-sm text-sm text-[var(--ref-on-surface-variant)]">{claims.length ? 'Try another status or search term to find your claim.' : 'Link an expense, choose who owes you, and track it all the way to payment.'}</p><Button className="mt-5" variant={claims.length ? 'secondary' : 'primary'} onClick={claims.length ? () => { setView('all'); setSearchText(''); } : newClaim}>{claims.length ? 'Clear filters' : 'Create your first claim'}</Button></div> : <div className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
        {filtered.map((claim) => {
          const editable = ['draft', 'submitted'].includes(claim.status);
          const received = claim.receipts.filter((row) => row.receipt.status === 'posted').reduce((sum, row) => sum + row.allocation.amount, 0);
          const isExpanded = expanded === claim.id;
          const busy = action.isPending && action.variables.claim.id === claim.id;
          return <article key={claim.id} className="px-5 py-5 sm:px-6">
            <div className="flex flex-col justify-between gap-4 sm:flex-row">
              <div className="flex min-w-0 gap-3"><div className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--ref-surface-container-low)] text-sm font-bold text-[var(--ref-primary)] sm:flex">{(claim.contact?.name ?? '?').slice(0, 2).toUpperCase()}</div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="break-words font-bold">{claim.title}</h3><span className={cn('rounded-md px-2 py-1 text-[10px] font-bold', statusColors[claim.status] ?? statusColors.draft)}>{statusLabels[claim.status] ?? claim.status}</span>{overdue(claim) && <span className="rounded-md bg-red-500/10 px-2 py-1 text-[10px] font-bold text-[var(--ref-error)]">Overdue</span>}</div><p className="mt-1 text-sm text-[var(--ref-on-surface-variant)]">{claim.contact?.name ?? 'Payer unavailable'} <span className="px-1 text-[var(--ref-outline)]">·</span> Claim #{claim.id}</p><p className={cn('mt-2 text-xs', overdue(claim) ? 'text-[var(--ref-error)]' : 'text-[var(--ref-outline)]')}>{claim.dueDate ? `Due ${displayDate(claim.dueDate)}` : 'No due date'} · {claim.sources.length} linked expense{claim.sources.length === 1 ? '' : 's'}</p></div></div>
              <div className="shrink-0 sm:text-right"><p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ref-outline)]">{editable ? 'Claim amount' : claim.outstandingAmount > 0 ? 'Left to receive' : claim.status === 'settled' ? 'Received' : 'Claim amount'}</p><p className="mt-1 text-xl font-extrabold tabular-nums">{formatCurrency(editable ? claim.proposedAmount : claim.outstandingAmount > 0 ? claim.outstandingAmount : claim.status === 'settled' ? received : claim.proposedAmount)}</p>{received > 0 && claim.outstandingAmount > 0 && <p className="mt-1 text-xs text-[var(--ref-secondary)]">{formatCurrency(received)} received</p>}</div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><button type="button" aria-expanded={isExpanded} aria-controls={`claim-details-${claim.id}`} onClick={() => setExpanded(isExpanded ? null : claim.id)} className="flex items-center gap-1 rounded-lg py-2 pr-2 text-xs font-semibold text-[var(--ref-primary)]">{isExpanded ? 'Hide details' : 'View details'}<ChevronDown className={cn('h-4 w-4 transition-transform', isExpanded && 'rotate-180')} /></button><div className="flex flex-wrap gap-2">
              {editable && <Button size="sm" variant="secondary" disabled={action.isPending} onClick={() => void performAction(claim, 'cancel')} aria-label={`Cancel ${claim.title}`}><Trash2 className="mr-1.5 h-3.5 w-3.5" />Cancel claim</Button>}
              {claim.status === 'draft' && <Button size="sm" variant="secondary" disabled={action.isPending} onClick={() => void performAction(claim, 'submit')}><Send className="mr-1.5 h-3.5 w-3.5" />{busy && action.variables.kind === 'submit' ? 'Submitting…' : 'Mark submitted'}</Button>}
              {editable && <Button size="sm" disabled={action.isPending} onClick={() => void performAction(claim, 'approve')}><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />{busy && action.variables.kind === 'approve' ? 'Approving…' : 'Approve claim'}</Button>}
              {claim.outstandingAmount > 0 && <Button size="sm" onClick={() => setPayment({ claimId: claim.id })}><Wallet className="mr-1.5 h-3.5 w-3.5" />Record payment</Button>}
              {claim.status === 'settled' && <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ref-secondary)]"><Check className="h-4 w-4" />Fully reimbursed</span>}
            </div></div>
            {isExpanded && <div id={`claim-details-${claim.id}`} className="mt-3 grid gap-5 rounded-xl bg-[var(--ref-surface-container-low)] p-4 text-sm sm:grid-cols-2"><div><p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--ref-outline)]">Linked expenses</p>{claim.sources.map((source) => <Link key={source.id} to="/transactions" search={{ transactionId: String(source.sourceTransactionId) }} className="flex items-center justify-between gap-3 rounded-lg py-2 text-[var(--ref-primary)] hover:underline"><span>Transaction #{source.sourceTransactionId} ↗</span><span className="tabular-nums">{formatCurrency(source.amount)}</span></Link>)}{claim.notes && <p className="mt-3 whitespace-pre-wrap break-words text-[var(--ref-on-surface-variant)]">{claim.notes}</p>}</div><div><p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--ref-outline)]">Payment history</p>{claim.receipts.length ? claim.receipts.map((row, index) => <Link key={`${row.receipt.id}-${index}`} to="/transactions" search={{ transactionId: String(row.receipt.transactionId) }} className="flex justify-between gap-3 rounded-lg py-2 text-[var(--ref-primary)] hover:underline"><span>{displayDate(row.receipt.receiptDate)}{row.receipt.status !== 'posted' && ` · ${row.receipt.status}`} ↗</span><span className="tabular-nums">{formatCurrency(row.allocation.amount)}</span></Link>) : <p className="py-2 text-[var(--ref-on-surface-variant)]">No payments recorded yet.</p>}</div></div>}
          </article>;
        })}
        {filtered.length > 0 && <p role="status" className="px-6 py-3 text-xs text-[var(--ref-outline)]">Showing {filtered.length} of {claims.length} claims</p>}
      </div>}
    </section>
    <p className="flex items-start gap-2 text-xs leading-relaxed text-[var(--ref-outline)]"><HandCoins className="h-4 w-4 shrink-0" />Approved claims track money owed to you. Payments reduce that balance and appear in your selected cash account.</p>
    {composerOpen && <ClaimComposer initial={useSource ? search : {}} onClose={() => { setComposerOpen(false); setUseSource(false); }} onSaved={async () => { setComposerOpen(false); setUseSource(false); setView('draft'); setSearchText(''); toast.success('Draft saved', 'Your claim is ready to submit or approve.'); await refresh(); }} />}
    {payment && <PaymentDialog claims={claims} initialClaimId={payment.claimId} onClose={() => setPayment(null)} onSaved={async () => { setPayment(null); toast.success('Payment recorded', 'Your reimbursement balance has been updated.'); await refresh(); }} />}
    <ToastContainer toasts={toast.toasts} onRemove={toast.removeToast} />
  </PageContainer></RequireAuth>;
}
