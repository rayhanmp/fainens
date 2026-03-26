import { cn } from '../../lib/utils';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  subtext: string;
  title: string | ReactNode;
  description?: string | ReactNode;
  className?: string;
}

export function PageHeader({ subtext, title, description, className }: PageHeaderProps) {
  return (
    <div className={cn(className)}>
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--ref-secondary)] mb-2">
        {subtext}
      </p>
      <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-[var(--color-text-primary)]">
        {title}
      </h1>
      {description && (
        <p className="text-sm text-[var(--color-text-secondary)] mt-2 max-w-xl">
          {description}
        </p>
      )}
    </div>
  );
}