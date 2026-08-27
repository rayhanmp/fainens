import { createFileRoute, useSearch } from '@tanstack/react-router';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Database,
  ImagePlus,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { PageContainer } from '../components/ui/PageContainer';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Select } from '../components/ui/Select';
import { MarkdownMessage } from '../components/agent/MarkdownMessage';
import { RequireAuth } from '../lib/auth';
import { api } from '../lib/api';
import type { AgentTransactionActionProposal } from '../lib/api';
import { cn, formatCurrency, formatDate, formatDateTime } from '../lib/utils';

export const Route = createFileRoute('/agent')({
  validateSearch: (search: Record<string, unknown>) => ({
    prompt: typeof search.prompt === 'string' ? search.prompt : undefined,
  }),
  component: AgentPage,
} as any);

type Period = {
  id: number;
  name: string;
  startDate: number;
  endDate: number;
  isActive?: boolean;
};

type AgentResponse = Awaited<ReturnType<typeof api.agent.query>>;
type BudgetPreview = Awaited<ReturnType<typeof api.agent.planBudget>>;
type AgentActionProposal = Awaited<ReturnType<typeof api.agent.actions.prepareBudget>>;
type AgentTransactionProposal = AgentTransactionActionProposal;
type Conversation = Awaited<ReturnType<typeof api.agent.conversations.list>>['conversations'][number];
type ChatImage = { id: string; filename: string; mimeType: string; dataUrl: string; fileSize: number };

type ChatMessage =
  | { id: string; serverId?: number; role: 'user'; text: string; createdAt: number; images?: ChatImage[] }
  | { id: string; role: 'assistant'; text: string; createdAt: number; response?: AgentResponse };

const AGENT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_AGENT_IMAGE_SIZE = 4 * 1024 * 1024;
const MAX_AGENT_IMAGE_COUNT = 3;

const SUGGESTIONS = [
  'What were my top 10 expenses recently?',
  'Find spending similar to my latest transaction.',
  'How is my budget tracking this period?',
  'What bills and obligations are coming up?',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scopeLabel(scope: unknown, periods: Period[]): string {
  if (!isRecord(scope)) return 'Selected recorded data';
  if (typeof scope.periodName === 'string') return scope.periodName;
  if (typeof scope.periodId === 'number') return periods.find((period) => period.id === scope.periodId)?.name ?? `Period #${scope.periodId}`;
  return 'All recorded history';
}

function resultLink(toolName: string): { href: string; label: string } | null {
  if (toolName === 'search_transactions' || toolName === 'get_financial_facts' || toolName === 'get_transaction_details') return { href: '/transactions', label: 'Open transactions' };
  if (toolName === 'get_account_balances' || toolName === 'get_reconciliation_status') return { href: '/accounts', label: 'Open accounts' };
  if (toolName === 'get_budget_facts' || toolName === 'preview_budget_plan' || toolName === 'get_category_spending') return { href: '/budget', label: 'Open budget' };
  if (toolName === 'get_loan_balances') return { href: '/loans', label: 'Open loans' };
  if (toolName === 'get_paylater_obligations') return { href: '/paylater', label: 'Open PayLater' };
  if (toolName === 'get_due_recurring') return { href: '/subscriptions', label: 'Open subscriptions' };
  return null;
}

function ToolTrace({ response }: { response: AgentResponse }) {
  const [open, setOpen] = useState(false);
  const calls = response.toolCalls ?? [];
  const results = response.toolResults ?? [];
  const hasStructuredContext = response.context != null;
  if (calls.length === 0 && !hasStructuredContext) return null;

  return (
    <div className="mt-4 border-t border-[var(--color-border)] pt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 text-left text-xs font-semibold text-[var(--color-text-secondary)]"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2"><Database className="h-4 w-4" /> {calls.length > 0 ? `Used ${calls.length} ledger tool${calls.length === 1 ? '' : 's'}` : 'Structured ledger context'}</span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {calls.length === 0 && hasStructuredContext && (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3">
              <p className="text-xs text-[var(--color-text-secondary)]">The configured read tools returned this current, structured finance context.</p>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--color-surface)] p-2 font-mono text-[11px] text-[var(--color-text-primary)]">
                {JSON.stringify(response.context, null, 2)}
              </pre>
            </div>
          )}
          {calls.map((call) => {
            const result = results.find((candidate) => candidate.id === call.id);
            const link = resultLink(call.name);
            return (
              <div key={call.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <code className="text-xs font-semibold text-[var(--ref-primary)]">{call.name}</code>
                  {link && <a href={link.href} className="text-xs font-semibold text-[var(--ref-primary)] underline">{link.label}</a>}
                </div>
                <details className="mt-2 text-xs text-[var(--color-text-secondary)]">
                  <summary className="cursor-pointer">Request and result</summary>
                  <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--color-surface)] p-2 font-mono text-[11px] text-[var(--color-text-primary)]">
                    {JSON.stringify({ input: call.input, result: result?.result ?? null }, null, 2)}
                  </pre>
                </details>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function isTransactionProposal(value: unknown): value is AgentTransactionProposal {
  if (!isRecord(value) || value.kind !== 'transaction_journal_create' || typeof value.approvalId !== 'number') return false;
  return isRecord(value.details) && Array.isArray(value.details.lines) && typeof value.details.totalDebit === 'number';
}

type TransactionEditDraft = {
  name: string;
  amount: string;
  dateTime: string;
  categoryId: string;
  place: string;
  reference: string;
  notes: string;
};

type TransactionProposalStatus = 'pending' | 'restoring' | 'editing' | 'saving' | 'executing' | 'executed' | 'rejected' | 'expired' | 'superseded' | 'error';

function initialTransactionProposalStatus(status: string): TransactionProposalStatus {
  if (status === 'pending' || status === 'rejected' || status === 'expired' || status === 'superseded' || status === 'executed') return status;
  return 'error';
}

function transactionProposalStatusLabel(status: TransactionProposalStatus): string {
  if (status === 'pending') return 'Needs your review';
  if (status === 'restoring') return 'Restoring review…';
  if (status === 'executing') return 'Working…';
  if (status === 'executed') return 'Posted';
  if (status === 'rejected') return 'Dismissed';
  if (status === 'expired') return 'Expired';
  if (status === 'superseded') return 'Replaced';
  if (status === 'editing' || status === 'saving') return 'Editing';
  return 'Could not post';
}

function localDateTimeInput(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function allocationForAmount(
  allocations: AgentTransactionProposal['input']['categoryAllocations'],
  oldAmount: number,
  nextAmount: number,
): AgentTransactionProposal['input']['categoryAllocations'] {
  if (allocations.length === 0 || oldAmount === 0) return allocations;
  const sign = allocations.reduce((sum, allocation) => sum + allocation.amount, 0) < 0 ? -1 : 1;
  const target = sign * nextAmount;
  const scaled = allocations.map((allocation) => ({
    categoryId: allocation.categoryId,
    amount: Math.trunc((allocation.amount * target) / oldAmount),
  }));
  const remainder = target - scaled.reduce((sum, allocation) => sum + allocation.amount, 0);
  if (scaled[0]) scaled[0].amount += remainder;
  return scaled;
}

function journalLinesForAmount(
  lines: AgentTransactionProposal['input']['lines'],
  nextAmount: number,
): AgentTransactionProposal['input']['lines'] {
  const oldDebit = lines.reduce((sum, line) => sum + line.debit, 0);
  const oldCredit = lines.reduce((sum, line) => sum + line.credit, 0);
  if (oldDebit <= 0 || oldCredit <= 0) return lines.map((line) => ({ ...line }));
  const scaled = lines.map((line) => ({ ...line,
    debit: Math.floor((line.debit * nextAmount) / oldDebit),
    credit: Math.floor((line.credit * nextAmount) / oldCredit),
  }));
  const addRemainder = (side: 'debit' | 'credit') => {
    let remainder = nextAmount - scaled.reduce((sum, line) => sum + line[side], 0);
    for (let index = 0; index < scaled.length && remainder > 0; index += 1) {
      if (lines[index][side] > 0) {
        scaled[index][side] += 1;
        remainder -= 1;
      }
    }
  };
  addRemainder('debit');
  addRemainder('credit');
  return scaled;
}

function draftFromProposal(proposal: AgentTransactionProposal): TransactionEditDraft {
  const categoryId = proposal.input.categoryId ?? proposal.input.categoryAllocations[0]?.categoryId ?? null;
  return {
    name: proposal.input.description,
    amount: String(proposal.details.totalDebit),
    dateTime: localDateTimeInput(proposal.input.dateMs),
    categoryId: categoryId == null ? '' : String(categoryId),
    place: proposal.input.place ?? '',
    reference: proposal.input.reference ?? '',
    notes: proposal.input.notes ?? '',
  };
}

function TransactionProposalCard({
  proposal,
  categories,
  conversationId,
}: {
  proposal: AgentTransactionProposal;
  categories: Array<{ id: number; name: string }>;
  conversationId?: number | null;
}) {
  const [currentProposal, setCurrentProposal] = useState(proposal);
  const [status, setStatus] = useState<TransactionProposalStatus>(initialTransactionProposalStatus(proposal.status));
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<TransactionEditDraft>(() => draftFromProposal(proposal));
  const restorationAttempted = useRef(false);
  const details = currentProposal.details;
  const input = currentProposal.input;
  const categoryName = input.categoryId == null
    ? (input.categoryAllocations[0] ? categories.find((category) => category.id === input.categoryAllocations[0].categoryId)?.name ?? details.categoryAllocations[0]?.category : null)
    : categories.find((category) => category.id === input.categoryId)?.name ?? details.categoryAllocations.find((allocation) => allocation.categoryId === input.categoryId)?.category;

  useEffect(() => {
    if (restorationAttempted.current || currentProposal.approvalToken || (proposal.status !== 'pending' && proposal.status !== 'expired')) return;
    restorationAttempted.current = true;
    setStatus('restoring');
    setMessage(null);
    void api.agent.actions.reissue(proposal.approvalId)
      .then((refreshed) => {
        if (!isTransactionProposal(refreshed)) throw new Error('The restored approval was not a transaction proposal.');
        setCurrentProposal(refreshed);
        setDraft(draftFromProposal(refreshed));
        const refreshedStatus = initialTransactionProposalStatus(refreshed.status);
        setStatus(refreshedStatus);
        setMessage(refreshedStatus === 'pending' ? 'Review restored after reload.' : null);
      })
      .catch((caught) => {
        setStatus(initialTransactionProposalStatus(proposal.status));
        setMessage(caught instanceof Error ? caught.message : 'Could not restore this proposal.');
      });
  }, [currentProposal.approvalToken, proposal.approvalId, proposal.status]);

  const beginEdit = () => {
    setDraft(draftFromProposal(currentProposal));
    setMessage(null);
    setStatus('editing');
  };

  const cancelEdit = () => {
    setDraft(draftFromProposal(currentProposal));
    setStatus('pending');
    setMessage(null);
  };

  const saveEdit = async () => {
    const amount = Number(draft.amount.replace(/[^0-9]/g, ''));
    const dateMs = new Date(draft.dateTime).getTime();
    if (!draft.name.trim()) {
      setMessage('Add a transaction name before saving.');
      return;
    }
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      setMessage('Amount must be a positive whole IDR amount.');
      return;
    }
    if (!Number.isFinite(dateMs)) {
      setMessage('Choose a valid date and time.');
      return;
    }
    setStatus('saving');
    setMessage(null);
    try {
      const nextCategoryId = draft.categoryId ? Number(draft.categoryId) : null;
      const originalCategoryId = input.categoryId ?? input.categoryAllocations[0]?.categoryId ?? null;
      const nextInput = {
        ...input,
        dateMs,
        description: draft.name.trim(),
        place: draft.place.trim() || null,
        reference: draft.reference.trim() || null,
        notes: draft.notes.trim() || null,
        categoryId: nextCategoryId,
        lines: journalLinesForAmount(input.lines, amount),
        categoryAllocations: allocationForAmount(input.categoryAllocations, details.totalDebit, amount),
      };
      if (nextCategoryId !== originalCategoryId) {
        if (nextCategoryId == null) {
          nextInput.categoryAllocations = [];
        } else if (nextInput.categoryAllocations.length > 0) {
          const allocatedAmount = nextInput.categoryAllocations.reduce((sum, allocation) => sum + allocation.amount, 0);
          nextInput.categoryAllocations = [{ categoryId: nextCategoryId, amount: allocatedAmount }];
        }
      }
      const refreshed = await api.agent.actions.prepareTransaction({
        conversationId,
        input: nextInput,
        assumptions: currentProposal.assumptions,
      });
      // A changed proposal must not leave the old bearer token usable. The
      // replacement is prepared first so a transient network failure does not
      // strand the user without a valid review option.
      if (currentProposal.approvalToken) {
        await api.agent.actions.reject(currentProposal.approvalId, currentProposal.approvalToken).catch(() => undefined);
      }
      setCurrentProposal(refreshed);
      setDraft(draftFromProposal(refreshed));
      setStatus('pending');
      setMessage('Updated. Review the new proposal, then confirm when ready.');
    } catch (caught) {
      setStatus('editing');
      setMessage(caught instanceof Error ? caught.message : 'Could not update this proposal.');
    }
  };

  const execute = async () => {
    if (!currentProposal.approvalToken || status !== 'pending') return;
    setStatus('executing');
    setMessage(null);
    try {
      const result = await api.agent.actions.execute(currentProposal.approvalId, currentProposal.approvalToken);
      setStatus('executed');
      setMessage(`Posted successfully as transaction #${result.receipt.transactionId ?? '—'}.`);
    } catch (caught) {
      setStatus('error');
      setMessage(caught instanceof Error ? caught.message : 'Could not post this transaction.');
    }
  };

  const reject = async () => {
    if (!currentProposal.approvalToken || status !== 'pending') return;
    setStatus('executing');
    setMessage(null);
    try {
      await api.agent.actions.reject(currentProposal.approvalId, currentProposal.approvalToken);
      setStatus('rejected');
      setMessage('Transaction proposal dismissed; nothing was posted.');
    } catch (caught) {
      setStatus('error');
      setMessage(caught instanceof Error ? caught.message : 'Could not dismiss this proposal.');
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Transaction ready for review</p>
          <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Nothing is posted until you confirm it.</p>
        </div>
        <span className={cn('rounded-full bg-[var(--color-surface)] px-2 py-1 text-[11px] font-semibold uppercase tracking-wide', (status === 'executed' || status === 'rejected') && 'text-[var(--color-success)]')}>{transactionProposalStatusLabel(status)}</span>
      </div>
      {status === 'editing' || status === 'saving' ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold sm:col-span-2">Transaction name<input value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} className="brutalist-input mt-1" maxLength={500} /></label>
          <label className="text-xs font-semibold">Amount (IDR)<input inputMode="numeric" value={draft.amount} onChange={(event) => setDraft((value) => ({ ...value, amount: event.target.value }))} className="brutalist-input mt-1" /></label>
          <label className="text-xs font-semibold">Date &amp; time<input type="datetime-local" value={draft.dateTime} onChange={(event) => setDraft((value) => ({ ...value, dateTime: event.target.value }))} className="brutalist-input mt-1" /></label>
          <label className="text-xs font-semibold">Category<select value={draft.categoryId} onChange={(event) => setDraft((value) => ({ ...value, categoryId: event.target.value }))} className="brutalist-input mt-1"><option value="">Uncategorized</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label className="text-xs font-semibold">Place<input value={draft.place} onChange={(event) => setDraft((value) => ({ ...value, place: event.target.value }))} className="brutalist-input mt-1" maxLength={500} placeholder="Optional" /></label>
          <label className="text-xs font-semibold">Reference<input value={draft.reference} onChange={(event) => setDraft((value) => ({ ...value, reference: event.target.value }))} className="brutalist-input mt-1" maxLength={500} placeholder="Optional" /></label>
          <label className="text-xs font-semibold sm:col-span-2">Notes / description<textarea value={draft.notes} onChange={(event) => setDraft((value) => ({ ...value, notes: event.target.value }))} className="brutalist-input mt-1 min-h-20 resize-y" maxLength={2000} placeholder="Optional details" /></label>
          <div className="flex flex-wrap gap-2 sm:col-span-2"><Button size="sm" onClick={() => void saveEdit()} isLoading={status === 'saving'}>Save changes</Button><Button size="sm" variant="secondary" onClick={cancelEdit} disabled={status === 'saving'}>Cancel</Button></div>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Transaction name</p><p className="mt-0.5 font-semibold">{input.description}</p></div>
          <div><p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Amount</p><p className="mt-0.5 font-semibold">{formatCurrency(details.totalDebit)}</p></div>
          <div><p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Category</p><p className="mt-0.5">{categoryName ?? 'Uncategorized'}</p></div>
          <div><p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Date &amp; time</p><p className="mt-0.5">{formatDateTime(details.dateMs)}</p></div>
          <div><p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Period</p><p className="mt-0.5">{details.periodId == null ? 'Unassigned' : `Period #${details.periodId}`}</p></div>
          {input.place && <div><p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Place</p><p className="mt-0.5">{input.place}</p></div>}
          {input.reference && <div><p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Reference</p><p className="mt-0.5">{input.reference}</p></div>}
          {input.notes && <div className="sm:col-span-2"><p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Notes / description</p><p className="mt-0.5 whitespace-pre-wrap">{input.notes}</p></div>}
        </div>
      )}
      <details className="mt-4 rounded-lg border border-[var(--color-border)]/70 bg-[var(--color-surface)]/60 p-3">
        <summary className="cursor-pointer text-xs font-semibold text-[var(--color-text-secondary)]">Ledger details</summary>
        <div className="mt-3 space-y-1 text-xs">
          {details.lines.map((line, index) => <div key={`${line.accountId}-${index}`} className="flex items-center justify-between gap-3"><span>{line.account}</span><span className="font-mono">{line.debit > 0 ? `Dr ${formatCurrency(line.debit)}` : `Cr ${formatCurrency(line.credit)}`}</span></div>)}
        </div>
        <p className="mt-2 text-[11px] text-[var(--color-text-secondary)]">Balanced total {formatCurrency(details.totalDebit)} · proposal revision {currentProposal.baseFinancialRevision} · expires {formatDate(currentProposal.expiresAt)}</p>
      </details>
      {currentProposal.approvalToken && status === 'pending' && <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={beginEdit}><Pencil className="h-4 w-4" /> Edit details</Button><Button size="sm" onClick={() => void execute()}><Check className="h-4 w-4" /> Confirm &amp; post</Button><Button size="sm" variant="secondary" onClick={() => void reject()}>Dismiss</Button></div>}
      {!currentProposal.approvalToken && status === 'pending' && <p className="mt-3 text-xs text-[var(--color-danger)]">The approval could not be restored. Refresh the page or ask the agent to prepare a fresh proposal before posting.</p>}
      {status === 'rejected' && <p className="mt-3 text-xs text-[var(--color-text-secondary)]">This proposal was dismissed; nothing was posted.</p>}
      {status === 'expired' && <p className="mt-3 text-xs text-[var(--color-text-secondary)]">This proposal expired before confirmation; ask the agent to prepare it again.</p>}
      {status === 'superseded' && <p className="mt-3 text-xs text-[var(--color-text-secondary)]">This proposal was replaced by a newer proposal; nothing was posted from this one.</p>}
      {status === 'executed' && !message && <p className="mt-3 text-xs text-[var(--color-success)]">This transaction has already been posted.</p>}
      {message && <p className={cn('mt-3 text-xs', (status === 'executed' || status === 'rejected' || message.startsWith('Updated.')) ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]')}>{message}</p>}
    </div>
  );
}

function AgentPage() {
  const search = useSearch({ from: '/agent' }) as { prompt?: string };
  const [periods, setPeriods] = useState<Period[]>([]);
  const [categories, setCategories] = useState<Array<{ id: number; name: string }>>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [pendingImages, setPendingImages] = useState<ChatImage[]>([]);
  const [previewImage, setPreviewImage] = useState<ChatImage | null>(null);
  const [isDraggingImages, setIsDraggingImages] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [streamActivity, setStreamActivity] = useState<string | null>(null);
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  const [conversationActionId, setConversationActionId] = useState<number | null>(null);
  const [openConversationMenuId, setOpenConversationMenuId] = useState<number | null>(null);
  const [editingConversationId, setEditingConversationId] = useState<number | null>(null);
  const [conversationTitleDraft, setConversationTitleDraft] = useState('');
  const [editingUserMessageId, setEditingUserMessageId] = useState<string | null>(null);
  const [editingUserMessageText, setEditingUserMessageText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [budgetPreview, setBudgetPreview] = useState<BudgetPreview | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [budgetAction, setBudgetAction] = useState<AgentActionProposal | null>(null);
  const [isPreparingAction, setIsPreparingAction] = useState(false);
  const [isExecutingAction, setIsExecutingAction] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const questionInputRef = useRef<HTMLTextAreaElement>(null);
  const agentRequestRef = useRef<AbortController | null>(null);
  const [isComposerExpanded, setIsComposerExpanded] = useState(false);

  useLayoutEffect(() => {
    const textarea = questionInputRef.current;
    if (!textarea) return;

    const maxHeight = 160;
    textarea.style.height = 'auto';
    const contentHeight = textarea.scrollHeight;
    setIsComposerExpanded(draft.includes('\n') || contentHeight > 40);
    const nextHeight = Math.min(contentHeight, maxHeight);
    textarea.style.height = `${Math.max(nextHeight, 40)}px`;
    textarea.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden';
  }, [draft]);

  const refreshConversations = async () => {
    const result = await api.agent.conversations.list({ includeArchived: true });
    setConversations(result.conversations);
    return result.conversations;
  };

  const selectConversation = async (conversationId: number) => {
    if (conversationId === activeConversationId || isLoadingConversation) return;
    setIsLoadingConversation(true);
    setError(null);
    setNotice(null);
    try {
      const detail = await api.agent.conversations.get(conversationId);
      setActiveConversationId(detail.conversation.id);
      setMessages(detail.messages.map((message) => message.role === 'assistant'
        ? { id: String(message.id), role: 'assistant', text: message.content, createdAt: message.createdAt, response: isRecord(message.response) ? message.response as AgentResponse : undefined }
        : { id: String(message.id), serverId: message.id, role: 'user', text: message.content, createdAt: message.createdAt },
      ));
      setPendingImages([]);
      setImageError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load that conversation.');
    } finally {
      setIsLoadingConversation(false);
    }
  };

  useEffect(() => {
    void api.periods.list()
      .then((data) => {
        const availablePeriods = data as Period[];
        setPeriods(availablePeriods);
        const active = availablePeriods.find((period) => period.isActive) ?? availablePeriods[0];
        if (active) setSelectedPeriodId(String(active.id));
      })
      .catch(() => setError('Could not load accounting periods. You can still ask across recorded history.'));
    void api.categories.list()
      .then((data) => setCategories(data.map((category) => ({ id: category.id, name: category.name }))))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (search.prompt?.trim()) {
      setActiveConversationId(null);
      setMessages([]);
      setPendingImages([]);
    }
    void refreshConversations()
      .then((available) => {
        if (search.prompt?.trim()) {
          setDraft(search.prompt.trim());
          return;
        }
        if (available[0]) void selectConversation(available[0].id);
      })
      .catch(() => setError('Could not load saved conversations.'));
  }, [search.prompt]);

  const selectedPeriod = useMemo(
    () => periods.find((period) => String(period.id) === selectedPeriodId),
    [periods, selectedPeriodId],
  );

  useEffect(() => {
    if (!previewImage) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewImage(null);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [previewImage]);

  const addImageFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const errors: string[] = [];
    const available = MAX_AGENT_IMAGE_COUNT - pendingImages.length;
    if (available <= 0) {
      setImageError(`You can attach at most ${MAX_AGENT_IMAGE_COUNT} images per message.`);
      return;
    }
    const acceptedFiles = files.slice(0, available);
    if (files.length > available) errors.push(`Only ${MAX_AGENT_IMAGE_COUNT} images can be attached per message.`);
    const newImages: ChatImage[] = [];
    for (const file of acceptedFiles) {
      if (!AGENT_IMAGE_TYPES.includes(file.type)) {
        errors.push(`${file.name}: use JPEG, PNG, WebP, or GIF.`);
        continue;
      }
      if (file.size === 0 || file.size > MAX_AGENT_IMAGE_SIZE) {
        errors.push(`${file.name}: image must be smaller than ${MAX_AGENT_IMAGE_SIZE / (1024 * 1024)}MB.`);
        continue;
      }
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read image'));
          reader.onerror = () => reject(new Error('Could not read image'));
          reader.readAsDataURL(file);
        });
        newImages.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          filename: file.name,
          mimeType: file.type,
          dataUrl,
          fileSize: file.size,
        });
      } catch {
        errors.push(`${file.name}: could not read image.`);
      }
    }
    if (newImages.length > 0) setPendingImages((current) => [...current, ...newImages]);
    setImageError(errors.length > 0 ? errors.join('\n') : null);
  };

  const submitQuestion = async (question = draft, replacement?: { localId: string; serverId: number }) => {
    const text = question.trim();
    if (text.length < 2 || isSending) return;
    const attachedImages = replacement ? [] : pendingImages;
    const createdAt = Date.now();
    const userLocalId = replacement?.localId ?? `user-${createdAt}`;
    setDraft('');
    setError(null);
    setNotice(null);
    setImageError(null);
    setEditingUserMessageId(null);
    setEditingUserMessageText('');
    setMessages((current) => {
      if (!replacement) return [...current, { id: userLocalId, role: 'user', text, createdAt, images: attachedImages }];
      const replacementIndex = current.findIndex((message) => message.id === replacement.localId);
      if (replacementIndex < 0) return current;
      return current.slice(0, replacementIndex + 1).map((message) =>
        message.id === replacement.localId && message.role === 'user'
          ? { ...message, text, images: undefined }
          : message,
      );
    });
    setIsSending(true);
    setStreamActivity('Thinking…');
    const requestController = new AbortController();
    agentRequestRef.current = requestController;
    let streamedAssistantId: string | null = null;
    try {
      let conversationId = activeConversationId;
      if (conversationId == null) {
        const created = await api.agent.conversations.create();
        conversationId = created.conversation.id;
        setActiveConversationId(conversationId);
        setConversations((current) => [created.conversation, ...current]);
      }
      const assistantId = `assistant-${Date.now()}`;
      streamedAssistantId = assistantId;
      setMessages((current) => [...current, {
        id: assistantId,
        role: 'assistant',
        text: '',
        createdAt: Date.now(),
      }]);
      const response = await api.agent.streamQuery({
        question: text,
        ...(selectedPeriodId ? { periodId: Number(selectedPeriodId) } : {}),
        conversationId,
        ...(replacement ? { replaceMessageId: replacement.serverId } : {}),
        ...(attachedImages.length > 0 ? { images: attachedImages.map((image) => ({ filename: image.filename, mimeType: image.mimeType, data: image.dataUrl })) } : {}),
      }, (event) => {
        if (event.type === 'delta') {
          setStreamActivity('Writing…');
          setMessages((current) => current.map((message) =>
            message.id === assistantId && message.role === 'assistant'
              ? { ...message, text: message.text + event.text }
              : message,
          ));
        }
        if (event.type === 'tool') setStreamActivity(`Checking ${event.name.replaceAll('_', ' ')}…`);
        if (event.type === 'complete') {
          const fallback = event.response.llmAvailable
            ? 'I could not produce a written answer from the available evidence.'
            : 'The LLM is not configured yet, but the structured ledger context was retrieved below.';
          setMessages((current) => current.map((message) =>
            message.id === assistantId && message.role === 'assistant'
              ? { ...message, text: message.text || (event.response.answer ?? event.response.message ?? fallback), response: event.response }
              : message,
          ));
        }
      }, requestController.signal);
      // Keep the complete receipt even if the final SSE event was processed
      // immediately before React applied its state update.
      setMessages((current) => current.map((message) =>
        message.id === assistantId && message.role === 'assistant'
          ? { ...message, response }
          : message.id === userLocalId && message.role === 'user'
            ? { ...message, serverId: response.userMessageId ?? message.serverId }
            : message,
      ));
      setPendingImages([]);
      void refreshConversations().catch(() => undefined);
    } catch (caught) {
      const wasCancelled = requestController.signal.aborted || (caught instanceof DOMException && caught.name === 'AbortError');
      if (wasCancelled) {
        setMessages((current) => current.filter((message) => message.id !== streamedAssistantId || message.role !== 'assistant' || message.text.trim().length > 0));
        setNotice('Response stopped.');
      } else {
        setMessages((current) => current.filter((message) => message.id !== streamedAssistantId));
        setError(caught instanceof Error ? caught.message : 'The agent query failed. Please try again.');
      }
    } finally {
      if (agentRequestRef.current === requestController) agentRequestRef.current = null;
      setIsSending(false);
      setStreamActivity(null);
    }
  };

  const stopAgentQuery = () => {
    agentRequestRef.current?.abort();
  };

  const retryLastUserMessage = (message: Extract<ChatMessage, { role: 'user' }>) => {
    if (isSending) return;
    if (message.serverId == null) {
      void submitQuestion(message.text);
      return;
    }
    void submitQuestion(message.text, { localId: message.id, serverId: message.serverId });
  };

  const saveEditedLastUserMessage = (message: Extract<ChatMessage, { role: 'user' }>) => {
    const nextText = editingUserMessageText.trim();
    if (nextText.length < 2) {
      setError('Message must be at least 2 characters.');
      return;
    }
    if (message.serverId == null) {
      void submitQuestion(nextText);
      return;
    }
    void submitQuestion(nextText, { localId: message.id, serverId: message.serverId });
  };

  const startNewConversation = () => {
    setActiveConversationId(null);
    setMessages([]);
    setDraft('');
    setPendingImages([]);
    setImageError(null);
    setError(null);
    setNotice(null);
    setBudgetPreview(null);
    setBudgetAction(null);
    setEditingUserMessageId(null);
    setEditingUserMessageText('');
  };

  const updateConversation = async (conversationId: number, data: { title?: string; isPinned?: boolean; archived?: boolean }) => {
    setConversationActionId(conversationId);
    setError(null);
    try {
      const result = await api.agent.conversations.update(conversationId, data);
      setConversations((current) => current.map((conversation) => conversation.id === conversationId ? result.conversation : conversation));
      return result.conversation;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update that conversation.');
      return null;
    } finally {
      setConversationActionId(null);
    }
  };

  const saveConversationTitle = async (conversationId: number) => {
    const title = conversationTitleDraft.trim();
    if (!title) {
      setError('Conversation title cannot be empty.');
      return;
    }
    const updated = await updateConversation(conversationId, { title });
    if (updated) {
      setEditingConversationId(null);
      setConversationTitleDraft('');
    }
  };

  const deleteConversation = async (conversation: Conversation) => {
    if (!window.confirm(`Delete “${conversation.title}”? This permanently removes the conversation and its messages.`)) return;
    setConversationActionId(conversation.id);
    setError(null);
    try {
      await api.agent.conversations.delete(conversation.id);
      setConversations((current) => current.filter((candidate) => candidate.id !== conversation.id));
      setOpenConversationMenuId(null);
      if (activeConversationId === conversation.id) startNewConversation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete that conversation.');
    } finally {
      setConversationActionId(null);
    }
  };

  const previewBudget = async () => {
    if (!selectedPeriodId || isPlanning) return;
    setIsPlanning(true);
    setError(null);
    try {
      setBudgetPreview(await api.agent.planBudget({ periodId: Number(selectedPeriodId) }));
      setBudgetAction(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not prepare the budget plan.');
    } finally {
      setIsPlanning(false);
    }
  };

  const prepareBudgetAction = async () => {
    if (!budgetPreview || !selectedPeriodId || isPreparingAction) return;
    const plans = budgetPreview.recommendations
      .filter((recommendation): recommendation is typeof recommendation & { categoryId: number } => recommendation.categoryId != null)
      .map((recommendation) => ({ categoryId: recommendation.categoryId, plannedAmountCents: recommendation.suggestedAmountCents }));
    if (plans.length === 0) {
      setError('This preview has no categorized recommendations to apply.');
      return;
    }
    setIsPreparingAction(true);
    setError(null);
    try {
      const proposal = await api.agent.actions.prepareBudget({
        conversationId: activeConversationId,
        input: { periodId: Number(selectedPeriodId), plans },
        assumptions: [
          'Only the categories shown in this proposal will be created or updated.',
          'Existing budget categories not shown will be left unchanged.',
          'This proposal is bound to the displayed ledger revision and expires shortly.',
        ],
      });
      setBudgetAction(proposal);
      if (!proposal.approvalToken) setError('This proposal was already prepared. Use the existing confirmation card or prepare again after it expires.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not prepare the budget change.');
    } finally {
      setIsPreparingAction(false);
    }
  };

  const executeBudgetAction = async () => {
    if (!budgetAction?.approvalToken || isExecutingAction) return;
    setIsExecutingAction(true);
    setError(null);
    try {
      const result = await api.agent.actions.execute(budgetAction.approvalId, budgetAction.approvalToken);
      setBudgetAction(null);
      setBudgetPreview(null);
      setNotice(`Budget updated: ${result.receipt.changedCount} plan${result.receipt.changedCount === 1 ? '' : 's'} changed (revision ${result.receipt.financialRevision}; audit ${result.receipt.auditLogIds.join(', ')}).`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not apply the approved budget change.');
    } finally {
      setIsExecutingAction(false);
    }
  };

  const rejectBudgetAction = async () => {
    if (!budgetAction?.approvalToken || isExecutingAction) return;
    setIsExecutingAction(true);
    setError(null);
    setNotice(null);
    try {
      await api.agent.actions.reject(budgetAction.approvalId, budgetAction.approvalToken);
      setBudgetAction(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not dismiss the proposal.');
    } finally {
      setIsExecutingAction(false);
    }
  };

  const activeConversations = conversations.filter((conversation) => conversation.archivedAt == null);
  const archivedConversations = conversations.filter((conversation) => conversation.archivedAt != null);
  const latestUserMessageId = [...messages].reverse().find((message) => message.role === 'user')?.id ?? null;

  return (
    <RequireAuth>
      <PageContainer className="max-w-7xl">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <PageHeader
              subtext="Evidence-first finance chat"
              title="Fainens Agent"
              description="Ask about recorded finances, investigate patterns, and prepare budget changes for explicit confirmation."
            />
            <div className="w-full sm:w-72">
              <Select
                label="Accounting scope"
                value={selectedPeriodId}
                onChange={(event) => setSelectedPeriodId(event.target.value)}
                options={[
                  { value: '', label: 'All recorded history' },
                  ...periods.map((period) => ({ value: String(period.id), label: period.name })),
                ]}
              />
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <Card className="min-h-[620px] overflow-hidden">
              <div className="flex items-center justify-between gap-4 border-b border-[var(--color-border)] p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--ref-primary-container)] text-white"><Sparkles className="h-5 w-5" /></span>
                  <div>
                    <h2 className="font-semibold">Finance manager</h2>
                    <p className="text-xs text-[var(--color-text-secondary)]">Retrieves current ledger facts for each answer</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={startNewConversation}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--ref-primary)] hover:underline"
                >
                  <Sparkles className="h-4 w-4" /> New chat
                </button>
              </div>

              <div className="space-y-5 p-4 sm:p-6">
                {messages.length === 0 && (
                  <div className="py-7 text-center">
                    <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[var(--ref-surface-container-low)] text-[var(--ref-primary)]"><Bot className="h-6 w-6" /></span>
                    <h3 className="mt-3 font-semibold">What would you like to understand?</h3>
                    <p className="mx-auto mt-1 max-w-md text-sm text-[var(--color-text-secondary)]">I can search recorded transactions, inspect balances and obligations, and explain gaps in period coverage.</p>
                    <div className="mx-auto mt-5 flex max-w-2xl flex-wrap justify-center gap-2">
                      {SUGGESTIONS.map((suggestion) => (
                        <button key={suggestion} type="button" onClick={() => void submitQuestion(suggestion)} className="rounded-full border border-[var(--color-border)] px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)] hover:border-[var(--ref-primary)] hover:text-[var(--ref-primary)]">
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((message) => (
                  <div key={message.id} className={cn('flex gap-3', message.role === 'user' && 'justify-end')}>
                    {message.role === 'assistant' && <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--ref-surface-container-low)] text-[var(--ref-primary)]"><Bot className="h-4 w-4" /></span>}
                    <div className={cn('max-w-[90%] rounded-xl px-4 py-3 text-sm', message.role === 'user' ? 'bg-[var(--ref-primary-container)] text-white' : 'border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)]')}>
                      {message.role === 'user' && message.images && message.images.length > 0 && (
                        <div className="mb-3 flex flex-wrap gap-2">
                          {message.images.map((image) => (
                            <button key={image.id} type="button" onClick={() => setPreviewImage(image)} className="cursor-zoom-in rounded-lg focus:outline-none focus:ring-2 focus:ring-white/80" title={`Preview ${image.filename}`}>
                              <img src={image.dataUrl} alt={`Attached ${image.filename}`} className="max-h-40 max-w-48 rounded-lg border border-white/30 object-contain" />
                            </button>
                          ))}
                        </div>
                      )}
                      {message.role === 'assistant'
                        ? <MarkdownMessage>{message.text || '…'}</MarkdownMessage>
                        : editingUserMessageId === message.id
                          ? <div className="space-y-2"><textarea value={editingUserMessageText} onChange={(event) => setEditingUserMessageText(event.target.value)} className="brutalist-input min-h-24 w-full resize-y bg-white/95 text-[var(--color-text-primary)]" maxLength={2000} autoFocus /><div className="flex flex-wrap justify-end gap-2"><Button size="sm" variant="secondary" onClick={() => { setEditingUserMessageId(null); setEditingUserMessageText(''); }} disabled={isSending}>Cancel</Button><Button size="sm" onClick={() => void saveEditedLastUserMessage(message)} disabled={isSending}><Send className="h-4 w-4" /> Save &amp; resend</Button></div></div>
                          : <p className="whitespace-pre-wrap leading-6">{message.text}</p>}
                      {message.role === 'user' && message.id === latestUserMessageId && editingUserMessageId !== message.id && !isSending && !message.images?.length && (
                        <div className="mt-2 flex justify-end gap-1 border-t border-white/20 pt-2">
                          <button type="button" onClick={() => retryLastUserMessage(message)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-white/85 hover:bg-white/15 hover:text-white" title="Send this message again"><RefreshCw className="h-3.5 w-3.5" /> Retry</button>
                          <button type="button" onClick={() => { setEditingUserMessageId(message.id); setEditingUserMessageText(message.text); }} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-white/85 hover:bg-white/15 hover:text-white" title="Edit this message and regenerate the reply"><Pencil className="h-3.5 w-3.5" /> Edit</button>
                        </div>
                      )}
                      {message.response && (
                        <>
                          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[var(--color-text-secondary)]">
                            <span className="rounded-full bg-[var(--ref-surface-container-low)] px-2 py-1">Scope: {scopeLabel(message.response.scope ?? (isRecord(message.response.context) ? message.response.context.scope : null), periods)}</span>
                            {message.response.revision != null && <span className="rounded-full bg-[var(--ref-surface-container-low)] px-2 py-1">Revision {message.response.revision}</span>}
                            {!message.response.llmAvailable && <span className="rounded-full bg-[var(--color-warning)]/10 px-2 py-1 text-[var(--color-warning)]">LLM setup required for written analysis</span>}
                          </div>
                          <ToolTrace response={message.response} />
                          {message.response.pendingActions?.map((action, index) => isTransactionProposal(action) && <TransactionProposalCard key={`${action.approvalId}-${index}`} proposal={action} categories={categories} conversationId={message.response.conversationId ?? activeConversationId} />)}
                        </>
                      )}
                    </div>
                    {message.role === 'user' && <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--ref-surface-container-highest)] text-[var(--color-text-secondary)]"><User className="h-4 w-4" /></span>}
                  </div>
                ))}

                {isSending && <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]"><LoaderCircle className="h-4 w-4 animate-spin" /> {streamActivity ?? 'Reading your ledger…'}</div>}
                {error && <p role="alert" className="rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-danger)]">{error}</p>}
                {notice && <p role="status" className="rounded-lg border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 p-3 text-sm text-[var(--color-success)]">{notice}</p>}
              </div>

              <form
                onSubmit={(event) => { event.preventDefault(); void submitQuestion(); }}
                onDragOver={(event) => { event.preventDefault(); if (!isSending) setIsDraggingImages(true); }}
                onDragLeave={() => setIsDraggingImages(false)}
                onDrop={(event) => { event.preventDefault(); setIsDraggingImages(false); if (!isSending) void addImageFiles(Array.from(event.dataTransfer.files)); }}
                className={cn('border-t border-[var(--color-border)] bg-[var(--color-background)] p-3 sm:p-4', isDraggingImages && 'bg-[var(--ref-primary)]/5')}
              >
                <label htmlFor="agent-question" className="sr-only">Ask Fainens Agent</label>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept={AGENT_IMAGE_TYPES.join(',')}
                  multiple
                  disabled={isSending}
                  onChange={(event) => { void addImageFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ''; }}
                  className="hidden"
                />
                {pendingImages.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {pendingImages.map((image) => (
                      <div key={image.id} className="group relative">
                        <button type="button" onClick={() => setPreviewImage(image)} className="cursor-zoom-in rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--ref-primary)]" title={`Preview ${image.filename}`}>
                          <img src={image.dataUrl} alt={image.filename} className="h-16 w-16 rounded-lg border border-[var(--color-border)] object-cover" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingImages((current) => current.filter((candidate) => candidate.id !== image.id))}
                          className="absolute -right-1.5 -top-1.5 rounded-full bg-[var(--color-danger)] p-0.5 text-white shadow"
                          aria-label={`Remove ${image.filename}`}
                        ><X className="h-3 w-3" /></button>
                      </div>
                    ))}
                  </div>
                )}
                {imageError && <p role="alert" className="mb-2 whitespace-pre-line text-xs text-[var(--color-danger)]">{imageError}</p>}
                <div className={cn(
                  'border border-[var(--color-border)] bg-[var(--color-surface)] transition-colors',
                  isComposerExpanded ? 'rounded-[1.65rem] px-4 py-3' : 'flex items-center gap-2 rounded-full p-1.5',
                  isDraggingImages && 'border-[var(--ref-primary)] bg-[var(--ref-primary)]/5 ring-2 ring-[var(--ref-primary)]/15',
                )}>
                  <textarea
                    ref={questionInputRef}
                    id="agent-question"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submitQuestion(); } }}
                    placeholder="Ask Fainens anything…"
                    rows={1}
                    maxLength={2000}
                    aria-describedby="agent-question-help"
                    className={cn(
                      'max-h-40 resize-none overflow-y-hidden border-0 bg-transparent text-sm leading-6 shadow-none outline-none placeholder:text-[var(--color-text-secondary)] focus:border-0 focus:ring-0',
                      isComposerExpanded ? 'block min-h-10 w-full px-0 py-0' : 'min-h-10 min-w-0 flex-1 px-2 py-2',
                    )}
                  />
                  <div className={cn(isComposerExpanded ? 'mt-2 flex items-center justify-between gap-3' : 'contents')}>
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={isSending || pendingImages.length >= MAX_AGENT_IMAGE_COUNT}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--ref-primary)]/10 hover:text-[var(--ref-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                      title="Attach images"
                      aria-label="Attach images"
                    ><ImagePlus className="h-5 w-5" /></button>
                    {isSending ? (
                      <button type="button" onClick={stopAgentQuery} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--color-text-primary)] text-[var(--color-background)] transition-transform hover:scale-105" aria-label="Stop response" title="Stop response">
                        <Square className="h-3.5 w-3.5 fill-current" />
                      </button>
                    ) : (
                      <Button type="submit" disabled={draft.trim().length < 2} className="h-9 w-9 shrink-0 rounded-full p-0" aria-label="Send question" title="Send message"><Send className="mx-auto h-4 w-4" /></Button>
                    )}
                  </div>
                </div>
                <p id="agent-question-help" className="sr-only">Drop an image here or use the attach button. JPEG, PNG, WebP, and GIF up to 4 MB. Images are not retained.</p>
              </form>
            </Card>

            {previewImage && (
              <div
                role="dialog"
                aria-modal="true"
                aria-label={`Preview ${previewImage.filename}`}
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
                onClick={() => setPreviewImage(null)}
              >
                <div className="relative flex max-h-full max-w-5xl flex-col items-center gap-3 rounded-xl bg-[var(--color-surface)] p-3 shadow-2xl" onClick={(event) => event.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => setPreviewImage(null)}
                    className="absolute right-2 top-2 z-10 rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
                    aria-label="Close image preview"
                    title="Close preview"
                  ><X className="h-5 w-5" /></button>
                  <img src={previewImage.dataUrl} alt={previewImage.filename} className="max-h-[80vh] max-w-[min(90vw,80rem)] rounded-lg object-contain" />
                  <p className="max-w-full truncate px-8 text-xs text-[var(--color-text-secondary)]">{previewImage.filename}</p>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <Card
                title="Conversations"
                action={<span className="text-xs text-[var(--color-text-secondary)]">{activeConversations.length} active · {archivedConversations.length} archived</span>}
              >
                <div className="max-h-56 space-y-1 overflow-y-auto">
                  {conversations.length === 0 && <p className="text-sm text-[var(--color-text-secondary)]">Your conversations will appear here.</p>}
                  {conversations.map((conversation) => {
                    const isActive = conversation.id === activeConversationId;
                    const isArchived = conversation.archivedAt != null;
                    const isBusy = conversationActionId === conversation.id;
                    return (
                      <div
                        key={conversation.id}
                        className={cn(
                          'rounded-lg px-2 py-2 transition-colors',
                          isActive ? 'bg-[var(--ref-primary-container)] text-white' : 'hover:bg-[var(--ref-surface-container-low)]',
                        )}
                      >
                        {editingConversationId === conversation.id ? (
                          <form
                            className="flex items-center gap-1"
                            onSubmit={(event) => { event.preventDefault(); void saveConversationTitle(conversation.id); }}
                          >
                            <input
                              autoFocus
                              value={conversationTitleDraft}
                              onChange={(event) => setConversationTitleDraft(event.target.value)}
                              onKeyDown={(event) => { if (event.key === 'Escape') { setEditingConversationId(null); setConversationTitleDraft(''); } }}
                              maxLength={72}
                              aria-label="Conversation title"
                              className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-sm text-[var(--color-text-primary)]"
                            />
                            <button type="submit" className="rounded p-1 text-[var(--color-success)] hover:bg-black/10" title="Save title" aria-label="Save title"><Check className="h-4 w-4" /></button>
                            <button type="button" onClick={() => { setEditingConversationId(null); setConversationTitleDraft(''); }} className="rounded p-1 hover:bg-black/10" title="Cancel rename" aria-label="Cancel rename"><X className="h-4 w-4" /></button>
                          </form>
                        ) : (
                          <div className="flex items-start gap-2">
                            <button
                              type="button"
                              onClick={() => void selectConversation(conversation.id)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <span className="flex items-center gap-1 truncate text-sm font-medium">
                                {conversation.isPinned && <Pin className="h-3 w-3 shrink-0" aria-label="Pinned" />}
                                <span className="truncate">{conversation.title}</span>
                              </span>
                              <span className={cn('mt-0.5 block text-xs', isActive ? 'text-white/80' : 'text-[var(--color-text-secondary)]')}>
                                {isArchived ? `Archived · ${formatDate(conversation.archivedAt ?? conversation.updatedAt)}` : formatDate(conversation.updatedAt)}
                              </span>
                            </button>
                            <div className="relative shrink-0">
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => setOpenConversationMenuId((current) => current === conversation.id ? null : conversation.id)}
                                className={cn('rounded p-1 hover:bg-black/10', isActive ? 'text-white' : 'text-[var(--color-text-secondary)]')}
                                title="Conversation actions"
                                aria-label={`Actions for ${conversation.title}`}
                                aria-expanded={openConversationMenuId === conversation.id}
                              ><MoreHorizontal className="h-4 w-4" /></button>
                              {openConversationMenuId === conversation.id && (
                                <div role="menu" className="absolute right-0 top-8 z-20 min-w-44 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1 text-[var(--color-text-primary)] shadow-lg">
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => { setEditingConversationId(conversation.id); setConversationTitleDraft(conversation.title); setOpenConversationMenuId(null); setError(null); }}
                                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--ref-surface-container-low)]"
                                  ><Pencil className="h-3.5 w-3.5" /> Edit title</button>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => { setOpenConversationMenuId(null); void updateConversation(conversation.id, { isPinned: !conversation.isPinned }); }}
                                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--ref-surface-container-low)]"
                                  >{conversation.isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />} {conversation.isPinned ? 'Unpin conversation' : 'Pin conversation'}</button>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => { setOpenConversationMenuId(null); void updateConversation(conversation.id, { archived: !isArchived }); }}
                                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--ref-surface-container-low)]"
                                  >{isArchived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />} {isArchived ? 'Restore conversation' : 'Archive conversation'}</button>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => void deleteConversation(conversation)}
                                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
                                  ><Trash2 className="h-3.5 w-3.5" /> Delete conversation</button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {isLoadingConversation && <p className="mt-3 flex items-center gap-2 text-xs text-[var(--color-text-secondary)]"><LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Loading conversation…</p>}
              </Card>

              <Card title="Trust boundary">
                <div className="space-y-3 text-sm text-[var(--color-text-secondary)]">
                  <p className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-success)]" /> Retrieval stays read-only. Any budget change is shown as a normalized proposal and requires your explicit confirmation before execution.</p>
                  <p className="flex gap-2"><RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ref-primary)]" /> Every question retrieves fresh financial facts instead of relying on chat memory.</p>
                </div>
              </Card>

              <Card title="Budget plan preview">
                <p className="text-sm text-[var(--color-text-secondary)]">Get deterministic spending suggestions for {selectedPeriod?.name ?? 'the selected period'}. It does not change your budget.</p>
                <Button variant="secondary" className="mt-4 w-full" onClick={() => void previewBudget()} isLoading={isPlanning} disabled={!selectedPeriodId}>
                  <Sparkles className="h-4 w-4" /> Preview plan
                </Button>
                {budgetPreview && (
                  <div className="mt-4 border-t border-[var(--color-border)] pt-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Target spend {formatCurrency(budgetPreview.targetSpendCents)}</p>
                    <div className="mt-3 space-y-3">
                      {budgetPreview.recommendations.slice(0, 5).map((recommendation, index) => (
                        <div key={`${recommendation.categoryId}-${index}`} className="rounded-lg bg-[var(--color-background)] p-3">
                          <div className="flex items-start justify-between gap-3"><span className="text-sm font-medium">{recommendation.category}</span><span className="text-sm font-semibold">{formatCurrency(recommendation.suggestedAmountCents)}</span></div>
                          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{recommendation.basis}</p>
                        </div>
                      ))}
                    </div>
                    <p className="mt-3 text-xs text-[var(--color-text-secondary)]">Revision {budgetPreview.revision} · Preview only</p>
                    <Button variant="secondary" className="mt-4 w-full" onClick={() => void prepareBudgetAction()} isLoading={isPreparingAction} disabled={!!budgetAction}>
                      <ShieldCheck className="h-4 w-4" /> Prepare for confirmation
                    </Button>
                  </div>
                )}
                {budgetAction && (
                  <div className="mt-4 border-t border-[var(--color-border)] pt-4">
                    <div className="rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3">
                      <p className="text-sm font-semibold">Review before applying</p>
                      <p className="mt-1 text-xs text-[var(--color-text-secondary)]">This will upsert {budgetAction.details.length} category plan{budgetAction.details.length === 1 ? '' : 's'} for {selectedPeriod?.name ?? 'the selected period'}. Existing categories not listed stay unchanged.</p>
                      <div className="mt-3 max-h-40 space-y-1 overflow-y-auto">
                        {budgetAction.details.map((detail) => <div key={detail.categoryId} className="flex items-center justify-between gap-2 text-xs"><span>{detail.category}</span><span className="font-semibold">{formatCurrency(detail.plannedAmountCents)}</span></div>)}
                      </div>
                      <p className="mt-3 text-[11px] text-[var(--color-text-secondary)]">Bound to revision {budgetAction.baseFinancialRevision} · expires {formatDate(budgetAction.expiresAt)}</p>
                      {budgetAction.approvalToken ? (
                        <div className="mt-3 flex gap-2"><Button size="sm" onClick={() => void executeBudgetAction()} isLoading={isExecutingAction}><Check className="h-4 w-4" /> Confirm &amp; apply</Button><Button size="sm" variant="secondary" onClick={() => void rejectBudgetAction()} disabled={isExecutingAction}>Dismiss</Button></div>
                      ) : <p className="mt-3 text-xs text-[var(--color-danger)]">The one-time approval token is no longer available in this browser. Prepare a fresh proposal.</p>}
                    </div>
                  </div>
                )}
              </Card>

              {selectedPeriod && <Card title="Current scope"><p className="text-sm font-medium">{selectedPeriod.name}</p><p className="mt-1 text-xs text-[var(--color-text-secondary)]">{formatDate(selectedPeriod.startDate)} – {formatDate(selectedPeriod.endDate)}</p></Card>}
            </div>
          </div>
        </div>
      </PageContainer>
    </RequireAuth>
  );
}
