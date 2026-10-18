import { lazy, Suspense } from 'react';

// Dev-only, and loaded on demand so it never ships in the production bundle.
const LazyRouterDevtools = import.meta.env.DEV
  ? lazy(() => import('@tanstack/router-devtools').then((module) => ({ default: module.TanStackRouterDevtools })))
  : null;

export function TanStackRouterDevtools() {
  return LazyRouterDevtools ? <Suspense fallback={null}><LazyRouterDevtools /></Suspense> : null;
}
