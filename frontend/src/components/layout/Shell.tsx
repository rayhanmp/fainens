import { useEffect, useRef } from 'react';
import { Outlet, useRouterState } from '@tanstack/react-router';
import { Sidebar } from './Sidebar';
import { AreaNavigation } from './AreaNavigation';
import { MobileBottomNav } from './MobileBottomNav';
import { ConnectivityStatus } from './ConnectivityStatus';
import { RouteProgress } from './RouteProgress';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useUiStore } from '../../stores/ui-store';
import { GlobalTransactionComposer } from '../transactions/GlobalTransactionComposer';
import { SettingsPage } from '../../routes/settings';
import { ConfirmProvider } from '../ui/ConfirmDialog';
import { useToast } from '../ui/useToast';
import { usePendingTransactionsQuery } from '../../features/transactions/queries';
import { useAttentionItems } from '../../features/dashboard/use-attention-items';
import { useAttentionReadState } from '../../features/dashboard/use-attention-read-state';
import { useNow } from '../../hooks/useNow';
import { useAuth } from '../../lib/auth';

interface ShellProps {
  children?: React.ReactNode;
}

function PendingTransactionNotifier() {
  const pendingQuery = usePendingTransactionsQuery();
  const previousIds = useRef<Set<number> | null>(null);
  const { info } = useToast();

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

  return null;
}

/**
 * Keeps the bell's unread count in the navigation right on pages other than the Dashboard, where
 * the bell itself sets it. It works out the same items and reads the same read-marks, which the
 * Dashboard saves as they change, so leaving it carries the count over.
 */
function AttentionBadgeCount() {
  const now = useNow();
  const { user } = useAuth();
  const items = useAttentionItems(now);
  const { unread } = useAttentionReadState(items, user?.email);
  const setCount = useUiStore((state) => state.setDashboardNotificationCount);
  useEffect(() => { setCount(unread.length); }, [setCount, unread.length]);
  return null;
}

export function Shell({ children }: ShellProps) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
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
      <RouteProgress />
      <ConnectivityStatus />
      <PendingTransactionNotifier />
      {pathname !== '/' && <AttentionBadgeCount />}
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
