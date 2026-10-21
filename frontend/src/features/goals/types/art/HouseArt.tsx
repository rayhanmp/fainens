import { useId } from 'react';

/**
 * A house goal's picture: a little house with its roof in the goal's colour, a garden path and
 * trees, a "DIJUAL" sign on a post, and in front, the keys on their ring.
 */
export function HouseArt({ color }: { color: string; fill?: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 260 200" className="h-[150px] w-[195px] lg:h-[190px] lg:w-[247px]" aria-hidden>
      <defs>
        <linearGradient id={`${id}-lawn`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a7f3d0" stopOpacity="0.75" />
          <stop offset="1" stopColor="#0f766e" stopOpacity="0.45" />
        </linearGradient>
        <linearGradient id={`${id}-wall`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e2e8f0" />
        </linearGradient>
        <linearGradient id={`${id}-key`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fef3c7" />
          <stop offset="0.5" stopColor="#fbbf24" />
          <stop offset="1" stopColor="#d4a017" />
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

      {/* Sun and clouds. */}
      <circle cx="214" cy="36" r="30" fill="#fde68a" opacity="0.22" />
      <circle cx="214" cy="36" r="17" fill="#fef3c7" opacity="0.95" />
      <g fill="#fff" opacity="0.8">
        <ellipse cx="40" cy="40" rx="18" ry="5.5" />
        <ellipse cx="51" cy="35" rx="10" ry="6.5" />
        <ellipse cx="150" cy="24" rx="13" ry="4" />
        <ellipse cx="158" cy="20" rx="7" ry="4.5" />
      </g>

      {/* Lawn and the far hills. */}
      <g mask={`url(#${id}-fade)`}>
        <path d="M0 140 Q50 118 104 128 T 200 122 T 260 128 V200 H0 Z" fill="#93c5fd" opacity="0.4" />
        <path d="M0 154 Q70 138 130 146 T 260 142 V200 H0 Z" fill={`url(#${id}-lawn)`} />
        {/* The path from the door. */}
        <path d="M104 158 L124 158 L142 200 L84 200 Z" fill="#f1f5f9" opacity="0.9" />
        <g fill="#cbd5e1" opacity="0.8">
          <ellipse cx="114" cy="166" rx="7" ry="2" />
          <ellipse cx="112" cy="177" rx="9" ry="2.4" />
          <ellipse cx="115" cy="190" rx="11" ry="2.8" />
        </g>
      </g>

      {/* Trees either side. */}
      <g>
        <rect x="35" y="128" width="5" height="28" rx="2" fill="#1e3a8a" opacity="0.7" />
        <circle cx="37" cy="116" r="17" fill="#34d399" opacity="0.85" />
        <circle cx="28" cy="124" r="11" fill="#10b981" opacity="0.85" />
        <circle cx="47" cy="126" r="10" fill="#059669" opacity="0.7" />
        <circle cx="32" cy="110" r="5" fill="#a7f3d0" opacity="0.6" />
        <circle cx="176" cy="150" r="9" fill="#10b981" opacity="0.85" />
        <circle cx="186" cy="153" r="7" fill="#34d399" opacity="0.85" />
        <circle cx="62" cy="152" r="7" fill="#34d399" opacity="0.85" />
      </g>

      {/* The house. */}
      <g>
        <rect x="140" y="66" width="10" height="22" fill="#94a3b8" />
        <rect x="138" y="63" width="14" height="4" rx="1" fill="#64748b" />
        <rect x="72" y="96" width="84" height="62" fill={`url(#${id}-wall)`} />
        <rect x="72" y="96" width="84" height="62" fill="none" stroke="#0f172a" strokeOpacity="0.1" />
        <path d="M62 100 L114 60 L166 100 Z" fill={color} />
        <path d="M62 100 L114 60 L166 100" fill="none" stroke="#0f172a" strokeOpacity="0.22" strokeWidth="2" strokeLinejoin="round" />
        <path d="M74 96 L114 66 L154 96" fill="none" stroke="#fff" strokeOpacity="0.25" strokeWidth="1.5" />
        <circle cx="114" cy="84" r="6.5" fill="#bfdbfe" stroke="#fff" strokeWidth="2" />
        <path d="M114 78 V90 M108 84 H120" stroke="#fff" strokeWidth="1.2" />
        {/* Windows with their frames and sills. */}
        {[78, 134].map((x) => (
          <g key={x}>
            <rect x={x} y="110" width="18" height="18" rx="1.5" fill="#bfdbfe" stroke="#fff" strokeWidth="2" />
            <path d={`M${x + 9} 110 V128 M${x} 119 H${x + 18}`} stroke="#fff" strokeWidth="1.4" />
            <path d={`M${x + 2} 113 l5 0 l-5 5 z`} fill="#fff" opacity="0.6" />
            <rect x={x - 2} y="128" width="22" height="3" rx="1" fill="#cbd5e1" />
          </g>
        ))}
        {/* The door and its step. */}
        <rect x="104" y="122" width="20" height="36" rx="2" fill="#1e3a8a" />
        <rect x="107" y="126" width="14" height="12" rx="1" fill="#1d4ed8" opacity="0.6" />
        <circle cx="120" cy="142" r="1.6" fill="#fbbf24" />
        <rect x="101" y="157" width="26" height="3" rx="1" fill="#cbd5e1" />
      </g>

      {/* The sign in the garden. */}
      <g>
        <rect x="203" y="128" width="4" height="46" rx="1.5" fill="#334155" />
        <g transform="rotate(-4 205 126)">
          <rect x="182" y="113" width="46" height="24" rx="3" fill="#fff" stroke="#1e3a8a" strokeWidth="1.5" />
          <rect x="182" y="113" width="46" height="5" rx="2" fill={color} />
          <text x="205" y="129" fontSize="9" fontWeight="800" textAnchor="middle" fill="#1e3a8a" letterSpacing="0.8">DIJUAL</text>
          <rect x="192" y="132" width="26" height="1.6" rx="0.8" fill="#94a3b8" />
        </g>
      </g>

      {/* The keys, on their ring with a tag. */}
      <g transform="rotate(-18 62 178)">
        <circle cx="38" cy="172" r="9" fill="none" stroke="#e2e8f0" strokeWidth="2.2" />
        <g transform="rotate(24 30 182)">
          <rect x="22" y="176" width="14" height="10" rx="2.5" fill={color} />
          <circle cx="25.5" cy="181" r="1.6" fill="#fff" />
        </g>
        <circle cx="54" cy="176" r="10" fill={`url(#${id}-key)`} />
        <circle cx="54" cy="176" r="4" fill="#1e40af" opacity="0.55" />
        <rect x="62" y="173.5" width="40" height="5" rx="2" fill={`url(#${id}-key)`} />
        <path d="M86 178 v5 h4 v-3 h3 v4 h4 v-6" fill="#d4a017" />
        <path d="M66 174.6 H98" stroke="#fff" strokeOpacity="0.6" strokeWidth="1" />
      </g>
    </svg>
  );
}
