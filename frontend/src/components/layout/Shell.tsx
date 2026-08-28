import { Outlet, useNavigate } from '@tanstack/react-router';
import { Sidebar } from './Sidebar';
import { MobileBottomNav } from './MobileBottomNav';
import { useAuth } from '../../lib/auth';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';

interface ShellProps {
  children?: React.ReactNode;
}

export function Shell({ children }: ShellProps) {
  const { isDemoMode } = useAuth();
  const navigate = useNavigate();

  // Global keyboard shortcuts
  useKeyboardShortcuts({
    onNewTransaction: () => {
      navigate({ to: '/transactions', search: { action: 'new' } });
    },
  });

  return (
    <div className="flex min-h-screen min-h-[100dvh] items-start">
      <Sidebar />
      <main className="flex-1 min-h-screen min-h-[100dvh] p-4 sm:p-6 lg:p-8 overflow-auto pb-24 md:pb-8 pt-[calc(1rem+env(safe-area-inset-top))] sm:pt-[calc(1.5rem+env(safe-area-inset-top))] lg:pt-[calc(2rem+env(safe-area-inset-top))]">
        {isDemoMode && (
          <div className="mb-4 flex items-center gap-2 rounded-full border border-[var(--ref-outline-variant)]/30 bg-[var(--ref-surface-container-lowest)] px-3 py-2 text-[var(--ref-on-surface-variant)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--ref-secondary)]" aria-hidden />
            <p className="text-xs font-medium">
              Local preview access · sign-in bypassed for development
            </p>
          </div>
        )}
        {children || <Outlet />}
      </main>
      <MobileBottomNav />
    </div>
  );
}
