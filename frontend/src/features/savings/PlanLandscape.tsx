import { cn } from '../../lib/utils';
import { potColor } from './pots';

export type LandmarkKind = 'goal' | 'miss' | 'in' | 'out';
export type Landmark = { key: string; at: number; kind: LandmarkKind; label: string; detail: string };

const HEIGHT = 200;
const PEAK = 150;

/** Pines along the ground: % from the left, size, and whether it stands in front of the hill. */
const PINES: Array<[number, number, boolean]> = [[3, 0.8, true], [9, 1.1, true], [14, 0.7, true], [27, 0.9, true], [36, 1.2, true], [44, 0.8, true], [58, 1, true], [66, 0.75, true], [79, 1.15, true], [86, 0.85, true], [93, 1, true]];

/** Birds in the open sky between the figures: % from the left, % from the top, size. */
const BIRDS: Array<[number, number, number]> = [[36, 46, 1], [39.5, 42, 0.8], [42, 48, 0.7], [56, 52, 0.75], [58.5, 49, 0.6]];

function Pine({ scale }: { scale: number }) {
  return (
    <svg width={22 * scale} height={36 * scale} viewBox="0 0 22 36" aria-hidden>
      <rect x="9.5" y="27" width="3" height="9" rx="1" fill="#0b1b3a" fillOpacity="0.85" />
      <path d="M11 0 L19 12 H15 L21 21 H16 L22 30 H0 L6 21 H1 L7 12 H3 Z" fill="#0b1b3a" fillOpacity="0.72" />
      <path d="M11 0 L15 6 L11 5 Z" fill="white" fillOpacity="0.25" />
    </svg>
  );
}

function Bird({ scale }: { scale: number }) {
  return (
    <svg width={18 * scale} height={8 * scale} viewBox="0 0 18 8" aria-hidden>
      <path d="M1 6 Q5 0 9 5 Q13 0 17 6" fill="none" stroke="white" strokeOpacity="0.75" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function Cloud({ className, scale = 1 }: { className: string; scale?: number }) {
  return (
    <svg className={cn('absolute', className)} width={110 * scale} height={40 * scale} viewBox="0 0 110 40" aria-hidden>
      <path d="M14 38 C2 38 2 24 14 24 C14 12 30 8 38 16 C44 4 64 2 70 16 C78 10 92 14 92 24 C106 24 106 38 94 38 Z" fill="white" fillOpacity="0.55" />
      <path d="M14 38 C8 38 6 33 10 30 C20 32 80 33 100 31 C102 35 99 38 94 38 Z" fill="#0b1b3a" fillOpacity="0.06" />
    </svg>
  );
}

/**
 * The hero's landscape, drawn from the plan itself: the hill is the balance from today (left) to the
 * end (right), built up in one stratum per pot; goal flags stand where each goal is reached, money
 * in or out sits on the slope, and the summit flag is where the plan lands. Shapes stretch with the
 * card; trees, birds, clouds and markers are HTML so they keep their shape at any width.
 */
export function PlanLandscape({ layers, landmarks }: { layers: number[][]; landmarks: Landmark[] }) {
  const samples = layers[0]?.length ?? 0;
  const totals = Array.from({ length: samples }, (_, index) => layers.reduce((sum, layer) => sum + Math.max(0, layer[index] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const last = Math.max(1, samples - 1);
  const x = (index: number) => ((index / last) * 1000).toFixed(1);
  const y = (value: number) => (HEIGHT - 18 - (value / max) * PEAK).toFixed(1);
  // Each pot's stratum sits on the ones before it.
  const cumulative = layers.map((_, layerIndex) => Array.from({ length: samples }, (_, index) => layers.slice(0, layerIndex + 1).reduce((sum, layer) => sum + Math.max(0, layer[index] ?? 0), 0)));
  const line = (values: number[]) => values.map((value, index) => `${index ? 'L' : 'M'}${x(index)},${y(value)}`).join(' ');
  const top = cumulative[cumulative.length - 1] ?? [];
  const heightAt = (at: number) => {
    const value = top[Math.round(Math.min(1, Math.max(0, at)) * last)] ?? 0;
    return ((18 + (value / max) * PEAK) / HEIGHT) * 100;
  };

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <Cloud className="left-[34%] top-[13%] hidden sm:block" scale={0.85} />
      <Cloud className="left-[50%] top-[34%] hidden sm:block" scale={0.55} />
      {BIRDS.map(([left, topAt, scale], index) => <span key={index} className="absolute hidden sm:block" style={{ left: `${left}%`, top: `${topAt}%` }}><Bird scale={scale} /></span>)}

      <svg className="absolute inset-x-0 bottom-0 h-[150px] w-full sm:h-[190px]" viewBox={`0 0 1000 ${HEIGHT}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="landscape-far" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="white" stopOpacity="0.22" />
            <stop offset="100%" stopColor="white" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        {/* Far mountains with snow on their peaks. */}
        <path d="M0,200 L0,120 L70,86 L130,108 L210,58 L280,96 L340,80 L420,112 L520,70 L590,98 L660,62 L740,104 L820,76 L900,100 L1000,72 L1000,200 Z" fill="url(#landscape-far)" />
        <path d="M195,66 L210,58 L226,68 L216,66 L210,72 L203,66 Z M507,77 L520,70 L533,79 L524,77 L519,82 L513,77 Z M646,70 L660,62 L675,71 L666,69 L660,75 L654,70 Z M988,78 L1000,72 L1000,80 L994,79 Z" fill="white" fillOpacity="0.7" />
        <path d="M0,200 L0,150 C120,128 230,146 360,126 C500,106 610,140 760,118 C860,104 930,118 1000,108 L1000,200 Z" fill="white" fillOpacity="0.06" />

        {/* The plan, one stratum per pot, the first pot at the bottom. */}
        {cumulative.map((values, layerIndex) => {
          const below = layerIndex === 0 ? null : cumulative[layerIndex - 1]!;
          const path = below
            ? `${line(values)} ${below.map((_, index) => `L${x(below.length - 1 - index)},${y(below[below.length - 1 - index]!)}`).join(' ')} Z`
            : `${line(values)} L1000,${HEIGHT} L0,${HEIGHT} Z`;
          return <path key={layerIndex} d={path} fill={`color-mix(in srgb, ${potColor(layerIndex)} 35%, white)`} fillOpacity={0.32 - layerIndex * 0.02} />;
        })}
        {cumulative.slice(0, -1).map((values, layerIndex) => (
          <path key={`seam-${layerIndex}`} d={line(values)} fill="none" stroke="white" strokeOpacity="0.35" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={line(top)} fill="none" stroke="white" strokeOpacity="0.35" strokeWidth="9" strokeLinejoin="round" vectorEffect="non-scaling-stroke" style={{ filter: 'blur(5px)' }} />
        <path d={line(top)} fill="none" stroke="white" strokeOpacity="0.95" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {/* The trail climbing the hill, just below the ridge. */}
        <path d={line(top.map((value) => value * 0.9))} fill="none" stroke="white" strokeOpacity="0.5" strokeWidth="1.25" strokeDasharray="5 6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />

        {/* Foreground ground. */}
        <path d="M0,200 L0,186 C200,178 420,190 640,182 C800,176 900,184 1000,180 L1000,200 Z" fill="#0b1b3a" fillOpacity="0.28" />
      </svg>

      <div className="absolute inset-x-0 bottom-0 h-[150px] sm:h-[190px]">
        {PINES.map(([left, scale], index) => (
          <span key={index} className="absolute bottom-[2px] -translate-x-1/2" style={{ left: `${left}%` }}><Pine scale={scale} /></span>
        ))}

        {/* Today at the foot of the hill, the summit flag where the plan lands. */}
        <span className="absolute h-3 w-3 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-[#fff] bg-[var(--color-accent)]" style={{ left: '0.8%', bottom: `${heightAt(0)}%` }} />
        <span className="absolute -translate-x-full" style={{ left: '99.4%', bottom: `${heightAt(1)}%` }}>
          <svg width="26" height="38" viewBox="0 0 26 38" aria-hidden>
            <line x1="24" y1="1" x2="24" y2="38" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M23 2 L3 7.5 L23 13 Z" fill="#fde68a" stroke="white" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
        </span>

        {landmarks.map((mark) => {
          const left = Math.min(96, Math.max(3, mark.at * 100));
          const align = left > 75 ? 'right-0' : left < 25 ? 'left-0' : 'left-1/2 -translate-x-1/2';
          return (
            <span key={mark.key} tabIndex={0} className="group/flag pointer-events-auto absolute outline-none" style={{ left: `${left}%`, bottom: `${heightAt(mark.at)}%` }} aria-label={`${mark.label}, ${mark.detail}`}>
              {mark.kind === 'goal' || mark.kind === 'miss' ? (
                // A flag planted on the slope; a missed goal flies an outlined one.
                <svg width="18" height="28" viewBox="0 0 18 28" className="-translate-x-[1px] transition-transform group-hover/flag:-translate-y-0.5" aria-hidden>
                  <line x1="1.5" y1="1" x2="1.5" y2="28" stroke="white" strokeWidth="2" strokeLinecap="round" />
                  <path d="M2.5 2 L16 6.5 L2.5 11 Z" fill={mark.kind === 'goal' ? 'white' : 'none'} stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
              ) : (
                <span className={cn('grid h-5 w-5 -translate-x-1/2 translate-y-1/2 place-items-center rounded-full border-2 border-[#fff] text-[11px] font-bold leading-none', mark.kind === 'in' ? 'bg-[#fff] text-[var(--color-accent)]' : 'bg-[var(--color-accent)] text-white')}>
                  {mark.kind === 'in' ? '+' : '−'}
                </span>
              )}
              <span role="tooltip" className={cn('absolute bottom-[calc(100%+0.5rem)] z-30 hidden w-max max-w-[14rem] rounded-lg bg-[var(--ref-on-surface)] px-2.5 py-1.5 text-left text-[11px] leading-snug text-[var(--color-surface)] shadow-lg group-hover/flag:block group-focus/flag:block', align)}>
                <span className="block font-semibold">{mark.label}</span>
                <span className="block opacity-80">{mark.detail}</span>
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
