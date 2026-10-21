import { useId } from 'react';

/** A point on a quadratic curve from `a` through control `c` to `b`. */
const along = (a: [number, number], c: [number, number], b: [number, number], t: number): [number, number] => [
  (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t ** 2 * b[0],
  (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t ** 2 * b[1],
];

/** The cushion, rings and flowers are drawn a little larger than their sketch, around the cushion's middle. */
const LARGER = 'translate(130 150) scale(1.16) translate(-130 -150)';

const STRANDS: Array<{ a: [number, number]; c: [number, number]; b: [number, number] }> = [
  { a: [-6, 14], c: [130, 66], b: [266, 14] },
  { a: [-6, 34], c: [130, 82], b: [266, 34] },
];

/** A melati flower: five round white petals around a soft gold middle. */
function Jasmine({ x, y, r = 3.4 }: { x: number; y: number; r?: number }) {
  return (
    <g>
      {[0, 72, 144, 216, 288].map((angle) => (
        <ellipse key={angle} cx={x} cy={y - r} rx={r * 0.62} ry={r} fill="#fff" transform={`rotate(${angle} ${x} ${y})`} />
      ))}
      <circle cx={x} cy={y} r={r * 0.4} fill="#fde68a" />
    </g>
  );
}

/** A rose seen from above: petals as a soft spiral in pink. */
function Rose({ x, y, r = 9, tone = '#f9a8d4' }: { x: number; y: number; r?: number; tone?: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill={tone} />
      <path d={`M${x} ${y} m-1 0 a1.6 1.6 0 1 1 2.4 1.4 a3.6 3.6 0 1 1 -5.6 -3.2 a6 6 0 1 1 9.4 5`} fill="none" stroke="#db2777" strokeOpacity="0.55" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx={x - r * 0.35} cy={y - r * 0.4} r={r * 0.22} fill="#fff" opacity="0.35" />
    </g>
  );
}

/**
 * A wedding goal's picture: two rings on a cushion in the goal's colour, roses and melati around
 * it, and strings of lights overhead with jasmine garlands hanging from them.
 */
export function WeddingArt({ color }: { color: string; fill?: number }) {
  const id = useId().replace(/:/g, '');
  const bulbs = STRANDS.flatMap((strand, row) => Array.from({ length: 9 }, (_, index) => along(strand.a, strand.c, strand.b, 0.08 + index * 0.105 + row * 0.04)));
  const garlands = [0.24, 0.5, 0.76].map((t) => along(STRANDS[0].a, STRANDS[0].c, STRANDS[0].b, t));
  return (
    <svg viewBox="0 0 260 200" className="h-[150px] w-[195px] lg:h-[190px] lg:w-[247px]" aria-hidden>
      <defs>
        <linearGradient id={`${id}-cushion`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.05" />
          <stop offset="0.45" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0.6" />
        </linearGradient>
        <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fef3c7" />
          <stop offset="0.45" stopColor="#fbbf24" />
          <stop offset="1" stopColor="#ca8a04" />
        </linearGradient>
        <radialGradient id={`${id}-glow`}>
          <stop offset="0" stopColor="#fef9c3" stopOpacity="0.9" />
          <stop offset="1" stopColor="#fef9c3" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-fade-x`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.14" stopColor="#fff" />
          <stop offset="0.86" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id={`${id}-fade`} maskUnits="userSpaceOnUse" x="0" y="0" width="260" height="200">
          <rect x="0" y="0" width="260" height="200" fill={`url(#${id}-fade-x)`} />
        </mask>
      </defs>

      {/* Strings of lights, and melati garlands hanging from the first. */}
      <g mask={`url(#${id}-fade)`}>
        {STRANDS.map((strand) => (
          <path key={strand.a[1]} d={`M${strand.a.join(' ')} Q${strand.c.join(' ')} ${strand.b.join(' ')}`} fill="none" stroke="#e0f2fe" strokeOpacity="0.8" strokeWidth="1" />
        ))}
        {bulbs.map(([x, y]) => (
          <g key={`${x.toFixed(1)}-${y.toFixed(1)}`}>
            <circle cx={x} cy={y + 4} r="7" fill={`url(#${id}-glow)`} />
            <rect x={x - 1.4} y={y} width="2.8" height="2" rx="0.6" fill="#94a3b8" />
            <ellipse cx={x} cy={y + 4.4} rx="2.4" ry="3" fill="#fef3c7" />
          </g>
        ))}
      </g>
      {garlands.map(([x, y]) => (
        <g key={x.toFixed(1)}>
          <path d={`M${x} ${y} V${y + 30}`} stroke="#fff" strokeOpacity="0.6" strokeWidth="0.8" />
          {[6, 12, 18, 24, 30].map((dy) => <circle key={dy} cx={x} cy={y + dy} r={dy === 30 ? 2.6 : 2.1} fill="#fff" />)}
          <circle cx={x} cy={y + 34} r="1.8" fill="#f9a8d4" />
        </g>
      ))}

      {/* The table's shine and the cushion's shadow. */}
      <ellipse cx="130" cy="186" rx="104" ry="9" fill="#fff" opacity="0.18" mask={`url(#${id}-fade)`} />

      {/* The cushion, with lace edge and tassels. */}
      <g transform={LARGER}>
        <path d="M74 140 Q130 126 186 140 Q198 156 186 172 Q130 184 74 172 Q62 156 74 140 Z" fill="#fdf2f8" />
        <path d="M74 140 Q130 126 186 140 Q198 156 186 172 Q130 184 74 172 Q62 156 74 140 Z" fill={`url(#${id}-cushion)`} />
        <path d="M74 140 Q130 126 186 140 Q198 156 186 172 Q130 184 74 172 Q62 156 74 140 Z" fill="none" stroke="#fff" strokeWidth="2" strokeDasharray="1.5 2.5" strokeLinecap="round" />
        <ellipse cx="130" cy="150" rx="36" ry="8" fill="none" stroke="#fde68a" strokeOpacity="0.8" strokeWidth="1" />
        {([[74, 140], [186, 140], [74, 172], [186, 172]] as const).map(([x, y]) => (
          <g key={`${x}-${y}`}>
            <path d={`M${x} ${y} l${x < 130 ? -4 : 4} 5`} stroke="#fbbf24" strokeWidth="1.4" />
            <circle cx={x + (x < 130 ? -5 : 5)} cy={y + 7} r="2.4" fill="#fbbf24" />
          </g>
        ))}
      </g>

      {/* Two rings standing on it, one through the other, the first with its stone. */}
      <g transform={LARGER}>
        <circle cx="112" cy="124" r="14" fill="none" stroke={`url(#${id}-gold)`} strokeWidth="4.6" />
        <circle cx="134" cy="126" r="14" fill="none" stroke={`url(#${id}-gold)`} strokeWidth="4.6" />
        <path d="M124.12 131 A14 14 0 0 1 119.83 135.61" fill="none" stroke={`url(#${id}-gold)`} strokeWidth="4.6" />
        <path d="M101 116 a14 14 0 0 1 6 -5" fill="none" stroke="#fff" strokeOpacity="0.75" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M108 110 l2 -2.4 h4 l2 2.4 z" fill="#fbbf24" />
        <path d="M106 104 L109 100 H115 L118 104 L112 111 Z" fill="#e0f2fe" stroke="#fff" strokeWidth="0.8" />
        <path d="M106 104 H118 M109 100 L112 104 L115 100 M112 104 V111" stroke="#93c5fd" strokeWidth="0.6" fill="none" />
        <path d="M122 96 l1 3 l3 1 l-3 1 l-1 3 l-1 -3 l-3 -1 l3 -1 z" fill="#fff" />
      </g>

      {/* Roses and melati around the cushion. */}
      <g transform={LARGER}>
        <ellipse cx="62" cy="160" rx="10" ry="4" fill="#10b981" opacity="0.85" transform="rotate(-28 62 160)" />
        <ellipse cx="80" cy="176" rx="9" ry="3.5" fill="#34d399" opacity="0.85" transform="rotate(18 80 176)" />
        <ellipse cx="198" cy="160" rx="10" ry="4" fill="#10b981" opacity="0.85" transform="rotate(28 198 160)" />
        <ellipse cx="182" cy="177" rx="9" ry="3.5" fill="#34d399" opacity="0.85" transform="rotate(-18 182 177)" />
        <Rose x={68} y={168} />
        <Rose x={84} y={159} r={6.5} tone="#fbcfe8" />
        <Rose x={192} y={168} />
        <Rose x={178} y={158} r={6.5} tone="#fbcfe8" />
        <Jasmine x={56} y={178} />
        <Jasmine x={96} y={178} r={3} />
        <Jasmine x={204} y={180} />
        <Jasmine x={166} y={180} r={3} />
        <Jasmine x={52} y={154} r={2.8} />
        <Jasmine x={208} y={152} r={2.8} />
      </g>
    </svg>
  );
}
