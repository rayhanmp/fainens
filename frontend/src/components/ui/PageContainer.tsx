import { cn } from '../../lib/utils';
import type { ReactNode } from 'react';

interface PageContainerProps {
  children: ReactNode;
  className?: string;
  variant?: 'default' | 'full-width' | 'compact';
}

export function PageContainer({ children, className, variant = 'default' }: PageContainerProps) {
  return (
    <div
      className={cn(
        'mx-auto',
        variant === 'default' && 'max-w-7xl space-y-6 sm:space-y-8 pb-8',
        variant === 'full-width' && 'space-y-6 sm:space-y-8 pb-8',
        variant === 'compact' && 'max-w-7xl space-y-4 sm:space-y-6 pb-6',
        className
      )}
    >
      {children}
    </div>
  );
}
