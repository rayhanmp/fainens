import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Lock, RotateCcw } from 'lucide-react';
import { cn, formatDayMonth } from '../../lib/utils';
import { exampleAccounts, useHelpPersonal } from './personal';

/**
 * One salary period, step by step: each thing you'd do in Fainens, the ledger lines it posts, and
 * what that does to balances, debts and the budget. Amounts are a made-up example; account names
 * and dates are the reader's own.
 */

type Money = {
  cash: number;
  cash2: number;
  payLater: number;
  owed: number;
  income: number;
  housing: number;
  food: number;
  shopping: number;
  other: number;
};

type Line = { account: string; debit?: number; credit?: number; note?: string };

type Step = {
  day: number;
  title: string;
  /** Where to do it in Fainens. */
  how: string;
  explain: string;
  lines: Line[];
  change: Partial<Money>;
  closes?: boolean;
};

const START: Money = { cash: 500_000, cash2: 150_000, payLater: 0, owed: 0, income: 0, housing: 0, food: 0, shopping: 0, other: 0 };

const PLAN = { housing: 3_500_000, food: 1_500_000, shopping: 1_000_000 };

const STEPS: Step[] = [
  {
    day: 0,
    title: 'Payday: your salary arrives',
    how: 'Income & salary → Post salary',
    explain: 'Your take-home pay lands in {cash}. It’s income for this period, so the budget has something to plan against.',
    lines: [{ account: '{cash}', debit: 10_000_000 }, { account: 'Income (Auto)', credit: 10_000_000 }],
    change: { cash: 10_000_000, income: 10_000_000 },
  },
  {
    day: 1,
    title: 'Pay the rent',
    how: 'Add transaction → Expense, category Housing',
    explain: 'A plain expense. Housing is now fully used, exactly as planned.',
    lines: [{ account: 'Expense (Auto)', debit: 3_500_000, note: 'Housing' }, { account: '{cash}', credit: 3_500_000 }],
    change: { cash: -3_500_000, housing: 3_500_000 },
  },
  {
    day: 2,
    title: 'Top up {cash2}, with a Rp2.500 fee',
    how: 'Add transaction → Transfer, fee paid by sender',
    explain: 'Moving your own money isn’t spending. Only the Rp2.500 fee is, and it has no budget line, so it shows as unbudgeted.',
    lines: [{ account: '{cash2}', debit: 500_000 }, { account: '{cash}', credit: 500_000 }, { account: 'Expense (Auto)', debit: 2_500, note: 'Bank & Transfer Fees' }, { account: '{cash}', credit: 2_500 }],
    change: { cash: -502_500, cash2: 500_000, other: 2_500 },
  },
  {
    day: 5,
    title: 'Lunch… typed as Rp450.000',
    how: 'Add transaction → Expense, Food & dining',
    explain: 'An extra zero slipped in. Food & dining jumps to almost a third of its plan.',
    lines: [{ account: 'Expense (Auto)', debit: 450_000, note: 'Food & dining' }, { account: '{cash2}', credit: 450_000 }],
    change: { cash2: -450_000, food: 450_000 },
  },
  {
    day: 5,
    title: 'Fix the typo',
    how: 'Open the transaction → Correct it → Add replacement',
    explain: 'Posted entries are never erased. A correction cancels the Rp450.000 line for line, then the right Rp45.000 is recorded. Both stay in history.',
    lines: [{ account: '{cash2}', debit: 450_000 }, { account: 'Expense (Auto)', credit: 450_000, note: 'Correction' }, { account: 'Expense (Auto)', debit: 45_000, note: 'Food & dining' }, { account: '{cash2}', credit: 45_000 }],
    change: { cash2: 405_000, food: -405_000 },
  },
  {
    day: 12,
    title: 'Dinner for three, split with Ani and Budi',
    how: 'Agent → /split, then Create linked loans',
    explain: 'You paid Rp300.000, but only your Rp100.000 share is spending. The other Rp200.000 is owed to you.',
    lines: [{ account: 'Expense (Auto)', debit: 100_000, note: 'Your share' }, { account: 'Loans Receivable', debit: 200_000, note: 'Ani and Budi' }, { account: '{cash}', credit: 300_000 }],
    change: { cash: -300_000, food: 100_000, owed: 200_000 },
  },
  {
    day: 15,
    title: 'Headphones on {paylater}',
    how: 'Add transaction → Expense, paid from {paylater}, 3 installments',
    explain: 'Rp600.000 over 3 months at 12% a year with a Rp5.000 fee. The whole Rp623.000 counts as spending today; your cash doesn’t move yet.',
    lines: [{ account: 'Expense (Auto)', debit: 623_000, note: 'Shopping: price, interest and fee' }, { account: '{paylater}', credit: 623_000 }],
    change: { payLater: 623_000, shopping: 623_000 },
  },
  {
    day: 18,
    title: 'Ani pays you back',
    how: 'Loans → Ani → Record repayment',
    explain: 'Getting your money back isn’t income. What you’re owed goes down by the same amount.',
    lines: [{ account: '{cash2}', debit: 100_000 }, { account: 'Loans Receivable', credit: 100_000 }],
    change: { cash2: 100_000, owed: -100_000 },
  },
  {
    day: 25,
    title: 'Pay the first installment',
    how: 'Pay later → Pay now',
    explain: 'Rp211.000 (the fee is added to the first one) leaves {cash}. It lowers the debt, and spending doesn’t change: the headphones were counted when you bought them.',
    lines: [{ account: '{paylater}', debit: 211_000 }, { account: '{cash}', credit: 211_000 }],
    change: { cash: -211_000, payLater: -211_000 },
  },
  {
    day: -1,
    title: 'Reconcile, then close the period',
    how: 'Accounts → Reconcile, then Salary periods → Close period',
    explain: 'The {cash2} app shows Rp50.000 less than Fainens: probably a coffee you forgot. Reconciling corrects the balance without touching spending or the budget. Then closing locks the period.',
    lines: [{ account: 'Balance adjustments', debit: 50_000 }, { account: '{cash2}', credit: 50_000 }],
    change: { cash2: -50_000 },
    closes: true,
  },
];

/** The state after each step: index 0 is before anything happens. */
const STATES: Money[] = STEPS.reduce<Money[]>((states, step) => {
  const previous = states[states.length - 1]!;
  const next = { ...previous };
  for (const [key, value] of Object.entries(step.change) as Array<[keyof Money, number]>) next[key] += value;
  return [...states, next];
}, [START]);

const rupiah = (value: number) => `${value < 0 ? '−' : ''}Rp${Math.abs(value).toLocaleString('id-ID')}`;
const plain = (value: number) => value.toLocaleString('id-ID');

export function WorkedMonth() {
  const personal = useHelpPersonal();
  const { first, second, payLater } = exampleAccounts(personal);
  const named = (text: string) => text.replaceAll('{cash2}', second).replaceAll('{cash}', first).replaceAll('{paylater}', payLater);
  const [index, setIndex] = useState(0);
  const stripRef = useRef<HTMLDivElement>(null);

  // On narrow screens the step strip scrolls; keep the current step in view without moving the page.
  useEffect(() => {
    const strip = stripRef.current;
    const button = strip?.querySelector<HTMLElement>(`[data-step="${index}"]`);
    if (!strip || !button) return;
    const left = button.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft;
    if (left < strip.scrollLeft + 16 || left + button.offsetWidth > strip.scrollLeft + strip.clientWidth - 16) {
      strip.scrollTo({ left: left - strip.clientWidth / 2 + button.offsetWidth / 2, behavior: 'smooth' });
    }
  }, [index]);

  const now = new Date();
  const start = personal.currentPeriod ? new Date(personal.currentPeriod.startDate) : new Date(now.getFullYear(), now.getMonth(), Math.min(personal.salaryDay, 28));
  const end = personal.currentPeriod ? new Date(personal.currentPeriod.endDate) : new Date(start.getFullYear(), start.getMonth() + 1, start.getDate() - 1);
  const dateOf = (day: number) => (day < 0 ? end : new Date(start.getFullYear(), start.getMonth(), start.getDate() + day)).getTime();

  const before = STATES[index]!;
  const after = STATES[index + 1]!;
  const step = STEPS[index]!;
  const last = index === STEPS.length - 1;
  const spent = after.housing + after.food + after.shopping + after.other;

  const accounts = [
    { key: 'cash', name: first, kind: 'Account', value: after.cash, delta: after.cash - before.cash },
    { key: 'cash2', name: second, kind: 'Account', value: after.cash2, delta: after.cash2 - before.cash2 },
    { key: 'owed', name: 'Owed to you', kind: 'Loans', value: after.owed, delta: after.owed - before.owed, neutral: true },
    { key: 'payLater', name: payLater, kind: 'Pay-later debt', value: after.payLater, delta: after.payLater - before.payLater, neutral: true },
  ];
  const budget = [
    { name: 'Housing', spent: after.housing, plan: PLAN.housing, delta: after.housing - before.housing },
    { name: 'Food & dining', spent: after.food, plan: PLAN.food, delta: after.food - before.food },
    { name: 'Shopping', spent: after.shopping, plan: PLAN.shopping, delta: after.shopping - before.shopping },
  ];

  return (
    <figure className="not-prose my-6">
      <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)]">
        {/* Step strip */}
        <div ref={stripRef} className="flex items-center gap-1.5 overflow-x-auto border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 [scrollbar-width:none]" role="tablist" aria-label="Steps">
          {STEPS.map((item, position) => (
            <button
              key={position}
              data-step={position}
              type="button"
              role="tab"
              aria-selected={position === index}
              aria-label={`Step ${position + 1}: ${named(item.title)}`}
              onClick={() => setIndex(position)}
              className={cn(
                'grid h-7 min-w-7 shrink-0 place-items-center rounded-full px-2 text-xs font-semibold tabular-nums transition-colors',
                position === index ? 'bg-[var(--color-accent)] text-white' : position < index ? 'bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] text-[var(--color-accent)]' : 'bg-[var(--ref-surface-container)] text-[var(--ref-on-surface-variant)] hover:text-[var(--ref-on-surface)]',
              )}
            >
              {position + 1}
            </button>
          ))}
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          {/* Wide screens: what you did on the left, what it changed on the right, both in view at once. */}
          <div className="space-y-4 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1.75fr)] xl:items-start xl:gap-5 xl:space-y-0">
          {/* What happens */}
          <div key={index} className="animate-[finance-page-header-in_300ms_ease-out]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-accent)]">
              {step.day < 0 ? 'Last day' : `Day ${step.day + 1}`} · {formatDayMonth(dateOf(step.day))}
            </p>
            <h3 className="mt-1 text-lg font-semibold text-[var(--ref-on-surface)]">{named(step.title)}</h3>
            <p className="mt-1 text-xs font-medium text-[var(--ref-on-surface-variant)]">{named(step.how)}</p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--ref-on-surface)]">{named(step.explain)}</p>
            <div className="mt-3 overflow-x-auto rounded-xl bg-[var(--color-surface)] ring-1 ring-[var(--color-border)]">
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-[var(--ref-on-surface-variant)]">
                  <tr><th className="px-3 pb-1 pt-2 font-semibold">Ledger lines</th><th className="px-3 pb-1 pt-2 text-right font-semibold">Debit</th><th className="px-3 pb-1 pt-2 text-right font-semibold">Credit</th></tr>
                </thead>
                <tbody>
                  {step.lines.map((line, position) => (
                    <tr key={position} className="border-t border-[var(--color-border)]">
                      <td className="px-3 py-1.5 text-[var(--ref-on-surface)]">{named(line.account)}{line.note && <span className="ml-1.5 text-[var(--ref-on-surface-variant)]">· {line.note}</span>}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-[var(--ref-on-surface)]">{line.debit ? plain(line.debit) : ''}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-[var(--ref-on-surface)]">{line.credit ? plain(line.credit) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* The result */}
          <div className="grid gap-3 sm:grid-cols-2">
            <section className="rounded-xl bg-[var(--color-surface)] p-3 ring-1 ring-[var(--color-border)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ref-on-surface-variant)]">Balances</p>
              <ul className="mt-2 divide-y divide-[var(--color-border)]">
                {accounts.map((account) => (
                  <li key={account.key} className={cn('flex items-center justify-between gap-3 py-1.5 transition-colors duration-500', account.delta !== 0 && 'rounded-md bg-[color-mix(in_srgb,var(--color-accent)_7%,transparent)] px-1.5 -mx-1.5')}>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-[var(--ref-on-surface)]">{account.name}</span>
                      <span className="block text-[11px] text-[var(--ref-on-surface-variant)]">{account.kind}</span>
                    </span>
                    <span className="text-right">
                      <span className="block font-mono text-sm tabular-nums text-[var(--ref-on-surface)]">{rupiah(account.value)}</span>
                      {account.delta !== 0 && <Delta value={account.delta} neutral={account.neutral} />}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-xl bg-[var(--color-surface)] p-3 ring-1 ring-[var(--color-border)]">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ref-on-surface-variant)]">This period</p>
                {step.closes && <span className="inline-flex items-center gap-1 rounded-full bg-[var(--ref-surface-container)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ref-on-surface-variant)]"><Lock className="h-3 w-3" aria-hidden />Closed</span>}
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-[var(--ref-surface-container-low)] px-2.5 py-2">
                  <dt className="text-[11px] text-[var(--ref-on-surface-variant)]">Income</dt>
                  <dd className="font-mono text-sm font-semibold tabular-nums text-[var(--color-success)]">{rupiah(after.income)}</dd>
                </div>
                <div className="rounded-lg bg-[var(--ref-surface-container-low)] px-2.5 py-2">
                  <dt className="text-[11px] text-[var(--ref-on-surface-variant)]">Spent</dt>
                  <dd className="font-mono text-sm font-semibold tabular-nums text-[var(--ref-on-surface)]">{rupiah(spent)}</dd>
                </div>
              </dl>
              <div className="mt-3 space-y-2.5">
                {budget.map((row) => {
                  const share = row.spent / row.plan;
                  return (
                    <div key={row.name}>
                      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                        <span className="font-medium text-[var(--ref-on-surface)]">{row.name}</span>
                        <span className="font-mono tabular-nums text-[var(--ref-on-surface-variant)]">{plain(row.spent)} / {plain(row.plan)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-[var(--ref-surface-container)]">
                        <div className={cn('h-full rounded-full transition-[width] duration-700 ease-out', share >= 1 ? 'bg-[var(--color-warning)]' : 'bg-[var(--color-success)]', row.delta !== 0 && 'shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]')} style={{ width: `${Math.min(100, share * 100)}%` }} />
                      </div>
                    </div>
                  );
                })}
                <p className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="text-[var(--ref-on-surface-variant)]">Unbudgeted</span>
                  <span className="font-mono tabular-nums text-[var(--ref-on-surface-variant)]">{plain(after.other)}</span>
                </p>
              </div>
            </section>
          </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={() => setIndex((value) => value - 1)} disabled={index === 0} className="inline-flex h-[34px] items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-[var(--ref-on-surface-variant)] ring-1 ring-[var(--color-border)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--ref-on-surface)] disabled:pointer-events-none disabled:opacity-40">
              <ArrowLeft className="h-4 w-4" aria-hidden />Back
            </button>
            <span className="text-xs tabular-nums text-[var(--ref-on-surface-variant)]">Step {index + 1} of {STEPS.length}</span>
            {last ? (
              <button type="button" onClick={() => setIndex(0)} className="inline-flex h-[34px] items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-[var(--ref-on-surface-variant)] ring-1 ring-[var(--color-border)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--ref-on-surface)]">
                <RotateCcw className="h-4 w-4" aria-hidden />Start over
              </button>
            ) : (
              <button type="button" onClick={() => setIndex((value) => value + 1)} className="inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 text-sm font-semibold text-white transition-opacity hover:opacity-90">
                Next<ArrowRight className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
        </div>
      </div>
      <figcaption className="mt-2 text-center text-xs text-[var(--ref-on-surface-variant)]">
        Example amounts, with your account names and {personal.currentPeriod ? 'your current period’s dates' : 'your salary day'}. {first} starts at Rp500.000 and {second} at Rp150.000.
      </figcaption>
    </figure>
  );
}

/** A balance change: green in, red out; debts and loans stay neutral, since up isn’t good or bad there. */
function Delta({ value, neutral }: { value: number; neutral?: boolean }) {
  return <span className={cn('block font-mono text-[11px] font-semibold tabular-nums', neutral ? 'text-[var(--ref-on-surface-variant)]' : value > 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]')}>{value > 0 ? '+' : '−'}{plain(Math.abs(value))}</span>;
}
