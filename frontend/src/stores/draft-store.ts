import { create } from "zustand";
import { persist } from "zustand/middleware";

type Draft = { value: string; updatedAt: number };
type DraftStore = {
  drafts: Record<string, Draft>;
  setDraft: (key: string, value: string) => void;
  clearDraft: (key: string) => void;
};

/** Only serializable user-entered drafts live here. Files and server records do not. */
export const useDraftStore = create<DraftStore>()(persist((set) => ({
  drafts: {},
  setDraft: (key, value) => set((state) => ({ drafts: { ...state.drafts, [key]: { value, updatedAt: Date.now() } } })),
  clearDraft: (key) => set((state) => {
    const { [key]: _removed, ...drafts } = state.drafts;
    return { drafts };
  }),
}), { name: "fainens-drafts" }));
