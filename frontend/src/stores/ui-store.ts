import { create } from "zustand";
import { persist } from "zustand/middleware";

type UiStore = {
  compactTables: boolean;
  activePanel: string | null;
  setCompactTables: (value: boolean) => void;
  setActivePanel: (panel: string | null) => void;
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  transactionComposer: {
    isOpen: boolean;
    prefill?: { accountId?: number; categoryId?: number; periodId?: number };
  };
  openTransactionComposer: (prefill?: { accountId?: number; categoryId?: number; periodId?: number }) => void;
  closeTransactionComposer: () => void;
};

export const useUiStore = create<UiStore>()(persist((set) => ({
  compactTables: false,
  activePanel: null,
  setCompactTables: (compactTables) => set({ compactTables }),
  setActivePanel: (activePanel) => set({ activePanel }),
  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  transactionComposer: { isOpen: false },
  openTransactionComposer: (prefill) => set({ transactionComposer: { isOpen: true, prefill } }),
  closeTransactionComposer: () => set({ transactionComposer: { isOpen: false } }),
}), { name: "fainens-ui", partialize: (state) => ({ compactTables: state.compactTables }) }));
