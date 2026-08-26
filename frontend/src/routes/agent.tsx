import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  ChevronDown,
  ChevronUp,
  Database,
  LoaderCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  User,
} from 'lucide-react';
import { PageContainer } from '../components/ui/PageContainer';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Select } from '../components/ui/Select';
import { RequireAuth } from '../lib/auth';
import { api } from '../lib/api';
import { cn, formatCurrency, formatDate } from '../lib/utils';

export const Route = createFileRoute('/agent')({
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

type ChatMessage =
  | { id: string; role: 'user'; text: string; createdAt: number }
  | { id: string; role: 'assistant'; text: string; createdAt: number; response?: AgentResponse };

const STORAGE_KEY = 'fainens.agent-workspace.v1';
const SUGGESTIONS = [
  'What were my top 10 expenses recently?',
  'Find spending similar to my latest transaction.',
  'How is my budget tracking this period?',
  'What bills and obligations are coming up?',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSavedMessages(): ChatMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is ChatMessage =>
      isRecord(item)
      && (item.role === 'user' || item.role === 'assistant')
      && typeof item.id === 'string'
      && typeof item.text === 'string'
      && typeof item.createdAt === 'number',
    ) : [];
  } catch {
    return [];
  }
}

function scopeLabel(scope: unknown, periods: Period[]): string {
  if (!isRecord(scope)) return 'Selected recorded data';
  if (typeof scope.periodName === 'string') return scope.periodName;
  if (typeof scope.periodId === 'number') return periods.find((period) => period.id === scope.periodId)?.name ?? `Period #${scope.periodId}`;
  return 'All recorded history';
}

function resultLink(toolName: string): { href: string; label: string } | null {
  if (toolName === 'search_transactions' || toolName === 'get_financial_facts') return { href: '/transactions', label: 'Open transactions' };
  if (toolName === 'get_account_balances' || toolName === 'get_reconciliation_status') return { href: '/accounts', label: 'Open accounts' };
  if (toolName === 'get_budget_facts' || toolName === 'preview_budget_plan') return { href: '/budget', label: 'Open budget' };
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

function AgentPage() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(readSavedMessages);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [budgetPreview, setBudgetPreview] = useState<BudgetPreview | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);

  useEffect(() => {
    void api.periods.list()
      .then((data) => {
        const availablePeriods = data as Period[];
        setPeriods(availablePeriods);
        const active = availablePeriods.find((period) => period.isActive) ?? availablePeriods[0];
        if (active) setSelectedPeriodId(String(active.id));
      })
      .catch(() => setError('Could not load accounting periods. You can still ask across recorded history.'));
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30)));
      } catch {
        // Keeping the active conversation in memory is preferable to failing
        // the chat just because a browser has a restrictive storage quota.
      }
    }
  }, [messages]);

  const selectedPeriod = useMemo(
    () => periods.find((period) => String(period.id) === selectedPeriodId),
    [periods, selectedPeriodId],
  );

  const submitQuestion = async (question = draft) => {
    const text = question.trim();
    if (text.length < 2 || isSending) return;
    const createdAt = Date.now();
    setDraft('');
    setError(null);
    setMessages((current) => [...current, { id: `user-${createdAt}`, role: 'user', text, createdAt }]);
    setIsSending(true);
    try {
      const response = await api.agent.query({
        question: text,
        ...(selectedPeriodId ? { periodId: Number(selectedPeriodId) } : {}),
      });
      const fallback = response.llmAvailable
        ? 'I could not produce a written answer from the available evidence.'
        : 'The LLM is not configured yet, but the structured ledger context was retrieved below.';
      setMessages((current) => [...current, {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text: response.answer ?? response.message ?? fallback,
        createdAt: Date.now(),
        response,
      }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The agent query failed. Please try again.');
    } finally {
      setIsSending(false);
    }
  };

  const previewBudget = async () => {
    if (!selectedPeriodId || isPlanning) return;
    setIsPlanning(true);
    setError(null);
    try {
      setBudgetPreview(await api.agent.planBudget({ periodId: Number(selectedPeriodId) }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not prepare the budget plan.');
    } finally {
      setIsPlanning(false);
    }
  };

  return (
    <RequireAuth>
      <PageContainer className="max-w-7xl">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <PageHeader
              subtext="Evidence-first finance chat"
              title="Fainens Agent"
              description="Ask about recorded finances, investigate patterns, and preview a budget plan. This first release is read-only."
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
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setMessages([])}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-danger)]"
                  >
                    <Trash2 className="h-4 w-4" /> Clear
                  </button>
                )}
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
                      <p className="whitespace-pre-wrap leading-6">{message.text}</p>
                      {message.response && (
                        <>
                          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[var(--color-text-secondary)]">
                            <span className="rounded-full bg-[var(--ref-surface-container-low)] px-2 py-1">Scope: {scopeLabel(message.response.scope ?? (isRecord(message.response.context) ? message.response.context.scope : null), periods)}</span>
                            {message.response.revision != null && <span className="rounded-full bg-[var(--ref-surface-container-low)] px-2 py-1">Revision {message.response.revision}</span>}
                            {!message.response.llmAvailable && <span className="rounded-full bg-[var(--color-warning)]/10 px-2 py-1 text-[var(--color-warning)]">LLM setup required for written analysis</span>}
                          </div>
                          <ToolTrace response={message.response} />
                        </>
                      )}
                    </div>
                    {message.role === 'user' && <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--ref-surface-container-highest)] text-[var(--color-text-secondary)]"><User className="h-4 w-4" /></span>}
                  </div>
                ))}

                {isSending && <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]"><LoaderCircle className="h-4 w-4 animate-spin" /> Reading your ledger…</div>}
                {error && <p role="alert" className="rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-danger)]">{error}</p>}
              </div>

              <form onSubmit={(event) => { event.preventDefault(); void submitQuestion(); }} className="border-t border-[var(--color-border)] bg-[var(--color-background)] p-4">
                <label htmlFor="agent-question" className="sr-only">Ask Fainens Agent</label>
                <div className="flex items-end gap-2">
                  <textarea
                    id="agent-question"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submitQuestion(); } }}
                    placeholder="Ask about spending, balances, obligations, or a plan…"
                    rows={2}
                    maxLength={2000}
                    className="brutalist-input min-h-12 resize-y"
                  />
                  <Button type="submit" disabled={draft.trim().length < 2} isLoading={isSending} className="h-12 px-4" aria-label="Send question"><Send className="h-4 w-4" /></Button>
                </div>
                <p className="mt-2 text-xs text-[var(--color-text-secondary)]">Answers are based on live read-only tools. Changes will require a future explicit approval flow.</p>
              </form>
            </Card>

            <div className="space-y-4">
              <Card title="Trust boundary">
                <div className="space-y-3 text-sm text-[var(--color-text-secondary)]">
                  <p className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-success)]" /> This workspace cannot create, edit, delete, or reconcile data.</p>
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
