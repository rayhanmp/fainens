import { useId } from 'react';

/**
 * One goal as a big envelope in its colour: banknotes rise out of it as it fills, a coin or two
 * waits beside it, and its emoji sits on the seal. A full one is tied with a ribbon.
 */
export function GoalEnvelope({ color, fill, icon }: { color: string; fill: number; icon: string | null }) {
  const id = useId().replace(/:/g, '');
  const level = Math.min(1, Math.max(0, fill));
  const rise = level > 0 ? 10 + level * 56 : 0;
  const full = level >= 1;

  return (
    <svg viewBox="0 0 260 200" className="h-[150px] w-[195px] lg:h-[190px] lg:w-[247px]" aria-hidden>
      <defs>
        <linearGradient id={`${id}-note`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#bbf7d0" />
          <stop offset="100%" stopColor="#6ee7b7" />
        </linearGradient>
        <linearGradient id={`${id}-paper`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#e0e7ff" />
        </linearGradient>
        <linearGradient id={`${id}-coin`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#fef3c7" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
        <clipPath id={`${id}-mouth`}>
          <rect x="0" y="0" width="260" height="104" />
        </clipPath>
      </defs>

      {/* Glow and shadow. */}
      <circle cx="130" cy="96" r="84" fill="white" fillOpacity="0.08" />
      <ellipse cx="130" cy="186" rx="96" ry="7" fill="#0b1b3a" fillOpacity="0.3" />

      {/* Banknotes rising out of the envelope, as far as the goal is filled. */}
      {rise > 0 && (
        <g clipPath={`url(#${id}-mouth)`}>
          <g transform={`translate(0 ${104 - rise})`}>
            <rect x="66" y="0" width="92" height="120" rx="4" fill={`url(#${id}-note)`} stroke="#059669" strokeOpacity="0.45" transform="rotate(-6 112 60)" />
            <rect x="96" y="6" width="96" height="120" rx="4" fill="#d1fae5" stroke="#059669" strokeOpacity="0.45" transform="rotate(5 144 66)" />
            <circle cx="144" cy="30" r="9" fill="none" stroke="#047857" strokeOpacity="0.45" strokeWidth="1.4" transform="rotate(5 144 66)" />
            <path d="M110 18 h24 M110 26 h16" stroke="#047857" strokeOpacity="0.35" strokeWidth="2" strokeLinecap="round" transform="rotate(5 144 66)" />
          </g>
        </g>
      )}

      {/* The envelope: back, body in the goal's colour, the open flap and a paper lining. */}
      <path d="M44 100 L130 52 L216 100 Z" fill={color} fillOpacity="0.55" />
      <rect x="44" y="100" width="172" height="80" rx="8" fill={`url(#${id}-paper)`} />
      <path d="M44 106 L130 150 L216 106 V172 a8 8 0 0 1 -8 8 H52 a8 8 0 0 1 -8 -8 Z" fill={color} />
      <path d="M44 180 L112 132 M216 180 L148 132" stroke="white" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M52 112 L130 152 L208 112" fill="none" stroke="white" strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="4 4" />

      {/* A ribbon once it's all there. */}
      {full && (
        <g>
          <rect x="44" y="134" width="172" height="12" fill="#fbbf24" />
          <path d="M118 140 C104 124 96 132 108 142 C96 152 104 158 118 142 Z M142 140 C156 124 164 132 152 142 C164 152 156 158 142 142 Z" fill="#f59e0b" />
        </g>
      )}

      {/* The seal, with the goal's emoji. */}
      <circle cx="130" cy="146" r="17" fill="white" stroke={color} strokeWidth="3" />
      <text x="130" y="147" textAnchor="middle" dominantBaseline="central" fontSize="18">{icon ?? '🎯'}</text>

      {/* Coins waiting beside it, and sparkles. */}
      {[0, 1, 2].map((coin) => (
        <g key={coin} transform={`translate(222 ${172 - coin * 6})`}>
          <ellipse cx="12" cy="3" rx="12" ry="4" fill="#d97706" />
          <rect x="0" y="0" width="24" height="3" fill="#f59e0b" />
          <ellipse cx="12" cy="0" rx="12" ry="4" fill={`url(#${id}-coin)`} stroke="#d97706" strokeWidth="0.6" />
        </g>
      ))}
      <circle cx="30" cy="160" r="9" fill={`url(#${id}-coin)`} stroke="#b45309" strokeWidth="0.8" />
      <circle cx="30" cy="160" r="5.4" fill="none" stroke="#b45309" strokeOpacity="0.5" strokeWidth="0.6" />
      <path d="M232 36 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 Z" fill="white" fillOpacity="0.9" />
      <path d="M30 52 l1.4 3.4 l3.4 1.4 l-3.4 1.4 l-1.4 3.4 l-1.4 -3.4 l-3.4 -1.4 l3.4 -1.4 Z" fill="white" fillOpacity="0.7" />
    </svg>
  );
}
