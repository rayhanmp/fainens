import { useId } from 'react';

/** One envelope in the organiser: its goal's colour and how full the goal is (0–1). */
export type Envelope = { key: string | number; color: string; fill: number };

/** The organiser holds four envelopes; slots without a goal hold a spare, blank one. */
const SLOTS = 4;

/**
 * A desk: an open wallet tipping coins into an envelope organiser, a month on the calendar behind
 * it and a plant beside. Each front envelope is one of your goals, in its colour, with banknotes
 * sticking out as far as the goal is filled; a full one gets a tick. Spare slots hold blank ones.
 */
export function GoalsIllustration({ envelopes }: { envelopes: Envelope[] }) {
  const id = useId().replace(/:/g, '');
  const shown = envelopes.slice(0, SLOTS);
  const slotX = (index: number) => 184 + index * 25;
  const slotY = (index: number) => 64 + (index % 2) * 9;

  return (
    <svg viewBox="0 0 360 184" className="h-[123px] w-[240px] xl:h-[176px] xl:w-[344px]" aria-hidden>
      <defs>
        <linearGradient id={`${id}-wallet`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#1e40af" />
          <stop offset="100%" stopColor="#0b1b3a" />
        </linearGradient>
        <linearGradient id={`${id}-box`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#1e3a8a" />
          <stop offset="100%" stopColor="#0f1f4d" />
        </linearGradient>
        <linearGradient id={`${id}-coin`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#fef3c7" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
        <linearGradient id={`${id}-note`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#bbf7d0" />
          <stop offset="100%" stopColor="#6ee7b7" />
        </linearGradient>
        <linearGradient id={`${id}-desk`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#bfdbfe" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#bfdbfe" stopOpacity="0.15" />
        </linearGradient>
        <clipPath id={`${id}-above-box`}>
          <rect x="150" y="0" width="190" height="122" />
        </clipPath>
      </defs>

      {/* Soft clouds and sparkles. */}
      <g fill="white" fillOpacity="0.14">
        <ellipse cx="112" cy="22" rx="24" ry="9" />
        <ellipse cx="130" cy="16" rx="16" ry="10" />
        <ellipse cx="268" cy="20" rx="22" ry="8" />
        <ellipse cx="284" cy="14" rx="14" ry="8" />
      </g>
      <path d="M344 34 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 Z" fill="white" fillOpacity="0.9" />
      <path d="M176 14 l1.4 3.4 l3.4 1.4 l-3.4 1.4 l-1.4 3.4 l-1.4 -3.4 l-3.4 -1.4 l3.4 -1.4 Z" fill="white" fillOpacity="0.7" />
      <path d="M92 58 l1.2 3 l3 1.2 l-3 1.2 l-1.2 3 l-1.2 -3 l-3 -1.2 l3 -1.2 Z" fill="white" fillOpacity="0.6" />

      {/* The desk. */}
      <rect x="0" y="166" width="360" height="18" rx="6" fill={`url(#${id}-desk)`} />
      <path d="M6 166.5 H354" stroke="white" strokeOpacity="0.45" strokeWidth="1" />

      {/* A month on the calendar, leaning behind the wallet, one day ringed. */}
      <g transform="rotate(-7 44 74)">
        <rect x="14" y="40" width="62" height="64" rx="6" fill="#f8fafc" />
        <path d="M14 46 a6 6 0 0 1 6 -6 h50 a6 6 0 0 1 6 6 v8 h-62 Z" fill="#60a5fa" />
        <rect x="26" y="35" width="3" height="10" rx="1.5" fill="#1e3a8a" />
        <rect x="61" y="35" width="3" height="10" rx="1.5" fill="#1e3a8a" />
        {Array.from({ length: 15 }, (_, cell) => {
          const column = cell % 5;
          const row = Math.floor(cell / 5);
          return <rect key={cell} x={20 + column * 11} y={60 + row * 11} width="7" height="6" rx="1.5" fill={cell === 7 ? '#f59e0b' : '#cbd5e1'} />;
        })}
        <circle cx="45.5" cy="74" r="6.5" fill="none" stroke="#f59e0b" strokeWidth="1.2" />
      </g>

      {/* The organiser's back, with its slots. */}
      <rect x="174" y="86" width="132" height="80" rx="8" fill="#dbeafe" />
      <path d="M182 96 H298 M182 104 H298" stroke="#93c5fd" strokeOpacity="0.6" strokeWidth="1" />

      {/* Envelopes: your goals with their notes, and blank spares in the empty slots. */}
      <g clipPath={`url(#${id}-above-box)`}>
        {Array.from({ length: SLOTS }, (_, index) => {
          const envelope = shown[index];
          const x = slotX(index);
          const y = slotY(index);
          if (!envelope) {
            return (
              <g key={`spare-${index}`}>
                <rect x={x} y={y + 10} width="42" height="58" rx="3.5" fill="#eef2ff" stroke="#c7d2fe" strokeWidth="0.9" />
                <path d={`M${x} ${y + 13} L${x + 21} ${y + 27} L${x + 42} ${y + 13}`} fill="none" stroke="#c7d2fe" strokeWidth="1.2" />
              </g>
            );
          }
          const fill = Math.min(1, Math.max(0, envelope.fill));
          const notes = fill > 0 ? 6 + fill * 26 : 0;
          return (
            <g key={envelope.key}>
              {notes > 0 && (
                <>
                  <rect x={x + 6} y={y - notes + 8} width="28" height={notes + 4} rx="2" fill={`url(#${id}-note)`} stroke="#059669" strokeOpacity="0.5" strokeWidth="0.7" transform={`rotate(-5 ${x + 20} ${y})`} />
                  <rect x={x + 9} y={y - notes + 12} width="26" height={notes} rx="2" fill="#d1fae5" stroke="#059669" strokeOpacity="0.45" strokeWidth="0.7" transform={`rotate(4 ${x + 20} ${y})`} />
                  <circle cx={x + 22} cy={y - notes + 18} r="3" fill="none" stroke="#047857" strokeOpacity="0.5" strokeWidth="0.8" />
                </>
              )}
              <rect x={x} y={y} width="42" height="58" rx="3.5" fill="#ffffff" stroke="#cbd5e1" strokeWidth="0.9" />
              <path d={`M${x} ${y + 3} L${x + 21} ${y + 19} L${x + 42} ${y + 3}`} fill="none" stroke="#cbd5e1" strokeWidth="1.3" />
              <rect x={x} y={y} width="42" height="4" rx="2" fill={envelope.color} fillOpacity="0.85" />
              <circle cx={x + 21} cy={y + 19} r="5.5" fill={envelope.color} stroke="white" strokeWidth="1.2" />
              {fill >= 1 && <path d={`M${x + 18.6} ${y + 19} l1.8 2 l3.4 -3.8`} fill="none" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />}
            </g>
          );
        })}
      </g>

      {/* The organiser's front: navy, stitched, an accordion side and a paper label. */}
      <path d="M174 116 L166 122 V164 L174 168 Z" fill="#1e3a8a" />
      <path d="M174 122 L168 126 M174 132 L168 136 M174 142 L168 146 M174 152 L168 156" stroke="#60a5fa" strokeOpacity="0.5" strokeWidth="1" />
      <rect x="172" y="116" width="136" height="52" rx="8" fill={`url(#${id}-box)`} />
      <rect x="177" y="121" width="126" height="42" rx="5" fill="none" stroke="#93c5fd" strokeOpacity="0.5" strokeDasharray="3 3" />
      <rect x="218" y="132" width="44" height="18" rx="3" fill="#f8fafc" />
      <path d="M224 138 H256 M224 144 H246" stroke="#94a3b8" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="198" cy="141" r="4" fill="#fde68a" stroke="#b45309" strokeWidth="0.8" />
      <circle cx="282" cy="141" r="4" fill="#fde68a" stroke="#b45309" strokeWidth="0.8" />

      {/* A plant beside the organiser. */}
      <g>
        <path d="M322 96 C312 82 312 70 318 60 C324 72 326 84 322 96 Z" fill="#34d399" />
        <path d="M326 98 C330 82 340 74 350 72 C346 86 338 94 326 98 Z" fill="#10b981" />
        <path d="M320 100 C308 96 300 88 298 80 C310 82 318 90 320 100 Z" fill="#6ee7b7" />
        <path d="M322 96 V108 M326 98 L323 108 M320 100 L322 108" stroke="#047857" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M310 106 H338 L334 166 H314 Z" fill="#f1f5f9" />
        <rect x="308" y="104" width="32" height="8" rx="2" fill="#e2e8f0" />
        <path d="M313 124 H335" stroke="#93c5fd" strokeWidth="2" strokeLinecap="round" />
      </g>

      {/* The wallet, open, with notes peeking out and a clasp. */}
      <g transform="rotate(-8 74 130)">
        <rect x="34" y="92" width="58" height="22" rx="3" fill="#a7f3d0" stroke="#059669" strokeOpacity="0.4" transform="rotate(-8 63 103)" />
        <rect x="42" y="88" width="58" height="22" rx="3" fill="#d1fae5" stroke="#059669" strokeOpacity="0.4" transform="rotate(5 71 99)" />
        <circle cx="71" cy="99" r="5" fill="none" stroke="#047857" strokeOpacity="0.45" transform="rotate(5 71 99)" />
        <rect x="24" y="104" width="96" height="58" rx="11" fill={`url(#${id}-wallet)`} />
        <rect x="30" y="110" width="84" height="46" rx="7" fill="none" stroke="#93c5fd" strokeOpacity="0.55" strokeDasharray="3 3" />
        <path d="M24 120 H104 a10 10 0 0 1 10 10 v4 a10 10 0 0 1 -10 10 H24 Z" fill="#2563eb" />
        <circle cx="102" cy="132" r="5" fill="#fde68a" stroke="#b45309" strokeWidth="1" />
        <circle cx="102" cy="132" r="2" fill="#f59e0b" />
      </g>

      {/* A short stack of coins: the free money. */}
      {[0, 1, 2, 3].map((coin) => (
        <g key={coin} transform={`translate(126 ${160 - coin * 5})`}>
          <ellipse cx="11" cy="3" rx="11" ry="3.6" fill="#d97706" />
          <rect x="0" y="0" width="22" height="3" fill="#f59e0b" />
          <ellipse cx="11" cy="0" rx="11" ry="3.6" fill="#fde68a" stroke="#d97706" strokeWidth="0.6" />
        </g>
      ))}

      {/* Coins on their way into the envelopes. */}
      <path d="M108 96 Q142 34 200 50" fill="none" stroke="white" strokeOpacity="0.55" strokeWidth="1.3" strokeDasharray="2 4" strokeLinecap="round" />
      {[{ cx: 126, cy: 66, r: 7.5 }, { cx: 152, cy: 48, r: 6.5 }, { cx: 178, cy: 43, r: 5.5 }].map((coin) => (
        <g key={coin.cx}>
          <circle cx={coin.cx} cy={coin.cy} r={coin.r} fill={`url(#${id}-coin)`} stroke="#b45309" strokeWidth="0.8" />
          <circle cx={coin.cx} cy={coin.cy} r={coin.r * 0.6} fill="none" stroke="#b45309" strokeOpacity="0.5" strokeWidth="0.6" />
          <path d={`M${coin.cx - coin.r * 0.4} ${coin.cy - coin.r * 0.5} q${coin.r * 0.3} -${coin.r * 0.2} ${coin.r * 0.6} 0`} fill="none" stroke="white" strokeOpacity="0.8" strokeWidth="0.9" strokeLinecap="round" />
        </g>
      ))}
    </svg>
  );
}
