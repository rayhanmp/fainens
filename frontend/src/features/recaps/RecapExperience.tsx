import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { Link } from '@tanstack/react-router';
import { Fragment, lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { ArrowLeft, ArrowRight, ChevronDown, Download, Info, Music, Pause, Play, RefreshCw, Rewind, Sparkles, Trophy, Volume2, VolumeX, X } from 'lucide-react';
import { usePeriodRecap, useRecapArchive, useRecapStory, useRegenerateRecap, useYearRecaps, type PeriodRecap, type SavedRecapStory } from './queries';
import { combineYear, recapYear, yearEdition } from './year';
import { buildStories, crawlText, EXTRA_GAMES, periodDateRange, themeColors, type Achievement, type RecapStory } from './stories';
import { preloadParts } from './parts';
import { ChapterVisual, type QuizScore } from './ChapterVisuals';
import { Burst } from './Burst';
import { GameVerdict, PlayGate, type PlayResult } from './Games';
import { FlavourMark } from './FlavourMark';
import { play, playTicks, setSoundMode, silence, soundMode, startGroove, stopGroove, type Sound, type SoundMode } from './sfx';
import { chapterStyle, enterDelay, lowEndDevice, nextTransition, OPENING_DURATIONS, OVERLAY_TRANSITIONS, prefersReducedMotion, runParts, runVariants, type ChapterStyle, type Opening, type SectionVariants, type Transition } from './motion';
import './recaps.css';

// The share card and the video recorder are only needed once someone shares.
const ShareRecap = lazy(() => import('./ShareRecap').then(module => ({ default: module.ShareRecap })));

type ExperienceProps = { initialPeriodId?: number; onPeriodChange?: (periodId: number) => void; onClose?: () => void };
const CHAPTER_MS = 9_000;
const EXIT_MS = 700;
// The short openings; the long ones (the crawl, the tape, the news…) set their own in OPENING_DURATIONS.
const OPENING_MS = 1_500;
const EJECT_STEP_MS = 1_700;
const newRun = () => 1 + Math.floor(Math.random() * 2_000_000_000);

export function RecapExperience({ initialPeriodId, onPeriodChange, onClose }: ExperienceProps) {
  const archive = useRecapArchive();
  const [selected, setSelected] = useState(initialPeriodId);
  const [year, setYear] = useState<number | null>(null);
  const periodId = selected ?? archive.data?.[0]?.id;
  const period = archive.data?.find(item => item.id === periodId);
  const edition = useRecapStory(year === null ? periodId : undefined);
  // The period before, for bonus slides that compare (the archive is newest first). It loads alongside
  // this one; if it fails, those slides simply sit this viewing out.
  const periodIndex = archive.data?.findIndex(item => item.id === periodId) ?? -1;
  const previous = usePeriodRecap(year === null && periodIndex >= 0 ? archive.data?.[periodIndex + 1]?.id : undefined);
  // A year in review is on offer once a calendar year has at least two periods.
  const years = [...new Set((archive.data ?? []).map(recapYear))].filter(value => (archive.data ?? []).filter(item => recapYear(item) === value).length >= 2).sort((a, b) => b - a);
  const controls = <>
    <label className="recap-period-pill"><span>{year !== null ? `${year} · Year in review` : period?.name ?? 'Your periods'}</span><ChevronDown size={12} /><select aria-label="Recap period" value={year !== null ? `year:${year}` : periodId ?? ''} onChange={event => {
      const value = event.target.value;
      if (value.startsWith('year:')) { setYear(Number(value.slice(5))); return; }
      setYear(null); setSelected(Number(value)); onPeriodChange?.(Number(value));
    }}>
      {years.length > 0 && <optgroup label="Year in review">{years.map(value => <option key={value} value={`year:${value}`}>{value} · Year in review</option>)}</optgroup>}
      <optgroup label="Salary periods">
        {periodId && !period && <option value={periodId}>Period {periodId}</option>}
        {archive.data?.map(item => <option key={item.id} value={item.id}>{item.name} · {periodDateRange(item)}{item.isPartial ? ' · So far' : ''}</option>)}
      </optgroup>
    </select></label>
    {onClose && <button className="recap-icon-pill recap-close" onClick={onClose} aria-label="Close recap"><X size={16} /></button>}
  </>;
  const fallbackControls = <div className="recap-overlay-actions">{controls}</div>;
  if (year !== null) {
    return <div className="recap-experience"><YearRecap key={year} year={year} periodIds={(archive.data ?? []).filter(item => recapYear(item) === year).map(item => item.id)} controls={controls} fallbackControls={fallbackControls} /></div>;
  }
  return <div className="recap-experience">
    {archive.isPending || (periodId && edition.isPending) || previous.isLoading ? <div className="recap-writing" role="status">{fallbackControls}<div className="recap-writing-orbit" aria-hidden="true"><i /><i /><i /><Sparkles size={30} /></div><h3>Rewinding your period.</h3><p>Putting your edition together.</p></div>
      : archive.isError || edition.isError ? <div className="recap-empty" role="alert">{fallbackControls}<h2>Your story couldn’t load.</h2><p>{edition.error?.message ?? 'Please try again in a moment.'}</p><button className="recap-primary" onClick={() => { void archive.refetch(); if (periodId) void edition.refetch(); }}><RefreshCw size={16} />Try again</button></div>
      : !periodId || !edition.data ? <div className="recap-empty">{fallbackControls}<Sparkles size={34} /><h2>Your next chapter starts here.</h2><p>Record income or expenses to bring your period story to life.</p><Link to="/transactions" className="recap-primary">Review transactions <ArrowRight size={16} /></Link></div>
      : edition.data.snapshot.activityCount === 0 ? <EmptyRecapEdition periodId={periodId} controls={fallbackControls} />
      : <RecapViewer key={`${periodId}:${edition.data.savedAt}`} edition={edition.data} previous={previous.data ?? null} controls={controls} />}
  </div>;
}

/** The whole year in one story, combined from its periods' recaps. Nothing is saved or rewritten. */
function YearRecap({ year, periodIds, controls, fallbackControls }: { year: number; periodIds: number[]; controls: ReactNode; fallbackControls: ReactNode }) {
  const recaps = useYearRecaps(periodIds);
  const edition = useMemo(() => recaps.data ? yearEdition(combineYear(recaps.data, year), year) : null, [recaps.data, year]);
  if (recaps.error) return <div className="recap-empty" role="alert">{fallbackControls}<h2>The year couldn’t load.</h2><p>{recaps.error.message}</p></div>;
  if (!edition) return <div className="recap-writing" role="status">{fallbackControls}<div className="recap-writing-orbit" aria-hidden="true"><i /><i /><i /><Sparkles size={30} /></div><h3>Rewinding {year}.</h3><p>Stitching {periodIds.length} periods together.</p></div>;
  return <RecapViewer edition={edition} controls={controls} yearMode />;
}

function EmptyRecapEdition({ periodId, controls }: { periodId: number; controls: ReactNode }) {
  const regenerate = useRegenerateRecap(periodId);
  return <div className="recap-empty">{controls}<Sparkles size={34} /><h2>A quiet page in the story.</h2><p>No income or expenses were recorded when this edition was saved. Refresh it to include newer records.</p>
    <button className="recap-primary" disabled={regenerate.isPending} onClick={() => regenerate.mutate()}><RefreshCw size={16} />{regenerate.isPending ? 'Refreshing…' : 'Refresh this period'}</button>
    {regenerate.isError && <p role="alert">{regenerate.error.message}</p>}
  </div>;
}

type Nav = { index: number; visit: number; direction: 'next' | 'prev'; transition: Transition; origin: { x: number; y: number } };
type Leaving = { story: RecapStory; visit: number; direction: Nav['direction']; transition: Transition; gate: boolean };
type Answer = PlayResult;
/** A chapter's content element is kept by key while it leaves, so it exits without re-animating. */
const contentKey = (visit: number, gate: boolean) => `c${visit}${gate ? 'q' : ''}`;

function RecapViewer({ edition, previous = null, controls, yearMode = false }: { edition: SavedRecapStory; previous?: PeriodRecap | null; controls: ReactNode; yearMode?: boolean }) {
  const { maskAmounts } = useBalanceVisibility();
  const recap = edition.snapshot;
  // Held as it was at open: a background refetch of the previous period must not reshuffle the deck.
  const [previousAtOpen] = useState(previous);
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);
  // Each viewing rolls its own dice: copy, lead facts, bonus chapters, order, colours and motion.
  const [run, setRun] = useState(newRun);
  // Low-end phones get the same recap with lighter dice (no set-piece transitions).
  const lite = useMemo(() => lowEndDevice(), []);
  const variants = useMemo(() => runVariants(run, lite), [run, lite]);
  const stories = useMemo(() => buildStories(recap, edition, run, previousAtOpen).map(story => ({ ...story, title: maskAmounts(story.title), body: maskAmounts(story.body) })), [recap, edition, run, previousAtOpen, maskAmounts]);
  // The run's rolled variations load during the opening, so they're ready by the time their chapter comes.
  useEffect(() => {
    const parts = runParts(variants);
    if (stories.some(item => item.play && EXTRA_GAMES.has(item.play.kind))) parts.add('games');
    if (stories.some(item => item.id === 'year')) parts.add('year');
    preloadParts(parts);
  }, [variants, stories]);
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
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [sound, setSound] = useState<SoundMode>(soundMode);
  // Music mode runs a groove under the whole recap; its tempo and chords follow the run.
  useEffect(() => {
    if (sound === 'music') startGroove(run, variants.pack);
    return () => stopGroove();
  }, [sound, run, variants.pack]);
  // Closing the recap calls off any sounds still queued for its chapters.
  useEffect(() => () => silence(), []);
  const [party, setParty] = useState(0);
  const index = Math.min(nav.index, stories.length - 1);
  const story = stories[index];
  const last = index === stories.length - 1;
  const chapterCount = stories.length;
  const gateOf = (item: RecapStory) => Boolean(item.play && !answers[item.id]);
  const quizOpen = gateOf(story);
  const chapterMs = story.duration ?? CHAPTER_MS;
  // The cover and full-bleed finales keep their own art direction; every other chapter gets remixed.
  const remixOf = (item: RecapStory) => {
    const style = chapterStyle(run, `${item.id}:${item.id === 'interlude' ? item.slot : item.id === 'bonus' ? item.bonus.kind : item.id === 'year' ? item.insight.kind : ''}`);
    return item.id === 'intro' || (item.id === 'closing' && variants.finale !== 'card') ? { ...style, pattern: 'none' as const, frame: 'none' as const, sticker: null }
      // Bonus slides and a year's insights carry their own set pieces, so they skip the background pattern.
      : item.id === 'bonus' || item.id === 'year' ? { ...style, pattern: 'none' as const, sticker: null } : style;
  };
  const remix = remixOf(story);
  // Kept stable between renders so the memoised chapter visuals can skip them.
  const score = useMemo(() => {
    const graded = Object.values(answers).filter(answer => answer.scored);
    return { correct: graded.filter(answer => answer.correct).length, total: graded.length };
  }, [answers]);
  const openShare = useCallback(() => setShareOpen(true), []);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLeaving(null), EXIT_MS);
    return () => clearTimeout(timer);
  }, [leaving]);
  useEffect(() => {
    if (!opening) return;
    const timer = setTimeout(() => setOpening(null), OPENING_DURATIONS[opening] ?? OPENING_MS);
    return () => clearTimeout(timer);
  }, [opening]);
  // Achievement toasts: each unlocks once per run, a moment after its chapter has landed.
  const [toast, setToast] = useState<{ key: number; title: string; detail: string } | null>(null);
  const shownAchievements = useRef(new Set<string>());
  const toastTimers = useRef<{ id: string; timer: number }[]>([]);
  const unlock = (achievement: Achievement | undefined, delay: number) => {
    if (!achievement || reducedMotion) return;
    const id = `${achievement.title}:${achievement.detail}`;
    if (shownAchievements.current.has(id)) return;
    shownAchievements.current.add(id);
    toastTimers.current.push({ id, timer: window.setTimeout(() => { setToast({ key: Date.now(), title: achievement.title, detail: maskAmounts(achievement.detail) }); play('arcade'); }, delay) });
  };
  // Leaving a chapter before its toast pops puts the achievement back, to unlock on the next visit.
  const cancelToasts = () => {
    toastTimers.current.forEach(({ id, timer }) => { clearTimeout(timer); shownAchievements.current.delete(id); });
    toastTimers.current = [];
  };
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3_400);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => () => toastTimers.current.forEach(({ timer }) => clearTimeout(timer)), []);
  // The cover waits for the opening; if the crawl is skipped, its entrance moves up at once.
  const openingEnter = opening ? (OPENING_DURATIONS[opening] ?? OPENING_MS) - 450 : 120;
  const crawl = useMemo(() => {
    const text = crawlText(recap, run);
    return { ...text, paragraphs: text.paragraphs.map(maskAmounts) };
  }, [recap, run, maskAmounts]);

  const go = (target: number, options: { origin?: Nav['origin']; transition?: Transition } = {}) => {
    const next = Math.max(0, Math.min(stories.length - 1, target));
    if (next === index && !options.transition) return;
    const transition = reducedMotion ? 'slide' : options.transition ?? nextTransition(run, nav.visit + 1, nav.transition, variants.lite);
    if (!reducedMotion) setLeaving({ story, visit: nav.visit, direction: nav.direction, transition, gate: quizOpen });
    setNav({ index: next, visit: nav.visit + 1, direction: next >= index ? 'next' : 'prev', transition, origin: options.origin ?? { x: next >= index ? 82 : 18, y: 92 } });
    play(transitionSounds[transition]);
    // The set pieces have their own cues on top.
    if (transition === 'train') { play('horn', 200); play('patter', 450); }
    if (transition === 'elevator') { play('thunk', 420); play('ding', 620); play('swish', 830); }
    if (transition === 'chomp') { for (let i = 0; i < 6; i++) play('pop', 120 + i * 130); }
    cancelToasts();
    if (!gateOf(stories[next])) {
      arrivalSounds(stories[next], enterDelay(transition), variants);
      unlock(stories[next].achievement, enterDelay(transition) + 1_400);
    }
  };
  // A replay rewinds to the cover with fresh dice, so the second viewing differs from the first.
  const replay = () => {
    const fresh = newRun();
    if (!reducedMotion) setLeaving({ story, visit: nav.visit, direction: 'prev', transition: 'rewind', gate: quizOpen });
    setRun(fresh);
    setAnswers({});
    cancelToasts();
    shownAchievements.current.clear();
    setNav({ index: 0, visit: nav.visit + 1, direction: 'prev', transition: 'rewind', origin: { x: 50, y: 50 } });
    play('rewind');
  };
  // Answering (or skipping) zooms the question away and plays the chapter's reveal in its place.
  const answer = (result: PlayResult) => {
    if (!reducedMotion) setLeaving({ story, visit: nav.visit, direction: 'next', transition: 'zoom', gate: true });
    setAnswers(current => ({ ...current, [story.id]: result }));
    setNav(current => ({ ...current, transition: 'zoom' }));
    arrivalSounds(story, enterDelay('zoom'), variants);
    unlock(story.achievement, 4_200);
  };
  const startParty = () => {
    if (reducedMotion) return;
    setParty(Date.now());
    play('fanfare');
  };
  useEffect(() => {
    if (!party) return;
    const timer = setTimeout(() => setParty(0), 4_500);
    return () => clearTimeout(timer);
  }, [party]);
  // Autoplay moves on with whatever `go` is current when its timer fires.
  const advance = useRef(() => {});
  useEffect(() => { advance.current = () => go(index + 1); });
  const originOf = (event: MouseEvent<HTMLElement>) => {
    const bounds = slideRef.current?.getBoundingClientRect();
    return bounds ? { x: (event.clientX - bounds.left) / bounds.width * 100, y: (event.clientY - bounds.top) / bounds.height * 100 } : undefined;
  };
  const replayRef = useRef(replay);
  useEffect(() => { replayRef.current = replay; });

  // Tilt: the backdrop, the giant month and the big figures drift with the pointer or the phone.
  // Shake the phone to re-roll the recap.
  useEffect(() => {
    const element = slideRef.current;
    if (!element || reducedMotion) return;
    let frame = 0;
    // Every write restyles the whole slide, and a phone's sensor reports ~60 times a second even when
    // it rests on a table, so small wobbles are dropped.
    let last = { x: 0, y: 0 };
    const tilt = (x: number, y: number) => {
      if (Math.abs(x - last.x) < .03 && Math.abs(y - last.y) < .03) return;
      last = { x, y };
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { element.style.setProperty('--px', x.toFixed(2)); element.style.setProperty('--py', y.toFixed(2)); });
    };
    // Measured once per visit of the pointer, not on every move.
    let bounds: DOMRect | null = null;
    const onPointer = (event: globalThis.PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      bounds ??= element.getBoundingClientRect();
      tilt((event.clientX - bounds.left) / bounds.width * 2 - 1, (event.clientY - bounds.top) / bounds.height * 2 - 1);
    };
    const onLeave = () => { bounds = null; tilt(0, 0); };
    const onOrientation = (event: DeviceOrientationEvent) => {
      if (event.gamma == null || event.beta == null) return;
      tilt(Math.max(-1, Math.min(1, event.gamma / 35)), Math.max(-1, Math.min(1, (event.beta - 45) / 35)));
    };
    let shakes: number[] = [];
    const onMotion = (event: DeviceMotionEvent) => {
      const a = event.accelerationIncludingGravity;
      if (!a || a.x == null || a.y == null || a.z == null) return;
      if (Math.hypot(a.x, a.y, a.z) < 28) return;
      const now = performance.now();
      shakes = [...shakes.filter(at => now - at < 900), now];
      if (shakes.length >= 3) { shakes = []; replayRef.current(); }
    };
    element.addEventListener('pointermove', onPointer);
    element.addEventListener('pointerleave', onLeave);
    window.addEventListener('deviceorientation', onOrientation);
    window.addEventListener('devicemotion', onMotion);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener('pointermove', onPointer);
      element.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('deviceorientation', onOrientation);
      window.removeEventListener('devicemotion', onMotion);
    };
  }, [reducedMotion]);
  // The cover's own sounds, once per mount, when the recap first opens. Closing the recap silences
  // them, so a remount (React's strict mode does one) greets again.
  const greet = useRef(() => {});
  useEffect(() => { greet.current = () => { if (opening) play('jingle', 150); arrivalSounds(stories[0], openingEnter, variants); }; });
  useEffect(() => { greet.current(); }, []);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(pressTimer.current), []);

  useEffect(() => {
    const visitId = nav.visit;
    if (autoplayClock.current.chapter !== `${nav.visit}`) {
      autoplayClock.current = { chapter: `${nav.visit}`, remaining: chapterMs };
    }
    // An open quiz waits for its answer.
    if (last || paused || shareOpen || infoOpen || regenerate.isPending || quizOpen) return;
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
      return !(target instanceof Element && target.closest('.recap-progress, .recap-backdrop, .recap-leaving, .recap-burst, .recap-toast'))
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
  }, [nav.visit, chapterCount, last, paused, shareOpen, infoOpen, regenerate.isPending, quizOpen, chapterMs]);

  const overlay = OVERLAY_TRANSITIONS.has(nav.transition) && nav.visit > 0 && !reducedMotion;
  const paper = themeColors[story.theme].paper;
  const entering = nav.visit === 0 ? openingEnter : enterDelay(nav.transition);
  return <section className="recap-viewer" aria-label={`${recap.period.name} recap`}>
    <div ref={slideRef} className={`recap-story recap-theme-${story.theme} recap-chapter-${story.id} recap-ed-${variants.edition}${opening ? ' is-opening' : ''}${party ? ' is-party' : ''}`} tabIndex={0}
      data-idle={shareOpen || infoOpen || pageHidden ? '' : undefined} aria-label="Period story. Arrow keys move between chapters, space pauses, R re-rolls."
      style={{ '--ox': `${nav.origin.x}%`, '--oy': `${nav.origin.y}%` } as CSSProperties}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'ArrowRight') { event.preventDefault(); if (last) replay(); else go(index + 1); }
        if (event.key === 'ArrowLeft') { event.preventDefault(); go(index - 1); }
        if (event.key === 'Home') { event.preventDefault(); go(0); }
        if (event.key === 'End') { event.preventDefault(); go(stories.length - 1); }
        if (event.key === ' ') { event.preventDefault(); setPaused(value => !value); }
        if ((event.key === 'r' || event.key === 'R') && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); replay(); }
      }}
      onClick={event => {
        if ((event.target as HTMLElement).closest('button, a, select, label, summary, details, input, .recap-scratch, .recap-game, .recap-opening')) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        go(index + (event.clientX - bounds.left < bounds.width * .35 ? -1 : 1), { origin: originOf(event) });
      }}
      onTouchStart={event => { touchStart.current = (event.target as HTMLElement).closest('.recap-scratch, .recap-game') ? null : { x: event.touches[0].clientX, y: event.touches[0].clientY }; }}
      onTouchCancel={() => { touchStart.current = null; }}
      onTouchEnd={event => {
        const start = touchStart.current; touchStart.current = null; if (!start) return;
        const dx = event.changedTouches[0].clientX - start.x; const dy = event.changedTouches[0].clientY - start.y;
        if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) go(index + (dx < 0 ? 1 : -1));
      }}>
      {/* A year in review is computed live from its periods, so there is no saved take to rewrite. */}
      <div className="recap-overlay-actions">{controls}{!yearMode && <button className="recap-icon-pill" disabled={regenerate.isPending} onClick={() => regenerate.mutate()} aria-label="New take" title="Rewrite the story and refresh its figures"><RefreshCw size={15} className={regenerate.isPending ? 'recap-spin' : ''} /></button>}<button className="recap-icon-pill" onClick={() => setShareOpen(true)} aria-label="Share recap"><Download size={15} /></button><button className="recap-icon-pill" aria-pressed={sound !== 'off'} onClick={() => { const next = nextSoundMode[sound]; setSoundMode(next); setSound(next); play(next === 'music' ? 'chord' : 'pop'); }}
        aria-label={soundLabels[sound]} title={soundLabels[sound]}>{sound === 'music' ? <Music size={15} /> : sound === 'fx' ? <Volume2 size={15} /> : <VolumeX size={15} />}</button></div>
      {regenerate.isError && <p className="recap-inline-error" role="alert">{regenerate.error.message}</p>}
      <div className="recap-progress" aria-label="Story chapters">{stories.map((item, i) => {
        const active = i === index && !last;
        const seen = i < index || (last && i === index);
        const running = active && progressReadyVisit === nav.visit
          && !paused && !pageHidden && !shareOpen && !infoOpen && !regenerate.isPending;
        return <button key={`${item.id}-${i}`} aria-label={`Chapter ${i + 1}: ${item.eyebrow}`} aria-current={i === index ? 'step' : undefined}
          className={[seen && 'is-seen', active && 'is-active', running && 'is-running'].filter(Boolean).join(' ')}
          onClick={event => go(i, { origin: originOf(event) })}>{active && <span className="recap-progress-fill" style={{ animationDuration: `${chapterMs}ms` }} aria-hidden="true" />}</button>;
      })}</div>
      {/* Long-press the ✳ for party mode. */}
      <div className="recap-story-brand"><span>fainens<span className="recap-brand-dot" aria-hidden="true"
        onPointerDown={() => { clearTimeout(pressTimer.current); pressTimer.current = setTimeout(startParty, 650); }}
        onPointerUp={() => clearTimeout(pressTimer.current)} onPointerLeave={() => clearTimeout(pressTimer.current)}>✳</span></span><span>{yearMode ? (recap.isPartial ? 'Your year so far' : 'The year in review') : recap.isPartial ? 'Your period so far' : 'The period edit'}</span></div>
      {toast && <div key={toast.key} className="recap-toast" role="status">
        <span className="recap-toast-icon" aria-hidden="true"><Trophy /></span>
        <span><b>Achievement get!</b><span>{toast.title}</span><small>{toast.detail}</small></span>
      </div>}
      {party > 0 && <div key={party} className="recap-party" aria-hidden="true" style={{ '--enter': '0ms' } as CSSProperties}><Burst seed={party} kind="stars" count={60} origin="center" /><Burst seed={party + 1} kind="confetti" count={50} origin="cannons" delay={300} /></div>}
      <ChapterBackdrop key={`${nav.visit}-backdrop`} chapter={story.id} seed={edition.seed + run} />
      {remix.pattern !== 'none' && <div key={`pattern-${nav.visit}`} className={`recap-pattern recap-pattern-${remix.pattern}`} style={{ '--bx': `${remix.blob.x}%`, '--by': `${remix.blob.y}%` } as CSSProperties} aria-hidden="true" />}
      {remix.frame !== 'none' && <div key={`frame-${nav.visit}`} className={`recap-frame recap-frame-${remix.frame}`} aria-hidden="true" />}
      {/* The next chapter's colour washes over the card, between the leaving and arriving content. */}
      {overlay && <div key={`wipe-${nav.visit}`} className={`recap-wipe recap-wipe-${nav.transition} recap-dir-${nav.direction}`} style={{ '--wipe': paper } as CSSProperties} aria-hidden="true">
        {nav.transition === 'blinds' && Array.from({ length: 7 }, (_, i) => <i key={i} style={{ '--b': i } as CSSProperties} />)}
        {nav.transition === 'rewind' && <Rewind className="recap-rewind-icon" />}
        {nav.transition === 'train' && <>
          <div className="recap-train">{[0, 1, 2].map(i => <i key={i} className="recap-train-car" />)}<i className="recap-train-car recap-train-loco"><b className="recap-train-smoke" /></i></div>
          <i className="recap-train-rails" />
        </>}
        {nav.transition === 'elevator' && <>
          <i /><i />
          {/* The lift's floor indicator ticks from the chapter you left to the one you're going to. */}
          <span className="recap-floor">{nav.direction === 'next' ? '▲' : '▼'}<b><span><span>{nav.direction === 'next' ? index : index + 2}</span><span>{index + 1}</span></span></b></span>
        </>}
        {nav.transition === 'chomp' && <><i className="recap-chomp-fill" /><i className="recap-chomp-dots" /><i className="recap-chomper" /></>}
      </div>}
      <div className="recap-stage">
        {leaving && contentKey(leaving.visit, leaving.gate) !== contentKey(nav.visit, quizOpen) && <ChapterContent key={contentKey(leaving.visit, leaving.gate)} story={leaving.story} gate={leaving.gate} remix={remixOf(leaving.story)}
          className={`recap-leaving recap-out-${leaving.transition} recap-dir-${nav.direction}`} periodId={recap.period.id} variants={variants} run={run} score={score} onShare={openShare} />}
        <ChapterContent key={contentKey(nav.visit, quizOpen)} story={story} live gate={quizOpen} answer={answers[story.id]} remix={remix}
          onAnswer={answer} className={`recap-arriving recap-in-${nav.visit === 0 ? 'first' : nav.transition} recap-dir-${nav.direction} recap-intro-${variants.intro}`}
          style={{ '--enter': `${entering}ms` } as CSSProperties} periodId={recap.period.id} variants={variants} run={run} score={score} onShare={openShare} />
      </div>
      {opening && <OpeningTitles variant={opening} name={recap.period.name} paper={paper} crawl={crawl} onSkip={() => setOpening(null)} />}
      <div className="recap-bottom-actions">
        <button className="recap-icon-pill" onClick={event => go(index - 1, { origin: originOf(event) })} disabled={index === 0} aria-label="Previous chapter"><ArrowLeft size={16} /></button>
        <span>{String(index + 1).padStart(2, '0')} / {String(stories.length).padStart(2, '0')}</span>
        {!last && <button className="recap-icon-pill" onClick={() => setPaused(value => !value)} aria-label={paused ? 'Resume autoplay' : 'Pause autoplay'} aria-pressed={paused} title={paused ? 'Resume autoplay' : 'Moves on by itself after each chapter arrives'}>{paused ? <Play size={14} /> : <Pause size={14} />}</button>}
        <Link to="/agent" search={{ prompt: story.ask }} className="recap-icon-pill recap-ask" aria-label="Ask Fainens Agent about this" title="Ask Fainens Agent about this"><Sparkles size={14} /></Link>
        <details className="recap-info" onToggle={event => setInfoOpen(event.currentTarget.open)}><summary aria-label="About this edition"><Info size={14} /></summary><div><p>{periodDateRange(recap.period)}</p><p>{edition.source === 'ai' ? 'Written with AI' : 'The Fainens edit'} · Saved {new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(edition.savedAt))}</p><p>Every replay shuffles the story. Press R or shake your phone to re-roll, and long-press the ✳ for a surprise. New take rewrites the story and refreshes its figures.</p>{!recap.coverageComplete && <p>Coverage is incomplete or unconfirmed.</p>}<p>Left over is income minus expenses as recorded, not savings or a change in cash.</p></div></details>
        <button className="recap-icon-pill" onClick={event => last ? replay() : go(index + 1, { origin: originOf(event) })} aria-label={last ? 'Replay recap' : 'Next chapter'}>{last ? <RefreshCw size={16} /> : <ArrowRight size={16} />}</button>
      </div>
    </div>
    {shareOpen && <Suspense fallback={null}><ShareRecap recap={recap} theme={stories[0].theme} themes={stories.map(item => item.theme)}
      persona={stories.find(item => item.id === 'closing')?.persona ?? null} onClose={() => setShareOpen(false)} /></Suspense>}
  </section>;
}

function ChapterContent({ story, className: baseClass, style: baseStyle, live = false, gate = false, answer, onAnswer, periodId, variants, run, score, onShare, remix }: {
  story: RecapStory; className: string; style?: CSSProperties; live?: boolean; gate?: boolean; answer?: Answer; onAnswer?: (result: PlayResult) => void;
  periodId: number; variants: SectionVariants; run: number; score: QuizScore; onShare: () => void; remix: ChapterStyle;
}) {
  const className = `${baseClass} recap-title-${remix.title} recap-align-${remix.align}`;
  const style = { ...baseStyle, '--tilt': `${remix.tilt}deg`, '--tempo': remix.tempo } as CSSProperties;
  const sticker = remix.sticker && <span className={`recap-sticker recap-sticker-${remix.sticker.corner}`} style={{ '--spin': `${remix.sticker.spin}deg` } as CSSProperties} aria-hidden="true">{remix.sticker.text}</span>;
  const root = useRef<HTMLDivElement>(null);
  // The cover, and every finale except the summary card, are full-bleed designs that set their own type.
  const fullBleed = !gate && (story.id === 'intro' || (story.id === 'closing' && variants.finale !== 'card'));
  // The cover is sized to fit by design; the full-bleed finales (receipt, credits…) still need the safety net.
  useFitContent(root, !fullBleed || story.id === 'closing');
  if (gate && story.play) {
    return <div ref={root} className={`recap-story-content ${className}`} style={style} aria-live={live ? 'polite' : undefined} aria-hidden={live ? undefined : true} inert={!live || undefined}>
      <PlayGate play={story.play} eyebrow={story.eyebrow} seed={run} onDone={result => onAnswer?.(result)} />
    </div>;
  }
  const lines = story.title.split('\n').map(line => line.split(' '));
  const totalWords = lines.flat().length;
  if (fullBleed) {
    return <div ref={root} className={`recap-story-content ${className}`} style={style} aria-live={live ? 'polite' : undefined} aria-atomic={live || undefined} aria-hidden={live ? undefined : true} inert={!live || undefined}>
      <div className="recap-visual"><ChapterVisual story={story} periodId={periodId} onShare={onShare} variants={variants} run={run} score={score} /></div>
    </div>;
  }
  return <div ref={root} className={`recap-story-content ${className}`} style={style} aria-live={live ? 'polite' : undefined} aria-atomic={live || undefined} aria-hidden={live ? undefined : true} inert={!live || undefined}>
    {answer?.verdict ? <GameVerdict verdict={answer.verdict} /> : sticker}
    <p className={`recap-story-eyebrow${story.flavour ? ' has-mark' : ''}`}>{story.flavour ? <FlavourMark flavour={story.flavour} /> : null}{story.eyebrow}</p>
    <h2 className={story.title.length > 40 ? 'recap-title-long' : undefined} aria-label={story.title}>
      {lines.map((words, lineIndex) => <span className="recap-title-line" aria-hidden="true" key={lineIndex}>{words.map((word, i) => {
        const n = lineIndex * 5 + i;
        // The highlight take marks one word; the mixed take sets every other word in italic serif.
        const marked = remix.title === 'highlight' && n === remix.mark % Math.max(1, totalWords);
        const alt = remix.title === 'mixed' && n % 2 === 1;
        return <Fragment key={i}><span className={['recap-word-mask', marked && 'recap-mark', alt && 'recap-word-alt'].filter(Boolean).join(' ')}><span style={{ '--word': Math.min(14, n) } as CSSProperties}>{word}</span></span>{' '}</Fragment>;
      })}</span>)}
    </h2>
    <div className="recap-visual"><ChapterVisual story={story} periodId={periodId} onShare={onShare} variants={variants} run={run} score={score} /></div>
    {/* A body line appears only when it says something the visual doesn't. */}
    {story.body && <p className="recap-story-body">{story.body}</p>}
  </div>;
}

/**
 * A safety net for the many combinations of layout, copy and data: when a chapter's content runs past
 * its box, it is zoomed down until it fits, never below 72%. Measured from layout, not from the
 * mid-entrance transforms, and again once the fonts have loaded or the card changes size.
 */
function useFitContent(ref: RefObject<HTMLDivElement | null>, enabled: boolean) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    const fit = () => {
      element.style.removeProperty('--fit');
      delete element.dataset.fit;
      for (let pass = 0; pass < 2; pass++) {
        const children = [...element.children].filter((child): child is HTMLElement => child instanceof HTMLElement && getComputedStyle(child).position !== 'absolute');
        if (!children.length) return;
        const styles = getComputedStyle(element);
        const available = element.clientHeight - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom);
        const top = Math.min(...children.map(child => child.offsetTop - parseFloat(getComputedStyle(child).marginTop)));
        const bottom = Math.max(...children.map(child => child.offsetTop + child.offsetHeight + parseFloat(getComputedStyle(child).marginBottom)));
        const used = bottom - top;
        if (used <= available + 1) return;
        const current = Number(element.style.getPropertyValue('--fit') || 1);
        element.style.setProperty('--fit', Math.max(.72, current * available / used).toFixed(3));
        element.dataset.fit = '';
      }
    };
    fit();
    let alive = true;
    void document.fonts?.ready.then(() => { if (alive) fit(); });
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => { alive = false; observer.disconnect(); };
  }, [ref, enabled]);
}

// The sound button cycles: off, then effects and haptics, then effects with the groove.
const nextSoundMode: Record<SoundMode, SoundMode> = { off: 'fx', fx: 'music', music: 'off' };
const soundLabels: Record<SoundMode, string> = { off: 'Sound off. Turn on effects and haptics', fx: 'Effects on. Add music', music: 'Effects and music on. Turn sound off' };
const transitionSounds: Record<Transition, Sound> = {
  slide: 'whoosh', drop: 'thud', zoom: 'zoom', flip: 'flap', spin: 'whirl', glitch: 'glitch', iris: 'bloom', blinds: 'shutter', curtain: 'swish', rewind: 'rewind',
  train: 'whoosh', elevator: 'swish', chomp: 'arcade',
};

/** Sounds timed to a chapter's choreography: slot-machine ticks, stamps landing, the finale. */
function arrivalSounds(story: RecapStory, enter: number, variants: SectionVariants) {
  if (story.id === 'interlude') {
    const cue: Record<typeof story.variant, Sound> = { marquee: 'chord', orbit: 'shimmer', tunnel: 'warp', liquid: 'pour', rain: 'patter', kaleido: 'chord', ejected: 'buzz' };
    play(cue[story.variant], enter + 200);
    // One whoosh per category floated off, then a thud for the culprit.
    if (story.variant === 'ejected') {
      const suspects = Math.min(3, story.orbit.length - 1);
      for (let i = 0; i < suspects; i++) play('whoosh', enter + i * EJECT_STEP_MS + 150);
      play('thud', enter + suspects * EJECT_STEP_MS + 200);
    }
    if (story.variant === 'marquee') play('horn', enter + 700);
  }
  if (story.id === 'bonus') {
    // Each bonus slide has its own cue, timed to its choreography in recaps.css.
    const kind = story.bonus.kind;
    if (kind === 'payday') { play('cash', enter + 300); for (let i = 0; i < 3; i++) play('coin', enter + 700 + i * 160); }
    if (kind === 'boss') { play('arcade', enter + 200); play('whoosh', enter + 1100); play('thud', enter + 1400); playTicks(10, 900, enter + 1500); }
    if (kind === 'suspects') { play('drumroll', enter + 100); play('shutter', enter + 1000); play('shutter', enter + 1500); }
    if (kind === 'milestone') { playTicks(18, 1400, enter + 300); play('fanfare', enter + 1800); }
    if (kind === 'takeover') { playTicks(16, 1500, enter + 300); play('horn', enter + 1900); play('cymbal', enter + 2100); }
    if (kind === 'comeback') { play('rewind', enter + 200); play('riser', enter + 700); play('chord', enter + 1600); }
  }
  if (story.id === 'year') {
    // A year's insights deal their months out: a tick per month, then a cue for the reveal.
    const kind = story.insight.kind;
    const months = kind === 'regulars' ? story.insight.regulars.length + story.insight.cameos.length : story.insight.months.length;
    playTicks(months, months * 70, enter + 250);
    play(kind === 'headliners' ? 'cymbal' : kind === 'green' ? 'cash' : kind === 'personas' ? 'chord' : 'pop', enter + 300 + months * 80);
  }
  if (story.id === 'persona') {
    // Each personality has its own entrance: a gong for the monk, a club drop for the weekend warrior.
    play('drumroll', enter);
    const key = story.persona.key;
    if (key === 'monk') { play('gong', enter + 400); play('chord', enter + 1800); }
    if (key === 'weekend') { play('arcade', enter + 300); play('horn', enter + 800); play('patter', enter + 1000); }
    if (key === 'bigTicket') { play('shimmer', enter + 400); play('cash', enter + 1100); }
    if (key === 'steady') { play('pour', enter + 400); for (let i = 0; i < 8; i++) play('tick', enter + 700 + i * 90); }
    if (key === 'loyal') { for (let i = 0; i < Math.min(10, story.persona.figure); i++) play('pop', enter + 600 + i * 140); play('thunk', enter + 2100); }
    if (key === 'devotee') { play('fanfare', enter + 500); play('cymbal', enter + 1300); }
    if (key === 'explorer') { play('whirl', enter + 300); play('ding', enter + 1300); play('pop', enter + 2700); }
    if (key === 'allRounder') { for (let i = 0; i < 6; i++) play('pop', enter + 400 + i * 300); }
  }
  if (story.id === 'overview') {
    if (variants.overview === 'coins') for (let i = 0; i < 10; i++) play('coin', enter + 500 + i * 110);
    if (variants.overview === 'scale') { play('flap', enter + 600); play('thunk', enter + 2300); }
    if (variants.overview === 'donut') play('bloom', enter + 300);
    if (variants.overview === 'bucket') { play('pour', enter + 300); play('swish', enter + 1600); }
  }
  if (story.id === 'budget' && variants.budget === 'gauge') { play('zoom', enter + 300); play('tick', enter + 1500); }
  if (story.id === 'comparison' && variants.versus === 'versus') { play('thud', enter + 450); play('thud', enter + 600); play('ding', enter + 950); }
  if (story.id === 'mixtape') play('needle', enter + 300);
  if (story.id === 'closing') {
    if (variants.finale === 'receipt') { playTicks(10, 1400, enter + 250); play('cash', enter + 1700); }
    if (variants.finale === 'credits') { play('chord', enter + 300); play('fanfare', enter + 3300); }
    if (variants.finale === 'certificate') { play('fanfare', enter + 600); play('thunk', enter + 1300); }
    if (variants.finale === 'scoreboard') { play('arcade', enter + 400); playTicks(6, 1600, enter + 500); }
  }
  if (story.id === 'intro') {
    if (variants.intro === 'magazine') { playTicks(7, 700, enter); play('shutter', enter + 850); play('pop', enter + 950); }
    if (variants.intro === 'poster') { play('thunk', enter + 650); play('bloom', enter + 700); }
    if (variants.intro === 'vinyl') { play('thunk', enter + 400); play('needle', enter + 1100); play('scratch', enter + 1300); }
    if (variants.intro === 'boarding') { play('ding', enter + 200); play('whoosh', enter + 700); play('thunk', enter + 1500); }
  }
  if (story.id === 'overview') playTicks(16, 1500, enter + 380);
  if (story.id === 'habits' && story.repeat) play('thunk', enter + 1000);
  if (story.id === 'calendar' && story.peak) play('pop', enter + 1500);
  if (story.id === 'receipts' && variants.receipts === 'print') playTicks(8, 1300, enter + 250);
  if (story.id === 'closing' && variants.finale === 'card') { playTicks(12, 1400, enter + 380); play('fanfare', enter + 900); play('horn', enter + 1300); }
}

/** The title sequence before the cover: the brand, the period, then the card opens on the story. */
function OpeningTitles({ variant, name, paper, crawl, onSkip }: { variant: Opening; name: string; paper: string; crawl: ReturnType<typeof crawlText>; onSkip: () => void }) {
  // The longer openings are a tap away from skipping, like the crawl.
  const tape = (children: ReactNode) => <div className={`recap-opening recap-opening-tape recap-opening-${variant}`} role="button" tabIndex={0} aria-label="Skip the opening"
    style={{ '--wipe': paper, '--open': `${OPENING_DURATIONS[variant] ?? OPENING_MS}ms` } as CSSProperties}
    onClick={event => { event.stopPropagation(); onSkip(); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSkip(); } }}>{children}</div>;
  if (variant === 'vhs') return tape(<>
    <i className="recap-vhs-noise" aria-hidden="true" /><i className="recap-vhs-band" aria-hidden="true" />
    <p className="recap-vhs-osd" aria-hidden="true"><b>PLAY ▶</b><span>SP 0:00:01</span></p>
    <div className="recap-vhs-title"><span>fainens presents</span><strong>{name}</strong></div>
  </>);
  if (variant === 'needle') return tape(<>
    <span className="recap-needle-record" aria-hidden="true"><span className="recap-needle-label">{name}</span></span>
    <i className="recap-needle-arm" aria-hidden="true" />
  </>);
  if (variant === 'news') return tape(<>
    <i className="recap-news-globe" aria-hidden="true" />
    <span className="recap-news-bug"><i aria-hidden="true" />Live</span>
    <div className="recap-news-lower"><b>Breaking</b><strong>{name}: the recap</strong></div>
    <p className="recap-news-ticker"><span>{crawl.paragraphs.join('  ✳  ')}</span></p>
  </>);
  if (variant === 'start') return tape(<>
    <div className="recap-start-logo"><strong>FAINENS</strong><span>{name}</span><b className="recap-start-press">Press start</b></div>
    <i className="recap-start-flash" aria-hidden="true" />
  </>);
  if (variant === 'crawl') {
    // A long time ago, then the crawl rolls away into the stars. A tap skips it.
    return <div className="recap-opening recap-opening-crawl" role="button" tabIndex={0} aria-label="Skip the opening crawl"
      onClick={event => { event.stopPropagation(); onSkip(); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSkip(); } }}>
      <p className="recap-crawl-intro">A long time ago, in a<br />salary period not so far away…</p>
      <div className="recap-crawl-stage">
        <div className="recap-crawl-roll">
          <p className="recap-crawl-episode">{crawl.episode}</p>
          <p className="recap-crawl-title">{crawl.title}</p>
          {crawl.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
        </div>
      </div>
      <span className="recap-crawl-skip">Tap to skip</span>
    </div>;
  }
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
const ChapterBackdrop = memo(function ChapterBackdrop({ chapter, seed }: { chapter: string; seed: number }) {
  const motifs: Record<string, string> = {
    intro: seed % 2 === 0 ? 'portal' : 'contour', overview: 'current', budget: 'rail', categories: 'halo',
    calendar: 'orbit', weekdays: 'steps', streak: 'wave', receipts: 'receipt', habits: 'ripple', comparison: 'wave', closing: 'horizon',
    interlude: 'none', months: 'steps', mixtape: 'orbit', persona: 'halo',
  };
  return <div className={`recap-backdrop recap-backdrop-${motifs[chapter] ?? 'contour'} recap-backdrop-edition-${seed % 3}`} aria-hidden="true">
    {[0, 1, 2, 3].map(ring => <i key={ring} style={{ '--ring': ring } as CSSProperties} />)}
  </div>;
});
