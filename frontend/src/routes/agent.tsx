import { createFileRoute, useSearch } from '@tanstack/react-router';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Brain,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Database,
  Download,
  HelpCircle,
  ImagePlus,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { PageContainer } from '../components/ui/PageContainer';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { PageHeader } from '../components/ui/PageHeader';
import { AgentMessage } from '../components/agent/AgentMessage';
import { RequireAuth } from '../lib/auth';
import { api } from '../lib/api';
import type { ListAgentConversations200 } from '../generated/client';
import type { AgentBudgetActionProposal, AgentClarification, AgentClarificationChoice, AgentMemory } from '../lib/api';
import { cn, formatCurrency, formatDate, formatDateTime } from '../lib/utils';
import { useDraftStore } from '../stores/draft-store';
import { useAgentSessionStore } from '../features/agent/session-store';
import { agentCommands } from '../features/agent/commands';
import { ConversationList, ConversationTitle, CONVERSATIONS_PAGE_SIZE } from '../features/agent/ConversationList';
import type { AgentActivityStep, AgentResponse, ChatImage, ChatMessage, Conversation, ConversationDetail, Period } from '../features/agent/types';
import { useAgentConversationQuery, useAgentConversationsQuery, useAgentMemoriesQuery, useAgentProfileQuery } from '../features/agent/queries';
import { useAccountsLedgerQuery } from '../features/accounts/queries';
import { useCategoriesQuery } from '../features/categories/queries';
import { queryKeys } from '../features/core/query-keys';
import { usePeriodsLedgerQuery } from '../features/periods/queries';
import {
  allocationForAmount,
  budgetProposalStatusLabel,
  draftFromProposal,
  initialBudgetProposalStatus,
  initialTransactionProposalStatus,
  isBudgetProposal,
  isTransactionProposal,
  journalLinesForAmount,
  proposalUsesExpenseCategory,
  transactionIntentLabel,
  transactionProposalStatusLabel,
  type AgentTransactionProposal,
  type BudgetProposalStatus,
  type TransactionEditDraft,
  type TransactionProposalStatus,
} from '../features/agent/proposal-utils';

export const Route = createFileRoute('/agent')({
  validateSearch: (search: Record<string, unknown>) => ({
    prompt: typeof search.prompt === 'string' ? search.prompt : undefined,
  }),
  component: AgentPage,
} as any);

type AccountOption = {
  id: number;
  name: string;
  type: string;
  isActive: boolean;
  liquidityClass: 'cash_equivalent' | 'receivable' | 'investment' | 'non_cash';
};

function hasAgentResponse(message: ChatMessage): message is Extract<ChatMessage, { role: 'assistant' }> & { response: AgentResponse } {
  return message.role === 'assistant' && message.response != null;
}

function toChatMessages(detail: ConversationDetail): ChatMessage[] {
  return detail.messages.map((message) => message.role === 'assistant'
    ? { id: String(message.id), role: 'assistant', text: message.content, createdAt: message.createdAt, response: isRecord(message.response) ? message.response as AgentResponse : undefined }
    : { id: String(message.id), serverId: message.id, role: 'user', text: message.content, createdAt: message.createdAt },
  );
}

const AGENT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_AGENT_IMAGE_SIZE = 4 * 1024 * 1024;
const MAX_AGENT_IMAGE_COUNT = 3;

type StartupTime = 'morning' | 'afternoon' | 'night';
type StartupSelection = { greeting: string; subtitle: string; prompts: string[] };

const STARTER_COPY: Record<StartupTime, Array<{ greeting: string; subtitle: string }>> = {
  morning: [
    { greeting: 'Morning, Ray. Coffee first or numbers first?', subtitle: 'Pick a starting point or throw me whatever is on your mind.' },
    { greeting: 'Hey Ray, ready for a quick money check?', subtitle: 'Choose a prompt or ask me something completely different.' },
    { greeting: 'Good morning, Ray. What’s on today’s money agenda?', subtitle: 'Let’s make the next decision a little easier.' },
    { greeting: 'Morning Ray, what are we sorting out today?', subtitle: 'Budgets, spending, plans, or something unexpected are all welcome.' },
    { greeting: 'Hey Ray, want to give your finances a head start?', subtitle: 'A small check now can save you a headache later.' },
    { greeting: 'Rise and shine, Ray. How’s the money looking?', subtitle: 'Take a peek at the numbers or jump straight into a plan.' },
    { greeting: 'Morning Ray, shall we make a little financial progress?', subtitle: 'Pick one of the ideas below or start wherever you like.' },
    { greeting: 'Good morning, Ray. What deserves your attention?', subtitle: 'I can help with today, this period, or the bigger picture.' },
    { greeting: 'Hey Ray, ready to see where things stand?', subtitle: 'Let’s turn the morning numbers into something useful.' },
    { greeting: 'Morning, Ray. Want the quick version or the full picture?', subtitle: 'Choose a suggestion or ask for a deeper look.' },
    { greeting: 'Hi Ray, what’s the first money question of the day?', subtitle: 'I’m ready for a check-in, a comparison, or a plan.' },
    { greeting: 'Good morning Ray, let’s get your money bearings.', subtitle: 'Start with a prompt or type your own question.' },
    { greeting: 'Morning Ray. Anything you want to get ahead of?', subtitle: 'Bills, budgets, and spending patterns are good places to start.' },
    { greeting: 'Hey Ray, let’s make today’s money decisions lighter.', subtitle: 'Tell me what you are weighing up and we can work through it.' },
    { greeting: 'Morning, Ray. Time for a tiny financial reset?', subtitle: 'A quick look at your records can set the tone for the day.' },
    { greeting: 'Hello Ray, what would make today feel financially tidy?', subtitle: 'Ask for a summary, a plan, or help with one specific thing.' },
    { greeting: 'Good morning, Ray. Where should we begin?', subtitle: 'There is no wrong starting point here.' },
    { greeting: 'Morning Ray, want to check in before the day gets busy?', subtitle: 'I can surface priorities or follow your lead.' },
    { greeting: 'Hey Ray, let’s see what your numbers are saying.', subtitle: 'Pick a prompt below or bring your own question.' },
    { greeting: 'Morning, Ray. What’s your money mood today?', subtitle: 'Curious, cautious, planning, or just catching up all work.' },
    { greeting: 'Hi Ray, shall we peek at the period so far?', subtitle: 'I can make the current picture quick and readable.' },
    { greeting: 'Good morning Ray. What are we planning around?', subtitle: 'Spending, obligations, savings, and trade-offs are fair game.' },
    { greeting: 'Morning Ray, let’s clear one thing off the money list.', subtitle: 'Ask me about a transaction, a budget, or a next step.' },
    { greeting: 'Hey Ray, want a calm start with the numbers?', subtitle: 'I’ll keep it practical and focus on what matters.' },
    { greeting: 'Morning, Ray. Let’s make the ledger less mysterious.', subtitle: 'Choose a prompt or ask a plain-language question.' },
    { greeting: 'Hello Ray, what should we make sense of first?', subtitle: 'I can look backward, check today, or help plan ahead.' },
    { greeting: 'Good morning, Ray. Shall we do a quick financial scan?', subtitle: 'Start with one of the prompts or write your own.' },
    { greeting: 'Morning Ray, what would be useful to know right now?', subtitle: 'I’m here for the numbers and the decisions around them.' },
    { greeting: 'Hey Ray, let’s give your finances five minutes.', subtitle: 'Pick a direction and I’ll help you take it from there.' },
  ],
  afternoon: [
    { greeting: 'Hey Ray, how’s the money day going?', subtitle: 'Want a quick check-in or a deeper dive?' },
    { greeting: 'Afternoon Ray. Let’s see how things are shaping up.', subtitle: 'Pick a prompt or ask me anything.' },
    { greeting: 'Hi Ray, fancy a quick financial pulse check?', subtitle: 'I’m here for the numbers, the plans, or the messy middle.' },
    { greeting: 'Hey Ray, want to see where the period is landing?', subtitle: 'A quick progress check can help with the rest of the day.' },
    { greeting: 'Afternoon, Ray. What needs a second look?', subtitle: 'I can compare, explain, or help you decide what comes next.' },
    { greeting: 'Hi Ray. How are the numbers treating you today?', subtitle: 'Choose a prompt or bring me the question you actually have.' },
    { greeting: 'Hey Ray, let’s check the financial temperature.', subtitle: 'I’ll keep the answer focused and practical.' },
    { greeting: 'Afternoon Ray, time for a little money housekeeping?', subtitle: 'Look at spending, obligations, or anything that feels unclear.' },
    { greeting: 'Hello Ray. What would make the rest of today easier?', subtitle: 'A budget check or a quick summary may be a good start.' },
    { greeting: 'Hey Ray, shall we make sense of the afternoon numbers?', subtitle: 'Ask about this period or zoom out to the bigger pattern.' },
    { greeting: 'Afternoon, Ray. Want the useful bits without the fuss?', subtitle: 'Pick a suggestion and I’ll keep it clear.' },
    { greeting: 'Hi Ray, what are you curious about right now?', subtitle: 'Recent spending, budgets, plans, and obligations are all fair game.' },
    { greeting: 'Hey Ray, ready for a mid-day money reset?', subtitle: 'Let’s find one useful thing to know or do next.' },
    { greeting: 'Afternoon Ray. Anything feeling a little fuzzy?', subtitle: 'I can trace the records and explain what they mean.' },
    { greeting: 'Hello Ray, let’s check whether the plan still fits.', subtitle: 'Tell me what changed or choose one of the starting points.' },
    { greeting: 'Hey Ray, want a snapshot of where you stand?', subtitle: 'I can keep it brief or walk through the details.' },
    { greeting: 'Afternoon, Ray. What’s the financial plot twist?', subtitle: 'Bring me the odd transaction, the big question, or the next goal.' },
    { greeting: 'Hi Ray. Let’s turn a few numbers into a useful answer.', subtitle: 'Start with a suggestion or ask in your own words.' },
    { greeting: 'Hey Ray, how can I make this check-in worthwhile?', subtitle: 'We can review, compare, plan, or simply answer one question.' },
    { greeting: 'Afternoon Ray, want to catch anything before evening?', subtitle: 'I can look for spending patterns or upcoming obligations.' },
    { greeting: 'Hello Ray. What’s on the money radar?', subtitle: 'I’m ready to help with a decision or a quick fact check.' },
    { greeting: 'Hey Ray, should we look backward or plan forward?', subtitle: 'Either way, I’ll start with the recorded facts.' },
    { greeting: 'Afternoon, Ray. Let’s make the next choice clearer.', subtitle: 'Tell me what you are deciding between.' },
    { greeting: 'Hi Ray, want to see what has changed lately?', subtitle: 'A comparison can often make the picture click.' },
    { greeting: 'Hey Ray, let’s untangle one money question.', subtitle: 'Small questions are welcome too.' },
    { greeting: 'Afternoon Ray. How’s your budget holding up?', subtitle: 'Pick a prompt below or ask for exactly what you need.' },
    { greeting: 'Hello Ray, shall we do a practical check-in?', subtitle: 'No ceremony needed, just ask naturally.' },
    { greeting: 'Hey Ray, what should we investigate today?', subtitle: 'Transactions, categories, cash, and plans are ready to explore.' },
    { greeting: 'Afternoon, Ray. Want a little clarity before the day runs on?', subtitle: 'I can give you the short answer first.' },
    { greeting: 'Hi Ray, let’s use the numbers to make a better next move.', subtitle: 'Choose a direction and I’ll follow it.' },
  ],
  night: [
    { greeting: 'Evening, Ray. Want to wrap up the money day?', subtitle: 'Pick a prompt or tell me what you’re thinking.' },
    { greeting: 'Hey Ray, let’s make sense of today’s numbers.', subtitle: 'A quick check-in now can make tomorrow easier.' },
    { greeting: 'Still up, Ray? Let’s sort out the money stuff.', subtitle: 'Choose a starting point or just type naturally.' },
    { greeting: 'Evening Ray, how did the spending day go?', subtitle: 'I can give you a calm summary before you switch off.' },
    { greeting: 'Hey Ray, want to close the day with a quick check?', subtitle: 'Look at today, the period, or whatever is still nagging you.' },
    { greeting: 'Good evening, Ray. Anything surprise you today?', subtitle: 'We can trace it through the recorded transactions.' },
    { greeting: 'Night, Ray. Shall we put today’s numbers to bed?', subtitle: 'Ask for a summary or plan a smoother tomorrow.' },
    { greeting: 'Hey Ray, ready for a low-key financial debrief?', subtitle: 'No heavy lifting needed, just pick a starting point.' },
    { greeting: 'Evening, Ray. What’s worth checking before tomorrow?', subtitle: 'Bills, budgets, and spending patterns are all here.' },
    { greeting: 'Hi Ray, want the short version of today?', subtitle: 'I can keep it simple or open up the details.' },
    { greeting: 'Hey Ray, let’s tidy up one loose money thought.', subtitle: 'Ask anything from a tiny transaction question to a bigger plan.' },
    { greeting: 'Good evening Ray. How are things looking from here?', subtitle: 'A quick look now can make tomorrow feel less fuzzy.' },
    { greeting: 'Night Ray, want to see what the ledger says about today?', subtitle: 'Choose a prompt or ask in your own words.' },
    { greeting: 'Evening Ray. Did the day stay on budget?', subtitle: 'I can check the facts and explain any gaps.' },
    { greeting: 'Hey Ray, what should we leave clear before bed?', subtitle: 'Let’s handle one useful question together.' },
    { greeting: 'Hi Ray. Fancy a tiny end-of-day money check?', subtitle: 'It can be quick, practical, and done in a minute.' },
    { greeting: 'Evening, Ray. Want to look back or look ahead?', subtitle: 'Both are useful, and you can start wherever feels right.' },
    { greeting: 'Hey Ray, let’s give today a financial closing note.', subtitle: 'Ask for totals, patterns, or tomorrow’s watch-outs.' },
    { greeting: 'Good evening Ray. What’s still on your mind?', subtitle: 'I’m here for the number and the context around it.' },
    { greeting: 'Night, Ray. Shall we make tomorrow a little easier?', subtitle: 'A quick budget or obligation check could help.' },
    { greeting: 'Hey Ray, want to spot anything unusual from today?', subtitle: 'I can search the activity and show you what stands out.' },
    { greeting: 'Evening Ray. Let’s finish one small money task.', subtitle: 'Pick a suggestion or type the question directly.' },
    { greeting: 'Hi Ray, what would be nice to know before calling it a day?', subtitle: 'I’ll keep the answer grounded in your records.' },
    { greeting: 'Hey Ray, how did your plan hold up today?', subtitle: 'We can compare the plan with what actually happened.' },
    { greeting: 'Good evening, Ray. Ready for a gentle numbers check?', subtitle: 'No pressure, just choose what sounds useful.' },
    { greeting: 'Night Ray, let’s untangle any last financial question.', subtitle: 'Recent spending, budgets, and obligations are good places to start.' },
    { greeting: 'Evening, Ray. What should we carry into tomorrow?', subtitle: 'I can help turn today’s facts into a next step.' },
    { greeting: 'Hey Ray, want to end the day with a little clarity?', subtitle: 'Ask naturally and I’ll meet you where you are.' },
    { greeting: 'Hi Ray. Shall we check the money weather before bed?', subtitle: 'A quick snapshot or a deeper look, your choice.' },
    { greeting: 'Evening Ray, let’s put the numbers in perspective.', subtitle: 'Choose a prompt or bring me the thing you keep wondering about.' },
  ],
};

const PLAYFUL_COPY: Record<StartupTime, Array<{ greeting: string; subtitle: string }>> = {
  morning: [
    { greeting: 'Morning, Ray. Did your wallet sleep well?', subtitle: 'Let’s see what it has been whispering about.' },
    { greeting: 'Hey Ray, coffee in hand and receipts in the wild?', subtitle: 'Pick a prompt and we’ll round them up.' },
    { greeting: 'Morning Ray. Ready to make the numbers confess?', subtitle: 'I promise to keep the interrogation friendly.' },
    { greeting: 'Good morning, Ray. Shall we catch the budget before it escapes?', subtitle: 'Choose a starting point and let’s have a look.' },
    { greeting: 'Hey Ray, what financial mischief are we investigating today?', subtitle: 'Tiny mysteries and big plans are both welcome.' },
    { greeting: 'Morning, Ray. Time to give the ledger a little side-eye?', subtitle: 'I can help spot what looks odd or interesting.' },
    { greeting: 'Rise and shine, Ray. Is the wallet feeling brave?', subtitle: 'Let’s find out before the day gets expensive.' },
    { greeting: 'Hey Ray, should we make your money do some explaining?', subtitle: 'Ask me about the spending, the plan, or the plot twist.' },
    { greeting: 'Morning Ray. Let’s find one tiny money win.', subtitle: 'It can be practical, silly, or both.' },
    { greeting: 'Good morning, Ray. Any suspicious transactions lurking around?', subtitle: 'I have a metaphorical magnifying glass ready.' },
    { greeting: 'Hey Ray, shall we turn today’s chaos into a tidy little plan?', subtitle: 'Pick a prompt or freestyle it.' },
    { greeting: 'Morning, Ray. What’s the wallet weather looking like?', subtitle: 'Sunny, stormy, or oddly specific, we can check.' },
  ],
  afternoon: [
    { greeting: 'Hey Ray, has the wallet been behaving or freelancing?', subtitle: 'Let’s check before it tells a different story.' },
    { greeting: 'Afternoon Ray. Ready for the budget gossip?', subtitle: 'I’ll bring the facts and skip the drama.' },
    { greeting: 'Hi Ray, who has been nibbling at the spending plan?', subtitle: 'We can find the usual suspects.' },
    { greeting: 'Hey Ray, want to catch the numbers red-handed?', subtitle: 'Pick a prompt and let’s investigate.' },
    { greeting: 'Afternoon, Ray. Is the budget thriving or being theatrical?', subtitle: 'A quick check should settle it.' },
    { greeting: 'Hi Ray. What’s today’s financial plot twist?', subtitle: 'I can trace it back through the records.' },
    { greeting: 'Hey Ray, should we peek under the budget sofa cushions?', subtitle: 'There may be useful context hiding there.' },
    { greeting: 'Afternoon Ray, time for a wallet reality check?', subtitle: 'No judgement, just readable numbers.' },
    { greeting: 'Hello Ray. Has anything spent money without permission?', subtitle: 'Let’s look at the evidence.' },
    { greeting: 'Hey Ray, let’s see whether your plan survived lunch.', subtitle: 'I can check the period so far.' },
    { greeting: 'Afternoon, Ray. Fancy a tiny financial plot audit?', subtitle: 'Bring me a question and I’ll follow the clues.' },
    { greeting: 'Hi Ray, want to know what your spending is up to?', subtitle: 'The receipts may have opinions.' },
  ],
  night: [
    { greeting: 'Evening, Ray. Did your wallet survive the day?', subtitle: 'Let’s give it a gentle debrief.' },
    { greeting: 'Hey Ray, should we count the damage or celebrate the restraint?', subtitle: 'Either way, I’ll bring the actual numbers.' },
    { greeting: 'Night Ray. Any financial plot twists before lights out?', subtitle: 'We can tidy up the story in a minute.' },
    { greeting: 'Evening, Ray. Let’s tuck the transactions into bed.', subtitle: 'A quick summary should do the trick.' },
    { greeting: 'Hey Ray, was today a treat or a tiny betrayal?', subtitle: 'I can check what really happened.' },
    { greeting: 'Good evening Ray. Time for the wallet debrief?', subtitle: 'No spreadsheets in bed unless you really want them.' },
    { greeting: 'Hi Ray, what did the budget get up to today?', subtitle: 'Let’s hear its side of the story.' },
    { greeting: 'Night, Ray. Shall we put the numbers in pajamas?', subtitle: 'Pick a prompt and we’ll keep it easy.' },
    { greeting: 'Hey Ray, anything suspicious in today’s receipts?', subtitle: 'I have a tiny detective hat ready.' },
    { greeting: 'Evening Ray. Did the spending behave itself?', subtitle: 'Let’s check the facts before we call it a night.' },
    { greeting: 'Hi Ray. Want a quick post-credits scene for today’s money?', subtitle: 'I can summarize the bits worth remembering.' },
    { greeting: 'Night Ray, let’s make tomorrow’s money mood less mysterious.', subtitle: 'A small check now can help.' },
  ],
};

const STARTER_PROMPTS: Record<StartupTime, string[]> = {
  morning: [
    'What should I prioritize financially this period?',
    'How is my budget tracking so far?',
    'What bills and obligations are coming up?',
    'Help me plan today’s spending.',
    'What were my top expenses recently?',
    'Show me anything that needs attention.',
  ],
  afternoon: [
    'What have I spent so far this period?',
    'Am I on track with my budget?',
    'Show my top spending recently.',
    'Find spending similar to my latest transaction.',
    'What bills and obligations are coming up?',
    'Help me plan the rest of this period.',
  ],
  night: [
    'Summarize my spending today.',
    'Did I overspend anywhere today?',
    'What should I watch for tomorrow?',
    'Show my top expenses recently.',
    'What bills and obligations are coming up?',
    'How is my budget tracking this period?',
  ],
};

function startupTime(hour = new Date().getHours()): StartupTime {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'night';
}

function createStartupSelection(nickname = ''): StartupSelection {
  const time = startupTime();
  const prompts = [...STARTER_PROMPTS[time]];
  for (let index = prompts.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [prompts[index], prompts[swapIndex]] = [prompts[swapIndex], prompts[index]];
  }
  const copyOptions = [...STARTER_COPY[time], ...PLAYFUL_COPY[time]];
  const copy = copyOptions[Math.floor(Math.random() * copyOptions.length)] ?? copyOptions[0];
  const displayName = nickname.trim() || 'friend';
  return {
    greeting: copy.greeting.replace(/\bRay\b/g, () => displayName),
    subtitle: copy.subtitle.replace(/\bRay\b/g, () => displayName),
    prompts: prompts.slice(0, 4),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scopeLabel(scope: unknown, periods: Period[]): string {
  if (!isRecord(scope)) return 'Selected recorded data';
  if (typeof scope.periodName === 'string') return scope.periodName;
  if (typeof scope.periodId === 'number') return periods.find((period) => period.id === scope.periodId)?.name ?? `Period #${scope.periodId}`;
  return 'All recorded history';
}

function periodLabel(periodId: number | null, periods: Period[]): string {
  if (periodId == null) return 'Unassigned';
  const period = periods.find((candidate) => candidate.id === periodId);
  return period ? `${period.name} (#${period.id})` : `Period #${periodId}`;
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
  const hasNonLedgerTool = calls.some((call) => call.name === 'ask_clarification');
  if (calls.length === 0 && !hasStructuredContext) return null;

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2.5 text-left text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--ref-surface-container)]"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-2"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-[var(--ref-primary)]/10 text-[var(--ref-primary)]"><Database className="h-3.5 w-3.5" /></span><span>{calls.length > 0 ? <>Evidence checked <strong className="font-semibold text-[var(--color-text-primary)]">{calls.length} {hasNonLedgerTool ? 'tool' : 'ledger source'}{calls.length === 1 ? '' : 's'}</strong></> : 'Structured finance context checked'}</span></span>
        {open ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
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

function ClarificationCard({
  clarification,
  disabled,
  onSelect,
}: {
  clarification: AgentClarification;
  disabled?: boolean;
  onSelect: (choice: AgentClarificationChoice, customValue?: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [customChoiceId, setCustomChoiceId] = useState<string | null>(null);
  const [customValue, setCustomValue] = useState('');
  const customChoice = clarification.choices.find((choice) => choice.id === customChoiceId) ?? null;

  const choose = (choice: AgentClarificationChoice) => {
    if (disabled || selected) return;
    if (choice.freeText) {
      setCustomChoiceId(choice.id);
      return;
    }
    setSelected(choice.label);
    onSelect(choice);
  };

  const submitCustom = () => {
    const value = customValue.trim();
    if (!customChoice || !value || disabled || selected) return;
    setSelected(`${customChoice.label}: ${value}`);
    onSelect(customChoice, value);
  };

  return (
    <div className="mt-4 rounded-xl border border-[var(--ref-primary)]/25 bg-[var(--ref-surface-container-low)] p-4" role="group" aria-label="Clarification needed">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--ref-primary)]/10 text-[var(--ref-primary)]"><HelpCircle className="h-4 w-4" /></span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Quick clarification</p>
          <p className="mt-1 text-sm leading-5 text-[var(--color-text-primary)]">{clarification.question}</p>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {clarification.choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            onClick={() => choose(choice)}
            disabled={Boolean(disabled || selected)}
            className={cn(
              'rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-left transition-colors hover:border-[var(--ref-primary)] hover:bg-[var(--ref-primary)]/5 disabled:cursor-not-allowed disabled:opacity-60',
              selected === choice.label && 'border-[var(--ref-primary)] bg-[var(--ref-primary)]/10',
            )}
          >
            <span className="block text-sm font-semibold">{choice.label}</span>
            {choice.description && <span className="mt-0.5 block text-xs text-[var(--color-text-secondary)]">{choice.description}</span>}
          </button>
        ))}
      </div>
      {customChoice && !selected && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor={`clarification-${clarification.id}`}>Your answer</label>
          <input
            id={`clarification-${clarification.id}`}
            value={customValue}
            onChange={(event) => setCustomValue(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitCustom(); } }}
            className="brutalist-input min-w-0 flex-1"
            placeholder="Type your answer"
            maxLength={200}
            autoFocus
          />
          <Button type="button" size="sm" onClick={submitCustom} disabled={!customValue.trim()}>Send choice</Button>
        </div>
      )}
      {selected && <p className="mt-3 text-xs font-medium text-[var(--color-text-secondary)]">Sent: {selected}</p>}
    </div>
  );
}

function BudgetProposalCard({ proposal, periods }: { proposal: AgentBudgetActionProposal; periods: Period[] }) {
  const [currentProposal, setCurrentProposal] = useState(proposal);
  const [status, setStatus] = useState<BudgetProposalStatus>(initialBudgetProposalStatus(proposal.status));
  const [message, setMessage] = useState<string | null>(null);
  const restorationAttempted = useRef(false);
  const period = periods.find((candidate) => candidate.id === currentProposal.input.periodId);
  const rows = currentProposal.details;
  const total = rows.reduce((sum, row) => sum + row.plannedAmountCents, 0);

  useEffect(() => {
    if (restorationAttempted.current || currentProposal.approvalToken || (proposal.status !== 'pending' && proposal.status !== 'expired')) return;
    restorationAttempted.current = true;
    setStatus('restoring');
    setMessage(null);
    void agentCommands.approvals.reissue(proposal.approvalId)
      .then((refreshed) => {
        if (!isBudgetProposal(refreshed)) throw new Error('The restored approval was not a budget proposal.');
        setCurrentProposal(refreshed);
        setStatus(initialBudgetProposalStatus(refreshed.status));
        setMessage(refreshed.status === 'pending' ? 'Review restored after reload.' : null);
      })
      .catch((caught) => {
        setStatus(initialBudgetProposalStatus(proposal.status));
        setMessage(caught instanceof Error ? caught.message : 'Could not restore this budget proposal.');
      });
  }, [currentProposal.approvalToken, proposal.approvalId, proposal.status]);

  const execute = async () => {
    if (!currentProposal.approvalToken || status !== 'pending') return;
    setStatus('executing');
    setMessage(null);
    try {
      const result = await agentCommands.approvals.execute(currentProposal.approvalId, currentProposal.approvalToken);
      setStatus('executed');
      setMessage(`Budget saved. ${result.receipt.changedCount ?? 0} categor${(result.receipt.changedCount ?? 0) === 1 ? 'y' : 'ies'} changed.`);
    } catch (caught) {
      setStatus('error');
      setMessage(caught instanceof Error ? caught.message : 'Could not save this budget.');
    }
  };

  const reject = async () => {
    if (!currentProposal.approvalToken || status !== 'pending') return;
    setStatus('executing');
    setMessage(null);
    try {
      await agentCommands.approvals.reject(currentProposal.approvalId, currentProposal.approvalToken);
      setStatus('rejected');
      setMessage('Budget proposal dismissed. Nothing changed.');
    } catch (caught) {
      setStatus('error');
      setMessage(caught instanceof Error ? caught.message : 'Could not dismiss this budget proposal.');
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-[var(--ref-primary)]/35 bg-[var(--ref-primary)]/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Budget update ready for review</p>
          <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{period ? `${period.name} (#${period.id})` : `Period #${currentProposal.input.periodId}`} · creates or updates {rows.length} categor{rows.length === 1 ? 'y' : 'ies'}</p>
        </div>
        <span className={cn('shrink-0 rounded-full bg-[var(--color-surface)] px-2 py-1 text-[11px] font-semibold uppercase tracking-wide', (status === 'executed' || status === 'rejected') && 'text-[var(--color-success)]')}>{budgetProposalStatusLabel(status)}</span>
      </div>
      <div className="mt-3 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        {rows.map((row) => (
          <div key={row.categoryId} className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-3 py-2 last:border-b-0">
            <span className="min-w-0 truncate text-sm">{row.category}</span>
            <span className="shrink-0 font-mono text-sm font-semibold">{formatCurrency(row.plannedAmountCents)}</span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 bg-[var(--ref-surface-container-low)] px-3 py-2 text-sm font-semibold"><span>Total planned</span><span className="font-mono">{formatCurrency(total)}</span></div>
      </div>
      {currentProposal.assumptions.length > 0 && <p className="mt-3 text-xs text-[var(--color-text-secondary)]">Assumption: {currentProposal.assumptions.join(' · ')}</p>}
      {currentProposal.approvalToken && status === 'pending' && <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" onClick={() => void execute()}><Check className="h-4 w-4" /> Confirm budget</Button><Button size="sm" variant="secondary" onClick={() => void reject()}>Dismiss</Button></div>}
      {!currentProposal.approvalToken && status === 'pending' && <p className="mt-3 text-xs text-[var(--color-danger)]">The approval could not be restored. Ask the agent to prepare this budget again.</p>}
      {status === 'expired' && <p className="mt-3 text-xs text-[var(--color-text-secondary)]">This budget proposal expired before confirmation. Ask the agent to prepare it again.</p>}
      {status === 'superseded' && <p className="mt-3 text-xs text-[var(--color-text-secondary)]">This budget proposal was replaced by a newer proposal.</p>}
      {message && <p className={cn('mt-3 text-xs', status === 'executed' || status === 'rejected' ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]')}>{message}</p>}
    </div>
  );
}

function isClarification(value: unknown): value is AgentClarification {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || typeof value.question !== 'string' || !value.question || !Array.isArray(value.choices)) return false;
  const ids = new Set<string>();
  return value.choices.length >= 2 && value.choices.length <= 4 && value.choices.every((choice) => {
    if (!isRecord(choice) || typeof choice.id !== 'string' || !choice.id || ids.has(choice.id) || typeof choice.label !== 'string' || !choice.label) return false;
    ids.add(choice.id);
    return (choice.description == null || typeof choice.description === 'string')
      && (choice.freeText == null || typeof choice.freeText === 'boolean');
  });
}

function TransactionProposalCard({
  proposal,
  categories,
  accounts,
  periods,
  conversationId,
}: {
  proposal: AgentTransactionProposal;
  categories: Array<{ id: number; name: string }>;
  accounts: AccountOption[];
  periods: Period[];
  conversationId?: number | null;
}) {
  const [currentProposal, setCurrentProposal] = useState(proposal);
  const [status, setStatus] = useState<TransactionProposalStatus>(initialTransactionProposalStatus(proposal.status));
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<TransactionEditDraft>(() => draftFromProposal(proposal));
  const restorationAttempted = useRef(false);
  const details = currentProposal.details;
  const input = currentProposal.input;
  const usesExpenseCategory = proposalUsesExpenseCategory(input.intent);
  const intentLabel = transactionIntentLabel(input.intent);
  const activeAccounts = accounts.filter((account) => account.isActive);
  const cashAccounts = activeAccounts.filter((account) => account.type === 'asset' && account.liquidityClass === 'cash_equivalent');
  const paymentAccounts = activeAccounts.filter((account) => account.type === 'liability' || (account.type === 'asset' && account.liquidityClass === 'cash_equivalent'));
  const outgoingAccounts = input.intent === 'transfer' ? cashAccounts : input.intent === 'expense' ? paymentAccounts : [];
  const incomingAccounts = input.intent === 'transfer' || input.intent === 'income' ? cashAccounts : [];
  const outgoingAccountIds = new Set(outgoingAccounts.map((account) => account.id));
  const incomingAccountIds = new Set(incomingAccounts.map((account) => account.id));
  const outgoingLineIndex = input.lines.findIndex((line) => line.credit > 0 && outgoingAccountIds.has(line.accountId));
  const incomingLineIndex = input.lines.findIndex((line) => line.debit > 0 && incomingAccountIds.has(line.accountId));
  const canEditOutgoingAccount = outgoingLineIndex >= 0 && outgoingAccounts.length > 0;
  const canEditIncomingAccount = incomingLineIndex >= 0 && incomingAccounts.length > 0;
  const outgoingAccountName = outgoingLineIndex >= 0 ? details.lines[outgoingLineIndex]?.account : null;
  const incomingAccountName = incomingLineIndex >= 0 ? details.lines[incomingLineIndex]?.account : null;
  const categoryName = !usesExpenseCategory ? null : input.categoryId == null
    ? (input.categoryAllocations[0] ? categories.find((category) => category.id === input.categoryAllocations[0].categoryId)?.name ?? details.categoryAllocations[0]?.category : null)
    : categories.find((category) => category.id === input.categoryId)?.name ?? details.categoryAllocations.find((allocation) => allocation.categoryId === input.categoryId)?.category;

  useEffect(() => {
    if (restorationAttempted.current || currentProposal.approvalToken || (proposal.status !== 'pending' && proposal.status !== 'expired')) return;
    restorationAttempted.current = true;
    setStatus('restoring');
    setMessage(null);
    void agentCommands.approvals.reissue(proposal.approvalId)
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
    const outgoingAccountId = draft.outgoingAccountId ? Number(draft.outgoingAccountId) : null;
    const incomingAccountId = draft.incomingAccountId ? Number(draft.incomingAccountId) : null;
    if (canEditOutgoingAccount && (outgoingAccountId == null || !Number.isSafeInteger(outgoingAccountId) || !outgoingAccountIds.has(outgoingAccountId))) {
      setMessage('Choose a valid payment account.');
      return;
    }
    if (canEditIncomingAccount && (incomingAccountId == null || !Number.isSafeInteger(incomingAccountId) || !incomingAccountIds.has(incomingAccountId))) {
      setMessage('Choose a valid receiving account.');
      return;
    }
    if (input.intent === 'transfer' && outgoingAccountId === incomingAccountId) {
      setMessage('Choose two different accounts for a transfer.');
      return;
    }
    setStatus('saving');
    setMessage(null);
    try {
      const nextCategoryId = draft.categoryId ? Number(draft.categoryId) : null;
      const originalCategoryId = input.categoryId ?? input.categoryAllocations[0]?.categoryId ?? null;
      const nextLines = journalLinesForAmount(input.lines, amount);
      if (canEditOutgoingAccount && outgoingLineIndex >= 0 && outgoingAccountId != null) {
        nextLines[outgoingLineIndex] = { ...nextLines[outgoingLineIndex], accountId: outgoingAccountId };
      }
      if (canEditIncomingAccount && incomingLineIndex >= 0 && incomingAccountId != null) {
        nextLines[incomingLineIndex] = { ...nextLines[incomingLineIndex], accountId: incomingAccountId };
      }
      const nextInput = {
        ...input,
        intent: input.intent ?? null,
        dateMs,
        description: draft.name.trim(),
        place: draft.place.trim() || null,
        reference: draft.reference.trim() || null,
        notes: draft.notes.trim() || null,
        categoryId: usesExpenseCategory ? nextCategoryId : null,
        lines: nextLines,
        categoryAllocations: usesExpenseCategory ? allocationForAmount(input.categoryAllocations, details.totalDebit, amount) : [],
      };
      if (usesExpenseCategory && nextCategoryId !== originalCategoryId) {
        if (nextCategoryId == null) {
          nextInput.categoryAllocations = [];
        } else if (nextInput.categoryAllocations.length > 0) {
          const allocatedAmount = nextInput.categoryAllocations.reduce((sum, allocation) => sum + allocation.amount, 0);
          nextInput.categoryAllocations = [{ categoryId: nextCategoryId, amount: allocatedAmount }];
        }
      }
      const refreshed = await agentCommands.actions.prepareTransaction({
        conversationId,
        input: nextInput,
        assumptions: currentProposal.assumptions,
      });
      // A changed proposal must not leave the old bearer token usable. The
      // replacement is prepared first so a transient network failure does not
      // strand the user without a valid review option.
      if (currentProposal.approvalToken) {
        await agentCommands.approvals.reject(currentProposal.approvalId, currentProposal.approvalToken).catch(() => undefined);
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
      const result = await agentCommands.approvals.execute(currentProposal.approvalId, currentProposal.approvalToken);
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
      await agentCommands.approvals.reject(currentProposal.approvalId, currentProposal.approvalToken);
      setStatus('rejected');
      setMessage('Transaction proposal dismissed; nothing was posted.');
    } catch (caught) {
      setStatus('error');
      setMessage(caught instanceof Error ? caught.message : 'Could not dismiss this proposal.');
    }
  };

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm" aria-label={`${intentLabel} proposal`}>
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[var(--ref-primary)]/10 text-[var(--ref-primary)]"><Check className="h-4 w-4" /></span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Ready to review</p>
            <p className="text-xs text-[var(--color-text-secondary)]">Nothing posts until you confirm.</p>
          </div>
        </div>
        <span className={cn('shrink-0 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]', (status === 'executed' || status === 'rejected') && 'border-[var(--color-success)]/25 bg-[var(--color-success)]/10 text-[var(--color-success)]')}>{transactionProposalStatusLabel(status)}</span>
      </div>
      <div className="p-4">
      {status === 'editing' || status === 'saving' ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold sm:col-span-2">Transaction name<input value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} className="brutalist-input mt-1" maxLength={500} /></label>
          <label className="text-xs font-semibold">Amount (IDR)<input inputMode="numeric" value={draft.amount} onChange={(event) => setDraft((value) => ({ ...value, amount: event.target.value }))} className="brutalist-input mt-1" /></label>
          <label className="text-xs font-semibold">Date &amp; time<input type="datetime-local" value={draft.dateTime} onChange={(event) => setDraft((value) => ({ ...value, dateTime: event.target.value }))} className="brutalist-input mt-1" /></label>
          {usesExpenseCategory ? <label className="text-xs font-semibold">Category<select value={draft.categoryId} onChange={(event) => setDraft((value) => ({ ...value, categoryId: event.target.value }))} className="brutalist-input mt-1"><option value="">Uncategorized</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label> : <div><p className="text-xs font-semibold">Type</p><p className="mt-2 text-sm">{intentLabel}</p></div>}
          {canEditOutgoingAccount && <label className="text-xs font-semibold">{input.intent === 'transfer' ? 'Transfer from' : 'Paid from'}<select value={draft.outgoingAccountId} onChange={(event) => setDraft((value) => ({ ...value, outgoingAccountId: event.target.value }))} className="brutalist-input mt-1">{outgoingAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>}
          {canEditIncomingAccount && <label className="text-xs font-semibold">{input.intent === 'transfer' ? 'Transfer to' : 'Received into'}<select value={draft.incomingAccountId} onChange={(event) => setDraft((value) => ({ ...value, incomingAccountId: event.target.value }))} className="brutalist-input mt-1">{incomingAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>}
          <label className="text-xs font-semibold">Place<input value={draft.place} onChange={(event) => setDraft((value) => ({ ...value, place: event.target.value }))} className="brutalist-input mt-1" maxLength={500} placeholder="Optional" /></label>
          <label className="text-xs font-semibold">Reference<input value={draft.reference} onChange={(event) => setDraft((value) => ({ ...value, reference: event.target.value }))} className="brutalist-input mt-1" maxLength={500} placeholder="Optional" /></label>
          <label className="text-xs font-semibold sm:col-span-2">Notes / description<textarea value={draft.notes} onChange={(event) => setDraft((value) => ({ ...value, notes: event.target.value }))} className="brutalist-input mt-1 min-h-20 resize-y" maxLength={2000} placeholder="Optional details" /></label>
          <div className="flex flex-wrap gap-2 sm:col-span-2"><Button size="sm" onClick={() => void saveEdit()} isLoading={status === 'saving'}>Save changes</Button><Button size="sm" variant="secondary" onClick={cancelEdit} disabled={status === 'saving'}>Cancel</Button></div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl bg-[var(--ref-primary)]/6 px-4 py-3.5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ref-primary)]">{intentLabel}</p>
                <p className="mt-1 truncate text-base font-semibold text-[var(--color-text-primary)]">{input.description}</p>
              </div>
              <p className="shrink-0 text-xl font-semibold tracking-tight text-[var(--color-text-primary)]">{formatCurrency(details.totalDebit)}</p>
            </div>
          </div>
          <dl className="grid gap-x-5 gap-y-3 text-sm sm:grid-cols-2">
            <div className="min-w-0"><dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">When</dt><dd className="mt-1 font-medium text-[var(--color-text-primary)]">{formatDateTime(details.dateMs)}</dd></div>
            <div className="min-w-0"><dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">{usesExpenseCategory ? 'Category' : 'Entry type'}</dt><dd className="mt-1 font-medium text-[var(--color-text-primary)]">{usesExpenseCategory ? categoryName ?? 'Uncategorized' : intentLabel}</dd></div>
            {outgoingAccountName && <div className="min-w-0"><dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">{input.intent === 'transfer' ? 'From account' : 'Paid from'}</dt><dd className="mt-1 truncate font-medium text-[var(--color-text-primary)]">{outgoingAccountName}</dd></div>}
            {incomingAccountName && <div className="min-w-0"><dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">{input.intent === 'transfer' ? 'To account' : 'Received into'}</dt><dd className="mt-1 truncate font-medium text-[var(--color-text-primary)]">{incomingAccountName}</dd></div>}
            <div className="min-w-0"><dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">Period</dt><dd className="mt-1 font-medium text-[var(--color-text-primary)]">{periodLabel(details.periodId, periods)}</dd></div>
            {input.place && <div className="min-w-0"><dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">Place</dt><dd className="mt-1 truncate font-medium text-[var(--color-text-primary)]">{input.place}</dd></div>}
            {input.reference && <div className="min-w-0"><dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">Reference</dt><dd className="mt-1 truncate font-medium text-[var(--color-text-primary)]">{input.reference}</dd></div>}
            {input.notes && <div className="min-w-0 sm:col-span-2"><dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">Note</dt><dd className="mt-1 whitespace-pre-wrap leading-5 text-[var(--color-text-primary)]">{input.notes}</dd></div>}
          </dl>
        </div>
      )}
      <details className="mt-4 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3 text-xs font-semibold text-[var(--color-text-secondary)] [&::-webkit-details-marker]:hidden"><span>Ledger entry</span><span className="text-[11px] font-medium text-[var(--ref-primary)]">View accounting details</span></summary>
        <div className="border-t border-[var(--color-border)] px-3.5 py-3">
          <div className="space-y-2 text-xs">
            {details.lines.map((line, index) => <div key={`${line.accountId}-${index}`} className="flex items-center justify-between gap-3"><span className="min-w-0 truncate text-[var(--color-text-primary)]">{line.account}</span><span className="shrink-0 font-mono font-medium text-[var(--color-text-primary)]">{line.debit > 0 ? `Dr ${formatCurrency(line.debit)}` : `Cr ${formatCurrency(line.credit)}`}</span></div>)}
          </div>
          <p className="mt-3 text-[11px] text-[var(--color-text-secondary)]">Balanced at {formatCurrency(details.totalDebit)} · expires {formatDate(currentProposal.expiresAt)}</p>
        </div>
      </details>
      {currentProposal.approvalToken && status === 'pending' && <div className="mt-4 flex flex-col-reverse gap-2 border-t border-[var(--color-border)] pt-4 sm:flex-row sm:items-center"><Button size="sm" variant="secondary" onClick={beginEdit}><Pencil className="h-4 w-4" /> Edit</Button><Button size="sm" variant="secondary" className="border-transparent bg-transparent shadow-none hover:bg-[var(--ref-surface-container)]" onClick={() => void reject()}>Dismiss</Button><Button size="sm" className="sm:ml-auto" onClick={() => void execute()}><Check className="h-4 w-4" /> Confirm &amp; post</Button></div>}
      {!currentProposal.approvalToken && status === 'pending' && <p className="mt-3 text-xs text-[var(--color-danger)]">The approval could not be restored. Refresh the page or ask the agent to prepare a fresh proposal before posting.</p>}
      {status === 'rejected' && <p className="mt-3 text-xs text-[var(--color-text-secondary)]">This proposal was dismissed; nothing was posted.</p>}
      {status === 'expired' && <p className="mt-3 text-xs text-[var(--color-text-secondary)]">This proposal expired before confirmation; ask the agent to prepare it again.</p>}
      {status === 'superseded' && <p className="mt-3 text-xs text-[var(--color-text-secondary)]">This proposal was replaced by a newer proposal; nothing was posted from this one.</p>}
      {status === 'executed' && !message && <p className="mt-3 text-xs text-[var(--color-success)]">This transaction has already been posted.</p>}
      {message && <p className={cn('mt-3 text-xs', (status === 'executed' || status === 'rejected' || message.startsWith('Updated.')) ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]')}>{message}</p>}
      </div>
    </section>
  );
}

function AgentPage() {
  const search = useSearch({ from: '/agent' }) as { prompt?: string };
  const queryClient = useQueryClient();
  const conversationsQuery = useAgentConversationsQuery(true);
  const memoriesQuery = useAgentMemoriesQuery();
  const profileQuery = useAgentProfileQuery();
  const periodsQuery = usePeriodsLedgerQuery(true);
  const categoriesQuery = useCategoriesQuery();
  const accountsQuery = useAccountsLedgerQuery();
  const [startupSelection, setStartupSelection] = useState<StartupSelection>(() => createStartupSelection());
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const conversationQuery = useAgentConversationQuery(activeConversationId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [pendingImages, setPendingImages] = useState<ChatImage[]>([]);
  const [previewImage, setPreviewImage] = useState<ChatImage | null>(null);
  const [isDraggingImages, setIsDraggingImages] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [streamActivity, setStreamActivity] = useState<string | null>(null);
  const [activityTimeline, setActivityTimeline] = useState<AgentActivityStep[]>([]);
  const [copiedAssistantId, setCopiedAssistantId] = useState<string | null>(null);
  const [conversationActionId, setConversationActionId] = useState<number | null>(null);

  const [openConversationMenuId, setOpenConversationMenuId] = useState<number | null>(null);
  const [conversationMenuPlacement, setConversationMenuPlacement] = useState<'above' | 'below'>('below');
  const [editingConversationId, setEditingConversationId] = useState<number | null>(null);
  const [conversationTitleDraft, setConversationTitleDraft] = useState('');
  const [editingUserMessageId, setEditingUserMessageId] = useState<string | null>(null);
  const [editingUserMessageText, setEditingUserMessageText] = useState('');
  const [revealedMessageActionsId, setRevealedMessageActionsId] = useState<string | null>(null);
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [memoryLabel, setMemoryLabel] = useState('');
  const [memoryContent, setMemoryContent] = useState('');
  const [editingMemoryId, setEditingMemoryId] = useState<number | null>(null);
  const [isSavingMemory, setIsSavingMemory] = useState(false);
  const [isSavingNickname, setIsSavingNickname] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const questionInputRef = useRef<HTMLTextAreaElement>(null);
  const editingUserMessageTextareaRef = useRef<HTMLTextAreaElement>(null);
  const messageActionHoldTimerRef = useRef<number | null>(null);
  const conversationListRef = useRef<HTMLDivElement>(null);
  const agentRequestRef = useRef<AbortController | null>(null);
  const conversationLoadMoreTimerRef = useRef<number | null>(null);
  const lastProfileNicknameRef = useRef<string | null>(null);
  const [isComposerExpanded, setIsComposerExpanded] = useState(false);
  const [visibleConversationCount, setVisibleConversationCount] = useState(CONVERSATIONS_PAGE_SIZE);
  const [isLoadingMoreConversations, setIsLoadingMoreConversations] = useState(false);

  const conversations = useMemo(() => conversationsQuery.data?.conversations ?? [], [conversationsQuery.data?.conversations]);
  const memories = memoriesQuery.data?.memories ?? [];
  const memoryLimits = memoriesQuery.data?.limits ?? { maxItems: 50, maxLabelLength: 80, maxContentLength: 1000 };
  const isLoadingMemories = memoriesQuery.isLoading;
  const isLoadingConversation = activeConversationId != null && conversationQuery.isFetching && !conversationQuery.data;
  const nickname = profileQuery.data?.nickname ?? '';
  const periods = useMemo(() => (periodsQuery.data ?? []) as Period[], [periodsQuery.data]);
  const categories = useMemo(
    () => (categoriesQuery.data ?? []).map((category) => ({ id: category.id, name: category.name })),
    [categoriesQuery.data],
  );
  const accounts = useMemo(
    () => (accountsQuery.data ?? []).map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type,
      isActive: account.isActive,
      liquidityClass: account.liquidityClass,
    })),
    [accountsQuery.data],
  );

  useEffect(() => {
    setStartupSelection(createStartupSelection(nickname));
  }, [nickname]);

  const updateConversationCache = (update: (current: Conversation[]) => Conversation[]) => {
    queryClient.setQueryData<ListAgentConversations200>(queryKeys.agent.conversations(true), (current) => current ? { ...current, conversations: update(current.conversations) } : current);
  };

  // The page keeps its rich streaming view state locally, while these small
  // selectors make the durable draft and transient session lifecycle visible
  // to other agent UI components without putting server facts in Zustand.
  const setSessionConversationId = useAgentSessionStore((state) => state.setActiveConversationId);
  const setSessionStreamStatus = useAgentSessionStore((state) => state.setStreamStatus);
  const setSessionAttachmentIds = useAgentSessionStore((state) => state.setPendingAttachmentIds);
  const persistDraft = useDraftStore((state) => state.setDraft);
  const clearDraft = useDraftStore((state) => state.clearDraft);
  const draftKey = `agent:${activeConversationId ?? 'new'}`;
  const storedDraft = useDraftStore((state) => state.drafts[draftKey]?.value ?? '');
  const lastDraftKeyRef = useRef(draftKey);

  useEffect(() => {
    setSessionConversationId(activeConversationId);
  }, [activeConversationId, setSessionConversationId]);

  useEffect(() => {
    setSessionStreamStatus(isSending ? 'streaming' : 'idle');
  }, [isSending, setSessionStreamStatus]);

  useEffect(() => {
    setSessionAttachmentIds(pendingImages.map((image) => image.id));
  }, [pendingImages, setSessionAttachmentIds]);

  useEffect(() => {
    if (!profileQuery.data) return;
    if (lastProfileNicknameRef.current == null || lastProfileNicknameRef.current === nickname) {
      setNicknameDraft(nickname);
    }
    lastProfileNicknameRef.current = nickname;
  }, [nickname, profileQuery.data]);

  useEffect(() => {
    if (lastDraftKeyRef.current !== draftKey) {
      lastDraftKeyRef.current = draftKey;
      setDraft(storedDraft);
      return;
    }
    if (!draft.trim() && storedDraft) {
      setDraft(storedDraft);
      return;
    }
    if (draft.trim()) persistDraft(draftKey, draft);
  }, [draft, draftKey, persistDraft, storedDraft]);

  useEffect(() => () => {
    if (messageActionHoldTimerRef.current != null) window.clearTimeout(messageActionHoldTimerRef.current);
    if (conversationLoadMoreTimerRef.current != null) window.clearTimeout(conversationLoadMoreTimerRef.current);
  }, []);

  useEffect(() => {
    if (openConversationMenuId == null) return undefined;
    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-conversation-menu-root]')) return;
      setOpenConversationMenuId(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenConversationMenuId(null);
    };
    document.addEventListener('pointerdown', closeOnOutsidePress);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openConversationMenuId]);

  const beginMessageActionHold = (message: ChatMessage, pointerType: string) => {
    if (message.role !== 'user' || (pointerType !== 'touch' && pointerType !== 'pen')) return;
    if (messageActionHoldTimerRef.current != null) window.clearTimeout(messageActionHoldTimerRef.current);
    setRevealedMessageActionsId((current) => current === message.id ? current : null);
    messageActionHoldTimerRef.current = window.setTimeout(() => {
      setRevealedMessageActionsId(message.id);
      messageActionHoldTimerRef.current = null;
    }, 450);
  };

  const endMessageActionHold = () => {
    if (messageActionHoldTimerRef.current != null) {
      window.clearTimeout(messageActionHoldTimerRef.current);
      messageActionHoldTimerRef.current = null;
    }
  };

  useLayoutEffect(() => {
    const textarea = editingUserMessageTextareaRef.current;
    if (!textarea || editingUserMessageId == null) return;
    const maxHeight = 160;
    textarea.style.height = 'auto';
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 48), maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [editingUserMessageId, editingUserMessageText]);

  const saveNickname = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = nicknameDraft.trim();
    if (value.length > 80) {
      setMemoryError('Your preferred name must be at most 80 characters.');
      return;
    }
    setIsSavingNickname(true);
    setMemoryError(null);
    try {
      const response = await agentCommands.profile.update(value || null);
      const saved = response.nickname ?? '';
      setNicknameDraft(saved);
      queryClient.setQueryData(queryKeys.agent.profile, response);
      setStartupSelection(createStartupSelection(saved));
      setNotice(saved ? 'Preferred name updated.' : 'Preferred name cleared.');
    } catch (caught) {
      setMemoryError(caught instanceof Error ? caught.message : 'Could not save your preferred name.');
    } finally {
      setIsSavingNickname(false);
    }
  };

  const resetMemoryForm = () => {
    setEditingMemoryId(null);
    setMemoryLabel('');
    setMemoryContent('');
  };

  const saveMemory = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const label = memoryLabel.trim();
    const content = memoryContent.trim();
    if (!label || !content) {
      setMemoryError('Add a short name and the memory you want Fainens to remember.');
      return;
    }
    setIsSavingMemory(true);
    setMemoryError(null);
    try {
      if (editingMemoryId == null) {
        await agentCommands.memories.create({ label, content });
      } else {
        await agentCommands.memories.update(editingMemoryId, { label, content });
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.agent.memories });
      resetMemoryForm();
    } catch (caught) {
      setMemoryError(caught instanceof Error ? caught.message : 'Could not save agent memory.');
    } finally {
      setIsSavingMemory(false);
    }
  };

  const editMemory = (memory: AgentMemory) => {
    setEditingMemoryId(memory.id);
    setMemoryLabel(memory.label);
    setMemoryContent(memory.content);
    setMemoryError(null);
  };

  const deleteMemory = async (memory: AgentMemory) => {
    if (!window.confirm('Delete “' + memory.label + '” from Fainens memory?')) return;
    setMemoryError(null);
    try {
      await agentCommands.memories.delete(memory.id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.agent.memories });
      if (editingMemoryId === memory.id) resetMemoryForm();
    } catch (caught) {
      setMemoryError(caught instanceof Error ? caught.message : 'Could not delete agent memory.');
    }
  };

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
    const result = await conversationsQuery.refetch();
    return result.data?.conversations ?? [];
  };

  const selectConversation = (conversationId: number) => {
    if (conversationId === activeConversationId || isLoadingConversation) return;
    setError(null);
    setNotice(null);
    setActiveConversationId(conversationId);
    setMessages([]);
    setPendingImages([]);
    setImageError(null);
  };

  useEffect(() => {
    if (activeConversationId == null || !conversationQuery.data) return;
    if (conversationQuery.data.conversation.id !== activeConversationId) return;
    setMessages(toChatMessages(conversationQuery.data));
    setPendingImages([]);
    setImageError(null);
  }, [activeConversationId, conversationQuery.data]);

  useEffect(() => {
    if (selectedPeriodId || periods.length === 0) return;
    const active = periods.find((period) => period.isActive) ?? periods[0];
    if (active) setSelectedPeriodId(String(active.id));
  }, [periods, selectedPeriodId]);

  useEffect(() => {
    if (periodsQuery.isError) setError('Could not load accounting periods. You can still ask across recorded history.');
  }, [periodsQuery.isError]);

  useEffect(() => {
    if (isMemoryOpen) {
      void memoriesQuery.refetch();
      void profileQuery.refetch();
    }
  }, [isMemoryOpen, memoriesQuery.refetch, profileQuery.refetch]);

  useEffect(() => {
    if (search.prompt?.trim()) {
      setActiveConversationId(null);
      setMessages([]);
      setPendingImages([]);
      setDraft(search.prompt.trim());
    }
  }, [search.prompt]);

  useEffect(() => {
    if (conversationsQuery.isError) setError('Could not load saved conversations.');
  }, [conversationsQuery.isError]);

  useEffect(() => {
    if (conversationQuery.isError) setError('Could not load that conversation.');
  }, [conversationQuery.isError]);

  useEffect(() => {
    if (memoriesQuery.isError && isMemoryOpen) setMemoryError('Could not load agent memory.');
  }, [isMemoryOpen, memoriesQuery.isError]);

  useEffect(() => {
    if (profileQuery.isError && isMemoryOpen) setMemoryError('Could not load your preferred name.');
  }, [isMemoryOpen, profileQuery.isError]);

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
    const composerDraftKey = draftKey;
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
    setActivityTimeline([{ id: 'request-' + Date.now(), label: 'Starting request', status: 'active' }]);
    const requestController = new AbortController();
    agentRequestRef.current = requestController;
    let streamedAssistantId: string | null = null;
    try {
      let conversationId = activeConversationId;
      if (conversationId == null) {
        const created = await agentCommands.conversations.create();
        conversationId = created.conversation.id;
        setActiveConversationId(conversationId);
        updateConversationCache((current) => [created.conversation, ...current.filter((candidate) => candidate.id !== created.conversation.id)]);
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
          setActiveActivity('Writing answer');
          setMessages((current) => current.map((message) =>
            message.id === assistantId && message.role === 'assistant'
              ? { ...message, text: message.text + event.text }
              : message,
          ));
        }
        if (event.type === 'progress') {
          setStreamActivity((event.detail ?? event.label) + (event.status === 'completed' ? '' : '…'));
          setActiveActivity(event.label, event.status, event.detail);
        }
        if (event.type === 'complete') {
          setActiveActivity('Answer ready', 'completed');
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
      clearDraft(composerDraftKey);
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
      setActivityTimeline([]);
    }
  };

  const submitClarification = (clarification: AgentClarification, choice: AgentClarificationChoice, customValue?: string) => {
    const choiceText = customValue ? `${choice.label}: ${customValue}` : choice.label;
    void submitQuestion(`For "${clarification.question}", I choose "${choiceText}".`);
  };

  const stopAgentQuery = () => {
    if (agentRequestRef.current) setSessionStreamStatus('cancelling');
    agentRequestRef.current?.abort();
  };

  const setActiveActivity = (label: string, status: 'started' | 'completed' = 'started', detail?: string) => {
    setActivityTimeline((current) => {
      const last = current.at(-1);
      if (last?.label === label && status === 'completed') {
        return [...current.slice(0, -1), { ...last, status: 'done', ...(detail ? { detail } : {}) }];
      }
      const completed = current.map((step) => step.status === 'active' ? { ...step, status: 'done' as const } : step);
      if (completed.at(-1)?.label === label) return completed;
      const nextStatus: AgentActivityStep['status'] = status === 'completed' ? 'done' : 'active';
      return [...completed, { id: String(Date.now()) + '-' + label, status: nextStatus, label, ...(detail ? { detail } : {}) }].slice(-8);
    });
  };

  const copyMessageText = async (message: ChatMessage) => {
    if (!message.text.trim()) return;
    try {
      await navigator.clipboard.writeText(message.text);
      setCopiedAssistantId(message.id);
      setNotice('Message copied to clipboard.');
      window.setTimeout(() => setCopiedAssistantId((current) => current === message.id ? null : current), 1800);
    } catch {
      setError('Could not copy this response.');
    }
  };

  const copyAssistantResponse = (message: Extract<ChatMessage, { role: 'assistant' }>) => copyMessageText(message);

  const saveAssistantResponse = (message: Extract<ChatMessage, { role: 'assistant' }>) => {
    if (!message.text.trim()) return;
    const blob = new Blob([message.text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'fainens-note-' + new Date(message.createdAt).toISOString().slice(0, 10) + '.md';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setNotice('Saved response as a Markdown note.');
  };

  const regenerateAssistantResponse = (message: Extract<ChatMessage, { role: 'assistant' }>) => {
    if (isSending) return;
    const messageIndex = messages.findIndex((candidate) => candidate.id === message.id);
    const source = messageIndex < 0 ? null : [...messages.slice(0, messageIndex)].reverse().find((candidate): candidate is Extract<ChatMessage, { role: 'user' }> => candidate.role === 'user');
    if (!source || source.serverId == null) {
      setError('This response cannot be regenerated until its message is saved.');
      return;
    }
    void submitQuestion(source.text, { localId: source.id, serverId: source.serverId });
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
    setEditingUserMessageId(null);
    setEditingUserMessageText('');
  };

  const beginConversationRename = () => {
    if (!activeConversation) return;
    setEditingConversationId(activeConversation.id);
    setConversationTitleDraft(activeConversation.title === 'New conversation' ? '' : activeConversation.title);
    setOpenConversationMenuId(null);
    setError(null);
  };

  const updateConversation = async (conversationId: number, data: { title?: string; isPinned?: boolean; archived?: boolean }) => {
    setConversationActionId(conversationId);
    setError(null);
    try {
      const result = await agentCommands.conversations.update(conversationId, data);
      updateConversationCache((current) => current.map((conversation) => conversation.id === conversationId ? result.conversation : conversation));
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

  const toggleConversationMenu = (event: React.MouseEvent<HTMLButtonElement>, conversationId: number) => {
    if (openConversationMenuId === conversationId) {
      setOpenConversationMenuId(null);
      return;
    }
    const triggerBottom = event.currentTarget.getBoundingClientRect().bottom;
    const listBottom = conversationListRef.current?.getBoundingClientRect().bottom;
    const estimatedMenuHeight = 188;
    setConversationMenuPlacement(listBottom != null && triggerBottom + estimatedMenuHeight > listBottom ? 'above' : 'below');
    setOpenConversationMenuId(conversationId);
  };

  const deleteConversation = async (conversation: Conversation) => {
    if (!window.confirm(`Delete “${conversation.title}”? This permanently removes the conversation and its messages.`)) return;
    setConversationActionId(conversation.id);
    setError(null);
    try {
      await agentCommands.conversations.delete(conversation.id);
      updateConversationCache((current) => current.filter((candidate) => candidate.id !== conversation.id));
      setOpenConversationMenuId(null);
      if (activeConversationId === conversation.id) startNewConversation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete that conversation.');
    } finally {
      setConversationActionId(null);
    }
  };

  const sortedConversations = useMemo(
    () => [...conversations].sort((left, right) => {
      const leftArchived = left.archivedAt != null;
      const rightArchived = right.archivedAt != null;
      if (leftArchived !== rightArchived) return leftArchived ? 1 : -1;
      if (!leftArchived && left.isPinned !== right.isPinned) return left.isPinned ? -1 : 1;
      return right.updatedAt - left.updatedAt || right.id - left.id;
    }),
    [conversations],
  );
  const visibleConversations = sortedConversations.slice(0, visibleConversationCount);
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId) ?? null;
  const latestUserMessageId = [...messages].reverse().find((message) => message.role === 'user')?.id ?? null;
  const latestAssistantId = [...messages].reverse().find((message) => message.role === 'assistant')?.id ?? null;

  return (
    <RequireAuth>
      <PageContainer className="max-w-7xl">
        <div className="flex flex-col gap-6">
          <PageHeader
            subtext="Evidence-first finance chat"
            title="Fainens Agent"
            description="Ask about recorded finances, investigate patterns, and prepare changes with your approval."
          />
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <Card className="overflow-hidden">
              <div className="flex min-h-16 items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3 sm:px-6">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--ref-primary-container)] text-white"><Sparkles className="h-[18px] w-[18px]" /></span>
                  <div className="min-w-0">
                    {activeConversation && editingConversationId === activeConversation.id ? (
                      <form className="flex min-w-0 items-center gap-1.5" onSubmit={(event) => { event.preventDefault(); void saveConversationTitle(activeConversation.id); }}>
                        <input
                          autoFocus
                          value={conversationTitleDraft}
                          onChange={(event) => setConversationTitleDraft(event.target.value)}
                          onKeyDown={(event) => { if (event.key === 'Escape') { setEditingConversationId(null); setConversationTitleDraft(''); } }}
                          maxLength={72}
                          aria-label="Conversation title"
                          className="min-w-0 w-[min(18rem,45vw)] rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-sm font-semibold text-[var(--color-text-primary)] outline-none ring-[var(--ref-primary)] focus:ring-2"
                        />
                        <button type="submit" className="rounded p-1 text-[var(--color-success)] hover:bg-[var(--ref-surface-container-low)]" title="Save title" aria-label="Save title"><Check className="h-4 w-4" /></button>
                        <button type="button" onClick={() => { setEditingConversationId(null); setConversationTitleDraft(''); }} className="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--ref-surface-container-low)]" title="Cancel rename" aria-label="Cancel rename"><X className="h-4 w-4" /></button>
                      </form>
                    ) : (
                      <button type="button" onClick={beginConversationRename} className="group flex min-w-0 max-w-full items-center gap-1.5 text-left" title={activeConversation ? 'Rename conversation' : undefined} disabled={!activeConversation}>
                        <h2 className="truncate text-base font-semibold leading-5">{activeConversation ? <ConversationTitle conversation={activeConversation} isActive={false} /> : 'New conversation'}</h2>
                        {activeConversation && <Pencil className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted)] opacity-0 transition-opacity group-hover:opacity-100" />}
                      </button>
                    )}
                    <p className="truncate text-xs text-[var(--color-text-secondary)]">{selectedPeriod ? selectedPeriod.name + ' scope' : 'All recorded history'}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button type="button" onClick={() => setIsMemoryOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--ref-surface-container-low)] hover:text-[var(--ref-primary)]" title="Manage agent memory">
                    <Brain className="h-4 w-4" /> <span className="hidden sm:inline">Memory</span>
                  </button>
                  <Button type="button" size="sm" onClick={startNewConversation} className="inline-flex items-center gap-1.5 rounded-lg">
                    <Sparkles className="h-4 w-4" /> New chat
                  </Button>
                </div>
              </div>
              <div className="space-y-5 p-4 sm:p-6">
                {messages.length === 0 && (
                  <div className="startup-empty-state py-10 text-center sm:py-14">
                    <span className="startup-empty-icon mx-auto grid h-10 w-10 place-items-center rounded-full bg-[var(--ref-surface-container-low)] text-[var(--ref-primary)]"><Bot className="h-5 w-5" /></span>
                    <h3 className="startup-empty-greeting mt-3 font-semibold">{startupSelection.greeting}</h3>
                    <p className="startup-empty-subtitle mt-1 text-sm text-[var(--color-text-secondary)]">{startupSelection.subtitle}</p>
                    <div className="mx-auto mt-5 flex max-w-2xl flex-wrap justify-center gap-2">
                      {startupSelection.prompts.map((suggestion, index) => (
                        <button key={suggestion} type="button" onClick={() => void submitQuestion(suggestion)} style={{ animationDelay: String(index * 70) + 'ms' }} className="startup-prompt rounded-full border border-[var(--color-border)] px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)] hover:border-[var(--ref-primary)] hover:text-[var(--ref-primary)]">
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((message) => (
                  <div key={message.id} className={cn('flex gap-3', message.role === 'user' && 'justify-end')}>
                    <div
                      className={cn('group min-w-0', message.role === 'assistant' ? 'min-w-0 flex-1' : editingUserMessageId === message.id ? 'w-full max-w-[90%]' : 'w-fit max-w-[50%]')}
                      onPointerDown={(event) => beginMessageActionHold(message, event.pointerType)}
                      onPointerUp={endMessageActionHold}
                      onPointerCancel={endMessageActionHold}
                      onPointerLeave={endMessageActionHold}
                      onContextMenu={(event) => { if (message.role === 'user' && window.matchMedia('(hover: none)').matches) event.preventDefault(); }}
                    >
                      <div className={cn('text-sm', message.role === 'user'
                        ? editingUserMessageId === message.id
                          ? 'px-0 py-0 text-[var(--color-text-primary)]'
                          : 'rounded-xl border border-transparent bg-[var(--ref-primary-container)] px-4 py-3 text-white'
                        : 'w-full px-0 py-1 text-[var(--color-text-primary)]')}>
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
                        ? <AgentMessage>{message.text || '…'}</AgentMessage>
                        : editingUserMessageId === message.id
                          ? <div className="space-y-2"><textarea ref={editingUserMessageTextareaRef} value={editingUserMessageText} onChange={(event) => setEditingUserMessageText(event.target.value)} className="brutalist-input max-h-40 min-h-12 w-full resize-none overflow-y-hidden bg-[var(--color-surface)] text-[var(--color-text-primary)]" maxLength={2000} autoFocus /><div className="flex flex-wrap justify-end gap-2"><Button size="sm" variant="secondary" onClick={() => { setEditingUserMessageId(null); setEditingUserMessageText(''); }} disabled={isSending}>Cancel</Button><Button size="sm" onClick={() => void saveEditedLastUserMessage(message)} disabled={isSending}>Send</Button></div></div>
                          : <p className="whitespace-pre-wrap leading-6">{message.text}</p>}
                      {message.role === 'assistant' && message.text.trim() && !isSending && (
                        <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-[var(--color-border)] pt-2">
                          <button type="button" onClick={() => void copyAssistantResponse(message)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--ref-surface-container-low)] hover:text-[var(--ref-primary)]" title="Copy response">
                            {copiedAssistantId === message.id ? <Check className="h-3.5 w-3.5 text-[var(--color-success)]" /> : <Copy className="h-3.5 w-3.5" />} {copiedAssistantId === message.id ? 'Copied' : 'Copy'}
                          </button>
                          {message.id === latestAssistantId && <button type="button" onClick={() => regenerateAssistantResponse(message)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--ref-surface-container-low)] hover:text-[var(--ref-primary)]" title="Regenerate response">
                            <RefreshCw className="h-3.5 w-3.5" /> Regenerate
                          </button>}
                          <button type="button" onClick={() => saveAssistantResponse(message)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--ref-surface-container-low)] hover:text-[var(--ref-primary)]" title="Save as Markdown note">
                            <Download className="h-3.5 w-3.5" /> Save note
                          </button>
                        </div>
                      )}
                      {hasAgentResponse(message) && (
                        <>
                          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[var(--color-text-secondary)]">
                            <span className="rounded-full bg-[var(--ref-surface-container-low)] px-2 py-1">Scope: {scopeLabel(message.response.scope ?? (isRecord(message.response.context) ? message.response.context.scope : null), periods)}</span>
                            {message.response.revision != null && <span className="rounded-full bg-[var(--ref-surface-container-low)] px-2 py-1">Revision {message.response.revision}</span>}
                            {!message.response.llmAvailable && <span className="rounded-full bg-[var(--color-warning)]/10 px-2 py-1 text-[var(--color-warning)]">LLM setup required for written analysis</span>}
                          </div>
                          <ToolTrace response={message.response} />
                          {message.response.clarifications?.filter(isClarification).map((clarification) => (
                            <ClarificationCard
                              key={clarification.id}
                              clarification={clarification}
                              disabled={isSending}
                              onSelect={(choice, customValue) => submitClarification(clarification, choice, customValue)}
                            />
                          ))}
                          {message.response.pendingActions?.map((action, index) => {
                            if (isBudgetProposal(action)) return <BudgetProposalCard key={`${action.approvalId}-${index}`} proposal={action} periods={periods} />;
                            if (isTransactionProposal(action)) return <TransactionProposalCard key={`${action.approvalId}-${index}`} proposal={action} categories={categories} accounts={accounts} periods={periods} conversationId={message.response.conversationId ?? activeConversationId} />;
                            return null;
                          })}
                        </>
                      )}
                      </div>
                      {message.role === 'user' && editingUserMessageId !== message.id && (message.text.trim() || (message.id === latestUserMessageId && !message.images?.length)) && (
                        <div className={cn('flex min-h-7 justify-end gap-1 pt-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 group-focus-within:pointer-events-auto group-hover:pointer-events-auto pointer-events-none', revealedMessageActionsId === message.id && 'pointer-events-auto opacity-100')}>
                          {message.text.trim() && <button type="button" onClick={() => void copyMessageText(message)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--ref-surface-container-low)] hover:text-[var(--ref-primary)]" title="Copy message">
                            {copiedAssistantId === message.id ? <Check className="h-3.5 w-3.5 text-[var(--color-success)]" /> : <Copy className="h-3.5 w-3.5" />} {copiedAssistantId === message.id ? 'Copied' : 'Copy'}
                          </button>}
                          {message.id === latestUserMessageId && !message.images?.length && <button type="button" onClick={() => { setEditingUserMessageId(message.id); setEditingUserMessageText(message.text); }} disabled={isSending || editingUserMessageId === message.id} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--ref-surface-container-low)] hover:text-[var(--ref-primary)] disabled:cursor-not-allowed disabled:opacity-50" title="Edit this message and regenerate the reply"><Pencil className="h-3.5 w-3.5" /> Edit</button>}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {isSending && (
                  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2.5" aria-live="polite">
                    <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">
                      <LoaderCircle className="h-4 w-4 animate-spin text-[var(--ref-primary)]" />
                      <span>{streamActivity ?? 'Reading your ledger…'}</span>
                    </div>
                    {activityTimeline.length > 0 && (
                      <ol className="mt-2 space-y-1 border-l border-[var(--color-border)] pl-3 text-xs text-[var(--color-text-secondary)]">
                        {activityTimeline.map((step) => (
                          <li key={step.id} className="flex items-center gap-2">
                            {step.status === 'active' ? <LoaderCircle className="h-3 w-3 animate-spin text-[var(--ref-primary)]" /> : <Check className="h-3 w-3 text-[var(--color-success)]" />}
                            <span>{step.label}{step.detail ? ' · ' + step.detail : ''}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}
                {error && <p role="alert" className="rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-danger)]">{error}</p>}
                {notice && <p role="status" className="rounded-lg border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 p-3 text-sm text-[var(--color-success)]">{notice}</p>}
              </div>

              <form
                onSubmit={(event) => { event.preventDefault(); void submitQuestion(); }}
                onDragOver={(event) => { event.preventDefault(); if (!isSending) setIsDraggingImages(true); }}
                onDragLeave={() => setIsDraggingImages(false)}
                onDrop={(event) => { event.preventDefault(); setIsDraggingImages(false); if (!isSending) void addImageFiles(Array.from(event.dataTransfer.files)); }}
                className={cn('-mx-4 -mb-4 border-t border-[var(--color-border)] bg-[var(--color-background)] px-6 py-3 sm:px-8 sm:py-4', isDraggingImages && 'bg-[var(--ref-primary)]/5')}
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
                      className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--ref-primary)]/10 hover:text-[var(--ref-primary)] disabled:cursor-not-allowed disabled:opacity-50', !isComposerExpanded && 'order-first')}
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

            <Modal
              isOpen={isMemoryOpen}
              onClose={() => { setIsMemoryOpen(false); setMemoryError(null); resetMemoryForm(); }}
              title="Agent memory"
              subtitle="Preferences and stable background Fainens can use in future chats. Memory is not ledger evidence or permission to change your data."
              size="xl"
            >
              <div className="grid gap-5 sm:grid-cols-2">
                <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold">How should Fainens address you?</h3>
                    <p className="mt-1 text-xs text-[var(--color-text-secondary)]">This is separate from memories and is used for greetings and natural replies.</p>
                  </div>
                  <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(event) => void saveNickname(event)}>
                    <div className="min-w-0 flex-1">
                      <Input
                        label="Preferred name"
                        value={nicknameDraft}
                        onChange={(event) => setNicknameDraft(event.target.value)}
                        placeholder="e.g. Ray"
                        maxLength={80}
                      />
                    </div>
                    <Button type="submit" size="sm" isLoading={isSavingNickname} disabled={isSavingMemory}>Save name</Button>
                  </form>
                </section>

                <form className="space-y-3" onSubmit={(event) => void saveMemory(event)}>
                  <Input
                    label="Memory name"
                    value={memoryLabel}
                    onChange={(event) => setMemoryLabel(event.target.value)}
                    placeholder="e.g. Financial goal"
                    maxLength={memoryLimits.maxLabelLength}
                    required
                  />
                  <div className="space-y-1">
                    <label htmlFor="agent-memory-content" className="block text-sm font-medium text-[var(--color-text-secondary)]">What should Fainens remember?</label>
                    <textarea
                      id="agent-memory-content"
                      value={memoryContent}
                      onChange={(event) => setMemoryContent(event.target.value)}
                      placeholder="e.g. I prefer conservative suggestions when planning."
                      maxLength={memoryLimits.maxContentLength}
                      required
                      rows={3}
                      className="brutalist-input min-h-24 w-full resize-y"
                    />
                    <p className="text-right text-[11px] text-[var(--color-muted)]">{memoryContent.length}/{memoryLimits.maxContentLength}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" size="sm" isLoading={isSavingMemory} disabled={memories.length >= memoryLimits.maxItems && editingMemoryId == null}>
                      {editingMemoryId == null ? 'Add memory' : 'Save changes'}
                    </Button>
                    {editingMemoryId != null && <Button type="button" size="sm" variant="secondary" onClick={resetMemoryForm} disabled={isSavingMemory}>Cancel</Button>}
                  </div>
                </form>

                {memoryError && <p role="alert" className="rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-danger)] sm:col-span-2">{memoryError}</p>}

                <div className="border-t border-[var(--color-border)] pt-4 sm:col-span-2">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">Saved memories</h3>
                    <span className="text-xs text-[var(--color-text-secondary)]">{memories.length}/{memoryLimits.maxItems}</span>
                  </div>
                  {isLoadingMemories ? (
                    <p className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]"><LoaderCircle className="h-4 w-4 animate-spin" /> Loading memories…</p>
                  ) : memories.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-secondary)]">No memory saved yet.</p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {memories.map((memory) => (
                        <div key={memory.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3">
                          <div className="flex gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold">{memory.label}</p>
                              <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{memory.content}</p>
                            </div>
                            <div className="flex shrink-0 items-start gap-1">
                              <button type="button" onClick={() => editMemory(memory)} disabled={isSavingMemory} className="rounded p-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--ref-surface-container-low)] hover:text-[var(--ref-primary)] disabled:opacity-50" aria-label={'Edit ' + memory.label} title="Edit memory"><Pencil className="h-4 w-4" /></button>
                              <button type="button" onClick={() => void deleteMemory(memory)} disabled={isSavingMemory} className="rounded p-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-danger)]/10 hover:text-[var(--color-danger)] disabled:opacity-50" aria-label={'Delete ' + memory.label} title="Delete memory"><Trash2 className="h-4 w-4" /></button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Modal>

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

            <ConversationList
              conversations={conversations}
              periods={periods}
              selectedPeriodId={selectedPeriodId}
              onSelectPeriod={setSelectedPeriodId}
              activeConversationId={activeConversationId}
              visibleConversations={visibleConversations}
              visibleConversationCount={visibleConversationCount}
              isLoadingMoreConversations={isLoadingMoreConversations}
              isLoadingConversation={isLoadingConversation}
              conversationListRef={conversationListRef}
              onNearEnd={() => {
                if (isLoadingMoreConversations || visibleConversationCount >= sortedConversations.length) return;
                setIsLoadingMoreConversations(true);
                conversationLoadMoreTimerRef.current = window.setTimeout(() => {
                  setVisibleConversationCount((current) => Math.min(current + CONVERSATIONS_PAGE_SIZE, sortedConversations.length));
                  setIsLoadingMoreConversations(false);
                  conversationLoadMoreTimerRef.current = null;
                }, 650);
              }}
              onSelectConversation={(id) => void selectConversation(id)}
              editingConversationId={editingConversationId}
              conversationTitleDraft={conversationTitleDraft}
              onConversationTitleDraftChange={setConversationTitleDraft}
              onSaveConversationTitle={(id) => void saveConversationTitle(id)}
              onCancelRename={() => { setEditingConversationId(null); setConversationTitleDraft(''); }}
              openConversationMenuId={openConversationMenuId}
              conversationMenuPlacement={conversationMenuPlacement}
              conversationActionId={conversationActionId}
              onToggleConversationMenu={toggleConversationMenu}
              onEditConversation={(conversation) => { setEditingConversationId(conversation.id); setConversationTitleDraft(conversation.title); setOpenConversationMenuId(null); setError(null); }}
              onTogglePin={(conversation) => { setOpenConversationMenuId(null); void updateConversation(conversation.id, { isPinned: !conversation.isPinned }); }}
              onToggleArchive={(conversation) => { setOpenConversationMenuId(null); void updateConversation(conversation.id, { archived: conversation.archivedAt == null }); }}
              onDeleteConversation={(conversation) => void deleteConversation(conversation)}
            />
          </div>
        </div>
      </PageContainer>
    </RequireAuth>
  );
}
