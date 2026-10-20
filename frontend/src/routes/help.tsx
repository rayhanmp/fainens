import { Outlet, createFileRoute } from '@tanstack/react-router';
import { PageContainer } from '../components/ui/PageContainer';
import { RequireAuth } from '../lib/auth';
import { HelpPersonalProvider } from '../features/help/HelpPersonalProvider';

export const Route = createFileRoute('/help')({
  component: HelpLayout,
});

/** The help docs frame: a plain page like the rest of the app; topics live in each page's "All topics" menu. */
function HelpLayout() {
  return (
    <RequireAuth>
      <HelpPersonalProvider>
      <PageContainer>
        <Outlet />
      </PageContainer>
      </HelpPersonalProvider>
    </RequireAuth>
  );
}
