import { useMemo, useState } from 'react';
import { ArrowRightLeft, ArrowUpDown, BadgeDollarSign, Receipt, Search, Tag, Trash2, X } from 'lucide-react';
import { cn, formatDate, formatDateTime } from '../../lib/utils';
import { MenuSelect } from '../../components/ui/MenuSelect';
import { ComboBox, type PickerOption } from '../../components/transactions/EntryPickers';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { toast, errorMessage } from '../../components/ui/useToast';
import { useBulkDeleteTransactions, useUpdateTransaction } from '../transactions/queries';
import { categoryIcon } from '../categories/category-icon';
import type { ListTransactions200DataItem } from '../../generated/client';
import {
  EMPTY_FILTERS, SORT_LABELS, activeFilterCount, draftMonths, draftTotals, filterDrafts, groupDrafts, needsCategory, sortDrafts, toDraftView,
  type DraftFilters, type DraftKind, type DraftSort, type DraftView,
} from './draft-list';

type DraftRow = ListTransactions200DataItem;
type Named = { id: number; name: string; color?: string | null; type?: string };

const KIND_CHIPS: Array<{ kind: DraftKind; label: string }> = [
  { kind: 'expense', label: 'Expenses' },
  { kind: 'income', label: 'Income' },
  { kind: 'salary', label: 'Salary' },
  { kind: 'transfer', label: 'Transfers' },
];

const pill = 'rounded-full border border-[var(--color-border)]';
/** A picker trigger styled like the menu pills next to it. */
const filterPill = 'inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold text-[var(--ref-on-surface)] transition-colors hover:bg-[var(--ref-surface-container-low)]';
const SORT_KEY = 'fainens.backfill.sort';

function readSort(): DraftSort {
  try {
    const stored = localStorage.getItem(SORT_KEY);
    return stored && stored in SORT_LABELS ? stored as DraftSort : 'date-asc';
  } catch {
    return 'date-asc';
  }
}

const when = (ms: number) => {
  const date = new Date(ms);
  return date.getHours() || date.getMinutes() ? formatDateTime(ms) : formatDate(ms);
};

/** Runs `task` over `items`, a few at a time, reporting progress; returns the failures. */
async function runInBatches<T>(items: T[], task: (item: T) => Promise<unknown>, onProgress: (done: number) => void): Promise<Array<{ item: T; error: unknown }>> {
  const failures: Array<{ item: T; error: unknown }> = [];
  let done = 0;
  for (let start = 0; start < items.length; start += 6) {
    await Promise.all(items.slice(start, start + 6).map(async (item) => {
      try { await task(item); } catch (error) { failures.push({ item, error }); }
      done += 1;
      onProgress(done);
    }));
  }
  return failures;
}

type DraftListProps = {
  drafts: DraftRow[];
  loading: boolean;
  editable: boolean;
  accounts: Named[];
  categories: Named[];
  tags: Named[];
  formatAmount: (amount: number) => string;
  onOpen: (row: DraftRow) => void;
  onDelete: (row: DraftRow) => void;
  /** Called after a bulk change so the page reloads the batch. */
  onChanged: () => Promise<void> | void;
};

/** The batch's drafts with search, filters, sorting, month groups and bulk changes. */
export function DraftList({ drafts, loading, editable, accounts, categories, tags, formatAmount, onOpen, onDelete, onChanged }: DraftListProps) {
  const { confirm } = useConfirm();
  const updateMutation = useUpdateTransaction();
  const bulkDelete = useBulkDeleteTransactions();
  const [filters, setFilters] = useState<DraftFilters>(EMPTY_FILTERS);
  const [sort, setSortState] = useState<DraftSort>(readSort);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);

  const setSort = (next: DraftSort) => {
    setSortState(next);
    try { localStorage.setItem(SORT_KEY, next); } catch { /* the choice just isn't remembered */ }
  };
  const patch = (next: Partial<DraftFilters>) => setFilters((current) => ({ ...current, ...next }));

  const accountTypes = useMemo(() => new Map(accounts.map((account) => [account.id, account.type ?? ''])), [accounts]);
  const nameOf = (list: Named[]) => (id: number) => list.find((item) => item.id === id)?.name ?? '';
  const names = { account: nameOf(accounts), category: nameOf(categories), tag: nameOf(tags) };

  const views = useMemo(() => drafts.map((row) => toDraftView(row, accountTypes)), [drafts, accountTypes]);
  const visible = useMemo(
    () => sortDrafts(filterDrafts(views, filters, names), sort),
    // `names` is rebuilt each render from the lists below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [views, filters, sort, accounts, categories, tags],
  );
  const groups = useMemo(() => groupDrafts(visible, sort), [visible, sort]);
  const visibleTotals = draftTotals(visible);
  const months = useMemo(() => draftMonths(views), [views]);
  const uncategorized = views.filter(needsCategory).length;
  const kindCounts = useMemo(() => {
    const counts = new Map<DraftKind, number>();
    for (const view of views) counts.set(view.kind, (counts.get(view.kind) ?? 0) + 1);
    return counts;
  }, [views]);
  const filterCount = activeFilterCount(filters);

  const walletAccounts = accounts.filter((account) => views.some((view) => view.walletIds.includes(account.id)));
  const categoryOptions = useMemo<PickerOption[]>(() => categories.map((category) => {
    const Icon = categoryIcon(category.name);
    return { id: String(category.id), label: category.name, leading: <Icon className="h-4 w-4" style={{ color: category.color ?? undefined }} aria-hidden /> };
  }), [categories]);
  const tagOptions = useMemo<PickerOption[]>(() => tags.map((tag) => ({ id: String(tag.id), label: tag.name, leading: <span className="block h-2.5 w-2.5 rounded-full" style={{ background: tag.color ?? undefined }} aria-hidden /> })), [tags]);

  const selectedViews = views.filter((view) => selected.has(view.id));
  const allVisibleSelected = visible.length > 0 && visible.every((view) => selected.has(view.id));
  const toggle = (id: number) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAllVisible = () => setSelected((current) => {
    const next = new Set(current);
    for (const view of visible) {
      if (allVisibleSelected) next.delete(view.id); else next.add(view.id);
    }
    return next;
  });

  const finish = async (label: string, total: number, failures: Array<{ error: unknown }>) => {
    setProgress(null);
    await onChanged();
    if (failures.length === 0) toast.success(`${label}: ${total} draft${total === 1 ? '' : 's'}`);
    else toast.error(`${label}: ${total - failures.length} of ${total} done`, errorMessage(failures[0]!.error));
  };

  const bulkCategory = async (categoryId: number) => {
    // A category belongs on a plain expense; fees keep the transfer-fee category they were saved with.
    const targets = selectedViews.filter((view) => view.kind === 'expense' && !view.isFee);
    const skipped = selectedViews.length - targets.length;
    if (targets.length === 0) { toast.info('Only expenses take a category', 'None of the selected drafts is an expense.'); return; }
    setProgress({ label: 'Setting category', done: 0, total: targets.length });
    const failures = await runInBatches(targets, (view) => updateMutation.mutateAsync({ id: view.id, data: { categoryId } }), (done) => setProgress({ label: 'Setting category', done, total: targets.length }));
    await finish(`Category set${skipped > 0 ? ` (${skipped} non-expense skipped)` : ''}`, targets.length, failures);
  };

  const bulkTag = async (tagId: number) => {
    const targets = selectedViews.filter((view) => !view.tagIds.includes(tagId));
    if (targets.length === 0) { toast.info('Already tagged', 'Every selected draft has that tag.'); return; }
    setProgress({ label: 'Adding tag', done: 0, total: targets.length });
    const failures = await runInBatches(targets, (view) => updateMutation.mutateAsync({ id: view.id, data: { tagIds: [...view.tagIds, tagId] } }), (done) => setProgress({ label: 'Adding tag', done, total: targets.length }));
    await finish('Tag added', targets.length, failures);
  };

  const bulkDeleteSelected = async () => {
    const ids = selectedViews.map((view) => view.id);
    const ok = await confirm({
      title: `Delete ${ids.length} draft${ids.length === 1 ? '' : 's'}?`,
      message: 'They have not touched any balance. A transfer takes its fee draft with it.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    const chunks: number[][] = [];
    for (let start = 0; start < ids.length; start += 100) chunks.push(ids.slice(start, start + 100));
    setProgress({ label: 'Deleting', done: 0, total: ids.length });
    let done = 0;
    const failures: Array<{ error: unknown }> = [];
    for (const chunk of chunks) {
      try { await bulkDelete.mutateAsync(chunk); } catch (error) { failures.push({ error }); }
      done += chunk.length;
      setProgress({ label: 'Deleting', done, total: ids.length });
    }
    setSelected(new Set());
    await finish('Deleted', ids.length, failures);
  };

  if (loading) return <p className="mt-3 text-sm text-[var(--ref-on-surface-variant)]">Loading…</p>;
  if (drafts.length === 0) return null;

  return (
    <div className="mt-3 space-y-3">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className={cn(pill, 'flex min-w-56 flex-1 items-center gap-2 px-3 py-1.5 focus-within:border-[var(--ref-primary)]')}>
            <Search className="h-4 w-4 shrink-0 text-[var(--ref-outline)]" aria-hidden />
            <input
              value={filters.search}
              onChange={(event) => patch({ search: event.target.value })}
              placeholder="Search description, notes, place, account, tag or amount"
              aria-label="Search drafts"
              className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ref-on-surface)] outline-none placeholder:text-[var(--ref-outline)]"
            />
            {filters.search && <button type="button" aria-label="Clear search" onClick={() => patch({ search: '' })} className="text-[var(--ref-outline)] hover:text-[var(--ref-on-surface)]"><X className="h-3.5 w-3.5" /></button>}
          </label>
          <MenuSelect
            ariaLabel="Sort drafts"
            value={sort}
            onChange={setSort}
            align="right"
            className={pill}
            icon={<ArrowUpDown className="h-3.5 w-3.5 text-[var(--ref-on-surface-variant)]" aria-hidden />}
            options={(Object.keys(SORT_LABELS) as DraftSort[]).map((value) => ({ value, label: SORT_LABELS[value] }))}
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {KIND_CHIPS.filter((chip) => kindCounts.get(chip.kind)).map((chip) => {
            const active = filters.kinds.includes(chip.kind);
            return (
              <button
                key={chip.kind}
                type="button"
                aria-pressed={active}
                onClick={() => patch({ kinds: active ? filters.kinds.filter((kind) => kind !== chip.kind) : [...filters.kinds, chip.kind] })}
                className={cn('rounded-full border px-3 py-1 text-xs font-semibold transition-colors', active ? 'border-[var(--ref-primary)] bg-[var(--ref-primary)]/10 text-[var(--ref-primary)]' : 'border-[var(--color-border)] text-[var(--ref-on-surface-variant)] hover:text-[var(--ref-on-surface)]')}
              >
                {chip.label} <span className="tabular-nums opacity-70">{kindCounts.get(chip.kind)}</span>
              </button>
            );
          })}
          <span className="mx-1 h-4 w-px bg-[var(--color-border)]" aria-hidden />
          <MenuSelect
            ariaLabel="Filter by account"
            value={filters.accountId == null ? 'any' : String(filters.accountId)}
            onChange={(value) => patch({ accountId: value === 'any' ? null : Number(value) })}
            className={cn(pill, filters.accountId != null && 'border-[var(--ref-primary)]')}
            options={[{ value: 'any', label: 'Any account' }, ...walletAccounts.map((account) => ({ value: String(account.id), label: account.name }))]}
          />
          <ComboBox
            value={filters.category == null ? 'any' : String(filters.category)}
            options={[{ id: 'any', label: 'Any category' }, { id: 'none', label: 'Needs a category' }, ...categoryOptions]}
            onChange={(id) => patch({ category: id === 'any' ? null : id === 'none' ? 'none' : Number(id) })}
            placeholder="Any category"
            searchPlaceholder="Search categories"
            triggerContent={<span>{filters.category == null ? 'Any category' : filters.category === 'none' ? 'Needs a category' : names.category(filters.category)}</span>}
            triggerClassName={cn(filterPill, filters.category != null && 'border-[var(--ref-primary)]')}
          />
          <ComboBox
            value={filters.tag == null ? 'any' : String(filters.tag)}
            options={[{ id: 'any', label: 'Any tag' }, { id: 'none', label: 'No tags' }, ...tagOptions]}
            onChange={(id) => patch({ tag: id === 'any' ? null : id === 'none' ? 'none' : Number(id) })}
            placeholder="Any tag"
            searchPlaceholder="Search tags"
            triggerContent={<span>{filters.tag == null ? 'Any tag' : filters.tag === 'none' ? 'No tags' : names.tag(filters.tag)}</span>}
            triggerClassName={cn(filterPill, filters.tag != null && 'border-[var(--ref-primary)]')}
          />
          {months.length > 1 && (
            <MenuSelect
              ariaLabel="Filter by month"
              value={filters.month ?? 'any'}
              onChange={(value) => patch({ month: value === 'any' ? null : value })}
              className={cn(pill, filters.month != null && 'border-[var(--ref-primary)]')}
              options={[{ value: 'any', label: 'Any month' }, ...months.map((month) => ({ value: month.key, label: `${month.label} · ${month.count}` }))]}
            />
          )}
          {filterCount > 0 && (
            <button type="button" onClick={() => setFilters(EMPTY_FILTERS)} className="ml-1 text-xs font-semibold text-[var(--ref-primary)] hover:underline">Clear filters</button>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ref-on-surface-variant)]">
          <p>
            {filterCount > 0 ? <>Showing <strong className="text-[var(--ref-on-surface)]">{visible.length}</strong> of {views.length}</> : <><strong className="text-[var(--ref-on-surface)]">{views.length}</strong> drafts</>}
            {' · '}in <span className="font-semibold text-[var(--color-success)]">+{formatAmount(visibleTotals.moneyIn)}</span>
            {' · '}out <span className="font-semibold text-[var(--ref-on-surface)]">−{formatAmount(visibleTotals.moneyOut)}</span>
          </p>
          {uncategorized > 0 && filters.category !== 'none' && (
            <button type="button" onClick={() => patch({ category: 'none' })} className="font-semibold text-[var(--color-warning)] hover:underline">
              {uncategorized} expense{uncategorized === 1 ? '' : 's'} need a category
            </button>
          )}
        </div>
      </div>

      {editable && (selected.size > 0 || progress) && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2 text-xs shadow-sm">
          {progress ? (
            <span className="font-semibold text-[var(--ref-on-surface)]">{progress.label}… {progress.done}/{progress.total}</span>
          ) : (
            <>
              <span className="font-semibold text-[var(--ref-on-surface)]">{selected.size} selected</span>
              <div className="w-44"><ComboBox value="" options={categoryOptions} onChange={(id) => void bulkCategory(Number(id))} placeholder="Set category" searchPlaceholder="Search categories" /></div>
              <div className="w-40"><ComboBox value="" options={tagOptions} onChange={(id) => void bulkTag(Number(id))} placeholder="Add tag" searchPlaceholder="Search tags" /></div>
              <button type="button" onClick={() => void bulkDeleteSelected()} className="inline-flex items-center gap-1 rounded-full border border-[var(--ref-error)]/40 px-3 py-1 font-semibold text-[var(--ref-error)] hover:bg-[var(--ref-error)]/10"><Trash2 className="h-3.5 w-3.5" aria-hidden />Delete</button>
              <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-[var(--ref-on-surface-variant)] hover:underline">Clear selection</button>
            </>
          )}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--ref-on-surface-variant)]">No drafts match these filters.</p>
      ) : (
        <div>
          {editable && (
            <label className="flex items-center gap-2 px-2 pb-1 text-xs text-[var(--ref-on-surface-variant)]">
              <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} />
              Select {filterCount > 0 ? 'all shown' : 'all'} ({visible.length})
            </label>
          )}
          {groups.map((group) => (
            <section key={group.key} aria-label={group.label || 'Drafts'}>
              {group.label && (
                <div className="sticky top-0 z-10 -mx-2 flex items-baseline justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-2 pb-1.5 pt-4">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-[var(--ref-outline)]">{group.label} <span className="font-semibold normal-case tracking-normal">· {group.rows.length}</span></h4>
                  <span className="text-xs tabular-nums text-[var(--ref-on-surface-variant)]">
                    <span className="text-[var(--color-success)]">+{formatAmount(group.moneyIn)}</span> · −{formatAmount(group.moneyOut)}
                  </span>
                </div>
              )}
              <ul className="-mx-2 divide-y divide-[var(--color-border)]">
                {group.rows.map((view) => (
                  <DraftListRow
                    key={view.id}
                    view={view}
                    editable={editable}
                    selected={selected.has(view.id)}
                    onToggle={() => toggle(view.id)}
                    onOpen={() => onOpen(view.row)}
                    onDelete={() => onDelete(view.row)}
                    accountName={names.account}
                    formatAmount={formatAmount}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function DraftListRow({ view, editable, selected, onToggle, onOpen, onDelete, accountName, formatAmount }: {
  view: DraftView<DraftRow>;
  editable: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onDelete: () => void;
  accountName: (id: number) => string;
  formatAmount: (amount: number) => string;
}) {
  const { row, kind, amount } = view;
  const categories = (row.categoryAllocations ?? []).map((allocation) => allocation.categoryName ?? '').filter(Boolean);
  const tagNames = (row.tags ?? []).map((tag) => tag.name);
  const wallets = view.walletIds.map(accountName);
  const missingCategory = needsCategory(view);
  return (
    <li className={cn('group/row flex items-center gap-3 px-2 py-2.5 transition-colors hover:bg-[var(--ref-surface-container-low)]', selected && 'bg-[var(--ref-primary)]/6')}>
      {editable && <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${row.description}`} className="shrink-0" />}
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="w-24 shrink-0 text-xs tabular-nums text-[var(--ref-on-surface-variant)]">{when(view.dateMs)}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-[var(--ref-on-surface)]">{row.description}</span>
            {kind === 'salary' && <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[var(--color-success)]/12 px-1.5 py-0.5 text-[10px] font-bold text-[var(--color-success)]"><BadgeDollarSign className="h-3 w-3" aria-hidden />Salary</span>}
            {view.isFee && <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[var(--ref-surface-container-high)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--ref-on-surface-variant)]"><Receipt className="h-3 w-3" aria-hidden />Fee</span>}
          </span>
          <span className="block truncate text-xs text-[var(--ref-on-surface-variant)]">
            {kind === 'transfer' ? <span className="inline-flex items-center gap-1"><ArrowRightLeft className="h-3 w-3" aria-hidden />{wallets.join(' → ')}</span> : wallets.join(', ')}
            {categories.length > 0 && ` · ${categories.join(', ')}`}
            {missingCategory && <span className="text-[var(--color-warning)]"> · No category</span>}
            {row.place && ` · ${row.place}`}
            {tagNames.length > 0 && <span className="inline-flex items-center gap-0.5"> · <Tag className="h-3 w-3" aria-hidden />{tagNames.join(', ')}</span>}
          </span>
        </span>
        <span className={cn('shrink-0 text-sm font-bold tabular-nums', kind === 'expense' ? 'text-[var(--ref-on-surface)]' : kind === 'income' || kind === 'salary' ? 'text-[var(--color-success)]' : 'text-[var(--ref-on-surface-variant)]')}>
          {kind === 'expense' ? '−' : kind === 'income' || kind === 'salary' ? '+' : ''}{formatAmount(Math.abs(amount))}
        </span>
      </button>
      {editable && (
        <button type="button" onClick={onDelete} aria-label={`Delete draft ${row.description}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--ref-outline)] opacity-0 transition-opacity hover:bg-[var(--ref-error)]/10 hover:text-[var(--ref-error)] focus-visible:opacity-100 group-hover/row:opacity-100">
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      )}
    </li>
  );
}
