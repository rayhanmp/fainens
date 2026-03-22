import { Link, useLocation } from '@tanstack/react-router';
import {
  LayoutDashboard,
  Wallet,
  Receipt,
  Tag,
  PiggyBank,
  CreditCard,
  BarChart3,
  Shield,
  Settings,
  LogOut,
  Banknote,
  Repeat,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { useAuth } from '../../lib/auth';
import { cn } from '../../lib/utils';

function pathMatches(pathname: string, to: string) {
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(`${to}/`);
}

type NavIcon = ComponentType<{ className?: string }>;

type NavItem = { to: string; label: string; icon: NavIcon };

/** With Dashboard above: accounts, transactions, pay later */
const topNav: NavItem[] = [
  { to: '/accounts', label: 'Accounts', icon: Wallet },
  { to: '/transactions', label: 'Transactions', icon: Receipt },
  { to: '/paylater', label: 'Pay later', icon: CreditCard },
];

/** Everything after the divider */
const restNav: NavItem[] = [
  { to: '/categories', label: 'Categories', icon: Tag },
  { to: '/salary-income', label: 'Salary & income', icon: Banknote },
  { to: '/budget', label: 'Budget', icon: PiggyBank },
  { to: '/subscriptions', label: 'Subscriptions', icon: Repeat },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
];

export function Sidebar() {
  const location = useLocation();
  const { logout } = useAuth();

  const isActive = (to: string) =>
    to === '/' ? location.pathname === '/' : pathMatches(location.pathname, to);

  const renderLink = (item: NavItem) => {
    const active = isActive(item.to);
    const Icon = item.icon;
    return (
      <li key={item.to}>
        <Link
          to={item.to}
          aria-current={active ? 'page' : undefined}
          className={cn('sidebar-item flex items-center gap-3', active && 'sidebar-item--active')}
        >
          <Icon className="w-5 h-5 shrink-0" />
          <span>{item.label}</span>
        </Link>
      </li>
    );
  };

  const auditActive = isActive('/audit-log');
  const settingsActive = isActive('/settings');

  return (
    <aside className="sidebar hidden md:flex md:flex-col w-64 h-[100dvh] max-h-[100dvh] shrink-0 sticky top-0">
      <div className="shrink-0 p-6 border-b border-[var(--color-border)]">
        <h1 className="text-xl font-semibold tracking-tight text-[var(--color-text-primary)]">
          Fainens
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">Personal finance</p>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto py-4 px-3">
        <ul className="space-y-0.5">
          <li>
            <Link
              to="/"
              aria-current={location.pathname === '/' ? 'page' : undefined}
              className={cn(
                'sidebar-item flex items-center gap-3',
                location.pathname === '/' && 'sidebar-item--active',
              )}
            >
              <LayoutDashboard className="w-5 h-5 shrink-0" />
              <span>Dashboard</span>
            </Link>
          </li>

          {topNav.map(renderLink)}

          <li className="py-3 px-1" aria-hidden>
            <div className="h-px bg-[var(--color-border)]" />
          </li>

          {restNav.map(renderLink)}
        </ul>
      </nav>

      <div className="shrink-0 border-t border-[var(--color-border)] p-4">
        <div className="flex w-full gap-2">
          <Link
            to="/audit-log"
            title="Security audit"
            aria-label="Security audit"
            aria-current={auditActive ? 'page' : undefined}
            className={cn(
              'sidebar-footer-icon flex-1 min-h-10',
              auditActive && 'sidebar-footer-icon--active',
            )}
          >
            <Shield className="w-5 h-5" />
          </Link>
          <Link
            to="/settings"
            title="Settings"
            aria-label="Settings"
            aria-current={settingsActive ? 'page' : undefined}
            className={cn(
              'sidebar-footer-icon flex-1 min-h-10',
              settingsActive && 'sidebar-footer-icon--active',
            )}
          >
            <Settings className="w-5 h-5" />
          </Link>
          <button
            type="button"
            onClick={logout}
            title="Sign out"
            aria-label="Sign out"
            className="sidebar-footer-icon sidebar-footer-icon--button flex-1 min-h-10"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
