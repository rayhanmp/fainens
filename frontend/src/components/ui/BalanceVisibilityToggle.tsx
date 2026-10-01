import { Eye, EyeOff } from 'lucide-react';
import { useUiStore } from '../../stores/ui-store';
import { cn } from '../../lib/utils';

export function BalanceVisibilityToggle({ inverted = false, showLabel = false, className }: { inverted?: boolean; showLabel?: boolean; className?: string }) {
  const hidden = useUiStore((state) => state.balancesHidden);
  const toggle = useUiStore((state) => state.toggleBalancesHidden);
  const label = hidden ? 'Show balances' : 'Hide balances';
  const Icon = hidden ? EyeOff : Eye;
  return <button
    type="button"
    aria-label={label}
    title={label}
    aria-pressed={hidden}
    onClick={toggle}
    className={cn(
      'inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-sm)] text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
      showLabel && 'w-auto px-3',
      inverted
        ? 'text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-white'
        : 'text-[var(--color-text-secondary)] hover:bg-[var(--ref-surface-container-high)] hover:text-[var(--color-text-primary)] focus-visible:outline-[var(--color-accent)]',
      className,
    )}
  ><Icon className="h-4 w-4 shrink-0" aria-hidden />{showLabel && <span>{label}</span>}</button>;
}
