import { Outlet, createFileRoute, useParams } from '@tanstack/react-router';
import { PageContainer } from '../components/ui/PageContainer';
import { RequireAuth } from '../lib/auth';
import { DocsSidebar } from '../features/help/DocViews';
import { HelpPersonalProvider } from '../features/help/HelpPersonalProvider';

export const Route = createFileRoute('/help')({
  component: HelpLayout,
});

/** The help docs frame: a topic sidebar beside the open page on wide screens; phones show one at a time. */
function HelpLayout() {
  const { slug } = useParams({ strict: false }) as { slug?: string };
  return (
    <RequireAuth>
      <HelpPersonalProvider>
      <PageContainer>
        <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12">
          <aside className="hidden lg:block">
            <DocsSidebar activeSlug={slug} />
          </aside>
          <div className="min-w-0">
            <Outlet />
          </div>
        </div>
      </PageContainer>
      </HelpPersonalProvider>
    </RequireAuth>
  );
}
