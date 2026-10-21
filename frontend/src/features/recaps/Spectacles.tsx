import type { CSSProperties } from 'react';
import { seeded, type Spectacle } from './motion';
import './spectacles.css';

const vars = (values: Record<string, string | number>) => values as CSSProperties;
const range = (count: number) => Array.from({ length: count }, (_, i) => i);

/**
 * A spectacle between chapters (see SPECTACLE_TRANSITIONS): about five seconds of scenery that ends by
 * washing the card in the next chapter's colour (`--wipe`) and fading away as that chapter arrives.
 * Purely decorative; a tap on the card skips it.
 */
export function SpectacleScene({ name, seed }: { name: Spectacle; seed: number }) {
  const random = seeded(seed * 31 + name.length);
  switch (name) {
    case 'fireworks': return <>
      <i className="recap-sp-sky" />
      {range(6).map(i => <span key={i} className="recap-fw" style={vars({ '--x': `${12 + random() * 76}%`, '--h': `${22 + random() * 34}%`, '--t': `${300 + i * 480 + random() * 160}ms`, '--hue': Math.round(random() * 360) })}>
        <i className="recap-fw-trail" />
        <span className="recap-fw-burst"><i className="recap-fw-flash" />{range(28).map(j => <b key={j} className={j % 2 ? 'is-inner' : undefined} style={vars({ '--a': `${j * (360 / 28)}deg` })} />)}</span>
      </span>)}
      <i className="recap-sp-flood is-round" />
    </>;
    case 'aurora': return <>
      <i className="recap-sp-sky is-aurora" />
      {range(28).map(i => <i key={i} className="recap-sp-star" style={vars({ '--x': `${random() * 100}%`, '--y': `${random() * 70}%`, '--t': `${random() * 1600}ms`, '--s': `${.4 + random() * .8}cqw` })} />)}
      {range(3).map(i => <i key={i} className={`recap-aurora-band is-${i}`} />)}
      <i className="recap-aurora-hills" />
      <i className="recap-sp-flood is-dawn" />
    </>;
    case 'deepsea': return <>
      <i className="recap-sea-water" />
      {range(4).map(i => <i key={i} className="recap-sea-ray" style={vars({ '--x': `${10 + i * 24}%`, '--t': `${i * 300}ms` })} />)}
      {range(16).map(i => <i key={i} className="recap-sea-bubble" style={vars({ '--x': `${random() * 100}%`, '--t': `${600 + random() * 2600}ms`, '--s': `${1.2 + random() * 3}cqw`, '--d': `${1800 + random() * 1400}ms` })} />)}
      {range(3).map(i => <span key={i} className={`recap-sea-fish is-${i}`} style={vars({ '--y': `${28 + i * 18 + random() * 6}%`, '--t': `${700 + i * 520}ms` })}><i /></span>)}
      <i className="recap-sea-floor" />
      <i className="recap-sp-flood is-drain" />
    </>;
    case 'mosaic': return <>
      <div className="recap-mosaic">{range(8 * 14).map(i => {
        const column = i % 8; const row = Math.floor(i / 8);
        const centre = Math.hypot(column - 3.5, (row - 6.5) * .9);
        return <i key={i} style={vars({ '--d1': `${(column + row) * 34}ms`, '--d2': `${centre * 90}ms`, '--d3': `${(13 - row + (column % 2) * 2) * 40}ms` })} />;
      })}</div>
      <span className="recap-mosaic-mark">✳</span>
    </>;
    case 'coinfall': return <>
      <i className="recap-sp-sky is-vault" />
      {/* The pile sits behind the coins, so each coin lands on top of it. */}
      <i className="recap-coin-pile" />
      {range(34).map(i => <span key={i} className="recap-coin-drop" style={vars({ '--x': `${4 + random() * 88}%`, '--t': `${random() * 3000}ms`, '--r': `${(random() - .5) * 720}deg`, '--land': Math.round(2 + random() * 22) })}><b>Rp</b></span>)}
      <i className="recap-sp-flood is-rise" />
    </>;
    case 'lavalamp': return <>
      <div className="recap-lava">{range(6).map(i => <i key={i} className={`recap-lava-blob is-${i}`} style={vars({ '--t': `${-random() * 3000}ms` })} />)}</div>
      <i className="recap-lava-glass" />
      <i className="recap-sp-flood is-round" />
    </>;
  }
}
