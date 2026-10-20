import { Link, useRouterState } from '@tanstack/react-router';
import { CircleHelp } from 'lucide-react';
import { cn } from '../../lib/utils';
import { GUIDE_FOR_PATH } from '../../features/help/page-guides';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  subtext: string;
  title: string | ReactNode;
  description?: string | ReactNode;
  className?: string;
}

/** A small link from an app page to the help page that explains it. */
export function PageGuideLink({ className }: { className?: string }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const guide = GUIDE_FOR_PATH[pathname];
  if (!guide) return null;
  return (
    <Link
      to="/help/$slug"
      params={{ slug: guide.slug }}
      title={`Help: ${guide.title}`}
      className={cn('inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold normal-case tracking-normal text-[var(--ref-on-surface-variant)] transition-colors hover:bg-[var(--ref-surface-container-low)] hover:text-[var(--color-accent)]', className)}
    >
      <CircleHelp className="h-3.5 w-3.5" aria-hidden />Guide
    </Link>
  );
}

export function PageHeader({ subtext, title, description, className }: PageHeaderProps) {
  return (
    <div className={cn('finance-page-header', className)}>
      <div className="mb-2 flex items-center gap-2">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--ref-secondary)]">
          {subtext}
        </p>
        <PageGuideLink />
      </div>
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
