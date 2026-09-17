import { useCallback, useState } from 'react';
import { ToastContainer } from './Toast';
import type { Toast } from './Toast';

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2, 11);
    setToasts((previous) => [...previous, { ...toast, id }]);
    return id;
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
  }, []);

  const success = useCallback((title: string, message?: string, duration?: number) =>
    addToast({ type: 'success', title, message, duration }), [addToast]);
  const error = useCallback((title: string, message?: string, duration?: number) =>
    addToast({ type: 'error', title, message, duration: duration || 8000 }), [addToast]);
  const warning = useCallback((title: string, message?: string, duration?: number) =>
    addToast({ type: 'warning', title, message, duration }), [addToast]);
  const info = useCallback((title: string, message?: string, duration?: number) =>
    addToast({ type: 'info', title, message, duration }), [addToast]);

  const BoundToastContainer = useCallback(() => (
    <ToastContainer toasts={toasts} onRemove={removeToast} />
  ), [toasts, removeToast]);

  return { toasts, addToast, removeToast, success, error, warning, info, ToastContainer: BoundToastContainer };
}
