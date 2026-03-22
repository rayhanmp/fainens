import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: React.ReactNode;
  /** Rendered beside the title row (e.g. mode toggle). Wide / `xl` modals only. */
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  /** Wide layout (Stitch “Add Transaction” style) */
  size?: 'default' | 'xl';
}

export function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  headerExtra,
  children,
  className,
  contentClassName,
  size = 'default',
}: ModalProps) {
  if (!isOpen) return null;

  const isWide = size === 'xl';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 lg:p-5">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className={cn(
          'brutalist-card relative z-10 w-full max-h-[90vh] flex flex-col overflow-hidden',
          isWide ? 'max-w-[min(1024px,92vw)]' : 'max-w-lg',
          className,
        )}
      >
        {/* Header */}
        <div
          className={cn(
            'flex shrink-0 border-b border-[var(--color-border)]',
            isWide ? 'items-start justify-between gap-4 p-5 lg:p-6' : 'items-center justify-between p-4',
          )}
        >
          {isWide ? (
            <>
              <div className="min-w-0 pr-2 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h2 className="font-headline text-2xl font-extrabold tracking-tight text-[var(--color-text-primary)]">
                    {title}
                  </h2>
                  {headerExtra}
                </div>
                {subtitle != null && subtitle !== '' && (
                  <p className="text-sm text-[var(--color-text-secondary)] mt-1 font-body">
                    {subtitle}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex items-center gap-1.5 text-[var(--color-muted)] hover:text-[var(--color-accent)] transition-colors shrink-0"
              >
                <X className="w-5 h-5" aria-hidden />
                <span className="text-sm font-medium">Cancel</span>
              </button>
            </>
          ) : (
            <>
              <h2 className="font-mono font-bold text-lg">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                className="p-1 hover:bg-[var(--color-accent)]/20 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </>
          )}
        </div>

        {/* Content */}
        <div
          className={cn(
            'overflow-y-auto flex-1 min-h-0',
            isWide ? 'px-5 lg:px-6 py-4' : 'p-4',
            contentClassName,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
