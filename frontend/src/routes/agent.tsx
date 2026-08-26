import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
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
type Conversation = Awaited<ReturnType<typeof api.agent.conversations.list>>['conversations'][number];
type ChatImage = { id: string; filename: string; mimeType: string; dataUrl: string; fileSize: number };

type ChatMessage =
  | { id: string; role: 'user'; text: string; createdAt: number; images?: ChatImage[] }
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

function AgentPage() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [pendingImages, setPendingImages] = useState<ChatImage[]>([]);
  const [isDraggingImages, setIsDraggingImages] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [streamActivity, setStreamActivity] = useState<string | null>(null);
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  const [conversationActionId, setConversationActionId] = useState<number | null>(null);
  const [openConversationMenuId, setOpenConversationMenuId] = useState<number | null>(null);
  const [editingConversationId, setEditingConversationId] = useState<number | null>(null);
  const [conversationTitleDraft, setConversationTitleDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [budgetPreview, setBudgetPreview] = useState<BudgetPreview | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const refreshConversations = async () => {
    const result = await api.agent.conversations.list({ includeArchived: true });
    setConversations(result.conversations);
    return result.conversations;
  };

  const selectConversation = async (conversationId: number) => {
    if (conversationId === activeConversationId || isLoadingConversation) return;
    setIsLoadingConversation(true);
    setError(null);
    try {
      const detail = await api.agent.conversations.get(conversationId);
      setActiveConversationId(detail.conversation.id);
      setMessages(detail.messages.map((message) => message.role === 'assistant'
        ? { id: String(message.id), role: 'assistant', text: message.content, createdAt: message.createdAt, response: isRecord(message.response) ? message.response as AgentResponse : undefined }
        : { id: String(message.id), role: 'user', text: message.content, createdAt: message.createdAt },
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
  }, []);

  useEffect(() => {
    void refreshConversations()
      .then((available) => {
        if (available[0]) void selectConversation(available[0].id);
      })
      .catch(() => setError('Could not load saved conversations.'));
  }, []);

  const selectedPeriod = useMemo(
    () => periods.find((period) => String(period.id) === selectedPeriodId),
    [periods, selectedPeriodId],
  );

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

  const submitQuestion = async (question = draft) => {
    const text = question.trim();
    if (text.length < 2 || isSending) return;
    const attachedImages = pendingImages;
    const createdAt = Date.now();
    setDraft('');
    setError(null);
    setImageError(null);
    setMessages((current) => [...current, { id: `user-${createdAt}`, role: 'user', text, createdAt, images: attachedImages }]);
    setIsSending(true);
    setStreamActivity('Thinking…');
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
      });
      // Keep the complete receipt even if the final SSE event was processed
      // immediately before React applied its state update.
      setMessages((current) => current.map((message) =>
        message.id === assistantId && message.role === 'assistant'
          ? { ...message, response }
          : message,
      ));
      setPendingImages([]);
      void refreshConversations().catch(() => undefined);
    } catch (caught) {
      setMessages((current) => current.filter((message) => message.id !== streamedAssistantId));
      setError(caught instanceof Error ? caught.message : 'The agent query failed. Please try again.');
    } finally {
      setIsSending(false);
      setStreamActivity(null);
    }
  };

  const startNewConversation = () => {
    setActiveConversationId(null);
    setMessages([]);
    setDraft('');
    setPendingImages([]);
    setImageError(null);
    setError(null);
    setBudgetPreview(null);
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not prepare the budget plan.');
    } finally {
      setIsPlanning(false);
    }
  };

  const activeConversations = conversations.filter((conversation) => conversation.archivedAt == null);
  const archivedConversations = conversations.filter((conversation) => conversation.archivedAt != null);

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
                            <img key={image.id} src={image.dataUrl} alt={`Attached ${image.filename}`} className="max-h-40 max-w-48 rounded-lg border border-white/30 object-contain" />
                          ))}
                        </div>
                      )}
                      {message.role === 'assistant'
                        ? <MarkdownMessage>{message.text || '…'}</MarkdownMessage>
                        : <p className="whitespace-pre-wrap leading-6">{message.text}</p>}
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

                {isSending && <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]"><LoaderCircle className="h-4 w-4 animate-spin" /> {streamActivity ?? 'Reading your ledger…'}</div>}
                {error && <p role="alert" className="rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-danger)]">{error}</p>}
              </div>

              <form
                onSubmit={(event) => { event.preventDefault(); void submitQuestion(); }}
                onDragOver={(event) => { event.preventDefault(); if (!isSending) setIsDraggingImages(true); }}
                onDragLeave={() => setIsDraggingImages(false)}
                onDrop={(event) => { event.preventDefault(); setIsDraggingImages(false); if (!isSending) void addImageFiles(Array.from(event.dataTransfer.files)); }}
                className={cn('border-t border-[var(--color-border)] bg-[var(--color-background)] p-4', isDraggingImages && 'bg-[var(--ref-primary)]/5')}
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
                        <img src={image.dataUrl} alt={image.filename} className="h-16 w-16 rounded-lg border border-[var(--color-border)] object-cover" />
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
                <div className="flex items-end gap-2">
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={isSending || pendingImages.length >= MAX_AGENT_IMAGE_COUNT}
                    className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--ref-primary)] hover:text-[var(--ref-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                    title="Attach images"
                    aria-label="Attach images"
                  ><ImagePlus className="h-5 w-5" /></button>
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
                <p className="mt-2 text-xs text-[var(--color-text-secondary)]">Drop images here or use the image button · JPEG, PNG, WebP, GIF up to 4MB each. Images are sent for this turn and not retained as pixels in chat history.</p>
              </form>
            </Card>

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
                  <p className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-success)]" /> This workspace cannot create, edit, delete, or reconcile financial ledger data. Conversation titles and chat history have separate lifecycle controls.</p>
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
