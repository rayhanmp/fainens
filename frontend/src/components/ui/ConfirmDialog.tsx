import { useState, useRef, useCallback, createContext, useContext } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { AlertTriangle, AlertCircle, HelpCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'default';
}

interface ConfirmDialogProps extends ConfirmDialogOptions {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isLoading?: boolean;
}

function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  isLoading = false,
}: ConfirmDialogProps) {
  const icon = {
    danger: <AlertCircle className="w-6 h-6 text-[var(--color-danger)]" />,
    warning: <AlertTriangle className="w-6 h-6 text-[var(--color-warning)]" />,
    default: <HelpCircle className="w-6 h-6 text-[var(--ref-primary)]" />,
  }[variant];

  const buttonVariant = {
    danger: 'danger' as const,
    warning: 'secondary' as const,
    default: 'primary' as const,
  }[variant];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="default"
    >
      <div className="flex flex-col gap-6">
        <div className="flex items-start gap-4">
          <div className={cn(
            'flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center',
            variant === 'danger' && 'bg-[var(--color-danger)]/10',
            variant === 'warning' && 'bg-[var(--color-warning)]/10',
            variant === 'default' && 'bg-[var(--ref-primary)]/10',
          )}>
            {icon}
          </div>
          <p className="text-sm text-[var(--color-text-secondary)] pt-2">
            {message}
          </p>
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={isLoading}
            className="sm:min-w-[100px]"
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={buttonVariant}
            onClick={onConfirm}
            isLoading={isLoading}
            className="sm:min-w-[100px]"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

type ConfirmPromiseResolve = (confirmed: boolean) => void;

interface ConfirmDialogState extends ConfirmDialogOptions {
  isOpen: boolean;
  isLoading: boolean;
}

const defaultState: ConfirmDialogState = {
  isOpen: false,
  title: '',
  message: '',
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
  variant: 'default',
  isLoading: false,
};

const ConfirmContext = createContext<{
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
  setLoading: (loading: boolean) => void;
  close: () => void;
} | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConfirmDialogState>(defaultState);
  const resolveRef = useRef<ConfirmPromiseResolve | null>(null);

  const confirm = useCallback((options: ConfirmDialogOptions): Promise<boolean> => {
    setState({
      isOpen: true,
      ...options,
      isLoading: false,
    });
    return new Promise((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const setLoading = useCallback((isLoading: boolean) => {
    setState(prev => ({ ...prev, isLoading }));
  }, []);

  const handleClose = useCallback(() => {
    setState(defaultState);
    resolveRef.current?.(false);
    resolveRef.current = null;
  }, []);

  const handleConfirm = useCallback(() => {
    setState(prev => ({ ...prev, isLoading: true }));
    resolveRef.current?.(true);
  }, []);

  return (
    <ConfirmContext.Provider value={{ confirm, setLoading, close: handleClose }}>
      {children}
      <ConfirmDialog
        isOpen={state.isOpen}
        onClose={handleClose}
        onConfirm={handleConfirm}
        title={state.title}
        message={state.message}
        confirmLabel={state.confirmLabel}
        cancelLabel={state.cancelLabel}
        variant={state.variant}
        isLoading={state.isLoading}
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  return context;
}
