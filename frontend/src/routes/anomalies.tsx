import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Search, XCircle } from 'lucide-react';
import { PageContainer } from '../components/ui/PageContainer';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { RequireAuth } from '../lib/auth';
import { api } from '../lib/api';
import { useMoneyAnomaliesQuery, useReviewMoneyAnomalyMutation, useScanMoneyAnomaliesMutation } from '../features/anomalies/queries';
import { formatCurrency, formatDate } from '../lib/utils';

export const Route = createFileRoute('/anomalies')({ component: MoneyAnomaliesPage } as any);

type Review = Awaited<ReturnType<typeof api.anomalies.money>>['reviews'][number];

function MoneyAnomaliesPage() {
  const [status, setStatus] = useState<'open' | 'resolved' | 'dismissed'>('open');
  const anomaliesQuery = useMoneyAnomaliesQuery(status);
  const scanMutation = useScanMoneyAnomaliesMutation();
  const reviewMutation = useReviewMoneyAnomalyMutation();
  const reviews = (anomaliesQuery.data?.reviews ?? []) as Review[];
  const loading = anomaliesQuery.isPending && !anomaliesQuery.data;
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteById, setNoteById] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);

  const scan = async () => {
    setScanning(true);
    setError(null);
    try {
      await scanMutation.mutateAsync();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not scan for anomalies');
    } finally {
      setScanning(false);
    }
  };

  const review = async (id: number, nextStatus: 'resolved' | 'dismissed') => {
    const reviewNote = noteById[id]?.trim() ?? '';
    if (!reviewNote) {
      setError('Add a short review note before resolving or dismissing a candidate.');
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      await reviewMutation.mutateAsync({ id, status: nextStatus, reviewNote });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update anomaly review');
    } finally {
      setBusyId(null);
    }
  };

  return <RequireAuth><PageContainer>
    <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <PageHeader subtext="Data quality" title="Money anomaly review" description="Review suspicious scale or legacy reconciliation entries without changing the ledger automatically." />
      <Button onClick={() => void scan()} isLoading={scanning} className="rounded-full"><Search className="mr-2 h-4 w-4" />Scan ledger</Button>
    </div>
    <div className="mt-6 flex flex-wrap items-center gap-2">
      {(['open', 'resolved', 'dismissed'] as const).map((value) => <button key={value} type="button" onClick={() => setStatus(value)} className={`rounded-full px-4 py-2 text-xs font-bold capitalize ${status === value ? 'bg-[var(--ref-primary)] text-white' : 'bg-[var(--ref-surface-container-low)] text-[var(--ref-on-surface-variant)]'}`}>{value}</button>)}
      <Link to="/transactions" className="ml-auto text-sm font-semibold text-[var(--ref-primary)] hover:underline">Open transactions</Link>
    </div>
    {(error || anomaliesQuery.error) && <div className="mt-5 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error ?? (anomaliesQuery.error instanceof Error ? anomaliesQuery.error.message : 'Could not load anomaly reviews')}</div>}
    {loading ? <div className="mt-6 h-40 animate-pulse rounded-2xl bg-[var(--ref-surface-container-highest)]" /> : reviews.length === 0 ? <div className="mt-6 rounded-2xl border border-dashed border-[var(--color-border)] p-10 text-center text-sm text-[var(--ref-on-surface-variant)]">No {status} anomaly candidates.</div> : <div className="mt-6 space-y-4">{reviews.map((reviewItem) => <article key={reviewItem.id} className="rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" /><span className="text-xs font-bold uppercase tracking-wider text-[var(--ref-outline)]">{reviewItem.kind === 'possible_100x_pair' ? 'Possible 100× amount' : 'Legacy reconciliation plug'}</span></div><h2 className="mt-2 font-headline text-lg font-extrabold text-[var(--ref-on-surface)]">{reviewItem.reason}</h2></div><span className="rounded-full bg-[var(--ref-surface-container-low)] px-3 py-1 text-xs font-bold capitalize">{reviewItem.status}</span></div>
      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div className="rounded-xl bg-[var(--ref-surface-container-low)] p-3"><p className="text-xs text-[var(--ref-on-surface-variant)]">Flagged transaction</p><p className="font-semibold">{reviewItem.transaction ? `#${reviewItem.transaction.id} · ${reviewItem.transaction.description}` : `#${reviewItem.transactionId}`}</p><p className="text-xs text-[var(--ref-on-surface-variant)]">{reviewItem.transaction ? formatDate(reviewItem.transaction.date) : ''} · {formatCurrency(reviewItem.detectedAmount)}</p>{reviewItem.transaction && <Link to="/transactions" search={{ transactionId: String(reviewItem.transaction.id) }} className="mt-2 inline-block text-xs font-bold text-[var(--ref-primary)] hover:underline">Review journal</Link>}</div>{reviewItem.relatedTransaction && <div className="rounded-xl bg-[var(--ref-surface-container-low)] p-3"><p className="text-xs text-[var(--ref-on-surface-variant)]">Comparison transaction</p><p className="font-semibold">#{reviewItem.relatedTransaction.id} · {reviewItem.relatedTransaction.description}</p><p className="text-xs text-[var(--ref-on-surface-variant)]">{formatDate(reviewItem.relatedTransaction.date)}</p><Link to="/transactions" search={{ transactionId: String(reviewItem.relatedTransaction.id) }} className="mt-2 inline-block text-xs font-bold text-[var(--ref-primary)] hover:underline">Review comparison</Link></div>}</div>
      {reviewItem.status === 'open' ? <><textarea value={noteById[reviewItem.id] ?? ''} onChange={(event) => setNoteById((current) => ({ ...current, [reviewItem.id]: event.target.value }))} className="mt-4 min-h-20 w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] p-3 text-sm" placeholder="What did you verify? No correction happens from this screen." /><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" onClick={() => void review(reviewItem.id, 'resolved')} isLoading={busyId === reviewItem.id}><CheckCircle2 className="mr-1 h-4 w-4" />Mark reviewed</Button><Button size="sm" variant="secondary" onClick={() => void review(reviewItem.id, 'dismissed')} disabled={busyId === reviewItem.id}><XCircle className="mr-1 h-4 w-4" />Dismiss</Button></div></> : reviewItem.reviewNote && <p className="mt-4 text-sm text-[var(--ref-on-surface-variant)]">Review note: {reviewItem.reviewNote}</p>}
    </article>)}</div>}
  </PageContainer></RequireAuth>;
}
