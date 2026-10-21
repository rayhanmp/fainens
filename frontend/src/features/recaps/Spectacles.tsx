import { useId, type CSSProperties } from 'react';
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
      <Aurora seed={seed} />
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
      <LavaLamp />
      <i className="recap-sp-flood is-round" />
    </>;
  }
}

/** A wavy line across the sky: points every 10 units from x=-20 to 120, as an SVG path fragment. */
const wave = (random: () => number, base: number, amp: number, phase: number, freq = .9) =>
  range(15).map(i => { const x = -20 + i * 10; return `${x} ${(base + Math.sin(i * freq + phase) * amp + (random() - .5) * 2).toFixed(1)}`; });

/**
 * Aurora: a night over mountains and a still lake. Three curtains of light, bright along their lower
 * edge and fading upward in fine rays, sway on their own beats; the lake mirrors them, softer.
 */
function Aurora({ seed }: { seed: number }) {
  const id = useId().replace(/:/g, '');
  const random = seeded(seed * 7 + 3);
  // Each curtain folds at its own frequency, so they cross and drape rather than stack in parallel bands.
  const curtains = [
    { base: 90, amp: 10, height: 50, phase: 0, freq: .62, hue: 'green' },
    { base: 70, amp: 15, height: 34, phase: 2.1, freq: 1.08, hue: 'teal' },
    { base: 52, amp: 9, height: 26, phase: 4, freq: .44, hue: 'violet' },
  ].map(curtain => {
    const bottom = wave(random, curtain.base, curtain.amp, curtain.phase, curtain.freq);
    const top = wave(random, curtain.base - curtain.height, curtain.amp * 1.5, curtain.phase + .9, curtain.freq * 1.3).reverse();
    return { ...curtain, d: `M ${bottom.join(' L ')} L ${top.join(' L ')} Z` };
  });
  const stars = range(46).map(() => ({ x: random() * 100, y: random() * 92, r: .12 + random() * .32, t: random() * 2000 }));
  // Pines along the near ridge: little triangles of varied height.
  const pines = range(26).map(i => { const x = i * 4 + random() * 2; const h = 3 + random() * 4; const y = 117 - Math.sin(i * .5) * 1.5; return `M ${x - 1.4} ${y} L ${x} ${y - h} L ${x + 1.4} ${y} Z`; }).join(' ');
  const sky = <g>
    {curtains.map(curtain => <g key={curtain.hue} className={`recap-au-curtain is-${curtain.hue}`}>
      <path d={curtain.d} fill={`url(#${id}-${curtain.hue})`} mask={`url(#${id}-rays)`} filter={`url(#${id}-soft)`} />
    </g>)}
  </g>;
  return <svg className="recap-au" viewBox="0 0 100 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#01030a" /><stop offset=".55" stopColor="#061a2c" /><stop offset=".66" stopColor="#0c3446" /><stop offset=".66" stopColor="#03101c" /><stop offset="1" stopColor="#010810" /></linearGradient>
      {[['green', '#7dffc4', '#2fe0a0'], ['teal', '#6af0ff', '#2fb8d6'], ['violet', '#d28bff', '#7c5cff']].map(([hue, edge, body]) =>
        <linearGradient key={hue} id={`${id}-${hue}`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={edge} stopOpacity=".95" /><stop offset=".22" stopColor={body} stopOpacity=".75" />
          <stop offset=".65" stopColor="#ff6ad5" stopOpacity=".22" /><stop offset="1" stopColor="#ff6ad5" stopOpacity="0" />
        </linearGradient>)}
      {/* Fine vertical rays: the curtain shows through bright and dim stripes. */}
      {/* Rays of uneven width and brightness, so the curtain reads as light, not as a barcode. */}
      <pattern id={`${id}-ray`} width="7.3" height="10" patternUnits="userSpaceOnUse">
        <rect width="7.3" height="10" fill="#6a6a6a" />
        {[[0, .5, '#fff'], [1.1, .3, '#c8c8c8'], [2, .9, '#fff'], [3.4, .4, '#b5b5b5'], [4.3, .7, '#f2f2f2'], [5.6, .3, '#d6d6d6'], [6.4, .5, '#e8e8e8']].map(([x, w, fill]) =>
          <rect key={String(x)} x={x} width={w} height="10" fill={String(fill)} />)}
      </pattern>
      <mask id={`${id}-rays`}><rect x="-20" y="0" width="140" height="180" fill={`url(#${id}-ray)`} /></mask>
      <filter id={`${id}-soft`} x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="1" /></filter>
      <filter id={`${id}-blur`}><feGaussianBlur stdDeviation="1.6" /></filter>
      <clipPath id={`${id}-lake`}><rect x="0" y="119" width="100" height="61" /></clipPath>
    </defs>
    <rect width="100" height="180" fill={`url(#${id}-sky)`} />
    {stars.map((star, i) => <circle key={i} className="recap-au-star" cx={star.x} cy={star.y} r={star.r} style={vars({ '--t': `${star.t}ms` })} />)}
    {sky}
    {/* The lake mirrors the sky about the shoreline, blurred and dimmer, with a few ripples. */}
    <g clipPath={`url(#${id}-lake)`}>
      <g transform="translate(0 238) scale(1 -1)" opacity=".38" filter={`url(#${id}-blur)`}>{sky}</g>
      {range(5).map(i => <ellipse key={i} className="recap-au-ripple" cx={18 + (i * 29) % 64} cy={126 + i * 8} rx={5 + (i % 3) * 3} ry=".25" fill="#9ff5ff" style={vars({ '--t': `${i * 300}ms` })} />)}
    </g>
    <path d="M0 119 L0 100 L12 92 L22 99 L34 86 L46 97 L58 88 L70 98 L82 90 L100 101 L100 119 Z" fill="#0b2233" />
    <path d="M0 119 L0 108 L10 104 L24 110 L38 103 L52 109 L66 104 L80 110 L92 106 L100 109 L100 119 Z" fill="#05121d" />
    <path d={pines} fill="#020a12" />
    <rect x="0" y="118.6" width="100" height=".5" fill="#8ff0e0" opacity=".25" />
  </svg>;
}

/**
 * Lava lamp: the lamp itself, glowing in a dark room. A metal cap and base, a tapered glass of warm
 * liquid, and wax that rises and falls in blobs that merge and split (an SVG goo filter keeps their
 * edges clean).
 */
function LavaLamp() {
  const id = useId().replace(/:/g, '');
  const glass = 'M34 44 L66 44 Q70 46 71 52 L80 140 Q81 148 74 150 L26 150 Q19 148 20 140 L29 52 Q30 46 34 44 Z';
  const blobs = [
    { cx: 42, cy: 138, r: 9, rise: -78, d: 3.6, t: 0 }, { cx: 58, cy: 140, r: 11, rise: -64, d: 4.4, t: -1.2 },
    { cx: 50, cy: 132, r: 7, rise: -86, d: 3.1, t: -.6 }, { cx: 46, cy: 64, r: 8, rise: 58, d: 4, t: -2 },
    { cx: 57, cy: 90, r: 6, rise: -30, d: 2.8, t: -1.6 }, { cx: 38, cy: 110, r: 5, rise: -46, d: 3.4, t: -.3 },
  ];
  return <div className="recap-lava-room" aria-hidden="true">
    <svg className="recap-lava-lamp" viewBox="0 0 100 200">
      <defs>
        <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#3a3f4a" /><stop offset=".35" stopColor="#d9dde4" /><stop offset=".55" stopColor="#8d939d" /><stop offset="1" stopColor="#2b2f37" /></linearGradient>
        <linearGradient id={`${id}-liquid`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff4f8b" /><stop offset=".6" stopColor="#ff6a5a" /><stop offset="1" stopColor="#ffb347" /></linearGradient>
        <radialGradient id={`${id}-wax`} cx=".4" cy=".35" r=".7"><stop offset="0" stopColor="#fff4a8" /><stop offset=".5" stopColor="#ffd23d" /><stop offset="1" stopColor="#ff8a1f" /></radialGradient>
        <filter id={`${id}-goo`}><feGaussianBlur in="SourceGraphic" stdDeviation="3.2" result="blur" />
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" result="goo" />
          <feComposite in="SourceGraphic" in2="goo" operator="atop" /></filter>
        <clipPath id={`${id}-glass`}><path d={glass} /></clipPath>
      </defs>
      <ellipse cx="50" cy="196" rx="42" ry="4" fill="#ff8a3d" opacity=".25" />
      <path d={glass} fill={`url(#${id}-liquid)`} />
      <g clipPath={`url(#${id}-glass)`}>
        <g filter={`url(#${id}-goo)`} fill={`url(#${id}-wax)`}>
          <ellipse cx="50" cy="152" rx="34" ry="9" />
          {blobs.map((blob, i) => <circle key={i} className="recap-lava-wax" cx={blob.cx} cy={blob.cy} r={blob.r} style={vars({ '--rise': `${blob.rise}px`, '--d': `${blob.d}s`, '--t': `${blob.t}s` })} />)}
        </g>
        {/* Light through the glass: a bright band down the left, a dimmer one on the right. */}
        <path d="M33 54 L27 140" stroke="#fff" strokeOpacity=".35" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M66 56 L72 136" stroke="#fff" strokeOpacity=".14" strokeWidth="1.4" strokeLinecap="round" />
      </g>
      <path d="M40 14 Q50 10 60 14 L66 44 L34 44 Z" fill={`url(#${id}-metal)`} />
      <path d="M26 150 L74 150 L84 190 Q85 194 80 194 L20 194 Q15 194 16 190 Z" fill={`url(#${id}-metal)`} />
      <rect x="24" y="149" width="52" height="3" rx="1.5" fill="#1b1e24" opacity=".5" />
    </svg>
  </div>;
}
