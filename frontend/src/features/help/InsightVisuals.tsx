import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bell, CalendarDays, LayoutGrid, ListChecks, Receipt, SlidersHorizontal, TrendingUp, Wallet } from 'lucide-react';
import { cn } from '../../lib/utils';
import { shown, useSequence } from './motion';
import { VisualFrame } from './visuals';

/**
 * Illustrations for the Insights pages (Dashboard, Reports, Recaps, Categories). Sample figures
 * only; each one is laid out to use a wide screen, and stacks on a phone.
 */

const rupiah = (value: number) => `Rp${Math.round(value).toLocaleString('id-ID')}`;

/** Runs once the element is on screen: steps `index` through `count` every `interval` ms, unless paused. */
function useAutoplay(count: number, interval: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { threshold: 0.35 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || paused) return undefined;
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % count), interval);
    return () => window.clearInterval(timer);
  }, [visible, paused, count, interval]);

  return { ref, index, setIndex, setPaused };
}

// ── Recaps ───────────────────────────────────────────────────────────

const RECAP_CHAPTERS: Array<{ name: string; render: () => ReactNode }> = [
  {
    name: 'Cover',
    render: () => (
      <div className="flex h-full flex-col justify-between">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/75">The Period Edit</p>
        <div>
          <p className="text-5xl leading-none text-white/90">✳</p>
          <p className="mt-3 text-2xl font-extrabold leading-tight tracking-tight">Your September, in money</p>
          <p className="mt-2 text-xs text-white/75">25 Sep – 24 Oct · 30 days · 7 chapters</p>
        </div>
      </div>
    ),
  },
  {
    name: 'Overview',
    render: () => (
      <div className="flex h-full flex-col justify-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/75">Overview</p>
        <p className="mt-3 font-mono text-3xl font-bold tabular-nums">Rp3.400.000</p>
        <p className="mt-1 text-sm text-white/85">kept, of Rp10.000.000 that came in.</p>
        <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-white/20"><div className="h-full w-[34%] rounded-full bg-white" /></div>
        <p className="mt-2 text-xs text-white/75">That’s 34% saved.</p>
      </div>
    ),
  },
  {
    name: 'Categories',
    render: () => (
      <div className="flex h-full flex-col justify-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/75">Where it went</p>
        <p className="mt-2 text-lg font-bold leading-snug">Food & dining took the biggest slice</p>
        <ul className="mt-4 space-y-2.5">
          {[['Food & dining', 32], ['Shopping', 21], ['Transport', 14], ['Everything else', 33]].map(([name, share]) => (
            <li key={name}>
              <div className="flex justify-between text-xs"><span>{name}</span><span className="font-mono tabular-nums">{share}%</span></div>
              <div className="mt-1 h-1.5 rounded-full bg-white/20"><div className="h-full rounded-full bg-white" style={{ width: `${share}%` }} /></div>
            </li>
          ))}
        </ul>
      </div>
    ),
  },
  {
    name: 'Quiz',
    render: () => (
      <div className="flex h-full flex-col justify-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/75">Quick quiz</p>
        <p className="mt-2 text-lg font-bold leading-snug">Which day did you spend the most?</p>
        <div className="mt-4 space-y-2">
          {['Monday', 'Saturday', 'Thursday'].map((day) => (
            <p key={day} className={cn('rounded-xl px-3 py-2 text-sm font-semibold', day === 'Saturday' ? 'bg-white text-[var(--color-accent)]' : 'bg-white/15')}>{day}{day === 'Saturday' && ' ✓'}</p>
          ))}
        </div>
      </div>
    ),
  },
  {
    name: 'Calendar',
    render: () => (
      <div className="flex h-full flex-col justify-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/75">Your days</p>
        <p className="mt-2 font-mono text-3xl font-bold tabular-nums">22<span className="font-sans text-base font-semibold text-white/80"> of 30 days</span></p>
        <p className="text-sm text-white/85">had spending</p>
        <div className="mt-4 grid grid-cols-7 gap-1">
          {Array.from({ length: 30 }, (_, day) => {
            const level = [0, 2, 1, 0, 3, 1, 2, 0, 1, 3, 2, 0, 4, 1, 0, 2, 1, 3, 0, 2, 1, 4, 2, 0, 1, 2, 3, 0, 1, 2][day] ?? 0;
            return <span key={day} className="aspect-square rounded-[3px]" style={{ background: `rgb(255 255 255 / ${0.12 + level * 0.2})` }} />;
          })}
        </div>
      </div>
    ),
  },
  {
    name: 'Persona',
    render: () => (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/75">Your money personality</p>
        <span className="mt-4 grid h-16 w-16 place-items-center rounded-full bg-white/15 text-3xl ring-2 ring-white/40">✳</span>
        <p className="mt-3 text-xl font-extrabold">The Weekend Warrior</p>
        <p className="mt-1 text-sm text-white/85">Saturdays and Sundays carried the receipts.</p>
        <p className="mt-3 rounded-full bg-white/15 px-3 py-1 text-xs">46% of spending on weekends</p>
      </div>
    ),
  },
  {
    name: 'Closing',
    render: () => (
      <div className="flex h-full flex-col justify-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/75">That was September</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {[['Kept', '34%'], ['Busiest', 'Saturday'], ['Top category', 'Food'], ['Persona', 'Weekend Warrior']].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-white/15 p-2.5"><p className="text-[10px] uppercase tracking-wider text-white/70">{label}</p><p className="mt-0.5 text-sm font-bold leading-tight">{value}</p></div>
          ))}
        </div>
        <p className="mt-4 rounded-full bg-white py-2 text-center text-xs font-bold text-[var(--color-accent)]">Share card</p>
      </div>
    ),
  },
];

/** A recap playing on its own, chapter by chapter, with the chapter list beside it. */
export function RecapStoryDemo() {
  const interval = 2600;
  const { ref, index, setIndex, setPaused } = useAutoplay(RECAP_CHAPTERS.length, interval);
  const chapter = RECAP_CHAPTERS[index]!;

  return (
    <VisualFrame frameRef={ref} caption="A sample recap. Hover to pause; pick a chapter to jump to it.">
      <div className="flex flex-col items-center gap-6 lg:flex-row lg:items-center lg:justify-center lg:gap-12">
        <div
          className="relative h-[26rem] w-[15rem] shrink-0 overflow-hidden rounded-[2rem] p-5 pt-7 text-white shadow-xl ring-4 ring-[var(--color-surface)]"
          style={{ background: 'linear-gradient(160deg, var(--color-accent), color-mix(in srgb, var(--color-accent) 45%, black))' }}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <div className="absolute inset-x-4 top-3 flex gap-1" aria-hidden>
            {RECAP_CHAPTERS.map((item, position) => (
              <span key={item.name} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
                <span className={cn('block h-full rounded-full bg-white', position < index ? 'w-full' : position === index ? 'animate-[recap-demo-fill_linear_forwards]' : 'w-0')} style={position === index ? { animationDuration: `${interval}ms` } : undefined} key={position === index ? `run-${index}` : undefined} />
              </span>
            ))}
          </div>
          <div key={index} className="h-full animate-[finance-page-header-in_400ms_ease-out]">{chapter.render()}</div>
        </div>

        <div className="w-full max-w-xs">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ref-on-surface-variant)]">Chapters</p>
          <ol className="mt-2 space-y-1">
            {RECAP_CHAPTERS.map((item, position) => (
              <li key={item.name}>
                <button
                  type="button"
                  onClick={() => setIndex(position)}
                  className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left text-sm transition-colors', position === index ? 'bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] font-semibold text-[var(--color-accent)]' : 'text-[var(--ref-on-surface-variant)] hover:bg-[var(--color-surface)] hover:text-[var(--ref-on-surface)]')}
                >
                  <span className="w-4 text-xs tabular-nums">{position + 1}</span>{item.name}
                </button>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">In a real recap: tap to go on, tap the left third to go back, Space to pause, R for a new take.</p>
        </div>
      </div>
    </VisualFrame>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────

type DashboardRegion = { id: string; title: string; body: string; icon: typeof Bell };

const DASHBOARD_REGIONS: DashboardRegion[] = [
  { id: 'hero', title: 'At a glance', body: 'One headline number you choose (cash, budget left or net worth), a pacing bar comparing time passed with budget used, a safe daily pace, and what’s due in 30 days.', icon: Wallet },
  { id: 'attention', title: 'View and notifications', body: 'View picks a preset or edits the layout. The bell collects alerts: overdue debts, renewals to confirm, budgets at risk, accounts to reconcile.', icon: Bell },
  { id: 'pulse', title: 'Financial pulse', body: '2 to 6 metrics you pick from 21: savings rate, runway, spending against last period, what you’re owed, and more. Click a label to swap it.', icon: SlidersHorizontal },
  { id: 'budget', title: 'Budget health', body: 'Each category is a tile sized by its plan, showing what’s spent and where it’s likely to finish. Over and at-risk counts sit on top.', icon: LayoutGrid },
  { id: 'networth', title: 'Net worth trend', body: 'Your net worth over this period, 7 or 30 days, or 3 to 12 months.', icon: TrendingUp },
  { id: 'spending', title: 'Spending activity', body: 'Daily spending as a calendar heatmap, weekly bars or a running total, for 30 days or this period.', icon: CalendarDays },
  { id: 'payments', title: 'Upcoming payments', body: 'Renewals, installments and loans coming due.', icon: Receipt },
  { id: 'recent', title: 'Recent activity', body: 'Your latest transactions, one tap from their details.', icon: ListChecks },
];

/** A wireframe of the Dashboard; each region lights up in turn (or when you point at it) with what it does. */
export function DashboardMapDemo() {
  const { ref, index, setIndex, setPaused } = useAutoplay(DASHBOARD_REGIONS.length, 2800);
  const active = DASHBOARD_REGIONS[index]!;
  const region = (id: string, className: string, children: ReactNode) => {
    const position = DASHBOARD_REGIONS.findIndex((item) => item.id === id);
    const on = position === index;
    return (
      <button
        type="button"
        onMouseEnter={() => setIndex(position)}
        onFocus={() => setIndex(position)}
        aria-label={DASHBOARD_REGIONS[position]!.title}
        className={cn('relative rounded-xl bg-[var(--color-surface)] p-2.5 text-left ring-1 transition-all duration-300', on ? 'z-10 shadow-lg ring-2 ring-[var(--color-accent)]' : 'ring-[var(--color-border)] opacity-70', className)}
      >
        <span className={cn('absolute -left-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold', on ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--ref-surface-container)] text-[var(--ref-on-surface-variant)]')}>{position + 1}</span>
        {children}
      </button>
    );
  };
  const line = (width: string, strong = false) => <span className={cn('block h-1.5 rounded-full', strong ? 'bg-[var(--ref-on-surface)]/70' : 'bg-[var(--ref-surface-container)]')} style={{ width }} />;

  return (
    <VisualFrame frameRef={ref} caption="Point at a part of the Dashboard to see what it does.">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-center" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        <div className="grid grid-cols-6 gap-2.5">
          {region('hero', 'col-span-4 h-24', <span className="block space-y-2 pt-1">{line('35%')}<span className="block font-mono text-sm font-bold text-[var(--ref-on-surface)]">Rp6.197.500</span><span className="block h-1.5 overflow-hidden rounded-full bg-[var(--ref-surface-container)]"><span className="block h-full w-[48%] rounded-full bg-[var(--color-accent)]" /></span>{line('55%')}</span>)}
          {region('attention', 'col-span-2 h-24', <span className="flex h-full items-start justify-end gap-2 pt-1"><span className="rounded-md bg-[var(--ref-surface-container)] px-2 py-1 text-[9px] font-semibold text-[var(--ref-on-surface-variant)]">View</span><span className="relative"><Bell className="h-4 w-4 text-[var(--ref-on-surface-variant)]" /><span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[var(--color-danger)]" /></span></span>)}
          {region('pulse', 'col-span-6 h-14', <span className="grid h-full grid-cols-4 gap-2 pt-1">{['34%', '4.2 mo', '−8%', 'Rp200k'].map((value) => <span key={value} className="rounded-md bg-[var(--ref-surface-container-low)] px-1.5 py-1"><span className="block">{line('60%')}</span><span className="mt-1 block font-mono text-[10px] font-bold text-[var(--ref-on-surface)]">{value}</span></span>)}</span>)}
          {region('budget', 'col-span-4 h-32', <span className="grid h-full grid-cols-5 grid-rows-2 gap-1 pt-1">{[['col-span-2 row-span-2', 0.55], ['col-span-2', 0.85], ['', 0.3], ['', 1.05], ['col-span-2', 0.4]].map(([span, used], tile) => <span key={tile} className={cn('relative overflow-hidden rounded-md bg-[var(--ref-surface-container-low)]', span as string)}><span className={cn('absolute inset-x-0 bottom-0', (used as number) > 1 ? 'bg-[var(--color-danger)]/35' : (used as number) > 0.8 ? 'bg-[var(--color-warning)]/35' : 'bg-[var(--color-accent)]/25')} style={{ height: `${Math.min(1, used as number) * 100}%` }} /></span>)}</span>)}
          {region('networth', 'col-span-2 h-32', <svg viewBox="0 0 100 60" className="mt-2 h-[80%] w-full" aria-hidden><polyline points="0,48 15,44 30,46 45,36 60,30 75,32 100,14" fill="none" stroke="var(--color-accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>)}
          {region('spending', 'col-span-2 h-24', <span className="grid h-full grid-cols-7 content-center gap-[3px] pt-1">{Array.from({ length: 21 }, (_, day) => <span key={day} className="aspect-square rounded-[2px] bg-[var(--color-accent)]" style={{ opacity: 0.12 + ((day * 7) % 5) * 0.18 }} />)}</span>)}
          {region('payments', 'col-span-2 h-24', <span className="block space-y-2 pt-1">{['Netflix', 'GoPayLater', 'Loan · Ani'].map((name) => <span key={name} className="flex justify-between text-[9px] text-[var(--ref-on-surface-variant)]"><span>{name}</span>{line('22%')}</span>)}</span>)}
          {region('recent', 'col-span-2 h-24', <span className="block space-y-2 pt-1">{[0, 1, 2].map((row) => <span key={row} className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-[var(--ref-surface-container)]" /><span className="flex-1">{line(`${70 - row * 15}%`)}</span></span>)}</span>)}
        </div>

        <div key={active.id} className="animate-[finance-page-header-in_300ms_ease-out]">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-accent)]"><active.icon className="h-4 w-4" aria-hidden />{index + 1} of {DASHBOARD_REGIONS.length}</p>
          <p className="mt-2 text-lg font-semibold text-[var(--ref-on-surface)]">{active.title}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--ref-on-surface-variant)]">{active.body}</p>
          <div className="mt-4 flex gap-1" aria-hidden>
            {DASHBOARD_REGIONS.map((item, position) => <span key={item.id} className={cn('h-1 flex-1 rounded-full', position === index ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]')} />)}
          </div>
        </div>
      </div>
    </VisualFrame>
  );
}

/** How "likely finish" is built for one category: spent, plus scheduled renewals, plus the typical rest. */
export function BudgetForecastDemo() {
  const { ref, step, replay } = useSequence(3, 900);
  const plan = 600_000;
  const parts = [
    { label: 'Spent so far', value: 320_000, className: 'bg-[var(--color-accent)]' },
    { label: 'Renewals still scheduled (Netflix)', value: 186_000, className: 'bg-[repeating-linear-gradient(135deg,var(--color-accent)_0_4px,color-mix(in_srgb,var(--color-accent)_45%,transparent)_4px_8px)]' },
    { label: 'Typical for the rest of the period', value: 140_000, className: 'bg-[color-mix(in_srgb,var(--color-accent)_30%,transparent)]' },
  ];
  const likely = parts.reduce((sum, part) => sum + part.value, 0);
  const scale = Math.max(plan, likely) * 1.12;
  const pct = (value: number) => `${(value / scale) * 100}%`;

  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption="“Typical” is the median of what past completed periods spent over the same days of the pay cycle.">
      <div className="mx-auto max-w-lg">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-semibold text-[var(--ref-on-surface)]">Entertainment</span>
          <span className={cn('rounded-full bg-[var(--color-warning)]/14 px-2 py-0.5 text-[11px] font-semibold text-[var(--color-warning)]', shown(step >= 3))}>At risk · likely {rupiah(likely)}</span>
        </div>
        <div className="relative mt-6 h-6 rounded-full bg-[var(--color-surface)] ring-1 ring-[var(--color-border)]">
          <div className="absolute inset-y-0 left-0 flex overflow-hidden rounded-full">
            {parts.map((part, position) => (
              <span key={part.label} className={cn('h-full transition-[width] duration-700 ease-out', part.className)} style={{ width: step > position ? pct(part.value) : '0%' }} />
            ))}
          </div>
          <span className="absolute -top-5 bottom-[-6px] w-0.5 bg-[var(--ref-on-surface)]" style={{ left: pct(plan) }} aria-hidden>
            <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap text-[10px] font-semibold text-[var(--ref-on-surface)]">Plan {rupiah(plan)}</span>
          </span>
        </div>
        <ul className="mt-4 space-y-1.5">
          {parts.map((part, position) => (
            <li key={part.label} className={cn('flex items-center justify-between gap-3 text-xs', shown(step > position))}>
              <span className="flex items-center gap-2 text-[var(--ref-on-surface-variant)]"><span className={cn('h-3 w-5 rounded-sm', part.className)} />{part.label}</span>
              <span className="font-mono tabular-nums text-[var(--ref-on-surface)]">+{rupiah(part.value)}</span>
            </li>
          ))}
          <li className={cn('flex items-center justify-between gap-3 border-t border-[var(--color-border)] pt-1.5 text-xs font-semibold', shown(step >= 3))}>
            <span className="text-[var(--ref-on-surface)]">Likely finish</span><span className="font-mono tabular-nums text-[var(--ref-on-surface)]">{rupiah(likely)}</span>
          </li>
        </ul>
      </div>
    </VisualFrame>
  );
}

// ── Reports ──────────────────────────────────────────────────────────

const REPORT_TABS = ['Income statement', 'Balance sheet', 'Cash flow', 'Spending', 'Trends'] as const;
type ReportTab = (typeof REPORT_TABS)[number];

const SPENDING = [
  { name: 'Food & dining', value: 1_150_000 },
  { name: 'Shopping', value: 820_000 },
  { name: 'Bills', value: 610_000 },
  { name: 'Transport', value: 540_000 },
  { name: 'Groceries', value: 450_000 },
  { name: 'Entertainment', value: 320_000 },
  { name: 'Health', value: 210_000 },
];

function StatementRows({ rows, total }: { rows: Array<[string, number]>; total?: [string, number] }) {
  return (
    <div className="rounded-xl bg-[var(--color-surface)] ring-1 ring-[var(--color-border)]">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between border-b border-[var(--color-border)] px-3 py-1.5 text-xs last:border-b-0">
          <span className="text-[var(--ref-on-surface-variant)]">{label}</span><span className="font-mono tabular-nums text-[var(--ref-on-surface)]">{rupiah(value)}</span>
        </div>
      ))}
      {total && <div className="flex justify-between rounded-b-xl bg-[var(--ref-surface-container-low)] px-3 py-1.5 text-xs font-semibold"><span>{total[0]}</span><span className="font-mono tabular-nums">{rupiah(total[1])}</span></div>}
    </div>
  );
}

function ReportBody({ tab }: { tab: ReportTab }) {
  const spendingTotal = SPENDING.reduce((sum, row) => sum + row.value, 0);
  if (tab === 'Income statement') {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        <div><p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ref-on-surface-variant)]">Revenue</p><StatementRows rows={[['Salary', 10_000_000], ['Other income', 450_000]]} total={['Total revenue', 10_450_000]} /></div>
        <div><p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ref-on-surface-variant)]">Expenses</p><StatementRows rows={SPENDING.slice(0, 4).map((row) => [row.name, row.value])} total={['Total expenses', spendingTotal]} /></div>
      </div>
    );
  }
  if (tab === 'Balance sheet') {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        <div><p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ref-on-surface-variant)]">What you own</p><StatementRows rows={[['Bank and e-wallets', 6_841_500], ['Owed to you', 100_000], ['Investments', 12_000_000]]} total={['Assets', 18_941_500]} /></div>
        <div><p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ref-on-surface-variant)]">What you owe</p><StatementRows rows={[['Pay later', 412_000], ['Credit card', 1_250_000]]} total={['Liabilities', 1_662_000]} /><p className="mt-2 flex justify-between rounded-xl bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] px-3 py-2 text-xs font-semibold text-[var(--color-accent)]"><span>Net worth</span><span className="font-mono tabular-nums">{rupiah(17_279_500)}</span></p></div>
      </div>
    );
  }
  if (tab === 'Cash flow') {
    const sections = [
      { name: 'Operating', note: 'Everyday income and spending', value: 6_350_000 },
      { name: 'Investing', note: 'Money into investments, loans you gave', value: -2_500_000 },
      { name: 'Financing', note: 'Borrowing and paying debts back', value: -211_000 },
    ];
    const max = Math.max(...sections.map((section) => Math.abs(section.value)));
    return (
      <div className="space-y-2.5">
        {sections.map((section) => (
          <div key={section.name} className="grid items-center gap-x-3 gap-y-1 sm:grid-cols-[10rem_1fr_7rem]">
            <span><span className="block text-sm font-semibold text-[var(--ref-on-surface)]">{section.name}</span><span className="block text-[11px] text-[var(--ref-on-surface-variant)]">{section.note}</span></span>
            <span className="relative h-3 rounded-full bg-[var(--color-surface)] ring-1 ring-[var(--color-border)]"><span className={cn('absolute inset-y-0 left-0 rounded-full', section.value >= 0 ? 'bg-[var(--color-success)]' : 'bg-[var(--color-danger)]/70')} style={{ width: `${(Math.abs(section.value) / max) * 100}%` }} /></span>
            <span className={cn('text-right font-mono text-xs tabular-nums', section.value >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]')}>{section.value >= 0 ? '+' : '−'}{rupiah(Math.abs(section.value))}</span>
          </div>
        ))}
      </div>
    );
  }
  if (tab === 'Spending') {
    const tints = [100, 82, 66, 52, 40, 30, 22];
    const shares = SPENDING.map((row) => (row.value / spendingTotal) * 100);
    // Each slice starts where the ones before it ended.
    const starts = shares.map((_, position) => shares.slice(0, position).reduce((sum, share) => sum + share, 0));
    return (
      <div className="flex flex-col items-center gap-6 md:flex-row md:justify-center">
        <svg viewBox="0 0 42 42" className="h-40 w-40 -rotate-90" aria-hidden>
          {SPENDING.map((row, position) => (
            <circle key={row.name} cx="21" cy="21" r="15.9" fill="none" strokeWidth="6" stroke={`color-mix(in srgb, var(--color-accent) ${tints[position]}%, var(--color-surface))`} strokeDasharray={`${shares[position]} ${100 - shares[position]!}`} strokeDashoffset={-starts[position]!} />
          ))}
        </svg>
        <ul className="w-full max-w-xs space-y-1">
          {SPENDING.map((row, position) => (
            <li key={row.name} className="flex items-center justify-between gap-3 text-xs">
              <span className="flex items-center gap-2 text-[var(--ref-on-surface)]"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: `color-mix(in srgb, var(--color-accent) ${tints[position]}%, var(--color-surface))` }} />{row.name}</span>
              <span className="font-mono tabular-nums text-[var(--ref-on-surface-variant)]">{Math.round((row.value / spendingTotal) * 100)}%</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const periods = [['May', 9.6, 7.1], ['Jun', 9.6, 8.4], ['Jul', 10.1, 6.8], ['Aug', 10.1, 7.9], ['Sep', 10.4, 6.6], ['Oct', 10.45, 4.1]] as const;
  return (
    <div>
      <div className="flex h-36 items-end gap-3">
        {periods.map(([label, revenue, expenses]) => (
          <div key={label} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex h-28 w-full items-end justify-center gap-1">
              <span className="w-1/3 rounded-t bg-[var(--color-success)]/70" style={{ height: `${(revenue / 11) * 100}%` }} />
              <span className="w-1/3 rounded-t bg-[var(--color-accent)]/70" style={{ height: `${(expenses / 11) * 100}%` }} />
            </div>
            <span className="text-[10px] text-[var(--ref-on-surface-variant)]">{label}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 flex justify-center gap-4 text-[11px] text-[var(--ref-on-surface-variant)]"><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--color-success)]/70" />Revenue</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--color-accent)]/70" />Expenses</span><span>October is still running</span></p>
    </div>
  );
}

/** The Reports page in miniature: summary cards on top, and each tab’s report below. */
export function ReportsDemo() {
  const [tab, setTab] = useState<ReportTab>('Income statement');
  const cards = [
    { label: 'Revenue', value: 10_450_000, change: '+3%', good: true },
    { label: 'Expenses', value: 4_100_000, change: '−12%', good: true },
    { label: 'Net income', value: 6_350_000, change: '+15%', good: true },
    { label: 'Net worth', value: 17_279_500, change: '+6%', good: true },
  ];
  return (
    <VisualFrame caption="Sample figures. Choose a tab to see what each report shows.">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl bg-[var(--color-surface)] p-3 ring-1 ring-[var(--color-border)]">
            <p className="text-[11px] text-[var(--ref-on-surface-variant)]">{card.label}</p>
            <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-[var(--ref-on-surface)]">{rupiah(card.value)}</p>
            <p className={cn('text-[11px] font-semibold', card.good ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]')}>{card.change} vs last period</p>
          </div>
        ))}
      </div>
      <div className="mt-4 flex gap-1 overflow-x-auto rounded-xl bg-[var(--ref-surface-container)] p-1 [scrollbar-width:none]" role="tablist" aria-label="Report">
        {REPORT_TABS.map((item) => (
          <button key={item} type="button" role="tab" aria-selected={item === tab} onClick={() => setTab(item)} className={cn('shrink-0 flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors', item === tab ? 'bg-[var(--color-surface)] text-[var(--ref-on-surface)] shadow-sm' : 'text-[var(--ref-on-surface-variant)] hover:text-[var(--ref-on-surface)]')}>{item}</button>
        ))}
      </div>
      <div key={tab} className="mt-4 min-h-[11rem] animate-[finance-page-header-in_250ms_ease-out]"><ReportBody tab={tab} /></div>
    </VisualFrame>
  );
}

// ── Categories ───────────────────────────────────────────────────────

const CATEGORY_MAP = [
  { name: 'Food & dining', amount: 1_150_000, entries: 38, typical: 30_000, area: { column: '1 / 4', row: '1 / 5' } },
  { name: 'Shopping', amount: 820_000, entries: 7, typical: 117_000, area: { column: '4 / 8', row: '1 / 3' } },
  { name: 'Bills', amount: 610_000, entries: 3, typical: 203_000, area: { column: '8 / 11', row: '1 / 3' } },
  { name: 'Transport', amount: 540_000, entries: 14, typical: 38_000, area: { column: '4 / 7', row: '3 / 5' } },
  { name: 'Groceries', amount: 450_000, entries: 9, typical: 50_000, area: { column: '7 / 9', row: '3 / 5' } },
  { name: 'Entertainment', amount: 320_000, entries: 4, typical: 80_000, area: { column: '9 / 11', row: '3 / 4' } },
  { name: 'Health', amount: 210_000, entries: 2, typical: 105_000, area: { column: '9 / 11', row: '4 / 5' } },
];

/** Where the money goes (sized by amount) beside the habits map (how often against how pricey); pointing at one highlights it in both. */
export function CategoryMapDemo() {
  const [focus, setFocus] = useState<string | null>(null);
  const total = CATEGORY_MAP.reduce((sum, row) => sum + row.amount, 0);
  const dim = (name: string) => focus !== null && focus !== name;

  return (
    <VisualFrame caption="Sample data. Point at a category to find it in both views; in the app, clicking opens its transactions.">
      <div className="grid gap-6 lg:grid-cols-2" onMouseLeave={() => setFocus(null)}>
        <div>
          <p className="mb-2 text-xs font-semibold text-[var(--ref-on-surface)]">Where the money goes <span className="font-normal text-[var(--ref-on-surface-variant)]">· last 30 days</span></p>
          <div className="grid h-56 grid-cols-10 grid-rows-4 gap-1">
            {CATEGORY_MAP.map((row, position) => (
              <button
                key={row.name}
                type="button"
                onMouseEnter={() => setFocus(row.name)}
                onFocus={() => setFocus(row.name)}
                className={cn('flex flex-col justify-between overflow-hidden rounded-lg p-2 text-left transition-all duration-200', dim(row.name) ? 'opacity-35' : 'opacity-100', focus === row.name && 'ring-2 ring-[var(--ref-on-surface)]')}
                style={{ gridColumn: row.area.column, gridRow: row.area.row, background: `color-mix(in srgb, var(--color-accent) ${90 - position * 10}%, var(--color-surface))`, color: position < 4 ? 'white' : 'var(--ref-on-surface)' }}
              >
                <span className="truncate text-[11px] font-semibold leading-tight">{row.name}</span>
                <span className="truncate font-mono text-[10px] tabular-nums opacity-85">{Math.round((row.amount / total) * 100)}%</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold text-[var(--ref-on-surface)]">Spending habits <span className="font-normal text-[var(--ref-on-surface-variant)]">· how often, and how much each time</span></p>
          <div className="relative h-56 rounded-lg bg-[var(--color-surface)] ring-1 ring-[var(--color-border)]">
            <span className="absolute inset-x-0 top-1/2 border-t border-dashed border-[var(--color-border)]" aria-hidden />
            <span className="absolute inset-y-0 left-1/2 border-l border-dashed border-[var(--color-border)]" aria-hidden />
            {[['Rare · pricey', 'left-2 top-2'], ['Often · pricey', 'right-2 top-2 text-right'], ['Rare · cheap', 'bottom-2 left-2'], ['Often · cheap', 'bottom-2 right-2 text-right']].map(([label, place]) => (
              <span key={label} className={cn('absolute text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]', place)}>{label}</span>
            ))}
            {CATEGORY_MAP.map((row) => {
              // Kept clear of the corner labels: x by how often (log scale), y by the typical price.
              const left = Math.min(88, Math.max(14, (Math.log(row.entries + 1) / Math.log(45)) * 100));
              const top = Math.min(74, Math.max(20, 100 - (row.typical / 220_000) * 100));
              const size = 10 + Math.sqrt(row.amount / total) * 30;
              return (
                <button
                  key={row.name}
                  type="button"
                  onMouseEnter={() => setFocus(row.name)}
                  onFocus={() => setFocus(row.name)}
                  aria-label={`${row.name}: ${row.entries} purchases, typically ${rupiah(row.typical)}`}
                  className={cn('group/dot absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-accent)] transition-all duration-200', dim(row.name) ? 'opacity-25' : 'opacity-80', focus === row.name && 'opacity-100 ring-4 ring-[var(--color-accent)]/25')}
                  style={{ left: `${left}%`, top: `${top}%`, width: size, height: size }}
                >
                  <span className={cn('pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold text-[var(--ref-on-surface)]', focus === row.name || focus === null ? 'opacity-100' : 'opacity-0')}>{row.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <p className={cn('mt-4 min-h-5 text-center text-xs text-[var(--ref-on-surface-variant)]', focus ? 'opacity-100' : 'opacity-0')}>
        {focus && (() => { const row = CATEGORY_MAP.find((item) => item.name === focus)!; return <><strong className="text-[var(--ref-on-surface)]">{row.name}</strong>: {rupiah(row.amount)} over {row.entries} purchases, typically {rupiah(row.typical)} each.</>; })()}
      </p>
    </VisualFrame>
  );
}
