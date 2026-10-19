import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRightLeft, CheckSquare, Copy, FileUp, Link2Off, Square, Trash2 } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { ComboBox, type PickerOption } from '../../components/transactions/EntryPickers';
import { toast, errorMessage } from '../../components/ui/useToast';
import { cn, formatDate, formatDateTime } from '../../lib/utils';
import { categoryIcon } from '../categories/category-icon';
import { listTransactions } from '../../generated/client';
import { useCreateTransaction, useImportTransactions } from '../transactions/queries';
import {
  DATE_FORMATS, findExistingMatches, guessMapping, matchByName, pairTransfers, parseCsv, parseStatementRows, statementReference,
  type ColumnMapping, type LedgerMatchCandidate, type ParsedCsv, type TransferPair,
} from './statement-import';

type Account = { id: number; name: string; type: string; systemKey?: string | null };
type Category = { id: number; name: string; color?: string | null };
type Tag = { id: number; name: string; color: string };

type StatementSource = {
  id: string;
  /** Used for rows whose account column is blank, or for every row when the file has no account column. */
  accountId: number | null;
  fileName: string;
  csv: ParsedCsv;
  mapping: ColumnMapping;
  open: boolean;
};

type ReviewRow = {
  key: string;
  sourceId: string;
  rowNumber: number;
  dateMs: number | null;
  description: string;
  amount: number | null;
  accountId: number | null;
  accountText: string;
  /** Set when the row names a destination account: the row is a transfer out of `accountId`. */
  toAccountId: number | null;
  /** Category from the file's category column, used as the starting pick. */
  categoryId: number | null;
  categoryText: string;
  errors: string[];
};

type RowChoice = { include: boolean; categoryId: number | null; tagIds: number[] };

type StatementImportModalProps = {
  isOpen: boolean;
  onClose: () => void;
  batchId: number;
  accounts: Account[];
  categories: Category[];
  tags: Tag[];
  formatAmount: (amount: number) => string;
  onSaved: (summary: { drafts: number; transfers: number }) => void;
};

const sectionLabel = 'text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]';
const DAY_MS = 86_400_000;

/** The date, plus the time when the file gave one (a row without a time sits at midnight). */
const formatWhen = (ms: number) => {
  const date = new Date(ms);
  return date.getHours() || date.getMinutes() || date.getSeconds() ? formatDateTime(ms) : formatDate(ms);
};

let sourceCounter = 0;

/**
 * Wizard: add a transaction list (account per row) or one bank export per account, map its columns,
 * review every row, save them as drafts in the batch.
 */
export function StatementImportModal({ isOpen, onClose, batchId, accounts, categories, tags, formatAmount, onSaved }: StatementImportModalProps) {
  const [step, setStep] = useState<'sources' | 'review'>('sources');
  const [sources, setSources] = useState<StatementSource[]>([]);
  const [choices, setChoices] = useState<Record<string, RowChoice>>({});
  const [pairs, setPairs] = useState<TransferPair[]>([]);
  const [duplicates, setDuplicates] = useState<Map<string, LedgerMatchCandidate>>(new Map());
  const [draftedIds, setDraftedIds] = useState<Set<number>>(new Set());
  const [checkingLedger, setCheckingLedger] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const importMutation = useImportTransactions();
  const createMutation = useCreateTransaction();

  const walletAccounts = useMemo(() => accounts.filter((account) => account.type === 'asset' && !account.systemKey), [accounts]);
  const accountName = (id: number) => accounts.find((account) => account.id === id)?.name ?? `#${id}`;
  const categoryOptions = useMemo<PickerOption[]>(() => categories.map((category) => {
    const Icon = categoryIcon(category.name);
    return { id: String(category.id), label: category.name, leading: <Icon className="h-4 w-4" style={{ color: category.color ?? undefined }} aria-hidden /> };
  }), [categories]);
  const tagOptions = useMemo<PickerOption[]>(() => tags.map((tag) => ({ id: String(tag.id), label: tag.name, leading: <span className="block h-2.5 w-2.5 rounded-full" style={{ background: tag.color }} aria-hidden /> })), [tags]);

  const rows = useMemo<ReviewRow[]>(() => sources.flatMap((source) => parseStatementRows(source.csv.rows, source.mapping).map((row) => {
    const errors = [...row.errors];
    let accountId: number | null = source.accountId;
    if (row.accountText) {
      accountId = matchByName(walletAccounts, row.accountText)?.id ?? null;
      if (accountId == null) errors.push(`Unknown account "${row.accountText}"`);
    } else if (accountId == null) {
      errors.push('No account');
    }
    let toAccountId: number | null = null;
    if (row.toAccountText) {
      const destination = matchByName(walletAccounts, row.toAccountText);
      if (!destination) errors.push(`Unknown account "${row.toAccountText}"`);
      else if (destination.id === accountId) errors.push('Transfer to the same account');
      else toAccountId = destination.id;
    }
    return {
      key: `${source.id}:${row.rowNumber}`,
      sourceId: source.id,
      rowNumber: row.rowNumber,
      dateMs: row.dateMs,
      description: row.description,
      // A transfer row always moves money out of its own account, whatever sign the file used.
      amount: row.toAccountText && row.amount != null ? -Math.abs(row.amount) : row.amount,
      accountId,
      accountText: row.accountText,
      toAccountId,
      categoryId: row.categoryText ? matchByName(categories, row.categoryText)?.id ?? null : null,
      categoryText: row.categoryText,
      errors,
    };
  })), [sources, walletAccounts, categories]);

  const reset = () => {
    setStep('sources');
    setSources([]);
    setChoices({});
    setPairs([]);
    setDuplicates(new Map());
    setDraftedIds(new Set());
    setSelected(new Set());
  };
  const close = () => { reset(); onClose(); };

  const addFile = async (file: File) => {
    const text = await file.text();
    const csv = parseCsv(text);
    if (csv.rows.length === 0) {
      toast.error('Nothing to import', 'The file has no data rows.');
      return;
    }
    sourceCounter += 1;
    setSources((current) => [...current, {
      id: `s${sourceCounter}`,
      accountId: walletAccounts.length === 1 ? walletAccounts[0]!.id : null,
      fileName: file.name,
      csv,
      mapping: guessMapping(csv.headers),
      open: true,
    }]);
  };

  const updateSource = (id: string, patch: Partial<StatementSource>) => setSources((current) => current.map((source) => (source.id === id ? { ...source, ...patch } : source)));
  const updateMapping = (id: string, patch: Partial<ColumnMapping>) => setSources((current) => current.map((source) => (source.id === id ? { ...source, mapping: { ...source.mapping, ...patch } } : source)));

  const readyToReview = sources.length > 0 && sources.every((source) => source.accountId != null || source.mapping.account != null);

  /** Every transaction touching the account in the window, posted or already drafted in this batch. */
  const readExisting = async (accountId: number, startDate: string, endDate: string, filter: { status: 'posted' } | { status: 'draft'; batchId: string }) => {
    const found: LedgerMatchCandidate[] = [];
    for (let offset = 0; ; offset += 100) {
      const response = await listTransactions({ periodId: 'all', accountId: String(accountId), startDate, endDate, limit: '100', offset: String(offset), ...filter });
      if (response.status !== 200) throw new Error('Could not read existing transactions');
      for (const transaction of response.data.data) {
        found.push({
          id: transaction.id,
          dateMs: typeof transaction.date === 'number' ? transaction.date : new Date(transaction.date as string).getTime(),
          amount: (transaction.lines ?? []).filter((line) => line.accountId === accountId).reduce((sum, line) => sum + line.debit - line.credit, 0),
          description: transaction.description,
        });
      }
      if (!response.data.pagination.hasMore) return found;
    }
  };

  /** Entering review: ask the ledger what it already has, pair transfers, and default the choices. */
  const goToReview = async () => {
    setCheckingLedger(true);
    try {
      const byAccount = new Map<number, ReviewRow[]>();
      for (const row of rows) {
        if (row.accountId != null) byAccount.set(row.accountId, [...(byAccount.get(row.accountId) ?? []), row]);
      }
      const found = new Map<string, LedgerMatchCandidate>();
      const drafted = new Set<number>();
      for (const [accountId, accountRows] of byAccount) {
        const dates = accountRows.map((row) => row.dateMs).filter((value): value is number => value != null);
        if (dates.length === 0) continue;
        const startDate = new Date(Math.min(...dates) - 2 * DAY_MS).toISOString();
        const endDate = new Date(Math.max(...dates) + 2 * DAY_MS).toISOString();
        const posted = await readExisting(accountId, startDate, endDate, { status: 'posted' });
        // Drafts already in this batch count too, so importing the same file twice does not double it.
        const drafts = await readExisting(accountId, startDate, endDate, { status: 'draft', batchId: String(batchId) });
        for (const draft of drafts) drafted.add(draft.id);
        for (const [key, match] of findExistingMatches(accountRows, [...posted, ...drafts])) found.set(key, match);
      }
      setDuplicates(found);
      setDraftedIds(drafted);
      // Rows that already name their destination are transfers on their own; only the rest look for a partner.
      const pairable = rows.flatMap((row) => (row.errors.length === 0 && row.accountId != null && row.toAccountId == null && !found.has(row.key) ? [{ ...row, accountId: row.accountId }] : []));
      setPairs(pairTransfers(pairable));
      // Coming back from the column step keeps the categories and tags already picked.
      setChoices((current) => Object.fromEntries(rows.map((row) => [row.key, {
        categoryId: current[row.key]?.categoryId ?? row.categoryId,
        tagIds: current[row.key]?.tagIds ?? [],
        include: row.errors.length === 0 && !found.has(row.key),
      }])));
      setSelected(new Set());
      setStep('review');
    } catch (error) {
      toast.error('Could not prepare the review', errorMessage(error));
    } finally {
      setCheckingLedger(false);
    }
  };

  const pairOf = (key: string) => pairs.find((pair) => pair.outKey === key || pair.inKey === key);
  const rowByKey = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows]);
  const choice = (key: string): RowChoice => choices[key] ?? { include: false, categoryId: null, tagIds: [] };
  const setChoice = (keys: string[], patch: Partial<RowChoice>) => setChoices((current) => {
    const next = { ...current };
    for (const key of keys) next[key] = { ...choice(key), ...current[key], ...patch };
    return next;
  });
  const addTag = (keys: string[], tagId: number) => setChoices((current) => {
    const next = { ...current };
    for (const key of keys) {
      const existing = current[key] ?? choice(key);
      next[key] = { ...existing, tagIds: existing.tagIds.includes(tagId) ? existing.tagIds : [...existing.tagIds, tagId] };
    }
    return next;
  });
  const toggleSelected = (key: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const plan = useMemo(() => {
    const included = rows.filter((row) => choice(row.key).include && row.errors.length === 0 && row.accountId != null);
    const pairedTransfers = pairs.filter((pair) => choice(pair.outKey).include && choice(pair.inKey).include && rowByKey.has(pair.outKey) && rowByKey.has(pair.inKey));
    const inActivePair = new Set(pairedTransfers.flatMap((pair) => [pair.outKey, pair.inKey]));
    const directTransfers = included.filter((row) => row.toAccountId != null);
    const singles = included.filter((row) => row.toAccountId == null && !inActivePair.has(row.key));
    return {
      pairedTransfers,
      directTransfers,
      inActivePair,
      transferCount: pairedTransfers.length + directTransfers.length,
      expenses: singles.filter((row) => (row.amount ?? 0) < 0),
      incomes: singles.filter((row) => (row.amount ?? 0) > 0),
      skippedDuplicates: rows.filter((row) => duplicates.has(row.key) && !choice(row.key).include).length,
      broken: rows.filter((row) => row.errors.length > 0).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, choices, pairs, duplicates, rowByKey]);
  const draftTotal = plan.expenses.length + plan.incomes.length + plan.transferCount;

  const save = async () => {
    setSaving(true);
    try {
      let transfersSaved = 0;
      const saveTransfer = async (input: { dateMs: number; amount: number; from: number; to: number; description: string; notes: string | null; tagIds: number[] }) => {
        await createMutation.mutateAsync({
          kind: 'transfer',
          amountCents: Math.abs(input.amount),
          description: input.description,
          notes: input.notes,
          date: new Date(input.dateMs).toISOString(),
          walletAccountId: input.from,
          toWalletAccountId: input.to,
          tagIds: input.tagIds.length ? input.tagIds : undefined,
          status: 'draft',
          batchId,
        });
        transfersSaved += 1;
      };
      for (const pair of plan.pairedTransfers) {
        const out = rowByKey.get(pair.outKey)!;
        const incoming = rowByKey.get(pair.inKey)!;
        await saveTransfer({
          dateMs: out.dateMs!,
          amount: out.amount!,
          from: out.accountId!,
          to: incoming.accountId!,
          description: out.description,
          notes: incoming.description !== out.description ? `Statement: ${out.description} / ${incoming.description}` : null,
          tagIds: [...new Set([...choice(pair.outKey).tagIds, ...choice(pair.inKey).tagIds])],
        });
      }
      for (const row of plan.directTransfers) {
        await saveTransfer({ dateMs: row.dateMs!, amount: row.amount!, from: row.accountId!, to: row.toAccountId!, description: row.description, notes: null, tagIds: choice(row.key).tagIds });
      }
      const singles = [...plan.expenses, ...plan.incomes];
      let draftsSaved = 0;
      for (let start = 0; start < singles.length; start += 500) {
        const chunk = singles.slice(start, start + 500);
        const result = await importMutation.mutateAsync({
          asDraft: true,
          batchId,
          rows: chunk.map((row) => ({
            date: new Date(row.dateMs!).toISOString(),
            description: row.description,
            amount: Math.abs(row.amount!),
            type: row.amount! < 0 ? 'expense' as const : 'income' as const,
            accountId: row.accountId!,
            categoryId: row.amount! < 0 ? choice(row.key).categoryId : null,
            tagIds: choice(row.key).tagIds.length ? choice(row.key).tagIds : undefined,
            reference: statementReference(row.accountId!, row.dateMs!, row.amount!, row.description),
          })),
        });
        draftsSaved += result.imported;
      }
      onSaved({ drafts: draftsSaved, transfers: transfersSaved });
      reset();
    } catch (error) {
      toast.error('Could not save the drafts', errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const bulkKeys = [...selected].filter((key) => rowByKey.has(key));

  return (
    <Modal isOpen={isOpen} onClose={close} title={step === 'sources' ? 'Import transactions' : 'Review rows'} size="xl" className="max-w-6xl">
      {step === 'sources' ? (
        <div className="space-y-5">
          <p className="text-sm text-[var(--ref-on-surface-variant)]">
            Add one list with an account column, or one bank export per account. Rows become drafts in this batch, so nothing touches a balance until you post.
          </p>

          <input ref={fileInput} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void addFile(file); event.target.value = ''; }} />
          <button type="button" onClick={() => fileInput.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--color-border-strong)] p-4 text-sm font-semibold text-[var(--ref-primary)] hover:bg-[var(--ref-primary)]/5">
            <FileUp className="h-4 w-4" aria-hidden />{sources.length === 0 ? 'Choose a CSV file' : 'Add another file'}
          </button>

          {sources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              accounts={walletAccounts}
              formatAmount={formatAmount}
              onChange={(patch) => updateSource(source.id, patch)}
              onMapping={(patch) => updateMapping(source.id, patch)}
              onRemove={() => setSources((current) => current.filter((item) => item.id !== source.id))}
            />
          ))}

          <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] pt-4">
            <p className="text-xs text-[var(--ref-on-surface-variant)]">{rows.length > 0 ? `${rows.length} rows across ${sources.length} file${sources.length === 1 ? '' : 's'}` : 'No files yet.'}</p>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
              <Button type="button" disabled={!readyToReview || checkingLedger} onClick={() => void goToReview()}>{checkingLedger ? 'Checking the ledger…' : 'Review rows'}</Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[var(--ref-on-surface-variant)]">
            <span><strong className="text-[var(--ref-on-surface)]">{plan.expenses.length}</strong> expenses</span>
            <span><strong className="text-[var(--ref-on-surface)]">{plan.incomes.length}</strong> income</span>
            <span><strong className="text-[var(--ref-on-surface)]">{plan.transferCount}</strong> transfers</span>
            {plan.skippedDuplicates > 0 && <span><strong className="text-[var(--ref-on-surface)]">{plan.skippedDuplicates}</strong> already recorded, skipped</span>}
            {plan.broken > 0 && <span className="text-[var(--color-warning)]"><strong>{plan.broken}</strong> unreadable</span>}
          </div>

          {bulkKeys.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-[var(--ref-surface-container-low)] px-3 py-2 text-xs">
              <span className="font-semibold text-[var(--ref-on-surface)]">{bulkKeys.length} selected</span>
              <div className="w-48">
                <ComboBox value="" options={categoryOptions} onChange={(id) => setChoice(bulkKeys, { categoryId: Number(id) })} placeholder="Set category" searchPlaceholder="Search categories" />
              </div>
              <div className="w-44">
                <ComboBox value="" options={tagOptions} onChange={(id) => addTag(bulkKeys, Number(id))} placeholder="Add tag" searchPlaceholder="Search tags" />
              </div>
              <button type="button" className="rounded-full border border-[var(--color-border)] px-3 py-1 font-semibold" onClick={() => setChoice(bulkKeys, { include: true })}>Include</button>
              <button type="button" className="rounded-full border border-[var(--color-border)] px-3 py-1 font-semibold" onClick={() => setChoice(bulkKeys, { include: false })}>Exclude</button>
              <button type="button" className="ml-auto text-[var(--ref-on-surface-variant)] hover:underline" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          )}

          <div className="max-h-[55vh] overflow-auto rounded-2xl border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[var(--ref-surface-container-low)] text-left text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]">
                <tr>
                  <th className="w-8 px-2 py-2"><button type="button" aria-label="Select all" onClick={() => setSelected(selected.size === rows.length ? new Set() : new Set(rows.map((row) => row.key)))}>{selected.size === rows.length && rows.length > 0 ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}</button></th>
                  <th className="w-8 px-1 py-2">In</th>
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Account</th>
                  <th className="px-2 py-2">Description</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                  <th className="px-2 py-2">Category</th>
                  <th className="px-2 py-2">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {rows.map((row) => {
                  const current = choice(row.key);
                  const pair = pairOf(row.key);
                  const counterpart = pair ? rowByKey.get(pair.outKey === row.key ? pair.inKey : pair.outKey) : undefined;
                  const duplicate = duplicates.get(row.key);
                  const broken = row.errors.length > 0;
                  const isTransfer = row.toAccountId != null || plan.inActivePair.has(row.key);
                  const unknownCategory = row.categoryText && row.categoryId == null && (row.amount ?? 0) < 0 && !isTransfer;
                  const rowTags = current.tagIds.map((id) => tags.find((tag) => tag.id === id)?.name).filter(Boolean);
                  return (
                    <tr key={row.key} className={cn(!current.include && 'opacity-55', broken && 'bg-[var(--color-warning)]/6')}>
                      <td className="px-2 py-1.5 align-top"><button type="button" aria-label={`Select row ${row.rowNumber}`} onClick={() => toggleSelected(row.key)} className="text-[var(--ref-on-surface-variant)]">{selected.has(row.key) ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}</button></td>
                      <td className="px-1 py-1.5 align-top"><input type="checkbox" aria-label={`Include row ${row.rowNumber}`} checked={current.include} disabled={broken} onChange={(event) => setChoice([row.key], { include: event.target.checked })} /></td>
                      <td className="whitespace-nowrap px-2 py-1.5 align-top tabular-nums text-[var(--ref-on-surface-variant)]">{row.dateMs != null ? formatWhen(row.dateMs) : '—'}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 align-top">
                        {row.accountId != null ? accountName(row.accountId) : row.accountText || '—'}
                        {row.toAccountId != null && <span className="text-[var(--ref-on-surface-variant)]"> → {accountName(row.toAccountId)}</span>}
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        <input value={row.description} onChange={(event) => setSources((currentSources) => currentSources.map((source) => {
                          if (source.id !== row.sourceId) return source;
                          const cells = source.csv.rows.map((cells, index) => (index + 2 === row.rowNumber && source.mapping.description != null ? cells.map((cell, column) => (column === source.mapping.description ? event.target.value : column === source.mapping.detail ? '' : cell)) : cells));
                          return { ...source, csv: { ...source.csv, rows: cells } };
                        }))} className="w-full min-w-48 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[var(--ref-on-surface)] hover:border-[var(--color-border)] focus:border-[var(--ref-primary)] focus:outline-none" />
                        {rowTags.length > 0 && <span className="block px-1 text-[11px] text-[var(--ref-on-surface-variant)]">{rowTags.join(', ')}</span>}
                      </td>
                      <td className={cn('whitespace-nowrap px-2 py-1.5 text-right align-top font-semibold tabular-nums', (row.amount ?? 0) > 0 ? 'text-[var(--color-success)]' : 'text-[var(--ref-on-surface)]')}>{row.amount == null ? '—' : `${row.amount < 0 ? '−' : '+'}${formatAmount(Math.abs(row.amount))}`}</td>
                      <td className="px-2 py-1.5 align-top">
                        {(row.amount ?? 0) < 0 && !isTransfer ? (
                          <div className="w-44"><ComboBox value={current.categoryId ? String(current.categoryId) : ''} options={categoryOptions} onChange={(id) => setChoice([row.key], { categoryId: Number(id) })} placeholder="Category" searchPlaceholder="Search categories" /></div>
                        ) : <span className="text-xs text-[var(--ref-outline)]">—</span>}
                      </td>
                      <td className="px-2 py-1.5 align-top text-xs">
                        {broken && <span className="flex items-center gap-1 text-[var(--color-warning)]"><AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />{row.errors.join('; ')}</span>}
                        {duplicate && (
                          <span className="flex items-center gap-1 text-[var(--ref-on-surface-variant)]">
                            <Copy className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            {draftedIds.has(duplicate.id) ? 'Already in this batch' : 'Already recorded'} as “{duplicate.description}”
                          </span>
                        )}
                        {unknownCategory && <span className="flex items-center gap-1 text-[var(--ref-on-surface-variant)]"><AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />No category named “{row.categoryText}”</span>}
                        {row.toAccountId != null && !broken && (
                          <span className="flex items-center gap-1 text-[var(--color-accent)]"><ArrowRightLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />Transfer to {accountName(row.toAccountId)}</span>
                        )}
                        {counterpart && counterpart.accountId != null && (
                          <span className="flex items-center gap-1 text-[var(--color-accent)]">
                            <ArrowRightLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            Transfer {pair!.outKey === row.key ? 'to' : 'from'} {accountName(counterpart.accountId)}
                            <button type="button" title="Keep as two separate rows" aria-label="Unpair transfer" onClick={() => setPairs((currentPairs) => currentPairs.filter((item) => item !== pair))} className="ml-1 text-[var(--ref-outline)] hover:text-[var(--ref-error)]"><Link2Off className="h-3.5 w-3.5" aria-hidden /></button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] pt-4">
            <Button type="button" variant="secondary" onClick={() => setStep('sources')}>Back</Button>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
              <Button type="button" disabled={saving || draftTotal === 0} onClick={() => void save()}>
                {saving ? 'Saving…' : `Save ${draftTotal} drafts`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function SourceCard({ source, accounts, formatAmount, onChange, onMapping, onRemove }: {
  source: StatementSource;
  accounts: Account[];
  formatAmount: (amount: number) => string;
  onChange: (patch: Partial<StatementSource>) => void;
  onMapping: (patch: Partial<ColumnMapping>) => void;
  onRemove: () => void;
}) {
  const columns = source.csv.headers.map((header, index) => ({ value: String(index), label: header || `Column ${index + 1}` }));
  const columnOptions = [{ value: '', label: '—' }, ...columns];
  const columnValue = (index: number | null) => (index == null ? '' : String(index));
  const parsed = useMemo(() => parseStatementRows(source.csv.rows, source.mapping), [source.csv.rows, source.mapping]);
  const unreadable = parsed.filter((row) => row.errors.length > 0).length;
  const preview = parsed.slice(0, 5);
  const toColumn = (value: string) => (value === '' ? null : Number(value));
  const perRowAccount = source.mapping.account != null;

  return (
    <div className="rounded-2xl border border-[var(--color-border)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-[var(--ref-on-surface)]">{source.fileName}</p>
          <p className="text-xs text-[var(--ref-on-surface-variant)]">{source.csv.rows.length} rows{unreadable > 0 ? ` · ${unreadable} unreadable with this mapping` : ' · all rows read'}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-52">
            <Select
              aria-label={perRowAccount ? 'Account for rows without one' : 'Account'}
              value={source.accountId == null ? '' : String(source.accountId)}
              onChange={(event) => onChange({ accountId: event.target.value ? Number(event.target.value) : null })}
              options={[{ value: '', label: perRowAccount ? 'Account from the column' : 'Account…' }, ...accounts.map((account) => ({ value: String(account.id), label: perRowAccount ? `Blank rows: ${account.name}` : account.name }))]}
            />
          </div>
          <button type="button" onClick={() => onChange({ open: !source.open })} className="text-xs font-semibold text-[var(--ref-primary)] hover:underline">{source.open ? 'Hide mapping' : 'Mapping'}</button>
          <button type="button" onClick={onRemove} aria-label="Remove file" className="grid h-8 w-8 place-items-center rounded-lg text-[var(--ref-outline)] hover:bg-[var(--ref-error)]/10 hover:text-[var(--ref-error)]"><Trash2 className="h-4 w-4" aria-hidden /></button>
        </div>
      </div>

      {source.open && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="space-y-3">
            <p className={sectionLabel}>Columns</p>
            <div className="grid grid-cols-2 gap-2">
              <Select label="Date" value={columnValue(source.mapping.date)} onChange={(event) => onMapping({ date: toColumn(event.target.value) })} options={columnOptions} />
              <Select label="Time (if separate)" value={columnValue(source.mapping.time)} onChange={(event) => onMapping({ time: toColumn(event.target.value) })} options={columnOptions} />
              <Select label="Date format" value={source.mapping.dateFormat} onChange={(event) => onMapping({ dateFormat: event.target.value as ColumnMapping['dateFormat'] })} options={DATE_FORMATS.map((format) => ({ value: format, label: format }))} />
              <Select label="Description" value={columnValue(source.mapping.description)} onChange={(event) => onMapping({ description: toColumn(event.target.value) })} options={columnOptions} />
              <Select label="Extra detail" value={columnValue(source.mapping.detail)} onChange={(event) => onMapping({ detail: toColumn(event.target.value) })} options={columnOptions} />
              <Select label="Account" value={columnValue(source.mapping.account)} onChange={(event) => onMapping({ account: toColumn(event.target.value) })} options={columnOptions} />
              <Select label="To account (transfers)" value={columnValue(source.mapping.toAccount)} onChange={(event) => onMapping({ toAccount: toColumn(event.target.value) })} options={columnOptions} />
              <Select label="Category" value={columnValue(source.mapping.category)} onChange={(event) => onMapping({ category: toColumn(event.target.value) })} options={columnOptions} />
              <Select label="Type (expense / income)" value={columnValue(source.mapping.type)} onChange={(event) => onMapping({ type: toColumn(event.target.value) })} options={columnOptions} />
            </div>
            <div className="flex gap-2 text-xs">
              {(['split', 'signed'] as const).map((mode) => (
                <button key={mode} type="button" onClick={() => onMapping({ amountMode: mode })} className={cn('rounded-full border px-3 py-1 font-semibold', source.mapping.amountMode === mode ? 'border-[var(--ref-primary)] bg-[var(--ref-primary)]/10 text-[var(--ref-primary)]' : 'border-[var(--color-border)] text-[var(--ref-on-surface-variant)]')}>
                  {mode === 'split' ? 'Debit & credit columns' : 'One signed amount'}
                </button>
              ))}
            </div>
            {source.mapping.amountMode === 'split' ? (
              <div className="grid grid-cols-2 gap-2">
                <Select label="Money out (debit)" value={columnValue(source.mapping.debit)} onChange={(event) => onMapping({ debit: toColumn(event.target.value) })} options={columnOptions} />
                <Select label="Money in (credit)" value={columnValue(source.mapping.credit)} onChange={(event) => onMapping({ credit: toColumn(event.target.value) })} options={columnOptions} />
              </div>
            ) : (
              <div className="grid grid-cols-2 items-end gap-2">
                <Select label="Amount" value={columnValue(source.mapping.amount)} onChange={(event) => onMapping({ amount: toColumn(event.target.value) })} options={columnOptions} />
                <label className="flex h-10 items-center gap-2 text-xs text-[var(--ref-on-surface-variant)]"><input type="checkbox" checked={source.mapping.negateSigned} onChange={(event) => onMapping({ negateSigned: event.target.checked })} />Money out is written as positive</label>
              </div>
            )}
          </div>
          <div>
            <p className={sectionLabel}>Preview</p>
            <table className="mt-2 w-full text-xs">
              <tbody className="divide-y divide-[var(--color-border)]">
                {preview.map((row) => (
                  <tr key={row.rowNumber} className={cn(row.errors.length > 0 && 'text-[var(--color-warning)]')}>
                    <td className="whitespace-nowrap py-1.5 pr-2 tabular-nums">{row.dateMs != null ? formatWhen(row.dateMs) : row.errors[0]}</td>
                    {perRowAccount && <td className="whitespace-nowrap py-1.5 pr-2">{row.accountText || '—'}{row.toAccountText && ` → ${row.toAccountText}`}</td>}
                    <td className="max-w-56 truncate py-1.5 pr-2">{row.description || '—'}</td>
                    <td className="whitespace-nowrap py-1.5 text-right tabular-nums">{row.amount == null ? '—' : `${row.amount < 0 ? '−' : '+'}${formatAmount(Math.abs(row.amount))}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {unreadable > 0 && <p className="mt-2 text-xs text-[var(--color-warning)]">{unreadable} row{unreadable === 1 ? '' : 's'} will be skipped unless the mapping is fixed.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
