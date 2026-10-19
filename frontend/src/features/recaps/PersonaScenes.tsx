import { Coffee, Compass, Crown, Leaf, MapPin } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { AnimatedValue } from './AnimatedValue';
import { Burst } from './Burst';
import { seeded } from './motion';
import type { Persona } from './stories';

/** Each money personality gets its own over-the-top set piece, built around its one number. */
export function PersonaScene({ persona, run }: { persona: Persona; run: number }) {
  const random = seeded(run + 211);
  const number = <span className="recap-scene-figure"><strong>{persona.figurePrefix}<AnimatedValue value={persona.figure} suffix={persona.figureSuffix} /></strong><small>{persona.figureLabel}</small></span>;
  const scatter = (count: number, render: (style: CSSProperties, i: number) => ReactNode) => Array.from({ length: count }, (_, i) =>
    render({ '--x': `${Math.round(random() * 92)}%`, '--y': `${Math.round(random() * 80)}%`, '--d': `${Math.round(random() * 2400)}ms`, '--s': .6 + random() * .9, '--r': `${Math.round((random() - .5) * 80)}deg`, '--t': `${3 + random() * 3}s` } as CSSProperties, i));
  switch (persona.key) {
    case 'monk': return <div className="recap-scene recap-scene-monk" aria-hidden="true">
      {[0, 1, 2, 3].map(i => <i key={i} className="recap-ripple" style={{ '--i': i } as CSSProperties} />)}
      <svg className="recap-enso" viewBox="0 0 100 100"><path d="M52 10 C 80 10 92 34 90 54 C 88 78 66 92 46 90 C 22 88 8 68 10 46 C 12 28 24 16 36 13" pathLength={1} /></svg>
      <span className="recap-monk-core"><Leaf /></span>
      {scatter(7, (style, i) => <Leaf key={i} className="recap-leaf" style={style} />)}
      <b className="recap-shh">shhh…</b>
      {number}
    </div>;
    case 'weekend': return <div className="recap-scene recap-scene-weekend" aria-hidden="true">
      {[0, 1, 2, 3].map(i => <i key={i} className="recap-disco-beam" style={{ '--i': i } as CSSProperties} />)}
      <span className="recap-disco-string" />
      <span className="recap-disco-ball"><i /></span>
      <div className="recap-eq">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ '--e': `${.35 + random() * .5}s`, '--h': .3 + random() * .7 } as CSSProperties} />)}</div>
      <b className="recap-neon">SAT ✳ SUN</b>
      {number}
    </div>;
    case 'bigTicket': return <div className="recap-scene recap-scene-bigTicket" aria-hidden="true">
      <svg className="recap-gem" viewBox="0 0 100 86">
        <defs><linearGradient id={`gem-${run}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e9fbff" /><stop offset=".5" stopColor="#8fdcff" /><stop offset="1" stopColor="#3d7bd8" /></linearGradient></defs>
        <polygon points="20,4 80,4 98,28 50,84 2,28" fill={`url(#gem-${run})`} />
        <polygon points="20,4 35,28 2,28" fill="#ffffff" opacity=".55" /><polygon points="80,4 65,28 98,28" fill="#1f5fb8" opacity=".35" />
        <polygon points="35,28 50,4 65,28" fill="#ffffff" opacity=".35" /><polygon points="2,28 50,84 35,28" fill="#ffffff" opacity=".25" />
        <polygon points="65,28 50,84 98,28" fill="#1f5fb8" opacity=".3" /><polyline points="2,28 98,28" stroke="#ffffff" strokeWidth=".8" opacity=".7" />
      </svg>
      {scatter(9, (style, i) => <b key={i} className="recap-twinkle" style={style}>✦</b>)}
      <span className="recap-price-tag"><b>SOLD</b></span>
      <div className="recap-scene-burst" style={{ '--enter': '0ms' } as CSSProperties}><Burst seed={run} kind="coins" count={18} origin="cannons" delay={900} /></div>
      {number}
    </div>;
    case 'steady': return <div className="recap-scene recap-scene-steady" aria-hidden="true">
      <div className="recap-cup">{[0, 1, 2].map(i => <i key={i} className="recap-steam" style={{ '--i': i } as CSSProperties} />)}<span className="recap-cup-body" /><span className="recap-cup-handle" /><span className="recap-cup-saucer" /></div>
      <div className="recap-cup-row">{Array.from({ length: Math.min(14, Math.max(3, persona.figure)) }, (_, i) => <Coffee key={i} style={{ '--i': i } as CSSProperties} />)}</div>
      {number}
    </div>;
    case 'loyal': return <div className="recap-scene recap-scene-loyal" aria-hidden="true">
      <div className="recap-punch-card">
        <p>Fainens loyalty club ✳</p>
        <div>{Array.from({ length: 10 }, (_, i) => <i key={i} className={i < Math.min(10, persona.figure) ? 'is-punched' : undefined} style={{ '--i': i } as CSSProperties} />)}</div>
        <span className="recap-punch-stamp">Regular</span>
      </div>
      {number}
    </div>;
    case 'devotee': return <div className="recap-scene recap-scene-devotee" aria-hidden="true">
      <i className="recap-rays" />
      <span className="recap-crown"><Crown /></span>
      <span className="recap-pedestal">Nº 1</span>
      <div className="recap-scene-burst" style={{ '--enter': '0ms' } as CSSProperties}><Burst seed={run} kind="stars" count={22} origin="center" delay={1100} /></div>
      {number}
    </div>;
    case 'explorer': return <div className="recap-scene recap-scene-explorer" aria-hidden="true">
      <div className="recap-map">
        <svg className="recap-route" viewBox="0 0 100 60" preserveAspectRatio="none"><path d="M8 50 C 20 20, 34 54, 46 30 S 70 10, 78 30 S 88 48, 94 14" pathLength={1} /></svg>
        {[[8, 50], [46, 30], [78, 30]].map(([x, y], i) => <MapPin key={i} className="recap-pin" style={{ left: `${x}%`, top: `${y / 60 * 100}%`, '--i': i } as CSSProperties} />)}
        <b className="recap-x" style={{ left: '94%', top: `${14 / 60 * 100}%` }}>✕</b>
        <span className="recap-compass"><Compass /></span>
      </div>
      {number}
    </div>;
    case 'allRounder': return <div className="recap-scene recap-scene-allRounder" aria-hidden="true">
      <div className="recap-juggle">{['circle', 'square', 'triangle'].map((shape, i) => <i key={shape} className={`recap-juggle-${shape}`} style={{ '--i': i } as CSSProperties} />)}</div>
      <span className="recap-seesaw"><i /></span>
      {number}
    </div>;
  }
}
