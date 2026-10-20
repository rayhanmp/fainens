import { type ReactNode } from 'react';
import { ArrowRight, Check, CheckCircle2, Clock, RotateCcw } from 'lucide-react';
import { cn, formatDayMonth } from '../../lib/utils';
import { shown, useSequence } from './motion';
import { exampleAccounts, useHelpPersonal } from './personal';

/**
 * The frame every help illustration sits in, and the illustrations of ideas that have no screen of
 * their own (the ledger, a pay period, the architecture). Pictures of real screens live in the
 * *Visuals files beside this one and are built from the app’s own components. Animated ones play
 * when scrolled into view (and on Replay); reduced motion makes their transitions instant.
 */

/** The panel every illustration sits in, with an optional caption and Replay. */
export function VisualFrame({ children, caption, onReplay, frameRef }: { children: ReactNode; caption?: string; onReplay?: () => void; frameRef?: React.Ref<HTMLDivElement> }) {
  return (
    <figure className="not-prose my-6">
      <div ref={frameRef} className={cn('relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] p-4 sm:p-6', onReplay && 'pt-12 sm:pt-12')}>
        {children}
        {onReplay && (
          <button type="button" onClick={onReplay} className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-[var(--color-surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ref-on-surface-variant)] shadow-sm ring-1 ring-[var(--color-border)] hover:text-[var(--ref-on-surface)]" aria-label="Replay animation">
            <RotateCcw className="h-3 w-3" aria-hidden /> Replay
          </button>
        )}
      </div>
      {caption && <figcaption className="mt-2 text-center text-xs text-[var(--ref-on-surface-variant)]">{caption}</figcaption>}
    </figure>
  );
}

/** One record feeding every view: transaction → ledger → balances, budget, reports. */
export function LedgerFlow() {
  const { ref, step, replay } = useSequence(3, 700);
  const { second } = exampleAccounts(useHelpPersonal());
  const outputs = ['Account balances', 'Budget progress', 'Reports & recaps'];
  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption="You record a transaction once; every page reads it from the same ledger.">
      <div className="grid items-center gap-4 sm:grid-cols-[1fr_auto_1fr_auto_1.2fr]">
        <div className="rounded-xl bg-[var(--color-surface)] p-3 shadow-sm ring-1 ring-[var(--color-border)]">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ref-on-surface-variant)]">Transaction</p>
          <p className="mt-1 text-sm font-semibold text-[var(--ref-on-surface)]">Kopi susu</p>
          <p className="font-mono text-sm tabular-nums text-[var(--color-danger)]">−Rp25.000</p>
        </div>
        <ArrowRight className={cn('mx-auto h-5 w-5 text-[var(--color-accent)] max-sm:rotate-90', shown(step >= 1))} aria-hidden />
        <div className={cn('rounded-xl bg-[var(--color-accent)] p-3 text-white shadow-sm', shown(step >= 1))}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-white/75">Ledger</p>
          <p className="mt-1 text-xs leading-relaxed">Expense <span className="font-mono">+25.000</span> <span className="text-white/70">· Food & dining</span><br />{second} <span className="font-mono">−25.000</span></p>
        </div>
        <ArrowRight className={cn('mx-auto h-5 w-5 text-[var(--color-accent)] max-sm:rotate-90', shown(step >= 2))} aria-hidden />
        <ul className="space-y-1.5">
          {outputs.map((output, index) => (
            <li key={output} className={cn('flex items-center gap-2 rounded-lg bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--ref-on-surface)] ring-1 ring-[var(--color-border)]', shown(step >= 2 + (index > 0 ? 1 : 0)))} style={{ transitionDelay: `${index * 120}ms` }}>
              <CheckCircle2 className="h-4 w-4 text-[var(--color-success)]" aria-hidden />{output}
            </li>
          ))}
        </ul>
      </div>
    </VisualFrame>
  );
}

/** A salary period on a calendar strip: from payday to the day before the next one. */
export function PeriodTimeline() {
  const personal = useHelpPersonal();
  const payday = personal.salaryDay;
  // A strip of days from one payday to the next, with the middle elided.
  const start = personal.currentPeriod ? new Date(personal.currentPeriod.startDate) : new Date(new Date().getFullYear(), new Date().getMonth(), Math.min(payday, 28));
  const day = (offset: number) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset).getDate();
  const end = personal.currentPeriod ? new Date(personal.currentPeriod.endDate) : new Date(start.getFullYear(), start.getMonth() + 1, start.getDate() - 1);
  const endDay = (offset: number) => new Date(end.getFullYear(), end.getMonth(), end.getDate() + offset).getDate();
  const days: Array<number | string> = [day(0), day(1), day(2), day(3), day(4), day(5), day(6), '…', endDay(-2), endDay(-1), endDay(0), endDay(1)];
  const label = `${formatDayMonth(start.getTime())} – ${formatDayMonth(end.getTime())}`;
  return (
    <VisualFrame caption={personal.currentPeriod ? `Your current period: ${label}. Each period runs from payday to the day before the next.` : `With salary day ${payday}, each period runs from payday to the day before the next.`}>
      <FullPeriodStrip start={start} end={end} current={Boolean(personal.currentPeriod)} />
      <div className="overflow-x-auto xl:hidden">
        <div className="mx-auto flex min-w-[30rem] max-w-2xl items-end gap-1">
          {days.map((value, index) => {
            const first = index === 0;
            const next = index === days.length - 1;
            return (
              <div key={index} className="flex-1 text-center">
                {(first || next) && <p className={cn('mb-1 text-[10px] font-bold uppercase tracking-wider', next ? 'text-[var(--ref-on-surface-variant)]' : 'text-[var(--color-accent)]')}>{next ? 'Next' : 'Payday'}</p>}
                <div className={cn('grid h-10 place-items-center rounded-lg text-sm font-semibold tabular-nums', first ? 'bg-[var(--color-accent)] text-white' : next ? 'bg-[var(--ref-surface-container)] text-[var(--ref-on-surface-variant)] ring-1 ring-dashed ring-[var(--color-border-strong)]' : value === '…' ? 'text-[var(--color-muted)]' : 'bg-[var(--color-surface)] text-[var(--ref-on-surface)] ring-1 ring-[var(--color-border)]')}>{value}</div>
              </div>
            );
          })}
        </div>
        <div className="mx-auto mt-2 flex min-w-[30rem] max-w-2xl items-center gap-2 pr-[8.5%]">
          <span className="h-px flex-1 bg-[var(--color-accent)]" />
          <span className="rounded-full bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] px-2.5 py-0.5 text-xs font-semibold text-[var(--color-accent)]">{personal.currentPeriod ? 'This period' : 'One period'}: {label}</span>
          <span className="h-px flex-1 bg-[var(--color-accent)]" />
        </div>
      </div>
    </VisualFrame>
  );
}

/**
 * With room to spare (wide screens), every day of the period instead of an elided strip: weekdays,
 * where months turn, the days already behind you, and today.
 */
function FullPeriodStrip({ start, end, current }: { start: Date; end: Date; current: boolean }) {
  const today = new Date();
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const days: Date[] = [];
  for (let day = new Date(start); day <= end; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) days.push(day);
  const nextPayday = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
  const todayIndex = current ? days.findIndex((day) => sameDay(day, today)) : -1;
  const left = todayIndex >= 0 ? days.length - todayIndex - 1 : null;

  return (
    <div className="hidden xl:block">
      <div className="flex items-end gap-[3px]">
        {[...days, nextPayday].map((day, index) => {
          const isNext = index === days.length;
          const isPayday = index === 0;
          const isToday = index === todayIndex;
          const past = todayIndex >= 0 && index < todayIndex;
          const newMonth = index > 0 && day.getDate() === 1;
          return (
            <div key={day.getTime()} className={cn('min-w-0 flex-1 text-center', isNext && 'ml-2')}>
              {/* Labels are wider than a day, so they hang centred over it (or from its edge at either end). */}
              <p className="relative mb-1 h-3.5">
                <span className={cn('absolute top-0 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider', isPayday ? 'left-0 text-[var(--color-accent)]' : isNext ? 'right-0 text-[var(--ref-on-surface-variant)]' : isToday ? 'left-1/2 -translate-x-1/2 text-[var(--color-accent)]' : 'left-1/2 -translate-x-1/2 text-[var(--ref-on-surface-variant)]')}>
                  {isPayday ? 'Payday' : isNext ? 'Next payday' : isToday ? 'Today' : newMonth ? day.toLocaleDateString('en-GB', { month: 'short' }) : ''}
                </span>
              </p>
              <div
                className={cn(
                  'grid h-12 place-items-center rounded-md text-xs font-semibold tabular-nums',
                  isPayday ? 'bg-[var(--color-accent)] text-white'
                    : isNext ? 'bg-[var(--ref-surface-container)] text-[var(--ref-on-surface-variant)] ring-1 ring-dashed ring-[var(--color-border-strong)]'
                      : isToday ? 'bg-[var(--color-surface)] text-[var(--color-accent)] ring-2 ring-[var(--color-accent)]'
                        : past ? 'bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] text-[var(--ref-on-surface)]'
                          : 'bg-[var(--color-surface)] text-[var(--ref-on-surface)] ring-1 ring-[var(--color-border)]',
                  newMonth && !isToday && 'ring-1 ring-[var(--color-border-strong)]',
                )}
              >
                <span className="leading-none">
                  {day.getDate()}
                  <span className={cn('mt-1 block text-[9px] font-medium uppercase', isPayday ? 'text-white/75' : 'text-[var(--color-muted)]')}>{day.toLocaleDateString('en-GB', { weekday: 'narrow' })}</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-[var(--ref-on-surface)]">{days.length} days, {formatDayMonth(start.getTime())} – {formatDayMonth(end.getTime())}</span>
        {left !== null && (
          <span className="flex items-center gap-3 text-[var(--ref-on-surface-variant)]">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[color-mix(in_srgb,var(--color-accent)_25%,transparent)]" />Behind you</span>
            <span>Day {todayIndex + 1} · {left === 0 ? 'payday is tomorrow' : `${left + 1} days to payday`}</span>
          </span>
        )}
      </div>
    </div>
  );
}

/** Where the reader is with the quick start, from their own data. */
export function YourSetup() {
  const personal = useHelpPersonal();
  if (!personal.ready) return null;
  const items = [
    { done: personal.accountCount > 0, label: personal.accountCount > 0 ? `${personal.accountCount} ${personal.accountCount === 1 ? 'account' : 'accounts'} added` : 'No accounts yet' },
    { done: personal.periodCount > 0, label: personal.currentPeriod ? `Current period: ${formatDayMonth(personal.currentPeriod.startDate)} – ${formatDayMonth(personal.currentPeriod.endDate)}` : personal.periodCount > 0 ? 'Periods set up, but none covers today' : 'No salary period yet' },
  ];
  return (
    <div className="not-prose my-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ref-on-surface-variant)]">Your setup so far</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-2 text-sm text-[var(--ref-on-surface)]">
            <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-full', item.done ? 'bg-[var(--color-success)] text-white' : 'bg-[var(--ref-surface-container)] text-[var(--ref-on-surface-variant)]')}>{item.done ? <Check className="h-3 w-3" strokeWidth={3} aria-hidden /> : <Clock className="h-3 w-3" aria-hidden />}</span>
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** How the running pieces fit together, left (your device) to right (outside services). */
export function ArchitectureDiagram() {
  const columns: Array<{ label: string; boxes: Array<{ title: string; body: string; tone?: 'accent' | 'data' | 'external' }> }> = [
    { label: 'Your device', boxes: [{ title: 'Fainens web app', body: 'React, TanStack Router and Query' }, { title: 'Service worker', body: 'Caches the app shell; never API data' }] },
    { label: 'Web server', boxes: [{ title: 'nginx', body: 'Serves the built app, forwards /api' }] },
    { label: 'Application', boxes: [{ title: 'API server', body: 'Fastify, port 3000', tone: 'accent' }, { title: 'Worker', body: 'BullMQ jobs on a schedule', tone: 'accent' }] },
    { label: 'Data', boxes: [{ title: 'SQLite', body: 'The ledger and everything else; source of truth', tone: 'data' }, { title: 'Redis', body: 'Job queues, cache, rate limits', tone: 'data' }] },
    { label: 'Outside services', boxes: [{ title: 'Google', body: 'Sign-in and Gmail (read-only)', tone: 'external' }, { title: 'Cloudflare R2', body: 'Attachments and database backups', tone: 'external' }, { title: 'OpenRouter', body: 'Language models for Agent', tone: 'external' }] },
  ];
  const tone = {
    accent: 'bg-[var(--color-accent)] text-white ring-transparent',
    data: 'bg-[var(--color-surface)] ring-[var(--color-accent)]/40',
    external: 'bg-[var(--color-surface)]/60 ring-dashed ring-[var(--color-border-strong)]',
  };
  return (
    <VisualFrame caption="Everything except the outside services runs as containers on one server. SQLite holds the data; Redis can go down without losing any.">
      <div className="grid items-center gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1fr]">
        {columns.map((column, index) => (
          <div key={column.label} className="contents">
            {index > 0 && <ArrowRight className="mx-auto h-5 w-5 text-[var(--color-accent)] max-lg:rotate-90" aria-hidden />}
            <div>
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--ref-on-surface-variant)]">{column.label}</p>
              <div className="space-y-2">
                {column.boxes.map((box) => (
                  <div key={box.title} className={cn('rounded-xl p-3 shadow-sm ring-1', box.tone ? tone[box.tone] : 'bg-[var(--color-surface)] ring-[var(--color-border)]')}>
                    <p className={cn('text-sm font-semibold', box.tone === 'accent' ? 'text-white' : 'text-[var(--ref-on-surface)]')}>{box.title}</p>
                    <p className={cn('mt-0.5 text-xs leading-snug', box.tone === 'accent' ? 'text-white/80' : 'text-[var(--ref-on-surface-variant)]')}>{box.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </VisualFrame>
  );
}
