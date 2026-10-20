import type { CSSProperties } from 'react';
import { Flag, Trophy } from 'lucide-react';
import { CategoryIcon } from '../../categories/CategoryIcon';
import { AnimatedValue } from '../AnimatedValue';
import { formatRecapDay } from '../dates';
import type { RecapStory } from '../stories';
import './bonus-extra.css';

type BonusStory = Extract<RecapStory, { id: 'bonus' }>;
const vars = (values: Record<string, string | number>) => values as CSSProperties;
const dayLabel = (ms: number) => formatRecapDay(ms, { weekday: 'short', day: 'numeric', month: 'short' });

/** A second look for each bonus slide (lazily loaded); same figures as the first. */
export function AltBonusVisual({ story }: { story: BonusStory }) {
  const b = story.bonus;
  switch (b.kind) {
    case 'payday':
      // An hourglass: the first three days pour most of the sand through at once.
      return <div className="recap-bonus recap-hourglass-stage" style={vars({ '--share': b.share / 100 })}>
        <div className="recap-hourglass" aria-hidden="true">
          <span className="recap-hourglass-top"><i /></span>
          <span className="recap-hourglass-stream" />
          <span className="recap-hourglass-bottom"><i /></span>
        </div>
        <div className="recap-hourglass-copy"><b><AnimatedValue value={b.share} suffix="%" /></b><span>gone in the first three days</span><small><AnimatedValue value={b.amount} money /></small></div>
      </div>;
    case 'boss':
      // A boxing round: the receipt's glove lands one punch and the round card flips.
      return <div className="recap-bonus recap-ring" style={vars({ '--dmg': b.share / 100 })}>
        <div className="recap-ring-ropes" aria-hidden="true"><i /><i /><i /></div>
        <span className="recap-ring-card" aria-hidden="true">Round 1</span>
        <span className="recap-glove is-left" aria-hidden="true" />
        <span className="recap-glove is-right" aria-hidden="true" />
        <b className="recap-pow" aria-hidden="true">POW!</b>
        <div className="recap-ring-meter"><span>Your purchases<em>{b.share}% in one hit</em></span><i aria-hidden="true"><b /></i></div>
      </div>;
    case 'suspects':
      // Wanted posters, pinned to the wall.
      return <div className="recap-bonus recap-wanted">
        {b.items.map((item, i) => <div key={item.fullLabel} className="recap-wanted-poster" style={vars({ '--i': i, '--r': `${i ? 4 : -5}deg` })}>
          <i className="recap-wanted-pin" aria-hidden="true" />
          <span className="recap-wanted-head">Wanted</span>
          <span className="recap-wanted-photo" aria-hidden="true"><b>{item.label.slice(0, 1)}</b></span>
          <b className="recap-wanted-name">{item.label}</b>
          <span className="recap-wanted-reward">Seen ×{item.occurrences}</span>
          <small><AnimatedValue value={item.total} money /></small>
        </div>)}
      </div>;
    case 'milestone': {
      // An odometer rolling up to the round number, with a trophy at the finish.
      const digits = String(b.count).split('');
      return <div className="recap-bonus recap-odometer-stage">
        <div className="recap-odometer" aria-label={`Receipt number ${b.count}`}>
          {digits.map((digit, i) => <span key={i} className="recap-odometer-col" aria-hidden="true" style={vars({ '--to': Number(digit), '--i': i })}>
            <span>{Array.from({ length: 20 }, (_, n) => <b key={n}>{n % 10}</b>)}</span>
          </span>)}
        </div>
        <span className="recap-odometer-trophy" aria-hidden="true"><Trophy /></span>
        <p className="recap-odometer-day">Reached on {dayLabel(b.date)} · day {b.dayIndex + 1} of {b.totalDays}</p>
      </div>;
    }
    case 'takeover': {
      // A map of 100 territories; the category claims its share, spiralling out from the middle.
      const order = spiral(10);
      const held = Math.round(b.share);
      return <div className="recap-bonus recap-territory">
        <div className="recap-territory-map" aria-hidden="true">
          {Array.from({ length: 100 }, (_, cell) => <i key={cell} className={order[cell] < held ? 'is-held' : undefined} style={vars({ '--o': order[cell] })} />)}
          <span className="recap-territory-flag"><Flag /></span>
        </div>
        <p className="recap-territory-tally"><span className="recap-territory-icon"><CategoryIcon name={b.name} color="currentColor" className="h-[1em] w-[1em]" /></span><b>{held}%</b> of the map is {b.label}</p>
      </div>;
    }
    case 'comeback':
      // A sequel's movie poster.
      return <div className="recap-bonus recap-sequel">
        <i className="recap-sequel-beam is-left" aria-hidden="true" /><i className="recap-sequel-beam is-right" aria-hidden="true" />
        <div className="recap-sequel-poster">
          <small>This period, in spending</small>
          <span className="recap-sequel-icon" aria-hidden="true"><CategoryIcon name={b.name} color="currentColor" className="h-[1em] w-[1em]" /></span>
          {/* Sized to the title's length so a long category name stays on one line. */}
          <b style={vars({ fontSize: `min(6.4cqw, ${(70 / (b.label.length + 3)).toFixed(2)}cqw)` })}>{b.label} II</b>
          <span className="recap-sequel-tag">The Return</span>
          <span className="recap-sequel-stars" aria-hidden="true">★★★★★</span>
          <small>{b.previousRank ? `Was #${b.previousRank}` : 'Was off the chart'} · now #{b.rank} · {b.share}%</small>
        </div>
      </div>;
  }
}

/** Cells of a size×size grid numbered in a spiral out from the middle, so claimed land grows outwards. */
function spiral(size: number) {
  const centre = (size - 1) / 2;
  const cells = Array.from({ length: size * size }, (_, i) => ({ i, d: Math.hypot(i % size - centre, Math.floor(i / size) - centre), a: Math.atan2(Math.floor(i / size) - centre, i % size - centre) }));
  const rank = new Array<number>(cells.length);
  cells.sort((p, q) => p.d - q.d || p.a - q.a).forEach((cell, n) => { rank[cell.i] = n; });
  return rank;
}
