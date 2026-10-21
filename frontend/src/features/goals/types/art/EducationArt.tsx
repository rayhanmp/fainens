import { useId } from 'react';

/** A closed book lying flat, seen from the side: its cover, the edge of its pages, and spine bands. */
function Book({ x, y, width, height, cover }: { x: number; y: number; width: number; height: number; cover: string }) {
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx="2.5" fill={cover} />
      <rect x={x + 6} y={y + 3} width={width - 8} height={height - 6} rx="1" fill="#f8fafc" />
      {[0.33, 0.66].map((share) => <path key={share} d={`M${x + 8} ${y + 3 + (height - 6) * share} H${x + width - 3}`} stroke="#cbd5e1" strokeWidth="0.7" />)}
      <rect x={x} y={y} width="6" height={height} rx="2" fill={cover} />
      <path d={`M${x + 1.5} ${y + 3} V${y + height - 3}`} stroke="#fde68a" strokeOpacity="0.85" strokeWidth="1" />
    </g>
  );
}

/**
 * An education goal's picture: a stack of books with a graduation cap on top, its tassel in the
 * goal's colour, a globe on its stand, and a cup of pencils.
 */
export function EducationArt({ color }: { color: string; fill?: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 260 200" className="h-[150px] w-[195px] lg:h-[190px] lg:w-[247px]" aria-hidden>
      <defs>
        <radialGradient id={`${id}-globe`} cx="0.35" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#93c5fd" />
          <stop offset="1" stopColor="#1d4ed8" />
        </radialGradient>
        <radialGradient id={`${id}-halo`}>
          <stop offset="0" stopColor="#fde68a" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fde68a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-desk`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#eff6ff" stopOpacity="0.8" />
          <stop offset="1" stopColor="#93c5fd" stopOpacity="0.35" />
        </linearGradient>
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

      {/* Sparkles, and a soft light behind the cap. */}
      <circle cx="126" cy="100" r="64" fill={`url(#${id}-halo)`} />
      <g fill="#fef3c7">
        <path d="M70 46 l1.5 4.5 l4.5 1.5 l-4.5 1.5 l-1.5 4.5 l-1.5 -4.5 l-4.5 -1.5 l4.5 -1.5 z" />
        <path d="M186 38 l1.2 3.6 l3.6 1.2 l-3.6 1.2 l-1.2 3.6 l-1.2 -3.6 l-3.6 -1.2 l3.6 -1.2 z" opacity="0.85" />
        <path d="M206 78 l1 3 l3 1 l-3 1 l-1 3 l-1 -3 l-3 -1 l3 -1 z" opacity="0.7" />
      </g>
      <g fill="#fff" opacity="0.75">
        <ellipse cx="36" cy="30" rx="16" ry="5" />
        <ellipse cx="46" cy="26" rx="9" ry="6" />
      </g>

      {/* The desk. */}
      <path d="M0 168 H260 V200 H0 Z" fill={`url(#${id}-desk)`} mask={`url(#${id}-fade)`} />
      <path d="M0 168 H260" stroke="#fff" strokeOpacity="0.7" strokeWidth="1.5" mask={`url(#${id}-fade)`} />

      {/* The globe on its stand. */}
      <g>
        <ellipse cx="44" cy="169" rx="15" ry="3.5" fill="#1e3a8a" opacity="0.8" />
        <rect x="42" y="150" width="4" height="18" fill="#1e3a8a" opacity="0.8" />
        <circle cx="44" cy="128" r="21" fill={`url(#${id}-globe)`} />
        <g fill="#a7f3d0" opacity="0.85">
          <path d="M33 116 q6 -6 12 -2 q4 4 -2 8 q-4 4 0 9 q-6 2 -9 -4 q-4 -5 -1 -11 z" />
          <path d="M50 122 q6 -2 9 3 q2 6 -3 10 q-5 3 -6 -3 q-2 -6 0 -10 z" />
          <path d="M38 138 q5 -1 6 3 q-2 4 -6 2 z" />
        </g>
        <path d="M30 112 a21 21 0 0 1 12 -5" fill="none" stroke="#fff" strokeOpacity="0.6" strokeWidth="2" strokeLinecap="round" />
        <path d="M44 104 A25 25 0 0 1 44 152" fill="none" stroke="#fbbf24" strokeWidth="2.4" strokeLinecap="round" transform="rotate(-18 44 128)" />
      </g>

      {/* The books, with the cap on top. */}
      <g>
        <ellipse cx="128" cy="170" rx="56" ry="4" fill="#0f172a" opacity="0.12" />
        <Book x={78} y={150} width={100} height={18} cover="#1e3a8a" />
        <g transform="rotate(-2.5 128 142)">
          <Book x={86} y={134} width={86} height={16} cover={color} />
        </g>
        <Book x={82} y={120} width={84} height={14} cover="#38bdf8" />
        <g>
          <path d="M100 112 H148 L145 124 Q124 130 103 124 Z" fill="#1e293b" />
          <path d="M84 106 L124 93 L164 106 L124 119 Z" fill="#0f172a" />
          <path d="M84 106 L124 93 L164 106" fill="none" stroke="#fff" strokeOpacity="0.2" strokeWidth="1" />
          <circle cx="124" cy="106" r="2.6" fill={color} />
          <path d="M124 106 L158 109 L158 128" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
          <path d="M155 128 h6 l1.5 10 h-9 z" fill={color} />
          <path d="M156 132 v6 M158 132 v6.5 M160 132 v6" stroke="#fff" strokeOpacity="0.35" strokeWidth="0.7" />
        </g>
      </g>

      {/* A cup of pencils and a ruler. */}
      <g>
        <rect x="212" y="102" width="6" height="58" rx="1" fill="#e0f2fe" transform="rotate(10 215 131)" />
        <path d="M213 108 h3 M213 114 h4 M213 120 h3 M213 126 h4 M213 132 h3" stroke="#60a5fa" strokeWidth="0.8" transform="rotate(10 215 131)" />
        <g transform="rotate(-12 200 120)">
          <rect x="196" y="104" width="6" height="34" fill="#fbbf24" />
          <path d="M196 104 L199 96 L202 104 Z" fill="#fde68a" />
          <path d="M198 99 L199 96 L200 99 Z" fill="#1e293b" />
        </g>
        <g transform="rotate(6 208 118)">
          <rect x="204" y="100" width="6" height="36" fill={color} />
          <path d="M204 100 L207 92 L210 100 Z" fill="#fde68a" />
          <path d="M206 95 L207 92 L208 95 Z" fill="#1e293b" />
        </g>
        <rect x="216" y="108" width="6" height="28" fill="#f472b6" transform="rotate(18 219 122)" />
        <path d="M190 128 H226 L222 168 Q208 172 194 168 Z" fill="#fff" />
        <path d="M191.2 140 H224.8 L224 148 H192 Z" fill={color} opacity="0.85" />
        <path d="M194 132 V164" stroke="#e2e8f0" strokeWidth="2" strokeLinecap="round" />
      </g>
    </svg>
  );
}
