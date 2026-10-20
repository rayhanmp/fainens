import { cn } from '../../lib/utils';

export type GardenStop = { key: string; age: number; label: string; detail?: string; emphasis?: boolean };

/** Flowers along the front hill: % from the left, a colour and a size. */
const FLOWERS: Array<[number, string, number]> = [[6, '#fde68a', 1], [8, '#f9a8d4', 0.75], [16, '#ffffff', 0.9], [24, '#f9a8d4', 1], [26.5, '#fde68a', 0.7], [37, '#ffffff', 0.85], [47, '#f9a8d4', 0.95], [49, '#c4b5fd', 0.7], [57, '#fde68a', 1], [63, '#ffffff', 0.8], [71, '#f9a8d4', 0.9], [74, '#c4b5fd', 0.75], [91, '#fde68a', 0.9], [96, '#f9a8d4', 0.8]];

/** Round bushes on the middle hill: % from the left and a size. */
const BUSHES: Array<[number, number]> = [[11, 1], [31, 0.8], [53, 1.1], [68, 0.85], [83, 0.9]];

/** Butterflies over the flowers: % from the left, % from the bottom, colour. */
const BUTTERFLIES: Array<[number, number, string]> = [[19, 44, '#fbbf24'], [44, 50, '#f472b6'], [77, 46, '#a78bfa']];

/** Birds in the open sky: % from the left, % from the top, size. */
const BIRDS: Array<[number, number, number]> = [[30, 12, 1], [33, 7, 0.8], [36, 14, 0.7], [58, 20, 0.8]];

function Flower({ color, scale }: { color: string; scale: number }) {
  return (
    <svg width={14 * scale} height={22 * scale} viewBox="0 0 14 22" aria-hidden>
      <path d="M7 9 C7 14 6 18 7 22" stroke="#2f7d4a" strokeWidth="1.5" fill="none" />
      <path d="M7 16 C9 14 11 14 12 15 C10 16 8 17 7 16 Z" fill="#3f9a5c" />
      {[0, 72, 144, 216, 288].map((angle) => <ellipse key={angle} cx="7" cy="4.5" rx="2.3" ry="3.4" fill={color} transform={`rotate(${angle} 7 7.5)`} />)}
      <circle cx="7" cy="7.5" r="1.9" fill="#f59e0b" />
    </svg>
  );
}

function Bush({ scale }: { scale: number }) {
  return (
    <svg width={46 * scale} height={26 * scale} viewBox="0 0 46 26" aria-hidden>
      <ellipse cx="23" cy="24" rx="21" ry="3" fill="#1f5f37" fillOpacity="0.35" />
      <circle cx="12" cy="16" r="9" fill="#3f9a5c" />
      <circle cx="24" cy="11" r="11" fill="#4fae6c" />
      <circle cx="35" cy="16" r="8.5" fill="#3f9a5c" />
      <circle cx="20" cy="8" r="3" fill="#6cc083" />
      <circle cx="14" cy="14" r="1.6" fill="#f9a8d4" />
      <circle cx="30" cy="10" r="1.6" fill="#fde68a" />
    </svg>
  );
}

function Butterfly({ color }: { color: string }) {
  return (
    <svg width="16" height="12" viewBox="0 0 16 12" className="animate-[pulse_3s_ease-in-out_infinite]" aria-hidden>
      <path d="M8 6 C5 0 0 1 1 5 C1.5 8 5 8 8 6 Z M8 6 C11 0 16 1 15 5 C14.5 8 11 8 8 6 Z" fill={color} />
      <path d="M8 6 C6 9 3 11 3 9 C3 7.5 6 6.5 8 6 Z M8 6 C10 9 13 11 13 9 C13 7.5 10 6.5 8 6 Z" fill={color} fillOpacity="0.75" />
      <rect x="7.4" y="3" width="1.2" height="6" rx="0.6" fill="#3b2a1a" />
    </svg>
  );
}

function Bird({ scale }: { scale: number }) {
  return (
    <svg width={18 * scale} height={8 * scale} viewBox="0 0 18 8" aria-hidden>
      <path d="M1 6 Q5 0 9 5 Q13 0 17 6" fill="none" stroke="#0b2a5c" strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function Cloud({ className, scale = 1 }: { className: string; scale?: number }) {
  return (
    <svg className={cn('absolute', className)} width={120 * scale} height={44 * scale} viewBox="0 0 120 44" aria-hidden>
      <path d="M16 42 C2 42 2 26 16 26 C16 12 34 8 42 18 C48 4 70 2 76 18 C86 10 102 14 102 26 C116 26 116 42 102 42 Z" fill="white" fillOpacity="0.85" />
      <path d="M16 42 C9 42 6 37 10 33 C24 36 88 37 110 34 C112 39 108 42 102 42 Z" fill="#bfdbfe" fillOpacity="0.6" />
    </svg>
  );
}

/** The sun, high and warm, with soft rays. */
function Sun() {
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden>
      <defs>
        <radialGradient id="garden-sun" cx="50%" cy="45%" r="50%">
          <stop offset="0%" stopColor="#fffbe8" />
          <stop offset="60%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#fbbf24" />
        </radialGradient>
      </defs>
      <circle cx="48" cy="48" r="44" fill="#fde68a" fillOpacity="0.18" />
      {Array.from({ length: 12 }, (_, index) => (
        <rect key={index} x="46.5" y="4" width="3" height="11" rx="1.5" fill="#fde68a" fillOpacity="0.85" transform={`rotate(${index * 30} 48 48)`} />
      ))}
      <circle cx="48" cy="48" r="24" fill="url(#garden-sun)" />
    </svg>
  );
}

/** A small cottage: where the path is heading. */
function Cottage() {
  return (
    <svg width="78" height="70" viewBox="0 0 78 70" aria-hidden>
      {/* Chimney smoke. */}
      <path d="M57 10 C54 6 60 4 57 0" fill="none" stroke="white" strokeOpacity="0.7" strokeWidth="2" strokeLinecap="round" />
      <rect x="52" y="12" width="8" height="14" fill="#b45309" />
      <path d="M6 34 L39 10 L72 34 Z" fill="#dc6b4a" />
      <path d="M6 34 L39 10 L42 12 L11 34 Z" fill="#ef8a6a" />
      <rect x="12" y="33" width="54" height="34" fill="#fef3c7" />
      <rect x="12" y="62" width="54" height="5" fill="#f5d99a" />
      <rect x="34" y="44" width="11" height="23" rx="1.5" fill="#8b5a3c" />
      <circle cx="42.5" cy="56" r="1" fill="#fde68a" />
      <rect x="18" y="41" width="11" height="10" rx="1" fill="#93c5fd" stroke="#8b5a3c" strokeWidth="1.5" />
      <line x1="23.5" y1="41" x2="23.5" y2="51" stroke="#8b5a3c" strokeWidth="1" />
      <rect x="50" y="41" width="11" height="10" rx="1" fill="#93c5fd" stroke="#8b5a3c" strokeWidth="1.5" />
      <line x1="55.5" y1="41" x2="55.5" y2="51" stroke="#8b5a3c" strokeWidth="1" />
      <ellipse cx="23" cy="53" rx="6" ry="2" fill="#f9a8d4" />
      <ellipse cx="56" cy="53" rx="6" ry="2" fill="#f9a8d4" />
    </svg>
  );
}

/** A blossoming tree and a bench: where the path reaches retirement. */
function TreeAndBench() {
  return (
    <svg width="104" height="88" viewBox="0 0 104 88" aria-hidden>
      <ellipse cx="44" cy="84" rx="40" ry="4" fill="#1f5f37" fillOpacity="0.3" />
      <path d="M23 84 C24 70 22 56 26 44 L31 44 C30 56 31 70 32 84 Z" fill="#7c5a3a" />
      <path d="M27 54 C20 50 16 46 15 42" stroke="#7c5a3a" strokeWidth="3" fill="none" strokeLinecap="round" />
      <circle cx="28" cy="30" r="22" fill="#3f9a5c" />
      <circle cx="14" cy="38" r="13" fill="#4fae6c" />
      <circle cx="42" cy="36" r="14" fill="#4fae6c" />
      <circle cx="26" cy="16" r="10" fill="#6cc083" />
      {[[34, 20, '#f9a8d4'], [18, 28, '#fde68a'], [40, 34, '#f9a8d4'], [12, 40, '#f9a8d4'], [28, 38, '#fde68a'], [22, 18, '#f9a8d4']].map(([cx, cy, fill], index) => (
        <circle key={index} cx={cx as number} cy={cy as number} r="2.6" fill={fill as string} />
      ))}
      {/* The bench, with a cushion. */}
      <rect x="52" y="52" width="46" height="4" rx="2" fill="#a7744c" />
      <rect x="52" y="58" width="46" height="4" rx="2" fill="#a7744c" />
      <rect x="54" y="66" width="44" height="5" rx="2" fill="#a7744c" />
      <rect x="66" y="61" width="16" height="5" rx="2.5" fill="#93c5fd" />
      <rect x="56" y="71" width="3" height="14" fill="#6b4a2f" />
      <rect x="92" y="71" width="3" height="14" fill="#6b4a2f" />
      <rect x="55" y="48" width="3" height="20" fill="#6b4a2f" />
      <rect x="92" y="48" width="3" height="20" fill="#6b4a2f" />
    </svg>
  );
}

/** A short run of picket fence. */
function Fence({ width }: { width: number }) {
  const pickets = Math.max(3, Math.round(width / 10));
  return (
    <svg width={width} height="22" viewBox={`0 0 ${width} 22`} aria-hidden>
      <rect x="0" y="8" width={width} height="3" fill="#fef3c7" fillOpacity="0.9" />
      <rect x="0" y="15" width={width} height="3" fill="#fef3c7" fillOpacity="0.9" />
      {Array.from({ length: pickets }, (_, index) => (
        <path key={index} d={`M${index * (width / pickets) + 2} 22 V5 L${index * (width / pickets) + 4.5} 2 L${index * (width / pickets) + 7} 5 V22 Z`} fill="#fffbeb" />
      ))}
    </svg>
  );
}

/**
 * Retirement as a garden on a sunny day: a path runs from your age now to the age the money should
 * last until, past a tree and a bench where you retire, toward a cottage. Hills stretch with the
 * card; everything on them is HTML so it keeps its shape at any width.
 */
export function RetirementGarden({ fromAge, toAge, restAge, stops }: { fromAge: number; toAge: number; restAge: number; stops: GardenStop[] }) {
  const span = Math.max(1, toAge - fromAge);
  // The path keeps a little room at both ends for the labels.
  const x = (age: number) => 4 + Math.min(1, Math.max(0, (age - fromAge) / span)) * 92;
  const rest = x(restAge);

  return (
    <div className="relative h-[200px] sm:h-[240px]" role="img" aria-label={`From ${fromAge} to ${toAge}: ${stops.map((stop) => `${stop.age} ${stop.label}`).join(', ')}`}>
      <span className="absolute right-[5%] top-0 sm:right-[7%]" aria-hidden><Sun /></span>
      <Cloud className="left-[12%] top-[6%]" scale={0.8} />
      <Cloud className="left-[48%] top-[16%] hidden sm:block" scale={0.6} />
      {BIRDS.map(([left, top, scale], index) => <span key={index} className="absolute" style={{ left: `${left}%`, top: `${top}%` }} aria-hidden><Bird scale={scale} /></span>)}

      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1000 240" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="garden-far" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#a7dfb3" />
            <stop offset="100%" stopColor="#8fd19e" />
          </linearGradient>
          <linearGradient id="garden-near" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#5fb878" />
            <stop offset="100%" stopColor="#3f9a5c" />
          </linearGradient>
        </defs>
        <path d="M0,240 L0,120 C120,96 240,112 360,100 C500,86 600,116 740,98 C850,86 930,100 1000,92 L1000,240 Z" fill="url(#garden-far)" />
        <path d="M0,240 L0,150 C160,134 300,152 460,138 C620,124 780,146 1000,132 L1000,240 Z" fill="#6cc083" />
        <path d="M0,240 L0,178 C200,168 420,182 640,170 C800,162 900,172 1000,168 L1000,240 Z" fill="url(#garden-near)" />
        {/* Grass tufts. */}
        {Array.from({ length: 26 }, (_, index) => {
          const left = 18 + index * 38;
          const base = 214 + (index % 3) * 6;
          return <path key={index} d={`M${left},${base} l3,-9 l2,9 l3,-7 l2,7`} fill="none" stroke="#2f7d4a" strokeOpacity="0.5" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />;
        })}
        {/* The garden path, with a soft edge. */}
        <path d="M0,182 C250,174 500,186 750,176 C860,172 940,176 1000,174 L1000,190 C940,192 860,188 750,192 C500,202 250,190 0,198 Z" fill="#e8d39c" />
        <path d="M0,184 C250,176 500,188 750,178 C860,174 940,178 1000,176 L1000,186 C940,188 860,184 750,188 C500,198 250,186 0,194 Z" fill="#f6e7bd" />
      </svg>

      {BUSHES.map(([left, scale], index) => (
        <span key={index} className="absolute bottom-[78px] -translate-x-1/2 sm:bottom-[92px]" style={{ left: `${left}%` }} aria-hidden><Bush scale={scale} /></span>
      ))}
      <span className="absolute bottom-[58px] right-[2%] hidden sm:bottom-[66px] sm:block" aria-hidden><Fence width={110} /></span>
      <span className="absolute bottom-[64px] right-[5%] sm:bottom-[74px] sm:right-[9%]" aria-hidden><Cottage /></span>
      {FLOWERS.map(([left, color, scale], index) => (
        <span key={index} className="absolute bottom-[64px] sm:bottom-[74px]" style={{ left: `${left}%` }} aria-hidden><Flower color={color} scale={scale} /></span>
      ))}
      {BUTTERFLIES.map(([left, bottom, color], index) => (
        <span key={index} className="absolute hidden sm:block" style={{ left: `${left}%`, bottom: `${bottom}%` }} aria-hidden><Butterfly color={color} /></span>
      ))}

      <span className="absolute bottom-[50px] -translate-x-[30%] sm:bottom-[58px]" style={{ left: `${rest}%` }} aria-hidden><TreeAndBench /></span>

      {stops.map((stop, index) => {
        const left = x(stop.age);
        const align = index === 0 ? 'left-0 text-left' : index === stops.length - 1 ? 'right-0 text-right' : 'left-1/2 -translate-x-1/2 text-center';
        // A label too close to a neighbour goes above the path, so retirement's own label keeps its place below.
        const near = (other: GardenStop | undefined) => other !== undefined && Math.abs(x(other.age) - left) < 16;
        const crowded = !stop.emphasis && index > 0 && index < stops.length - 1 && (near(stops[index - 1]) || near(stops[index + 1]));
        return (
          <span key={stop.key} className="absolute bottom-[40px] sm:bottom-[46px]" style={{ left: `${left}%` }}>
            <span className={cn('absolute left-0 top-0 block -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#fff] shadow-sm', stop.emphasis ? 'h-4 w-4 bg-[#f59e0b]' : 'h-3 w-3 bg-[#2f7d4a]')} aria-hidden />
            <span className={cn('absolute w-max max-w-[9rem] rounded-md bg-[#1f5f37]/70 px-1.5 py-0.5 text-[11px] leading-tight text-white backdrop-blur-[2px]', crowded ? 'bottom-2.5' : 'top-2.5', align)}>
              <span className="font-bold tabular-nums">{stop.age}</span>
              {/* Phones show the ages alone (and Retire); the words fit from tablet width up. */}
              <span className={cn(!stop.emphasis && 'hidden sm:inline')}> {stop.label}</span>
              {stop.detail && <span className="hidden text-white/85 sm:block">{stop.detail}</span>}
            </span>
          </span>
        );
      })}
    </div>
  );
}
