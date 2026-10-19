/**
 * Reading a batch's drafts as a list: what each one is (expense, income, salary, transfer), how much
 * it moves, and searching, filtering, sorting and grouping them by month.
 */

export type DraftKind = 'expense' | 'income' | 'salary' | 'transfer' | 'journal';

export type DraftInput = {
  id: number;
  date: number | string;
  description: string;
  notes?: string | null;
  place?: string | null;
  txType?: string;
  linkedTxId?: number | null;
  categoryId?: number | null;
  lines?: Array<{ accountId: number; debit: number; credit: number }>;
  categoryAllocations?: Array<{ categoryId: number; categoryName?: string | null }>;
  tags?: Array<{ tagId: number; name: string }>;
};

export type DraftView<T extends DraftInput = DraftInput> = {
  row: T;
  id: number;
  dateMs: number;
  kind: DraftKind;
  /** Signed from the wallets' point of view: money out is negative, in is positive, a transfer is its size. */
  amount: number;
  /** Wallets the draft touches, in line order (a transfer's sender first). */
  walletIds: number[];
  categoryIds: number[];
  tagIds: number[];
  /** "2026-03", local time. */
  monthKey: string;
  /** A transfer's admin fee, saved as its own expense linked to the transfer. */
  isFee: boolean;
};

const monthKeyOf = (dateMs: number) => {
  const date = new Date(dateMs);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

/** Classifies a draft from its type and lines; `walletTypes` maps account id to type for the wallet lines. */
export function toDraftView<T extends DraftInput>(row: T, accountTypes: Map<number, string>): DraftView<T> {
  const lines = row.lines ?? [];
  const walletLines = lines.filter((line) => accountTypes.get(line.accountId) === 'asset');
  const net = walletLines.reduce((sum, line) => sum + line.debit - line.credit, 0);
  let kind: DraftKind;
  let amount: number;
  if (row.txType === 'simple_transfer' || (walletLines.length === 2 && lines.length === 2)) {
    kind = 'transfer';
    amount = Math.max(0, ...lines.map((line) => Math.max(line.debit, line.credit)));
  } else if (row.txType === 'salary_income') {
    kind = 'salary';
    amount = net;
  } else if (row.txType === 'simple_expense' || net < 0) {
    kind = 'expense';
    amount = net;
  } else if (row.txType === 'simple_income' || net > 0) {
    kind = 'income';
    amount = net;
  } else {
    kind = 'journal';
    amount = Math.max(0, ...lines.map((line) => Math.max(line.debit, line.credit)));
  }
  // The sender of a transfer is the wallet credited; list it first.
  const walletIds = [...new Set([...walletLines].sort((a, b) => b.credit - a.credit).map((line) => line.accountId))];
  const dateMs = typeof row.date === 'number' ? row.date : new Date(row.date).getTime();
  const allocationIds = (row.categoryAllocations ?? []).map((allocation) => allocation.categoryId);
  return {
    row,
    id: row.id,
    dateMs,
    kind,
    amount,
    walletIds,
    categoryIds: allocationIds.length > 0 ? allocationIds : row.categoryId != null ? [row.categoryId] : [],
    tagIds: (row.tags ?? []).map((tag) => tag.tagId),
    monthKey: monthKeyOf(dateMs),
    isFee: kind === 'expense' && row.linkedTxId != null,
  };
}

export type DraftFilters = {
  search: string;
  kinds: DraftKind[];
  accountId: number | null;
  /** A category id, or "none" for expenses still without one. */
  category: number | 'none' | null;
  /** A tag id, or "none" for drafts without tags. */
  tag: number | 'none' | null;
  month: string | null;
};

export const EMPTY_FILTERS: DraftFilters = { search: '', kinds: [], accountId: null, category: null, tag: null, month: null };

export const activeFilterCount = (filters: DraftFilters) =>
  (filters.search.trim() ? 1 : 0) + (filters.kinds.length ? 1 : 0) + [filters.accountId, filters.category, filters.tag, filters.month].filter((value) => value != null).length;

/** An expense without a category is the one thing a draft most often still needs. */
export const needsCategory = (view: DraftView) => view.kind === 'expense' && !view.isFee && view.categoryIds.length === 0;

const normalize = (value: string) => value.toLowerCase();

/**
 * Keeps the drafts matching every active filter. The search looks at the description, notes and
 * place, the account, category and tag names, and the amount ("25000", "25.000" and "25k" all match).
 */
export function filterDrafts<T extends DraftInput>(
  views: DraftView<T>[],
  filters: DraftFilters,
  names: { account: (id: number) => string; category: (id: number) => string; tag: (id: number) => string },
): DraftView<T>[] {
  const terms = normalize(filters.search).split(/\s+/).filter(Boolean);
  return views.filter((view) => {
    if (filters.kinds.length > 0 && !filters.kinds.includes(view.kind)) return false;
    if (filters.accountId != null && !view.walletIds.includes(filters.accountId)) return false;
    if (filters.category === 'none' ? !needsCategory(view) : filters.category != null && !view.categoryIds.includes(filters.category)) return false;
    if (filters.tag === 'none' ? view.tagIds.length > 0 : filters.tag != null && !view.tagIds.includes(filters.tag)) return false;
    if (filters.month != null && view.monthKey !== filters.month) return false;
    if (terms.length === 0) return true;
    const absolute = Math.abs(view.amount);
    const haystack = normalize([
      view.row.description,
      view.row.notes ?? '',
      view.row.place ?? '',
      ...view.walletIds.map(names.account),
      ...view.categoryIds.map(names.category),
      ...view.tagIds.map(names.tag),
      String(absolute),
      absolute.toLocaleString('id-ID'),
      absolute % 1000 === 0 ? `${absolute / 1000}k` : '',
    ].join(' '));
    return terms.every((term) => haystack.includes(term));
  });
}

export type DraftSort = 'date-asc' | 'date-desc' | 'amount-desc' | 'amount-asc' | 'description';

export const SORT_LABELS: Record<DraftSort, string> = {
  'date-asc': 'Oldest first',
  'date-desc': 'Newest first',
  'amount-desc': 'Largest amount',
  'amount-asc': 'Smallest amount',
  description: 'Description A–Z',
};

export function sortDrafts<T extends DraftInput>(views: DraftView<T>[], sort: DraftSort): DraftView<T>[] {
  const byDate = (a: DraftView<T>, b: DraftView<T>) => a.dateMs - b.dateMs || a.id - b.id;
  const sorted = [...views];
  if (sort === 'date-asc') sorted.sort(byDate);
  else if (sort === 'date-desc') sorted.sort((a, b) => byDate(b, a));
  else if (sort === 'amount-desc') sorted.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || byDate(a, b));
  else if (sort === 'amount-asc') sorted.sort((a, b) => Math.abs(a.amount) - Math.abs(b.amount) || byDate(a, b));
  else sorted.sort((a, b) => a.row.description.localeCompare(b.row.description, 'id') || byDate(a, b));
  return sorted;
}

export type DraftGroup<T extends DraftInput> = {
  key: string;
  label: string;
  rows: DraftView<T>[];
  /** Money in and out of wallets; transfers move money between wallets and count in neither. */
  moneyIn: number;
  moneyOut: number;
};

const monthLabel = (key: string) => {
  const [year, month] = key.split('-').map(Number);
  return new Date(year!, month! - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
};

const totals = <T extends DraftInput>(rows: DraftView<T>[]) => ({
  moneyIn: rows.filter((view) => view.kind !== 'transfer' && view.amount > 0).reduce((sum, view) => sum + view.amount, 0),
  moneyOut: rows.filter((view) => view.kind !== 'transfer' && view.amount < 0).reduce((sum, view) => sum - view.amount, 0),
});

/**
 * Groups by calendar month when the list is in date order, keeping that order; any other sort is
 * one flat group, since splitting a list sorted by amount into months would hide the sort.
 */
export function groupDrafts<T extends DraftInput>(views: DraftView<T>[], sort: DraftSort): DraftGroup<T>[] {
  if (sort !== 'date-asc' && sort !== 'date-desc') return views.length ? [{ key: 'all', label: '', rows: views, ...totals(views) }] : [];
  const groups: DraftGroup<T>[] = [];
  for (const view of views) {
    let group = groups.at(-1);
    if (!group || group.key !== view.monthKey) {
      group = { key: view.monthKey, label: monthLabel(view.monthKey), rows: [], moneyIn: 0, moneyOut: 0 };
      groups.push(group);
    }
    group.rows.push(view);
  }
  return groups.map((group) => ({ ...group, ...totals(group.rows) }));
}

/** The months the drafts fall in, oldest first, for the month filter. */
export function draftMonths(views: DraftView[]): Array<{ key: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const view of views) counts.set(view.monthKey, (counts.get(view.monthKey) ?? 0) + 1);
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, count]) => ({ key, label: monthLabel(key), count }));
}

export { totals as draftTotals };
