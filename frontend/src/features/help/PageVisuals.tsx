import { useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, BookOpen, Database, Search, Sparkles, UserRound } from 'lucide-react';
import { Toggle } from '../settings/controls';
import { cn } from '../../lib/utils';
import { GoalsHero } from '../goals/GoalsHero';
import { ReachPanel, ThisMonthPanel } from '../goals/GoalsSidePanels';
import type { GoalsOverview } from '../goals/queries';
import type { Trip } from '../goals/trip/queries';
import { TripBudget } from '../goals/trip/TripBudget';
import { Segmented } from '../savings/fields';
import { DEFAULT_PLAN, goalOutlooks, planRange, runPlan, type PlanInputs } from '../savings/plan';
import { ProjectionChart, type ValueMode } from '../savings/ProjectionChart';
import { Section } from '../subscriptions/PageParts';
import { CAN_I, CHANGELOG, GLOSSARY } from './content';
import { shown, useAutoplay, useSequence } from './motion';
import { VisualFrame } from './visuals';

/**
 * One illustration for each remaining help page: loans, salary and subscriptions, savings, Agent’s
 * look-ups and context, settings, troubleshooting, and the reference pages. Sample figures only.
 */

const label = 'text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ref-on-surface-variant)]';
const card = 'rounded-xl bg-[var(--color-surface)] p-3.5 shadow-sm ring-1 ring-[var(--color-border)]';

// ── Savings ──────────────────────────────────────────────────────────

/** A sample plan for the help page: a savings account and SBN, a wedding paid from savings, and a house goal from SBN. */
const SAMPLE_PLAN: PlanInputs = {
  ...DEFAULT_PLAN,
  years: 10,
  pots: [
    { id: 'sample-cash', name: 'Tabungan', start: 10_000_000, monthly: 500_000, raise: 0, returnRate: 2.5, uncertainty: 'off' },
    { id: 'sample-sbn', name: 'SBN ritel', start: 0, monthly: 1_000_000, raise: 5, returnRate: 6.3, uncertainty: 'medium' },
  ],
  events: [{ id: 'sample-wedding', label: 'Wedding', month: 30, amount: -20_000_000, yearly: false, potId: 'sample-cash' }],
  goals: [{ id: 'sample-house', name: 'House down payment', amount: 100_000_000, byMonth: 84, potId: 'sample-sbn', spend: false, saved: 0 }],
};

const sampleGoal = {
  byDate: null, kind: 'keep' as const, status: 'active' as const, wishlistId: null, spentTransactionId: null, doneAt: null, setAsideThisMonth: 0,
  monthlyPercent: null, paused: false, icon: null, description: null, linkUrl: null, linkTitle: null, linkImage: null, accountId: null,
  expectedReturn: 0, recurrence: 'none' as const, categoryId: null, categorySince: null, reachMonths: null, coverAttachmentId: null,
  goalType: null, typeData: {},
};

/** Rp45 juta in three accounts, Rp29 juta of it in an emergency fund and a laptop. */
const SAMPLE_GOALS: GoalsOverview = {
  available: 45_000_000,
  setAside: 29_000_000,
  unassigned: 16_000_000,
  accounts: [
    { id: 1, name: 'BCA', liquidityClass: 'cash_equivalent', balance: 18_000_000, included: true },
    { id: 2, name: 'Jago', liquidityClass: 'cash_equivalent', balance: 12_000_000, included: true },
    { id: 3, name: 'Bibit', liquidityClass: 'investment', balance: 15_000_000, included: true },
  ],
  goals: [
    { ...sampleGoal, id: 1, name: 'Emergency fund', icon: '🛟', targetAmount: 30_000_000, monthlyAmount: 1_000_000, sortOrder: 0, setAside: 24_000_000, setAsideThisMonth: 1_000_000, reachMonths: 6 },
    { ...sampleGoal, id: 2, name: 'Laptop', icon: '💻', targetAmount: 18_000_000, kind: 'spend', byDate: new Date(2027, 5, 30).getTime(), monthlyAmount: 1_500_000, sortOrder: 1, setAside: 5_000_000, reachMonths: 9 },
    { ...sampleGoal, id: 3, name: 'Japan trip', icon: '✈️', targetAmount: 25_000_000, kind: 'spend', monthlyAmount: 0, sortOrder: 2, setAside: 0 },
  ],
  salary: null,
  autoFundOnPayday: false,
};

/** The Goals page’s own top card, drawn from sample goals; pick a goal in the bar to select it. */
export function GoalsShelfDemo() {
  const [selectedId, setSelectedId] = useState<number | null>(1);
  return (
    <VisualFrame caption="Try it: pick a goal in the bar (sample: Rp45 juta in three accounts, Rp29 juta in two goals, Rp16 juta still free).">
      <GoalsHero overview={SAMPLE_GOALS} selectedId={selectedId} onSelect={setSelectedId} onAdd={() => {}} />
    </VisualFrame>
  );
}

/** The two cards beside the goal list, This month and When you’ll get there, from the same sample. */
export function GoalsPlanDemo() {
  return (
    <VisualFrame caption="Sample: the emergency fund already got this month’s Rp1 juta; the laptop at Rp1,5 juta a month arrives a month after it’s needed; the trip has no monthly amount yet.">
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
        <ThisMonthPanel overview={SAMPLE_GOALS} funding={false} onFund={() => {}} />
        <ReachPanel overview={SAMPLE_GOALS} />
      </div>
    </VisualFrame>
  );
}

const tripBooking = { goalId: 1, startAt: null, endAt: null, place: null, address: null, code: null, cancelBy: null, details: {}, fileIds: [], partId: null, paidAt: null, paid: 0, sortOrder: 0 };
/** A sample week in Japan for two, priced partly in yen at Rp105,5. */
const SAMPLE_TRIP: Trip = {
  basics: { places: ['Tokyo', 'Kyoto'], startDate: new Date(2027, 2, 10, 12).getTime(), endDate: new Date(2027, 2, 16, 12).getTime(), currency: 'JPY', rate: 105.5, dailyBudget: 600_000, climate: 'cold' },
  travellers: [
    { id: 1, goalId: 1, name: 'You', paying: true, passportNumber: null, passportExpiry: null, visaStatus: 'not-needed', visaDate: null, insurance: null, sortOrder: 0 },
    { id: 2, goalId: 1, name: 'Sari', paying: true, passportNumber: null, passportExpiry: null, visaStatus: 'not-needed', visaDate: null, insurance: null, sortOrder: 1 },
  ],
  bookings: [
    { ...tripBooking, id: 1, kind: 'flight', title: 'Flights there and back', cost: 19_400_000, costCurrency: 'IDR', rupiah: 19_400_000, paidAt: 1, paid: 19_400_000 },
    { ...tripBooking, id: 2, kind: 'stay', title: 'Hotel in Shinjuku', cost: 63_000, costCurrency: 'JPY', rupiah: 6_646_500 },
    { ...tripBooking, id: 3, kind: 'transport', title: 'JR Pass, 7 days', cost: 50_000, costCurrency: 'JPY', rupiah: 5_275_000 },
  ],
  plans: [{ id: 1, goalId: 1, day: '2027-03-12', time: null, title: 'Kimono rental', place: null, cost: 8_000, costCurrency: 'JPY', rupiah: 844_000, sortOrder: 0 }],
  packing: [],
  spending: null,
};

/** A holiday's Budget card itself, from a sample week in Japan. */
export function TripBudgetDemo() {
  return (
    <VisualFrame caption="Sample: flights paid, a hotel and JR Pass priced in yen, one day’s plan, and Rp600 ribu spending money a day each for two people over seven days.">
      <TripBudget trip={SAMPLE_TRIP} target={42_000_000} />
    </VisualFrame>
  );
}

/** The simulator’s How it grows card itself, the real chart and switch, drawn from a sample plan. */
export function SavingsFanDemo() {
  const [mode, setMode] = useState<ValueMode>('nominal');
  const run = useMemo(() => runPlan(SAMPLE_PLAN), []);
  const range = useMemo(() => planRange(SAMPLE_PLAN), []);
  const outlooks = useMemo(() => goalOutlooks(SAMPLE_PLAN, range), [range]);

  return (
    <VisualFrame caption="Try it: switch between the two views and point at the chart (sample plan: Rp10 juta now, Rp1 juta a month, 6% a year, a wedding in year three, and a house goal marked on the line).">
      <Section title="How it grows" aside={<Segmented ariaLabel="Show amounts" className="w-[220px]" value={mode} onChange={setMode} options={[{ value: 'nominal', label: 'Rupiah then' }, { value: 'real', label: 'Today’s money' }]} />}>
        <div className="px-3 pb-3 pt-3 sm:px-5 sm:pb-4">
          <ProjectionChart run={run} range={range} mode={mode} years={SAMPLE_PLAN.years} compared={[]} outlooks={outlooks} selectedGoalId="sample-house" events={SAMPLE_PLAN.events} />
        </div>
      </Section>
    </VisualFrame>
  );
}

// ── Agent ────────────────────────────────────────────────────────────

/** Settings → Agent → What Agent can see, as in its dialog: the same groups, labels and descriptions, and which are on by default. */
const CONTEXT_GROUPS: Array<{ title: string; fields: Array<{ key: string; label: string; description: string; on: boolean; value: string }> }> = [
  { title: 'About you', fields: [
    { key: 'fullName', label: 'Full name', description: 'Use it in personalized greetings and summaries.', on: false, value: 'Samuel Hartono' },
    { key: 'preferredName', label: 'Preferred name', description: 'Use it when addressing you.', on: true, value: 'Sam' },
    { key: 'pronouns', label: 'Pronouns', description: 'Use them when they help phrase a response naturally.', on: false, value: 'he/him' },
    { key: 'age', label: 'Age', description: 'Share your derived age; your date of birth is never sent.', on: false, value: '27' },
  ] },
  { title: 'Region and language', fields: [
    { key: 'country', label: 'Country or region', description: 'Use it for relevant context and examples.', on: false, value: 'Indonesia' },
    { key: 'timezone', label: 'Timezone', description: 'Use it for dates, times, and reminders.', on: true, value: 'Asia/Jakarta' },
    { key: 'language', label: 'Language', description: 'Use it to choose the response language.', on: true, value: 'English' },
    { key: 'currency', label: 'Currency', description: 'Use it when formatting financial answers.', on: true, value: 'IDR' },
  ] },
  { title: 'Your finances', fields: [
    { key: 'incomePattern', label: 'Income pattern', description: 'Use it to tailor financial guidance.', on: false, value: 'Monthly salary' },
    { key: 'primaryGoal', label: 'Main financial goal', description: 'Use it to keep recommendations aligned.', on: false, value: 'Emergency fund' },
  ] },
  { title: 'Response style', fields: [
    { key: 'agentTone', label: 'Agent tone', description: 'Use your preferred conversational tone.', on: true, value: 'Warm' },
    { key: 'agentVerbosity', label: 'Agent detail', description: 'Use your preferred response depth.', on: true, value: 'Concise' },
  ] },
];
const CONTEXT_FIELDS = CONTEXT_GROUPS.flatMap((group) => group.fields);

/** What goes to the model with each question; switch profile details on and off to see the difference. */
export function AgentContextDemo() {
  const [fields, setFields] = useState(() => Object.fromEntries(CONTEXT_FIELDS.map((field) => [field.key, field.on])));
  const sharedFields = CONTEXT_FIELDS.filter((field) => fields[field.key]);
  const blocks: Array<{ icon: typeof Search; title: string; body: ReactNode }> = [
    { icon: Sparkles, title: 'Your question', body: 'Am I on track with my budget?' },
    { icon: Database, title: 'Records Agent looked up', body: 'Budget for this period, spending by category' },
    { icon: BookOpen, title: 'Your memories', body: '“Groceries include household supplies.” and 2 more' },
    { icon: UserRound, title: 'Profile details you share', body: sharedFields.length ? sharedFields.map((field) => `${field.label}: ${field.value}`).join(' · ') : 'Nothing shared' },
  ];
  return (
    <VisualFrame caption="Try it: switch profile details on or off (sample profile). Your real choices are in Settings → Agent → Profile details.">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center">
        <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
          <div className="border-b border-[var(--color-border)] p-4"><h2 className="font-mono text-lg font-bold">What Agent can see</h2></div>
          <div className="max-h-[22rem] overflow-y-auto px-4 pb-4 pt-3">
            <p className="text-sm text-[var(--ref-on-surface-variant)]">Choose which profile details Agent may use. Your date of birth itself is never sent.</p>
            {CONTEXT_GROUPS.map((group) => (
              <section key={group.title} className="mt-4">
                <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ref-on-surface-variant)]">{group.title}</h3>
                <div className="divide-y divide-[var(--color-border)]">
                  {group.fields.map((field) => (
                    <div key={field.key} className="flex items-center justify-between gap-4 py-2.5">
                      <span className="min-w-0"><span className="block text-sm font-medium text-[var(--ref-on-surface)]">{field.label}</span><span className="mt-0.5 block text-xs text-[var(--ref-on-surface-variant)]">{field.description}</span></span>
                      <Toggle label={field.label} checked={fields[field.key] ?? false} onChange={(checked) => setFields((current) => ({ ...current, [field.key]: checked }))} />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <div className="border-t border-[var(--color-border)] px-4 py-3 text-xs text-[var(--ref-on-surface-variant)]">{sharedFields.length} of {CONTEXT_FIELDS.length} shared</div>
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

/** The Dashboard’s own shortcuts card (press ? there), with each row lighting up in turn. */
export function ShortcutsDemo() {
  const rows = [
    { keys: ['←'], label: 'Previous period' },
    { keys: ['→'], label: 'Next period' },
    { keys: ['N'], label: 'New transaction' },
    { keys: ['H'], label: 'Hide or show balances' },
    { keys: ['?'], label: 'Show this list' },
  ];
  const { ref, index, setIndex, setPaused } = useAutoplay(rows.length, 1600);
  return (
    <VisualFrame frameRef={ref} caption="The list the Dashboard shows when you press ?. The rest of the shortcuts are in the table below.">
      <div className="mx-auto w-full max-w-xs rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-5 shadow-2xl" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        <h2 className="font-headline text-base font-extrabold text-[var(--ref-on-surface)]">Keyboard shortcuts</h2>
        <dl className="mt-4 space-y-2.5 text-sm">
          {rows.map((row, position) => (
            <div key={row.label} onMouseEnter={() => setIndex(position)} className={cn('-mx-2 flex items-center justify-between gap-4 rounded-lg px-2 py-0.5 transition-colors', position === index && 'bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)]')}>
              <dt className={position === index ? 'font-semibold text-[var(--ref-on-surface)]' : 'text-[var(--ref-on-surface-variant)]'}>{row.label}</dt>
              <dd className="flex gap-1">{row.keys.map((key) => <kbd key={key} className={cn('grid min-w-7 place-items-center rounded-md border px-1.5 py-0.5 font-mono text-xs font-semibold transition-colors', position === index ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white' : 'border-[var(--color-border)] bg-[var(--ref-surface-container-low)] text-[var(--ref-on-surface)]')}>{key}</kbd>)}</dd>
            </div>
          ))}
        </dl>
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
