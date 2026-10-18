import { useEffect, useState } from 'react';
import { useRouterState } from '@tanstack/react-router';

/** Navigations that settle faster than this never show the bar, so quick page switches do not flicker. */
const SHOW_DELAY_MS = 120;

type Phase = 'idle' | 'loading' | 'done';

/** A thin bar along the top edge while a route is loading. */
export function RouteProgress() {
  const pending = useRouterState({ select: (state) => state.status === 'pending' || state.isLoading });
  const [phase, setPhase] = useState<Phase>('idle');

  useEffect(() => {
    if (pending) {
      const timer = window.setTimeout(() => setPhase('loading'), SHOW_DELAY_MS);
      return () => window.clearTimeout(timer);
    }
    // Finish the bar, then fade it out.
    setPhase((current) => (current === 'loading' ? 'done' : current));
    const timer = window.setTimeout(() => setPhase('idle'), 320);
    return () => window.clearTimeout(timer);
  }, [pending]);

  if (phase === 'idle') return null;
  return <div className="route-progress" data-phase={phase} role="progressbar" aria-label="Loading page" aria-busy={phase === 'loading'} />;
}
