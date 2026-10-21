import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { panelLink, panelSubtitle, panelTitle } from './panel-styles';

/** Title, optional subtitle and an optional action on the right; used by every dashboard panel. */
export function PanelHeader({ title, subtitle, action, className }: { title: string; subtitle?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className={panelTitle}>{title}</h2>
        {subtitle && <p className={panelSubtitle}>{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

type PanelLinkTo = '/accounts' | '/budget' | '/goals' | '/loans' | '/paylater' | '/subscriptions' | '/transactions';

export function PanelLink({ to, children, className }: { to: PanelLinkTo; children: ReactNode; className?: string }) {
  return <Link to={to} className={cn(panelLink, className)}>{children} <ArrowRight className="h-4 w-4" aria-hidden /></Link>;
}
