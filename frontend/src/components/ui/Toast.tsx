import { useEffect, useState, useCallback } from 'react';
import { CheckCircle, AlertTriangle, Info, X, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

// Toast Item Component
function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      handleRemove();
    }, toast.duration || 5000);

    return () => clearTimeout(timer);
  }, [toast.duration]);

  const handleRemove = () => {
    setIsExiting(true);
    setTimeout(() => onRemove(toast.id), 300);
  };

  const icons = {
    success: <CheckCircle className="w-5 h-5" />,
    error: <AlertCircle className="w-5 h-5" />,
    warning: <AlertTriangle className="w-5 h-5" />,
    info: <Info className="w-5 h-5" />,
  };

  const styles = {
    success: 'bg-[var(--color-success)]/10 border-[var(--color-success)] text-[var(--color-success)]',
    error: 'bg-[var(--color-danger)]/10 border-[var(--color-danger)] text-[var(--color-danger)]',
    warning: 'bg-[var(--color-warning)]/10 border-[var(--color-warning)] text-[var(--color-warning)]',
    info: 'bg-[var(--color-accent)]/10 border-[var(--color-accent)] text-[var(--color-accent)]',
  };

  return (
    <div
      className={cn(
        'border-2 p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)] transition-all duration-300',
        styles[toast.type],
        isExiting ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0'
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{icons[toast.type]}</div>
        <div className="flex-1 min-w-0">
          <p className="font-mono font-bold text-sm">{toast.title}</p>
          {toast.message && (
            <p className="text-sm mt-1 opacity-90">{toast.message}</p>
          )}
        </div>
        <button
          onClick={handleRemove}
          className="p-1 hover:bg-black/10 transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// Toast Container Component
interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

export function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 space-y-3 w-full max-w-sm">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}

// Hook for using toasts
export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts((prev) => [...prev, { ...toast, id }]);
    return id;
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const success = useCallback((title: string, message?: string, duration?: number) =>
    addToast({ type: 'success', title, message, duration }), [addToast]);

  const error = useCallback((title: string, message?: string, duration?: number) =>
    addToast({ type: 'error', title, message, duration: duration || 8000 }), [addToast]);

  const warning = useCallback((title: string, message?: string, duration?: number) =>
    addToast({ type: 'warning', title, message, duration }), [addToast]);

  const info = useCallback((title: string, message?: string, duration?: number) =>
    addToast({ type: 'info', title, message, duration }), [addToast]);

  // Create a bound ToastContainer component
  const BoundToastContainer = useCallback(() => (
    <ToastContainer toasts={toasts} onRemove={removeToast} />
  ), [toasts, removeToast]);

  return { toasts, addToast, removeToast, success, error, warning, info, ToastContainer: BoundToastContainer };
}
