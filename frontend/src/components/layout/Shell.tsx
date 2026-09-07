import { Outlet } from '@tanstack/react-router';
import { Sidebar } from './Sidebar';
import { AreaNavigation } from './AreaNavigation';
import { MobileBottomNav } from './MobileBottomNav';
import { ConnectivityStatus } from './ConnectivityStatus';
import { useAuth } from '../../lib/auth';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useUiStore } from '../../stores/ui-store';
import { GlobalTransactionComposer } from '../transactions/GlobalTransactionComposer';

interface ShellProps {
  children?: React.ReactNode;
}

export function Shell({ children }: ShellProps) {
  const { isDemoMode } = useAuth();
  const openTransactionComposer = useUiStore((state) => state.openTransactionComposer);

  // Global keyboard shortcuts
  useKeyboardShortcuts({
    onNewTransaction: () => {
      openTransactionComposer();
    },
  });

  return (
    <div className="flex min-h-screen min-h-[100dvh] items-start">
      <ConnectivityStatus />
      <Sidebar />
      <main className="min-w-0 flex-1 min-h-screen min-h-[100dvh] p-4 sm:p-6 lg:p-8 overflow-auto pb-24 md:pb-8 pt-[calc(1rem+env(safe-area-inset-top))] sm:pt-[calc(1.5rem+env(safe-area-inset-top))] lg:pt-[calc(2rem+env(safe-area-inset-top))]">
        {isDemoMode && (
          <div className="pointer-events-none fixed right-4 top-3 z-40 flex items-center gap-1.5 rounded-full border border-[var(--ref-outline-variant)]/25 bg-[var(--ref-surface-container-lowest)]/85 px-2.5 py-1 text-[11px] font-medium text-[var(--ref-on-surface-variant)] shadow-sm backdrop-blur-sm sm:right-6 sm:top-4 lg:right-8 lg:top-5">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--ref-secondary)]" aria-hidden />
            <p>
              Local preview access · sign-in bypassed for development
            </p>
          </div>
        )}
        <AreaNavigation />{children || <Outlet />}
      </main>
      <MobileBottomNav />
      <GlobalTransactionComposer />
    </div>
  );
}
