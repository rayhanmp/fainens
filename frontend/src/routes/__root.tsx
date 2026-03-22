import { createRootRoute, Outlet, useLocation } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/router-devtools';
import { AuthProvider, useAuth } from '../lib/auth';
import { Shell } from '../components/layout/Shell';

export const Route = createRootRoute({
  component: () => (
    <AuthProvider>
      <RootContent />
    </AuthProvider>
  ),
});

function RootContent() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  // Show loading state
  if (isLoading) {
    return (
      <div className="min-h-screen min-h-[100dvh] flex items-center justify-center bg-[var(--color-background)]">
        <div className="brutalist-card px-10 py-8">
          <p className="text-base font-medium text-[var(--color-text-secondary)]">Loading…</p>
        </div>
      </div>
    );
  }

  // Standalone full-page routes (no shell)
  if (location.pathname === '/login' || location.pathname === '/onboarding') {
    return (
      <>
        <Outlet />
        {import.meta.env.DEV && <TanStackRouterDevtools />}
      </>
    );
  }

  // For authenticated pages, show the shell layout
  if (isAuthenticated) {
    return (
      <Shell>
        <Outlet />
        {import.meta.env.DEV && <TanStackRouterDevtools />}
      </Shell>
    );
  }

  // Not authenticated and not on login page - show login
  return (
    <>
      <Outlet />
      {import.meta.env.DEV && <TanStackRouterDevtools />}
    </>
  );
}
