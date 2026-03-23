import { createFileRoute, Link } from '@tanstack/react-router';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { RequireAuth } from '../lib/auth';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { formatCurrency } from '../lib/utils';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Landmark,
  ShoppingCart,
  Wallet,
} from 'lucide-react';
import { cn } from '../lib/utils';

export const Route = createFileRoute('/paylater')({
  component: PaylaterPage,
} as any);

type ObligationRow = Awaited<ReturnType<typeof api.paylater.obligations>>['obligations'][number];
type ScheduleItem = Awaited<ReturnType<typeof api.paylater.obligations>>['scheduleItems'][number];
type ExposureRow = Awaited<ReturnType<typeof api.paylater.obligations>>['providerExposure'][number];

function monthGrid(year: number, month: number): (number | null)[] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startWeekdayMon0 = (first.getDay() + 6) % 7;
  const daysInMonth = last.getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekdayMon0; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function scheduleForDay(
  year: number,
  month: number,
  day: number,
  items: ScheduleItem[],
): ScheduleItem[] {
  return items.filter((s) => {
    const d = new Date(s.dateMs);
    return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
  });
}

function PaylaterPage() {
  const [obligationsPayload, setObligationsPayload] = useState<Awaited<
    ReturnType<typeof api.paylater.obligations>
  > | null>(null);
  const [accounts, setAccounts] = useState<
    Array<{ id: number; name: string; type: string; systemKey: string | null }>
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [calYear, setCalYear] = useState(() => new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth());

  const [payModal, setPayModal] = useState<ObligationRow | null>(null);
  const [payForm, setPayForm] = useState({
    date: new Date().toISOString().split('T')[0],
    description: '',
    amount: '',
    bankId: '',
  });

  const load = async () => {
    try {
      const [obl, acc] = await Promise.all([api.paylater.obligations(), api.accounts.list()]);
      setObligationsPayload(obl);
      setAccounts(acc as typeof accounts);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const banks = accounts.filter((a) => a.type === 'asset' && !a.systemKey);

  const scheduleItems = obligationsPayload?.scheduleItems ?? [];
  const obligations = obligationsPayload?.obligations ?? [];
  const exposure = obligationsPayload?.providerExposure ?? [];
  const totalOutstanding = obligationsPayload?.totalOutstandingCents ?? 0;

  const grid = useMemo(() => monthGrid(calYear, calMonth), [calYear, calMonth]);

  const monthLabel = useMemo(
    () =>
      new Date(calYear, calMonth, 1).toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
      }),
    [calYear, calMonth],
  );

  const shiftMonth = (delta: number) => {
    const d = new Date(calYear, calMonth + delta, 1);
    setCalYear(d.getFullYear());
    setCalMonth(d.getMonth());
  };

  const openPay = (row: ObligationRow) => {
    setPayForm({
      date: new Date().toISOString().split('T')[0],
      description: `Payment — ${row.description}`,
      amount: String(row.outstandingCents),
      bankId: banks[0]?.id.toString() ?? '',
    });
    setPayModal(row);
    setFormError('');
  };

  const handlePaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payModal) return;
    setFormError('');
    const amt = parseInt(payForm.amount, 10);
    if (!amt || amt <= 0) {
      setFormError('Enter a valid amount');
      return;
    }
    if (amt > payModal.outstandingCents) {
      setFormError('Amount cannot exceed remaining balance for this obligation.');
      return;
    }
    if (!payForm.bankId) {
      setFormError('Select a wallet to pay from');
      return;
    }
    setIsSubmitting(true);
    try {
      await api.paylater.settle({
        date: new Date(payForm.date).getTime(),
        description: payForm.description || 'Paylater payment',
        paymentAmount: amt,
        paylaterLiabilityAccountId: payModal.liabilityAccountId,
        bankAccountId: parseInt(payForm.bankId, 10),
        originalTxId: payModal.recognitionTxId,
      });
      setPayModal(null);
      await load();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <RequireAuth>
      <div className="space-y-8 pb-16">
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--ref-secondary)] mb-2">
              Liability management
            </p>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-[var(--color-text-primary)]">
              PayLater & <span className="text-[var(--ref-primary)] italic">Accruals</span>
            </h1>
            <p className="text-sm text-[var(--color-text-secondary)] mt-2 max-w-xl">
              Record installment purchases from{' '}
              <Link to="/transactions" className="font-semibold text-[var(--ref-primary)] underline">
                Transactions
              </Link>{' '}
              → <strong>Buy later</strong>. Pay down debt with <strong>Pay later</strong> or from this
              page.
            </p>
          </div>
          <div className="rounded-3xl bg-[var(--ref-surface-container-low)] border border-[var(--color-border)] p-6 flex items-center gap-4 min-w-[260px] shadow-sm">
            <div className="w-12 h-12 rounded-full bg-[var(--ref-primary-container)]/15 flex items-center justify-center">
              <Wallet className="w-6 h-6 text-[var(--ref-primary-container)]" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
                Total outstanding
              </p>
              <p className="text-2xl font-black font-headline tracking-tight">
                {formatCurrency(totalOutstanding)}
              </p>
            </div>
          </div>
        </header>

        {isLoading ? (
          <Card className="p-8 text-center">
            <p>Loading…</p>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <section className="lg:col-span-8 rounded-2xl bg-[var(--ref-surface-container-lowest)] border border-[var(--color-border)] p-4 md:p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-base font-bold text-[var(--color-text-primary)] flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-[var(--ref-primary)] shrink-0" />
                      Payment schedule
                    </h3>
                    <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{monthLabel}</p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => shiftMonth(-1)}
                      className="cursor-pointer w-8 h-8 rounded-full bg-[var(--ref-surface-container)] flex items-center justify-center hover:bg-[var(--ref-surface-container-highest)] transition-colors border border-[var(--color-border)]"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => shiftMonth(1)}
                      className="cursor-pointer w-8 h-8 rounded-full bg-[var(--ref-surface-container)] flex items-center justify-center hover:bg-[var(--ref-surface-container-highest)] transition-colors border border-[var(--color-border)]"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-7 gap-1 text-center">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                    <div
                      key={d}
                      className="text-[9px] font-bold text-[var(--ref-outline)] uppercase tracking-wide pb-1"
                    >
                      {d}
                    </div>
                  ))}
                  {grid.map((day, i) => {
                    if (day == null) {
                      return (
                        <div
                          key={`empty-${i}`}
                          className="h-11 rounded-lg bg-[var(--ref-surface-container-low)]/40"
                        />
                      );
                    }
                    const onDay = scheduleForDay(calYear, calMonth, day, scheduleItems);
                    const isToday =
                      new Date().getFullYear() === calYear &&
                      new Date().getMonth() === calMonth &&
                      new Date().getDate() === day;
                    const totalShown = onDay.reduce((s, x) => s + x.amountCents, 0);
                    return (
                      <div
                        key={day}
                        className={cn(
                          'h-11 rounded-lg border px-1 py-0.5 flex flex-col justify-start text-left overflow-hidden',
                          onDay.length
                            ? 'border-[var(--ref-outline-variant)] bg-[var(--color-surface)] shadow-sm'
                            : 'border-transparent bg-[var(--ref-surface-container-low)]/30 text-[var(--ref-outline)]',
                          isToday && 'ring-1 ring-[var(--ref-primary-container)]/50',
                        )}
                      >
                        <span
                          className={cn(
                            'text-[11px] font-semibold leading-tight',
                            onDay.length ? 'text-[var(--color-text-primary)]' : 'text-[var(--ref-outline)]',
                          )}
                        >
                          {day}
                        </span>
                        {onDay.length > 0 && (
                          <div className="space-y-0.5 mt-0.5 min-h-0">
                            {onDay.slice(0, 1).map((ev) => (
                              <div
                                key={`${ev.transactionId}-${ev.kind}`}
                                className={cn(
                                  'text-[8px] font-bold leading-tight rounded px-0.5 py-px truncate',
                                  ev.kind === 'recognition'
                                    ? 'bg-[var(--ref-secondary-container)] text-[var(--ref-on-secondary-container)]'
                                    : 'bg-[var(--ref-tertiary-container)]/20 text-[var(--ref-tertiary)]',
                                )}
                                title={ev.description}
                              >
                                {formatCurrency(ev.amountCents)}
                              </div>
                            ))}
                            {onDay.length > 1 && (
                              <span className="text-[8px] text-[var(--color-text-secondary)] leading-none">
                                +{onDay.length - 1}
                              </span>
                            )}
                          </div>
                        )}
                        {onDay.length > 2 && totalShown > 0 && (
                          <span className="text-[7px] text-[var(--color-text-secondary)] leading-none truncate">
                            Σ {formatCurrency(totalShown)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11px] text-[var(--color-text-secondary)] mt-2">
                  <span className="inline-block w-3 h-3 rounded bg-[var(--ref-secondary-container)] mr-1 align-middle" />{' '}
                  Principal / obligation
                  <span className="inline-block w-3 h-3 rounded bg-[var(--ref-tertiary)]/30 ml-3 mr-1 align-middle" />{' '}
                  Interest accrual
                </p>
              </section>

              <section className="lg:col-span-4 flex flex-col gap-6">
                <div className="rounded-3xl bg-[var(--ref-surface-container-highest)]/60 border border-[var(--color-border)] p-6 md:p-8">
                  <h3 className="text-sm font-bold text-[var(--ref-primary)] mb-4 uppercase tracking-widest">
                    Provider exposure
                  </h3>
                  {!exposure.length ? (
                    <p className="text-sm text-[var(--color-text-secondary)]">
                      No outstanding obligations. Record a purchase with{' '}
                      <strong>Transactions</strong> → <strong>Buy later</strong> to see balances here.
                    </p>
                  ) : (
                    <div className="space-y-5">
                      {exposure.map((ex: ExposureRow) => (
                        <div key={ex.liabilityAccountId} className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 bg-[var(--color-surface)] rounded-xl flex items-center justify-center shadow-sm shrink-0">
                              <ShoppingCart className="w-5 h-5 text-[var(--ref-secondary)]" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-bold truncate">{ex.liabilityAccountName}</p>
                              <p className="text-xs text-[var(--color-text-secondary)]">
                                {ex.nextDueDateMs != null && ex.daysUntilNextDue != null
                                  ? ex.daysUntilNextDue < 0
                                    ? 'Overdue'
                                    : ex.daysUntilNextDue === 0
                                      ? 'Due today'
                                      : `Due in ${ex.daysUntilNextDue} day${ex.daysUntilNextDue === 1 ? '' : 's'}`
                                  : 'No due date set'}
                              </p>
                            </div>
                          </div>
                          <p className="font-bold shrink-0">{formatCurrency(ex.totalOutstandingCents)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-3xl bg-slate-900 text-white p-6 md:p-8 relative overflow-hidden border border-slate-700">
                  <div className="relative z-10">
                    <h3 className="text-xs font-bold text-blue-200 uppercase tracking-[0.2em] mb-3">
                      Accrual snapshot
                    </h3>
                    <p className="text-xl font-extrabold mb-2 leading-tight">
                      Obligations roll up by recognition.
                    </p>
                    <p className="text-sm text-white/70 mb-4">
                      New purchases:{' '}
                      <Link
                        to="/transactions"
                        className="font-semibold text-blue-200 underline underline-offset-2 hover:text-white"
                      >
                        Transactions
                      </Link>{' '}
                      → <strong>Buy later</strong>. Payments: <strong>Pay later</strong> or below.
                    </p>
                    <Link
                      to="/transactions"
                      className="brutalist-button flex w-full justify-center px-4 py-3 text-sm font-semibold text-white border-0 hover:opacity-95 rounded-lg [background:var(--ref-primary-container)]"
                    >
                      Open transactions
                    </Link>
                  </div>
                </div>
              </section>
            </div>

            <Card
              title="Individual accruals"
              className="overflow-hidden rounded-3xl border-[var(--color-border)] shadow-sm"
            >
              {obligations.length === 0 ? (
                <p className="text-sm text-[var(--color-text-secondary)] p-4">
                  No paylater recognitions yet. Add one from{' '}
                  <Link to="/transactions" className="font-semibold text-[var(--ref-primary)] underline">
                    Transactions
                  </Link>{' '}
                  → <strong>Buy later</strong>.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[var(--ref-surface-container)]/80 border-b border-[var(--color-border)]">
                      <tr>
                        <th className="px-4 py-3 text-[10px] font-bold text-[var(--ref-outline)] uppercase tracking-widest">
                          Transaction
                        </th>
                        <th className="px-4 py-3 text-[10px] font-bold text-[var(--ref-outline)] uppercase tracking-widest">
                          Provider
                        </th>
                        <th className="px-4 py-3 text-[10px] font-bold text-[var(--ref-outline)] uppercase tracking-widest">
                          Due
                        </th>
                        <th className="px-4 py-3 text-[10px] font-bold text-[var(--ref-outline)] uppercase tracking-widest">
                          Principal
                        </th>
                        <th className="px-4 py-3 text-[10px] font-bold text-[var(--ref-outline)] uppercase tracking-widest">
                          Interest
                        </th>
                        <th className="px-4 py-3 text-[10px] font-bold text-[var(--ref-outline)] uppercase tracking-widest">
                          Remaining
                        </th>
                        <th className="px-4 py-3 text-[10px] font-bold text-[var(--ref-outline)] uppercase tracking-widest text-right">
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border)]">
                      {obligations.map((row) => (
                        <tr key={row.recognitionTxId} className="bg-[var(--color-surface)] hover:bg-[var(--ref-surface-container-low)]/60">
                          <td className="px-4 py-4">
                            <p className="font-bold">{row.description}</p>
                            <p className="text-xs text-[var(--color-text-secondary)]">
                              ID #{row.recognitionTxId} ·{' '}
                              {new Date(row.dateRecognizedMs).toLocaleDateString()}
                            </p>
                          </td>
                          <td className="px-4 py-4">
                            <span className="px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-[var(--ref-primary)]/10 text-[var(--ref-primary)]">
                              {row.liabilityAccountName}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            {row.dueDateMs ? (
                              <span
                                className={cn(
                                  'font-medium',
                                  row.status === 'overdue' && 'text-[var(--ref-error)]',
                                  row.status === 'due_soon' && 'text-[var(--color-warning)]',
                                )}
                              >
                                {new Date(row.dueDateMs).toLocaleDateString()}
                              </span>
                            ) : (
                              <span className="text-[var(--color-text-secondary)]">—</span>
                            )}
                          </td>
                          <td className="px-4 py-4 font-mono">{formatCurrency(row.principalCents)}</td>
                          <td className="px-4 py-4 font-mono">{formatCurrency(row.interestPostedCents)}</td>
                          <td className="px-4 py-4 font-mono font-bold">{formatCurrency(row.outstandingCents)}</td>
                          <td className="px-4 py-4 text-right">
                            {row.outstandingCents > 0 ? (
                              <Button size="sm" onClick={() => openPay(row)}>
                                Pay now
                              </Button>
                            ) : (
                              <span className="text-xs text-[var(--ref-secondary)] font-semibold">Paid</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}

        <Modal
          isOpen={payModal != null}
          onClose={() => setPayModal(null)}
          title="Pay obligation"
          subtitle={
            payModal ? (
              <>
                {payModal.description}{' '}
                <span className="text-[var(--color-text-secondary)]">
                  (remaining {formatCurrency(payModal.outstandingCents)})
                </span>
              </>
            ) : null
          }
        >
          <form onSubmit={handlePaySubmit} className="space-y-4">
            <Input
              label="Date"
              type="date"
              value={payForm.date}
              onChange={(e) => setPayForm({ ...payForm, date: e.target.value })}
              required
            />
            <Input
              label="Description"
              value={payForm.description}
              onChange={(e) => setPayForm({ ...payForm, description: e.target.value })}
            />
            <Input
              label="Amount (cents)"
              type="number"
              min={1}
              max={payModal?.outstandingCents}
              step={1}
              value={payForm.amount}
              onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
              required
            />
            <Select
              label="Pay from (wallet)"
              value={payForm.bankId}
              onChange={(e) => setPayForm({ ...payForm, bankId: e.target.value })}
              options={[
                { value: '', label: 'Select wallet…' },
                ...banks.map((a) => ({ value: a.id.toString(), label: a.name })),
              ]}
              required
            />
            {payModal && (
              <p className="text-xs text-[var(--color-text-secondary)]">
                Posts to liability <strong>{payModal.liabilityAccountName}</strong> and links settlement
                to recognition <strong>#{payModal.recognitionTxId}</strong>.
              </p>
            )}
            {formError && <p className="text-sm text-[var(--color-danger)]">{formError}</p>}
            <Button type="submit" isLoading={isSubmitting} className="inline-flex items-center gap-2">
              <Landmark className="w-4 h-4" />
              Record payment
            </Button>
          </form>
        </Modal>

      </div>
    </RequireAuth>
  );
}
