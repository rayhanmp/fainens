import { useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { Archive, ArchiveRestore, CalendarDays, Check, ChevronDown, MoreHorizontal, Pencil, Pin, PinOff, Trash2, X } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { cn, formatDate } from '../../lib/utils';
import type { Conversation, Period } from './types';

export const CONVERSATIONS_PAGE_SIZE = 10;

function conversationGroup(updatedAt: number, nowMs = Date.now()): string {
  const now = new Date(nowMs);
  const date = new Date(updatedAt);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDifference = Math.floor((today - day) / 86_400_000);
  if (dayDifference <= 0) return 'Today';
  if (dayDifference === 1) return 'Yesterday';
  const weekStart = today - ((now.getDay() + 6) % 7) * 86_400_000;
  if (day >= weekStart) return 'Earlier this week';
  return 'Older';
}

function ConversationTitle({ conversation, isActive }: { conversation: Conversation; isActive: boolean }) {
  const isAutoTitlePending = conversation.titleSource === 'auto' && conversation.title === 'New conversation';
  if (isAutoTitlePending) {
    return <span aria-label="Conversation title loading" className={cn('inline-block h-4 w-32 max-w-full animate-pulse rounded', isActive ? 'bg-white/35' : 'bg-[var(--ref-surface-container-highest)]')} />;
  }
  return <span className="truncate">{conversation.title}</span>;
}

function PeriodScopeDropdown({ periods, value, onChange }: { periods: Period[]; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = value ? periods.find((period) => String(period.id) === value) : null;
  const options = [{ id: '', label: 'All recorded history' }, ...periods.map((period) => ({ id: String(period.id), label: period.name }))];

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', closeOnOutsidePress);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return <div ref={rootRef} className="relative min-w-0 flex-1">
    <button
      type="button"
      role="combobox"
      aria-expanded={open}
      aria-haspopup="listbox"
      onClick={() => setOpen((current) => !current)}
      onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpen(true); } }}
      className="flex h-8 w-full items-center justify-between gap-2 rounded-lg px-1 text-left text-sm font-semibold text-[var(--color-text-primary)] outline-none transition-colors hover:text-[var(--ref-primary)] focus-visible:ring-2 focus-visible:ring-[var(--ref-primary)]"
    >
      <span className="truncate">{selected?.name ?? 'All recorded history'}</span>
      <ChevronDown className={cn('h-4 w-4 shrink-0 text-[var(--color-text-secondary)] transition-transform', open && 'rotate-180')} />
    </button>
    {open && <div role="listbox" className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-1 text-[var(--color-text-primary)] shadow-lg">
      {options.map((option) => <button
        key={option.id || 'all'}
        type="button"
        role="option"
        aria-selected={option.id === value}
        onClick={() => { onChange(option.id); setOpen(false); }}
        className={cn('flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--ref-surface-container-low)]', option.id === value && 'bg-[var(--ref-primary)]/10 font-semibold text-[var(--ref-primary)]')}
      ><span className="truncate">{option.label}</span>{option.id === value && <Check className="h-4 w-4 shrink-0" />}</button>)}
    </div>}
  </div>;
}

function ConversationListSkeleton({ count = 3 }: { count?: number }) {
  return <div className="space-y-2 px-2 py-2" aria-label="Loading more conversations" aria-live="polite">
    {Array.from({ length: count }, (_, index) => <div key={index} className="animate-pulse space-y-2 rounded-lg px-2 py-2">
      <div className="h-4 w-4/5 rounded bg-[var(--ref-surface-container-highest)]" />
      <div className="h-3 w-1/3 rounded bg-[var(--ref-surface-container)]" />
    </div>)}
  </div>;
}

export type ConversationListProps = {
  conversations: Conversation[];
  periods: Period[];
  selectedPeriodId: string;
  onSelectPeriod: (value: string) => void;
  activeConversationId: number | null;
  visibleConversations: Conversation[];
  visibleConversationCount: number;
  isLoadingMoreConversations: boolean;
  isLoadingConversation: boolean;
  conversationListRef: RefObject<HTMLDivElement | null>;
  onNearEnd: () => void;
  onSelectConversation: (id: number) => void;
  editingConversationId: number | null;
  conversationTitleDraft: string;
  onConversationTitleDraftChange: (value: string) => void;
  onSaveConversationTitle: (id: number) => void;
  onCancelRename: () => void;
  openConversationMenuId: number | null;
  conversationMenuPlacement: 'above' | 'below';
  conversationActionId: number | null;
  onToggleConversationMenu: (event: MouseEvent<HTMLButtonElement>, id: number) => void;
  onEditConversation: (conversation: Conversation) => void;
  onTogglePin: (conversation: Conversation) => void;
  onToggleArchive: (conversation: Conversation) => void;
  onDeleteConversation: (conversation: Conversation) => void;
};

export function ConversationList({
  conversations,
  periods,
  selectedPeriodId,
  onSelectPeriod,
  activeConversationId,
  visibleConversations,
  visibleConversationCount,
  isLoadingMoreConversations,
  isLoadingConversation,
  conversationListRef,
  onNearEnd,
  onSelectConversation,
  editingConversationId,
  conversationTitleDraft,
  onConversationTitleDraftChange,
  onSaveConversationTitle,
  onCancelRename,
  openConversationMenuId,
  conversationMenuPlacement,
  conversationActionId,
  onToggleConversationMenu,
  onEditConversation,
  onTogglePin,
  onToggleArchive,
  onDeleteConversation,
}: ConversationListProps) {
  const activeConversations = conversations.filter((conversation) => conversation.archivedAt == null);
  const archivedConversations = conversations.filter((conversation) => conversation.archivedAt != null);

  return <Card
    title="Conversations"
    action={<span className="whitespace-nowrap text-xs text-[var(--color-text-secondary)]">{activeConversations.length} active · {archivedConversations.length} archived</span>}
  >
    <div className="-mx-4 -mt-4 mb-3 border-b border-[var(--color-border)] px-4 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--ref-surface-container-low)] text-[var(--ref-primary)]"><CalendarDays className="h-4 w-4" /></span>
        <div className="relative min-w-0 flex-1">
          <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">Chat scope</span>
          <PeriodScopeDropdown periods={periods} value={selectedPeriodId} onChange={onSelectPeriod} />
        </div>
      </div>
      <p className="mt-1.5 pl-[2.6rem] text-[11px] text-[var(--color-text-secondary)]">{selectedPeriodId ? `${formatDate(periods.find((period) => String(period.id) === selectedPeriodId)?.startDate ?? 0)} – ${formatDate(periods.find((period) => String(period.id) === selectedPeriodId)?.endDate ?? 0)}` : 'New questions can use all recorded history.'}</p>
    </div>
    <div
      ref={conversationListRef}
      onScroll={(event) => {
        const element = event.currentTarget;
        if (element.scrollHeight - element.scrollTop - element.clientHeight < 80) onNearEnd();
      }}
      className="max-h-[32rem] space-y-1 overflow-y-auto lg:max-h-[calc(100vh-18rem)]"
    >
      {visibleConversations.length === 0 && <p className="text-sm text-[var(--color-text-secondary)]">Your conversations will appear here.</p>}
      {visibleConversations.map((conversation, index) => {
        const isActive = conversation.id === activeConversationId;
        const isArchived = conversation.archivedAt != null;
        const isBusy = conversationActionId === conversation.id;
        const group = isArchived ? 'Archived' : conversation.isPinned ? 'Pinned' : conversationGroup(conversation.updatedAt);
        const previousConversation = visibleConversations[index - 1];
        const previousGroup = previousConversation
          ? (previousConversation.archivedAt != null ? 'Archived' : previousConversation.isPinned ? 'Pinned' : conversationGroup(previousConversation.updatedAt))
          : null;
        return <div key={conversation.id}>
          {group !== previousGroup && <p className="px-2 pb-1 pt-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-muted)] first:pt-0">{group}</p>}
          <div className={cn('group rounded-lg px-2 py-2 transition-colors', isActive ? 'bg-[var(--ref-primary-container)] text-white' : 'hover:bg-[var(--ref-surface-container-low)]')}>
            {editingConversationId === conversation.id ? <form className="flex items-center gap-1" onSubmit={(event) => { event.preventDefault(); onSaveConversationTitle(conversation.id); }}>
              <input autoFocus value={conversationTitleDraft} onChange={(event) => onConversationTitleDraftChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') onCancelRename(); }} maxLength={72} aria-label="Conversation title" className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-sm text-[var(--color-text-primary)]" />
              <button type="submit" className="rounded p-1 text-[var(--color-success)] hover:bg-black/10" title="Save title" aria-label="Save title"><Check className="h-4 w-4" /></button>
              <button type="button" onClick={onCancelRename} className="rounded p-1 hover:bg-black/10" title="Cancel rename" aria-label="Cancel rename"><X className="h-4 w-4" /></button>
            </form> : <div className="flex items-start gap-2">
              <button type="button" onClick={() => onSelectConversation(conversation.id)} className="min-w-0 flex-1 text-left">
                <span className="flex items-center gap-1 truncate text-sm font-medium">{conversation.isPinned && <Pin className="h-3 w-3 shrink-0" aria-label="Pinned" />}<ConversationTitle conversation={conversation} isActive={isActive} /></span>
                <span className={cn('mt-0.5 block text-xs', isActive ? 'text-white/80' : 'text-[var(--color-text-secondary)]')}>{isArchived ? `Archived · ${formatDate(conversation.archivedAt ?? conversation.updatedAt)}` : formatDate(conversation.updatedAt)}</span>
              </button>
              <div className="relative shrink-0 opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100" data-conversation-menu-root>
                <button type="button" disabled={isBusy} onClick={(event) => onToggleConversationMenu(event, conversation.id)} className={cn('rounded p-1 hover:bg-black/10', isActive ? 'text-white' : 'text-[var(--color-text-secondary)]')} title="Conversation actions" aria-label={`Actions for ${conversation.title}`} aria-expanded={openConversationMenuId === conversation.id}><MoreHorizontal className="h-4 w-4" /></button>
                {openConversationMenuId === conversation.id && <div role="menu" className={cn('absolute right-0 z-20 min-w-44 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1 text-[var(--color-text-primary)] shadow-lg', conversationMenuPlacement === 'above' ? 'bottom-8' : 'top-8')}>
                  <button type="button" role="menuitem" onClick={() => onEditConversation(conversation)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--ref-surface-container-low)]"><Pencil className="h-3.5 w-3.5" /> Edit title</button>
                  <button type="button" role="menuitem" onClick={() => onTogglePin(conversation)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--ref-surface-container-low)]">{conversation.isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />} {conversation.isPinned ? 'Unpin conversation' : 'Pin conversation'}</button>
                  <button type="button" role="menuitem" onClick={() => onToggleArchive(conversation)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--ref-surface-container-low)]">{isArchived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />} {isArchived ? 'Restore conversation' : 'Archive conversation'}</button>
                  <button type="button" role="menuitem" onClick={() => onDeleteConversation(conversation)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"><Trash2 className="h-3.5 w-3.5" /> Delete conversation</button>
                </div>}
              </div>
            </div>}
          </div>
        </div>;
      })}
      {isLoadingMoreConversations && <ConversationListSkeleton count={Math.min(CONVERSATIONS_PAGE_SIZE, Math.max(1, conversations.length - visibleConversationCount))} />}
    </div>
    {isLoadingConversation && <p className="mt-3 flex items-center gap-2 text-xs text-[var(--color-text-secondary)]"><span className="h-3.5 w-3.5 animate-pulse rounded-full bg-[var(--ref-primary)]/40" /> Loading conversation…</p>}
  </Card>;
}
