import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { Link } from '@tanstack/react-router';
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ChevronDown, Download, Info, Pause, Play, RefreshCw, Rewind, Sparkles, X } from 'lucide-react';
import { useRecapArchive, useRecapStory, useRegenerateRecap, type SavedRecapStory } from './queries';
import { buildStories, periodDateRange, themeColors, type RecapStory } from './stories';
import { ShareRecap } from './ShareRecap';
import { ChapterVisual } from './ChapterVisuals';
import { enterDelay, nextTransition, OVERLAY_TRANSITIONS, prefersReducedMotion, runVariants, type Opening, type SectionVariants, type Transition } from './motion';
import './recaps.css';

type ExperienceProps = { initialPeriodId?: number; onPeriodChange?: (periodId: number) => void; onClose?: () => void };
const CHAPTER_MS = 9_000;
const EXIT_MS = 700;
const OPENING_MS = 1_500;
const newRun = () => 1 + Math.floor(Math.random() * 2_000_000_000);

export function RecapExperience({ initialPeriodId, onPeriodChange, onClose }: ExperienceProps) {
  const archive = useRecapArchive();
  const [selected, setSelected] = useState(initialPeriodId);
  const periodId = selected ?? archive.data?.[0]?.id;
  const period = archive.data?.find(item => item.id === periodId);
  const edition = useRecapStory(periodId);
  const controls = <>
    <label className="recap-period-pill"><span>{period?.name ?? 'Your periods'}</span><ChevronDown size={12} /><select aria-label="Recap period" value={periodId ?? ''} onChange={event => { setSelected(Number(event.target.value)); onPeriodChange?.(Number(event.target.value)); }}>
      {periodId && !period && <option value={periodId}>Period {periodId}</option>}
      {archive.data?.map(item => <option key={item.id} value={item.id}>{item.name} · {periodDateRange(item)}{item.isPartial ? ' · So far' : ''}</option>)}
    </select></label>
    {onClose && <button className="recap-icon-pill recap-close" onClick={onClose} aria-label="Close recap"><X size={16} /></button>}
  </>;
  const fallbackControls = <div className="recap-overlay-actions">{controls}</div>;
  return <div className="recap-experience">
    {archive.isPending || (periodId && edition.isPending) ? <div className="recap-writing" role="status">{fallbackControls}<div className="recap-writing-orbit" aria-hidden="true"><i /><i /><i /><Sparkles size={30} /></div><h3>Rewinding your period.</h3><p>Putting your edition together.</p></div>
      : archive.isError || edition.isError ? <div className="recap-empty" role="alert">{fallbackControls}<h2>Your story couldn’t load.</h2><p>{edition.error?.message ?? 'Please try again in a moment.'}</p><button className="recap-primary" onClick={() => { void archive.refetch(); if (periodId) void edition.refetch(); }}><RefreshCw size={16} />Try again</button></div>
      : !periodId || !edition.data ? <div className="recap-empty">{fallbackControls}<Sparkles size={34} /><h2>Your next chapter starts here.</h2><p>Record income or expenses to bring your period story to life.</p><Link to="/transactions" className="recap-primary">Review transactions <ArrowRight size={16} /></Link></div>
      : edition.data.snapshot.activityCount === 0 ? <EmptyRecapEdition periodId={periodId} controls={fallbackControls} />
      : <RecapViewer key={`${periodId}:${edition.data.savedAt}`} edition={edition.data} controls={controls} />}
  </div>;
}

function EmptyRecapEdition({ periodId, controls }: { periodId: number; controls: ReactNode }) {
  const regenerate = useRegenerateRecap(periodId);
  return <div className="recap-empty">{controls}<Sparkles size={34} /><h2>A quiet page in the story.</h2><p>No income or expenses were recorded when this edition was saved. Refresh it to include newer records.</p>
    <button className="recap-primary" disabled={regenerate.isPending} onClick={() => regenerate.mutate()}><RefreshCw size={16} />{regenerate.isPending ? 'Refreshing…' : 'Refresh this period'}</button>
    {regenerate.isError && <p role="alert">{regenerate.error.message}</p>}
  </div>;
}

type Nav = { index: number; visit: number; direction: 'next' | 'prev'; transition: Transition; origin: { x: number; y: number } };
type Leaving = { story: RecapStory; visit: number; direction: Nav['direction']; transition: Transition };

function RecapViewer({ edition, controls }: { edition: SavedRecapStory; controls: ReactNode }) {
  const { maskAmounts } = useBalanceVisibility();
  const recap = edition.snapshot;
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);
  // Each viewing rolls its own dice: copy, lead facts, bonus chapters, order, colours and motion.
  const [run, setRun] = useState(newRun);
  const variants = useMemo(() => runVariants(run), [run]);
  const stories = useMemo(() => buildStories(recap, edition, run).map(story => ({ ...story, title: maskAmounts(story.title), body: maskAmounts(story.body) })), [recap, edition, run, maskAmounts]);
  const [nav, setNav] = useState<Nav>({ index: 0, visit: 0, direction: 'next', transition: 'slide', origin: { x: 50, y: 55 } });
  const [leaving, setLeaving] = useState<Leaving | null>(null);
  const [opening, setOpening] = useState<Opening | null>(() => reducedMotion ? null : variants.opening);
  const [shareOpen, setShareOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const slideRef = useRef<HTMLDivElement>(null);
  const autoplayClock = useRef({ chapter: '', remaining: CHAPTER_MS });
  const [progressReadyVisit, setProgressReadyVisit] = useState<number | null>(null);
  const [pageHidden, setPageHidden] = useState(() => document.hidden);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const regenerate = useRegenerateRecap(recap.period.id);
  const index = Math.min(nav.index, stories.length - 1);
  const story = stories[index];
  const last = index === stories.length - 1;
  const chapterCount = stories.length;

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLeaving(null), EXIT_MS);
    return () => clearTimeout(timer);
  }, [leaving]);
  useEffect(() => {
    if (!opening) return;
    const timer = setTimeout(() => setOpening(null), OPENING_MS);
    return () => clearTimeout(timer);
  }, [opening]);

  const go = (target: number, options: { origin?: Nav['origin']; transition?: Transition } = {}) => {
    const next = Math.max(0, Math.min(stories.length - 1, target));
    if (next === index && !options.transition) return;
    const transition = reducedMotion ? 'slide' : options.transition ?? nextTransition(run, nav.visit + 1, nav.transition);
    if (!reducedMotion) setLeaving({ story, visit: nav.visit, direction: nav.direction, transition });
    setNav({ index: next, visit: nav.visit + 1, direction: next >= index ? 'next' : 'prev', transition, origin: options.origin ?? { x: next >= index ? 82 : 18, y: 92 } });
  };
  // A replay rewinds to the cover with fresh dice, so the second viewing differs from the first.
  const replay = () => {
    const fresh = newRun();
    if (!reducedMotion) setLeaving({ story, visit: nav.visit, direction: 'prev', transition: 'rewind' });
    setRun(fresh);
    setNav({ index: 0, visit: nav.visit + 1, direction: 'prev', transition: 'rewind', origin: { x: 50, y: 50 } });
  };
  // Autoplay moves on with whatever `go` is current when its timer fires.
  const advance = useRef(() => {});
  useEffect(() => { advance.current = () => go(index + 1); });
  const originOf = (event: MouseEvent<HTMLElement>) => {
    const bounds = slideRef.current?.getBoundingClientRect();
    return bounds ? { x: (event.clientX - bounds.left) / bounds.width * 100, y: (event.clientY - bounds.top) / bounds.height * 100 } : undefined;
  };

  useEffect(() => {
    const visitId = nav.visit;
    if (autoplayClock.current.chapter !== `${nav.visit}`) {
      autoplayClock.current = { chapter: `${nav.visit}`, remaining: CHAPTER_MS };
    }
    if (last || paused || shareOpen || infoOpen || regenerate.isPending) return;
    const clock = autoplayClock.current;
    let cancelled = false;
    let introFinished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let startedAt: number | undefined;
    const stopTimer = () => {
      clearTimeout(timer);
      timer = undefined;
      if (startedAt !== undefined) clock.remaining = Math.max(0, clock.remaining - (performance.now() - startedAt));
      startedAt = undefined;
    };
    const startTimer = () => {
      if (cancelled || !introFinished || document.hidden || timer !== undefined) return;
      startedAt = performance.now();
      timer = setTimeout(() => advance.current(), clock.remaining);
    };
    const onVisibilityChange = () => {
      setPageHidden(document.hidden);
      if (document.hidden) stopTimer(); else startTimer();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    // Start the clock once the chapter has fully arrived: the opening, the wipe, words, counters and visuals.
    const reveals = slideRef.current?.getAnimations({ subtree: true }).filter(animation => {
      const target = (animation.effect as KeyframeEffect | null)?.target;
      return !(target instanceof Element && target.closest('.recap-progress, .recap-backdrop, .recap-leaving, .recap-burst'))
        && Number.isFinite(Number(animation.effect?.getComputedTiming().endTime));
    }) ?? [];
    void Promise.allSettled(reveals.map(animation => animation.finished)).then(() => {
      if (cancelled) return;
      introFinished = true;
      setProgressReadyVisit(visitId);
      startTimer();
    });
    return () => {
      cancelled = true;
      stopTimer();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [nav.visit, chapterCount, last, paused, shareOpen, infoOpen, regenerate.isPending]);

  const overlay = OVERLAY_TRANSITIONS.has(nav.transition) && nav.visit > 0 && !reducedMotion;
  const paper = themeColors[story.theme].paper;
  const entering = nav.visit === 0 ? (opening ? 1050 : 120) : enterDelay(nav.transition);
  return <section className="recap-viewer" aria-label={`${recap.period.name} recap`}>
    <div ref={slideRef} className={`recap-story recap-theme-${story.theme} recap-chapter-${story.id}${opening ? ' is-opening' : ''}`} tabIndex={0} aria-label="Period story. Use left and right arrow keys to navigate, space to pause."
      style={{ '--ox': `${nav.origin.x}%`, '--oy': `${nav.origin.y}%` } as CSSProperties}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'ArrowRight') { event.preventDefault(); if (last) replay(); else go(index + 1); }
        if (event.key === 'ArrowLeft') { event.preventDefault(); go(index - 1); }
        if (event.key === 'Home') { event.preventDefault(); go(0); }
        if (event.key === 'End') { event.preventDefault(); go(stories.length - 1); }
        if (event.key === ' ') { event.preventDefault(); setPaused(value => !value); }
      }}
      onClick={event => {
        if ((event.target as HTMLElement).closest('button, a, select, label, summary, details')) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        go(index + (event.clientX - bounds.left < bounds.width * .35 ? -1 : 1), { origin: originOf(event) });
      }}
      onTouchStart={event => { touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; }}
      onTouchCancel={() => { touchStart.current = null; }}
      onTouchEnd={event => {
        const start = touchStart.current; touchStart.current = null; if (!start) return;
        const dx = event.changedTouches[0].clientX - start.x; const dy = event.changedTouches[0].clientY - start.y;
        if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) go(index + (dx < 0 ? 1 : -1));
      }}>
      <div className="recap-overlay-actions">{controls}<button className="recap-icon-pill" disabled={regenerate.isPending} onClick={() => regenerate.mutate()} aria-label="New take" title="Rewrite the story and refresh its figures"><RefreshCw size={15} className={regenerate.isPending ? 'recap-spin' : ''} /></button><button className="recap-icon-pill" onClick={() => setShareOpen(true)} aria-label="Share recap"><Download size={15} /></button></div>
      {regenerate.isError && <p className="recap-inline-error" role="alert">{regenerate.error.message}</p>}
      <div className="recap-progress" aria-label="Story chapters">{stories.map((item, i) => {
        const active = i === index && !last;
        const seen = i < index || (last && i === index);
        const running = active && progressReadyVisit === nav.visit
          && !paused && !pageHidden && !shareOpen && !infoOpen && !regenerate.isPending;
        return <button key={item.id} aria-label={`Chapter ${i + 1}: ${item.eyebrow}`} aria-current={i === index ? 'step' : undefined}
          className={[seen && 'is-seen', active && 'is-active', running && 'is-running'].filter(Boolean).join(' ')}
          onClick={event => go(i, { origin: originOf(event) })}>{active && <span className="recap-progress-fill" style={{ animationDuration: `${CHAPTER_MS}ms` }} aria-hidden="true" />}</button>;
      })}</div>
      <div className="recap-story-brand"><span>fainens<span className="recap-brand-dot" aria-hidden="true">✳</span></span><span>{recap.isPartial ? 'Your period so far' : 'The period edit'}</span></div>
      <ChapterBackdrop key={`${nav.visit}-backdrop`} chapter={story.id} seed={edition.seed + run} />
      {/* The next chapter's colour washes over the card, between the leaving and arriving content. */}
      {overlay && <div key={`wipe-${nav.visit}`} className={`recap-wipe recap-wipe-${nav.transition} recap-dir-${nav.direction}`} style={{ '--wipe': paper } as CSSProperties} aria-hidden="true">
        {nav.transition === 'blinds' && Array.from({ length: 7 }, (_, i) => <i key={i} style={{ '--b': i } as CSSProperties} />)}
        {nav.transition === 'rewind' && <Rewind className="recap-rewind-icon" />}
      </div>}
      <div className="recap-stage">
        {leaving && leaving.visit !== nav.visit && <ChapterContent key={`c${leaving.visit}`} story={leaving.story} className={`recap-leaving recap-out-${leaving.transition} recap-dir-${nav.direction}`}
          periodId={recap.period.id} variants={variants} run={run} onShare={() => setShareOpen(true)} />}
        <ChapterContent key={`c${nav.visit}`} story={story} live className={`recap-arriving recap-in-${nav.visit === 0 ? 'first' : nav.transition} recap-dir-${nav.direction} recap-intro-${variants.intro}`}
          style={{ '--enter': `${entering}ms` } as CSSProperties} periodId={recap.period.id} variants={variants} run={run} onShare={() => setShareOpen(true)} />
      </div>
      {opening && <OpeningTitles variant={opening} name={recap.period.name} paper={paper} />}
      <div className="recap-bottom-actions">
        <button className="recap-icon-pill" onClick={event => go(index - 1, { origin: originOf(event) })} disabled={index === 0} aria-label="Previous chapter"><ArrowLeft size={16} /></button>
        <span>{String(index + 1).padStart(2, '0')} / {String(stories.length).padStart(2, '0')}</span>
        {!last && <button className="recap-icon-pill" onClick={() => setPaused(value => !value)} aria-label={paused ? 'Resume autoplay' : 'Pause autoplay'} aria-pressed={paused} title={paused ? 'Resume autoplay' : 'Moves on by itself after each chapter arrives'}>{paused ? <Play size={14} /> : <Pause size={14} />}</button>}
        <details className="recap-info" onToggle={event => setInfoOpen(event.currentTarget.open)}><summary aria-label="About this edition"><Info size={14} /></summary><div><p>{periodDateRange(recap.period)}</p><p>{edition.source === 'ai' ? 'Written with AI' : 'The Fainens edit'} · Saved {new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(edition.savedAt))}</p><p>Every replay shuffles the story a little. New take rewrites it and refreshes its figures.</p>{!recap.coverageComplete && <p>Coverage is incomplete or unconfirmed.</p>}<p>Left over is income minus expenses as recorded, not savings or a change in cash.</p></div></details>
        <button className="recap-icon-pill" onClick={event => last ? replay() : go(index + 1, { origin: originOf(event) })} aria-label={last ? 'Replay recap' : 'Next chapter'}>{last ? <RefreshCw size={16} /> : <ArrowRight size={16} />}</button>
      </div>
    </div>
    {shareOpen && <ShareRecap recap={recap} theme={stories[0].theme} onClose={() => setShareOpen(false)} />}
  </section>;
}

function ChapterContent({ story, className, style, live = false, periodId, variants, run, onShare }: {
  story: RecapStory; className: string; style?: CSSProperties; live?: boolean; periodId: number; variants: SectionVariants; run: number; onShare: () => void;
}) {
  // Each word knows how many letters came before it, so the typewriter take types at a steady pace.
  const lines = story.title.split('\n').map((line, lineIndex, all) => {
    const before = all.slice(0, lineIndex).join(' ').length + (lineIndex ? 1 : 0);
    return line.split(' ').map((word, i, words) => ({ word, letter: before + words.slice(0, i).join(' ').length + (i ? 1 : 0) }));
  });
  return <div className={`recap-story-content ${className}`} style={style} aria-live={live ? 'polite' : undefined} aria-atomic={live || undefined} aria-hidden={live ? undefined : true} inert={!live || undefined}>
    <p className="recap-story-eyebrow">{story.eyebrow}</p>
    <h2 className={story.title.length > 40 ? 'recap-title-long' : undefined} aria-label={story.title}>
      {lines.map((words, lineIndex) => <span className="recap-title-line" aria-hidden="true" key={lineIndex}>{words.map(({ word, letter }, i) =>
        <Fragment key={i}><span className="recap-word-mask"><span style={{ '--word': Math.min(14, lineIndex * 5 + i), '--letter': letter } as CSSProperties}>{word}</span></span>{' '}</Fragment>)}</span>)}
    </h2>
    <div className="recap-visual"><ChapterVisual story={story} periodId={periodId} onShare={onShare} variants={variants} run={run} /></div>
    <p className="recap-story-body">{story.body}</p>
  </div>;
}

/** The title sequence before the cover: the brand, the period, then the card opens on the story. */
function OpeningTitles({ variant, name, paper }: { variant: Opening; name: string; paper: string }) {
  return <div className={`recap-opening recap-opening-${variant}`} style={{ '--wipe': paper } as CSSProperties} aria-hidden="true">
    {variant === 'shutter' ? Array.from({ length: 6 }, (_, i) => <i key={i} className="recap-opening-strip" style={{ '--s': i } as CSSProperties} />)
      : <><i className="recap-opening-half recap-opening-top" /><i className="recap-opening-half recap-opening-bottom" /></>}
    <div className="recap-opening-title">
      <b>✳</b>
      <span>fainens presents</span>
      <strong>{name}</strong>
    </div>
  </div>;
}

// Each chapter gets one large, quiet motif behind the content.
function ChapterBackdrop({ chapter, seed }: { chapter: string; seed: number }) {
  const motifs: Record<string, string> = {
    intro: seed % 2 === 0 ? 'portal' : 'contour', overview: 'current', budget: 'rail', categories: 'halo',
    calendar: 'orbit', weekdays: 'steps', streak: 'wave', receipts: 'receipt', habits: 'ripple', comparison: 'wave', closing: 'horizon',
  };
  return <div className={`recap-backdrop recap-backdrop-${motifs[chapter] ?? 'contour'} recap-backdrop-edition-${seed % 3}`} aria-hidden="true">
    {[0, 1, 2, 3].map(ring => <i key={ring} style={{ '--ring': ring } as CSSProperties} />)}
  </div>;
}
