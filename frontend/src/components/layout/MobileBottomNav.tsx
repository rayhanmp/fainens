import { Link, useLocation } from '@tanstack/react-router';
import {
  LayoutDashboard,
  Receipt,
  Wallet,
  PiggyBank,
  Menu,
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/utils';
import { MobileMenu } from './MobileMenu';

/** Primary mobile navigation — desktop uses the sidebar. */
const items = [
  { to: '/', label: 'Home', icon: LayoutDashboard },
  { to: '/transactions', label: 'Activity', icon: Receipt },
  { to: '/accounts', label: 'Wallets', icon: Wallet },
  { to: '/budget', label: 'Budget', icon: PiggyBank },
] as const;

function isNavActive(pathname: string, to: string) {
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function MobileBottomNav() {
  const location = useLocation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <>
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]"
        aria-label="Main navigation"
      >
        <ul className="flex items-stretch justify-around max-w-lg mx-auto">
          {items.map(({ to, label, icon: Icon }) => {
            const active = isNavActive(location.pathname, to);
            return (
              <li key={to} className="flex-1 min-w-0">
                <Link
                  to={to}
                  className={cn(
                    'flex flex-col items-center justify-center gap-0.5 py-3 px-1 text-[10px] font-medium transition-colors',
                    active
                      ? 'text-[var(--color-accent)]'
                      : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
                  )}
                >
                  <Icon className="w-6 h-6" strokeWidth={active ? 2.5 : 2} />
                  <span className="truncate max-w-full">{label}</span>
                </Link>
              </li>
            );
          })}
          <li className="flex-1 min-w-0">
            <button
              type="button"
              onClick={() => {
                console.log('Menu button clicked');
                setIsMenuOpen(true);
              }}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 py-3 px-1 text-[10px] font-medium transition-colors w-full h-full cursor-pointer',
                'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
              )}
            >
              <Menu className="w-6 h-6" />
              <span className="truncate max-w-full">More</span>
            </button>
          </li>
        </ul>
      </nav>
      <MobileMenu isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} />
    </>
  );
}
