import { create } from "zustand";
import { persist } from "zustand/middleware";

const DRAFT_SCHEMA_VERSION = 1;
type Draft = { version: number; value: string; updatedAt: number };
type DraftStore = {
  drafts: Record<string, Draft>;
  setDraft: (key: string, value: string) => void;
  clearDraft: (key: string) => void;
};

/** Only serializable user-entered drafts live here. Files and server records do not. */
export const useDraftStore = create<DraftStore>()(persist((set) => ({
  drafts: {},
  setDraft: (key, value) => set((state) => ({ drafts: { ...state.drafts, [key]: { version: DRAFT_SCHEMA_VERSION, value, updatedAt: Date.now() } } })),
  clearDraft: (key) => set((state) => {
    const { [key]: _removed, ...drafts } = state.drafts;
    return { drafts };
  }),
}), {
  name: "fainens-drafts",
  version: DRAFT_SCHEMA_VERSION,
  migrate: (persistedState) => {
    const state = persistedState as { drafts?: Record<string, Partial<Draft>> };
    const drafts = Object.fromEntries(Object.entries(state.drafts ?? {}).flatMap(([key, draft]) => {
      if (!draft || typeof draft.value !== 'string') return [];
      return [[key, {
        version: DRAFT_SCHEMA_VERSION,
        value: draft.value,
        updatedAt: typeof draft.updatedAt === 'number' && Number.isFinite(draft.updatedAt) ? draft.updatedAt : Date.now(),
      } satisfies Draft]];
    }));
    return { drafts };
  },
}));
