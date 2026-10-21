import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { PageHeader } from '../components/ui/PageHeader';
import { PageContainer } from '../components/ui/PageContainer';
import { RequireAuth } from '../lib/auth';
import { useAuditActivityQuery, useAuditLogQuery } from '../features/audit-log/queries';
import { ActivityHero } from '../features/audit-log/ActivityGrid';
import { EntryDetail, EntryRow } from '../features/audit-log/EntryViews';
import { useAuditFormat } from '../features/audit-log/format';
import { activityStart, dayKey, entries as entriesText } from '../features/audit-log/activity';
import { ENTITY_LABELS, type AuditEntry } from '../features/audit-log/describe';
import { cn, formatDayMonth, formatWeekdayDate } from '../lib/utils';

export const Route = createFileRoute('/audit-log')({
  component: AuditLogPage,
});

const PAGE_SIZE = 30;

const ENTITY_OPTIONS = [
  { value: '', label: 'Everything' },
  ...Object.entries(ENTITY_LABELS).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
];

const ACTION_OPTIONS = [
  { value: '', label: 'Any change' },
  { value: 'create', label: 'Added' },
  { value: 'update', label: 'Changed' },
  { value: 'delete', label: 'Deleted' },
  { value: 'other', label: 'Other steps' },
];

function AuditLogPage() {
  const format = useAuditFormat();
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [day, setDay] = useState<Date | null>(null);
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [start] = useState(() => activityStart());

  useEffect(() => {
    const id = window.setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 350);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  const range = day ? { startDate: day.getTime(), endDate: new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime() - 1 } : {};
  const auditQuery = useAuditLogQuery({
    page,
    pageSize: PAGE_SIZE,
    ...(entityType ? { entityType } : {}),
    ...(action ? { action } : {}),
    ...(search ? { search } : {}),
    ...range,
  });
  const activityQuery = useAuditActivityQuery(start);
  const total = auditQuery.data?.total ?? 0;
  const isLoading = auditQuery.isPending && !auditQuery.data;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(entityType || action || search || day);

  const pickDay = useCallback((next: Date | null) => { setDay(next); setPage(1); }, []);
  const clearFilters = () => { setEntityType(''); setAction(''); setSearchInput(''); setSearch(''); pickDay(null); };

  // Newest first, under a heading per day.
  const groups = useMemo(() => {
    const out: Array<{ key: string; at: number; rows: AuditEntry[] }> = [];
    for (const entry of (auditQuery.data?.entries ?? []) as AuditEntry[]) {
      const key = dayKey(new Date(entry.createdAt));
      const last = out[out.length - 1];
      if (last?.key === key) last.rows.push(entry);
      else out.push({ key, at: entry.createdAt, rows: [entry] });
    }
    return out;
  }, [auditQuery.data]);

  return (
    <RequireAuth>
      <PageContainer>
        <PageHeader
          subtext="Security"
          title="Security audit"
          description="Everything Fainens recorded being added, changed or deleted, newest first. Open an entry to see exactly what changed."
        />

        <div className="mt-6">
          <ActivityHero days={activityQuery.data?.days ?? []} start={start} selected={day ? dayKey(day) : null} onSelect={pickDay} loading={activityQuery.isPending} />
        </div>

        <section className="mt-6" aria-label="Entries">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center" role="search" aria-label="Search and filter the activity log">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Search the activity log</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ref-outline)]" aria-hidden />
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search names, places, notes…"
                autoComplete="off"
                className="h-[34px] w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-9 pr-8 text-sm outline-none transition placeholder:text-[var(--color-muted)] focus:border-[var(--ref-primary-container)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ref-primary-container)_22%,transparent)] [&::-webkit-search-cancel-button]:hidden"
              />
              {searchInput && (
                <button type="button" onClick={() => setSearchInput('')} className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 cursor-pointer place-items-center rounded-md text-[var(--color-muted)] hover:bg-[var(--ref-surface-container)]" aria-label="Clear search">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </label>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Select aria-label="Kind of record" value={entityType} onChange={(event) => { setEntityType(event.target.value); setPage(1); }} options={ENTITY_OPTIONS} className="!h-[34px] !py-0 text-sm sm:!w-44" />
              <Select aria-label="Kind of change" value={action} onChange={(event) => { setAction(event.target.value); setPage(1); }} options={ACTION_OPTIONS} className="!h-[34px] !py-0 text-sm sm:!w-36" />
            </div>
          </div>

          <div className="mt-3 flex min-h-7 flex-wrap items-center gap-2 text-xs text-[var(--ref-on-surface-variant)]">
            <span>{isLoading || auditQuery.isPlaceholderData ? 'Loading…' : filtered ? `${entriesText(total)} match` : `${entriesText(total)} in all`}</span>
            {day && (
              <button type="button" onClick={() => pickDay(null)} className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-[var(--ref-surface-container-high)] px-2.5 py-1 font-semibold text-[var(--ref-on-surface)] hover:bg-[var(--ref-surface-container-highest)]" aria-label={`Showing ${formatDayMonth(day.getTime())} only. Show every day`}>
                {formatDayMonth(day.getTime())} only <X className="h-3 w-3" aria-hidden />
              </button>
            )}
            {filtered && <button type="button" onClick={clearFilters} className="cursor-pointer font-semibold text-[var(--ref-primary)] hover:underline">Clear filters</button>}
          </div>

          {auditQuery.error && <p role="alert" className="mt-3 text-sm text-[var(--color-danger)]">{auditQuery.error instanceof Error ? auditQuery.error.message : 'Could not load the activity log.'}</p>}

          <div className={cn('mt-2 overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] transition-opacity', auditQuery.isPlaceholderData && 'opacity-60')} aria-busy={auditQuery.isPlaceholderData}>
            {isLoading ? (
              <div className="divide-y divide-[var(--color-border)]">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="flex animate-pulse items-center gap-3 px-4 py-3.5">
                    <div className="h-8 w-8 rounded-full bg-[var(--ref-surface-container-high)]" />
                    <div className="flex-1 space-y-2"><div className="h-3.5 w-1/3 rounded bg-[var(--ref-surface-container-high)]" /><div className="h-3 w-1/2 rounded bg-[var(--ref-surface-container-high)]" /></div>
                  </div>
                ))}
              </div>
            ) : groups.length === 0 ? (
              <div className="px-4 py-14 text-center">
                <p className="font-semibold text-[var(--ref-on-surface)]">{filtered ? 'Nothing matches' : 'Nothing recorded yet'}</p>
                <p className="mt-1 text-sm text-[var(--ref-on-surface-variant)]">{filtered ? 'Try other words, or clear the filters.' : 'Adding, changing or deleting a record will show up here.'}</p>
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.key}>
                  <h3 className="border-b border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--ref-on-surface-variant)]">
                    {formatWeekdayDate(group.at)}
                  </h3>
                  <ul className="divide-y divide-[var(--color-border)]">
                    {group.rows.map((entry) => <EntryRow key={entry.id} entry={entry} format={format} onOpen={() => setSelected(entry)} />)}
                  </ul>
                </div>
              ))
            )}
          </div>

          {totalPages > 1 && (
            <div className="mt-3 flex items-center justify-between gap-3">
              <Button type="button" variant="secondary" size="sm" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}><ChevronLeft className="h-4 w-4" aria-hidden /> Newer</Button>
              <span className="text-xs tabular-nums text-[var(--ref-on-surface-variant)]">Page {page} of {totalPages}</span>
              <Button type="button" variant="secondary" size="sm" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages}>Older <ChevronRight className="h-4 w-4" aria-hidden /></Button>
            </div>
          )}
        </section>

        <EntryDetail entry={selected} format={format} onClose={() => setSelected(null)} onOpen={setSelected} />
      </PageContainer>
    </RequireAuth>
  );
}
