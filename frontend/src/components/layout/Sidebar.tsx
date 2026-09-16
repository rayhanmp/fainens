import { Link, useLocation } from '@tanstack/react-router';
import { Plus, PanelLeftClose, PanelLeftOpen, ChevronDown, Settings, LogOut, Shield, CircleHelp } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../../lib/auth';
import { useAgentProfileQuery } from '../../features/agent/queries';
import { usePendingTransactionsQuery } from '../../features/transactions/queries';
import { useUiStore } from '../../stores/ui-store';
import { useConfirm } from '../ui/ConfirmDialog';
import { navigationGroups, navigationActive, pathMatches } from './navigation';

export function NavigationLinks({ compact = false, onNavigate, afterNavigation }: { compact?: boolean; onNavigate?: () => void; afterNavigation?: ReactNode }) {
  const { pathname } = useLocation();
  const dashboardNotificationCount = useUiStore((state) => state.dashboardNotificationCount);
  const pendingTransactionCount = usePendingTransactionsQuery().data?.length ?? 0;
  return (
    <nav aria-label="Main navigation" className="finance-navigation">
      {navigationGroups.map((group, index) => (
        <div className="finance-nav-group" key={index}>
          {group.label && <div className="finance-nav-heading">{compact ? <span aria-label={group.label}>·</span> : group.label}</div>}
          <ul>
            {group.items.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <Link to={to} onClick={onNavigate} title={compact ? label : undefined} aria-label={compact ? label : undefined}
                  aria-current={pathMatches(pathname, to) ? 'page' : undefined}
                  className={`finance-nav-link relative ${navigationActive(pathname, to) ? 'is-active' : ''}`}>
                  <Icon aria-hidden="true" />{!compact && <span>{label}</span>}
                  {to === '/' && dashboardNotificationCount > 0 && <span className={compact ? 'absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-[var(--nav-surface)]' : 'ml-auto grid min-w-5 place-items-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold leading-4 text-white'} aria-label={`${dashboardNotificationCount} dashboard notification${dashboardNotificationCount === 1 ? '' : 's'}`}>{compact ? '' : Math.min(dashboardNotificationCount, 9)}</span>}
                  {to === '/transactions' && pendingTransactionCount > 0 && <span className={compact ? 'absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-[var(--nav-surface)]' : 'ml-auto grid min-w-5 place-items-center rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold leading-4 text-white'} aria-label={`${pendingTransactionCount} pending transaction${pendingTransactionCount === 1 ? '' : 's'}`}>{compact ? '' : Math.min(pendingTransactionCount, 9)}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {afterNavigation}
    </nav>
  );
}

export function ProfileMenu({ compact = false, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  const profileQuery = useAgentProfileQuery();
  const { confirm } = useConfirm();
  const openSettings = useUiStore((state) => state.openSettings);
  const { pathname } = useLocation();
  const profileRef = useRef<HTMLDetailsElement>(null);
  const name = profileQuery.data?.nickname || user?.email?.split('@')[0] || 'Your account';
  const closeProfile = () => {
    if (profileRef.current) profileRef.current.open = false;
  };
  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const details = profileRef.current;
      if (!details?.open || details.contains(event.target as Node)) return;
      details.open = false;
      details.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, []);
  return (
    <details ref={profileRef} className="finance-profile group" onKeyDown={event => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.currentTarget.open = false;
        event.currentTarget.querySelector('summary')?.focus();
      }
    }}>
      <summary title={compact ? 'Profile & settings' : undefined} aria-label={compact ? 'Profile & settings' : undefined}>
        <span className="finance-avatar">{name.slice(0, 2).toUpperCase()}</span>
        {!compact && <><span className="finance-profile-name"><strong>{name}</strong><small>Profile & settings</small></span><ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-150 group-open:rotate-180" /></>}
      </summary>
      <div className="finance-profile-popover">
        <button type="button" onClick={() => { closeProfile(); onNavigate?.(); openSettings(); }} className="finance-nav-link"><Settings />Settings</button>
        <Link to="/help" onClick={onNavigate} className={`finance-nav-link ${navigationActive(pathname, '/help') ? 'is-active' : ''}`}><CircleHelp />Help & glossary</Link>
        <Link to="/audit-log" onClick={onNavigate} className="finance-nav-link"><Shield />Security audit</Link>
        <button type="button" className="finance-nav-link" onClick={async () => {
          if (await confirm({ title: 'Sign out', message: 'Are you sure you want to sign out?', confirmLabel: 'Sign out', variant: 'default' })) await logout();
        }}><LogOut />Sign out</button>
      </div>
    </details>
  );
}

export function AddTransactionLink({ compact = false, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  return <Link to="/transactions" search={{ action: 'new' }} onClick={onNavigate} className="finance-add" title={compact ? 'Add transaction' : undefined} aria-label={compact ? 'Add transaction' : undefined}><Plus aria-hidden="true" />{!compact && <span>Add transaction</span>}</Link>;
}

export function Sidebar() {
  const { isDemoMode } = useAuth();
  const [compact, setCompact] = useState(() => {
    try { return localStorage.getItem('fainens.sidebar.compact') === 'true'; } catch { return false; }
  });
  return (
    <aside className={`finance-sidebar hidden md:flex ${compact ? 'is-compact' : ''}`}>
      <div className="finance-brand">
        {!compact && <Link to="/" className="finance-wordmark"><span className="finance-brand-mark">f</span>Fainens</Link>}
        <button type="button" className="finance-collapse" aria-label={compact ? 'Expand sidebar' : 'Collapse sidebar'} title={compact ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!compact} onClick={() => {
          setCompact(!compact);
          try { localStorage.setItem('fainens.sidebar.compact', String(!compact)); } catch { /* Storage is optional. */ }
        }}>{compact ? <PanelLeftOpen /> : <PanelLeftClose />}</button>
      </div>
      <div className="finance-action"><AddTransactionLink compact={compact} /></div>
      <NavigationLinks compact={compact} afterNavigation={isDemoMode && <div className={`mx-1 mt-3 rounded-lg border border-[var(--ref-outline-variant)]/25 bg-[var(--nav-active)] px-2.5 py-2 text-[10px] leading-tight text-[var(--nav-muted)] ${compact ? 'px-1 text-center' : ''}`} title="Local preview access · sign-in bypassed for development"><span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[var(--nav-accent)]" aria-hidden />{compact ? <span className="sr-only">Local preview access · sign-in bypassed for development</span> : 'Local preview access · sign-in bypassed for development'}</div>} />
      <div className="finance-footer"><ProfileMenu compact={compact} /></div>
    </aside>
  );
}
