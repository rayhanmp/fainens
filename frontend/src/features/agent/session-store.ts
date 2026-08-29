import { create } from "zustand";

export type StreamStatus = "idle" | "streaming" | "cancelling" | "failed";
type AgentSessionStore = {
  activeConversationId: number | null;
  streamStatus: StreamStatus;
  pendingAttachmentIds: string[];
  setActiveConversationId: (id: number | null) => void;
  setStreamStatus: (status: StreamStatus) => void;
  setPendingAttachmentIds: (ids: string[]) => void;
  reset: () => void;
};

/** Intentionally transient: messages and conversation facts remain React Query data. */
export const useAgentSessionStore = create<AgentSessionStore>((set) => ({
  activeConversationId: null,
  streamStatus: "idle",
  pendingAttachmentIds: [],
  setActiveConversationId: (activeConversationId) => set({ activeConversationId }),
  setStreamStatus: (streamStatus) => set({ streamStatus }),
  setPendingAttachmentIds: (pendingAttachmentIds) => set({ pendingAttachmentIds }),
  reset: () => set({ activeConversationId: null, streamStatus: "idle", pendingAttachmentIds: [] }),
}));
