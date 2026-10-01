import { Link, useLocation } from '@tanstack/react-router';
import { Plus, PanelLeftClose, PanelLeftOpen, ChevronDown, Settings, LogOut, Shield, CircleHelp } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../../lib/auth';
import { useAgentProfileQuery } from '../../features/agent/queries';
import { usePendingTransactionsQuery } from '../../features/transactions/queries';
import { useUiStore } from '../../stores/ui-store';
import { useConfirm } from '../ui/ConfirmDialog';
import { navigationGroups, navigationActive, pathMatches } from './navigation';
import { BalanceVisibilityToggle } from '../ui/BalanceVisibilityToggle';

export function NavigationLinks({ compact = false, onNavigate, afterNavigation }: { compact?: boolean; onNavigate?: () => void; afterNavigation?: ReactNode }) {
  const { pathname } = useLocation();
  const dashboardNotificationCount = useUiStore((state) => state.dashboardNotificationCount);
  const pendingTransactionCount = usePendingTransactionsQuery().data?.length ?? 0;
  return (
    <nav aria-label="Main navigation" className="finance-navigation">
      {navigationGroups.map((group, index) => (
        <div className="finance-nav-group" key={index}>
          {group.label && <div className="finance-nav-heading" aria-hidden={compact}>{!compact && group.label}</div>}
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

export function ProfileMenu({ compact = false, showDevAuthStatus = false, onNavigate }: { compact?: boolean; showDevAuthStatus?: boolean; onNavigate?: () => void }) {
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
        <span className="finance-avatar">{name.slice(0, 2).toUpperCase()}{showDevAuthStatus && <span className="finance-dev-status" role="status" aria-label="Dev Auth Bypass" data-tooltip="Dev Auth Bypass" />}</span>
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
  const [showExpandedContent, setShowExpandedContent] = useState(() => {
    try { return localStorage.getItem('fainens.sidebar.compact') !== 'true'; } catch { return true; }
  });
  const transitionTimer = useRef<number | null>(null);
  const updateSidebar = (nextCompact: boolean) => {
    if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
    try { localStorage.setItem('fainens.sidebar.compact', String(nextCompact)); } catch { /* Storage is optional. */ }
    if (nextCompact) {
      setShowExpandedContent(false);
      setCompact(true);
      return;
    }
    setCompact(false);
    transitionTimer.current = window.setTimeout(() => {
      setShowExpandedContent(true);
      transitionTimer.current = null;
    }, 170);
  };
  useEffect(() => () => {
    if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
  }, []);
  const compactContent = compact || !showExpandedContent;
  return (
    <aside className={`finance-sidebar hidden md:flex ${compact ? 'is-compact' : ''}`}>
      <div className="finance-brand">
        <Link to="/" className="finance-wordmark" aria-label={compact ? 'Expand sidebar' : undefined} title={compact ? 'Expand sidebar' : undefined} onClick={event => {
          if (!compact) return;
          event.preventDefault();
          updateSidebar(false);
        }}><span className="finance-brand-mark">f</span><PanelLeftOpen className="finance-wordmark-expand" aria-hidden="true" />{showExpandedContent && <span className="finance-wordmark-label">Fainens</span>}</Link>
        <button type="button" className="finance-collapse" aria-label="Collapse sidebar" title="Collapse sidebar" aria-expanded={!compact} onClick={() => {
          updateSidebar(true);
        }}><PanelLeftClose /></button>
      </div>
      <div className="finance-action"><AddTransactionLink compact={compactContent} /></div>
      <NavigationLinks compact={compactContent} />
      <div className="finance-footer"><BalanceVisibilityToggle showLabel={!compactContent} className={`mb-2 w-full ${compactContent ? 'px-0' : 'justify-start'}`} /><ProfileMenu compact={compactContent} showDevAuthStatus={isDemoMode} /></div>
    </aside>
  );
}
