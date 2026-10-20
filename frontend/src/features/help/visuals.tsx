import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Check, CheckCircle2, Clock, Inbox, Lock, Mail, RotateCcw, Sparkles } from 'lucide-react';
import { cn, formatDayMonth } from '../../lib/utils';
import { exampleAccounts, useHelpPersonal } from './personal';

/**
 * Illustrations for the help docs, drawn with the app's own tokens so they look like Fainens.
 * Animated ones play once when scrolled into view (and on Replay). Reduced motion — the device
 * setting or Settings → Accessibility — makes their transitions instant.
 */

/** Steps through `count` stages, one every `interval` ms, once the element is on screen. */
function useSequence(count: number, interval = 900) {
  const ref = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [run, setRun] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const observer = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) setVisible(true); }, { threshold: 0.4 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    const timers = Array.from({ length: count }, (_, index) => window.setTimeout(() => setStep(index + 1), 350 + index * interval));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [visible, run, count, interval]);

  const replay = () => { setStep(0); setRun((value) => value + 1); };
  return { ref, step, replay };
}

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

const shown = (visible: boolean) => cn('transition-all duration-500 ease-out', visible ? 'translate-y-0 opacity-100' : 'translate-y-1.5 opacity-0');

function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', className)}>{children}</span>;
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

/** The composer turning shorthand into an entry: amount, suggested category, read-back. */
export function ComposerDemo() {
  const { ref, step, replay } = useSequence(4, 900);
  const { second } = exampleAccounts(useHelpPersonal());
  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption="Type 25k and a name; Fainens fills in the rest for you to check.">
      <div className="mx-auto max-w-md rounded-2xl bg-[var(--color-surface)] p-4 shadow-sm ring-1 ring-[var(--color-border)]">
        <div className="grid grid-cols-4 gap-1 rounded-lg bg-[var(--ref-surface-container)] p-1 text-center text-[11px] font-semibold">
          {['Expense', 'Income', 'Transfer', 'Settle PayLater'].map((type, index) => <span key={type} className={cn('rounded-md py-1', index === 0 ? 'bg-[var(--color-surface)] text-[var(--ref-on-surface)] shadow-sm' : 'text-[var(--ref-on-surface-variant)]')}>{type}</span>)}
        </div>
        <div className="mt-3 flex items-baseline justify-between rounded-lg border border-[var(--color-border)] px-3 py-2">
          <span className="text-xs text-[var(--ref-on-surface-variant)]">Amount</span>
          <span className="font-mono text-lg font-semibold tabular-nums text-[var(--ref-on-surface)]">{step >= 1 ? <>Rp25.000 <span className="ml-1 text-xs font-normal text-[var(--color-muted)]">from “25k”</span></> : <span className="text-[var(--color-muted)]">25k|</span>}</span>
        </div>
        <div className="mt-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--ref-on-surface)]">{step >= 2 ? 'Kopi susu' : <span className="text-[var(--color-muted)]">Name</span>}</div>
        <div className={cn('mt-2 flex items-center justify-between rounded-lg bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] px-3 py-2 text-xs', shown(step >= 3))}>
          <span className="flex items-center gap-1.5 text-[var(--ref-on-surface)]"><Sparkles className="h-3.5 w-3.5 text-[var(--color-accent)]" aria-hidden />Looks like <strong>Food & dining</strong></span>
          <span className="font-semibold text-[var(--color-accent)]">Use it</span>
        </div>
        <p className={cn('mt-3 rounded-lg bg-[var(--ref-surface-container-low)] px-3 py-2 text-xs leading-relaxed text-[var(--ref-on-surface-variant)]', shown(step >= 4))}>“You spent <strong className="text-[var(--ref-on-surface)]">Rp25.000</strong> on <strong className="text-[var(--ref-on-surface)]">Kopi susu</strong> (Food & dining) from <strong className="text-[var(--ref-on-surface)]">{second}</strong> today.”</p>
      </div>
    </VisualFrame>
  );
}

const rupiah = (value: number) => `Rp${value.toLocaleString('id-ID')}`;

/** A transfer: money slides from one account to the other, and spending stays at zero. */
export function TransferDemo() {
  const { ref, step, replay } = useSequence(2, 1100);
  const { first, second } = exampleAccounts(useHelpPersonal());
  const moved = step >= 2;
  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption="Both balances change; income, spending and budgets don’t. (Your account names, example amounts.)">
      <div className="relative grid grid-cols-2 gap-6 sm:gap-16">
        {[{ name: first, before: 1_500_000, after: 1_400_000 }, { name: second, before: 50_000, after: 150_000 }].map((account) => (
          <div key={account.name} className="rounded-xl bg-[var(--color-surface)] p-3 shadow-sm ring-1 ring-[var(--color-border)] sm:p-4">
            <p className="text-xs font-semibold text-[var(--ref-on-surface-variant)]">{account.name}</p>
            <p className="mt-1 font-mono text-base font-semibold tabular-nums text-[var(--ref-on-surface)] transition-colors sm:text-lg">{rupiah(moved ? account.after : account.before)}</p>
          </div>
        ))}
        <span className={cn('absolute top-1/2 -translate-y-1/2 rounded-full bg-[var(--color-accent)] px-2.5 py-1 font-mono text-xs font-semibold text-white shadow-md transition-all duration-1000 ease-in-out', step === 0 ? 'left-[20%] opacity-0' : moved ? 'left-[62%] opacity-0' : 'left-[38%] opacity-100')} aria-hidden>Rp100.000</span>
      </div>
      <div className="mt-4 flex items-center justify-between rounded-lg bg-[var(--color-surface)] px-3 py-2 text-sm ring-1 ring-[var(--color-border)]">
        <span className="text-[var(--ref-on-surface-variant)]">Spending this period</span>
        <span className="font-mono font-semibold tabular-nums text-[var(--ref-on-surface)]">Rp0 <span className={cn('ml-1 inline-flex align-middle', shown(moved))}><Chip className="bg-[var(--color-success)]/12 text-[var(--color-success)]"><Check className="h-3 w-3" aria-hidden />unchanged</Chip></span></span>
      </div>
    </VisualFrame>
  );
}

/** A correction: the original stays, an opposite entry cancels it, a replacement takes its place. */
export function CorrectionDemo() {
  const { ref, step, replay } = useSequence(3, 1000);
  const rows = [
    { label: 'Original (typed 50k by mistake)', amount: '−Rp50.000', className: step >= 2 ? 'text-[var(--color-muted)] line-through decoration-1' : 'text-[var(--ref-on-surface)]' },
    { label: 'Correction (cancels the original)', amount: '+Rp50.000', className: 'text-[var(--ref-on-surface)]' },
    { label: 'Replacement (what really happened)', amount: '−Rp45.000', className: 'text-[var(--ref-on-surface)]' },
  ];
  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption="Nothing is erased: all three entries stay in the history.">
      <div className="mx-auto max-w-md divide-y divide-[var(--color-border)] rounded-xl bg-[var(--color-surface)] ring-1 ring-[var(--color-border)]">
        {rows.map((row, index) => (
          <div key={row.label} className={cn('flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm', index === 0 ? '' : shown(step >= index + 1))}>
            <span className={cn('transition-colors', row.className)}>{row.label}</span>
            <span className={cn('font-mono tabular-nums', row.className)}>{row.amount}</span>
          </div>
        ))}
        <div className={cn('flex items-center justify-between bg-[var(--ref-surface-container-low)] px-3.5 py-2.5 text-sm font-semibold', shown(step >= 3))}>
          <span className="text-[var(--ref-on-surface)]">Counts as spending</span>
          <span className="font-mono tabular-nums text-[var(--ref-on-surface)]">Rp45.000</span>
        </div>
      </div>
    </VisualFrame>
  );
}

/** Reconciling: Fainens and the bank side by side, the gap measured, then recorded openly. */
export function ReconcileDemo() {
  const { ref, step, replay } = useSequence(3, 900);
  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption="The difference becomes a balance adjustment, never income or spending.">
      <div className="mx-auto max-w-lg space-y-3">
        {[{ label: 'Fainens says', value: 1_200_000, width: 100 }, { label: 'Your bank says', value: 1_180_000, width: 98.3 }].map((bar, index) => (
          <div key={bar.label}>
            <div className="mb-1 flex justify-between text-xs"><span className="text-[var(--ref-on-surface-variant)]">{bar.label}</span><span className="font-mono tabular-nums text-[var(--ref-on-surface)]">{rupiah(bar.value)}</span></div>
            <div className="h-3 rounded-full bg-[var(--color-surface)] ring-1 ring-[var(--color-border)]">
              <div className={cn('h-full rounded-full transition-all duration-700 ease-out', index === 0 ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-success)]')} style={{ width: step >= 1 ? `${bar.width}%` : '0%' }} />
            </div>
          </div>
        ))}
        <div className={cn('flex items-center justify-between rounded-lg bg-[var(--color-warning)]/10 px-3 py-2 text-sm', shown(step >= 2))}>
          <span className="text-[var(--ref-on-surface)]">Difference — check for a missing or doubled transaction first</span>
          <span className="font-mono font-semibold tabular-nums text-[var(--color-warning)]">Rp20.000</span>
        </div>
        <div className={cn('flex items-center justify-between rounded-lg bg-[var(--color-surface)] px-3 py-2 text-sm ring-1 ring-[var(--color-border)]', shown(step >= 3))}>
          <span className="flex items-center gap-1.5 text-[var(--ref-on-surface)]"><CheckCircle2 className="h-4 w-4 text-[var(--color-success)]" aria-hidden />Balance adjustment recorded</span>
          <span className="font-mono tabular-nums text-[var(--ref-on-surface-variant)]">−Rp20.000</span>
        </div>
      </div>
    </VisualFrame>
  );
}

/** Imported items: an email becomes a pending item, you approve it, and only then it posts. */
export function ImportFlowDemo() {
  const { ref, step, replay } = useSequence(4, 850);
  const stages = [
    { icon: Mail, title: 'Bank email', body: 'wondr by BNI: Transaction successful' },
    { icon: Inbox, title: 'Pending', body: 'Waiting in Review pending' },
    { icon: Check, title: 'You approve', body: 'Edit if needed, or reject' },
    { icon: CheckCircle2, title: 'Posted', body: 'Counts in balances and budget' },
  ];
  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption="Nothing reaches your ledger until you approve it.">
      <ol className="grid gap-3 sm:grid-cols-4">
        {stages.map(({ icon: Icon, title, body }, index) => {
          const reached = step > index;
          return (
            <li key={title} className={cn('rounded-xl p-3 ring-1 transition-all duration-500', reached ? 'bg-[var(--color-surface)] shadow-sm ring-[var(--color-accent)]/40' : 'bg-[var(--color-surface)]/50 ring-[var(--color-border)]')}>
              <span className={cn('grid h-8 w-8 place-items-center rounded-full transition-colors duration-500', reached ? (index === 3 ? 'bg-[var(--color-success)] text-white' : 'bg-[var(--color-accent)] text-white') : 'bg-[var(--ref-surface-container)] text-[var(--ref-on-surface-variant)]')}><Icon className="h-4 w-4" aria-hidden /></span>
              <p className="mt-2 text-sm font-semibold text-[var(--ref-on-surface)]">{title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">{body}</p>
            </li>
          );
        })}
      </ol>
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

/** Budget categories filling up, with the status each one shows. */
export function BudgetBarsDemo() {
  const { ref, step, replay } = useSequence(1, 300);
  const rows = [
    { name: 'Food & dining', spent: 1_150_000, plan: 1_500_000, status: 'On track', tone: 'success' },
    { name: 'Transport', spent: 540_000, plan: 600_000, status: 'Near limit', tone: 'warning' },
    { name: 'Shopping', spent: 820_000, plan: 700_000, status: 'Over', tone: 'danger' },
    { name: 'Health', spent: 0, plan: 300_000, status: 'Not started', tone: 'muted' },
  ] as const;
  const toneBar = { success: 'bg-[var(--color-success)]', warning: 'bg-[var(--color-warning)]', danger: 'bg-[var(--color-danger)]', muted: 'bg-[var(--color-muted)]' };
  const toneChip = { success: 'bg-[var(--color-success)]/12 text-[var(--color-success)]', warning: 'bg-[var(--color-warning)]/14 text-[var(--color-warning)]', danger: 'bg-[var(--color-danger)]/12 text-[var(--color-danger)]', muted: 'bg-[var(--ref-surface-container)] text-[var(--ref-on-surface-variant)]' };
  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption="Each category shows how much of its plan is used, and a status.">
      <div className="mx-auto max-w-lg space-y-3.5">
        {rows.map((row, index) => (
          <div key={row.name}>
            <div className="mb-1 flex items-center justify-between gap-3 text-sm">
              <span className="font-medium text-[var(--ref-on-surface)]">{row.name}</span>
              <span className="flex items-center gap-2"><span className="font-mono text-xs tabular-nums text-[var(--ref-on-surface-variant)]">{rupiah(row.spent)} / {rupiah(row.plan)}</span><Chip className={toneChip[row.tone]}>{row.status}</Chip></span>
            </div>
            <div className="h-2 rounded-full bg-[var(--color-surface)] ring-1 ring-[var(--color-border)]">
              <div className={cn('h-full rounded-full transition-all duration-1000 ease-out', toneBar[row.tone])} style={{ width: step >= 1 ? `${Math.min(100, (row.spent / row.plan) * 100)}%` : '0%', transitionDelay: `${index * 120}ms` }} />
            </div>
          </div>
        ))}
      </div>
    </VisualFrame>
  );
}

/** Closing a period: the lock clicks shut on its history. */
export function ClosedPeriodDemo() {
  const { ref, step, replay } = useSequence(1, 400);
  const closed = step >= 1;
  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption="A closed period can’t change until you reopen it.">
      <div className="mx-auto flex max-w-md items-center gap-4 rounded-xl bg-[var(--color-surface)] p-4 shadow-sm ring-1 ring-[var(--color-border)]">
        <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl transition-colors duration-500', closed ? 'bg-[var(--ref-on-surface)] text-[var(--color-surface)]' : 'bg-[var(--ref-surface-container)] text-[var(--ref-on-surface-variant)]')}><Lock className={cn('h-5 w-5 transition-transform duration-500', closed ? 'scale-100' : 'scale-75')} aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--ref-on-surface)]">September period</p>
          <p className="text-xs text-[var(--ref-on-surface-variant)]">25 Aug – 24 Sep · 84 transactions</p>
        </div>
        <Chip className={closed ? 'bg-[var(--ref-on-surface)] text-[var(--color-surface)]' : 'bg-[var(--color-success)]/12 text-[var(--color-success)]'}>{closed ? 'Closed' : 'Open'}</Chip>
      </div>
    </VisualFrame>
  );
}

/** Pay later: one purchase becomes monthly installments with due dates. */
export function InstallmentDemo() {
  const { ref, step, replay } = useSequence(3, 500);
  const { payLater } = exampleAccounts(useHelpPersonal());
  const today = new Date();
  const months = [1, 2, 3].map((offset) => formatDayMonth(new Date(today.getFullYear(), today.getMonth() + offset, 10).getTime()));
  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption="A Rp600.000 purchase over 3 months, with no interest or fee.">
      <div className="mx-auto flex max-w-xl flex-col items-center gap-3 sm:flex-row">
        <div className="w-full rounded-xl bg-[var(--color-surface)] p-3 text-center shadow-sm ring-1 ring-[var(--color-border)] sm:w-44">
          <p className="truncate text-xs text-[var(--ref-on-surface-variant)]">Headphones · {payLater}</p>
          <p className="font-mono text-lg font-semibold tabular-nums text-[var(--ref-on-surface)]">Rp600.000</p>
        </div>
        <ArrowRight className="h-5 w-5 shrink-0 text-[var(--color-accent)] max-sm:rotate-90" aria-hidden />
        <ol className="grid w-full flex-1 grid-cols-3 gap-2">
          {months.map((month, index) => (
            <li key={month} className={cn('rounded-xl bg-[var(--color-surface)] p-2.5 text-center ring-1 ring-[var(--color-border)]', shown(step > index))}>
              <p className="flex items-center justify-center gap-1 text-[11px] text-[var(--ref-on-surface-variant)]"><Clock className="h-3 w-3" aria-hidden />{month}</p>
              <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-[var(--ref-on-surface)]">Rp200.000</p>
            </li>
          ))}
        </ol>
      </div>
    </VisualFrame>
  );
}

/** Split bill: a receipt divided between people; your share is spending, theirs is owed to you. */
export function SplitBillDemo() {
  const { ref, step, replay } = useSequence(3, 650);
  const people = [
    { name: 'You', note: 'your expense', initials: 'RA', tone: 'bg-[var(--color-accent)] text-white' },
    { name: 'Ani', note: 'owes you', initials: 'AN', tone: 'bg-[#ec4899] text-white' },
    { name: 'Budi', note: 'owes you', initials: 'BU', tone: 'bg-[#14b8a6] text-white' },
  ];
  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption="Split equally: only your share counts as spending; the rest becomes money owed to you in Loans.">
      <div className="mx-auto flex max-w-xl flex-col items-center gap-3 sm:flex-row">
        <div className="w-full rounded-xl bg-[var(--color-surface)] p-3 shadow-sm ring-1 ring-[var(--color-border)] sm:w-44">
          <p className="text-xs font-semibold text-[var(--ref-on-surface-variant)]">Receipt · Sushi dinner</p>
          <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-[var(--ref-on-surface)]">Rp300.000</p>
          <p className="text-[11px] text-[var(--ref-on-surface-variant)]">Paid by you</p>
        </div>
        <ArrowRight className="h-5 w-5 shrink-0 text-[var(--color-accent)] max-sm:rotate-90" aria-hidden />
        <ul className="w-full flex-1 space-y-2">
          {people.map((person, index) => (
            <li key={person.name} className={cn('flex items-center gap-2.5 rounded-xl bg-[var(--color-surface)] px-3 py-2 ring-1 ring-[var(--color-border)]', shown(step > index))}>
              <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold', person.tone)}>{person.initials}</span>
              <span className="min-w-0 flex-1 text-sm text-[var(--ref-on-surface)]">{person.name} <span className="text-xs text-[var(--ref-on-surface-variant)]">· {person.note}</span></span>
              <span className="font-mono text-sm tabular-nums text-[var(--ref-on-surface)]">Rp100.000</span>
            </li>
          ))}
        </ul>
      </div>
    </VisualFrame>
  );
}

/** A reimbursement claim moving through its statuses. */
export function ClaimPipelineDemo() {
  const { ref, step, replay } = useSequence(5, 700);
  const stages = ['Draft', 'Submitted', 'Approved', 'Paid', 'Settled'];
  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption="Move a claim along as it happens; Record payment when the money arrives.">
      <ol className="mx-auto flex max-w-xl items-center">
        {stages.map((stage, index) => {
          const reached = step > index;
          return (
            <li key={stage} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-1.5">
                <span className={cn('grid h-8 w-8 place-items-center rounded-full text-xs font-bold transition-colors duration-500', reached ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-surface)] text-[var(--ref-on-surface-variant)] ring-1 ring-[var(--color-border)]')}>{reached ? <Check className="h-4 w-4" aria-hidden /> : index + 1}</span>
                <span className={cn('text-[11px] font-semibold transition-colors', reached ? 'text-[var(--ref-on-surface)]' : 'text-[var(--ref-on-surface-variant)]')}>{stage}</span>
              </div>
              {index < stages.length - 1 && <span className="mx-1 mb-5 h-0.5 flex-1 rounded-full bg-[var(--color-border)]"><span className="block h-full rounded-full bg-[var(--color-accent)] transition-all duration-500" style={{ width: step > index + 1 ? '100%' : '0%' }} /></span>}
            </li>
          );
        })}
      </ol>
    </VisualFrame>
  );
}

/** Agent drafting an expense card that waits for your approval. */
export function AgentProposalDemo() {
  const { ref, step, replay } = useSequence(3, 1000);
  const { first } = exampleAccounts(useHelpPersonal());
  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption="Agent drafts; nothing posts until you press Confirm.">
      <div className="mx-auto max-w-md space-y-3">
        <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-[var(--color-accent)] px-3.5 py-2 text-sm text-white">Lunch 45k at the warteg, paid with {first}</p>
        <div className={cn('max-w-[92%] rounded-2xl rounded-bl-md bg-[var(--color-surface)] p-3.5 shadow-sm ring-1 ring-[var(--color-border)]', shown(step >= 1))}>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-[var(--ref-on-surface)]"><Sparkles className="h-3.5 w-3.5 text-[var(--color-accent)]" aria-hidden />Ready to review</p>
          <p className="text-xs text-[var(--ref-on-surface-variant)]">Nothing posts until you confirm.</p>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-sm font-semibold text-[var(--ref-on-surface)]">Lunch at warteg</span>
            <span className="font-mono text-sm font-semibold tabular-nums text-[var(--ref-on-surface)]">Rp45.000</span>
          </div>
          <p className="text-xs text-[var(--ref-on-surface-variant)]">Expense · Food & dining · {first} · Today</p>
          {step >= 3 ? (
            <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-[var(--color-success)]/12 px-2.5 py-1.5 text-xs font-semibold text-[var(--color-success)]"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />Posted successfully</p>
          ) : (
            <div className="mt-3 flex justify-end gap-2">
              <span className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--ref-on-surface)] ring-1 ring-[var(--color-border)]">Edit</span>
              <span className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--ref-on-surface-variant)]">Dismiss</span>
              <span className={cn('rounded-lg bg-[var(--color-accent)] px-2.5 py-1.5 text-xs font-semibold text-white transition-shadow', step >= 2 && 'ring-4 ring-[var(--color-accent)]/25')}>Confirm & post</span>
            </div>
          )}
        </div>
      </div>
    </VisualFrame>
  );
}

/** What an Agent answer is made of: the reply, a chart card, the scope it used, the evidence it checked, follow-ups. */
export function AgentAnswerDemo() {
  const { ref, step, replay } = useSequence(4, 800);
  const rows = [
    { name: 'Food & dining', value: 1_150_000, share: 0.42 },
    { name: 'Transport', value: 540_000, share: 0.2 },
    { name: 'Shopping', value: 820_000, share: 0.3 },
    { name: 'Other', value: 210_000, share: 0.08 },
  ];
  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption="Answers come with the period they used, the records they checked, and at most two charts.">
      <div className="mx-auto max-w-lg space-y-3">
        <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-[var(--color-accent)] px-3.5 py-2 text-sm text-white">Where did my money go this period?</p>
        <div className={cn('space-y-2.5', shown(step >= 1))}>
          <p className="text-sm leading-relaxed text-[var(--ref-on-surface)]">You’ve spent <strong>Rp2.720.000</strong> so far. Food & dining is the biggest share, mostly weekday lunches.</p>
          <div className={cn('rounded-xl bg-[var(--color-surface)] p-3 shadow-sm ring-1 ring-[var(--color-border)]', shown(step >= 2))}>
            <p className="text-xs font-semibold text-[var(--ref-on-surface-variant)]">Spending by category</p>
            <ul className="mt-2 space-y-1.5">
              {rows.map((row) => (
                <li key={row.name} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-2 text-xs">
                  <span className="truncate text-[var(--ref-on-surface)]">{row.name}</span>
                  <span className="h-1.5 rounded-full bg-[var(--ref-surface-container)]"><span className="block h-full rounded-full bg-[var(--color-accent)] transition-all duration-700" style={{ width: step >= 2 ? `${row.share * 100}%` : '0%' }} /></span>
                  <span className="font-mono tabular-nums text-[var(--ref-on-surface-variant)]">{rupiah(row.value)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className={cn('flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--ref-on-surface-variant)]', shown(step >= 3))}>
            <span className="rounded-full bg-[var(--color-surface)] px-2 py-1 ring-1 ring-[var(--color-border)]">Scope: this period</span>
            <span className="rounded-full bg-[var(--color-surface)] px-2 py-1 ring-1 ring-[var(--color-border)]">Evidence checked 2 ledger sources</span>
            <span className="font-semibold text-[var(--color-accent)]">Open transactions →</span>
          </div>
          <div className={cn('flex flex-wrap gap-1.5', shown(step >= 4))}>
            {['Compare with last period', 'Which lunches cost most?'].map((followUp) => (
              <span key={followUp} className="rounded-full border border-[var(--color-accent)]/30 bg-[color-mix(in_srgb,var(--color-accent)_6%,transparent)] px-2.5 py-1 text-xs font-medium text-[var(--color-accent)]">{followUp}</span>
            ))}
          </div>
        </div>
      </div>
    </VisualFrame>
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

/** Hidden balances: amounts turn into dots everywhere. */
export function HiddenBalanceDemo() {
  const { ref, step, replay } = useSequence(1, 600);
  const hidden = step >= 1;
  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption="One tap hides every amount; on the Dashboard, press and hold to peek.">
      <div className="mx-auto grid max-w-md grid-cols-2 gap-3">
        {[['Available cash', 'Rp4.250.000'], ['Net worth', 'Rp38.900.000']].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-[var(--color-surface)] p-3 ring-1 ring-[var(--color-border)]">
            <p className="text-xs text-[var(--ref-on-surface-variant)]">{label}</p>
            <p className="mt-1 font-mono text-base font-semibold tabular-nums text-[var(--ref-on-surface)]">{hidden ? '••••••' : value}</p>
          </div>
        ))}
      </div>
    </VisualFrame>
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
