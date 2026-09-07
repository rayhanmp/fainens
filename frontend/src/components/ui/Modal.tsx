import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useEffect, useId, useState, useRef } from 'react';

const MODAL_STACK_KEY = '__fainensModalStack';
let modalSequence = 0;

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: React.ReactNode;
  /** Rendered beside the title row (e.g. mode toggle). Wide / `xl` modals only. */
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  overlayClassName?: string;
  contentClassName?: string;
  /** Wide layout (Stitch "Add Transaction" style) */
  size?: 'default' | 'xl';
  /** Keep wide modal headers compact when an icon-only close affordance is preferred. */
  showCloseLabel?: boolean;
  /** Footer content rendered at the bottom of the modal */
  footer?: React.ReactNode;
}

export function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  headerExtra,
  children,
  className,
  overlayClassName,
  contentClassName,
  size = 'default',
  showCloseLabel = true,
  footer,
}: ModalProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const sheetDragStartRef = useRef<number | null>(null);
  const [sheetDrag, setSheetDrag] = useState(0);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  const [historyToken] = useState(() => `modal-${++modalSequence}`);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // Give each open sheet a same-URL history entry. On Android and iOS browsers,
  // Back then dismisses the top sheet before navigating away from the page.
  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;
    const token = historyToken;
    let pushed = false;
    const timer = window.setTimeout(() => {
      const current = Array.isArray(history.state?.[MODAL_STACK_KEY]) ? history.state[MODAL_STACK_KEY] as string[] : [];
      history.pushState({ ...history.state, [MODAL_STACK_KEY]: [...current, token] }, '');
      pushed = true;
    }, 0);
    const handlePopState = (event: PopStateEvent) => {
      const stack = Array.isArray(event.state?.[MODAL_STACK_KEY]) ? event.state[MODAL_STACK_KEY] as string[] : [];
      if (pushed && !stack.includes(token)) {
        pushed = false;
        onCloseRef.current();
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('popstate', handlePopState);
      const stack = Array.isArray(history.state?.[MODAL_STACK_KEY]) ? history.state[MODAL_STACK_KEY] as string[] : [];
      if (pushed && stack.at(-1) === token) {
        pushed = false;
        history.back();
      }
    };
  }, [historyToken, isOpen]);

  useEffect(() => {
    if (!isOpen || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const update = () => setViewportHeight(viewport.height);
    update();
    viewport.addEventListener('resize', update);
    return () => viewport.removeEventListener('resize', update);
  }, [isOpen]);

  // Store the element that had focus before modal opened
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
    }
  }, [isOpen]);

  // Handle escape key and focus trap
  useEffect(() => {
    if (!isOpen || !shouldRender) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }

      // Focus trap: Tab navigation
      if (e.key === 'Tab' && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, shouldRender, onClose]);

  // Focus first focusable element when modal opens
  useEffect(() => {
    if (isVisible && modalRef.current) {
      const focusableElement = modalRef.current.querySelector(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      ) as HTMLElement;
      focusableElement?.focus();
    }
  }, [isVisible]);

  // Restore focus when modal closes
  useEffect(() => {
    if (!isOpen && !shouldRender && previousFocusRef.current) {
      previousFocusRef.current.focus();
    }
  }, [isOpen, shouldRender]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShouldRender(true);
      // Small delay to allow render before animation
      requestAnimationFrame(() => {
        setIsVisible(true);
      });
    } else {
      setIsVisible(false);
      setSheetDrag(0);
      // Wait for animation to finish before unmounting
      const timer = setTimeout(() => {
        setShouldRender(false);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!shouldRender) return null;

  const isWide = size === 'xl';

  return (
    <div 
      className={cn('fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 lg:p-5', overlayClassName)}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      {/* Backdrop */}
      <div
        className={cn(
          'absolute inset-0 bg-black/50 transition-opacity duration-200',
          isVisible ? 'opacity-100' : 'opacity-0'
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        style={{
          ...(sheetDrag > 0 ? { transform: `translateY(${sheetDrag}px)` } : {}),
          ...(viewportHeight ? { '--modal-viewport-height': `${viewportHeight}px` } as React.CSSProperties : {}),
        }}
        className={cn(
          'brutalist-card mobile-sheet relative z-10 w-full max-h-[90vh] flex flex-col overflow-hidden transition-all duration-200 ease-out',
          isVisible ? 'opacity-100 sm:scale-100 sm:translate-y-0' : 'opacity-0 translate-y-full sm:scale-95 sm:translate-y-4',
          isWide ? 'max-w-[min(1024px,92vw)]' : 'max-w-lg',
          isWide && 'mobile-sheet-full',
          className,
        )}
      >
        <div
          className="mobile-sheet-handle sm:hidden"
          aria-hidden="true"
          onPointerDown={(event) => {
            if (event.pointerType !== 'mouse') sheetDragStartRef.current = event.clientY;
          }}
          onPointerMove={(event) => {
            if (sheetDragStartRef.current == null) return;
            setSheetDrag(Math.max(0, event.clientY - sheetDragStartRef.current));
          }}
          onPointerUp={() => {
            sheetDragStartRef.current = null;
            if (sheetDrag > 96) onClose();
            else setSheetDrag(0);
          }}
          onPointerCancel={() => { sheetDragStartRef.current = null; setSheetDrag(0); }}
        ><span /></div>
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
                  <h2 
                    id={titleId}
                    className="font-headline text-2xl font-extrabold tracking-tight text-[var(--color-text-primary)]"
                  >
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
                className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg p-1.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--ref-surface-container-low)] hover:text-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ref-primary)]/30"
                aria-label="Close dialog"
              >
                <X className="w-5 h-5" aria-hidden="true" />
                {showCloseLabel && <span className="text-sm font-medium">Cancel</span>}
              </button>
            </>
          ) : (
            <>
              <h2 id={titleId} className="font-mono font-bold text-lg">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                className="cursor-pointer p-1 hover:bg-[var(--color-accent)]/20 transition-colors"
                aria-label="Close dialog"
              >
                <X className="w-5 h-5" aria-hidden="true" />
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

        {/* Footer */}
        {footer && (
          <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-4 py-4 sm:px-6">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
