import { Check, CheckCircle2, ChevronDown, Send, Trash2, Wallet } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn } from '../../lib/utils';
import { useAutoplay } from './motion';
import { VisualFrame } from './visuals';

/**
 * A claim on the Reimbursements page, copied from its markup, moving through its statuses on its
 * own: Draft, Submitted, Approved, Partially paid, Settled. Sample claim; buttons are inert.
 */

type Action = 'submit' | 'approve' | 'cancel' | 'pay' | 'done';

const STAGES: Array<{ status: string; color: string; label: string; amount: number; actions: Action[] }> = [
  { status: 'Draft', color: 'bg-[var(--ref-surface-container)] text-[var(--ref-on-surface-variant)]', label: 'Claim amount', amount: 450_000, actions: ['submit', 'approve', 'cancel'] },
  { status: 'Submitted', color: 'bg-violet-500/10 text-[var(--ref-tertiary)]', label: 'Claim amount', amount: 450_000, actions: ['approve', 'cancel'] },
  { status: 'Approved', color: 'bg-blue-500/10 text-[var(--ref-primary)]', label: 'Left to receive', amount: 450_000, actions: ['pay'] },
  { status: 'Partially paid', color: 'bg-amber-500/10 text-[var(--color-warning)]', label: 'Left to receive', amount: 150_000, actions: ['pay'] },
  { status: 'Settled', color: 'bg-emerald-500/10 text-[var(--ref-secondary)]', label: 'Received', amount: 450_000, actions: ['done'] },
];

export function ClaimPipelineDemo() {
  const { ref, index, setIndex, setPaused } = useAutoplay(STAGES.length, 2200);
  const { formatAmount } = useBalanceVisibility();
  const stage = STAGES[index]!;

  return (
    <VisualFrame frameRef={ref} caption="A sample claim on the Reimbursements page, as it moves from draft to settled. Click a status to jump to it.">
      <div className="mx-auto max-w-2xl" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        <section className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)]">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 sm:px-6">
            <div className="flex items-center gap-2"><h2 className="text-lg font-extrabold">Your claims</h2><span className="rounded-full bg-[var(--ref-surface-container-low)] px-2 py-0.5 text-xs font-semibold">1</span></div>
            <span className="text-xs text-[var(--ref-outline)]">Draft → Submitted → Approved → Paid</span>
          </div>
          <article className="px-5 py-5 sm:px-6">
            <div className="flex flex-col justify-between gap-4 sm:flex-row">
              <div className="flex min-w-0 gap-3">
                <div className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--ref-surface-container-low)] text-sm font-bold text-[var(--ref-primary)] sm:flex">PT</div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><h3 className="break-words font-bold">Client visit, Bandung</h3><span key={stage.status} className={cn('animate-[finance-page-header-in_300ms_ease-out] rounded-md px-2 py-1 text-[10px] font-bold', stage.color)}>{stage.status}</span></div>
                  <p className="mt-1 text-sm text-[var(--ref-on-surface-variant)]">PT Maju Jaya <span className="px-1 text-[var(--ref-outline)]">·</span> Claim #12</p>
                  <p className="mt-2 text-xs text-[var(--ref-outline)]">Due 30 Nov 2026 · 3 linked expenses</p>
                </div>
              </div>
              <div className="shrink-0 sm:text-right"><p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ref-outline)]">{stage.label}</p><p className="mt-1 text-xl font-extrabold tabular-nums">{formatAmount(stage.amount)}</p></div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-1 py-2 pr-2 text-xs font-semibold text-[var(--ref-primary)]">View details<ChevronDown className="h-4 w-4" /></span>
              <div className="pointer-events-none flex flex-wrap gap-2">
                {stage.actions.includes('cancel') && <Button size="sm" variant="secondary" tabIndex={-1}><Trash2 className="mr-1.5 h-3.5 w-3.5" />Cancel claim</Button>}
                {stage.actions.includes('submit') && <Button size="sm" variant="secondary" tabIndex={-1}><Send className="mr-1.5 h-3.5 w-3.5" />Mark submitted</Button>}
                {stage.actions.includes('approve') && <Button size="sm" tabIndex={-1}><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Approve claim</Button>}
                {stage.actions.includes('pay') && <Button size="sm" tabIndex={-1}><Wallet className="mr-1.5 h-3.5 w-3.5" />Record payment</Button>}
                {stage.actions.includes('done') && <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ref-secondary)]"><Check className="h-4 w-4" />Fully reimbursed</span>}
              </div>
            </div>
          </article>
        </section>
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {STAGES.map((item, position) => (
            <button key={item.status} type="button" onClick={() => setIndex(position)} className={cn('rounded-md px-2 py-1 text-[10px] font-bold transition-opacity', item.color, position === index ? 'opacity-100 ring-1 ring-current' : 'opacity-50 hover:opacity-80')}>{item.status}</button>
          ))}
        </div>
      </div>
    </VisualFrame>
  );
}
