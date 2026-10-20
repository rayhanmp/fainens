import { lazy, Suspense, useState } from 'react';
import { ArrowUpRight, Play, Sparkles } from 'lucide-react';
import { useRecapArchive } from '../recaps/queries';
import { periodDateRange } from '../recaps/dates';
import '../recaps/dashboard-recap.css';

/**
 * Your own recap, played right here: the Dashboard’s “The Period Edit” card opens the real recap
 * player for your latest finished period (or the current one). Playing it is the same as opening it
 * from the Dashboard; nothing else happens until you press play.
 */

// Loaded only when you press play, as on the Dashboard.
const RecapExperience = lazy(() => import('../recaps/RecapExperience').then((module) => ({ default: module.RecapExperience })));

export function RecapPlayerDemo() {
  const archive = useRecapArchive();
  const [playing, setPlaying] = useState(false);
  const periods = archive.data ?? [];
  const period = periods.find((item) => !item.isPartial) ?? periods[0];

  return (
    <figure className="not-prose my-6">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] p-3 sm:p-5">
        {playing && period ? (
          <Suspense fallback={<div className="grid h-[32rem] place-items-center" role="status" aria-label="Loading your recap"><Sparkles size={28} className="animate-pulse text-[var(--color-accent)]" /></div>}>
            <div className="flex justify-center"><RecapExperience initialPeriodId={period.id} onClose={() => setPlaying(false)} /></div>
          </Suspense>
        ) : period ? (
          <section className="dashboard-recap dashboard-recap-0" aria-label="Recap">
            <button type="button" className="dashboard-recap-open" onClick={() => setPlaying(true)} aria-label={`Play your ${period.name} recap`}>
              <span className="dashboard-recap-art" aria-hidden="true"><i /><i /><i /><b>✳</b></span>
              <span className="dashboard-recap-label"><Sparkles size={13} /> THE PERIOD EDIT <span>{period.name} · {periodDateRange(period)}</span></span>
              <span className="dashboard-recap-copy"><strong>A little rewind. A fresh perspective.</strong><span>{`Your ${period.name} story is ready when you are.`}</span></span>
              <span className="dashboard-recap-cta"><span><Play size={13} fill="currentColor" /> Play it here</span><ArrowUpRight size={20} /></span>
            </button>
          </section>
        ) : (
          <p className="py-10 text-center text-sm text-[var(--ref-on-surface-variant)]">{archive.isPending ? 'Loading your recaps…' : 'Your first recap appears once you’ve recorded a period.'}</p>
        )}
      </div>
      <figcaption className="mt-2 text-center text-xs text-[var(--ref-on-surface-variant)]">The real recap of your own {period?.isPartial ? 'current' : 'latest'} period. It plays exactly as it does from the Dashboard.</figcaption>
    </figure>
  );
}
