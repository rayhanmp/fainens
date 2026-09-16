import { useEffect, useRef } from 'react';
import { Outlet } from '@tanstack/react-router';
import { Sidebar } from './Sidebar';
import { AreaNavigation } from './AreaNavigation';
import { MobileBottomNav } from './MobileBottomNav';
import { ConnectivityStatus } from './ConnectivityStatus';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useUiStore } from '../../stores/ui-store';
import { GlobalTransactionComposer } from '../transactions/GlobalTransactionComposer';
import { SettingsPage } from '../../routes/settings';
import { ConfirmProvider } from '../ui/ConfirmDialog';
import { useToast } from '../ui/Toast';
import { usePendingTransactionsQuery } from '../../features/transactions/queries';

interface ShellProps {
  children?: React.ReactNode;
}

function PendingTransactionNotifier() {
  const pendingQuery = usePendingTransactionsQuery();
  const previousIds = useRef<Set<number> | null>(null);
  const { info, ToastContainer } = useToast();

  useEffect(() => {
    if (!pendingQuery.data) return;
    const currentIds = new Set(pendingQuery.data.map((item) => item.id));
    const previous = previousIds.current;
    if (previous) {
      const newCount = [...currentIds].filter((id) => !previous.has(id)).length;
      if (newCount > 0) {
        info(
          `${newCount} new pending transaction${newCount === 1 ? '' : 's'}`,
          'Review it in Transactions before it is posted.',
        );
      }
    }
    previousIds.current = currentIds;
  }, [info, pendingQuery.data]);

  return <ToastContainer />;
}

export function Shell({ children }: ShellProps) {
  const openTransactionComposer = useUiStore((state) => state.openTransactionComposer);
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const closeSettings = useUiStore((state) => state.closeSettings);

  // Global keyboard shortcuts
  useKeyboardShortcuts({
    onNewTransaction: () => {
      openTransactionComposer();
    },
  });

  return (
    <ConfirmProvider>
    <div className="flex min-h-screen min-h-[100dvh] items-start">
      <ConnectivityStatus />
      <PendingTransactionNotifier />
      <Sidebar />
      <main className="min-w-0 flex-1 min-h-screen min-h-[100dvh] p-4 sm:p-6 lg:p-8 overflow-auto pb-24 md:pb-8 pt-[calc(1rem+env(safe-area-inset-top))] sm:pt-[calc(1.5rem+env(safe-area-inset-top))] lg:pt-[calc(2rem+env(safe-area-inset-top))]">
        <AreaNavigation />{children || <Outlet />}
      </main>
      <MobileBottomNav />
      <GlobalTransactionComposer />
      {settingsOpen && <SettingsPage onClose={closeSettings} />}
    </div>
    </ConfirmProvider>
  );
}
