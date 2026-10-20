import { useState, type ReactNode } from 'react';
import { ArrowRight, BookOpen, CheckCircle2, Database, Search, Sparkles, UserRound } from 'lucide-react';
import { cn } from '../../lib/utils';
import { CAN_I, CHANGELOG, GLOSSARY, SHORTCUTS } from './content';
import { shown, useAutoplay, useSequence } from './motion';
import { VisualFrame } from './visuals';

/**
 * One illustration for each remaining help page: loans, salary and subscriptions, savings, Agent’s
 * look-ups and context, settings, troubleshooting, and the reference pages. Sample figures only.
 */

const rupiah = (value: number) => `Rp${Math.round(value).toLocaleString('id-ID')}`;

const label = 'text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ref-on-surface-variant)]';
const card = 'rounded-xl bg-[var(--color-surface)] p-3.5 shadow-sm ring-1 ring-[var(--color-border)]';

// ── Loans ────────────────────────────────────────────────────────────

/** A loan to a friend, paid back in two parts, with the totals updating. */
export function LoanRepaymentDemo() {
  const { ref, step, replay } = useSequence(3, 1100);
  const lent = 500_000;
  const repaid = step >= 3 ? 500_000 : step >= 2 ? 200_000 : 0;
  const left = lent - repaid;
  const events = [
    { show: step >= 1, text: `Lent ${rupiah(lent)}`, sub: '3 Oct · from BCA' },
    { show: step >= 2, text: `Repaid ${rupiah(200_000)}`, sub: '10 Oct · into GoPay' },
    { show: step >= 3, text: `Repaid ${rupiah(300_000)}`, sub: '18 Oct · into BCA' },
  ];
  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption="What’s owed goes down with each repayment; none of it counts as income or spending.">
      <div className="mx-auto grid max-w-xl gap-4 sm:grid-cols-[1.1fr_1fr]">
        <div className={card}>
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--ref-surface-container)] text-sm font-bold text-[var(--ref-on-surface)]">A</span>
            <span><span className="block text-sm font-semibold text-[var(--ref-on-surface)]">Ani</span><span className="block text-xs text-[var(--ref-on-surface-variant)]">Friend</span></span>
            <span className={cn('ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors', left === 0 && step >= 1 ? 'bg-[var(--color-success)]/12 text-[var(--color-success)]' : 'bg-[var(--ref-surface-container)] text-[var(--ref-on-surface-variant)]')}>{left === 0 && step >= 1 ? 'Repaid' : 'Active'}</span>
          </div>
          <div className="mt-3 flex items-baseline justify-between text-xs"><span className="text-[var(--ref-on-surface-variant)]">Left to pay you</span><span className="font-mono text-sm font-semibold tabular-nums text-[var(--ref-on-surface)]">{rupiah(step >= 1 ? left : 0)}</span></div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--ref-surface-container)]"><div className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-700" style={{ width: step >= 1 ? `${(left / lent) * 100}%` : '0%' }} /></div>
          <ol className="mt-3 space-y-1.5">
            {events.map((event) => (
              <li key={event.text} className={cn('flex items-center justify-between text-xs', shown(event.show))}><span className="text-[var(--ref-on-surface)]">{event.text}</span><span className="text-[var(--ref-on-surface-variant)]">{event.sub}</span></li>
            ))}
          </ol>
        </div>
        <dl className="grid content-start gap-2">
          {[['Owed to you', step >= 1 ? left : 0], ['You owe', 0], ['Net', step >= 1 ? left : 0]].map(([name, value]) => (
            <div key={name} className="flex items-baseline justify-between rounded-xl bg-[var(--color-surface)] px-3.5 py-2.5 ring-1 ring-[var(--color-border)]">
              <dt className="text-xs text-[var(--ref-on-surface-variant)]">{name}</dt>
              <dd className="font-mono text-sm font-semibold tabular-nums text-[var(--ref-on-surface)] transition-all">{rupiah(value as number)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </VisualFrame>
  );
}

// ── Savings ──────────────────────────────────────────────────────────

/** A Monte Carlo projection: the middle line, the 10–90% range around it, and the goal. */
export function SavingsFanDemo() {
  const { ref, step, replay } = useSequence(2, 900);
  const years = 10;
  // Balances in millions at the end of each year, for the three outcomes.
  const p50 = [10, 23, 37, 53, 70, 89, 110, 132, 157, 184, 213];
  const p10 = p50.map((value, year) => value * (1 - 0.035 * year));
  const p90 = p50.map((value, year) => value * (1 + 0.045 * year));
  const goal = 120;
  const max = 300;
  const x = (year: number) => 30 + (year / years) * 440;
  const y = (value: number) => 190 - (value / max) * 170;
  const path = (values: number[]) => values.map((value, year) => `${year === 0 ? 'M' : 'L'}${x(year)},${y(value)}`).join(' ');
  const band = `${path(p90)} ${[...p10].reverse().map((value, index) => `L${x(years - index)},${y(value)}`).join(' ')} Z`;
  const reachYear = p50.findIndex((value) => value >= goal);

  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption="Sample plan: Rp10 juta now, Rp1 juta a month, 6% a year with 10% volatility.">
      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr] lg:items-center">
        <svg viewBox="0 0 490 215" className="w-full" role="img" aria-label="Projected balance over ten years, with a range of outcomes">
          {[0, 100, 200, 300].map((value) => (
            <g key={value}><line x1="30" x2="470" y1={y(value)} y2={y(value)} stroke="var(--color-border)" strokeDasharray="3 4" /><text x="0" y={y(value) + 4} fontSize="10" fill="var(--color-muted)">{value === 0 ? '0' : `${value} jt`}</text></g>
          ))}
          {[0, 5, 10].map((year) => <text key={year} x={x(year)} y="208" fontSize="10" textAnchor="middle" fill="var(--color-muted)">{year === 0 ? 'Now' : `${year} yrs`}</text>)}
          <path d={band} fill="var(--color-accent)" className="transition-opacity duration-700" style={{ opacity: step >= 2 ? 0.14 : 0 }} />
          <line x1="30" x2="470" y1={y(goal)} y2={y(goal)} stroke="var(--color-success)" strokeWidth="1.5" />
          <text x="466" y={y(goal) - 5} fontSize="10" textAnchor="end" fill="var(--color-success)" fontWeight="600">Goal 120 jt</text>
          <path d={path(p50)} fill="none" stroke="var(--color-accent)" strokeWidth="3" strokeLinecap="round" pathLength={1} strokeDasharray="1" className="transition-[stroke-dashoffset] duration-1000 ease-out" style={{ strokeDashoffset: step >= 1 ? 0 : 1 }} />
          {step >= 1 && <circle cx={x(reachYear)} cy={y(p50[reachYear]!)} r="5" fill="var(--color-success)" stroke="var(--color-surface)" strokeWidth="2" />}
        </svg>
        <div className="space-y-2 text-xs">
          <p className="flex items-center gap-2"><span className="h-1 w-5 rounded-full bg-[var(--color-accent)]" /><span><strong className="text-[var(--ref-on-surface)]">p50</strong> <span className="text-[var(--ref-on-surface-variant)]">the middle outcome</span></span></p>
          <p className="flex items-center gap-2"><span className="h-3 w-5 rounded-sm bg-[var(--color-accent)]/15" /><span><strong className="text-[var(--ref-on-surface)]">p10 to p90</strong> <span className="text-[var(--ref-on-surface-variant)]">8 in 10 runs land here</span></span></p>
          <p className={cn('rounded-lg bg-[var(--color-success)]/10 px-3 py-2 text-[var(--ref-on-surface)]', shown(step >= 1))}>Time to goal: about <strong>{reachYear} years</strong> on the middle outcome.</p>
        </div>
      </div>
    </VisualFrame>
  );
}

// ── Agent ────────────────────────────────────────────────────────────

const PROFILE_FIELDS: Array<{ key: string; name: string; on: boolean; value: string }> = [
  { key: 'preferred', name: 'Preferred name', on: true, value: 'Sam' },
  { key: 'timezone', name: 'Time zone', on: true, value: 'Asia/Jakarta' },
  { key: 'language', name: 'Language', on: true, value: 'English' },
  { key: 'currency', name: 'Currency', on: true, value: 'IDR' },
  { key: 'tone', name: 'Tone', on: true, value: 'Warm' },
  { key: 'full', name: 'Full name', on: false, value: 'Samuel Hartono' },
  { key: 'age', name: 'Age', on: false, value: '27' },
  { key: 'goal', name: 'Main goal', on: false, value: 'Emergency fund' },
];

/** What goes to the model with each question; switch profile details on and off to see the difference. */
export function AgentContextDemo() {
  const [fields, setFields] = useState(() => Object.fromEntries(PROFILE_FIELDS.map((field) => [field.key, field.on])));
  const sharedFields = PROFILE_FIELDS.filter((field) => fields[field.key]);
  const blocks: Array<{ icon: typeof Search; title: string; body: ReactNode }> = [
    { icon: Sparkles, title: 'Your question', body: 'Am I on track with my budget?' },
    { icon: Database, title: 'Records Agent looked up', body: 'Budget for this period, spending by category' },
    { icon: BookOpen, title: 'Your memories', body: '“Groceries include household supplies.” and 2 more' },
    { icon: UserRound, title: 'Profile details you share', body: sharedFields.length ? sharedFields.map((field) => `${field.name}: ${field.value}`).join(' · ') : 'Nothing shared' },
  ];
  return (
    <VisualFrame caption="Try it: switch profile details on or off. This is a demo; your real choices are in Settings → Agent.">
      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr] lg:items-center">
        <div>
          <p className={label}>What Agent can see</p>
          <ul className="mt-2 grid grid-cols-2 gap-1.5">
            {PROFILE_FIELDS.map((field) => (
              <li key={field.key}>
                <button type="button" aria-pressed={fields[field.key]} onClick={() => setFields((current) => ({ ...current, [field.key]: !current[field.key] }))} className={cn('flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs ring-1 transition-colors', fields[field.key] ? 'bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] font-semibold text-[var(--color-accent)] ring-[var(--color-accent)]/30' : 'bg-[var(--color-surface)] text-[var(--ref-on-surface-variant)] ring-[var(--color-border)]')}>
                  {field.name}<span className={cn('h-3.5 w-6 rounded-full p-0.5 transition-colors', fields[field.key] ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border-strong)]')}><span className={cn('block h-2.5 w-2.5 rounded-full bg-white transition-transform', fields[field.key] && 'translate-x-2.5')} /></span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <p className={label}>Sent with your question</p>
            {blocks.map((block) => (
              <div key={block.title} className="flex gap-2.5 rounded-xl bg-[var(--color-surface)] px-3 py-2 ring-1 ring-[var(--color-border)]">
                <block.icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent)]" aria-hidden />
                <span className="min-w-0"><span className="block text-xs font-semibold text-[var(--ref-on-surface)]">{block.title}</span><span className="block text-xs text-[var(--ref-on-surface-variant)] [overflow-wrap:anywhere]">{block.body}</span></span>
              </div>
            ))}
          </div>
          <ArrowRight className="hidden h-5 w-5 shrink-0 text-[var(--color-accent)] sm:block" aria-hidden />
          <div className="hidden w-24 shrink-0 rounded-xl border border-dashed border-[var(--color-border-strong)] p-3 text-center text-xs font-semibold text-[var(--ref-on-surface-variant)] sm:block">The model provider you chose</div>
        </div>
      </div>
    </VisualFrame>
  );
}

// ── Troubleshooting ──────────────────────────────────────────────────

/** Tracking down a balance that doesn’t match the bank. */
export function MismatchDemo() {
  const { ref, step, replay } = useSequence(4, 1000);
  const fixed = step >= 4;
  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption="Look for a missing or doubled transaction first; reconcile what’s left.">
      <div className="mx-auto max-w-lg space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {[['Fainens says', fixed ? 950_000 : 1_000_000], ['BCA app says', 950_000]].map(([name, value]) => (
            <div key={name} className={cn(card, 'transition-colors', fixed && 'ring-[var(--color-success)]/40')}>
              <p className="text-xs text-[var(--ref-on-surface-variant)]">{name}</p>
              <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-[var(--ref-on-surface)]">{rupiah(value as number)}</p>
            </div>
          ))}
        </div>
        <p className={cn('flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors', fixed ? 'bg-[var(--color-success)]/12 text-[var(--color-success)]' : 'bg-[var(--color-warning)]/12 text-[var(--color-warning)]', shown(step >= 1))}>
          {fixed ? <><CheckCircle2 className="h-4 w-4" aria-hidden />Balances match, nothing to adjust</> : 'Difference: Rp50.000 missing from Fainens'}
        </p>
        <div className={cn(card, 'flex items-center gap-3', shown(step >= 2))}>
          <Search className="h-4 w-4 shrink-0 text-[var(--color-accent)]" aria-hidden />
          <span className="min-w-0 flex-1 text-xs text-[var(--ref-on-surface)]">In the BCA app: <strong>Kopi Kenangan, Rp50.000</strong> on Thursday, not in Fainens</span>
          <span className={cn('shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors', step >= 3 ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-accent)] ring-1 ring-[var(--color-accent)]/40')}>{step >= 3 ? 'Recorded' : 'Add it'}</span>
        </div>
      </div>
    </VisualFrame>
  );
}

// ── Reference ────────────────────────────────────────────────────────

/** How the answers on the Can I…? page add up. */
export function CanISummaryDemo() {
  const { ref, step, replay } = useSequence(1, 300);
  const counts = { yes: CAN_I.filter((item) => item.answer === 'yes').length, partly: CAN_I.filter((item) => item.answer === 'partly').length, no: CAN_I.filter((item) => item.answer === 'no').length };
  const total = CAN_I.length;
  const parts = [
    { key: 'yes', name: 'Yes', className: 'bg-[var(--color-success)]' },
    { key: 'partly', name: 'Partly', className: 'bg-[var(--color-warning)]' },
    { key: 'no', name: 'Not yet', className: 'bg-[var(--color-border-strong)]' },
  ] as const;
  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption={`${total} common questions, answered honestly below.`}>
      <div className="mx-auto max-w-lg">
        <div className="flex h-4 overflow-hidden rounded-full bg-[var(--color-surface)] ring-1 ring-[var(--color-border)]">
          {parts.map((part, index) => <span key={part.key} className={cn('h-full transition-[width] duration-700 ease-out', part.className)} style={{ width: step >= 1 ? `${(counts[part.key] / total) * 100}%` : '0%', transitionDelay: `${index * 150}ms` }} />)}
        </div>
        <ul className="mt-3 flex justify-center gap-5 text-xs">
          {parts.map((part) => <li key={part.key} className="flex items-center gap-1.5 text-[var(--ref-on-surface-variant)]"><span className={cn('h-2.5 w-2.5 rounded-sm', part.className)} /><strong className="text-[var(--ref-on-surface)]">{counts[part.key]}</strong>{part.name}</li>)}
        </ul>
      </div>
    </VisualFrame>
  );
}

/** A keyboard strip: each shortcut lights up in turn with what it does. */
export function ShortcutsDemo() {
  const featured = SHORTCUTS.filter((shortcut) => ['New transaction', 'Hide or show balances', 'Previous or next period', 'Close the top menu or dialog', 'All dashboard shortcuts', 'Jump to the page’s search'].includes(shortcut.action));
  const { ref, index, setIndex, setPaused } = useAutoplay(featured.length, 1800);
  const active = featured[index]!;
  return (
    <VisualFrame frameRef={ref} caption="Tap or point at a key to see what it does.">
      <div className="mx-auto max-w-xl" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        <div className="flex flex-wrap justify-center gap-2">
          {featured.map((shortcut, position) => (
            <button key={shortcut.action} type="button" onMouseEnter={() => setIndex(position)} onFocus={() => setIndex(position)} className="flex gap-1">
              {shortcut.keys.map((key) => (
                <kbd key={key} className={cn('inline-flex h-11 min-w-11 items-center justify-center rounded-lg border border-b-4 px-2.5 font-sans text-sm font-semibold transition-all duration-200', position === index ? 'translate-y-0.5 border-[var(--color-accent)] border-b-2 bg-[var(--color-accent)] text-white' : 'border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--ref-on-surface)]')}>{key}</kbd>
              ))}
            </button>
          ))}
        </div>
        <p key={active.action} className="mt-4 animate-[finance-page-header-in_250ms_ease-out] text-center text-sm text-[var(--ref-on-surface)]"><strong>{active.action}</strong> <span className="text-[var(--ref-on-surface-variant)]">· {active.where}</span></p>
      </div>
    </VisualFrame>
  );
}

/** A flash card that cycles through the glossary. */
export function GlossaryCardDemo() {
  const { ref, index, setIndex, setPaused } = useAutoplay(GLOSSARY.length, 3200);
  const [term, meaning] = GLOSSARY[index]!;
  return (
    <VisualFrame frameRef={ref} caption={`${GLOSSARY.length} terms, all listed below. Hover to pause.`}>
      <div className="mx-auto max-w-md" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        <div key={term} className={cn(card, 'animate-[finance-page-header-in_350ms_ease-out] p-5 text-center')}>
          <p className={label}>Term {index + 1} of {GLOSSARY.length}</p>
          <p className="mt-2 font-headline text-2xl font-bold text-[var(--ref-on-surface)]">{term}</p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--ref-on-surface-variant)]">{meaning}</p>
        </div>
        <div className="mt-3 flex justify-center gap-2">
          <button type="button" onClick={() => setIndex((index - 1 + GLOSSARY.length) % GLOSSARY.length)} className="rounded-lg px-3 py-1 text-xs font-semibold text-[var(--ref-on-surface-variant)] ring-1 ring-[var(--color-border)] hover:text-[var(--ref-on-surface)]">Previous</button>
          <button type="button" onClick={() => setIndex((index + 1) % GLOSSARY.length)} className="rounded-lg px-3 py-1 text-xs font-semibold text-[var(--ref-on-surface-variant)] ring-1 ring-[var(--color-border)] hover:text-[var(--ref-on-surface)]">Next</button>
        </div>
      </div>
    </VisualFrame>
  );
}

/** The newest month’s highlights, dealt out as cards. */
export function WhatsNewDemo() {
  const latest = CHANGELOG[0]!;
  const highlights = latest.highlights.slice(0, 4);
  const { ref, step, replay } = useSequence(highlights.length, 450);
  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption={`New in ${latest.month}. The full history is below.`}>
      <div className="grid gap-3 sm:grid-cols-2">
        {highlights.map((highlight, index) => (
          <div key={highlight.title} className={cn(card, 'flex gap-3', shown(step > index))}>
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] text-xs font-bold text-[var(--color-accent)]">{index + 1}</span>
            <span><span className="block text-sm font-semibold text-[var(--ref-on-surface)]">{highlight.title}</span><span className="mt-0.5 block text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">{highlight.body}</span></span>
          </div>
        ))}
      </div>
    </VisualFrame>
  );
}
