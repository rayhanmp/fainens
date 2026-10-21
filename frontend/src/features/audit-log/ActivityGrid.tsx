import { useEffect, useMemo, useState } from 'react';
import { cn, formatWeekdayDate, formatDayMonth, weekdayLabels } from '../../lib/utils';
import { ACTIVITY_WEEKS, dayKey, entries, type ActivityDay } from './activity';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Four steps of the accent, light to dark, so a busier day reads darker. */
const LEVELS = ['28%', '52%', '76%', '100%'];
const shade = (step: string) => `color-mix(in srgb, var(--ref-primary) ${step}, transparent)`;
/** A quiet day is a neutral grey, so it never reads as the lightest blue. */
const EMPTY = 'color-mix(in srgb, var(--ref-on-surface) 7%, transparent)';

/**
 * Where each step starts, from the quarters of the busy days. Ranking rather than scaling keeps one
 * huge day (an import) from making every other day look the same.
 */
function levelBounds(counts: number[]): number[] {
  const busy = counts.filter((count) => count > 0).sort((a, b) => a - b);
  if (busy.length === 0) return [];
  return [0.25, 0.5, 0.75].map((share) => busy[Math.min(busy.length - 1, Math.floor(busy.length * share))]!);
}

function level(count: number, bounds: number[]): number {
  if (count <= 0) return -1;
  return bounds.filter((bound) => count > bound).length;
}

function dayText(day: Date, entry: ActivityDay | undefined): string {
  const count = entry?.count ?? 0;
  if (count === 0) return `${formatWeekdayDate(day.getTime())} · nothing recorded`;
  return `${formatWeekdayDate(day.getTime())} · ${entries(count)}${entry?.removed ? `, ${entry.removed} deleted` : ''}`;
}

/**
 * The last twelve weeks, a square per day shaded by how much was recorded, with a dot where
 * something was deleted. Clicking a day shows only that day's entries below; Escape or a second
 * click goes back to everything.
 */
export function ActivityHero({ days, start, selected, onSelect, loading }: {
  days: ActivityDay[];
  start: number;
  selected: string | null;
  onSelect: (day: Date | null) => void;
  loading: boolean;
}) {
  const [hovered, setHovered] = useState<Date | null>(null);
  const byDay = useMemo(() => new Map(days.map((entry) => [entry.day, entry])), [days]);
  const today = useMemo(() => { const now = new Date(); now.setHours(0, 0, 0, 0); return now; }, []);
  const columns = useMemo(() => Array.from({ length: ACTIVITY_WEEKS }, (_, week) => Array.from({ length: 7 }, (_, weekday) => {
    const day = new Date(start);
    day.setDate(day.getDate() + week * 7 + weekday);
    return day;
  })), [start]);
  const bounds = useMemo(() => levelBounds(days.map((entry) => entry.count)), [days]);

  useEffect(() => {
    if (!selected) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onSelect(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, onSelect]);

  // Until the counts arrive, a figure reads as a dash rather than a misleading zero.
  const figure = (value: number) => (loading ? '—' : value.toLocaleString('id-ID'));
  const sumSince = (from: number, to: number, field: 'count' | 'removed') => days.reduce((sum, entry) => {
    const at = new Date(`${entry.day}T00:00:00`).getTime();
    return at >= from && at < to ? sum + entry[field] : sum;
  }, 0);
  const weekAgo = today.getTime() - 6 * DAY_MS;
  const lastWeek = sumSince(weekAgo, today.getTime() + DAY_MS, 'count');
  const weekBefore = sumSince(weekAgo - 7 * DAY_MS, weekAgo, 'count');
  const removedLastWeek = sumSince(weekAgo, today.getTime() + DAY_MS, 'removed');
  const total = days.reduce((sum, entry) => sum + entry.count, 0);
  const busiest = days.reduce<ActivityDay | null>((best, entry) => (!best || entry.count > best.count ? entry : best), null);
  const selectedDate = selected ? new Date(`${selected}T00:00:00`) : null;
  const shown = hovered ?? selectedDate;
  const labels = weekdayLabels();

  return (
    <section aria-label="Activity in the last 12 weeks" className="grid gap-6 rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_15rem]">
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--ref-on-surface-variant)]">Last 12 weeks</p>
          <p className="text-xs text-[var(--ref-on-surface-variant)]"><span className="font-bold tabular-nums text-[var(--ref-on-surface)]">{figure(total)}</span> entries</p>
        </div>
        <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
          <span />
          <div className="grid grid-cols-12 gap-1 pb-1 text-[10px] text-[var(--ref-on-surface-variant)]" aria-hidden>
            {columns.map((column, index) => {
              const first = column.find((day) => day.getDate() === 1);
              const label = index === 0 ? column[0]! : first;
              return <span key={index} className="truncate">{label ? label.toLocaleDateString('en-US', { month: 'short' }) : ''}</span>;
            })}
          </div>
          <div className="grid grid-rows-7 gap-1 text-[10px] leading-none text-[var(--ref-on-surface-variant)]" aria-hidden>
            {labels.map((label, index) => <span key={label} className="flex items-center">{index % 2 === 0 ? label : ''}</span>)}
          </div>
          <div className={cn('grid grid-flow-col grid-cols-12 grid-rows-7 gap-1', loading && 'animate-pulse')} onMouseLeave={() => setHovered(null)}>
            {columns.flat().map((day) => {
              const key = dayKey(day);
              if (day > today) return <span key={key} aria-hidden />;
              const entry = byDay.get(key);
              const step = level(entry?.count ?? 0, bounds);
              const isSelected = selected === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelect(isSelected ? null : day)}
                  onMouseEnter={() => setHovered(day)}
                  onFocus={() => setHovered(day)}
                  onBlur={() => setHovered(null)}
                  aria-pressed={isSelected}
                  aria-label={dayText(day, entry)}
                  className={cn(
                    'relative aspect-square w-full max-w-9 cursor-pointer rounded-[5px] transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ref-primary)]',
                    isSelected && 'ring-2 ring-[var(--ref-on-surface)] ring-offset-1 ring-offset-[var(--ref-surface-container-lowest)]',
                  )}
                  style={{ background: step < 0 ? EMPTY : shade(LEVELS[step]!) }}
                >
                  {entry?.removed ? <span className="absolute right-[3px] top-[3px] h-1.5 w-1.5 rounded-full bg-[var(--color-danger)] ring-1 ring-[var(--ref-surface-container-lowest)]" aria-hidden /> : null}
                </button>
              );
            })}
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2 text-xs text-[var(--ref-on-surface-variant)] xl:flex-row xl:items-center xl:justify-between">
          <p className="min-h-4 truncate" aria-live="polite">
            {shown ? <span className="font-semibold text-[var(--ref-on-surface)]">{dayText(shown, byDay.get(dayKey(shown)))}</span> : <><span className="sm:hidden">Tap a day to list only that day.</span><span className="hidden sm:inline">Point at a day to see it; click to list only that day.</span></>}
          </p>
          <div className="flex shrink-0 items-center gap-3" aria-hidden>
            <span className="flex items-center gap-1">None<span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: EMPTY }} /><span className="ml-1.5">Fewer</span>{LEVELS.map((step) => <span key={step} className="h-2.5 w-2.5 rounded-[3px]" style={{ background: shade(step) }} />)}More</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[var(--color-danger)]" />Deleted</span>
          </div>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-4 border-t border-[var(--color-border)] pt-5 lg:grid-cols-1 lg:content-center lg:gap-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--ref-on-surface-variant)]">Last 7 days</dt>
          <dd className="mt-1 text-2xl font-extrabold tabular-nums text-[var(--ref-on-surface)]">{figure(lastWeek)}</dd>
          <dd className="text-xs text-[var(--ref-on-surface-variant)]">{figure(weekBefore)} the week before</dd>
        </div>
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--ref-on-surface-variant)]">Deleted</dt>
          <dd className={cn('mt-1 text-2xl font-extrabold tabular-nums', removedLastWeek ? 'text-[var(--color-danger)]' : 'text-[var(--ref-on-surface)]')}>{figure(removedLastWeek)}</dd>
          <dd className="text-xs text-[var(--ref-on-surface-variant)]">in the last 7 days</dd>
        </div>
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--ref-on-surface-variant)]">Busiest day</dt>
          {busiest ? (
            <>
              <dd className="mt-1 text-2xl font-extrabold tabular-nums text-[var(--ref-on-surface)]">{busiest.count.toLocaleString('id-ID')}</dd>
              <dd className="text-xs text-[var(--ref-on-surface-variant)]">on {formatDayMonth(new Date(`${busiest.day}T00:00:00`).getTime())}</dd>
            </>
          ) : <dd className="mt-1 text-2xl font-extrabold text-[var(--ref-on-surface)]">—</dd>}
        </div>
      </dl>
    </section>
  );
}
