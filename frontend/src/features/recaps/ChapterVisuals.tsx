import { Link } from '@tanstack/react-router';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Download, Repeat2 } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { CategoryIcon } from '../categories/CategoryIcon';
import { useCategoriesQuery } from '../categories/queries';
import { AnimatedValue, RollingValue } from './AnimatedValue';
import { Burst } from './Burst';
import { seeded, type SectionVariants } from './motion';
import { formatRecapDay, recapWeekday, WEEKDAYS, type RecapDayCell, type RecapStory } from './stories';

type Of<Id extends RecapStory['id']> = Extract<RecapStory, { id: Id }>;
type Shared = { variants: SectionVariants; run: number };
const seq = (n: number) => ({ '--seq': n }) as CSSProperties;
const Money = ({ value }: { value: number }) => <AnimatedValue value={value} money />;
// Category colours are tuned for the app's surfaces; on the story's tinted paper a muted step of the ink
// keeps unnamed or uncoloured slices legible.
const fallbackTones = [1, .72, .52, .38, .26];

export function ChapterVisual({ story, periodId, onShare, variants, run }: { story: RecapStory; periodId: number; onShare: () => void } & Shared) {
  const shared = { variants, run };
  switch (story.id) {
    case 'intro': return <CoverVisual story={story} {...shared} />;
    case 'overview': return <FlowVisual story={story} />;
    case 'budget': return <BudgetVisual story={story} periodId={periodId} />;
    case 'categories': return <CategoriesVisual story={story} {...shared} />;
    case 'calendar': return <CalendarVisual story={story} {...shared} />;
    case 'weekdays': return <WeekdaysVisual story={story} />;
    case 'streak': return <StreakVisual story={story} />;
    case 'receipts': return <ReceiptVisual story={story} {...shared} />;
    case 'habits': return <HabitsVisual story={story} />;
    case 'comparison': return <ComparisonVisual story={story} {...shared} />;
    case 'closing': return <ClosingVisual story={story} periodId={periodId} onShare={onShare} {...shared} />;
  }
}

function CoverVisual({ story, variants, run }: { story: Of<'intro'> } & Shared) {
  const progress = story.isPartial ? story.elapsedDays / story.totalDays : 1;
  return <>
    {/* The month, set huge behind the cover; in the rain take its letters fall in one by one. */}
    <span className={`recap-cover-word recap-cover-word-${variants.intro}`} aria-hidden="true">
      {[...story.monthWord].map((letter, i) => <span key={i} style={{ '--l': i } as CSSProperties}>{letter}</span>)}
    </span>
    <Burst seed={run} kind="sparkle" count={16} origin="title" delay={variants.intro === 'typewriter' ? 1100 : 650} />
    <div className={`recap-cover-ticket recap-seq recap-ticket-${variants.intro}`} style={seq(4)}>
      <div className="recap-cover-ticket-row"><span>{story.isPartial ? 'In progress' : 'Complete'}</span><strong>{story.dateRange}</strong></div>
      <div className="recap-cover-track" aria-hidden="true"><i style={{ '--fill': progress } as CSSProperties} /></div>
      <p>{story.isPartial ? `Day ${story.elapsedDays} of ${story.totalDays}` : `${story.totalDays} days, start to finish`}</p>
    </div>
  </>;
}

function FlowVisual({ story }: { story: Of<'overview'> }) {
  const max = Math.max(story.income, story.expenses, 1);
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
    {story.lead === 'left' && <div className="recap-flow-net recap-seq" style={seq(5)}>
      <span>{story.net >= 0 ? 'Left over' : 'Short by'}</span>
      <strong><RollingValue value={Math.abs(story.net)} /></strong>
      {story.keptShare !== null && <em>{story.keptShare}% of income</em>}
    </div>}
  </div>;
}

function BudgetVisual({ story, periodId }: { story: Of<'budget'>; periodId: number }) {
  const used = story.percentUsed;
  const over = story.remaining < 0;
  return <div className="recap-budget">
    <div className="recap-big-stat recap-seq" style={seq(3)}>
      {used !== null ? <><AnimatedValue value={used} suffix="%" /><span>of the plan used</span></> : <><Money value={story.spent} /><span>spent in budgeted categories</span></>}
    </div>
    <div className={`recap-meter recap-seq${over ? ' is-over' : ''}`} style={seq(4)} aria-hidden="true">
      <i style={{ '--fill': Math.min(1, Math.max(0, (used ?? 0) / 100)) } as CSSProperties} />
      {story.elapsedShare !== null && <b style={{ left: `${story.elapsedShare}%` }}><span>Today</span></b>}
    </div>
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
    <div className="recap-calendar-legend recap-seq" style={seq(5)} aria-hidden="true"><span>Less</span>{[.08, .3, .55, .8, 1].map(level => <i key={level} style={{ '--level': level } as CSSProperties} />)}<span>More</span></div>
    {story.lead !== 'peak' && peakLine}
  </div>;
}

function DayCell({ day, intensity, delay }: { day: RecapDayCell; intensity: number; delay: number }) {
  const level = day.amount > 0 ? .22 + .78 * Math.sqrt(intensity) : 0;
  return <span className={['recap-day', day.future && 'is-future', day.peak && 'is-peak', level > .55 && 'is-dark'].filter(Boolean).join(' ')}
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

function ClosingVisual({ story, periodId, onShare, variants, run }: { story: Of<'closing'>; periodId: number; onShare: () => void } & Shared) {
  const random = seeded(run + 41);
  return <div className={`recap-closing recap-closing-${variants.closing}`}>
    <Burst seed={run} kind={variants.burst} count={variants.burst === 'coins' ? 30 : 52} origin={random() < .5 ? 'center' : 'cannons'} delay={900} />
    <dl className="recap-wrap-card">
      {story.tiles.map((tile, i) => <div key={tile.label} style={{ '--t': i, '--fr': `${(random() - .5) * 50}deg`, '--fx': `${(random() - .5) * 30}cqw` } as CSSProperties}>
        <dt>{tile.label}</dt>
        <dd>{tile.money !== undefined ? <RollingValue value={tile.money} /> : tile.value}</dd>
        {tile.note && <small>{tile.note}</small>}
      </div>)}
    </dl>
    <div className="recap-closing-actions recap-seq" style={seq(7)}>
      <button type="button" className="recap-solid-button" onClick={onShare}><Download size={15} /> Share card</button>
      <Link to="/budget" search={{ periodId: String(periodId) }} className="recap-ghost-button">Review budget</Link>
    </div>
  </div>;
}
