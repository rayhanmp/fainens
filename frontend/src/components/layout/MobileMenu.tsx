import { Link, useLocation } from '@tanstack/react-router';
import {
  LayoutDashboard,
  Wallet,
  Receipt,
  CreditCard,
  Users,
  Tag,
  Banknote,
  PiggyBank,
  Sparkles,
  Repeat,
  BarChart3,
  Shield,
  Calculator,
  X,
  Settings,
  LogOut,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../lib/auth';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/accounts', label: 'Accounts', icon: Wallet },
  { to: '/transactions', label: 'Transactions', icon: Receipt },
  { to: '/paylater', label: 'Pay Later', icon: CreditCard },
  { to: '/loans', label: 'Loans', icon: Users },
  { to: '/categories', label: 'Categories', icon: Tag },
  { to: '/salary-income', label: 'Salary & Income', icon: Banknote },
  { to: '/budget', label: 'Budget', icon: PiggyBank },
  { to: '/wishlist', label: 'Wishlist', icon: Sparkles },
  { to: '/subscriptions', label: 'Subscriptions', icon: Repeat },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/savings-simulator', label: 'Savings Simulator', icon: Calculator },
] as const;

const bottomItems = [
  { to: '/audit-log', label: 'Security Audit', icon: Shield },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;

function isNavActive(pathname: string, to: string) {
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(`${to}/`);
}

interface MobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MobileMenu({ isOpen, onClose }: MobileMenuProps) {
  const location = useLocation();
  const { logout } = useAuth();

  const handleLinkClick = () => onClose();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div
        className="absolute inset-0 bg-black/50 transition-opacity"
        onClick={onClose}
      />
      <div className="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-[var(--color-surface)] shadow-xl flex flex-col slide-in-from-left">
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Menu</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3">
          <ul className="space-y-1">
            {navItems.map(({ to, label, icon: Icon }) => {
              const active = isNavActive(location.pathname, to);
              return (
                <li key={to}>
                  <Link
                    to={to}
                    onClick={handleLinkClick}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                      active
                        ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                        : 'text-[var(--color-text-secondary)] hover:bg-[var(--ref-surface-container)] hover:text-[var(--color-text-primary)]'
                    )}
                  >
                    <Icon className="w-5 h-5 shrink-0" />
                    <span>{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="my-4 h-px bg-[var(--color-border)]" />

          <ul className="space-y-1">
            {bottomItems.map(({ to, label, icon: Icon }) => {
              const active = isNavActive(location.pathname, to);
              return (
                <li key={to}>
                  <Link
                    to={to}
                    onClick={handleLinkClick}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                      active
                        ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                        : 'text-[var(--color-text-secondary)] hover:bg-[var(--ref-surface-container)] hover:text-[var(--color-text-primary)]'
                    )}
                  >
                    <Icon className="w-5 h-5 shrink-0" />
                    <span>{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="p-3 border-t border-[var(--color-border)]">
          <button
            type="button"
            onClick={() => {
              if (confirm('Are you sure you want to sign out?')) {
                logout();
              }
            }}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 transition-colors cursor-pointer"
          >
            <LogOut className="w-5 h-5" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}
