import type { CSSProperties } from 'react';
import { ArrowUp, Banknote, Swords } from 'lucide-react';
import { CategoryIcon } from '../categories/CategoryIcon';
import { AnimatedValue } from './AnimatedValue';
import { formatRecapDay } from './dates';
import type { RecapStory } from './stories';

type BonusStory = Extract<RecapStory, { id: 'bonus' }>;
const vars = (values: Record<string, string | number>) => values as CSSProperties;
const dayLabel = (ms: number) => formatRecapDay(ms, { weekday: 'short', day: 'numeric', month: 'short' });

/** The bonus slides: each one earned by the period's figures (see `Bonus` in stories.ts). */
export function BonusVisual({ story }: { story: BonusStory }) {
  const b = story.bonus;
  switch (b.kind) {
    case 'payday': {
      // Every day of the period as a bar; the first three light up.
      const tallest = Math.max(1, ...b.days.map(day => day.amount));
      return <div className="recap-bonus recap-payday">
        <div className="recap-payday-bars" aria-hidden="true">
          {b.days.map((day, i) => <i key={i} className={day.rush ? 'is-rush' : undefined} style={vars({ '--h': day.amount / tallest, '--i': i })} />)}
          <span className="recap-payday-flag"><Banknote /> Payday</span>
        </div>
        <p className="recap-payday-share"><AnimatedValue value={b.share} suffix="%" /><small>in the first three days</small></p>
      </div>;
    }
    case 'boss':
      // The period's purchases are the boss; one receipt lands a single hit and drains the bar.
      return <div className="recap-bonus recap-boss" style={vars({ '--dmg': b.share / 100 })}>
        <div className="recap-boss-hud">
          <span className="recap-boss-name"><span>Boss</span><span>Your purchases</span></span>
          <span className="recap-boss-bar" aria-hidden="true"><i className="recap-boss-ghost" /><i className="recap-boss-hp" /></span>
          <b className="recap-boss-damage" aria-hidden="true">−{b.share}%</b>
        </div>
        <div className="recap-boss-hit">
          <span className="recap-boss-weapon" aria-hidden="true"><Swords /></span>
          <span><b>{b.label}</b><small><AnimatedValue value={b.amount} money /></small></span>
        </div>
        <p className="recap-boss-log">{b.category} · 1 hit · {b.share}% of purchases</p>
      </div>;
    case 'suspects': {
      // A police lineup: the two repeat purchases, sized by how often they turned up.
      const most = Math.max(...b.items.map(item => item.occurrences));
      return <div className="recap-bonus recap-lineup">
        <div className="recap-lineup-wall" aria-hidden="true">{['7ft', '6ft', '5ft', '4ft'].map(mark => <span key={mark}>{mark}</span>)}</div>
        <div className="recap-lineup-row">
          {b.items.map((item, i) => <div key={item.fullLabel} className="recap-suspect" style={vars({ '--i': i, '--tall': .72 + .28 * item.occurrences / most })}>
            <span className="recap-suspect-figure" aria-hidden="true"><b>{i + 1}</b></span>
            <span className="recap-suspect-plate"><b>{item.label}</b><span>×{item.occurrences}</span><small><AnimatedValue value={item.total} money /></small></span>
          </div>)}
        </div>
        <i className="recap-lineup-flash" aria-hidden="true" />
      </div>;
    }
    case 'milestone':
      // A medal for the round number, and where in the period it landed.
      return <div className="recap-bonus recap-milestone">
        <div className="recap-milestone-medal">
          <svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" className="recap-milestone-track" /><circle cx="50" cy="50" r="44" className="recap-milestone-fill" pathLength={1} /></svg>
          <span><small>Receipt</small><span>#<AnimatedValue value={b.count} /></span></span>
        </div>
        <div className="recap-milestone-line" style={vars({ '--at': (b.dayIndex + .5) / b.totalDays })}>
          <i aria-hidden="true" /><span>{dayLabel(b.date)}</span>
        </div>
      </div>;
    case 'takeover': {
      // A hemicycle of 100 seats, filled left to right; the top category takes its share of them.
      const seats = hemicycle(100);
      const held = Math.round(b.share);
      return <div className="recap-bonus recap-takeover">
        <svg viewBox="-1.08 -1.06 2.16 1.14" className="recap-chamber" aria-hidden="true">
          {seats.map((seat, i) => <circle key={i} cx={seat.x} cy={-seat.y} r=".052" className={i < held ? 'is-held' : undefined} style={vars({ '--i': i })} />)}
        </svg>
        {/* The count sits in the chamber's hollow; who holds the seats goes underneath. */}
        <b className="recap-takeover-count"><AnimatedValue value={held} /></b>
        <div className="recap-takeover-tally">
          <span className="recap-takeover-icon"><CategoryIcon name={b.name} color="currentColor" className="h-[1em] w-[1em]" /></span>
          <span>{b.label}</span>
          <small>{held} of 100 seats</small>
        </div>
      </div>;
    }
    case 'comeback': {
      // A chart of ranks: the category climbs from below the top five to where it sits now.
      const rows = ['#1', '#2', '#3', '#4', '#5', b.previousRank ? `#${b.previousRank}` : 'Off chart'];
      return <div className="recap-bonus recap-comeback" style={vars({ '--from': rows.length - 1, '--to': b.rank - 1 })}>
        <div className="recap-comeback-chart">
          {rows.map((row, i) => <span key={row} className={i === b.rank - 1 ? 'is-now' : i === rows.length - 1 ? 'is-was' : undefined}>{row}</span>)}
          <i className="recap-comeback-trail" aria-hidden="true" />
          <span className="recap-comeback-mover"><CategoryIcon name={b.name} color="currentColor" className="h-[1em] w-[1em]" /><b>{b.label}</b><ArrowUp aria-hidden="true" /></span>
        </div>
        <p className="recap-comeback-tag"><span>{b.previousPeriod}</span><span>{b.share}% now</span></p>
      </div>;
    }
  }
}

/** Seat positions for a parliament-style hemicycle, ordered left to right. */
function hemicycle(total: number) {
  const radii = [.5, .62, .74, .86, .98];
  const weight = radii.reduce((sum, r) => sum + r, 0);
  const counts = radii.map(r => Math.round(total * r / weight));
  counts[counts.length - 1] += total - counts.reduce((sum, n) => sum + n, 0);
  return radii.flatMap((r, row) => Array.from({ length: counts[row] }, (_, i) => {
    const angle = Math.PI * (1 - i / Math.max(1, counts[row] - 1));
    return { x: Math.cos(angle) * r, y: Math.sin(angle) * r, angle };
  })).sort((a, b) => b.angle - a.angle);
}
