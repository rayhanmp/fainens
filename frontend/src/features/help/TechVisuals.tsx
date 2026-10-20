import { useState } from 'react';
import { cn } from '../../lib/utils';
import { useAutoplay } from './motion';
import { VisualFrame } from './visuals';

/**
 * Diagrams for the technical documentation: the ledger’s tables and their relations, the path a
 * new transaction takes, and how Agent turns a question into an approved entry. Taken from
 * backend/src/db/schema.ts and the routes and services they describe.
 */

// ── Data model ───────────────────────────────────────────────────────

type Table = { id: string; x: number; y: number; w?: number; note: string; group: 'core' | 'label' | 'plan' | 'feature' };

const TABLES: Table[] = [
  { id: 'transaction', x: 470, y: 230, w: 200, group: 'core', note: 'A journal entry: date, description, status (posted, draft or reversed), its salary period, and reversal_of_tx_id when it corrects another entry.' },
  { id: 'transaction_line', x: 470, y: 70, w: 200, group: 'core', note: 'One debit or credit on one account. An entry has two or more lines, and debits must equal credits.' },
  { id: 'account', x: 790, y: 70, group: 'core', note: 'Asset, liability, equity, revenue or expense. Built-in accounts like Expense (Auto) have a system_key; accounts can have a parent.' },
  { id: 'salary_period', x: 470, y: 410, w: 200, group: 'plan', note: 'A payday-to-payday period: open or closed, with its coverage. SQLite triggers refuse entries in a closed period.' },
  { id: 'budget_plan', x: 790, y: 410, group: 'plan', note: 'The planned amount for one category in one period.' },
  { id: 'category', x: 1010, y: 230, group: 'label', note: 'A spending label, not an account. Its reporting account says which expense account it rolls up to.' },
  { id: 'transaction_category_allocation', x: 790, y: 170, w: 210, group: 'label', note: 'How much of an entry’s spending goes to each category. An entry can be split across several.' },
  { id: 'transaction_tag', x: 790, y: 290, group: 'label', note: 'Links entries and tags, many to many.' },
  { id: 'tag', x: 1010, y: 330, group: 'label', note: 'A free label, grouped in tag groups.' },
  { id: 'subscription', x: 120, y: 40, group: 'feature', note: 'A recurring charge from an account, in a category; each confirmed renewal becomes a transaction.' },
  { id: 'loan', x: 120, y: 100, group: 'feature', note: 'Money lent to or borrowed from a contact, linked to the transaction that moved it.' },
  { id: 'loan_payment', x: 120, y: 160, group: 'feature', note: 'A repayment of a loan, with its own transaction.' },
  { id: 'paylater_installment', x: 120, y: 220, group: 'feature', note: 'One installment of a pay-later purchase, linked to the purchase (recognition) transaction.' },
  { id: 'reimbursement_claim_source', x: 120, y: 280, w: 200, group: 'feature', note: 'The expense (and line, and category) a reimbursement claim is for.' },
  { id: 'attachment', x: 120, y: 340, group: 'feature', note: 'A receipt or photo attached to a transaction, stored in R2.' },
  { id: 'reconciliation_item', x: 120, y: 400, group: 'feature', note: 'One account’s checked balance in a reconcile, and the adjustment transaction if there was a difference.' },
];

const RELATIONS: Array<[string, string]> = [
  ['transaction_line', 'transaction'], ['transaction_line', 'account'], ['transaction', 'salary_period'],
  ['transaction_category_allocation', 'transaction'], ['transaction_category_allocation', 'category'],
  ['transaction_tag', 'transaction'], ['transaction_tag', 'tag'], ['budget_plan', 'salary_period'], ['budget_plan', 'category'],
  ['subscription', 'transaction'], ['loan', 'transaction'], ['loan_payment', 'transaction'], ['paylater_installment', 'transaction'],
  ['reimbursement_claim_source', 'transaction'], ['attachment', 'transaction'], ['reconciliation_item', 'transaction'], ['loan_payment', 'loan'],
];

const GROUP_STYLE: Record<Table['group'], { fill: string; stroke: string }> = {
  core: { fill: 'var(--color-accent)', stroke: 'var(--color-accent)' },
  plan: { fill: 'var(--color-surface)', stroke: 'var(--color-accent)' },
  label: { fill: 'var(--color-surface)', stroke: 'var(--color-border-strong)' },
  feature: { fill: 'var(--ref-surface-container)', stroke: 'var(--color-border)' },
};

/** The ledger’s main tables and foreign keys; point at a table to see what it holds and what it links to. */
export function DataModelDiagram() {
  const [active, setActive] = useState('transaction');
  const byId = new Map(TABLES.map((table) => [table.id, table]));
  const current = byId.get(active)!;
  const linked = new Set(RELATIONS.filter(([a, b]) => a === active || b === active).flat());
  const width = (table: Table) => table.w ?? 170;

  return (
    <VisualFrame caption="The core ledger tables (blue), planning, labels, and the feature tables that hang off a transaction. Lines are foreign keys; point at a table.">
      <div className="overflow-x-auto">
        <svg viewBox="0 0 1110 450" className="min-w-[44rem] w-full" role="img" aria-label="Database tables and their relations">
          {RELATIONS.map(([from, to]) => {
            const a = byId.get(from)!; const b = byId.get(to)!;
            const on = from === active || to === active;
            return <line key={`${from}-${to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={on ? 'var(--color-accent)' : 'var(--color-border-strong)'} strokeWidth={on ? 2 : 1} strokeDasharray={byId.get(from)!.group === 'feature' ? '4 4' : undefined} className="transition-[stroke] duration-200" />;
          })}
          {/* A correction points back at the entry it reverses. */}
          <path d="M 570 222 C 640 180, 640 280, 570 238" fill="none" stroke={active === 'transaction' ? 'var(--color-accent)' : 'var(--color-border-strong)'} strokeWidth={1.5} markerEnd="url(#erd-arrow)" />
          <text x="636" y="232" fontSize="10" fill="var(--color-muted)">reversal_of</text>
          <defs><marker id="erd-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--color-border-strong)" /></marker></defs>
          {TABLES.map((table) => {
            const style = GROUP_STYLE[table.group];
            const on = table.id === active;
            const dim = !on && !linked.has(table.id);
            const w = width(table);
            return (
              <g key={table.id} onMouseEnter={() => setActive(table.id)} onFocus={() => setActive(table.id)} tabIndex={0} className={cn('cursor-pointer outline-none transition-opacity duration-200', dim && 'opacity-45')}>
                <rect x={table.x - w / 2} y={table.y - 17} width={w} height={34} rx={9} fill={style.fill} stroke={on ? 'var(--ref-on-surface)' : style.stroke} strokeWidth={on ? 2 : 1} />
                <text x={table.x} y={table.y + 4} fontSize="12" fontFamily="var(--font-mono, monospace)" textAnchor="middle" fill={table.group === 'core' ? '#fff' : 'var(--ref-on-surface)'} fontWeight={600}>{table.id}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <p key={active} className="mt-3 min-h-10 animate-[finance-page-header-in_250ms_ease-out] text-sm text-[var(--ref-on-surface)]"><code className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 text-xs font-semibold ring-1 ring-[var(--color-border)]">{current.id}</code> {current.note}</p>
    </VisualFrame>
  );
}

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
