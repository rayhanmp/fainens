import { useId } from 'react';

/** A row of eight gentle waves across the picture, its crest at `y`, filled down to the bottom. */
const waves = (y: number, height: number) => `M0 ${y} ${Array.from({ length: 8 }, () => `q 8.125 ${-height} 16.25 0 t 16.25 0`).join(' ')} V200 H0 Z`;

/**
 * An emergency fund's picture: a life ring in the goal's colour floating on water that rises as the
 * fund fills, a lighthouse on its rock keeping watch, and the sun coming through the clouds.
 */
export function EmergencyArt({ color, fill = 0 }: { color: string; fill?: number }) {
  const id = useId().replace(/:/g, '');
  const share = Math.min(1, Math.max(0, fill));
  // The water's surface: low when the fund is empty, up near the rock's top when it's full.
  const level = 176 - share * 64;
  const ring = { x: 100, y: level - 3 };
  return (
    <svg viewBox="0 0 260 200" className="h-[150px] w-[195px] lg:h-[190px] lg:w-[247px]" aria-hidden>
      <defs>
        <linearGradient id={`${id}-water`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#bfdbfe" stopOpacity="0.85" />
          <stop offset="1" stopColor="#1e40af" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id={`${id}-rock`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#60a5fa" />
          <stop offset="1" stopColor="#1e3a8a" />
        </linearGradient>
        <linearGradient id={`${id}-beam`} x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#fef3c7" stopOpacity="0.7" />
          <stop offset="1" stopColor="#fef3c7" stopOpacity="0" />
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

      {/* Sun through the clouds, and two gulls. */}
      <circle cx="48" cy="42" r="30" fill="#fde68a" opacity="0.2" />
      <circle cx="48" cy="42" r="17" fill="#fef3c7" opacity="0.95" />
      <g fill="#fff" opacity="0.8">
        <ellipse cx="64" cy="54" rx="20" ry="6" />
        <ellipse cx="74" cy="49" rx="11" ry="7" />
        <ellipse cx="138" cy="24" rx="14" ry="4.5" />
        <ellipse cx="146" cy="20" rx="8" ry="5" />
      </g>
      <g fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" opacity="0.85">
        <path d="M112 50 q4 -4 8 0 q4 -4 8 0" />
        <path d="M134 62 q3 -3 6 0 q3 -3 6 0" />
      </g>

      {/* The lighthouse's beam sweeping out over the water. */}
      <path d="M205 24 L118 4 L118 46 Z" fill={`url(#${id}-beam)`} opacity="0.7" />

      <g mask={`url(#${id}-fade)`}>
        {/* The rock and its lighthouse, standing above even a full fund. */}
        <path d="M158 200 L166 140 Q172 94 190 88 L218 86 Q234 90 238 120 L250 200 Z" fill={`url(#${id}-rock)`} />
        <path d="M174 130 Q182 112 196 108 M226 102 Q234 114 236 128" fill="none" stroke="#fff" strokeOpacity="0.25" strokeWidth="2" strokeLinecap="round" />
        <g transform="translate(0 -10)">
          <path d="M194 98 L198 44 L212 44 L216 98 Z" fill="#f8fafc" />
          <path d="M195.6 78 L214.4 78 L215.2 88 L194.8 88 Z" fill={color} />
          <path d="M197 58 L213 58 L213.7 68 L196.3 68 Z" fill={color} />
          <rect x="192" y="40" width="26" height="4" rx="1.5" fill="#1e3a8a" />
          <rect x="198.5" y="28" width="13" height="12" rx="1" fill="#fef3c7" stroke="#1e3a8a" strokeWidth="1.4" />
          <path d="M205 28 V40" stroke="#1e3a8a" strokeWidth="1" />
          <path d="M196 28 Q205 16 214 28 Z" fill="#1e3a8a" />
          <circle cx="205" cy="17" r="1.6" fill="#1e3a8a" />
          <rect x="202.5" y="86" width="5" height="10" rx="2.5" fill="#1e3a8a" opacity="0.85" />
        </g>

        {/* Water: a lighter swell behind, then the sea the ring floats on. */}
        <path d={waves(level - 5, 4)} fill="#dbeafe" opacity="0.35" />
        <path d={waves(level, 5)} fill={`url(#${id}-water)`} />
        <g stroke="#fff" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.6">
          <path d={`M24 ${level + 12} q6 -3 12 0 t12 0`} />
          <path d={`M150 ${level + 20} q6 -3 12 0 t12 0`} />
          <path d={`M62 ${level + 26} q5 -2.5 10 0`} />
        </g>
      </g>

      {/* The life ring, half in the water, with its rope. */}
      <ellipse cx={ring.x} cy={ring.y + 22} rx="26" ry="3" fill="#fff" opacity="0.25" />
      <g transform={`rotate(-12 ${ring.x} ${ring.y})`}>
        <circle cx={ring.x} cy={ring.y} r="18" fill="none" stroke="#fff" strokeWidth="13" />
        <circle cx={ring.x} cy={ring.y} r="18" fill="none" stroke={color} strokeWidth="13" pathLength="100" strokeDasharray="12.5 12.5" />
        <circle cx={ring.x} cy={ring.y} r="24.5" fill="none" stroke="#0f172a" strokeOpacity="0.12" strokeWidth="1" />
        <circle cx={ring.x} cy={ring.y} r="11.5" fill="none" stroke="#0f172a" strokeOpacity="0.12" strokeWidth="1" />
        <circle cx={ring.x} cy={ring.y} r="18" fill="none" stroke="#fef3c7" strokeWidth="1.4" strokeDasharray="3 2.4" opacity="0.9" />
        <path d={`M${ring.x - 14} ${ring.y - 14} q4 -3 9 -4`} fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" opacity="0.8" />
      </g>
      {/* The front of the water laps over the ring's lower half. */}
      <path d={waves(level + 5, 3)} fill="#93c5fd" opacity="0.5" mask={`url(#${id}-fade)`} />
    </svg>
  );
}
