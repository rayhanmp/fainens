import { create } from "zustand";
import { persist } from "zustand/middleware";

type UiStore = {
  compactTables: boolean;
  activePanel: string | null;
  setCompactTables: (value: boolean) => void;
  setActivePanel: (panel: string | null) => void;
};

export const useUiStore = create<UiStore>()(persist((set) => ({
  compactTables: false,
  activePanel: null,
  setCompactTables: (compactTables) => set({ compactTables }),
  setActivePanel: (activePanel) => set({ activePanel }),
}), { name: "fainens-ui", partialize: (state) => ({ compactTables: state.compactTables }) }));
