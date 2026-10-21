import { useId } from 'react';

/**
 * A gadget goal's picture: a laptop and a phone on a desk, their screens showing a simple app in
 * the goal's colour, a small plant, and a price tag that's just been marked down.
 */
export function GadgetArt({ color }: { color: string; fill?: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 260 200" className="h-[150px] w-[195px] lg:h-[190px] lg:w-[247px]" aria-hidden>
      <defs>
        <radialGradient id={`${id}-halo`}>
          <stop offset="0" stopColor="#bfdbfe" stopOpacity="0.4" />
          <stop offset="1" stopColor="#bfdbfe" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-desk`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#eff6ff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#93c5fd" stopOpacity="0.35" />
        </linearGradient>
        <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f1f5f9" />
          <stop offset="1" stopColor="#94a3b8" />
        </linearGradient>
        <linearGradient id={`${id}-tag`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fef3c7" />
          <stop offset="1" stopColor="#fbbf24" />
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

      {/* A soft light, and clouds through the window. */}
      <circle cx="122" cy="100" r="76" fill={`url(#${id}-halo)`} />
      <g fill="#fff" opacity="0.75">
        <ellipse cx="208" cy="30" rx="18" ry="5.5" />
        <ellipse cx="219" cy="25" rx="10" ry="6.5" />
        <ellipse cx="44" cy="34" rx="12" ry="4" />
      </g>

      {/* The desk. */}
      <path d="M0 158 H260 V200 H0 Z" fill={`url(#${id}-desk)`} mask={`url(#${id}-fade)`} />
      <path d="M0 158 H260" stroke="#fff" strokeOpacity="0.75" strokeWidth="1.5" mask={`url(#${id}-fade)`} />

      {/* The plant. */}
      <g>
        <g fill="#10b981">
          <ellipse cx="30" cy="124" rx="4" ry="12" transform="rotate(-28 30 132)" />
          <ellipse cx="38" cy="122" rx="4" ry="13" transform="rotate(18 38 132)" />
        </g>
        <g fill="#34d399">
          <ellipse cx="34" cy="120" rx="4.4" ry="14" />
          <ellipse cx="24" cy="130" rx="3.6" ry="9" transform="rotate(-52 26 134)" />
          <ellipse cx="44" cy="130" rx="3.6" ry="9" transform="rotate(52 42 134)" />
        </g>
        <path d="M22 136 H46 L43 158 H25 Z" fill="#fff" />
        <path d="M22.6 140 H45.4 L44.8 145 H23.2 Z" fill={color} opacity="0.85" />
      </g>

      {/* The laptop, its screen showing an app. */}
      <g>
        <rect x="64" y="60" width="116" height="80" rx="6" fill="#0f172a" />
        <rect x="70" y="66" width="104" height="68" rx="2" fill="#f8fafc" />
        <rect x="70" y="66" width="104" height="8" fill="#e2e8f0" />
        <circle cx="75" cy="70" r="1.4" fill="#f87171" />
        <circle cx="80" cy="70" r="1.4" fill="#fbbf24" />
        <circle cx="85" cy="70" r="1.4" fill="#34d399" />
        <rect x="70" y="74" width="22" height="60" fill="#f1f5f9" />
        {[80, 87, 94, 101].map((y) => <rect key={y} x="74" y={y} width={y === 80 ? 14 : 11} height="3" rx="1.5" fill={y === 80 ? color : '#cbd5e1'} opacity={y === 80 ? 0.9 : 1} />)}
        <rect x="98" y="80" width="70" height="22" rx="3" fill={color} />
        <rect x="103" y="85" width="26" height="3" rx="1.5" fill="#fff" opacity="0.85" />
        <rect x="103" y="91" width="40" height="5" rx="2" fill="#fff" />
        <g fill={color} opacity="0.45">
          <rect x="100" y="120" width="7" height="10" rx="1" />
          <rect x="110" y="114" width="7" height="16" rx="1" />
          <rect x="120" y="117" width="7" height="13" rx="1" />
          <rect x="130" y="110" width="7" height="20" rx="1" />
        </g>
        <rect x="142" y="108" width="26" height="3" rx="1.5" fill="#cbd5e1" />
        <rect x="142" y="114" width="20" height="3" rx="1.5" fill="#cbd5e1" />
        <rect x="142" y="120" width="24" height="3" rx="1.5" fill="#cbd5e1" />
        <path d="M54 140 H190 L198 152 H46 Z" fill={`url(#${id}-metal)`} />
        <path d="M46 152 H198 V155 Q122 158 46 155 Z" fill="#64748b" />
        <rect x="110" y="140" width="24" height="3" rx="1.5" fill="#64748b" opacity="0.6" />
        <path d="M60 142 H184" stroke="#fff" strokeOpacity="0.5" strokeWidth="0.8" />
      </g>

      {/* The phone, leaning beside it. */}
      <g transform="rotate(8 216 124)">
        <rect x="201" y="94" width="30" height="58" rx="6" fill="#0f172a" />
        <rect x="204" y="99" width="24" height="48" rx="3" fill="#f8fafc" />
        <rect x="212" y="96" width="8" height="1.6" rx="0.8" fill="#334155" />
        <circle cx="210" cy="106" r="3.4" fill={color} />
        <rect x="216" y="104" width="9" height="2" rx="1" fill="#cbd5e1" />
        <rect x="216" y="108" width="6" height="2" rx="1" fill="#e2e8f0" />
        <rect x="207" y="114" width="18" height="12" rx="2" fill={color} opacity="0.85" />
        <rect x="207" y="129" width="18" height="2.4" rx="1.2" fill="#cbd5e1" />
        <rect x="207" y="134" width="13" height="2.4" rx="1.2" fill="#cbd5e1" />
        <rect x="211" y="141" width="10" height="2" rx="1" fill={color} opacity="0.6" />
      </g>
      <ellipse cx="218" cy="157" rx="16" ry="2.4" fill="#0f172a" opacity="0.15" />

      {/* The price tag, on a string from the laptop, marked down. */}
      <path d="M176 64 C 196 78, 186 150, 162.8 170" fill="none" stroke="#e2e8f0" strokeWidth="1" />
      <g transform="rotate(-10 152 172)">
        <path d="M126 164 H160 L170 172 L160 180 H126 Q122 180 122 176 V168 Q122 164 126 164 Z" fill={`url(#${id}-tag)`} />
        <circle cx="163" cy="172" r="2" fill="#fff" />
        <text x="144" y="175.2" fontSize="8.5" fontWeight="800" textAnchor="middle" fill="#1e3a8a">−10%</text>
      </g>
    </svg>
  );
}
