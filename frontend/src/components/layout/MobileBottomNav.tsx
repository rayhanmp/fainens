import { Link, useLocation } from '@tanstack/react-router';
import {
  House,
  Receipt,
  Sparkles,
  Menu,
  Plus,
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/utils';
import { MobileMenu } from './MobileMenu';
import { navigationActive } from './navigation';
import { useUiStore } from '../../stores/ui-store';

/** Primary mobile navigation — desktop uses the sidebar. */
const items = [
  { to: '/', label: 'Home', icon: House },
  { to: '/transactions', label: 'Activity', icon: Receipt },
] as const;



export function MobileBottomNav() {
  const location = useLocation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const openTransactionComposer = useUiStore((state) => state.openTransactionComposer);
  const search = location.search as Record<string, unknown>;
  const contextualPrefill = {
    accountId: typeof search.accountId === 'string' && Number.isSafeInteger(Number(search.accountId)) ? Number(search.accountId) : undefined,
    categoryId: typeof search.categoryId === 'string' && Number.isSafeInteger(Number(search.categoryId)) ? Number(search.categoryId) : undefined,
    periodId: typeof search.periodId === 'string' && Number.isSafeInteger(Number(search.periodId)) ? Number(search.periodId) : undefined,
  };

  return (
    <>
      <nav
        className="finance-glass-dock md:hidden fixed z-40"
        aria-label="Main navigation"
      >
        <ul className="flex items-stretch justify-around max-w-lg mx-auto">
          {items.map(({ to, label, icon: Icon }) => {
            const active = navigationActive(location.pathname, to);
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
              onClick={() => openTransactionComposer(contextualPrefill)}
              aria-label="Add transaction"
              className="group flex h-full flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-bold text-[var(--color-accent)]"
            >
              <span className="-mt-5 grid h-12 w-12 place-items-center rounded-2xl bg-[var(--color-accent)] text-white shadow-lg ring-4 ring-[var(--color-surface)] transition-transform group-active:scale-95"><Plus className="h-6 w-6" strokeWidth={2.5} /></span>
              <span>Add</span>
            </button>
          </li>
          <li className="flex-1 min-w-0">
            <Link
              to="/agent"
              className={cn(
                'flex h-full flex-col items-center justify-center gap-0.5 py-3 px-1 text-[10px] font-medium transition-colors',
                navigationActive(location.pathname, '/agent') ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)]',
              )}
            >
              <Sparkles className="h-6 w-6" strokeWidth={navigationActive(location.pathname, '/agent') ? 2.5 : 2} />
              <span>Agent</span>
            </Link>
          </li>
          <li className="flex-1 min-w-0">
            <button
              type="button"
              onClick={() => {

                setIsMenuOpen(true);
              }}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 py-3 px-1 text-[10px] font-medium transition-colors w-full h-full cursor-pointer',
                isMenuOpen || !['/', '/transactions', '/agent'].some((path) => navigationActive(location.pathname, path))
                  ? 'text-[var(--color-accent)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
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
