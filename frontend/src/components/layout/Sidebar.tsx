import { Link, useLocation } from '@tanstack/react-router';
import { Plus, PanelLeftClose, PanelLeftOpen, ChevronUp, Settings, LogOut, Shield, CircleHelp } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useAgentProfileQuery } from '../../features/agent/queries';
import { useUiStore } from '../../stores/ui-store';
import { useConfirm } from '../ui/ConfirmDialog';
import { navigationGroups, navigationActive, pathMatches } from './navigation';

export function NavigationLinks({ compact = false, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const { pathname } = useLocation();
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
                  className={`finance-nav-link ${navigationActive(pathname, to) ? 'is-active' : ''}`}>
                  <Icon aria-hidden="true" />{!compact && <span>{label}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function ProfileMenu({ compact = false, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  const profileQuery = useAgentProfileQuery();
  const { confirm } = useConfirm();
  const openSettings = useUiStore((state) => state.openSettings);
  const { pathname } = useLocation();
  const name = profileQuery.data?.nickname || user?.email?.split('@')[0] || 'Your account';
  return (
    <details className="finance-profile" onKeyDown={event => {
      if (event.key === 'Escape') {
        event.currentTarget.open = false;
        event.currentTarget.querySelector('summary')?.focus();
      }
    }}>
      <summary title={compact ? 'Profile & settings' : undefined} aria-label={compact ? 'Profile & settings' : undefined}>
        <span className="finance-avatar">{name.slice(0, 2).toUpperCase()}</span>
        {!compact && <><span className="finance-profile-name"><strong>{name}</strong><small>Profile & settings</small></span><ChevronUp className="h-4 w-4 shrink-0" /></>}
      </summary>
      <div className="finance-profile-popover">
        <button type="button" onClick={() => { onNavigate?.(); openSettings(); }} className="finance-nav-link"><Settings />Settings</button>
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
      <NavigationLinks compact={compact} />
      <div className="finance-footer"><ProfileMenu compact={compact} /></div>
    </aside>
  );
}
