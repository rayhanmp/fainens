import { Check, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Modal } from './Modal';

export type SheetAction = {
  key: string;
  label: string;
  icon?: LucideIcon;
  /** Secondary line under the label. */
  detail?: string;
  tone?: 'default' | 'primary' | 'warning' | 'danger';
  /** Shows a check: for pickers, the current choice. */
  selected?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

const toneClass: Record<NonNullable<SheetAction['tone']>, string> = {
  default: 'text-[var(--ref-on-surface)] hover:bg-[var(--ref-surface-container-low)]',
  primary: 'text-[var(--ref-primary)] hover:bg-[var(--ref-primary)]/10',
  warning: 'text-amber-700 hover:bg-amber-500/10 dark:text-amber-300',
  danger: 'text-[var(--ref-error)] hover:bg-[var(--ref-error)]/10',
};

/**
 * A menu or picker as a phone bottom sheet: thumb-sized rows, a drag handle, and the same Modal
 * plumbing (focus, back button, swipe down to close). Choosing a row closes the sheet first, so the
 * next layer (a confirm, a modal) opens on a settled page.
 */
export function ActionSheet({ isOpen, onClose, title, subtitle, actions }: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  actions: readonly SheetAction[];
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} subtitle={subtitle} contentClassName="p-3">
      <div className="space-y-0.5" role="menu" aria-label={title}>
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.key}
              type="button"
              role={action.selected != null ? 'menuitemradio' : 'menuitem'}
              aria-checked={action.selected ?? undefined}
              disabled={action.disabled}
              onClick={() => { onClose(); window.setTimeout(action.onSelect, 0); }}
              className={cn('flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-bold disabled:opacity-40', toneClass[action.tone ?? 'default'], action.selected && 'bg-[var(--ref-surface-container-low)]')}
            >
              {Icon && <Icon className="h-5 w-5 shrink-0" aria-hidden />}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{action.label}</span>
                {action.detail && <span className="block truncate text-xs font-medium text-[var(--ref-on-surface-variant)]">{action.detail}</span>}
              </span>
              {action.selected && <Check className="h-5 w-5 shrink-0 text-[var(--ref-primary)]" aria-hidden />}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
