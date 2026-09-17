import { useEffect, useState, useCallback } from 'react';
import { CheckCircle, AlertTriangle, Info, X, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

// Toast Item Component
function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const [isExiting, setIsExiting] = useState(false);
  const handleRemove = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => onRemove(toast.id), 300);
  }, [onRemove, toast.id]);

  useEffect(() => {
    const timer = setTimeout(() => {
      handleRemove();
    }, toast.duration || 5000);

    return () => clearTimeout(timer);
  }, [handleRemove, toast.duration]);

  const icons = {
    success: <CheckCircle className="w-5 h-5" />,
    error: <AlertCircle className="w-5 h-5" />,
    warning: <AlertTriangle className="w-5 h-5" />,
    info: <Info className="w-5 h-5" />,
  };

  const accents = {
    success: 'var(--color-success)',
    error: 'var(--color-danger)',
    warning: 'var(--color-warning)',
    info: 'var(--color-accent)',
  };
  const accent = accents[toast.type];

  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
      className={cn(
        'pointer-events-auto w-full overflow-hidden rounded-2xl border border-[var(--color-border)] border-l-4 bg-[var(--ref-surface-container-lowest)] text-[var(--ref-on-surface)] shadow-[0_16px_48px_rgba(15,23,42,0.18)] ring-1 ring-black/[0.03] transition-all duration-300',
        isExiting ? 'translate-x-3 opacity-0' : 'translate-x-0 opacity-100',
      )}
      style={{ borderLeftColor: accent }}
    >
      <div className="flex items-start gap-3.5 p-4">
        <div
          className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full"
          style={{ color: accent, backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)` }}
          aria-hidden="true"
        >
          {icons[toast.type]}
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-sm font-semibold leading-5">{toast.title}</p>
          {toast.message && (
            <p className="mt-1 text-sm leading-relaxed text-[var(--ref-on-surface-variant)]">{toast.message}</p>
          )}
        </div>
        <button
          type="button"
          onClick={handleRemove}
          className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full text-[var(--ref-on-surface-variant)] transition-colors hover:bg-[var(--ref-surface-container-high)] hover:text-[var(--ref-on-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ref-primary)]"
          aria-label={`Dismiss notification: ${toast.title}`}
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
    <div className="pointer-events-none fixed right-4 top-4 z-[100] flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-sm flex-col gap-3 overflow-y-auto">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}
