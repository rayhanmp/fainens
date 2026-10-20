import { Link, Navigate, createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { DocArticle } from '../features/help/DocViews';
import { DOC_REDIRECTS, DOCS } from '../features/help/docs';

export const Route = createFileRoute('/help/$slug')({
  component: HelpDocPage,
});

function HelpDocPage() {
  const { slug } = Route.useParams();
  const page = DOCS.find((doc) => doc.slug === slug);

  // A new page starts at its top, not at the previous page's scroll position, unless the link
  // points at a section of it.
  useEffect(() => {
    const section = window.location.hash ? document.getElementById(decodeURIComponent(window.location.hash.slice(1))) : null;
    if (section) {
      section.scrollIntoView({ block: 'start' });
      return;
    }
    document.querySelector('main')?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, [slug]);

  const redirect = DOC_REDIRECTS[slug];
  if (redirect) return <Navigate to="/help/$slug" params={{ slug: redirect.slug }} hash={redirect.hash} replace />;

  if (!page) {
    return (
      <div className="py-16 text-center">
        <p className="text-lg font-semibold text-[var(--ref-on-surface)]">That help page doesn’t exist</p>
        <Link to="/help" className="mt-3 inline-block text-sm font-semibold text-[var(--color-accent)] hover:underline">Back to help</Link>
      </div>
    );
  }
  return <DocArticle key={page.slug} page={page} />;
}
