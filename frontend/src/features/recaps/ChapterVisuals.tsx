import { Link } from '@tanstack/react-router';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Download, Repeat2 } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { CategoryIcon } from '../categories/CategoryIcon';
import { useCategoriesQuery } from '../categories/queries';
import { AnimatedValue } from './AnimatedValue';
import { formatRecapDay, recapDay, type RecapDayCell, type RecapStory } from './stories';

type Of<Id extends RecapStory['id']> = Extract<RecapStory, { id: Id }>;
const seq = (n: number) => ({ '--seq': n }) as CSSProperties;
const Money = ({ value }: { value: number }) => <AnimatedValue value={value} money />;
// Category colours are tuned for the app's surfaces; on the story's tinted paper a muted step of the ink
// keeps unnamed or uncoloured slices legible.
const fallbackTones = [1, .72, .52, .38, .26];

export function ChapterVisual({ story, periodId, onShare }: { story: RecapStory; periodId: number; onShare: () => void }) {
  switch (story.id) {
    case 'intro': return <CoverVisual story={story} />;
    case 'overview': return <FlowVisual story={story} />;
    case 'budget': return <BudgetVisual story={story} periodId={periodId} />;
    case 'categories': return <CategoriesVisual story={story} />;
    case 'calendar': return <CalendarVisual story={story} />;
    case 'receipts': return <ReceiptVisual story={story} />;
    case 'habits': return <HabitsVisual story={story} />;
    case 'comparison': return <ComparisonVisual story={story} />;
    case 'closing': return <ClosingVisual story={story} periodId={periodId} onShare={onShare} />;
  }
}

function CoverVisual({ story }: { story: Of<'intro'> }) {
  const progress = story.isPartial ? story.elapsedDays / story.totalDays : 1;
  return <div className="recap-cover-ticket recap-seq" style={seq(4)}>
    <div className="recap-cover-ticket-row"><span>{story.isPartial ? 'In progress' : 'Complete'}</span><strong>{story.dateRange}</strong></div>
    <div className="recap-cover-track" aria-hidden="true"><i style={{ '--fill': progress } as CSSProperties} /></div>
    <p>{story.isPartial ? `Day ${story.elapsedDays} of ${story.totalDays}` : `${story.totalDays} days, start to finish`}</p>
  </div>;
}

function FlowVisual({ story }: { story: Of<'overview'> }) {
  const max = Math.max(story.income, story.expenses, 1);
  const rows = [
    { key: 'in', label: 'Came in', value: story.income },
    { key: 'out', label: 'Went out', value: Math.max(0, story.expenses) },
  ];
  return <div className="recap-flow">
    {rows.map((row, i) => <div key={row.key} className={`recap-flow-row recap-flow-${row.key} recap-seq`} style={seq(3 + i)}>
      <div className="recap-flow-head"><span>{row.label}</span><strong><Money value={row.value} /></strong></div>
      <div className="recap-flow-track" aria-hidden="true"><i style={{ '--fill': row.value / max, ...seq(3 + i) } as CSSProperties} /></div>
    </div>)}
    <div className="recap-flow-net recap-seq" style={seq(5)}>
      <span>{story.net >= 0 ? 'Left over' : 'Short by'}</span>
      <strong><Money value={Math.abs(story.net)} /></strong>
      {story.keptShare !== null && <em>{story.keptShare}% of income</em>}
    </div>
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

function CategoriesVisual({ story }: { story: Of<'categories'> }) {
  const categories = useCategoriesQuery();
  const lookup = new Map((categories.data ?? []).map(category => [category.id, category]));
  const colorOf = (row: { categoryId: number | null }, i: number) => {
    const color = row.categoryId != null ? lookup.get(row.categoryId)?.color : null;
    return color ?? `color-mix(in srgb, var(--recap-ink) ${fallbackTones[i] * 100}%, transparent)`;
  };
  const top = story.rows[0];
  const segments = [...story.rows.map((row, i) => ({ key: row.name, share: row.share, color: colorOf(row, i) })),
    ...(story.others ? [{ key: 'others', share: story.others.share, color: 'color-mix(in srgb, var(--recap-ink) 18%, transparent)' }] : [])];
  return <div className="recap-categories">
    <div className="recap-big-stat recap-seq" style={seq(3)}><AnimatedValue value={top.share} suffix="%" /><span>of spending went to {top.label}</span></div>
    <div className="recap-share-bar recap-seq" style={seq(4)} aria-hidden="true">
      {segments.map((segment, i) => <i key={segment.key} style={{ flexGrow: Math.max(segment.share, 1), background: segment.color, '--i': i } as CSSProperties} />)}
    </div>
    <ol className="recap-category-list">
      {story.rows.map((row, i) => <li key={row.name} className="recap-seq" style={seq(5 + i * .6)}>
        <span className="recap-category-icon" style={{ '--tone': colorOf(row, i) } as CSSProperties}><CategoryIcon name={row.name} color="currentColor" className="h-[1em] w-[1em]" /></span>
        <span className="recap-category-name" title={row.name}>{row.label}</span>
        <span className="recap-category-share">{row.share}%</span>
        <strong><Money value={row.amount} /></strong>
      </li>)}
    </ol>
    {story.others && <p className="recap-fact recap-seq" style={seq(8.5)}>+ {story.others.count} more {story.others.count === 1 ? 'category' : 'categories'} · <Money value={story.others.amount} /></p>}
  </div>;
}

const weekdays = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function CalendarVisual({ story }: { story: Of<'calendar'> }) {
  const peak = story.peak;
  const peakLine = peak && <p className="recap-fact recap-seq" style={seq(6)}>
    Busiest: <strong>{formatRecapDay(peak.date, { weekday: 'long', day: 'numeric', month: 'short' })}</strong> · <Money value={peak.amount} /> across {peak.purchaseCount} {peak.purchaseCount === 1 ? 'purchase' : 'purchases'}
  </p>;
  if (!story.days) {
    return <div className="recap-calendar">
      <div className="recap-big-stat recap-seq" style={seq(3)}><AnimatedValue value={story.spendingDays} /><span>days with spending</span></div>
      {peakLine}
      <p className="recap-fact recap-seq" style={seq(7)}>Refresh this recap for the day-by-day view.</p>
    </div>;
  }
  const max = Math.max(1, ...story.days.map(day => day.amount));
  // Monday-first week rows, with blanks before the period's first day.
  const lead = (recapDay(story.days[0].date).getUTCDay() + 6) % 7;
  const elapsed = story.days.filter(day => !day.future).length;
  return <div className="recap-calendar">
    <div className="recap-big-stat recap-seq" style={seq(3)}><AnimatedValue value={story.spendingDays} /><span>of {elapsed} days had spending</span></div>
    <div className="recap-calendar-grid recap-seq" style={seq(4)} role="img" aria-label={`Spending on ${story.spendingDays} of ${elapsed} days${peak ? `, busiest on ${formatRecapDay(peak.date, { weekday: 'long', day: 'numeric', month: 'long' })}` : ''}`}>
      {weekdays.map((day, i) => <span key={`h${i}`} className="recap-calendar-weekday">{day}</span>)}
      {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
      {story.days.map((day, i) => <DayCell key={day.key} day={day} intensity={day.amount / max} index={i} />)}
    </div>
    <div className="recap-calendar-legend recap-seq" style={seq(5)} aria-hidden="true"><span>Less</span>{[.08, .3, .55, .8, 1].map(level => <i key={level} style={{ '--level': level } as CSSProperties} />)}<span>More</span></div>
    {peakLine}
  </div>;
}

function DayCell({ day, intensity, index }: { day: RecapDayCell; intensity: number; index: number }) {
  const level = day.amount > 0 ? .22 + .78 * Math.sqrt(intensity) : 0;
  return <span className={['recap-day', day.future && 'is-future', day.peak && 'is-peak', level > .55 && 'is-dark'].filter(Boolean).join(' ')}
    style={{ '--level': level, '--cell': index } as CSSProperties}>
    <small>{Number(day.key.slice(8))}</small>
  </span>;
}

function ReceiptVisual({ story }: { story: Of<'receipts'> }) {
  return <div className="recap-receipt recap-seq" style={seq(3)}>
    <p className="recap-receipt-head"><span>Top {story.items.length}</span><span>of {story.purchaseCount} purchases</span></p>
    <ol>
      {story.items.map((item, i) => <li key={`${i}:${item.fullLabel}`} className="recap-seq" style={seq(4 + i * .7)}>
        <span className="recap-receipt-rank">{String(i + 1).padStart(2, '0')}</span>
        <span className="recap-receipt-item"><span title={item.fullLabel}>{item.label}</span><small>{item.category} · {formatRecapDay(item.date, { day: 'numeric', month: 'short' })}</small></span>
        <strong><Money value={item.amount} /></strong>
      </li>)}
    </ol>
    {story.largestShare !== null && <p className="recap-receipt-foot"><span>Largest receipt</span><strong>{story.largestShare}% of purchase spend</strong></p>}
  </div>;
}

function HabitsVisual({ story }: { story: Of<'habits'> }) {
  const cells: Array<{ label: string; value: ReactNode }> = [
    ...(story.median !== null ? [{ label: 'Typical receipt', value: <Money value={story.median} /> }] : []),
    ...(story.average !== null ? [{ label: 'Average receipt', value: <Money value={Math.round(story.average)} /> }] : []),
    { label: 'Spending days', value: <AnimatedValue value={story.spendingDays} /> },
  ];
  return <div className="recap-habits">
    <div className="recap-big-stat recap-seq" style={seq(3)}><AnimatedValue value={story.purchaseCount} /><span>purchases</span></div>
    <dl className="recap-trio recap-seq" style={seq(4)}>{cells.map(cell => <div key={cell.label}><dt>{cell.label}</dt><dd>{cell.value}</dd></div>)}</dl>
    {story.repeat && <div className="recap-repeat recap-seq" style={seq(5)}>
      <Repeat2 size={18} aria-hidden="true" />
      <span><span title={story.repeat.fullLabel}>{story.repeat.label}</span><small>{story.repeat.occurrences} times · <Money value={story.repeat.total} /></small></span>
      <b>×{story.repeat.occurrences}</b>
    </div>}
  </div>;
}

function ComparisonVisual({ story }: { story: Of<'comparison'> }) {
  const max = Math.max(story.now, story.before, 1);
  const up = story.change > 0;
  const bars = [{ key: 'before', label: story.beforeLabel, value: story.before }, { key: 'now', label: 'This period', value: story.now }];
  return <div className="recap-compare">
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

function ClosingVisual({ story, periodId, onShare }: { story: Of<'closing'>; periodId: number; onShare: () => void }) {
  return <div className="recap-closing">
    <dl className="recap-wrap-card">
      {story.tiles.map((tile, i) => <div key={tile.label} className="recap-seq" style={seq(3 + i * .6)}>
        <dt>{tile.label}</dt>
        <dd>{tile.money !== undefined ? <Money value={tile.money} /> : tile.value}</dd>
        {tile.note && <small>{tile.note}</small>}
      </div>)}
    </dl>
    <div className="recap-closing-actions recap-seq" style={seq(6)}>
      <button type="button" className="recap-solid-button" onClick={onShare}><Download size={15} /> Share card</button>
      <Link to="/budget" search={{ periodId: String(periodId) }} className="recap-ghost-button">Review budget</Link>
    </div>
  </div>;
}
