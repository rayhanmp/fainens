import { useId } from 'react';

const CENTER = { x: 116, y: 98 };
const RING = 74;

/**
 * A yearly goal's picture: a calendar page with its day circled, inside a ring that fills as the
 * money comes in, and in front what it's for: a car for vehicle tax, a shield for insurance, or a
 * crescent moon and ketupat for Lebaran.
 */
export function YearlyArt({ variant, color, fill = 0 }: { variant: 'vehicle-tax' | 'insurance' | 'lebaran'; color: string; fill?: number }) {
  const id = useId().replace(/:/g, '');
  const share = Math.min(1, Math.max(0, fill));
  return (
    <svg viewBox="0 0 260 200" className="h-[150px] w-[195px] lg:h-[190px] lg:w-[247px]" aria-hidden>
      <defs>
        <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fef3c7" />
          <stop offset="0.5" stopColor="#fbbf24" />
          <stop offset="1" stopColor="#ca8a04" />
        </linearGradient>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} />
          <stop offset="1" stopColor={color} stopOpacity="0.8" />
        </linearGradient>
        <clipPath id={`${id}-page`}><rect x="72" y="54" width="88" height="88" rx="9" /></clipPath>
        <pattern id={`${id}-weave`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#84cc16" />
          <rect width="3" height="6" fill="#65a30d" />
          <rect width="6" height="1" fill="#d9f99d" opacity="0.6" />
        </pattern>
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

      {/* The ground, and a few sparkles. */}
      <path d="M0 176 Q130 162 260 176 V200 H0 Z" fill="#dbeafe" opacity="0.35" mask={`url(#${id}-fade)`} />
      <g fill="#fef3c7">
        <path d="M222 30 l1.4 4.2 l4.2 1.4 l-4.2 1.4 l-1.4 4.2 l-1.4 -4.2 l-4.2 -1.4 l4.2 -1.4 z" />
        <path d="M22 60 l1 3 l3 1 l-3 1 l-1 3 l-1 -3 l-3 -1 l3 -1 z" opacity="0.8" />
      </g>

      {/* The year's ring: a track, and the part already put in. */}
      <circle cx={CENTER.x} cy={CENTER.y} r={RING} fill="none" stroke="#fff" strokeOpacity="0.22" strokeWidth="6" />
      {share > 0 && (
        <circle cx={CENTER.x} cy={CENTER.y} r={RING} fill="none" stroke={`url(#${id}-gold)`} strokeWidth="6" strokeLinecap="round" pathLength="100" strokeDasharray={`${share * 100} 100`} transform={`rotate(-90 ${CENTER.x} ${CENTER.y})`} />
      )}

      {/* The calendar page. */}
      <g>
        <rect x="74" y="58" width="88" height="88" rx="9" fill="#0f172a" opacity="0.15" />
        <rect x="72" y="54" width="88" height="88" rx="9" fill="#fff" />
        <g clipPath={`url(#${id}-page)`}>
          <rect x="72" y="54" width="88" height="20" fill={color} />
          <rect x="84" y="61" width="30" height="5" rx="2.5" fill="#fff" opacity="0.85" />
        </g>
        {[92, 140].map((x) => <rect key={x} x={x - 3} y="47" width="6" height="14" rx="3" fill="#1e3a8a" />)}
        {Array.from({ length: 35 }, (_, index) => {
          const column = index % 7;
          const row = Math.floor(index / 7);
          const x = 79 + column * 11;
          const y = 80 + row * 11;
          const circled = index === 18;
          return (
            <g key={index}>
              <rect x={x} y={y} width="8" height="7" rx="1.6" fill={circled ? color : column >= 5 ? '#bfdbfe' : '#e2e8f0'} opacity={circled ? 0.9 : 1} />
              {circled && <ellipse cx={x + 4} cy={y + 3.5} rx="8" ry="7" fill="none" stroke="#1e3a8a" strokeWidth="1.8" transform={`rotate(-8 ${x + 4} ${y + 3.5})`} />}
            </g>
          );
        })}
      </g>

      {/* What it's for, in front. */}
      {variant === 'vehicle-tax' && (
        <g>
          <ellipse cx="208" cy="184" rx="44" ry="4" fill="#0f172a" opacity="0.18" />
          <path d="M166 172 Q166 160 178 158 L188 157 L198 144 Q202 139 210 139 L226 139 Q233 139 237 145 L244 157 Q252 159 252 168 L252 174 Q252 178 248 178 L170 178 Q166 178 166 174 Z" fill={`url(#${id}-body)`} />
          <path d="M200 145 Q203 142 208 142 L215 142 L215 156 L192 156 Z" fill="#dbeafe" />
          <path d="M219 142 L226 142 Q231 142 234 147 L239 156 L219 156 Z" fill="#dbeafe" />
          <path d="M202 146 l5 -2" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M170 166 H250" stroke="#fff" strokeOpacity="0.3" strokeWidth="1.2" />
          <rect x="246" y="161" width="5" height="4" rx="1" fill="#fef3c7" />
          <rect x="167" y="162" width="4" height="4" rx="1" fill="#fca5a5" />
          <rect x="222" y="161" width="7" height="1.6" rx="0.8" fill="#fff" opacity="0.6" />
          {[184, 232].map((x) => (
            <g key={x}>
              <circle cx={x} cy="178" r="9" fill="#0f172a" />
              <circle cx={x} cy="178" r="4" fill="#cbd5e1" />
              <circle cx={x} cy="178" r="1.4" fill="#475569" />
            </g>
          ))}
        </g>
      )}
      {variant === 'insurance' && (
        <g>
          <ellipse cx="212" cy="188" rx="30" ry="3.5" fill="#0f172a" opacity="0.18" />
          <path d="M212 112 L244 124 V148 Q244 172 212 186 Q180 172 180 148 V124 Z" fill={`url(#${id}-body)`} />
          <path d="M212 119 L238 129 V148 Q238 167 212 179 Q186 167 186 148 V129 Z" fill="none" stroke="#fde68a" strokeWidth="2.4" />
          <path d="M198 148 L208 158 L227 136" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M190 128 Q200 122 212 119" fill="none" stroke="#fff" strokeOpacity="0.45" strokeWidth="2" strokeLinecap="round" />
        </g>
      )}
      {variant === 'lebaran' && (
        <g>
          <path d="M240 96 A30 30 0 1 0 240 152 A24 24 0 1 1 240 96 Z" fill={`url(#${id}-gold)`} transform="rotate(-20 226 124)" />
          <circle cx="248" cy="112" r="1.6" fill="#fef3c7" />
          {[{ x: 196, y: 150, size: 15, string: 104 }, { x: 226, y: 166, size: 11, string: 132 }].map((ketupat) => (
            <g key={ketupat.x}>
              <path d={`M${ketupat.x} ${ketupat.string} V${ketupat.y - ketupat.size}`} stroke="#fef3c7" strokeWidth="1" />
              <path d={`M${ketupat.x} ${ketupat.y - ketupat.size} L${ketupat.x + ketupat.size} ${ketupat.y} L${ketupat.x} ${ketupat.y + ketupat.size} L${ketupat.x - ketupat.size} ${ketupat.y} Z`} fill={`url(#${id}-weave)`} stroke="#3f6212" strokeWidth="1" strokeLinejoin="round" />
              <path d={`M${ketupat.x} ${ketupat.y - ketupat.size + 1} q-5 -3 -8 -9 M${ketupat.x} ${ketupat.y - ketupat.size + 1} q5 -3 8 -9`} fill="none" stroke="#65a30d" strokeWidth="2.4" strokeLinecap="round" />
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}
