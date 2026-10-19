import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { AlertTriangle, Lock } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { toast, errorMessage } from '../../components/ui/useToast';
import { cn, formatDate, snapshotTimestampForLocalDate, toLocalDateInputValue } from '../../lib/utils';
import { getTransactionBatchBalanceAt } from '../../generated/client';
import { unwrapGenerated } from '../core/generated-response';
import { queryKeys } from '../core/query-keys';
import { parseStatementAmount } from './statement-import';
import { useBatchSettlementQuery, usePostBatchMutation, type BatchDetail, type PostBatchResult, type SettlementAccount, type SettlementInput } from './queries';

type Mode = 'leave' | 'keep_current' | 'match';
type Choice = { mode: Mode; date: string; balance: string };

const MODES: Array<{ value: Mode; label: string }> = [
  { value: 'leave', label: 'Let it move' },
  { value: 'keep_current', label: "Keep today's" },
  { value: 'match', label: 'Match a balance' },
];

const adjustmentLabel: Record<string, string> = {
  opening_balance: 'Opening balance',
  adjustment: 'Reconciled',
  recovery: 'Recovery',
};

/**
 * The default for an account: if it was reconciled (or opened) after the backfilled months, that
 * adjustment most likely absorbed them already, so keep today's balance and offset on that date.
 */
function defaultChoice(account: SettlementAccount): Choice {
  // Adjustments come newest first; the one closest after the drafts is the likeliest catch-up.
  const absorbing = account.adjustments.filter((adjustment) => adjustment.asOfDate >= account.lastDraftDate).at(-1);
  if (absorbing) return { mode: 'keep_current', date: toLocalDateInputValue(new Date(absorbing.asOfDate)), balance: '' };
  return { mode: 'leave', date: toLocalDateInputValue(new Date(account.lastDraftDate)), balance: '' };
}

type SettlementModalProps = {
  isOpen: boolean;
  onClose: () => void;
  batch: BatchDetail;
  draftCount: number;
  formatAmount: (amount: number) => string;
  onPosted: (result: PostBatchResult) => void;
};

/** Before a batch posts: per account, what posting does to the balance and how to square it up. */
export function SettlementModal({ isOpen, onClose, batch, draftCount, formatAmount, onPosted }: SettlementModalProps) {
  const settlementQuery = useBatchSettlementQuery(batch.id, isOpen);
  const postBatch = usePostBatchMutation();
  const [edits, setEdits] = useState<Record<number, Choice>>({});
  const accounts = useMemo(() => settlementQuery.data?.accounts ?? [], [settlementQuery.data]);
  const choiceOf = (account: SettlementAccount): Choice => edits[account.accountId] ?? defaultChoice(account);
  const update = (account: SettlementAccount, patch: Partial<Choice>) => setEdits((current) => ({ ...current, [account.accountId]: { ...choiceOf(account), ...patch } }));

  // "Today" in a date field means now; fixed when the dialog opens so the balance lookups stay stable.
  const [now] = useState(() => Date.now());
  const queryDates = accounts.map((account) => {
    const choice = choiceOf(account);
    return choice.mode === 'match' ? snapshotTimestampForLocalDate(choice.date, now) : null;
  });
  const balanceQueries = useQueries({
    queries: accounts.map((account, index) => ({
      queryKey: [...queryKeys.transactions.batch(batch.id), 'balance-at', account.accountId, queryDates[index]],
      queryFn: ({ signal }: { signal: AbortSignal }) => unwrapGenerated(getTransactionBatchBalanceAt(batch.id, { accountId: account.accountId, asOfDate: queryDates[index]! }, { signal }), 200, 'Failed to read the balance'),
      enabled: isOpen && queryDates[index] != null,
    })),
  });

  const rows = accounts.map((account, index) => {
    const choice = choiceOf(account);
    const afterLeave = account.currentBalance + account.batchDelta;
    if (choice.mode === 'leave') return { account, choice, after: afterLeave, adjustment: 0, settlement: null as SettlementInput | null, ready: true };
    const asOfDate = snapshotTimestampForLocalDate(choice.date, now);
    if (choice.mode === 'keep_current') {
      return {
        account, choice, after: account.currentBalance, adjustment: -account.batchDelta,
        settlement: asOfDate == null ? null : { accountId: account.accountId, mode: 'keep_current' as const, asOfDate },
        ready: asOfDate != null,
      };
    }
    const actual = parseStatementAmount(choice.balance);
    const at = balanceQueries[index]?.data;
    const expected = at ? at.postedBalance + at.draftDelta : null;
    const adjustment = actual != null && expected != null ? actual - expected : 0;
    return {
      account, choice, after: afterLeave + adjustment, adjustment, expected, actual,
      settlement: asOfDate == null || actual == null ? null : { accountId: account.accountId, mode: 'match' as const, asOfDate, actualBalance: actual },
      ready: asOfDate != null && actual != null && expected != null,
    };
  });

  const todayTotal = accounts.reduce((sum, account) => sum + account.currentBalance, 0);
  const afterTotal = rows.reduce((sum, row) => sum + row.after, 0);
  const adjustments = rows.filter((row) => row.settlement && row.adjustment !== 0).length;
  const closed = batch.periods.filter((period) => period.status === 'closed');
  const ready = settlementQuery.isSuccess && rows.every((row) => row.ready);

  const close = () => { setEdits({}); onClose(); };

  const post = async () => {
    try {
      const settlements = rows.flatMap((row) => (row.settlement ? [row.settlement] : []));
      const result = await postBatch.mutateAsync({ id: batch.id, input: { settlements } });
      setEdits({});
      onPosted(result);
    } catch (error) {
      toast.error('Could not post batch', errorMessage(error));
    }
  };

  const signed = (amount: number) => `${amount < 0 ? '−' : '+'}${formatAmount(Math.abs(amount))}`;

  return (
    <Modal isOpen={isOpen} onClose={close} title="Settle and post" size="xl" className="max-w-4xl">
      <div className="space-y-5">
        <p className="text-sm text-[var(--ref-on-surface-variant)]">
          Posting adds these months to each account. If today&apos;s balance was already right, keep it and the difference is booked as a balance adjustment on the date you pick. If you have a statement, match its balance instead.
        </p>

        {settlementQuery.isLoading ? (
          <p className="text-sm text-[var(--ref-on-surface-variant)]">Reading balances…</p>
        ) : settlementQuery.isError ? (
          <p className="text-sm text-[var(--ref-error)]">Could not read the balances. Close and try again.</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => {
              const { account, choice } = row;
              return (
                <li key={account.accountId} className="rounded-2xl border border-[var(--color-border)] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-[var(--ref-on-surface)]">{account.accountName}</p>
                      <p className="text-xs text-[var(--ref-on-surface-variant)]">
                        {account.draftCount} draft{account.draftCount === 1 ? '' : 's'} · {formatDate(account.firstDraftDate)} to {formatDate(account.lastDraftDate)}
                      </p>
                    </div>
                    <dl className="grid grid-cols-3 gap-x-5 text-right text-xs">
                      <dt className="text-[var(--ref-outline)]">Today</dt>
                      <dt className="text-[var(--ref-outline)]">Batch</dt>
                      <dt className="text-[var(--ref-outline)]">After</dt>
                      <dd className="font-semibold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(account.currentBalance)}</dd>
                      <dd className={cn('font-semibold tabular-nums', account.batchDelta < 0 ? 'text-[var(--ref-error)]' : 'text-[var(--color-success)]')}>{signed(account.batchDelta)}</dd>
                      <dd className="font-bold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(row.after)}</dd>
                    </dl>
                  </div>

                  <div
                    role="radiogroup"
                    aria-label={`How to settle ${account.accountName}`}
                    className="ui-segmented ui-segmented--3 mt-3 inline-grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-[var(--ref-surface-container)] p-1"
                    data-segment-index={MODES.findIndex((mode) => mode.value === choice.mode)}
                  >
                    {MODES.map((mode) => (
                      <button
                        key={mode.value}
                        type="button"
                        role="radio"
                        aria-checked={choice.mode === mode.value}
                        onClick={() => update(account, { mode: mode.value })}
                        className={cn('h-8 rounded-lg px-3 text-xs font-semibold', choice.mode === mode.value ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]')}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>

                  {choice.mode === 'leave' && (
                    <p className="mt-2 text-xs text-[var(--ref-on-surface-variant)]">The balance moves by {signed(account.batchDelta)}. Right when these transactions are missing from today&apos;s balance.</p>
                  )}

                  {choice.mode === 'keep_current' && (
                    <div className="mt-3 space-y-2">
                      <div className="flex flex-wrap items-end gap-3">
                        <div className="w-44"><Input label="Adjust on" type="date" value={choice.date} max={toLocalDateInputValue()} onChange={(event) => update(account, { date: event.target.value })} /></div>
                        <p className="pb-2 text-xs text-[var(--ref-on-surface-variant)]">Adjustment {signed(row.adjustment)}. Balances from this date on stay as they are today.</p>
                      </div>
                      {account.adjustments.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          <span className="text-[var(--ref-outline)]">Earlier adjustments:</span>
                          {account.adjustments.map((adjustment) => (
                            <button
                              key={adjustment.sessionId}
                              type="button"
                              onClick={() => update(account, { date: toLocalDateInputValue(new Date(adjustment.asOfDate)) })}
                              title="Book the offset on this date"
                              className="rounded-full border border-[var(--color-border)] px-2.5 py-0.5 font-semibold text-[var(--ref-on-surface)] hover:border-[var(--ref-primary)]"
                            >
                              {adjustmentLabel[adjustment.kind] ?? 'Adjusted'} {formatDate(adjustment.asOfDate)} · {signed(adjustment.difference)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {choice.mode === 'match' && (
                    <div className="mt-3 flex flex-wrap items-end gap-3">
                      <div className="w-44"><Input label="Balance on" type="date" value={choice.date} max={toLocalDateInputValue()} onChange={(event) => update(account, { date: event.target.value })} /></div>
                      <div className="w-48"><Input label="Statement balance" inputMode="decimal" placeholder="e.g. 4.250.000" value={choice.balance} onChange={(event) => update(account, { balance: event.target.value })} /></div>
                      <p className="pb-2 text-xs text-[var(--ref-on-surface-variant)]">
                        {'expected' in row && row.expected != null
                          ? <>Ledger that day after posting: <strong className="text-[var(--ref-on-surface)]">{formatAmount(row.expected)}</strong>{row.actual != null ? <>. Adjustment {signed(row.adjustment)}.</> : '.'}</>
                          : 'Reading the balance on that date…'}
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
            {rows.length === 0 && <li className="text-sm text-[var(--ref-on-surface-variant)]">These drafts do not touch any wallet or card, so there is nothing to settle.</li>}
          </ul>
        )}

        {rows.length > 1 && (
          <div className="flex items-center justify-between rounded-2xl bg-[var(--ref-surface-container-low)] px-4 py-3 text-sm">
            <span className="font-semibold text-[var(--ref-on-surface)]">These accounts together</span>
            <span className="tabular-nums text-[var(--ref-on-surface-variant)]">
              {formatAmount(todayTotal)} today → <strong className="text-[var(--ref-on-surface)]">{formatAmount(afterTotal)}</strong>
              {afterTotal !== todayTotal && <span className={cn('ml-2 font-semibold', afterTotal < todayTotal ? 'text-[var(--ref-error)]' : 'text-[var(--color-success)]')}>{signed(afterTotal - todayTotal)}</span>}
            </span>
          </div>
        )}

        {closed.length > 0 && (
          <p className="flex items-start gap-2 text-xs text-[var(--ref-on-surface-variant)]">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-warning)]" aria-hidden />
            {closed.map((period) => period.periodName).join(', ')} {closed.length === 1 ? 'is' : 'are'} closed. Posting reopens {closed.length === 1 ? 'it' : 'them'} and closes {closed.length === 1 ? 'it' : 'them'} again in the same step.
          </p>
        )}
        {settlementQuery.isSuccess && !ready && (
          <p className="flex items-center gap-2 text-xs text-[var(--color-warning)]"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />Fill in a date and balance for every account you match.</p>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-4">
          <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
          <Button type="button" disabled={!ready || postBatch.isPending} onClick={() => void post()}>
            {postBatch.isPending ? 'Posting…' : `Post ${draftCount} draft${draftCount === 1 ? '' : 's'}${adjustments > 0 ? ` + ${adjustments} adjustment${adjustments === 1 ? '' : 's'}` : ''}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
