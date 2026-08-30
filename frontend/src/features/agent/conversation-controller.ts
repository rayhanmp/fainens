import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ListAgentConversations200 } from '../../generated/client';
import { agentCommands } from './commands';
import { queryKeys } from '../core/query-keys';
import type { Conversation } from './types';

type ConversationUpdate = { title?: string; isPinned?: boolean; archived?: boolean };

/**
 * Keeps conversation-list interactions out of the agent page. It owns only
 * transient list UI and command orchestration. Conversation records remain in
 * React Query and are updated optimistically from the command response.
 */
export function useConversationController({
  activeConversationId,
  onError,
}: {
  activeConversationId: number | null;
  onError: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const conversationListRef = useRef<HTMLDivElement>(null);
  const [conversationActionId, setConversationActionId] = useState<number | null>(null);
  const [openConversationMenuId, setOpenConversationMenuId] = useState<number | null>(null);
  const [conversationMenuPlacement, setConversationMenuPlacement] = useState<'above' | 'below'>('below');
  const [editingConversationId, setEditingConversationId] = useState<number | null>(null);
  const [conversationTitleDraft, setConversationTitleDraft] = useState('');

  const updateConversationCache = useCallback((update: (current: Conversation[]) => Conversation[]) => {
    queryClient.setQueryData<ListAgentConversations200>(queryKeys.agent.conversations(true, new Date().getTimezoneOffset()), (current) => current
      ? { ...current, conversations: update(current.conversations) }
      : current);
  }, [queryClient]);

  const updateConversation = useCallback(async (conversationId: number, data: ConversationUpdate) => {
    setConversationActionId(conversationId);
    onError('');
    try {
      const result = await agentCommands.conversations.update(conversationId, data);
      updateConversationCache((current) => current.map((conversation) => conversation.id === conversationId ? result.conversation : conversation));
      return result.conversation;
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Could not update that conversation.');
      return null;
    } finally {
      setConversationActionId(null);
    }
  }, [onError, updateConversationCache]);

  const beginConversationRename = useCallback((conversation: Conversation | null) => {
    if (!conversation) return;
    setEditingConversationId(conversation.id);
    setConversationTitleDraft(conversation.title === 'New conversation' ? '' : conversation.title);
    setOpenConversationMenuId(null);
    onError('');
  }, [onError]);

  const cancelConversationRename = useCallback(() => {
    setEditingConversationId(null);
    setConversationTitleDraft('');
  }, []);

  const saveConversationTitle = useCallback(async (conversationId: number) => {
    const title = conversationTitleDraft.trim();
    if (!title) {
      onError('Conversation title cannot be empty.');
      return;
    }
    const updated = await updateConversation(conversationId, { title });
    if (updated) cancelConversationRename();
  }, [cancelConversationRename, conversationTitleDraft, onError, updateConversation]);

  const toggleConversationMenu = useCallback((event: MouseEvent<HTMLButtonElement>, conversationId: number) => {
    if (openConversationMenuId === conversationId) {
      setOpenConversationMenuId(null);
      return;
    }
    const triggerBottom = event.currentTarget.getBoundingClientRect().bottom;
    const listBottom = conversationListRef.current?.getBoundingClientRect().bottom;
    const estimatedMenuHeight = 188;
    setConversationMenuPlacement(listBottom != null && triggerBottom + estimatedMenuHeight > listBottom ? 'above' : 'below');
    setOpenConversationMenuId(conversationId);
  }, [openConversationMenuId]);

  const deleteConversation = useCallback(async (conversation: Conversation, onDeletedActive?: () => void) => {
    if (!window.confirm(`Delete “${conversation.title}”? This permanently removes the conversation and its messages.`)) return;
    setConversationActionId(conversation.id);
    onError('');
    try {
      await agentCommands.conversations.delete(conversation.id);
      updateConversationCache((current) => current.filter((candidate) => candidate.id !== conversation.id));
      setOpenConversationMenuId(null);
      if (activeConversationId === conversation.id) onDeletedActive?.();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Could not delete that conversation.');
    } finally {
      setConversationActionId(null);
    }
  }, [activeConversationId, onError, updateConversationCache]);

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

  return {
    conversationListRef,
    conversationActionId,
    openConversationMenuId,
    conversationMenuPlacement,
    editingConversationId,
    conversationTitleDraft,
    setConversationTitleDraft,
    updateConversationCache,
    updateConversation,
    beginConversationRename,
    cancelConversationRename,
    saveConversationTitle,
    toggleConversationMenu,
    deleteConversation,
    closeConversationMenu: () => setOpenConversationMenuId(null),
  };
}
