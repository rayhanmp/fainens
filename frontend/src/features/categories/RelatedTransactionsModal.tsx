import { useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Pencil } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { TransactionModal, type EditingTransaction, type WalletAccount } from '../../components/transactions/TransactionModal';
import { listTransactions, type ListTransactions200DataItem, type ListTransactionsParams } from '../../generated/client';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn, formatDate } from '../../lib/utils';
import { useAccountsQuery } from '../accounts/queries';
import { queryKeys } from '../core/query-keys';
import { CategoryIcon } from './CategoryIcon';
import { useCategoriesQuery, useTagsQuery } from './queries';

/** What to list: a category or a tag, optionally within a date range (inclusive, ms). */
export type RelatedSubject = {
  kind: 'category' | 'tag';
  id: number;
  name: string;
  color: string | null;
  from?: number;
  to?: number;
  /** Names the range in the subtitle, e.g. "June 2026" or "This year". */
  scope?: string;
};

const PAGE = 50;

type Row = ListTransactions200DataItem;
const toMs = (date: Row['date']) => (typeof date === 'number' ? date : new Date(date).getTime());

/**
 * The entries behind a category or tag, shown in place: opened from the lists and the charts so
 * looking at what makes up a number never leaves the page. Newest first, fifty at a time.
 */
export function RelatedTransactionsModal({ subject, categories, onClose, onEdit }: {
  subject: RelatedSubject | null;
  categories: Array<{ id: number; name: string; color: string | null }>;
  onClose: () => void;
  onEdit?: (subject: RelatedSubject) => void;
}) {
  const { formatAmount } = useBalanceVisibility();
  const queryClient = useQueryClient();
  // An entry opened from the list, shown in the usual read-only detail on top of this modal.
  const [opened, setOpened] = useState<EditingTransaction | null>(null);
  // Closing only flips this; the entry stays put so the closing animation doesn't fall back to
  // the empty "new transaction" form.
  const [detailOpen, setDetailOpen] = useState(false);
  const accountsQuery = useAccountsQuery();
  const categoriesQuery = useCategoriesQuery();
  const tagsQuery = useTagsQuery();
  const openRow = (row: Row) => { setDetailOpen(true); setOpened({
    id: row.id,
    date: toMs(row.date),
    description: row.description,
    reference: row.reference ?? undefined,
    notes: row.notes ?? undefined,
    place: row.place ?? undefined,
    categoryId: row.categoryId,
    txType: row.txType,
    status: row.status,
    batchId: row.batchId ?? null,
    expenseCents: row.expenseCents,
    incomeCents: row.incomeCents,
    lines: row.lines as EditingTransaction['lines'],
    categoryAllocations: row.categoryAllocations,
    tags: (row.tags ?? []) as EditingTransaction['tags'],
  }); };
  const filters: ListTransactionsParams = {
    periodId: 'all',
    status: 'posted',
    limit: String(PAGE),
    ...(subject?.kind === 'category' ? { categoryId: String(subject.id) } : {}),
    ...(subject?.kind === 'tag' ? { tagId: String(subject.id) } : {}),
    ...(subject?.from != null ? { startDate: new Date(subject.from).toISOString() } : {}),
    ...(subject?.to != null ? { endDate: new Date(subject.to).toISOString() } : {}),
  };
  const query = useInfiniteQuery({
    // Under the transactions key, so any edit to the ledger refreshes it.
    queryKey: ['transactions', 'related', filters],
    enabled: subject != null,
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      const response = await listTransactions({ ...filters, offset: String(pageParam) }, { signal });
      if (response.status !== 200) throw new Error('Failed to load transactions');
      return response.data;
    },
    getNextPageParam: (last, pages) => (last.pagination.hasMore ? pages.reduce((sum, page) => sum + page.data.length, 0) : undefined),
  });

  const byId = new Map(categories.map((category) => [category.id, category]));
  const rows = query.data?.pages.flatMap((page) => page.data) ?? [];
  const first = query.data?.pages[0];
  const total = first?.pagination.total ?? 0;
  const spent = first?.summary.expenseCents ?? 0;
  const earned = first?.summary.incomeCents ?? 0;

  // The amount that belongs to this category: its share of a split entry, else the whole entry.
  const amountOf = (row: Row) => {
    const share = subject?.kind === 'category' ? row.categoryAllocations?.find((item) => item.categoryId === subject.id && item.amount !== 0) : undefined;
    if (share) return { value: Math.abs(share.amount), income: false, of: Math.abs(row.expenseCents ?? 0) };
    const expense = row.expenseCents ?? 0;
    const income = row.incomeCents ?? 0;
    if (expense !== 0) return { value: Math.abs(expense), income: false, of: null };
    if (income !== 0) return { value: Math.abs(income), income: true, of: null };
    return { value: Math.max(row.debitCents ?? 0, row.creditCents ?? 0), income: false, of: null };
  };
  const categoryOf = (row: Row) => {
    const allocated = row.categoryAllocations?.filter((item) => item.amount !== 0) ?? [];
    if (allocated.length > 1) return { name: `${allocated.length} categories`, color: null, icon: allocated[0].categoryName ?? '' };
    const id = allocated[0]?.categoryId ?? row.categoryId ?? null;
    const category = id != null ? byId.get(id) : undefined;
    return category ? { name: category.name, color: category.color, icon: category.name } : null;
  };

  return (
    <>
    <Modal
      isOpen={subject != null}
      onClose={onClose}
      title={subject ? subject.name : ''}
      footer={subject && onEdit ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => onEdit(subject)}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)] hover:text-[var(--ref-on-surface)]"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit {subject.kind}
          </button>
        </div>
      ) : undefined}
    >
      {subject && (
        <div className="space-y-4">
          {/* The default-size modal has no subtitle slot, so what and when are said here. */}
          <p className="flex items-center gap-2 text-xs text-[var(--ref-on-surface-variant)]">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: subject.color ?? 'var(--ref-outline)' }} aria-hidden />
            {subject.kind === 'category' ? 'Category' : 'Tag'} · {subject.scope ?? 'All time'}
          </p>
          <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-border)] text-center">
            {[
              { label: 'Entries', value: total.toLocaleString('id-ID') },
              { label: 'Spent', value: formatAmount(spent) },
              { label: earned > 0 ? 'Received' : 'Each, on average', value: formatAmount(earned > 0 ? earned : total > 0 ? Math.round(spent / total) : 0) },
            ].map((item) => (
              <div key={item.label} className="bg-[var(--ref-surface-container-lowest)] px-3 py-2">
                <dt className="text-[11px] text-[var(--ref-on-surface-variant)]">{item.label}</dt>
                <dd className="text-sm font-semibold tabular-nums text-[var(--ref-on-surface)]">{query.isPending ? '…' : item.value}</dd>
              </div>
            ))}
          </dl>

          {/* A steady height, so the modal opens at its final size instead of growing once rows arrive. */}
          <div className="min-h-[min(60vh,520px)]">
          {query.isPending ? (
            <p className="py-8 text-center text-sm text-[var(--ref-on-surface-variant)]">Loading…</p>
          ) : query.isError ? (
            <p className="py-8 text-center text-sm text-[var(--color-danger)]">Couldn't load the entries.</p>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--ref-on-surface-variant)]">No entries {subject.scope ? `in ${subject.scope}` : 'yet'}.</p>
          ) : (
            <ul className="-mx-2 divide-y divide-[var(--color-border)]">
              {rows.map((row) => {
                const amount = amountOf(row);
                const category = categoryOf(row);
                const otherTags = (row.tags ?? []).filter((tag) => !(subject.kind === 'tag' && tag.tagId === subject.id));
                return (
                  <li key={row.id}>
                    <button type="button" onClick={() => openRow(row)} className="group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-[var(--ref-surface-container-low)] focus-visible:bg-[var(--ref-surface-container-low)] focus-visible:outline-none">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ backgroundColor: `color-mix(in srgb, ${category?.color ?? 'var(--ref-outline)'} 12%, transparent)` }}>
                      <CategoryIcon name={category?.icon ?? row.description} color={category?.color ?? null} className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--ref-on-surface)]">{row.description}</p>
                      <p className="truncate text-xs text-[var(--ref-on-surface-variant)]">
                        {formatDate(toMs(row.date))}
                        {subject.kind === 'tag' && category ? ` · ${category.name}` : ''}
                        {row.place ? ` · ${row.place}` : ''}
                        {otherTags.length > 0 ? ` · ${otherTags.map((tag) => `#${tag.name}`).join(' ')}` : ''}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={cn('text-sm font-semibold tabular-nums', amount.income ? 'text-[var(--color-success)]' : 'text-[var(--ref-on-surface)]')}>
                        {amount.income ? '+' : ''}{formatAmount(amount.value)}
                      </p>
                      {amount.of != null && amount.of !== amount.value && <p className="text-[11px] tabular-nums text-[var(--ref-on-surface-variant)]">of {formatAmount(amount.of)}</p>}
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-[var(--ref-outline)] opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {query.hasNextPage && (
            <button
              type="button"
              onClick={() => void query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
              className="w-full rounded-lg border border-[var(--color-border)] py-2 text-sm font-medium text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)] disabled:opacity-60"
            >
              {query.isFetchingNextPage ? 'Loading…' : `Show more (${(total - rows.length).toLocaleString('id-ID')} left)`}
            </button>
          )}
          </div>
        </div>
      )}
    </Modal>

    {/* A sibling, not a child: inside the list modal it would be boxed into that modal's width. */}
    <TransactionModal
        isOpen={detailOpen && opened != null}
        onClose={() => setDetailOpen(false)}
        onSaved={() => {
          setDetailOpen(false);
          void queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all });
          void queryClient.invalidateQueries({ queryKey: queryKeys.categories.all });
        }}
        accounts={(accountsQuery.data ?? []) as WalletAccount[]}
        categories={categoriesQuery.data ?? []}
        tags={tagsQuery.data ?? []}
        editingTransaction={opened}
        initialMode="view"
      />
    </>
  );
}
