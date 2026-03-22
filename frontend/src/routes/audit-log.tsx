import { createFileRoute } from '@tanstack/react-router';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { RequireAuth } from '../lib/auth';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatDateTime, cn } from '../lib/utils';
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Filter,
  Plus,
  Pencil,
  Trash2,
  Eye,
  Search,
  X,
} from 'lucide-react';

export const Route = createFileRoute('/audit-log')({
  component: AuditLogPage,
} as any);

/** Placeholder until session API exists */
const DUMMY_LAST_SESSION = {
  loggedInAt: 'Mar 21, 2026 · 2:15 PM',
  browser: 'Chrome 122',
  os: 'Windows 11',
  location: 'Jakarta, Indonesia',
  ipMasked: '103.xxx.xxx.12',
} as const;

const LAST_SESSION_COMPACT = `${DUMMY_LAST_SESSION.loggedInAt} · ${DUMMY_LAST_SESSION.browser} · ${DUMMY_LAST_SESSION.location}`;
const LAST_SESSION_TOOLTIP = `${DUMMY_LAST_SESSION.loggedInAt} — ${DUMMY_LAST_SESSION.browser} · ${DUMMY_LAST_SESSION.os} · ${DUMMY_LAST_SESSION.location} · IP ${DUMMY_LAST_SESSION.ipMasked} (demo)`;

interface AuditEntry {
  id: number;
  entityType: string;
  entityId: number;
  action: 'create' | 'update' | 'delete';
  beforeSnapshot: Record<string, unknown> | null;
  afterSnapshot: Record<string, unknown> | null;
  createdAt: number;
}

const ENTITY_TYPE_OPTIONS = [
  { value: '', label: 'All resources' },
  { value: 'account', label: 'Account' },
  { value: 'transaction', label: 'Transaction' },
  { value: 'transaction_line', label: 'Transaction line' },
  { value: 'category', label: 'Category' },
  { value: 'tag', label: 'Tag' },
  { value: 'salary_period', label: 'Salary period' },
  { value: 'budget_plan', label: 'Budget plan' },
  { value: 'attachment', label: 'Attachment' },
];

const ACTION_OPTIONS = [
  { value: '', label: 'All actions' },
  { value: 'create', label: 'Create' },
  { value: 'update', label: 'Update' },
  { value: 'delete', label: 'Delete' },
];

function pickSnapshotLabel(s: Record<string, unknown> | null | undefined): string {
  if (!s) return '';
  const name = s.name;
  const desc = s.description;
  const title = s.title;
  if (typeof name === 'string' && name.trim()) return name;
  if (typeof desc === 'string' && desc.trim()) return desc;
  if (typeof title === 'string' && title.trim()) return title;
  return '';
}

function entrySummary(entry: AuditEntry): string {
  if (entry.action === 'create' && entry.afterSnapshot) {
    const t = pickSnapshotLabel(entry.afterSnapshot);
    return t ? `Created · ${t}` : 'Created';
  }
  if (entry.action === 'delete' && entry.beforeSnapshot) {
    const t = pickSnapshotLabel(entry.beforeSnapshot);
    return t ? `Removed · ${t}` : 'Removed';
  }
  if (entry.action === 'update') return 'Record updated';
  return '—';
}

function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({
    entityType: '',
    action: '',
  });
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(searchInput.trim()), 350);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const loadAuditLog = useCallback(async () => {
    setIsLoading(true);
    try {
      const params: {
        page: number;
        pageSize: number;
        entityType?: string;
        action?: string;
        search?: string;
      } = { page, pageSize };
      if (filters.entityType) params.entityType = filters.entityType;
      if (filters.action) params.action = filters.action;
      if (debouncedSearch) params.search = debouncedSearch;

      const data = await api.auditLog.list(params);
      setEntries(
        data.entries.map((e) => ({
          ...e,
          action: e.action as AuditEntry['action'],
        })),
      );
      setTotal(data.total);
    } catch (err) {
      console.error('Failed to load audit log:', err);
    } finally {
      setIsLoading(false);
    }
  }, [page, pageSize, filters.entityType, filters.action, debouncedSearch]);

  useEffect(() => {
    void loadAuditLog();
  }, [loadAuditLog]);

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'create':
        return <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />;
      case 'update':
        return <Pencil className="h-3.5 w-3.5 sm:h-4 sm:w-4" />;
      case 'delete':
        return <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />;
      default:
        return null;
    }
  };

  const getActionPillClass = (action: string) => {
    switch (action) {
      case 'create':
        return 'bg-[var(--ref-secondary)]/15 text-[var(--ref-secondary)] ring-1 ring-[var(--ref-secondary)]/25';
      case 'update':
        return 'bg-amber-500/15 text-amber-900 ring-1 ring-amber-500/25';
      case 'delete':
        return 'bg-[var(--ref-error)]/12 text-[var(--ref-error)] ring-1 ring-[var(--ref-error)]/20';
      default:
        return 'bg-[var(--ref-surface-container-highest)] text-[var(--ref-on-surface-variant)]';
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <RequireAuth>
      <div className="mx-auto max-w-7xl space-y-6 pb-10 sm:space-y-8">
        {/* Header — Stitch reference (no hero icon) */}
        <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]">
              Security &amp; compliance
            </p>
            <h1 className="font-headline text-2xl font-extrabold tracking-tight text-[var(--ref-on-surface)] sm:text-3xl md:text-4xl">
              Security audit log
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--ref-on-surface-variant)]">
              Immutable trail of create, update, and delete events across your ledger and settings. Search and
              filter to investigate changes.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void loadAuditLog()}
            className="h-11 w-full shrink-0 rounded-full border border-[var(--color-border)] px-5 sm:h-auto sm:w-auto"
            disabled={isLoading}
          >
            <RefreshCw className={cn('mr-2 h-4 w-4', isLoading && 'animate-spin')} />
            Refresh
          </Button>
        </header>

        {/* Activity: header + last session + toolbar + table — single surface */}
        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] editorial-shadow">
          <div className="border-b border-[var(--color-border)] px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <h2 className="font-headline text-base font-bold text-[var(--ref-on-surface)] sm:text-lg">Activity</h2>
              <p
                className="min-w-0 text-left text-[11px] leading-snug text-[var(--ref-on-surface-variant)] sm:max-w-[55%] sm:text-right sm:text-xs"
                title={LAST_SESSION_TOOLTIP}
              >
                <span className="font-semibold text-[var(--ref-on-surface)]">Last session</span>
                <span className="text-[var(--ref-outline)]"> · </span>
                <span className="line-clamp-2 sm:line-clamp-1">{LAST_SESSION_COMPACT}</span>
              </p>
            </div>
          </div>

          {/* Toolbar: visually part of the list (same card) */}
          <div
            className="border-b border-[var(--color-border)] bg-[var(--ref-surface-container-low)]/80 px-3 py-3 sm:px-5"
            role="search"
            aria-label="Search and filter audit log"
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-3 lg:gap-y-2">
              <div className="relative min-w-0 flex-1 lg:min-w-[220px]">
                <label htmlFor="audit-search" className="sr-only">
                  Search audit log
                </label>
                <div className="flex min-h-[42px] items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] py-1.5 pl-3 pr-1.5 transition-[border-color,box-shadow] focus-within:border-[var(--ref-primary-container)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ref-primary-container)_22%,transparent)]">
                  <Search className="h-4 w-4 shrink-0 text-[var(--ref-outline)]" aria-hidden />
                  <input
                    id="audit-search"
                    type="search"
                    placeholder="Search resource, ID, or action…"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    className="min-w-0 flex-1 border-0 bg-transparent py-1 text-sm font-medium text-[var(--ref-on-surface)] outline-none placeholder:text-[var(--ref-outline)]"
                    autoComplete="off"
                  />
                  {searchInput ? (
                    <button
                      type="button"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--ref-outline)] hover:bg-[var(--ref-surface-container-highest)]"
                      onClick={() => setSearchInput('')}
                      aria-label="Clear search"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-stretch">
                <Select
                  value={filters.entityType}
                  onChange={(e) => {
                    setFilters({ ...filters, entityType: e.target.value });
                    setPage(1);
                  }}
                  options={ENTITY_TYPE_OPTIONS}
                  className="min-w-0 flex-1 rounded-full border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] text-xs font-semibold sm:min-w-[168px]"
                />
                <Select
                  value={filters.action}
                  onChange={(e) => {
                    setFilters({ ...filters, action: e.target.value });
                    setPage(1);
                  }}
                  options={ACTION_OPTIONS}
                  className="min-w-0 flex-1 rounded-full border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] text-xs font-semibold sm:min-w-[132px]"
                />
              </div>

              <div className="flex shrink-0 items-center gap-2 border-t border-[var(--color-border)] pt-2 text-xs font-medium text-[var(--ref-on-surface-variant)] sm:border-t-0 sm:pt-0 lg:ml-auto lg:border-t-0 lg:pt-0">
                <Filter className="h-3.5 w-3.5 text-[var(--ref-outline)]" aria-hidden />
                {total === 0 ? (
                  <span>No entries</span>
                ) : (
                  <span>
                    <span className="hidden sm:inline">Showing </span>
                    <span className="font-bold text-[var(--ref-on-surface)]">{from}</span>
                    <span className="text-[var(--ref-outline)]">–</span>
                    <span className="font-bold text-[var(--ref-on-surface)]">{to}</span>
                    <span className="text-[var(--ref-on-surface-variant)]"> of </span>
                    <span className="font-bold text-[var(--ref-on-surface)]">{total}</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-0 divide-y divide-[var(--color-border)]">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex animate-pulse gap-4 px-4 py-4 sm:px-6">
                  <div className="h-4 w-24 rounded bg-[var(--ref-surface-container-highest)]" />
                  <div className="h-6 w-16 rounded-full bg-[var(--ref-surface-container-highest)]" />
                  <div className="h-4 flex-1 rounded bg-[var(--ref-surface-container-highest)]" />
                </div>
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="px-4 py-14 text-center sm:px-6">
              <Search className="mx-auto mb-3 h-12 w-12 text-[var(--ref-outline)] opacity-50" aria-hidden />
              <p className="font-headline text-base font-semibold text-[var(--ref-on-surface)]">
                {debouncedSearch ? 'No matching entries' : 'No audit events yet'}
              </p>
              <p className="mt-2 text-sm text-[var(--ref-on-surface-variant)]">
                {debouncedSearch
                  ? `Nothing matches “${debouncedSearch}”. Try different keywords or clear filters.`
                  : 'Changes to accounts, transactions, and settings will appear here.'}
              </p>
            </div>
          ) : (
            <>
              <div className="-mx-px overflow-x-auto">
                <table className="w-full min-w-[640px] text-left">
                  <thead>
                    <tr className="bg-[var(--ref-surface-container-low)]">
                      <th className="whitespace-nowrap px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)] sm:px-6 sm:py-4">
                        Timestamp
                      </th>
                      <th className="whitespace-nowrap px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)] sm:px-6 sm:py-4">
                        Event
                      </th>
                      <th className="whitespace-nowrap px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)] sm:px-6 sm:py-4">
                        Resource
                      </th>
                      <th className="min-w-[160px] px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)] sm:px-6 sm:py-4">
                        Summary
                      </th>
                      <th className="w-12 px-2 py-3 sm:px-4 sm:py-4" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--ref-surface-container)]">
                    {entries.map((entry) => (
                      <tr
                        key={entry.id}
                        className="transition-colors hover:bg-[var(--ref-surface-container-low)]/70"
                      >
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-[11px] text-[var(--ref-on-surface-variant)] sm:px-6 sm:py-4 sm:text-xs">
                          {formatDateTime(entry.createdAt)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 sm:px-6 sm:py-4">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide',
                              getActionPillClass(entry.action),
                            )}
                          >
                            {getActionIcon(entry.action)}
                            {entry.action}
                          </span>
                        </td>
                        <td className="px-4 py-3 sm:px-6 sm:py-4">
                          <span className="font-medium capitalize text-[var(--ref-on-surface)]">
                            {entry.entityType.replace(/_/g, ' ')}
                          </span>
                          <span className="mt-0.5 block font-mono text-[10px] text-[var(--ref-outline)]">
                            #{entry.entityId}
                          </span>
                        </td>
                        <td className="max-w-[280px] px-4 py-3 text-xs text-[var(--ref-on-surface-variant)] sm:px-6 sm:py-4 sm:text-sm">
                          <span className="line-clamp-2">{entrySummary(entry)}</span>
                        </td>
                        <td className="px-2 py-3 text-right sm:px-4 sm:py-4">
                          <button
                            type="button"
                            onClick={() => setSelectedEntry(entry)}
                            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-[var(--ref-primary)] transition-colors hover:bg-[var(--ref-primary)]/10 sm:min-h-0 sm:min-w-0 sm:p-2"
                            title="View payload"
                            aria-label={`View details for entry ${entry.id}`}
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-3 border-t border-[var(--color-border)] p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="w-full justify-center rounded-full sm:w-auto"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Previous
                </Button>
                <span className="text-center font-mono text-xs text-[var(--ref-on-surface-variant)]">
                  Page {page} / {totalPages}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="w-full justify-center rounded-full sm:w-auto"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  Next
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </>
          )}
        </div>

        <Modal
          isOpen={!!selectedEntry}
          onClose={() => setSelectedEntry(null)}
          title="Audit entry"
          subtitle={selectedEntry ? `${formatDateTime(selectedEntry.createdAt)} · Entry #${selectedEntry.id}` : undefined}
          size="xl"
        >
          {selectedEntry && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] p-3 text-sm">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ref-outline)]">Action</p>
                  <p className="mt-1 font-headline font-bold capitalize text-[var(--ref-on-surface)]">
                    {selectedEntry.action}
                  </p>
                </div>
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] p-3 text-sm">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ref-outline)]">Resource</p>
                  <p className="mt-1 font-headline font-bold capitalize text-[var(--ref-on-surface)]">
                    {selectedEntry.entityType.replace(/_/g, ' ')}{' '}
                    <span className="font-mono text-[var(--ref-outline)]">#{selectedEntry.entityId}</span>
                  </p>
                </div>
              </div>

              {selectedEntry.beforeSnapshot && (
                <div>
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[var(--ref-error)]">
                    Before
                  </p>
                  <pre className="max-h-48 overflow-auto rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] p-4 font-mono text-[11px] leading-relaxed text-[var(--ref-on-surface)] sm:max-h-64 sm:text-xs">
                    {JSON.stringify(selectedEntry.beforeSnapshot, null, 2)}
                  </pre>
                </div>
              )}

              {selectedEntry.afterSnapshot && (
                <div>
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[var(--ref-secondary)]">
                    After
                  </p>
                  <pre className="max-h-48 overflow-auto rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] p-4 font-mono text-[11px] leading-relaxed text-[var(--ref-on-surface)] sm:max-h-64 sm:text-xs">
                    {JSON.stringify(selectedEntry.afterSnapshot, null, 2)}
                  </pre>
                </div>
              )}

              <div className="flex justify-end pt-2">
                <Button type="button" className="rounded-full" onClick={() => setSelectedEntry(null)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </Modal>
      </div>
    </RequireAuth>
  );
}
