import { Link } from '@tanstack/react-router';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Download, Flag, Plane, Repeat2, type LucideIcon } from 'lucide-react';
import { Fragment, memo, type CSSProperties, type ReactNode } from 'react';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { ScratchCover } from './Interactive';
import { PersonaScene } from './PersonaScenes';
import { CategoryIcon } from '../categories/CategoryIcon';
import { useCategoriesQuery } from '../categories/queries';
import { AnimatedValue, RollingValue } from './AnimatedValue';
import { Burst } from './Burst';
import { BonusVisual } from './BonusVisuals';
import { useLoadedPart } from './parts';
import { seeded, type SectionVariants } from './motion';
import { formatRecapDay, recapWeekday, WEEKDAYS, type RecapDayCell, type RecapStory } from './stories';
import { personaIcons } from './personaIcons';

type Of<Id extends RecapStory['id']> = Extract<RecapStory, { id: Id }>;
type Shared = { variants: SectionVariants; run: number };
export type QuizScore = { correct: number; total: number };
const seq = (n: number) => ({ '--seq': n }) as CSSProperties;
/** A glass's figure: ink over the empty glass, and a paper copy clipped to wherever the liquid has reached. */
const glassValue = (value: ReactNode) => <>
  <span className="recap-glass-value">{value}</span>
  <span className="recap-glass-value is-wet" aria-hidden="true">{value}</span>
</>;
const Money = ({ value }: { value: number }) => <AnimatedValue value={value} money />;
// Category colours are tuned for the app's surfaces; on the story's tinted paper a muted step of the ink
// keeps unnamed or uncoloured slices legible.
const fallbackTones = [1, .72, .52, .38, .26];

// Memoised: toasts, pausing and the leaving layer re-render the viewer, but not the chapter's visual.
export const ChapterVisual = memo(ChapterVisualFor);

function ChapterVisualFor({ story, periodId, onShare, variants, run, score }: { story: RecapStory; periodId: number; onShare: () => void; score: QuizScore } & Shared) {
  const shared = { variants, run };
  // Second looks come from lazily loaded groups; each is used only if it arrived before this chapter
  // mounted, otherwise the house layout plays (see parts.ts).
  const alt = (id: RecapStory['id']) => ({ weekdays: variants.weekdays !== 'bars', streak: variants.streak !== 'strip', habits: variants.habits !== 'trio',
    mixtape: variants.mixtape !== 'cassette', months: variants.months !== 'bars' } as Partial<Record<RecapStory['id'], boolean>>)[id] ?? false;
  const layouts = useLoadedPart('layouts', alt(story.id));
  const personaExtra = useLoadedPart('persona', story.id === 'persona' && variants.persona === 'alt');
  const bonusExtra = useLoadedPart('bonus', story.id === 'bonus' && variants.bonus === 'alt');
  // The year's insights have no house layout; the group loads when a year opens, long before they come up.
  const yearExtra = useLoadedPart('year', story.id === 'year');
  switch (story.id) {
    case 'intro': return <CoverVisual story={story} {...shared} />;
    case 'overview': return <FlowVisual story={story} {...shared} />;
    case 'months': return layouts ? <layouts.MonthsAlt story={story} variant={variants.months} /> : <MonthsVisual story={story} />;
    case 'interlude': return <InterludeVisual story={story} run={run} />;
    case 'mixtape': return layouts ? <layouts.MixtapeAlt story={story} variant={variants.mixtape} /> : <MixtapeVisual story={story} />;
    case 'persona': return <PersonaVisual story={story} run={run} scene={personaExtra ? <personaExtra.AltPersonaScene persona={story.persona} run={run} /> : undefined} />;
    case 'bonus': return bonusExtra ? <bonusExtra.AltBonusVisual story={story} /> : <BonusVisual story={story} />;
    case 'year': return yearExtra ? <yearExtra.YearVisual story={story} /> : null;
    case 'pace': return <PaceVisual story={story} />;
    case 'budget': return <BudgetVisual story={story} periodId={periodId} gauge={variants.budget === 'gauge'} />;
    case 'categories': return <CategoriesVisual story={story} {...shared} />;
    case 'calendar': return <CalendarVisual story={story} {...shared} />;
    case 'weekdays': return layouts ? <layouts.WeekdaysAlt story={story} variant={variants.weekdays} /> : <WeekdaysVisual story={story} />;
    case 'streak': return layouts ? <layouts.StreakAlt story={story} variant={variants.streak} /> : <StreakVisual story={story} />;
    case 'receipts': return <ReceiptVisual story={story} {...shared} />;
    case 'habits': return layouts ? <layouts.HabitsAlt story={story} variant={variants.habits} /> : <HabitsVisual story={story} />;
    case 'comparison': return <ComparisonVisual story={story} {...shared} />;
    case 'closing': return <ClosingVisual story={story} periodId={periodId} onShare={onShare} score={score} {...shared} />;
  }
}

/** A headline whose words rise in one after another, from `start`. */
function Words({ text, start = 0 }: { text: string; start?: number }) {
  return text.split(/\s+/).map((word, i) => <Fragment key={i}><span className="recap-word-mask"><span style={{ '--word': start + i } as CSSProperties}>{word}</span></span>{' '}</Fragment>);
}
const letters = (word: string) => [...word].map((letter, i) => <span key={i} style={{ '--l': i } as CSSProperties}>{letter}</span>);

/** The cover owns the whole card, and each run prints it as a different object. */
function CoverVisual({ story, variants, run }: { story: Of<'intro'> } & Shared) {
  const { cover } = story;
  // In a year in review the month word is the year itself, so the second line says what it is.
  const second = story.monthWord === cover.year ? 'Year' : cover.year;
  const headline = <h2 className="recap-cover-headline" aria-label={story.title}><Words text={story.title} start={3} /></h2>;
  switch (variants.intro) {
    case 'magazine': return <div className="recap-cover recap-cover-magazine">
      <span className="recap-mag-bigword" aria-hidden="true">{story.monthWord}</span>
      <div className="recap-mag-masthead" aria-hidden="true">{letters('fainens')}<b>✳</b></div>
      <div className="recap-mag-rule"><span>Issue Nº {cover.issue}</span><span>{story.isPartial ? 'Live edition' : 'Collector’s edition'}</span><span>Rp0</span></div>
      <div className="recap-mag-middle">
        <ul className="recap-mag-lines">{cover.teasers.map((line, i) => <li key={line} style={{ '--c': i } as CSSProperties}><b>+</b>{line}</li>)}</ul>
        <div className="recap-mag-sticker"><small>Inside</small><strong>{cover.purchaseCount}</strong><small>receipts</small></div>
      </div>
      <Burst seed={run} kind="sparkle" count={14} origin="title" delay={1200} />
      {headline}
      <div className="recap-mag-foot"><span className="recap-barcode" aria-hidden="true" /><span>{story.dateRange}</span></div>
    </div>;
    case 'poster': return <div className="recap-cover recap-cover-poster">
      <div className="recap-poster-grid" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map(i => <i key={i} style={{ '--g': i } as CSSProperties} />)}</div>
      <span className="recap-poster-month" style={{ '--n': story.monthWord.length } as CSSProperties} aria-hidden="true">{letters(story.monthWord)}</span>
      <span className="recap-poster-year" aria-hidden="true">{second}</span>
      <span className="recap-poster-dot" aria-hidden="true" />
      <div className="recap-poster-meta"><span>{cover.startLabel} — {cover.endLabel}</span><span>Nº {cover.issue}</span><span>{cover.chapterCount} chapters</span></div>
      <div className="recap-poster-copy">{headline}<p>{story.body}</p></div>
    </div>;
    case 'vinyl': return <div className="recap-cover recap-cover-vinyl">
      <div className="recap-vinyl-stage" aria-hidden="true">
        <div className="recap-vinyl-disc"><span className="recap-vinyl-label"><b>✳</b><small>{story.monthWord}</small></span></div>
        <div className="recap-vinyl-sleeve">
          <span className="recap-sleeve-art">{story.monthWord}</span>
          <span className="recap-sleeve-artist">fainens ✳ {second}</span>
          <span className="recap-advisory"><b>Parental advisory</b><small>Explicit receipts</small></span>
        </div>
      </div>
      <p className="recap-vinyl-kicker">{story.isPartial ? 'Out now · still recording' : 'Out now'} · Deluxe edition · {cover.chapterCount} tracks</p>
      {headline}
      <p className="recap-cover-body">{story.body}</p>
    </div>;
    case 'boarding': return <div className="recap-cover recap-cover-boarding">
      {headline}
      <div className="recap-pass">
        <div className="recap-pass-head"><span>✳ Fainens Air</span><span>Boarding pass</span></div>
        <div className="recap-pass-route">
          <div><small>From</small><strong>{cover.startLabel}</strong></div>
          <div className="recap-pass-path" aria-hidden="true"><i className="recap-plane"><Plane /></i></div>
          <div><small>To</small><strong>{cover.endLabel}</strong></div>
        </div>
        <div className="recap-pass-grid">
          <div><small>Passenger</small><b>{cover.passenger}</b></div><div><small>Flight</small><b>FN {cover.issue}</b></div>
          {/* The fourth column is left for the LANDED stamp, so it never prints over a value. */}
          <div><small>Seat</small><b>{cover.seat}</b></div><div aria-hidden="true" />
        </div>
        <div className="recap-pass-stub"><span className="recap-barcode" aria-hidden="true" /><span>{cover.chapterCount} stops · {cover.purchaseCount} receipts</span></div>
        <span className="recap-pass-stamp" aria-hidden="true">{story.isPartial ? 'In flight' : 'Landed'}</span>
      </div>
      <p className="recap-cover-body">{story.body}</p>
    </div>;
  }
}

/** Money in against money out, drawn as one of five objects a run picks. */
function FlowVisual({ story, run, variants }: { story: Of<'overview'> } & Shared) {
  const income = Math.max(0, story.income);
  const spent = Math.max(0, story.expenses);
  const max = Math.max(income, spent, 1);
  const spentShare = income > 0 ? Math.min(1, spent / income) : 1;
  const keep = story.net >= 0 ? story.keptShare : null;
  const legend = <dl className="recap-pair recap-seq" style={seq(5)}>
    <div><dt>Came in</dt><dd><RollingValue value={income} /></dd></div>
    <div><dt>Went out</dt><dd><RollingValue value={spent} /></dd></div>
  </dl>;
  const leftChip = <p className="recap-flow-chip recap-seq" style={seq(6)}><span>{story.net >= 0 ? 'Left over' : 'Short by'}</span><strong><Money value={Math.abs(story.net)} /></strong>{keep !== null && <em>{keep}%</em>}</p>;
  switch (variants.overview) {
    case 'scale': {
      // The beam tips toward the heavier side: income down when more came in than went out.
      const tilt = Math.max(-16, Math.min(16, (spent - income) / max * 16));
      return <div className="recap-flow-scale">
        <div className="recap-scale" style={{ '--tilt': `${tilt}deg` } as CSSProperties} aria-hidden="true">
          <div className="recap-scale-beam">
            <span className="recap-scale-pan recap-scale-in"><b /><small>In</small></span>
            <span className="recap-scale-pan recap-scale-out"><b /><small>Out</small></span>
          </div>
          <i className="recap-scale-post" />
        </div>
        {legend}{leftChip}
      </div>;
    }
    case 'coins': {
      const coinsIn = Math.max(1, Math.round(income / max * 12));
      const coinsOut = Math.max(spent > 0 ? 1 : 0, Math.round(spent / max * 12));
      const keptCoins = Math.max(0, coinsIn - coinsOut);
      return <div className="recap-flow-coins">
        <div className="recap-coin-towers" aria-hidden="true">
          {[{ key: 'in', count: coinsIn, label: 'Came in' }, { key: 'out', count: coinsOut, label: 'Went out' }].map((tower, t) => <div key={tower.key} className={`recap-coin-tower recap-coin-${tower.key}`}>
            <div>{Array.from({ length: tower.count }, (_, i) => <i key={i} className={tower.key === 'in' && i >= tower.count - keptCoins ? 'is-kept' : undefined} style={{ '--c': i, '--t': t } as CSSProperties} />)}</div>
            <span>{tower.label}</span>
          </div>)}
        </div>
        {legend}{leftChip}
      </div>;
    }
    case 'donut': {
      const r = 40; const circumference = 2 * Math.PI * r;
      return <div className="recap-flow-donut">
        <div className="recap-donut" aria-hidden="true">
          <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r={r} className="recap-donut-track" />
            <circle cx="50" cy="50" r={r} className="recap-donut-spent" style={{ '--dash': circumference, '--arc': circumference * spentShare } as CSSProperties} /></svg>
          <span><strong>{keep !== null ? <AnimatedValue value={keep} suffix="%" /> : <AnimatedValue value={Math.round(spentShare * 100)} suffix="%" />}</strong><small>{keep !== null ? 'left over' : 'went out'}</small></span>
        </div>
        {legend}{leftChip}
      </div>;
    }
    case 'bucket':
      return <div className="recap-flow-bucket">
        {/* Income pours in to the brim, then expenses drain it down to what was left. */}
        <div className="recap-glass recap-bucket" style={{ '--level': keep !== null ? keep / 100 : 0 } as CSSProperties} aria-hidden="true">
          <div className="recap-liquid-fill recap-bucket-fill"><svg viewBox="0 0 200 20" preserveAspectRatio="none"><path d="M0 10 Q25 0 50 10 T100 10 T150 10 T200 10 V20 H0 Z" /></svg></div>
          {glassValue(keep !== null ? <AnimatedValue value={keep} suffix="%" /> : '0%')}
        </div>
        {legend}{leftChip}
      </div>;
    default: return <FlowBars story={story} run={run} max={max} />;
  }
}

function FlowBars({ story, run, max }: { story: Of<'overview'>; run: number; max: number }) {
  const { balancesHidden } = useBalanceVisibility();
  const net = <div className="recap-flow-net recap-seq" style={seq(5)}>
    <span>{story.net >= 0 ? 'Left over' : 'Short by'}</span>
    <strong><RollingValue value={Math.abs(story.net)} /></strong>
    {story.keptShare !== null && <em>{story.keptShare}% of income</em>}
  </div>;
  const rows = [
    { key: 'in', label: 'Came in', value: story.income },
    { key: 'out', label: 'Went out', value: Math.max(0, story.expenses) },
  ];
  return <div className="recap-flow">
    {story.lead === 'ratio' && story.spentPer100 !== null && <div className="recap-big-stat recap-seq" style={seq(2.5)}><AnimatedValue value={story.spentPer100} suffix="%" /><span>of income went to expenses</span></div>}
    {rows.map((row, i) => <div key={row.key} className={`recap-flow-row recap-flow-${row.key} recap-seq`} style={seq(3 + i)}>
      <div className="recap-flow-head"><span>{row.label}</span><strong><RollingValue value={row.value} /></strong></div>
      <div className="recap-flow-track" aria-hidden="true"><i style={{ '--fill': row.value / max, ...seq(3 + i) } as CSSProperties} /></div>
    </div>)}
    {/* Hidden balances stay hidden: there is nothing to scratch for. */}
    {story.lead === 'left' && (balancesHidden || story.reveal !== 'scratch' ? net : <ScratchCover seed={run}>{net}</ScratchCover>)}
  </div>;
}

/** Showpiece slides: pure motion, with at most one figure to hold on to. */
function InterludeVisual({ story, run }: { story: Of<'interlude'>; run: number }) {
  const random = seeded(run + story.slot * 97 + 5);
  switch (story.variant) {
    case 'marquee': {
      const line = `${story.words.join('  ✳  ')}  ✳  `;
      return <div className="recap-interlude recap-marquee" aria-hidden="true">
        <div className="recap-marquee-tilt">{[0, 1, 2, 3, 4].map(row => <div key={row} className={`recap-marquee-row${row % 2 ? ' is-reverse is-outline' : ''}`} style={{ '--row': row } as CSSProperties}><span>{line}{line}</span></div>)}</div>
        <span className="recap-marquee-badge">✳ Intermission ✳</span>
      </div>;
    }
    case 'orbit': {
      const [sun, ...planets] = story.orbit;
      return <div className="recap-interlude recap-orbit" aria-hidden="true">
        {planets.slice(0, 4).map((planet, i) => <div key={planet.name} className="recap-orbit-ring" style={{ '--o': i } as CSSProperties}>
          <span className="recap-orbit-planet"><CategoryIcon name={planet.name} color="currentColor" className="h-[1em] w-[1em]" /></span>
        </div>)}
        <div className="recap-orbit-sun"><CategoryIcon name={sun.name} color="currentColor" className="h-[1em] w-[1em]" /><span>{sun.label}</span></div>
      </div>;
    }
    case 'tunnel':
      return <div className="recap-interlude recap-tunnel" aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => <i key={i} style={{ '--t': i } as CSSProperties} />)}
        <div className="recap-tunnel-core"><AnimatedValue value={story.value} /><span>receipts</span></div>
      </div>;
    case 'liquid':
      return <div className="recap-interlude recap-liquid" aria-hidden="true">
        <div className="recap-glass" style={{ '--level': (story.share ?? 0) / 100 } as CSSProperties}>
          <div className="recap-liquid-fill"><svg viewBox="0 0 200 20" preserveAspectRatio="none"><path d="M0 10 Q25 0 50 10 T100 10 T150 10 T200 10 V20 H0 Z" /></svg><svg viewBox="0 0 200 20" preserveAspectRatio="none"><path d="M0 10 Q25 20 50 10 T100 10 T150 10 T200 10 V20 H0 Z" /></svg></div>
          {Array.from({ length: 7 }, (_, i) => <b key={i} className="recap-bubble" style={{ '--bx': `${10 + random() * 80}%`, '--bd': `${random() * 2.5}s`, '--bs': .6 + random() * .8 } as CSSProperties} />)}
          {glassValue(<AnimatedValue value={story.share ?? 0} suffix="%" />)}
        </div>
      </div>;
    case 'rain': {
      const slips = Math.min(36, Math.max(6, story.value));
      return <div className="recap-interlude recap-rain" aria-hidden="true">
        {Array.from({ length: slips }, (_, i) => <i key={i} className="recap-rain-slip" style={{ '--rx': `${4 + random() * 82}%`, '--rr': `${(random() - .5) * 70}deg`, '--rd': `${random() * 1400}ms`, '--rp': `${Math.floor(i / 7) * 4 + random() * 3}cqw` } as CSSProperties} />)}
        <span className="recap-rain-count"><AnimatedValue value={story.value} /><small>receipts</small></span>
      </div>;
    }
    case 'ejected': {
      // Smaller categories float off into space one at a time; the last one standing is the culprit.
      const [culprit, ...rest] = story.orbit;
      const suspects = rest.slice(0, 3).reverse();
      return <div className="recap-interlude recap-ejected">
        {suspects.map((suspect, k) => <Fragment key={suspect.name}>
          <span className="recap-eject-body" style={{ '--k': k } as CSSProperties} aria-hidden="true"><CategoryIcon name={suspect.name} color="currentColor" className="h-[1em] w-[1em]" /></span>
          <p className="recap-eject-line" style={{ '--k': k } as CSSProperties}><span className="recap-eject-type">{story.verdicts.innocent.replace('{x}', suspect.label)}</span><small>{story.verdicts.remain.replace('{n}', String(suspects.length - k))}</small></p>
        </Fragment>)}
        <span className="recap-eject-culprit" style={{ '--k': suspects.length } as CSSProperties} aria-hidden="true"><CategoryIcon name={culprit.name} color="currentColor" className="h-[1em] w-[1em]" /></span>
        <p className="recap-eject-line recap-eject-final" style={{ '--k': suspects.length } as CSSProperties}><span className="recap-eject-type">{story.verdicts.guilty.replace('{x}', culprit.label)}</span><small>{culprit.share}% of everything that went out</small></p>
      </div>;
    }
    case 'kaleido':
      return <div className="recap-interlude recap-kaleido" aria-hidden="true">
        <i /><i /><i />
        <b>✳</b>
      </div>;
  }
}

function MonthsVisual({ story }: { story: Of<'months'> }) {
  const max = Math.max(1, ...story.months.map(month => month.amount));
  return <div className="recap-weekdays">
    <div className="recap-big-stat recap-seq" style={seq(3)}><span className="recap-stat-word">{story.months[story.busiest].label}</span><span>the biggest month of the year</span></div>
    <div className="recap-week-bars recap-month-bars recap-seq" style={{ ...seq(4), gridTemplateColumns: `repeat(${story.months.length}, minmax(0, 1fr))` }} role="img" aria-label={`Spending by month, highest in ${story.months[story.busiest].label}`}>
      {story.months.map((month, i) => <div key={month.label} className={i === story.busiest ? 'is-top' : undefined}>
        <i style={{ '--fill': month.amount / max, '--i': i } as CSSProperties} />
        <span>{month.label.slice(0, 3)}</span>
      </div>)}
    </div>
    <p className="recap-fact recap-seq" style={seq(6)}>{story.months[story.busiest].label}: <Money value={story.months[story.busiest].amount} /></p>
  </div>;
}

function MixtapeVisual({ story }: { story: Of<'mixtape'> }) {
  return <div className="recap-mixtape">
    <div className="recap-cassette" aria-hidden="true">
      <div className="recap-cassette-label"><span>{story.tapeName}</span><small>Side A · 30:00</small></div>
      <div className="recap-cassette-window"><i className="recap-reel" /><i className="recap-reel" /><b /></div>
    </div>
    <ol className="recap-tracklist">
      {story.tracks.map((track, i) => <li key={track.title} className="recap-seq" style={seq(4 + i * .5)}>
        <span className="recap-track-no">A{i + 1}</span>
        <span className="recap-track-name"><span>{track.title}</span><small>{track.artist}</small></span>
        <span className="recap-track-length">{track.length}</span>
      </li>)}
    </ol>
  </div>;
}

function PersonaVisual({ story, run, scene }: { story: Of<'persona'>; run: number; scene?: ReactNode }) {
  const { persona } = story;
  return <div className={`recap-persona recap-persona-${persona.key}`}>
    {scene ?? <PersonaScene persona={persona} run={run} />}
    <p className="recap-persona-name recap-seq" style={seq(8)}>{persona.name}</p>
    <p className="recap-persona-tagline recap-seq" style={seq(8.6)}>{persona.tagline}{persona.dash ? ` With a dash of ${persona.dash}.` : ''}</p>
    <ul className="recap-chips recap-persona-evidence">{persona.evidence.slice(0, 2).map((item, i) => <li key={item} style={{ '--c': i } as CSSProperties}>{item}</li>)}</ul>
  </div>;
}

/** A spinning medallion: the persona's icon, ringed by the recap's own lettering. */
function PersonaBadge({ personaKey, Icon, small = false }: { personaKey: string; Icon: LucideIcon; small?: boolean }) {
  return <span className={`recap-persona-badge${small ? ' is-small' : ''}`} aria-hidden="true">
    <svg viewBox="0 0 100 100" className="recap-persona-ring">
      <defs><path id={`ring-${personaKey}${small ? '-s' : ''}`} d="M50,50 m-38,0 a38,38 0 1,1 76,0 a38,38 0 1,1 -76,0" /></defs>
      {/* One pass of lettering stretched to the ring's circumference (2π × 38), so it meets itself cleanly. */}
      <text><textPath href={`#ring-${personaKey}${small ? '-s' : ''}`} textLength="236" lengthAdjust="spacing">MONEY PERSONALITY ✳ FAINENS ✳ </textPath></text>
    </svg>
    <span className="recap-persona-core"><Icon /></span>
  </span>;
}

function BudgetVisual({ story, periodId, gauge }: { story: Of<'budget'>; periodId: number; gauge: boolean }) {
  const used = story.percentUsed;
  const over = story.remaining < 0;
  // The speedometer's arc spans 206° about its centre; its far end is 125% of the plan, the red zone.
  const angle = (share: number) => -103 + Math.min(1, Math.max(0, share / 125)) * 206;
  return <div className="recap-budget">
    {gauge && used !== null ? <div className={`recap-gauge recap-seq${over ? ' is-over' : ''}`} style={{ ...seq(3), '--needle': `${angle(used)}deg`, '--today': `${angle(story.elapsedShare ?? 0)}deg` } as CSSProperties}>
      <svg viewBox="0 0 200 120" aria-hidden="true">
        <path d="M 22 110 A 80 80 0 1 1 178 110" className="recap-gauge-track" pathLength={1} />
        <path d="M 22 110 A 80 80 0 1 1 178 110" className="recap-gauge-red" pathLength={1} />
        <path d="M 22 110 A 80 80 0 1 1 178 110" className="recap-gauge-fill" pathLength={1} style={{ '--fill': Math.min(1, Math.max(0, used / 125)) } as CSSProperties} />
      </svg>
      {story.elapsedShare !== null && <i className="recap-gauge-today" aria-hidden="true"><span>Today</span></i>}
      <i className="recap-gauge-needle" aria-hidden="true" />
      <span className="recap-gauge-value"><AnimatedValue value={used} suffix="%" /><small>of the plan used</small></span>
    </div> : <>
      <div className="recap-big-stat recap-seq" style={seq(3)}>
        {used !== null ? <><AnimatedValue value={used} suffix="%" /><span>of the plan used</span></> : <><Money value={story.spent} /><span>spent in budgeted categories</span></>}
      </div>
      <div className={`recap-meter recap-seq${over ? ' is-over' : ''}`} style={seq(4)} aria-hidden="true">
        <i style={{ '--fill': Math.min(1, Math.max(0, (used ?? 0) / 100)) } as CSSProperties} />
        {story.elapsedShare !== null && <b style={{ left: `${story.elapsedShare}%` }} className={story.elapsedShare > 85 ? 'is-end' : story.elapsedShare < 15 ? 'is-start' : undefined}><span>Today</span></b>}
      </div>
    </>}
    {story.elapsedShare !== null && used !== null && <p className="recap-fact recap-seq" style={seq(5)}>{used}% of the plan used, {story.elapsedShare}% of the period gone.</p>}
    <dl className="recap-pair recap-seq" style={seq(6)}>
      <div><dt>Planned</dt><dd><Money value={story.planned} /></dd></div>
      <div><dt>{over ? 'Over plan' : 'Still unspent'}</dt><dd><Money value={Math.abs(story.remaining)} /></dd></div>
    </dl>
    {story.over.length > 0 && <ul className="recap-chips recap-seq" style={seq(7)} aria-label="Categories above their allocation">
      {story.over.map(row => <li key={row.name}><span>{row.name}</span><strong>+<Money value={row.over} /></strong></li>)}
    </ul>}
    <Link to="/budget" search={{ periodId: String(periodId) }} className="recap-text-link recap-seq" style={seq(8)}>Open this period’s budget <ArrowRight size={14} /></Link>
  </div>;
}

function CategoriesVisual({ story, variants, run }: { story: Of<'categories'> } & Shared) {
  const categories = useCategoriesQuery();
  const lookup = new Map((categories.data ?? []).map(category => [category.id, category]));
  const colorOf = (row: { categoryId: number | null }, i: number) => {
    const color = row.categoryId != null ? lookup.get(row.categoryId)?.color : null;
    return color ?? `color-mix(in srgb, var(--recap-ink) ${fallbackTones[i] * 100}%, transparent)`;
  };
  const top = story.rows[0];
  const random = seeded(run + 17);
  // In the assemble take each slice flies in from somewhere else on the card and snaps into place.
  const segments = [...story.rows.map((row, i) => ({ key: row.name, share: row.share, color: colorOf(row, i) })),
    ...(story.others ? [{ key: 'others', share: story.others.share, color: 'color-mix(in srgb, var(--recap-ink) 18%, transparent)' }] : [])]
    .map(segment => ({ ...segment, dx: (random() - .5) * 120, dy: (random() - .5) * 160, dr: (random() - .5) * 140 }));
  const stat = story.lead === 'top3' ? { value: story.top3Share, suffix: '%', label: 'of spending went to the top three' }
    : story.lead === 'count' ? { value: story.count, suffix: '', label: story.count === 1 ? 'category with spending' : 'categories with spending' }
      : { value: top.share, suffix: '%', label: `of spending went to ${top.label}` };
  return <div className={`recap-categories recap-categories-${variants.categories}`}>
    <div className="recap-big-stat recap-seq" style={seq(3)}><AnimatedValue value={stat.value} suffix={stat.suffix} /><span>{stat.label}</span></div>
    <div className="recap-share-bar recap-seq" style={seq(4)} aria-hidden="true">
      {segments.map((segment, i) => <i key={segment.key} style={{ flexGrow: Math.max(segment.share, 1), background: segment.color, '--i': i, '--dx': `${segment.dx}cqw`, '--dy': `${segment.dy}cqw`, '--dr': `${segment.dr}deg` } as CSSProperties} />)}
    </div>
    <ol className="recap-category-list">
      {story.rows.map((row, i) => <li key={row.name} className={`recap-seq${story.lead === 'top3' && i < 3 ? ' is-picked' : ''}`} style={seq(5 + i * .6)}>
        <span className="recap-category-icon" style={{ '--tone': colorOf(row, i) } as CSSProperties}><CategoryIcon name={row.name} color="currentColor" className="h-[1em] w-[1em]" /></span>
        <span className="recap-category-name" title={row.name}>{row.label}</span>
        <span className="recap-category-share">{row.share}%</span>
        <strong><Money value={row.amount} /></strong>
      </li>)}
    </ol>
    {story.others && <p className="recap-fact recap-seq" style={seq(8.5)}>+ {story.others.count} more {story.others.count === 1 ? 'category' : 'categories'} · <Money value={story.others.amount} /></p>}
  </div>;
}

const weekdayInitials = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function CalendarVisual({ story, variants, run }: { story: Of<'calendar'> } & Shared) {
  const peak = story.peak;
  const peakLine = peak && <p className="recap-fact recap-seq" style={seq(6)}>
    Busiest: <strong>{formatRecapDay(peak.date, { weekday: 'long', day: 'numeric', month: 'short' })}</strong> · <Money value={peak.amount} /> across {peak.purchaseCount} {peak.purchaseCount === 1 ? 'purchase' : 'purchases'}
  </p>;
  const stat = story.lead === 'peak' && peak
    ? <div className="recap-big-stat recap-seq" style={seq(3)}><Money value={peak.amount} /><span>on the busiest day</span></div>
    : <div className="recap-big-stat recap-seq" style={seq(3)}><AnimatedValue value={story.spendingDays} /><span>of {story.elapsedDays} days had spending</span></div>;
  if (!story.days) {
    return <div className="recap-calendar">
      {stat}
      {peakLine}
      <p className="recap-fact recap-seq" style={seq(7)}>Refresh this recap for the day-by-day view.</p>
    </div>;
  }
  const max = Math.max(1, ...story.days.map(day => day.amount));
  // Monday-first week rows, with blanks before the period's first day.
  const lead = recapWeekday(story.days[0].date);
  const random = seeded(run + 29);
  const peakIndex = story.days.findIndex(day => day.peak);
  const origin = peakIndex >= 0 ? peakIndex + lead : Math.floor((story.days.length + lead) / 2);
  // How the days fill in: a sweep, a diagonal wash, a scatter, or a ripple out from the busiest day.
  const delayOf = (i: number) => {
    const slot = i + lead;
    const col = slot % 7; const row = Math.floor(slot / 7);
    if (variants.calendar === 'diagonal') return (row + col) * 42;
    if (variants.calendar === 'scatter') return random() * 650;
    if (variants.calendar === 'ripple') return Math.hypot(col - origin % 7, row - Math.floor(origin / 7)) * 85;
    return i * 16;
  };
  return <div className={`recap-calendar recap-calendar-${variants.calendar}`}>
    {stat}
    <div className="recap-calendar-grid recap-seq" style={seq(4)} role="img" aria-label={`Spending on ${story.spendingDays} of ${story.elapsedDays} days${peak ? `, busiest on ${formatRecapDay(peak.date, { weekday: 'long', day: 'numeric', month: 'long' })}` : ''}`}>
      {weekdayInitials.map((day, i) => <span key={`h${i}`} className="recap-calendar-weekday">{day}</span>)}
      {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
      {story.days.map((day, i) => <DayCell key={day.key} day={day} intensity={day.amount / max} delay={delayOf(i)} />)}
    </div>
    {story.week ? <WeekStrip week={story.week} /> : <div className="recap-calendar-legend recap-seq" style={seq(5)} aria-hidden="true"><span>Less</span>{HEAT.map(level => <i key={level} style={{ '--level': level } as CSSProperties} />)}<span>More</span></div>}
    {story.lead !== 'peak' && peakLine}
  </div>;
}

/** The weekday chapter folded into the calendar: the same week, summed, as a short strip of bars. */
function WeekStrip({ week }: { week: NonNullable<Of<'calendar'>['week']> }) {
  const max = Math.max(1, ...week.totals);
  return <div className="recap-week-bars is-mini recap-seq" style={seq(5)} role="img" aria-label={`By weekday: highest on ${WEEKDAYS[week.busiest]}, weekends ${week.weekendShare}%`}>
    {week.totals.map((total, i) => <div key={i} className={[i === week.busiest && 'is-top', i >= 5 && 'is-weekend'].filter(Boolean).join(' ')}>
      <i style={{ '--fill': total / max, '--i': i } as CSSProperties} />
      <span>{WEEKDAYS[i].slice(0, 2)}</span>
    </div>)}
  </div>;
}

// Heat comes in steps that skip the middle: on a mid-tone cell neither ink nor paper numbers stay legible.
const HEAT = [.1, .24, .8, .9, 1];
const heatLevel = (intensity: number) => HEAT[Math.min(HEAT.length - 1, Math.floor(Math.sqrt(intensity) * HEAT.length))];

function DayCell({ day, intensity, delay }: { day: RecapDayCell; intensity: number; delay: number }) {
  const level = day.amount > 0 ? heatLevel(intensity) : 0;
  return <span className={['recap-day', day.future && 'is-future', day.peak && 'is-peak', level > .5 && 'is-dark'].filter(Boolean).join(' ')}
    style={{ '--level': level, '--cell-delay': `${Math.round(delay)}ms` } as CSSProperties}>
    <small>{Number(day.key.slice(8))}</small>
  </span>;
}

function WeekdaysVisual({ story }: { story: Of<'weekdays'> }) {
  const max = Math.max(1, ...story.totals);
  return <div className="recap-weekdays">
    <div className="recap-big-stat recap-seq" style={seq(3)}>
      {story.lead === 'weekend' ? <><AnimatedValue value={story.weekendShare} suffix="%" /><span>of spending fell on weekends</span></>
        : <><span className="recap-stat-word">{WEEKDAYS[story.busiest].slice(0, 3)}</span><span>the biggest day of the week</span></>}
    </div>
    <div className="recap-week-bars recap-seq" style={seq(4)} role="img" aria-label={`Spending by weekday, highest on ${WEEKDAYS[story.busiest]}`}>
      {story.totals.map((total, i) => <div key={i} className={[i === story.busiest && 'is-top', i >= 5 && 'is-weekend'].filter(Boolean).join(' ')}>
        <i style={{ '--fill': total / max, '--i': i } as CSSProperties} />
        <span>{WEEKDAYS[i].slice(0, 2)}</span>
      </div>)}
    </div>
    <p className="recap-fact recap-seq" style={seq(6)}>{WEEKDAYS[story.busiest]}s: <Money value={story.totals[story.busiest]} /> across the period.</p>
  </div>;
}

function StreakVisual({ story }: { story: Of<'streak'> }) {
  const run = story.lead === 'quiet' ? story.quiet : story.busy;
  const inRun = (i: number) => run !== null && i >= run.start && i < run.start + run.length;
  return <div className={`recap-streak recap-streak-${story.lead}`}>
    <div className="recap-big-stat recap-seq" style={seq(3)}><AnimatedValue value={run?.length ?? 0} /><span>{story.lead === 'quiet' ? 'days in a row without spending' : 'spending days in a row'}</span></div>
    <div className="recap-streak-strip recap-seq" style={seq(4)} aria-hidden="true">
      {story.days.map((day, i) => <i key={day.key} className={[day.amount > 0 && 'has-spend', inRun(i) && 'in-run'].filter(Boolean).join(' ')} style={{ '--i': i, '--r': inRun(i) ? i - run!.start : 0 } as CSSProperties} />)}
    </div>
    {run && <p className="recap-fact recap-seq" style={seq(6)}>
      {formatRecapDay(story.days[run.start].date, { day: 'numeric', month: 'short' })} – {formatRecapDay(story.days[run.start + run.length - 1].date, { day: 'numeric', month: 'short' })}
      {story.lead === 'quiet' && story.busy && story.busy.length >= 3 ? ` · longest spending run: ${story.busy.length} days` : ''}
      {story.lead === 'busy' && story.quiet && story.quiet.length >= 2 ? ` · longest pause: ${story.quiet.length} days` : ''}
    </p>}
  </div>;
}

function ReceiptVisual({ story, variants }: { story: Of<'receipts'> } & Shared) {
  return <div className={`recap-receipt-stage recap-receipt-${variants.receipts}`}>
    {variants.receipts === 'print' && <span className="recap-printer" aria-hidden="true" />}
    <div className="recap-receipt" style={seq(3)}>
      <p className="recap-receipt-head"><span>Top {story.items.length}</span><span>of {story.purchaseCount} purchases</span></p>
      <ol>
        {story.items.map((item, i) => <li key={`${i}:${item.fullLabel}`} className="recap-receipt-line" style={{ '--line': i } as CSSProperties}>
          <span className="recap-receipt-rank">{String(i + 1).padStart(2, '0')}</span>
          <span className="recap-receipt-item"><span title={item.fullLabel}>{item.label}</span><small>{item.category} · {formatRecapDay(item.date, { day: 'numeric', month: 'short' })}</small></span>
          <strong><Money value={item.amount} /></strong>
        </li>)}
      </ol>
      {story.largestShare !== null && <p className="recap-receipt-foot"><span>Largest receipt</span><strong>{story.largestShare}% of purchase spend</strong></p>}
    </div>
  </div>;
}

function HabitsVisual({ story }: { story: Of<'habits'> }) {
  const cells: Array<{ label: string; value: ReactNode }> = [
    ...(story.median !== null ? [{ label: 'Typical receipt', value: <Money value={story.median} /> }] : []),
    ...(story.average !== null ? [{ label: 'Average receipt', value: <Money value={Math.round(story.average)} /> }] : []),
    story.lead === 'perDay' ? { label: 'Purchases', value: <AnimatedValue value={story.purchaseCount} /> } : { label: 'Per day', value: <Money value={story.perDay} /> },
  ];
  const stat = story.lead === 'typical' && story.median !== null ? <><RollingValue value={story.median} /><span>a typical receipt</span></>
    : story.lead === 'perDay' ? <><RollingValue value={story.perDay} /><span>spent per day, on average</span></>
      : <><AnimatedValue value={story.purchaseCount} /><span>purchases over {story.spendingDays} days</span></>;
  return <div className="recap-habits">
    <div className={`recap-big-stat recap-seq${story.lead === 'count' ? '' : ' recap-money-stat'}`} style={seq(3)}>{stat}</div>
    <dl className="recap-trio recap-seq" style={seq(4)}>{cells.map(cell => <div key={cell.label}><dt>{cell.label}</dt><dd>{cell.value}</dd></div>)}</dl>
    {story.repeat && <div className="recap-repeat recap-seq" style={seq(5)}>
      <Repeat2 size={18} aria-hidden="true" />
      <span><span title={story.repeat.fullLabel}>{story.repeat.label}</span><small>{story.repeat.occurrences} times · <Money value={story.repeat.total} /></small></span>
      <b>×{story.repeat.occurrences}</b>
    </div>}
  </div>;
}

function ComparisonVisual({ story, variants }: { story: Of<'comparison'> } & Shared) {
  const max = Math.max(story.now, story.before, 1);
  const up = story.change > 0;
  const bars = [{ key: 'before', label: story.beforeLabel, value: story.before }, { key: 'now', label: 'This period', value: story.now }];
  if (variants.versus === 'versus') {
    // A fight-night poster: before and now slam in from either side, VS between them.
    return <div className="recap-versus">
      {bars.map((bar, i) => <div key={bar.key} className={`recap-versus-card recap-versus-${bar.key}${bar.value === max ? ' is-bigger' : ''}`} style={{ '--side': i ? 1 : -1 } as CSSProperties}>
        <small>{bar.label}</small>
        <strong><Money value={bar.value} /></strong>
        <span>{story.mode === 'average' ? 'per purchase' : 'in expenses'}</span>
      </div>)}
      <b className="recap-versus-badge" aria-hidden="true">VS</b>
      <p className="recap-versus-result recap-seq" style={seq(7)}>
        {story.change === 0 ? 'A draw.' : <>{up ? <ArrowUpRight aria-hidden="true" /> : <ArrowDownRight aria-hidden="true" />}<AnimatedValue value={Math.abs(story.change)} suffix="%" /> {up ? 'higher' : 'lower'} this time</>}
      </p>
    </div>;
  }
  return <div className={`recap-compare recap-compare-${variants.comparison}`}>
    <div className="recap-big-stat recap-seq" style={seq(3)}>
      <span className="recap-compare-change">{story.change === 0 ? null : up ? <ArrowUpRight aria-hidden="true" /> : <ArrowDownRight aria-hidden="true" />}<AnimatedValue value={Math.abs(story.change)} suffix="%" /></span>
      <span>{story.change === 0 ? 'no change in' : up ? 'higher' : 'lower'} {story.mode === 'average' ? 'average purchase' : 'total expenses'}</span>
    </div>
    <div className="recap-compare-bars recap-seq" style={seq(4)}>
      {bars.map((bar, i) => <div key={bar.key} className={`recap-compare-${bar.key}`}>
        <strong><Money value={bar.value} /></strong>
        <i style={{ '--fill': bar.value / max, '--i': i } as CSSProperties} aria-hidden="true" />
        <span>{bar.label}</span>
      </div>)}
    </div>
    {story.matchedElapsed && <p className="recap-fact recap-seq" style={seq(6)}>Compared at the same point in each period.</p>}
  </div>;
}

function ClosingVisual({ story, periodId, onShare, variants, run, score }: { story: Of<'closing'>; periodId: number; onShare: () => void; score: QuizScore } & Shared) {
  const random = seeded(run + 41);
  const extraFinale = ['polaroid', 'trading', 'frontpage', 'post'].includes(variants.finale);
  const finales = useLoadedPart('finales', extraFinale);
  const stars = score.total ? Math.round(score.correct / score.total * 3) : 0;
  const verdict = !score.total ? null : score.correct === score.total ? 'You know your money.' : score.correct === 0 ? 'The receipts had secrets.' : 'Pretty sharp.';
  const actions = <div className="recap-closing-actions recap-seq" style={seq(9)}>
    <button type="button" className="recap-solid-button" onClick={onShare}><Download size={15} /> Share card</button>
    <Link to="/budget" search={{ periodId: String(periodId) }} className="recap-ghost-button">Review budget</Link>
  </div>;
  const burst = <Burst seed={run} kind={variants.burst} count={variants.burst === 'coins' ? 30 : 52} origin={random() < .5 ? 'center' : 'cannons'} delay={variants.finale === 'credits' ? 3200 : 1100} />;
  const { finale, persona } = story;
  const games = score.total ? `${score.correct}/${score.total} ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}` : null;
  if (variants.finale !== 'card') {
    // The newer finales come from a lazily loaded group; the receipt stands in if it hasn't arrived.
    const form = extraFinale && !finales ? 'receipt' : variants.finale;
    // The eyebrow belongs to the form the finale takes, not the copy pool's.
    const eyebrow = { receipt: 'Your receipt, please', credits: 'Roll credits', certificate: 'Graduation day', scoreboard: 'Game over',
      polaroid: 'Snapshots', trading: 'Collector’s edition', frontpage: 'Extra! Extra!', post: 'Posted' }[form];
    return <div className={`recap-finale recap-finale-${form}`}>
      <p className="recap-story-eyebrow">{eyebrow}</p>
      {form === 'receipt' && <FinaleReceipt story={story} games={games} />}
      {form === 'credits' && <FinaleCredits story={story} games={games} />}
      {form === 'certificate' && <FinaleCertificate story={story} />}
      {form === 'scoreboard' && <FinaleScoreboard story={story} games={games} />}
      {finales && extraFinale && <finales.ExtraFinale story={story} form={variants.finale as 'polaroid' | 'trading' | 'frontpage' | 'post'} games={games} run={run} />}
      {burst}
      {actions}
      <span className="sr-only">{finale.period}: {persona.name}</span>
    </div>;
  }
  return <div className={`recap-closing recap-closing-${variants.closing}`}>
    {burst}
    <dl className="recap-wrap-card">
      {story.tiles.map((tile, i) => <div key={tile.label} style={{ '--t': i, '--fr': `${(random() - .5) * 50}deg`, '--fx': `${(random() - .5) * 30}cqw` } as CSSProperties}>
        <dt>{tile.label}</dt>
        <dd>{tile.money !== undefined ? <RollingValue value={tile.money} /> : tile.value}</dd>
        {tile.note && <small>{tile.note}</small>}
      </div>)}
    </dl>
    <div className="recap-closing-extras recap-seq" style={seq(6)}>
      <span className="recap-closing-persona"><PersonaBadge personaKey={story.persona.key} Icon={personaIcons[story.persona.key]} small /><span><small>Your persona</small>{story.persona.name}</span></span>
      {score.total > 0 && <span className="recap-closing-score"><small>Games {score.correct}/{score.total}</small><span aria-label={`${stars} of 3 stars`}>{'★'.repeat(stars)}{'☆'.repeat(3 - stars)}</span>{verdict && <em>{verdict}</em>}</span>}
    </div>
    {actions}
  </div>;
}

/** The finale as a till receipt: the period itemised, totalled, and thanked. */
function FinaleReceipt({ story, games }: { story: Of<'closing'>; games: string | null }) {
  const { finale, persona } = story;
  const lines: Array<{ label: string; value: ReactNode; strong?: boolean; rule?: boolean }> = [
    { label: 'Came in', value: <Money value={finale.income} /> },
    { label: 'Went out', value: <Money value={Math.max(0, finale.expenses)} /> },
    { label: finale.net >= 0 ? 'Left over' : 'Short by', value: <RollingValue value={Math.abs(finale.net)} />, strong: true, rule: true },
    ...(finale.categories[0] ? [{ label: 'Top category', value: `${finale.categories[0].label} ${finale.categories[0].share}%` }] : []),
    ...(finale.peakLabel ? [{ label: 'Busiest day', value: finale.peakLabel }] : []),
    { label: 'Purchases', value: String(finale.purchaseCount) },
    { label: 'Persona', value: persona.name.replace(/^The /, '') },
    ...(games ? [{ label: 'Games', value: games }] : []),
  ];
  return <div className="recap-receipt-stage recap-receipt-print">
    <span className="recap-printer" aria-hidden="true" />
    <div className="recap-receipt recap-finale-slip">
      <p className="recap-slip-head"><b>✳ FAINENS ✳</b><span>{finale.period}</span><span>{finale.dateLabel}</span></p>
      <ul>{lines.map((line, i) => <li key={line.label} className={['recap-receipt-line', line.strong && 'is-total', line.rule && 'has-rule'].filter(Boolean).join(' ')} style={{ '--line': i } as CSSProperties}>
        <span>{line.label}</span><i aria-hidden="true" /><strong>{line.value}</strong>
      </li>)}</ul>
      <p className="recap-slip-foot"><span>Thank you, come again</span><span>Next period</span><span className="recap-barcode" aria-hidden="true" /></p>
    </div>
  </div>;
}

/** The finale as end credits rolling up the card. */
function FinaleCredits({ story, games }: { story: Of<'closing'>; games: string | null }) {
  const { finale, persona } = story;
  const [lead, ...cast] = finale.categories;
  const credits: Array<[string, string]> = [
    ...(lead ? [['Starring', lead.label] as [string, string]] : []),
    ...(cast.length ? [['Supporting cast', cast.map(row => row.label).join(' · ')] as [string, string]] : []),
    ...(finale.peakLabel ? [['Busiest scene', finale.peakLabel] as [string, string]] : []),
    ['Original score', `${finale.purchaseCount} receipts`],
    ['Casting', persona.name],
    ...(games ? [['Stunts', `Games ${games}`] as [string, string]] : []),
    ['Directed by', finale.passenger],
    ['Filmed on location', finale.period],
  ];
  return <div className="recap-credits" aria-label="Closing credits">
    <div className="recap-credits-roll">
      {credits.map(([role, name]) => <p key={role}><small>{role}</small><span>{name}</span></p>)}
      <p className="recap-credits-end">The End</p>
      <small className="recap-credits-fine">No receipts were harmed in the making of this recap.</small>
    </div>
  </div>;
}

/** Where a running period stands: days to go, a track of its days with you on it, and the pace so far. */
function PaceVisual({ story }: { story: Of<'pace'> }) {
  const left = story.totalDays - story.elapsedDays;
  return <div className="recap-pace">
    <p className="recap-pace-left recap-seq" style={seq(0)}><strong><AnimatedValue value={left} /></strong><span>{left === 1 ? 'day' : 'days'} to go</span></p>
    <div className="recap-pace-track recap-seq" style={{ ...seq(1), '--at': (story.elapsedDays - .5) / story.totalDays } as CSSProperties} aria-hidden="true">
      <div>{Array.from({ length: story.totalDays }, (_, i) => <i key={i} className={i < story.elapsedDays ? 'is-done' : undefined} style={{ '--i': i } as CSSProperties} />)}</div>
      <span className="recap-pace-pin"><b>Day {story.elapsedDays}</b></span>
      <span className="recap-pace-flag"><Flag /></span>
    </div>
    <p className="recap-pace-ends recap-seq" style={seq(2)}><span>Day 1</span><span>Ends {story.endLabel}</span></p>
    <dl className="recap-pace-stats recap-seq" style={seq(3)}>
      <div><dt>So far, per day</dt><dd><Money value={story.perDay} /></dd></div>
      <div><dt>At this pace, by the end</dt><dd>≈ <Money value={story.projected} /></dd></div>
    </dl>
  </div>;
}

/** The finale as a certificate awarding the period's money personality. */
// A foil seal's scalloped edge: 24 points alternating between two radii.
const SEAL_EDGE = `polygon(${Array.from({ length: 48 }, (_, i) => {
  const angle = (i / 48) * Math.PI * 2; const radius = i % 2 ? 44 : 50;
  return `${(50 + radius * Math.cos(angle)).toFixed(1)}% ${(50 + radius * Math.sin(angle)).toFixed(1)}%`;
}).join(', ')})`;

function FinaleCertificate({ story }: { story: Of<'closing'> }) {
  const { finale, persona } = story;
  const Icon = personaIcons[persona.key];
  return <div className="recap-cert">
    {/* The persona's own icon as a watermark, and a flourish in each corner of the double rule. */}
    <span className="recap-cert-watermark" aria-hidden="true"><Icon /></span>
    {[0, 1, 2, 3].map(i => <b key={i} className={`recap-cert-corner is-${i}`} aria-hidden="true">❦</b>)}
    <small className="recap-cert-academy">The Fainens Academy of Receipts</small>
    <h3>Certificate</h3>
    <p className="recap-cert-of"><i aria-hidden="true" />of completion<i aria-hidden="true" /></p>
    <p>This certifies that</p>
    <p className="recap-cert-who">{finale.passenger}</p>
    <p>completed {finale.period} as</p>
    <p className="recap-cert-title">{persona.name}</p>
    <p className="recap-cert-reason">{persona.tagline}</p>
    {persona.evidence[0] ? <p className="recap-cert-honours">With distinction in <b>{persona.evidence[0].replace(/^\p{Lu}/u, letter => letter.toLowerCase())}</b></p> : null}
    <div className="recap-cert-foot">
      <span className="recap-cert-sign"><b>fainens ✳</b><small>Chief Receipt Officer</small></span>
      <span className="recap-cert-seal" aria-hidden="true">
        <i className="recap-cert-ribbon" /><i className="recap-cert-ribbon" />
        <span className="recap-cert-foil" style={{ clipPath: SEAL_EDGE }}><span><Icon /></span></span>
      </span>
    </div>
  </div>;
}

/** The finale as an arcade high-score table. */
function FinaleScoreboard({ story, games }: { story: Of<'closing'>; games: string | null }) {
  const { finale, persona } = story;
  const rows: Array<[string, ReactNode]> = [
    [finale.net >= 0 ? 'Left over' : 'Short by', <Money value={Math.abs(finale.net)} />],
    ...(finale.categories[0] ? [['Top cat', `${finale.categories[0].label} ${finale.categories[0].share}%`] as [string, ReactNode]] : []),
    ...(finale.peakLabel ? [['Busy day', finale.peakLabel] as [string, ReactNode]] : []),
    ['Receipts', String(finale.purchaseCount)],
    ['Player', persona.name.replace(/^The /, '')],
    ...(games ? [['Games', games] as [string, ReactNode]] : []),
  ];
  const ranks = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
  return <div className="recap-arcade">
    <p className="recap-arcade-title">★ High scores ★</p>
    <ol>{rows.map(([label, value], i) => <li key={label} style={{ '--r': i } as CSSProperties}><span>{ranks[i]}</span><span>{label}</span><strong>{value}</strong></li>)}</ol>
    <p className="recap-arcade-press">Press ▶ to play again</p>
    <p className="recap-arcade-credit"><span>Credit 01</span><span>{finale.period}</span></p>
  </div>;
}
