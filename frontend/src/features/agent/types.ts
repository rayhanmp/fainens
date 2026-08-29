import type {
  GetAgentConversation200,
  ListAgentConversations200ConversationsItem,
} from '../../generated/client';
import type { AgentQueryResponse } from '../../lib/api';

export type Period = {
  id: number;
  name: string;
  startDate: number;
  endDate: number;
  isActive?: boolean;
};

export type Conversation = ListAgentConversations200ConversationsItem;
export type ConversationDetail = GetAgentConversation200;
export type AgentResponse = AgentQueryResponse;

export type ChatImage = {
  id: string;
  filename: string;
  mimeType: string;
  dataUrl: string;
  fileSize: number;
};

export type ChatMessage =
  | { id: string; serverId?: number; role: 'user'; text: string; createdAt: number; images?: ChatImage[] }
  | { id: string; role: 'assistant'; text: string; createdAt: number; response?: AgentResponse };

export type AgentActivityStep = {
  id: string;
  label: string;
  status: 'active' | 'done';
  detail?: string;
};

