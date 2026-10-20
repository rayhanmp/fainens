import { cn } from '../../lib/utils';
import { useAutoplay } from './motion';
import { VisualFrame } from './visuals';

/**
 * Flow diagrams for the technical documentation: the path a new transaction takes, and how Agent
 * turns a question into an approved entry. Taken from the routes and services they describe. The
 * database diagram is SchemaDiagram.
 */

// ── Flows ────────────────────────────────────────────────────────────

type Step = { title: string; where: string; detail: string; failure?: string };

function FlowDiagram({ steps, caption, interval = 2600 }: { steps: Step[]; caption: string; interval?: number }) {
  const { ref, index, setIndex, setPaused } = useAutoplay(steps.length, interval);
  const step = steps[index]!;
  return (
    <VisualFrame frameRef={ref} caption={caption}>
      <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        <ol className="flex flex-col gap-2 lg:flex-row lg:items-stretch lg:gap-0">
          {steps.map((item, position) => (
            <li key={item.title} className="flex flex-1 items-center lg:min-w-0">
              <button type="button" onMouseEnter={() => setIndex(position)} onFocus={() => setIndex(position)} onClick={() => setIndex(position)}
                className={cn('w-full rounded-xl px-3 py-2.5 text-left ring-1 transition-all duration-300 lg:h-full', position === index ? 'bg-[var(--color-accent)] text-white shadow-md ring-transparent' : position < index ? 'bg-[color-mix(in_srgb,var(--color-accent)_10%,var(--color-surface))] ring-[var(--color-accent)]/30' : 'bg-[var(--color-surface)] ring-[var(--color-border)]')}>
                <span className={cn('block text-[10px] font-bold uppercase tracking-[0.12em]', position === index ? 'text-white/75' : 'text-[var(--ref-on-surface-variant)]')}>{position + 1} · {item.where}</span>
                <span className={cn('mt-0.5 block text-sm font-semibold leading-snug', position === index ? 'text-white' : 'text-[var(--ref-on-surface)]')}>{item.title}</span>
              </button>
              {position < steps.length - 1 && <span aria-hidden className="mx-1 hidden h-0.5 w-3 shrink-0 bg-[var(--color-border-strong)] lg:block" />}
            </li>
          ))}
        </ol>
        <div key={index} className="mt-4 grid animate-[finance-page-header-in_250ms_ease-out] gap-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <p className="text-sm leading-relaxed text-[var(--ref-on-surface)]">{step.detail}</p>
          {step.failure && <p className="rounded-xl border border-[var(--color-danger)]/25 bg-[var(--color-danger)]/6 px-3 py-2 text-xs leading-relaxed text-[var(--ref-on-surface)]"><strong className="text-[var(--color-danger)]">If it fails: </strong>{step.failure}</p>}
        </div>
      </div>
    </VisualFrame>
  );
}

/** What happens between pressing Save expense and the entry being in the ledger. */
export function SaveTransactionFlow() {
  return (
    <FlowDiagram
      caption="Saving a transaction, end to end. Point at a step for what happens there."
      steps={[
        { where: 'Browser', title: 'Save expense', detail: 'The web app sends POST /api/transactions with the lines, the session cookie, and the CSRF token in the x-csrf-token header.' },
        { where: 'nginx', title: 'Forward /api', detail: 'nginx serves the app’s files and passes /api requests to the API server on port 3000.' },
        { where: 'API', title: 'Check the request', detail: 'Rate limit (per signed-in user), CSRF token, the signed session cookie and the allowed email, then the zod schema for the body.', failure: '429 when over the rate limit; refused without a valid session and CSRF token; 400 when the body doesn’t match the schema.' },
        { where: 'Ledger service', title: 'Validate the entry', detail: 'validateJournalLines: at least two lines, each one positive whole-rupiah debit or credit, debits equal to credits. Then the period must be open.', failure: 'Unbalanced or fractional amounts are refused; a closed period raises PeriodLockedError.' },
        { where: 'SQLite', title: 'Write in one transaction', detail: 'The entry, its lines and category allocations are inserted together, the period is checked again inside the transaction, and the audit log records the change. Triggers refuse anything aimed at a closed period.', failure: 'Any error rolls the whole write back; nothing is half-saved.' },
        { where: 'Afterwards', title: 'Revision and caches', detail: 'The financial revision goes up, a cache-invalidation row is queued, and the worker (or the API itself) clears stale caches. The app refetches and every page shows the new entry.' },
      ]}
    />
  );
}

/** How a question becomes an answer, and a draft becomes a posted entry. */
export function AgentFlow() {
  return (
    <FlowDiagram
      caption="Agent, from question to posted entry. Writes only happen after your approval."
      steps={[
        { where: 'You', title: 'Ask', detail: 'Your question, the chat’s scope, your memories and the profile details you share are sent with the conversation (streamed back over server-sent events).' },
        { where: 'Model', title: 'Choose tools', detail: 'The model, through your OpenRouter-compatible provider, picks from a fixed set of tools: up to 30 look-ups per answer, reads in parallel when it can.' },
        { where: 'API', title: 'Read the ledger', detail: 'Read tools run against SQLite with your scope and revision, and their results go back to the model as evidence.', failure: 'A tool error is reported to the model, which answers from what it has.' },
        { where: 'Model', title: 'Answer or draft', detail: 'The answer comes back with up to two chart cards. A change is prepared as a proposal with a one-time approval token, expiring in 15 minutes.' },
        { where: 'You', title: 'Confirm & post', detail: 'Confirming sends the token to /api/agent/approvals/:id/execute; the server re-checks it and posts through the same ledger path as a manual entry.', failure: 'Expired, superseded (your data changed) or already-used proposals are refused; ask again for a fresh one.' },
      ]}
      interval={3000}
    />
  );
}
