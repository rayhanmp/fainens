import { useId } from 'react';

/** Three letters for a place, as on a luggage tag: its airport code when it has one, like "Tokyo (HND)", else TOK for Tokyo. */
const code = (place: string | null | undefined) => {
  if (!place) return 'GO!';
  return place.match(/\b([A-Z]{3})\b/)?.[1] ?? (place.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'GO!');
};

/**
 * A holiday goal's picture for its page: a plane over mountains and sea, and in front a suitcase in
 * the goal's colour with a tag for the first place, a boarding pass from where the first flight
 * leaves on the day you go, and a passport.
 */
export function TripIllustration({ color, place, from, leaves }: { color: string; place?: string | null; from?: string | null; leaves?: number | null }) {
  const id = useId().replace(/:/g, '');
  const day = leaves ? new Date(leaves).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase() : 'SOON';
  return (
    <svg viewBox="0 0 260 200" className="h-[150px] w-[195px] lg:h-[190px] lg:w-[247px]" aria-hidden>
      <defs>
        <linearGradient id={`${id}-peak`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#60a5fa" />
          <stop offset="1" stopColor="#1d4ed8" />
        </linearGradient>
        <linearGradient id={`${id}-sea`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#bfdbfe" stopOpacity="0.55" />
          <stop offset="1" stopColor="#1e3a8a" stopOpacity="0.35" />
        </linearGradient>
        <linearGradient id={`${id}-case`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={color} />
          <stop offset="1" stopColor={color} stopOpacity="0.78" />
        </linearGradient>
        <clipPath id={`${id}-pass`}><rect x="0" y="0" width="72" height="44" rx="6" /></clipPath>
        {/* The land and sea fade out at the sides and bottom, into the sky behind. */}
        <linearGradient id={`${id}-fade-x`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.16" stopColor="#fff" />
          <stop offset="0.84" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id={`${id}-fade`} maskUnits="userSpaceOnUse" x="0" y="0" width="260" height="200">
          <rect x="0" y="0" width="260" height="200" fill={`url(#${id}-fade-x)`} />
        </mask>
      </defs>

      {/* Sun and clouds. */}
      <circle cx="206" cy="40" r="34" fill="#fde68a" opacity="0.22" />
      <circle cx="206" cy="40" r="20" fill="#fef3c7" opacity="0.95" />
      <g fill="#fff" opacity="0.75">
        <ellipse cx="44" cy="44" rx="18" ry="6" />
        <ellipse cx="56" cy="39" rx="11" ry="7" />
        <ellipse cx="140" cy="24" rx="14" ry="4.5" />
        <ellipse cx="149" cy="20" rx="8" ry="5" />
      </g>

      {/* The way it came, and the plane. */}
      <path d="M14 112 C 60 70, 110 52, 168 64" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeDasharray="1 7" opacity="0.8" />
      <g transform="translate(166 58) rotate(-14)">
        <path d="M30 6 L38 6 L31 -7 L26 -7 Z" fill="#dbeafe" />
        <path d="M0 8 C6 3 40 2 58 4 C66 5 71 8 66 11 C60 13 30 13 4 12 Z" fill="#fff" />
        <path d="M2 8 L11 7 L5 -7 L0 -7 Z" fill="#fff" />
        <path d="M4 7.5 L10 7 L6 -3 L3 -3 Z" fill={color} opacity="0.9" />
        <path d="M3 10.5 L12 10.5 L6 15.5 L1 15.5 Z" fill="#e0ecff" />
        <path d="M25 9.5 L41 9.5 L30 27 L23 27 Z" fill="#e0ecff" />
        <path d="M8 10 C 30 11, 50 11, 66 9.6" fill="none" stroke={color} strokeWidth="1.2" opacity="0.8" />
        {[18, 23, 28, 33, 38, 43, 48, 53].map((x) => <circle key={x} cx={x} cy="6.6" r="0.95" fill="#93c5fd" />)}
        <path d="M62 5.4 C65 6 67 7 67.6 8 L63 8 Z" fill="#1e40af" />
      </g>

      <g mask={`url(#${id}-fade)`}>
        {/* Mountains, one with snow. */}
        <path d="M0 150 L36 116 L62 134 L100 98 L138 130 L176 106 L222 140 L260 120 L260 162 L0 162 Z" fill="#93c5fd" opacity="0.5" />
        <path d="M52 162 L112 104 L122 99 L132 104 L196 162 Z" fill={`url(#${id}-peak)`} opacity="0.75" />
        <path d="M101 115 L112 104 L122 99 L132 104 L143 115 L136 112 L130 118 L122 110 L115 118 L108 112 Z" fill="#fff" />

        {/* Sea, with a few waves. */}
        <path d="M0 160 H260 V200 H0 Z" fill={`url(#${id}-sea)`} />
        <g stroke="#fff" strokeWidth="1.5" strokeLinecap="round" opacity="0.55" fill="none">
          <path d="M24 172 q6 -3 12 0 t12 0" />
          <path d="M110 182 q6 -3 12 0 t12 0" />
          <path d="M212 170 q6 -3 12 0" />
        </g>
      </g>

      {/* Passport. */}
      <g transform="rotate(7 56 164)">
        <rect x="38" y="140" width="36" height="48" rx="4" fill="#1e3a8a" />
        <rect x="38" y="140" width="5" height="48" rx="2" fill="#172554" />
        <circle cx="58" cy="160" r="7" fill="none" stroke="#fbbf24" strokeWidth="1.4" />
        <path d="M58 155 v10 M53 160 h10" stroke="#fbbf24" strokeWidth="1" />
        <rect x="47" y="174" width="22" height="2" rx="1" fill="#fbbf24" opacity="0.8" />
        <rect x="50" y="179" width="16" height="1.6" rx="0.8" fill="#fbbf24" opacity="0.6" />
      </g>

      {/* Boarding pass, leaning on the suitcase. */}
      <g transform="translate(82 132) rotate(-9 36 22)">
        <g clipPath={`url(#${id}-pass)`}>
          <rect x="0" y="0" width="72" height="44" fill="#fff" />
          <rect x="0" y="0" width="72" height="9" fill="#dbeafe" />
          <rect x="0" y="0" width="72" height="9" fill={color} opacity="0.35" />
        </g>
        <text x="5" y="6.6" fontSize="4.6" fontWeight="700" fill="#1e3a8a" letterSpacing="0.6">BOARDING PASS</text>
        <text x="5" y="22" fontSize="8.5" fontWeight="800" fill="#0f172a">{from ? code(from) : 'YOU'}</text>
        <path d="M24 19 h7 l-2 -2 M31 19 l-2 2" stroke="#64748b" strokeWidth="1" fill="none" strokeLinecap="round" />
        <text x="33" y="22" fontSize="8.5" fontWeight="800" fill="#0f172a">{code(place)}</text>
        <text x="5" y="31" fontSize="4.4" fill="#64748b">DATE</text>
        <text x="5" y="37.5" fontSize="6" fontWeight="700" fill="#0f172a">{day}</text>
        <text x="30" y="31" fontSize="4.4" fill="#64748b">SEAT</text>
        <text x="30" y="37.5" fontSize="6" fontWeight="700" fill="#0f172a">12A</text>
        <path d="M55 10 V44" stroke="#cbd5e1" strokeWidth="0.8" strokeDasharray="2 2" />
        {[58, 60, 61.5, 63.5, 65, 66.2, 68].map((x, index) => <rect key={x} x={x} y="15" width={index % 2 ? 0.9 : 0.6} height="22" fill="#0f172a" opacity="0.8" />)}
      </g>

      {/* Suitcase, in the goal's colour, with its tag. */}
      <g>
        <rect x="174" y="94" width="26" height="16" rx="5" fill="none" stroke="#0f172a" strokeOpacity="0.55" strokeWidth="4" />
        <rect x="150" y="106" width="74" height="80" rx="10" fill={`url(#${id}-case)`} />
        <rect x="150" y="106" width="74" height="80" rx="10" fill="none" stroke="#0f172a" strokeOpacity="0.15" />
        <rect x="164" y="106" width="7" height="80" fill="#0f172a" opacity="0.14" />
        <rect x="203" y="106" width="7" height="80" fill="#0f172a" opacity="0.14" />
        <circle cx="181" cy="132" r="10" fill="#fef3c7" />
        <path d="M175 133 l12 -4 l-2 3 l3 2 l-2 1 l-4 -1 l-3 3 l-1 -1 l1 -3 z" fill="#1e3a8a" opacity="0.85" />
        <g transform="rotate(-8 205 160)">
          <rect x="190" y="152" width="30" height="15" rx="3" fill="#fff" />
          <text x="205" y="162.6" fontSize="8" fontWeight="800" textAnchor="middle" fill="#1e3a8a">{code(place)}</text>
        </g>
        <circle cx="161" cy="189" r="5" fill="#0f172a" />
        <circle cx="213" cy="189" r="5" fill="#0f172a" />
        <circle cx="161" cy="189" r="1.8" fill="#94a3b8" />
        <circle cx="213" cy="189" r="1.8" fill="#94a3b8" />
      </g>
    </svg>
  );
}
