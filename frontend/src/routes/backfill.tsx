import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRightLeft, CheckCircle2, FileUp, Lock, Plus, Trash2, Upload } from 'lucide-react';
import { useBalanceVisibility } from '../hooks/useBalanceVisibility';
import { RequireAuth } from '../lib/auth';
import { cn, formatDate } from '../lib/utils';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { PageContainer } from '../components/ui/PageContainer';
import { PageHeader } from '../components/ui/PageHeader';
import { useConfirm } from '../components/ui/ConfirmDialog';
import { toast, errorMessage } from '../components/ui/useToast';
import { TransactionModal, type EditingTransaction } from '../components/transactions/TransactionModal';
import { ImportCSVModal } from '../components/transactions/ImportCSVModal';
import { useAccountsQuery } from '../features/accounts/queries';
import { useCategoriesQuery, useTagsQuery } from '../features/categories/queries';
import { useDeleteTransaction, useTransactionList } from '../features/transactions/queries';
import { useBatchesQuery, useBatchQuery, useCreateBatchMutation, useDiscardBatchMutation, usePostBatchMutation, type BatchSummary, type PostBatchResult } from '../features/backfill/queries';
import type { ListTransactions200DataItem } from '../generated/client';

export const Route = createFileRoute('/backfill')({
  validateSearch: (search: Record<string, unknown>): { batchId?: string } => ({
    batchId: typeof search.batchId === 'string' && /^\d+$/.test(search.batchId) ? search.batchId : undefined,
  }),
  component: BackfillPage,
});

type DraftRow = ListTransactions200DataItem;

const statusTone: Record<string, string> = {
  open: 'bg-[var(--color-accent)]/12 text-[var(--color-accent)]',
  posted: 'bg-[var(--color-success)]/12 text-[var(--color-success)]',
  discarded: 'bg-[var(--ref-surface-container-high)] text-[var(--ref-on-surface-variant)]',
};

const card = 'rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] editorial-shadow';

/** The amount a draft moves, signed from the wallet's point of view: out is negative, in is positive. */
function draftAmount(row: DraftRow, accountTypes: Map<number, string>): { amount: number; kind: 'expense' | 'income' | 'transfer' | 'journal' } {
  const lines = row.lines ?? [];
  const assetLines = lines.filter((line) => accountTypes.get(line.accountId) === 'asset');
  if (row.txType === 'simple_transfer' || (assetLines.length === 2 && lines.length === 2)) {
    return { amount: Math.max(...lines.map((line) => Math.max(line.debit, line.credit))), kind: 'transfer' };
  }
  const net = assetLines.reduce((sum, line) => sum + line.debit - line.credit, 0);
  if (row.txType === 'simple_expense' || net < 0) return { amount: net, kind: 'expense' };
  if (row.txType === 'simple_income' || net > 0) return { amount: net, kind: 'income' };
  return { amount: Math.max(...lines.map((line) => Math.max(line.debit, line.credit)), 0), kind: 'journal' };
}

function BackfillPage() {
  const { formatAmount } = useBalanceVisibility();
  const navigate = useNavigate({ from: '/backfill' });
  const search = useSearch({ from: '/backfill' });
  const { confirm } = useConfirm();
  const batchesQuery = useBatchesQuery();
  const accountsQuery = useAccountsQuery();
  const categoriesQuery = useCategoriesQuery();
  const tagsQuery = useTagsQuery();
  const createBatch = useCreateBatchMutation();
  const postBatch = usePostBatchMutation();
  const discardBatch = useDiscardBatchMutation();
  const deleteTransaction = useDeleteTransaction();

  const batches = batchesQuery.data ?? [];
  const selectedId = search.batchId ? Number(search.batchId) : batches.find((batch) => batch.status === 'open')?.id ?? batches[0]?.id ?? null;
  const batchQuery = useBatchQuery(selectedId);
  const batch = batchQuery.data ?? null;
  const draftsQuery = useTransactionList(selectedId ? { periodId: 'all', status: 'draft', batchId: String(selectedId), limit: '1000', sort: 'oldest' } : {});
  const drafts = useMemo(() => (selectedId ? draftsQuery.data?.data ?? [] : []), [selectedId, draftsQuery.data]);
  const accounts = accountsQuery.data ?? [];
  const accountTypes = useMemo(() => new Map(accounts.map((account) => [account.id, account.type])), [accounts]);
  const accountName = (id: number) => accounts.find((account) => account.id === id)?.name ?? `#${id}`;

  const [newBatchOpen, setNewBatchOpen] = useState(false);
  const [newBatchName, setNewBatchName] = useState('');
  const [editing, setEditing] = useState<EditingTransaction | null>(null);
  const [draftModalOpen, setDraftModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // Kept with the batch it belongs to, so switching batches hides it without an effect.
  const [lastPostResult, setLastPostResult] = useState<(PostBatchResult & { batchId: number }) | null>(null);
  const lastPost = lastPostResult && lastPostResult.batchId === selectedId ? lastPostResult : null;

  const selectBatch = (id: number) => navigate({ search: { batchId: String(id) } });

  const handleCreateBatch = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = newBatchName.trim();
    if (!name) return;
    try {
      const created = await createBatch.mutateAsync({ name });
      setNewBatchOpen(false);
      setNewBatchName('');
      selectBatch(created.id);
      toast.success('Batch created', name);
    } catch (error) {
      toast.error('Could not create batch', errorMessage(error));
    }
  };

  const openDraft = (row: DraftRow) => {
    setEditing({
      id: row.id,
      date: typeof row.date === 'number' ? row.date : new Date(row.date as string).getTime(),
      description: row.description,
      reference: row.reference ?? undefined,
      notes: row.notes ?? undefined,
      place: row.place ?? undefined,
      categoryId: row.categoryId ?? null,
      txType: row.txType,
      status: row.status,
      batchId: row.batchId ?? null,
      lines: (row.lines ?? []).map((line) => ({ ...line, accountType: accountTypes.get(line.accountId) })) as EditingTransaction['lines'],
      categoryAllocations: row.categoryAllocations ?? [],
      tags: (row.tags ?? []) as EditingTransaction['tags'],
    });
    setDraftModalOpen(true);
  };

  const refresh = async () => {
    await Promise.all([draftsQuery.refetch(), batchQuery.refetch(), batchesQuery.refetch()]);
  };

  const handlePost = async () => {
    if (!batch || drafts.length === 0) return;
    const closed = batch.periods.filter((period) => period.status === 'closed');
    const ok = await confirm({
      title: `Post ${drafts.length} draft${drafts.length === 1 ? '' : 's'}?`,
      message: closed.length > 0
        ? `${closed.map((period) => period.periodName).join(', ')} ${closed.length === 1 ? 'is' : 'are'} closed. The period${closed.length === 1 ? '' : 's'} will be reopened for the posting and closed again straight after. Balances change by the amounts shown above.`
        : 'The drafts become ordinary posted transactions and balances change by the amounts shown above.',
      confirmLabel: 'Post batch',
    });
    if (!ok) return;
    try {
      const result = await postBatch.mutateAsync({ id: batch.id });
      setLastPostResult({ ...result, batchId: batch.id });
      await refresh();
      if (result.failed.length === 0) toast.success(`Posted ${result.posted.length} draft${result.posted.length === 1 ? '' : 's'}`);
      else toast.info(`Posted ${result.posted.length}, ${result.failed.length} need attention`);
    } catch (error) {
      toast.error('Could not post batch', errorMessage(error));
    }
  };

  const handleDiscard = async () => {
    if (!batch) return;
    const ok = await confirm({
      title: 'Discard this batch?',
      message: drafts.length > 0 ? `${drafts.length} draft${drafts.length === 1 ? '' : 's'} will be deleted. Anything already posted stays.` : 'The batch is marked discarded. Anything already posted stays.',
      confirmLabel: 'Discard batch',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await discardBatch.mutateAsync(batch.id);
      await refresh();
      toast.success('Batch discarded');
    } catch (error) {
      toast.error('Could not discard batch', errorMessage(error));
    }
  };

  const handleDeleteDraft = async (row: DraftRow) => {
    const ok = await confirm({ title: 'Delete draft', message: 'This draft has not affected balances. Delete it?', confirmLabel: 'Delete', variant: 'danger' });
    if (!ok) return;
    try {
      await deleteTransaction.mutateAsync(row.id);
      await refresh();
      toast.success('Draft deleted');
    } catch (error) {
      toast.error('Could not delete draft', errorMessage(error));
    }
  };

  const isOpenBatch = batch?.status === 'open';

  return (
    <RequireAuth>
      <PageContainer>
        <header className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <PageHeader subtext="Transactions" title="Backfill" description="Prepare past activity as drafts, review every entry with the full form, then post the batch into the ledger at once." />
          <Button type="button" className="rounded-full px-5 py-3" onClick={() => setNewBatchOpen(true)}>
            <Plus className="h-4 w-4" />New batch
          </Button>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <section className={cn(card, 'p-4 lg:col-span-4')}>
            <h2 className="px-2 font-headline text-lg font-bold text-[var(--ref-on-surface)]">Batches</h2>
            {batchesQuery.isLoading ? (
              <p className="px-2 pt-4 text-sm text-[var(--ref-on-surface-variant)]">Loading…</p>
            ) : batches.length === 0 ? (
              <p className="px-2 pt-4 text-sm text-[var(--ref-on-surface-variant)]">No batches yet. Start one for the months you want to fill in.</p>
            ) : (
              <ul className="mt-3 space-y-1">
                {batches.map((item) => <BatchListItem key={item.id} batch={item} selected={item.id === selectedId} onSelect={() => selectBatch(item.id)} />)}
              </ul>
            )}
          </section>

          <section className={cn(card, 'p-6 lg:col-span-8')}>
            {!batch ? (
              <p className="text-sm text-[var(--ref-on-surface-variant)]">{batches.length === 0 ? 'Create a batch to begin.' : 'Pick a batch to review its drafts.'}</p>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-headline text-xl font-bold text-[var(--ref-on-surface)]">{batch.name}</h2>
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', statusTone[batch.status] ?? statusTone.discarded)}>{batch.status}</span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">
                      {batch.draftCount} draft{batch.draftCount === 1 ? '' : 's'} · {batch.postedCount} posted
                      {batch.dateRange ? ` · ${formatDate(batch.dateRange.from)} to ${formatDate(batch.dateRange.to)}` : ''}
                    </p>
                  </div>
                  {isOpenBatch && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="button" variant="secondary" className="rounded-full" onClick={() => { setEditing(null); setDraftModalOpen(true); }}><Plus className="h-4 w-4" />Add draft</Button>
                      <Button type="button" variant="secondary" className="rounded-full" onClick={() => setImportOpen(true)}><FileUp className="h-4 w-4" />Import CSV</Button>
                      <Button type="button" className="rounded-full" disabled={drafts.length === 0 || postBatch.isPending} onClick={() => void handlePost()}><Upload className="h-4 w-4" />{postBatch.isPending ? 'Posting…' : 'Post batch'}</Button>
                    </div>
                  )}
                </div>

                {(batch.accountImpact.length > 0 || batch.periods.length > 0) && (
                  <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="rounded-2xl bg-[var(--ref-surface-container-low)] p-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]">Balance impact when posted</p>
                      <ul className="mt-2 space-y-1.5">
                        {batch.accountImpact.map((impact) => (
                          <li key={impact.accountId} className="flex items-center justify-between gap-3 text-sm">
                            <span className="text-[var(--ref-on-surface)]">{impact.accountName} <span className="text-xs text-[var(--ref-on-surface-variant)]">· {impact.draftCount}</span></span>
                            <span className={cn('font-semibold tabular-nums', impact.deltaCents < 0 ? 'text-[var(--ref-error)]' : 'text-[var(--color-success)]')}>{impact.deltaCents < 0 ? '−' : '+'}{formatAmount(Math.abs(impact.deltaCents))}</span>
                          </li>
                        ))}
                        {batch.accountImpact.length === 0 && <li className="text-sm text-[var(--ref-on-surface-variant)]">Nothing left to post.</li>}
                      </ul>
                    </div>
                    <div className="rounded-2xl bg-[var(--ref-surface-container-low)] p-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]">Periods touched</p>
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {batch.periods.map((period) => (
                          <li key={period.periodId ?? 'none'} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] px-2.5 py-1 text-xs font-semibold text-[var(--ref-on-surface)]">
                            {period.status === 'closed' && <Lock className="h-3 w-3 text-[var(--color-warning)]" aria-label="Closed period" />}
                            {period.periodName ?? 'No period'} <span className="text-[var(--ref-on-surface-variant)]">· {period.draftCount}</span>
                          </li>
                        ))}
                        {batch.periods.length === 0 && <li className="text-sm text-[var(--ref-on-surface-variant)]">No drafts yet.</li>}
                      </ul>
                      {batch.periods.some((period) => period.status === 'closed') && (
                        <p className="mt-2 text-xs text-[var(--ref-on-surface-variant)]">Closed periods are reopened for the posting and closed again right after.</p>
                      )}
                    </div>
                  </div>
                )}

                {lastPost && lastPost.failed.length > 0 && (
                  <div className="mt-5 rounded-2xl border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/8 p-4">
                    <p className="flex items-center gap-2 text-sm font-bold text-[var(--ref-on-surface)]"><AlertTriangle className="h-4 w-4 text-[var(--color-warning)]" />{lastPost.failed.length} draft{lastPost.failed.length === 1 ? '' : 's'} could not be posted</p>
                    <ul className="mt-2 space-y-1 text-xs text-[var(--ref-on-surface-variant)]">
                      {lastPost.failed.map((failure) => <li key={failure.id}>Draft #{failure.id}: {failure.error}</li>)}
                    </ul>
                  </div>
                )}
                {lastPost && lastPost.failed.length === 0 && lastPost.posted.length > 0 && (
                  <p className="mt-5 flex items-center gap-2 text-sm text-[var(--color-success)]"><CheckCircle2 className="h-4 w-4" />Posted {lastPost.posted.length} draft{lastPost.posted.length === 1 ? '' : 's'}{lastPost.reopenedPeriodIds.length > 0 ? `, reopening and closing ${lastPost.reopenedPeriodIds.length} period${lastPost.reopenedPeriodIds.length === 1 ? '' : 's'} on the way` : ''}.</p>
                )}

                <div className="mt-6">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--ref-outline)]">Drafts</h3>
                  {draftsQuery.isLoading ? (
                    <p className="mt-3 text-sm text-[var(--ref-on-surface-variant)]">Loading…</p>
                  ) : drafts.length === 0 ? (
                    <p className="mt-3 text-sm text-[var(--ref-on-surface-variant)]">{batch.status === 'open' ? 'No drafts in this batch. Add one by hand or import a statement.' : 'Nothing pending in this batch.'}</p>
                  ) : (
                    <ul className="-mx-2 mt-2 divide-y divide-[var(--color-border)]">
                      {drafts.map((row) => {
                        const { amount, kind } = draftAmount(row, accountTypes);
                        const walletNames = (row.lines ?? []).filter((line) => accountTypes.get(line.accountId) === 'asset').map((line) => accountName(line.accountId));
                        const dateMs = typeof row.date === 'number' ? row.date : new Date(row.date as string).getTime();
                        return (
                          <li key={row.id} className="group/row flex items-center gap-3 px-2 py-2.5 transition-colors hover:bg-[var(--ref-surface-container-low)]">
                            <button type="button" onClick={() => openDraft(row)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                              <span className="w-20 shrink-0 text-xs tabular-nums text-[var(--ref-on-surface-variant)]">{formatDate(dateMs)}</span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-semibold text-[var(--ref-on-surface)]">{row.description}</span>
                                <span className="block truncate text-xs text-[var(--ref-on-surface-variant)]">
                                  {kind === 'transfer' ? <span className="inline-flex items-center gap-1"><ArrowRightLeft className="h-3 w-3" aria-hidden />{walletNames.join(' → ')}</span> : walletNames.join(', ')}
                                  {row.categoryAllocations && row.categoryAllocations.length > 0 ? ` · ${row.categoryAllocations.map((allocation) => allocation.categoryName ?? '').filter(Boolean).join(', ')}` : ''}
                                  {(row.tags ?? []).length > 0 ? ` · ${(row.tags ?? []).map((tag) => tag.name).join(', ')}` : ''}
                                </span>
                              </span>
                              <span className={cn('shrink-0 text-sm font-bold tabular-nums', kind === 'expense' ? 'text-[var(--ref-on-surface)]' : kind === 'income' ? 'text-[var(--color-success)]' : 'text-[var(--ref-on-surface-variant)]')}>
                                {kind === 'expense' ? '−' : kind === 'income' ? '+' : ''}{formatAmount(Math.abs(amount))}
                              </span>
                            </button>
                            {isOpenBatch && (
                              <button type="button" onClick={() => void handleDeleteDraft(row)} aria-label={`Delete draft ${row.description}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--ref-outline)] opacity-0 transition-opacity hover:bg-[var(--ref-error)]/10 hover:text-[var(--ref-error)] focus-visible:opacity-100 group-hover/row:opacity-100">
                                <Trash2 className="h-4 w-4" aria-hidden />
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {batch.status !== 'discarded' && (
                  <div className="mt-6 border-t border-[var(--color-border)] pt-4">
                    <button type="button" onClick={() => void handleDiscard()} disabled={discardBatch.isPending} className="text-xs font-semibold text-[var(--ref-error)] hover:underline disabled:opacity-50">
                      Discard batch{drafts.length > 0 ? ` and its ${drafts.length} draft${drafts.length === 1 ? '' : 's'}` : ''}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        </div>

        <Modal isOpen={newBatchOpen} onClose={() => setNewBatchOpen(false)} title="New batch" size="default">
          <form onSubmit={(event) => void handleCreateBatch(event)} className="space-y-4">
            <Input label="Name" value={newBatchName} onChange={(event) => setNewBatchName(event.target.value)} placeholder="e.g. March to June 2026" autoFocus />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setNewBatchOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={!newBatchName.trim() || createBatch.isPending}>Create</Button>
            </div>
          </form>
        </Modal>

        <TransactionModal
          isOpen={draftModalOpen}
          onClose={() => { setDraftModalOpen(false); setEditing(null); }}
          onSaved={() => void refresh()}
          accounts={accounts}
          categories={categoriesQuery.data ?? []}
          tags={tagsQuery.data ?? []}
          editingTransaction={editing}
          initialMode="edit"
          draftBatchId={editing ? null : selectedId}
        />

        <ImportCSVModal isOpen={importOpen} onClose={() => setImportOpen(false)} onSuccess={() => { setImportOpen(false); void refresh(); }} draftBatchId={selectedId} />
      </PageContainer>
    </RequireAuth>
  );
}

function BatchListItem({ batch, selected, onSelect }: { batch: BatchSummary; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'flex w-full items-start justify-between gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors',
          selected ? 'bg-[var(--ref-surface-container)]' : 'hover:bg-[var(--ref-surface-container-low)]',
        )}
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-bold text-[var(--ref-on-surface)]">{batch.name}</span>
          <span className="block text-xs text-[var(--ref-on-surface-variant)]">{batch.draftCount} draft{batch.draftCount === 1 ? '' : 's'} · {batch.postedCount} posted · {formatDate(batch.createdAt)}</span>
        </span>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', statusTone[batch.status] ?? statusTone.discarded)}>{batch.status}</span>
      </button>
    </li>
  );
}
