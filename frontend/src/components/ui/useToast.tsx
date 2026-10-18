import { create } from 'zustand';
import type { Toast } from './Toast';

/** At most this many toasts stay on screen; older ones are dropped first. */
const MAX_TOASTS = 4;

type ToastStore = {
  toasts: Toast[];
  add: (toast: Omit<Toast, 'id'>) => string;
  remove: (id: string) => void;
};

/** The single toast stack, rendered by `Toaster` in Toast.tsx. */
export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  add: (toast) => {
    const id = Math.random().toString(36).slice(2, 11);
    set((state) => {
      // A repeat of the toast already on top replaces it instead of stacking.
      const top = state.toasts.at(-1);
      const rest = top && top.title === toast.title && top.message === toast.message ? state.toasts.slice(0, -1) : state.toasts;
      return { toasts: [...rest, { ...toast, id }].slice(-MAX_TOASTS) };
    });
    return id;
  },
  remove: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

const addToast = (toast: Omit<Toast, 'id'>) => useToastStore.getState().add(toast);
const removeToast = (id: string) => useToastStore.getState().remove(id);

/**
 * App-wide toasts. Usable outside React (mutation callbacks, controllers);
 * components can call `useToast()` for the same API.
 */
export const toast = {
  show: addToast,
  dismiss: removeToast,
  success: (title: string, message?: string, duration?: number) => addToast({ type: 'success', title, message, duration }),
  error: (title: string, message?: string, duration?: number) => addToast({ type: 'error', title, message, duration: duration || 8000 }),
  warning: (title: string, message?: string, duration?: number) => addToast({ type: 'warning', title, message, duration }),
  info: (title: string, message?: string, duration?: number) => addToast({ type: 'info', title, message, duration }),
};

/** Message text for a caught value, so error toasts never show "[object Object]". */
export function errorMessage(error: unknown, fallback = 'Please try again.'): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}

export function useToast() {
  return { addToast, removeToast, ...toast };
}
