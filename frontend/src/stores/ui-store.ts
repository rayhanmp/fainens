import { create } from "zustand";
import { persist } from "zustand/middleware";

type UiStore = {
  compactTables: boolean;
  balancesHidden: boolean;
  toggleBalancesHidden: () => void;
  activePanel: string | null;
  setCompactTables: (value: boolean) => void;
  setActivePanel: (panel: string | null) => void;
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  dashboardNotificationCount: number;
  setDashboardNotificationCount: (count: number) => void;
  transactionComposer: {
    isOpen: boolean;
    prefill?: { accountId?: number; categoryId?: number; periodId?: number };
  };
  openTransactionComposer: (prefill?: { accountId?: number; categoryId?: number; periodId?: number }) => void;
  closeTransactionComposer: () => void;
};

/** Phones start with balances hidden: the screen is easily seen by others. Wider screens show them. */
const isPhone = () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;

export const useUiStore = create<UiStore>()(persist((set) => ({
  compactTables: false,
  balancesHidden: isPhone(),
  toggleBalancesHidden: () => set((state) => ({ balancesHidden: !state.balancesHidden })),
  activePanel: null,
  setCompactTables: (compactTables) => set({ compactTables }),
  setActivePanel: (activePanel) => set({ activePanel }),
  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  dashboardNotificationCount: 0,
  setDashboardNotificationCount: (dashboardNotificationCount) => set({ dashboardNotificationCount }),
  transactionComposer: { isOpen: false },
  openTransactionComposer: (prefill) => set({ transactionComposer: { isOpen: true, prefill } }),
  closeTransactionComposer: () => set({ transactionComposer: { isOpen: false } }),
}), {
  name: "fainens-ui",
  partialize: (state) => ({ compactTables: state.compactTables, balancesHidden: state.balancesHidden }),
  // Version 1 made hidden balances the phone default. A phone that saved the old default (shown)
  // switches to hidden once; whatever is chosen after that is kept.
  version: 1,
  migrate: (persisted, version) => {
    const state = (persisted ?? {}) as { compactTables?: boolean; balancesHidden?: boolean };
    return version < 1 && isPhone() ? { ...state, balancesHidden: true } : state;
  },
}));
