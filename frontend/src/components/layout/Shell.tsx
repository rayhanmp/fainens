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
      <main className="flex-1 min-h-screen min-h-[100dvh] p-4 sm:p-6 lg:p-8 overflow-auto pb-24 md:pb-8">
        {isDemoMode && (
          <div className="mb-4 p-3 rounded-lg bg-[var(--color-warning)]/15 border border-[var(--color-warning)]/50 text-[var(--color-text-primary)]">
            <p className="text-sm font-medium">
              Demo mode — data may not persist. Connect the backend for full functionality.
            </p>
          </div>
        )}
        {children || <Outlet />}
      </main>
      <MobileBottomNav />
    </div>
  );
}
