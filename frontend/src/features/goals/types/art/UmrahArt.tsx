import { useId } from 'react';

/** A minaret's outline: a slender shaft with two balconies, a pointed top and its finial. */
function Minaret({ x, base, top, width = 8 }: { x: number; base: number; top: number; width?: number }) {
  const half = width / 2;
  const height = base - top;
  return (
    <g>
      <rect x={x - half} y={top} width={width} height={height} rx="1" />
      <rect x={x - half - 2} y={top + height * 0.36} width={width + 4} height="3" rx="1" />
      <rect x={x - half - 1.5} y={top + height * 0.12} width={width + 3} height="2.6" rx="1" />
      <path d={`M${x - half} ${top} L${x} ${top - 14} L${x + half} ${top} Z`} />
      <rect x={x - 0.6} y={top - 20} width="1.2" height="7" />
      <circle cx={x} cy={top - 21} r="1.4" />
    </g>
  );
}

/**
 * An umrah goal's picture: the Kaaba at dawn, simply drawn, in black with its gold band and door,
 * the white floor around it, the mosque's arcades and minarets in the soft light behind, and birds.
 */
export function UmrahArt({ color }: { color: string; fill?: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 260 200" className="h-[150px] w-[195px] lg:h-[190px] lg:w-[247px]" aria-hidden>
      <defs>
        <radialGradient id={`${id}-dawn`} gradientUnits="userSpaceOnUse" cx="152" cy="142" r="104">
          <stop offset="0" stopColor="#fde68a" stopOpacity="0.8" />
          <stop offset="0.4" stopColor="#fbcfe8" stopOpacity="0.4" />
          <stop offset="1" stopColor="#bfdbfe" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-floor`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f8fafc" stopOpacity="0.95" />
          <stop offset="1" stopColor="#e2e8f0" stopOpacity="0.7" />
        </linearGradient>
        <linearGradient id={`${id}-band`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fde68a" />
          <stop offset="0.5" stopColor="#fbbf24" />
          <stop offset="1" stopColor="#ca8a04" />
        </linearGradient>
        <linearGradient id={`${id}-side`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#1f2937" />
          <stop offset="1" stopColor="#374151" />
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

      {/* Dawn: a warm glow low in the sky, the last stars above, the sun just rising. */}
      <rect x="0" y="0" width="260" height="200" fill={`url(#${id}-dawn)`} />
      <g fill="#fff">
        <circle cx="30" cy="22" r="1" opacity="0.8" />
        <circle cx="74" cy="12" r="0.8" opacity="0.6" />
        <circle cx="222" cy="18" r="1.1" opacity="0.8" />
        <circle cx="246" cy="44" r="0.8" opacity="0.6" />
        <circle cx="188" cy="10" r="0.7" opacity="0.5" />
      </g>
      <circle cx="198" cy="142" r="24" fill="#fef3c7" opacity="0.35" />
      <circle cx="198" cy="142" r="15" fill="#fef9c3" opacity="0.95" />

      {/* Birds. */}
      <g fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" opacity="0.9">
        <path d="M58 52 q4 -4 8 0 q4 -4 8 0" />
        <path d="M80 40 q3 -3 6 0 q3 -3 6 0" />
        <path d="M168 58 q3.5 -3.5 7 0 q3.5 -3.5 7 0" />
      </g>

      <g mask={`url(#${id}-fade)`}>
        {/* Minarets either side, in the soft light. */}
        <g fill="#dbeafe" opacity="0.7">
          <Minaret x={26} base={150} top={66} />
          <Minaret x={48} base={150} top={84} width={7} />
          <Minaret x={212} base={150} top={84} width={7} />
          <Minaret x={234} base={150} top={66} />
        </g>
        {/* The arcades, a row of arches. */}
        <rect x="0" y="134" width="260" height="30" fill="#eff6ff" opacity="0.75" />
        <g fill="#93c5fd" opacity="0.55">
          {Array.from({ length: 13 }, (_, index) => index * 20 + 4).map((x) => <path key={x} d={`M${x} 162 V146 a6 6 0 0 1 12 0 V162 Z`} />)}
        </g>
        <rect x="0" y="132" width="260" height="3" fill="#fff" opacity="0.8" />
        {/* The white floor, with the circles walked around the Kaaba. */}
        <path d="M0 162 H260 V200 H0 Z" fill={`url(#${id}-floor)`} />
        <g fill="none" stroke={color} strokeOpacity="0.22" strokeWidth="1">
          <ellipse cx="130" cy="174" rx="62" ry="8" />
          <ellipse cx="130" cy="176" rx="90" ry="12" />
          <ellipse cx="130" cy="178" rx="120" ry="17" />
        </g>
      </g>

      {/* The Kaaba: its front and side, the gold band and the door. */}
      <g>
        <ellipse cx="132" cy="171" rx="46" ry="5" fill="#0f172a" opacity="0.15" />
        <path d="M92 96 L116 88 L170 92 L146 100 Z" fill="#374151" />
        <path d="M92 96 L146 100 L146 170 L92 166 Z" fill="#111827" />
        <path d="M146 100 L170 92 L170 162 L146 170 Z" fill={`url(#${id}-side)`} />
        <path d="M92 112 L146 116 L146 124 L92 120 Z" fill={`url(#${id}-band)`} />
        <path d="M146 116 L170 108 L170 116 L146 124 Z" fill="#ca8a04" />
        <path d="M94 116.2 L144 119.9" stroke="#92400e" strokeOpacity="0.45" strokeWidth="1.6" strokeDasharray="2 2.6" />
        <path d="M148 119.4 L168 112.6" stroke="#78350f" strokeOpacity="0.45" strokeWidth="1.6" strokeDasharray="2 2.6" />
        <path d="M104 138.9 L118 139.9 L118 160.9 L104 159.9 Z" fill={`url(#${id}-band)`} />
        <path d="M107 142.5 L115 143.1 L115 157.8 L107 157.2 Z" fill="none" stroke="#92400e" strokeOpacity="0.5" strokeWidth="0.8" />
        <path d="M100 162 L100 166.6 M122 163.6 L122 168.2" stroke="#fbbf24" strokeOpacity="0.5" strokeWidth="1" />
        <path d="M146 100 L146 170" stroke="#fff" strokeOpacity="0.12" strokeWidth="1" />
      </g>
    </svg>
  );
}
