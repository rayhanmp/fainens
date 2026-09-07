import { create } from "zustand";
import { persist } from "zustand/middleware";

type UiStore = {
  compactTables: boolean;
  activePanel: string | null;
  setCompactTables: (value: boolean) => void;
  setActivePanel: (panel: string | null) => void;
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
  transactionComposer: { isOpen: false },
  openTransactionComposer: (prefill) => set({ transactionComposer: { isOpen: true, prefill } }),
  closeTransactionComposer: () => set({ transactionComposer: { isOpen: false } }),
}), { name: "fainens-ui", partialize: (state) => ({ compactTables: state.compactTables }) }));
