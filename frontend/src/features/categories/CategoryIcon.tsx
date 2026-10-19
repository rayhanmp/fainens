import { createElement } from 'react';
import { cn } from '../../lib/utils';
import { categoryIcon } from './category-icon';

/**
 * A category's line icon, chosen from its name and tinted with its colour: the one mark used for a
 * category wherever it appears, in place of the stored emoji.
 */
export function CategoryIcon({ name, color, className }: { name: string; color?: string | null; className?: string }) {
  // The icons are module-level lucide components picked by name, not components created here.
  return createElement(categoryIcon(name), {
    className: cn('h-4 w-4 shrink-0', className),
    style: { color: color ?? 'var(--ref-on-surface-variant)' },
    'aria-hidden': true,
  });
}
