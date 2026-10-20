import type { CSSProperties } from 'react';
import { Bell, Gavel, Plane } from 'lucide-react';
import { AnimatedValue } from '../AnimatedValue';
import { Burst } from '../Burst';
import { seeded } from '../motion';
import type { Persona } from '../stories';
import './persona-extra.css';

const vars = (values: Record<string, string | number>) => values as CSSProperties;

/** A second set piece for each money personality, built around the same number as the first. */
export function AltPersonaScene({ persona, run }: { persona: Persona; run: number }) {
  const random = seeded(run + 409);
  const number = <span className="recap-scene-figure"><strong>{persona.figurePrefix}<AnimatedValue value={persona.figure} suffix={persona.figureSuffix} /></strong><small>{persona.figureLabel}</small></span>;
  switch (persona.key) {
    case 'monk': return <div className="recap-scene recap-alt-monk" aria-hidden="true">
      {/* A zen garden: sand raked into rings around three stones, a temple bell swinging above. */}
      <svg className="recap-zen-sand" viewBox="0 0 200 90" preserveAspectRatio="none">
        {[0, 1, 2, 3, 4, 5].map(i => <ellipse key={i} cx="100" cy="52" rx={22 + i * 15} ry={9 + i * 6} pathLength={1} style={vars({ '--i': i })} />)}
      </svg>
      {[[46, 58, 9], [52, 50, 6], [58, 60, 5]].map(([x, y, s], i) => <i key={i} className="recap-zen-stone" style={vars({ '--x': `${x}%`, '--y': `${y}%`, '--s': `${s}cqw`, '--i': i })} />)}
      <span className="recap-zen-bell"><Bell /></span>
      {Array.from({ length: 6 }, (_, i) => <b key={i} className="recap-petal" style={vars({ '--x': `${Math.round(random() * 90)}%`, '--d': `${Math.round(random() * 3000)}ms`, '--t': `${5 + random() * 3}s` })} />)}
      {number}
    </div>;
    case 'weekend': return <div className="recap-scene recap-alt-weekend" aria-hidden="true">
      {/* A desk calendar flips through the week and lands on Saturday. */}
      <div className="recap-flipcal">
        {['MON', 'TUE', 'WED', 'THU', 'FRI'].map((day, i) => <span key={day} className="recap-flipcal-page" style={vars({ '--i': i })}>{day}</span>)}
        <span className="recap-flipcal-page is-final">SAT</span>
      </div>
      <b className="recap-tgif">TGIF</b>
      <div className="recap-scene-burst" style={vars({ '--enter': '0ms' })}><Burst seed={run} kind="confetti" count={26} origin="center" delay={1500} /></div>
      {number}
    </div>;
    case 'bigTicket': return <div className="recap-scene recap-alt-bigTicket" aria-hidden="true">
      {/* An auction: a spotlight, the gavel comes down, SOLD. */}
      <i className="recap-spotlight" />
      <span className="recap-gavel"><Gavel /></span>
      <span className="recap-block" />
      <b className="recap-sold">SOLD!</b>
      <span className="recap-paddle">Nº 1</span>
      {number}
    </div>;
    case 'steady': return <div className="recap-scene recap-alt-steady" aria-hidden="true">
      {/* A metronome keeping time while drops fill a glass, one by one. */}
      <div className="recap-metronome"><i className="recap-metronome-arm" /><span /></div>
      <div className="recap-drip-glass"><i className="recap-drip-fill" />{[0, 1, 2].map(i => <b key={i} className="recap-drop" style={vars({ '--i': i })} />)}</div>
      {number}
    </div>;
    case 'loyal': return <div className="recap-scene recap-alt-loyal" aria-hidden="true">
      {/* The order ticket for the usual, printed again, and again. */}
      <div className="recap-ticket">
        <p>Order #{String(Math.min(999, persona.figure * 7)).padStart(3, '0')}</p>
        <b>The usual</b>
        <ol>{Array.from({ length: Math.min(3, Math.max(2, persona.figure)) }, (_, i) => <li key={i} style={vars({ '--i': i })}>1 × the usual</li>)}</ol>
        <span className="recap-ticket-stamp">Regular</span>
      </div>
      {number}
    </div>;
    case 'devotee': return <div className="recap-scene recap-alt-devotee" aria-hidden="true">
      {/* A stadium does the wave for the one category; a banner unfurls. */}
      <div className="recap-crowd">{Array.from({ length: 4 }, (_, row) => <div key={row}>{Array.from({ length: 16 }, (_, seat) => <i key={seat} style={vars({ '--seat': seat, '--row': row })} />)}</div>)}</div>
      <span className="recap-banner">Nº 1 fan</span>
      {number}
    </div>;
    case 'explorer': return <div className="recap-scene recap-alt-explorer" aria-hidden="true">
      {/* A passport page collecting stamps, a plane crossing overhead. */}
      <div className="recap-passport">
        {['ARRIVED', 'VISITED', 'EXPLORED', 'NEW!'].map((text, i) => <span key={text} className="recap-visa" style={vars({ '--i': i, '--r': `${(i % 2 ? 1 : -1) * (6 + i * 3)}deg`, '--x': `${[8, 52, 14, 58][i]}%`, '--y': `${[10, 6, 48, 46][i]}%` })}>{text}</span>)}
      </div>
      <span className="recap-flyby"><Plane /></span>
      {number}
    </div>;
    case 'allRounder': return <div className="recap-scene recap-alt-allRounder" aria-hidden="true">
      {/* Spinning plates on sticks, each wobbling at its own pace, none falling. */}
      <div className="recap-plates">{[0, 1, 2, 3].map(i => <span key={i} className="recap-plate" style={vars({ '--i': i, '--h': `${26 + (i % 2) * 6}cqw`, '--w': `${1.4 + random() * .8}s` })}><i /></span>)}</div>
      {number}
    </div>;
  }
}
