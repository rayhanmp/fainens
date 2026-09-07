import { Link, useLocation } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { areaNavigation, pathMatches } from './navigation';

export function AreaNavigation() {
  const { pathname } = useLocation();
  const area = areaNavigation.find(group => !pathMatches(pathname, group.parent) && group.items.some(item => pathMatches(pathname, item.to)));
  if (!area) return null;
  return <Link to={area.parent} className="mb-5 inline-flex items-center gap-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]"><ArrowLeft className="h-4 w-4" />Back to {area.label.toLowerCase()}</Link>;
}
