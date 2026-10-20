import type { CSSProperties, ReactNode } from 'react';
import { Disc3, Pause, ShoppingCart, SkipBack, SkipForward, Star } from 'lucide-react';
import { AnimatedValue } from '../AnimatedValue';
import { formatRecapDay } from '../dates';
import { WEEKDAYS, type RecapStory } from '../stories';
import type { SectionVariants } from '../motion';
import './layouts.css';

type Of<Id extends RecapStory['id']> = Extract<RecapStory, { id: Id }>;
const vars = (values: Record<string, string | number>) => values as CSSProperties;
const Money = ({ value }: { value: number }) => <AnimatedValue value={value} money />;
const stat = (value: ReactNode, label: string) => <div className="recap-big-stat recap-seq" style={vars({ '--seq': 3 })}>{value}<span>{label}</span></div>;

/** A polar chart: one wedge per value, its length by size, a hand that sweeps round to the biggest. */
function Polar({ values, labels, top, label }: { values: number[]; labels: string[]; top: number; label: string }) {
  const max = Math.max(1, ...values);
  const step = 360 / values.length;
  const wedge = (i: number, r: number) => {
    const a = (i * step - step / 2 + 1.5) * Math.PI / 180; const b = ((i + 1) * step - step / 2 - 1.5) * Math.PI / 180;
    return `M50 50 L${50 + r * Math.sin(a)} ${50 - r * Math.cos(a)} A${r} ${r} 0 0 1 ${50 + r * Math.sin(b)} ${50 - r * Math.cos(b)} Z`;
  };
  return <div className="recap-polar" role="img" aria-label={label} style={vars({ '--hand': `${top * step}deg` })}>
    <svg viewBox="0 0 100 100" aria-hidden="true">
      {[18, 30, 42].map(r => <circle key={r} cx="50" cy="50" r={r} className="recap-polar-ring" />)}
      {values.map((value, i) => <path key={i} d={wedge(i, 10 + 34 * Math.sqrt(value / max))} className={`recap-polar-wedge${i === top ? ' is-top' : ''}`} style={vars({ '--i': i })} />)}
      {labels.map((text, i) => <text key={text + i} x={50 + 47 * Math.sin(i * step * Math.PI / 180)} y={51.5 - 47 * Math.cos(i * step * Math.PI / 180)} className={`recap-polar-label${i === top ? ' is-top' : ''}`}>{text}</text>)}
      <g className="recap-polar-hand"><line x1="50" y1="50" x2="50" y2="14" /><circle cx="50" cy="50" r="2.6" /></g>
    </svg>
  </div>;
}

export function WeekdaysAlt({ story, variant }: { story: Of<'weekdays'>; variant: SectionVariants['weekdays'] }) {
  const max = Math.max(1, ...story.totals);
  const head = story.lead === 'weekend' ? stat(<AnimatedValue value={story.weekendShare} suffix="%" />, 'of spending fell on weekends')
    : stat(<span className="recap-stat-word">{WEEKDAYS[story.busiest].slice(0, 3)}</span>, 'the biggest day of the week');
  if (variant === 'clock') return <div className="recap-weekdays recap-week-clock">
    {head}
    <Polar values={story.totals} labels={WEEKDAYS.map(day => day.slice(0, 2))} top={story.busiest} label={`Spending by weekday, highest on ${WEEKDAYS[story.busiest]}`} />
  </div>;
  if (variant === 'podium') {
    // The top three weekdays on a podium: silver left, gold centre, bronze right.
    const ranked = story.totals.map((total, i) => ({ total, i })).sort((a, b) => b.total - a.total);
    const steps = [ranked[1], ranked[0], ranked[2]];
    return <div className="recap-weekdays recap-week-podium">
      {head}
      <div className="recap-podium" role="img" aria-label={`Top weekdays: ${ranked.slice(0, 3).map(row => WEEKDAYS[row.i]).join(', ')}`}>
        {steps.map((row, slot) => <div key={row.i} className={`recap-podium-step is-${['silver', 'gold', 'bronze'][slot]}`} style={vars({ '--h': [.66, 1, .48][slot], '--slot': [1, 0, 2][slot] })}>
          <span className="recap-podium-medal">{[2, 1, 3][slot]}</span>
          <b>{WEEKDAYS[row.i].slice(0, 3)}</b>
          <small><Money value={row.total} /></small>
        </div>)}
      </div>
      <p className="recap-fact recap-seq" style={vars({ '--seq': 7 })}>Then {ranked.slice(3).map(row => WEEKDAYS[row.i].slice(0, 3)).join(', ')}.</p>
    </div>;
  }
  // A week planner: one ruled line per day, a highlighter stroke as long as that day's spending.
  return <div className="recap-weekdays recap-week-planner">
    {head}
    <ol className="recap-planner" aria-label={`Spending by weekday, highest on ${WEEKDAYS[story.busiest]}`}>
      {story.totals.map((total, i) => <li key={i} className={[i === story.busiest && 'is-top', i >= 5 && 'is-weekend'].filter(Boolean).join(' ')} style={vars({ '--w': total / max, '--i': i })}>
        <span>{WEEKDAYS[i]}</span>
        <i aria-hidden="true" />
        {i === story.busiest && <b className="recap-planner-sticker"><Star aria-hidden="true" /> big day</b>}
      </li>)}
    </ol>
  </div>;
}

export function StreakAlt({ story, variant }: { story: Of<'streak'>; variant: SectionVariants['streak'] }) {
  const run = story.lead === 'quiet' ? story.quiet : story.busy;
  const inRun = (i: number) => run !== null && i >= run.start && i < run.start + run.length;
  const head = stat(<AnimatedValue value={run?.length ?? 0} />, story.lead === 'quiet' ? 'days in a row without spending' : 'spending days in a row');
  const range = run && <p className="recap-fact recap-seq" style={vars({ '--seq': 7 })}>
    {formatRecapDay(story.days[run.start].date, { day: 'numeric', month: 'short' })} – {formatRecapDay(story.days[run.start + run.length - 1].date, { day: 'numeric', month: 'short' })}
  </p>;
  if (variant === 'chain') return <div className={`recap-streak recap-streak-chain is-${story.lead}`}>
    {head}
    {/* One link per day: spending days hold the chain together, empty days are gaps. */}
    <div className="recap-chain" aria-hidden="true">
      {story.days.map((day, i) => <i key={day.key} className={[day.amount > 0 ? 'is-link' : 'is-gap', inRun(i) && 'in-run'].filter(Boolean).join(' ')} style={vars({ '--i': i, '--r': inRun(i) ? i - run!.start : 0 })} />)}
    </div>
    {range}
  </div>;
  if (variant === 'domino') return <div className={`recap-streak recap-streak-domino is-${story.lead}`}>
    {head}
    {/* The streak's dominoes topple one after another; the rest stand. */}
    <div className="recap-dominoes" aria-hidden="true">
      {story.days.map((day, i) => <i key={day.key} className={[day.amount > 0 && 'has-spend', inRun(i) && 'in-run'].filter(Boolean).join(' ')} style={vars({ '--i': i, '--r': inRun(i) ? i - run!.start : 0 })}><b /><b /></i>)}
    </div>
    {range}
  </div>;
  // A fighting-game combo meter: the counter climbs as the segments light.
  const segments = Math.min(20, run?.length ?? 0);
  return <div className={`recap-streak recap-streak-combo is-${story.lead}`}>
    <div className="recap-combo">
      <b className="recap-combo-count"><AnimatedValue value={run?.length ?? 0} /><span className="recap-combo-x">×</span></b>
      <span className="recap-combo-word">{story.lead === 'quiet' ? 'Quiet combo' : 'Combo'}</span>
      <div className="recap-combo-meter" aria-hidden="true">{Array.from({ length: 20 }, (_, i) => <i key={i} className={i < segments ? 'is-lit' : undefined} style={vars({ '--i': i })} />)}</div>
    </div>
    <p className="recap-fact recap-seq" style={vars({ '--seq': 5 })}>{story.lead === 'quiet' ? 'days in a row without spending' : 'spending days in a row'}</p>
    <div className="recap-combo-pips" aria-hidden="true">{story.days.map((day, i) => <i key={day.key} className={[day.amount > 0 && 'has-spend', inRun(i) && 'in-run'].filter(Boolean).join(' ')} style={vars({ '--i': i })} />)}</div>
    {range}
  </div>;
}

export function HabitsAlt({ story, variant }: { story: Of<'habits'>; variant: SectionVariants['habits'] }) {
  const tags = <ul className="recap-chips recap-habit-tags">
    {story.median !== null && <li style={vars({ '--c': 0 })}>Typical <Money value={story.median} /></li>}
    <li style={vars({ '--c': 1 })}>Per day <Money value={story.perDay} /></li>
    {story.repeat && <li style={vars({ '--c': 2 })}>{story.repeat.label} ×{story.repeat.occurrences}</li>}
  </ul>;
  const count = stat(<AnimatedValue value={story.purchaseCount} />, `purchases over ${story.spendingDays} days`);
  if (variant === 'pile') {
    // Every receipt (up to 28) drops onto a pile, each at its own angle.
    const slips = Math.min(28, story.purchaseCount);
    return <div className="recap-habits recap-habits-pile">
      {count}
      <div className="recap-pile" aria-hidden="true">
        {Array.from({ length: slips }, (_, i) => <i key={i} style={vars({ '--i': i, '--x': `${((i * 37) % 60) - 30}%`, '--rot': `${((i * 53) % 50) - 25}deg`, '--lift': Math.floor(i / 4) })} />)}
      </div>
      {tags}
    </div>;
  }
  if (variant === 'cart') {
    // Items drop into a shopping cart while its display counts up.
    const items = Math.min(12, story.purchaseCount);
    return <div className="recap-habits recap-habits-cart">
      <div className="recap-cart-stage" aria-hidden="true">
        <span className="recap-cart-display"><AnimatedValue value={story.purchaseCount} /><small>items</small></span>
        <div className="recap-cart-items">{Array.from({ length: items }, (_, i) => <i key={i} style={vars({ '--i': i, '--x': `${(i % 4) * 22 + 6}%`, '--row': Math.floor(i / 4) })} />)}</div>
        <ShoppingCart className="recap-cart-icon" />
      </div>
      <p className="recap-fact recap-seq" style={vars({ '--seq': 5 })}>{story.purchaseCount} purchases over {story.spendingDays} days</p>
      {tags}
    </div>;
  }
  // Tally marks, five to a bundle, scratched onto the wall one by one.
  const marks = Math.min(60, story.purchaseCount);
  const bundles = Array.from({ length: Math.ceil(marks / 5) }, (_, b) => Math.min(5, marks - b * 5));
  return <div className="recap-habits recap-habits-tally">
    {count}
    <div className="recap-tally" aria-hidden="true">
      {bundles.map((size, b) => <span key={b} className="recap-tally-bundle">
        {Array.from({ length: size }, (_, m) => <i key={m} className={m === 4 ? 'is-slash' : undefined} style={vars({ '--i': b * 5 + m })} />)}
      </span>)}
      {story.purchaseCount > marks && <b>+{story.purchaseCount - marks}</b>}
    </div>
    {tags}
  </div>;
}

export function MixtapeAlt({ story, variant }: { story: Of<'mixtape'>; variant: SectionVariants['mixtape'] }) {
  const list = (prefix: string) => <ol className="recap-tracklist">
    {story.tracks.map((track, i) => <li key={track.title} className="recap-seq" style={vars({ '--seq': 4 + i * .5 })}>
      <span className="recap-track-no">{prefix}{i + 1}</span>
      <span className="recap-track-name"><span>{track.title}</span><small>{track.artist}</small></span>
      <span className="recap-track-length">{track.length}</span>
    </li>)}
  </ol>;
  if (variant === 'vinyl') return <div className="recap-mixtape recap-mixtape-vinyl">
    <div className="recap-sleeve" aria-hidden="true">
      <span className="recap-sleeve-art"><b>{story.tapeName}</b><small>LP · 33⅓</small></span>
      <span className="recap-lp"><i /></span>
    </div>
    {list('A')}
  </div>;
  if (variant === 'cd') return <div className="recap-mixtape recap-mixtape-cd">
    <div className="recap-jewel" aria-hidden="true">
      <span className="recap-jewel-insert"><b>{story.tapeName}</b><small>Compact disc · digital audio</small></span>
      <span className="recap-cd"><i /></span>
    </div>
    {list('')}
  </div>;
  // A music app's now-playing screen: the biggest category is on, the rest are up next.
  const [now, ...next] = story.tracks;
  return <div className="recap-mixtape recap-mixtape-now">
    <div className="recap-now">
      <span className="recap-now-art" aria-hidden="true"><Disc3 /><b>{story.tapeName}</b></span>
      <div className="recap-now-meta"><b>{now.title}</b><small>{now.artist}</small></div>
      <div className="recap-now-bar" aria-hidden="true"><i /></div>
      <div className="recap-now-time" aria-hidden="true"><span>0:00</span><span>{now.length}</span></div>
      <div className="recap-now-controls" aria-hidden="true"><SkipBack /><span><Pause /></span><SkipForward /></div>
    </div>
    <ol className="recap-now-next" aria-label="Up next">{next.map((track, i) => <li key={track.title} style={vars({ '--i': i })}><span>{track.title}</span><small>{track.length}</small></li>)}</ol>
  </div>;
}

export function MonthsAlt({ story, variant }: { story: Of<'months'>; variant: SectionVariants['months'] }) {
  const max = Math.max(1, ...story.months.map(month => month.amount));
  const busiest = story.months[story.busiest];
  const head = stat(<span className="recap-stat-word">{busiest.label}</span>, 'the biggest month of the year');
  const foot = <p className="recap-fact recap-seq" style={vars({ '--seq': 7 })}>{busiest.label}: <Money value={busiest.amount} /></p>;
  if (variant === 'wheel') return <div className="recap-weekdays recap-months-wheel">
    {head}
    <Polar values={story.months.map(month => month.amount)} labels={story.months.map(month => month.label.slice(0, 1))} top={story.busiest} label={`Spending by month, highest in ${busiest.label}`} />
    {foot}
  </div>;
  if (variant === 'skyline') return <div className="recap-weekdays recap-months-skyline">
    {head}
    {/* A city at dusk: each month a building, windows lighting up; the busiest gets the antenna. */}
    <div className="recap-skyline" role="img" aria-label={`Spending by month, highest in ${busiest.label}`}>
      {story.months.map((month, i) => <div key={month.label} className={i === story.busiest ? 'is-top' : undefined} style={vars({ '--h': month.amount / max, '--i': i })}>
        <i className="recap-building" />
        <span>{month.label.slice(0, 1)}</span>
      </div>)}
    </div>
    {foot}
  </div>;
  return <div className="recap-weekdays recap-months-heat">
    {head}
    <div className="recap-heatstrip" role="img" aria-label={`Spending by month, highest in ${busiest.label}`}>
      {story.months.map((month, i) => <div key={month.label} className={i === story.busiest ? 'is-top' : undefined} style={vars({ '--level': .12 + .88 * Math.sqrt(month.amount / max), '--i': i })}>
        <i /><span>{month.label.slice(0, 3)}</span>
      </div>)}
    </div>
    {foot}
  </div>;
}
