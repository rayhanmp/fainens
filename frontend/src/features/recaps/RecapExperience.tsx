import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { Link } from '@tanstack/react-router';
import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ChevronDown, Download, Info, Pause, Play, RefreshCw, Sparkles, X } from 'lucide-react';
import { useRecapArchive, useRecapStory, useRegenerateRecap, type SavedRecapStory } from './queries';
import { buildStories, periodDateRange } from './stories';
import { ShareRecap } from './ShareRecap';
import { ChapterVisual } from './ChapterVisuals';
import './recaps.css';

type ExperienceProps = { initialPeriodId?: number; onPeriodChange?: (periodId: number) => void; onClose?: () => void };
const CHAPTER_MS = 9_000;

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

function RecapViewer({ edition, controls }: { edition: SavedRecapStory; controls: ReactNode }) {
  const { maskAmounts } = useBalanceVisibility();
  const recap = edition.snapshot;
  const stories = buildStories(recap, edition).map(story => ({ ...story, title: maskAmounts(story.title), body: maskAmounts(story.body) }));
  const [index, setIndex] = useState(0);
  // Which way the reader moved, so the next chapter slides in from that side.
  const [direction, setDirection] = useState<'next' | 'prev'>('next');
  const [shareOpen, setShareOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const slideRef = useRef<HTMLDivElement>(null);
  const autoplayClock = useRef({ chapter: '', remaining: CHAPTER_MS });
  const progressVisit = useRef({ index, id: 0 });
  if (progressVisit.current.index !== index) progressVisit.current = { index, id: progressVisit.current.id + 1 };
  const [progressReadyVisit, setProgressReadyVisit] = useState<number | null>(null);
  const [pageHidden, setPageHidden] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const regenerate = useRegenerateRecap(recap.period.id);
  const story = stories[index];
  const last = index === stories.length - 1;
  const chapterCount = stories.length;
  useEffect(() => {
    const visitId = progressVisit.current.id;
    if (autoplayClock.current.chapter !== story.id) {
      autoplayClock.current = { chapter: story.id, remaining: CHAPTER_MS };
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
      timer = setTimeout(() => {
        setDirection('next');
        setIndex(current => current === index ? Math.min(chapterCount - 1, current + 1) : current);
      }, clock.remaining);
    };
    const onVisibilityChange = () => {
      setPageHidden(document.hidden);
      document.hidden ? stopTimer() : startTimer();
    };
    setPageHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibilityChange);
    // Start the clock once the chapter has finished arriving: words, counters, bars and day cells.
    const reveals = slideRef.current?.getAnimations({ subtree: true }).filter(animation => {
      const target = (animation.effect as KeyframeEffect | null)?.target;
      return !(target instanceof Element && target.closest('.recap-progress, .recap-backdrop'))
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
  }, [index, story.id, chapterCount, last, paused, shareOpen, infoOpen, regenerate.isPending]);
  const moveTo = (target: number) => {
    const next = Math.max(0, Math.min(stories.length - 1, target));
    if (next === index) return;
    setDirection(next > index ? 'next' : 'prev');
    setIndex(next);
  };
  const titleWords = story.title.split('\n');
  return <section className="recap-viewer" aria-label={`${recap.period.name} recap`}>
    <div ref={slideRef} className={`recap-story recap-theme-${story.theme} recap-chapter-${story.id}`} tabIndex={0} aria-label="Period story. Use left and right arrow keys to navigate."
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'ArrowRight') { event.preventDefault(); moveTo(index + 1); }
        if (event.key === 'ArrowLeft') { event.preventDefault(); moveTo(index - 1); }
        if (event.key === 'Home') { event.preventDefault(); moveTo(0); }
        if (event.key === 'End') { event.preventDefault(); moveTo(stories.length - 1); }
        if (event.key === ' ') { event.preventDefault(); setPaused(value => !value); }
      }}
      onClick={event => {
        if ((event.target as HTMLElement).closest('button, a, select, label, summary, details')) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        moveTo(index + (event.clientX - bounds.left < bounds.width * .35 ? -1 : 1));
      }}
      onTouchStart={event => { touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; }}
      onTouchCancel={() => { touchStart.current = null; }}
      onTouchEnd={event => {
        const start = touchStart.current; touchStart.current = null; if (!start) return;
        const dx = event.changedTouches[0].clientX - start.x; const dy = event.changedTouches[0].clientY - start.y;
        if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) moveTo(index + (dx < 0 ? 1 : -1));
      }}>
      <div className="recap-overlay-actions">{controls}<button className="recap-icon-pill" disabled={regenerate.isPending} onClick={() => regenerate.mutate()} aria-label="New take" title="Rewrite the story and refresh its figures"><RefreshCw size={15} className={regenerate.isPending ? 'recap-spin' : ''} /></button><button className="recap-icon-pill" onClick={() => setShareOpen(true)} aria-label="Share recap"><Download size={15} /></button></div>
      {regenerate.isError && <p className="recap-inline-error" role="alert">{regenerate.error.message}</p>}
      <div className="recap-progress" aria-label="Story chapters">{stories.map((item, i) => {
        const active = i === index && !last;
        const seen = i < index || (last && i === index);
        const running = active && progressReadyVisit === progressVisit.current.id
          && !paused && !pageHidden && !shareOpen && !infoOpen && !regenerate.isPending;
        return <button key={item.id} aria-label={`Chapter ${i + 1}: ${item.eyebrow}`} aria-current={i === index ? 'step' : undefined}
          className={[seen && 'is-seen', active && 'is-active', running && 'is-running'].filter(Boolean).join(' ')}
          onClick={() => moveTo(i)}>{active && <span className="recap-progress-fill" style={{ animationDuration: `${CHAPTER_MS}ms` }} aria-hidden="true" />}</button>;
      })}</div>
      <div className="recap-story-brand"><span>fainens<span className="recap-brand-dot" aria-hidden="true">✳</span></span><span>{recap.isPartial ? 'Your period so far' : 'The period edit'}</span></div>
      <ChapterBackdrop key={`${story.id}-backdrop`} chapter={story.id} seed={edition.seed} />
      {story.id === 'intro' && <span key="cover-word" className="recap-cover-word" aria-hidden="true">{recap.period.name.split(' ')[0]}</span>}
      <div key={story.id} className={`recap-story-content recap-from-${direction}`} aria-live="polite" aria-atomic="true">
        <p className="recap-story-eyebrow">{story.eyebrow}</p>
        <h2 className={story.title.length > 40 ? 'recap-title-long' : undefined} aria-label={story.title}>
          {titleWords.map((line, lineIndex) => <span className="recap-title-line" aria-hidden="true" key={lineIndex}>{line.split(' ').map((word, i) => <Fragment key={i}><span className="recap-word-mask"><span style={{ '--word': Math.min(14, lineIndex * 5 + i) } as CSSProperties}>{word}</span></span>{' '}</Fragment>)}</span>)}
        </h2>
        <div className="recap-visual"><ChapterVisual story={story} periodId={recap.period.id} onShare={() => setShareOpen(true)} /></div>
        <p className="recap-story-body">{story.body}</p>
      </div>
      <div className="recap-bottom-actions">
        <button className="recap-icon-pill" onClick={() => moveTo(index - 1)} disabled={index === 0} aria-label="Previous chapter"><ArrowLeft size={16} /></button>
        <span>{String(index + 1).padStart(2, '0')} / {String(stories.length).padStart(2, '0')}</span>
        {!last && <button className="recap-icon-pill" onClick={() => setPaused(value => !value)} aria-label={paused ? 'Resume autoplay' : 'Pause autoplay'} aria-pressed={paused} title={paused ? 'Resume autoplay' : 'Moves on by itself after each chapter arrives'}>{paused ? <Play size={14} /> : <Pause size={14} />}</button>}
        <details className="recap-info" onToggle={event => setInfoOpen(event.currentTarget.open)}><summary aria-label="About this edition"><Info size={14} /></summary><div><p>{periodDateRange(recap.period)}</p><p>{edition.source === 'ai' ? 'Written with AI' : 'The Fainens edit'} · Saved {new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(edition.savedAt))}</p><p>New take rewrites the story and refreshes its figures.</p>{!recap.coverageComplete && <p>Coverage is incomplete or unconfirmed.</p>}<p>Left over is income minus expenses as recorded, not savings or a change in cash.</p></div></details>
        <button className="recap-icon-pill" onClick={() => last ? moveTo(0) : moveTo(index + 1)} aria-label={last ? 'Replay recap' : 'Next chapter'}>{last ? <RefreshCw size={16} /> : <ArrowRight size={16} />}</button>
      </div>
    </div>
    {shareOpen && <ShareRecap recap={recap} edition={edition} onClose={() => setShareOpen(false)} />}
  </section>;
}

// Each chapter gets one large, quiet motif behind the content.
function ChapterBackdrop({ chapter, seed }: { chapter: string; seed: number }) {
  const motifs: Record<string, string> = {
    intro: seed % 2 === 0 ? 'portal' : 'contour', overview: 'current', budget: 'rail', categories: 'halo',
    calendar: 'orbit', receipts: 'receipt', habits: 'ripple', comparison: 'wave', closing: 'horizon',
  };
  return <div className={`recap-backdrop recap-backdrop-${motifs[chapter] ?? 'contour'} recap-backdrop-edition-${seed % 3}`} aria-hidden="true">
    {[0, 1, 2, 3].map(ring => <i key={ring} style={{ '--ring': ring } as CSSProperties} />)}
  </div>;
}
