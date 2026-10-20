import { useMemo, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronUp, Copy, Database, Download, Pencil, RefreshCw } from 'lucide-react';
import { AgentMessage } from '../../components/agent/AgentMessage';
import { AgentOrb } from '../../components/ui/AgentOrb';
import { Button } from '../../components/ui/Button';
import { transactionProposalStatusLabel } from '../agent/proposal-utils';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn, formatDateTime } from '../../lib/utils';
import { shown, useSequence } from './motion';
import { exampleAccounts, useHelpPersonal } from './personal';
import { VisualFrame } from './visuals';

/**
 * Agent, drawn with the Agent page's own pieces: the real message renderer and chart cards, the
 * real orb and buttons, and exact copies of the draft card, activity box and evidence trace (those
 * live inside the Agent page and can’t run here without writing). Sample conversations only.
 */

/** The Agent page’s conversation column. */
function Conversation({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-2xl space-y-5 rounded-2xl bg-[var(--color-background)] p-4 ring-1 ring-[var(--color-border)] sm:p-5">{children}</div>;
}

function UserMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end gap-3">
      <div className="w-fit max-w-[min(32rem,85%)] break-words rounded-xl border border-transparent bg-[var(--ref-primary-container)] px-4 py-3 text-sm text-white">{children}</div>
    </div>
  );
}

const actionButton = 'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-[var(--color-text-secondary)]';

/** An answer’s footer: actions, scope and revision chips, and the evidence trace. */
function AnswerFooter({ scope, revision, sources }: { scope: string; revision: number; sources: number }) {
  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-[var(--color-border)] pt-2">
        <span className={actionButton}><Copy className="h-3.5 w-3.5" /> Copy</span>
        <span className={actionButton}><RefreshCw className="h-3.5 w-3.5" /> Regenerate</span>
        <span className={actionButton}><Download className="h-3.5 w-3.5" /> Save note</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[var(--color-text-secondary)]">
        <span className="rounded-full bg-[var(--ref-surface-container-low)] px-2 py-1">Scope: {scope}</span>
        <span className="rounded-full bg-[var(--ref-surface-container-low)] px-2 py-1">Revision {revision}</span>
      </div>
      <div className="mt-4">
        <div className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">
          <span className="flex min-w-0 items-center gap-2"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-[var(--ref-primary)]/10 text-[var(--ref-primary)]"><Database className="h-3.5 w-3.5" /></span><span>Evidence checked <strong className="font-semibold text-[var(--color-text-primary)]">{sources} ledger source{sources === 1 ? '' : 's'}</strong></span></span>
          <ChevronDown className="h-4 w-4 shrink-0" />
        </div>
      </div>
    </>
  );
}

/** The live activity box shown while Agent works. */
function ActivityBox({ steps, current }: { steps: string[]; current: number }) {
  const done = steps.slice(0, current);
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2.5">
      <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">
        <AgentOrb active className="agent-orb-small" />
        <span className="min-w-0 flex-1 truncate">{steps[current]}…</span>
        {done.length > 0 && <span className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-[var(--color-text-secondary)]"><ChevronUp className="h-4 w-4" /></span>}
      </div>
      {done.length > 0 && (
        <ol className="mt-2 space-y-1 border-l border-[var(--color-border)] pl-3 text-xs text-[var(--color-text-secondary)]">
          {done.map((step) => <li key={step} className="flex items-center gap-2"><Check className="h-3 w-3 shrink-0 text-[var(--color-success)]" /><span className="truncate">{step}</span></li>)}
        </ol>
      )}
    </div>
  );
}

/** A full answer: the reply, a real chart card with its follow-ups, then scope and evidence. */
export function AgentAnswerDemo() {
  const { ref, step, replay } = useSequence(3, 1100);
  const chart = useMemo(() => [{
    type: 'ranked_bar',
    title: 'Spending by category',
    unit: 'IDR',
    items: [{ label: 'Food & dining', value: 1_150_000 }, { label: 'Shopping', value: 820_000 }, { label: 'Transport', value: 540_000 }, { label: 'Other', value: 210_000 }],
    provenance: { tool: 'get_category_spending', evidenceId: 'help-1', revision: 128 },
    actions: { open: { href: '/transactions', label: 'Open transactions' }, followUps: ['Compare with last period', 'Which lunches cost the most?'] },
  }], []);
  const steps = ['Checking matching transactions', 'Comparing spending categories', 'Preparing a useful visual'];

  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption="A sample answer, drawn with Agent’s own message and chart components.">
      <Conversation>
        <UserMessage>Where did my money go this period?</UserMessage>
        {step === 1 && <ActivityBox steps={steps} current={2} />}
        {step >= 2 && (
          <div className={cn('text-sm text-[var(--color-text-primary)]', shown(step >= 2))}>
            <AgentMessage presentations={chart} onAsk={() => undefined}>{'You’ve spent **Rp2.720.000** so far this period. **Food & dining** is the biggest share, mostly weekday lunches; shopping is second after one larger purchase.'}</AgentMessage>
            <div className={shown(step >= 3)}><AnswerFooter scope="This period" revision={128} sources={3} /></div>
          </div>
        )}
      </Conversation>
    </VisualFrame>
  );
}

/** Agent working through its look-ups, step by step, before it answers. */
export function AgentLookupDemo() {
  const { ref, step, replay } = useSequence(4, 900);
  const steps = ['Loading the right finance tools', 'Checking matching transactions', 'Comparing periods'];
  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption="Agent checks your records before answering; tap the activity to see each step.">
      <Conversation>
        <UserMessage>How much did I spend on Grab this period compared with last?</UserMessage>
        {step >= 1 && step <= 3 && <ActivityBox steps={steps} current={step - 1} />}
        {step >= 4 && (
          <div className="text-sm text-[var(--color-text-primary)]">
            <AgentMessage>{'You’ve spent **Rp540.000** on Grab this period, up from **Rp410.000** last period (**+32%**). Most of the increase is weekday evening rides.'}</AgentMessage>
            <AnswerFooter scope="This period" revision={128} sources={3} />
          </div>
        )}
      </Conversation>
    </VisualFrame>
  );
}

/** The draft card Agent shows for a transaction, as on the Agent page; Confirm & post is pressed for you. */
export function AgentProposalDemo() {
  const { ref, step, replay } = useSequence(3, 1100);
  const { formatAmount } = useBalanceVisibility();
  const { first } = exampleAccounts(useHelpPersonal());
  const [now] = useState(() => Date.now());
  const posted = step >= 3;
  const status = posted ? 'executed' : 'pending';
  const amount = 45_000;
  const field = (term: string, value: string) => (
    <div className="min-w-0"><dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">{term}</dt><dd className="mt-1 truncate font-medium text-[var(--color-text-primary)]">{value}</dd></div>
  );

  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption="Agent drafts; nothing posts until you press Confirm & post.">
      <Conversation>
        <UserMessage>Lunch 45k at the warteg, paid with {first}</UserMessage>
        <section className={cn('overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm', shown(step >= 1))}>
          <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[var(--ref-primary)]/10 text-[var(--ref-primary)]"><Check className="h-4 w-4" /></span>
              <div className="min-w-0"><p className="text-sm font-semibold text-[var(--color-text-primary)]">Ready to review</p><p className="text-xs text-[var(--color-text-secondary)]">Nothing posts until you confirm.</p></div>
            </div>
            <span className={cn('shrink-0 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]', posted && 'border-[var(--color-success)]/25 bg-[var(--color-success)]/10 text-[var(--color-success)]')}>{transactionProposalStatusLabel(status)}</span>
          </div>
          <div className="p-4">
            <div className="space-y-4">
              <div className="rounded-xl bg-[var(--ref-primary)]/6 px-4 py-3.5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ref-primary)]">Expense</p><p className="mt-1 truncate text-base font-semibold text-[var(--color-text-primary)]">Lunch at warteg</p></div>
                  <p className="shrink-0 text-xl font-semibold tracking-tight text-[var(--color-text-primary)]">{formatAmount(amount)}</p>
                </div>
              </div>
              <dl className="grid gap-x-5 gap-y-3 text-sm sm:grid-cols-2">
                {field('When', formatDateTime(now))}
                {field('Category', 'Food & Dining')}
                {field('Paid from', first)}
                {field('Period', 'Current period')}
              </dl>
            </div>
            <div className="mt-4 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)]">
              <div className="flex items-center justify-between gap-3 px-3.5 py-3 text-xs font-semibold text-[var(--color-text-secondary)]"><span>Ledger entry</span><span className="text-[11px] font-medium text-[var(--ref-primary)]">View accounting details</span></div>
            </div>
            {posted ? (
              <p className="mt-3 text-xs text-[var(--color-success)]">Posted successfully as transaction #1284.</p>
            ) : (
              <div className="mt-4 flex flex-col-reverse gap-2 border-t border-[var(--color-border)] pt-4 sm:flex-row sm:items-center">
                <Button size="sm" variant="secondary" tabIndex={-1}><Pencil className="h-4 w-4" /> Edit</Button>
                <Button size="sm" variant="secondary" tabIndex={-1} className="border-transparent bg-transparent shadow-none">Dismiss</Button>
                <Button size="sm" tabIndex={-1} className={cn('sm:ml-auto transition-shadow', step >= 2 && 'ring-4 ring-[var(--color-accent)]/25')}>Confirm &amp; post</Button>
              </div>
            )}
          </div>
        </section>
      </Conversation>
    </VisualFrame>
  );
}
