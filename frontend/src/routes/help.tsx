import { Outlet, createFileRoute, useParams } from '@tanstack/react-router';
import { PageContainer } from '../components/ui/PageContainer';
import { RequireAuth } from '../lib/auth';
import { DocsSidebar } from '../features/help/DocViews';
import { HelpPersonalProvider } from '../features/help/HelpPersonalProvider';

export const Route = createFileRoute('/help')({
  component: HelpLayout,
});

/**
 * The help docs frame: the open page starts at the left like every other page, with the topic
 * list in a column on the right on wide screens; phones show one at a time.
 */
function HelpLayout() {
  const { slug } = useParams({ strict: false }) as { slug?: string };
  return (
    <RequireAuth>
      <HelpPersonalProvider>
      <PageContainer>
        <div className="lg:grid lg:grid-cols-[minmax(0,48rem)_15.5rem] lg:gap-12">
          <div className="min-w-0">
            <Outlet />
          </div>
          <aside className="hidden lg:block lg:border-l lg:border-[var(--color-border)] lg:pl-6">
            <DocsSidebar activeSlug={slug} />
          </aside>
        </div>
      </PageContainer>
      </HelpPersonalProvider>
    </RequireAuth>
  );
}
