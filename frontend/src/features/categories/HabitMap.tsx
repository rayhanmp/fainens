import { createElement, useState } from 'react';
import { cn } from '../../lib/utils';
import { categoryIcon } from './category-icon';

export type HabitPoint = { id: number; name: string; color: string | null; amount: number; count: number; average: number };

/** Drawn in a fixed box that scales with the card's width; text stays readable at card sizes. */
const W = 640;
const H = 300;
/** The plot sits inside these margins; the axis labels live in the left and bottom ones. */
const PLOT = { left: 54, right: 8, top: 8, bottom: 26 };
const MIN_RADIUS = 6;
const MAX_RADIUS = 24;
/** Bubbles at least this big carry their category's icon. */
const ICON_RADIUS = 11;
const LABEL_HEIGHT = 14;

const log = Math.log10;

type Box = { x1: number; y1: number; x2: number; y2: number };
const overlaps = (a: Box, b: Box) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
/** Whether a box comes closer to a circle's centre than its radius (less a little slack). */
function hitsCircle(box: Box, cx: number, cy: number, r: number) {
  const dx = Math.max(box.x1 - cx, 0, cx - box.x2);
  const dy = Math.max(box.y1 - cy, 0, cy - box.y2);
  return dx * dx + dy * dy < (r - 1) * (r - 1);
}

/** Powers of ten across [min, max] (already in log10), for the axis ticks. */
function decades(min: number, max: number) {
  const ticks: number[] = [];
  for (let power = Math.ceil(min); power <= Math.floor(max); power += 1) ticks.push(power);
  return ticks;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** The log range of the values, never narrower than half a decade. */
function logRange(values: number[]) {
  const low = log(Math.min(...values));
  const high = log(Math.max(...values));
  const pad = Math.max(0, 0.5 - (high - low)) / 2;
  return [low - pad, high + pad];
}

/**
 * Spending habits per category: how often (entries, across) against how much each time (average
 * per entry, up), with the bubble's area as the total. Both axes are logarithmic, since a daily
 * habit and a yearly splurge differ by orders of magnitude. The medians split the plot into four
 * habits, named in the corners; names go beside bubbles only where they fit, the rest on hover.
 */
export function HabitMap({ points, format, short }: { points: HabitPoint[]; format: (value: number) => string; short: (value: number) => string }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const data = points.filter((point) => point.count > 0 && point.amount > 0);
  if (data.length === 0) return null;

  const [xMin, xMax] = logRange(data.map((point) => point.count));
  const [yMin, yMax] = logRange(data.map((point) => point.average));
  // Values map inside the plot less the biggest radius, so no bubble is cut by the edge.
  const inner = { left: PLOT.left + MAX_RADIUS, right: W - PLOT.right - MAX_RADIUS, top: PLOT.top + MAX_RADIUS, bottom: H - PLOT.bottom - MAX_RADIUS };
  const x = (count: number) => inner.left + ((log(count) - xMin) / (xMax - xMin || 1)) * (inner.right - inner.left);
  const y = (average: number) => inner.bottom - ((log(average) - yMin) / (yMax - yMin || 1)) * (inner.bottom - inner.top);
  const maxAmount = Math.max(...data.map((point) => point.amount));
  // Area, not radius, follows the total.
  const radius = (amount: number) => MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * Math.sqrt(amount / maxAmount);
  const midX = x(median(data.map((point) => point.count)));
  const midY = y(median(data.map((point) => point.average)));
  const plot = { x1: PLOT.left, y1: PLOT.top, x2: W - PLOT.right, y2: H - PLOT.bottom };

  // Biggest first, so smaller bubbles sit on top and stay hoverable.
  const drawn = [...data]
    .sort((a, b) => b.amount - a.amount)
    .map((point) => ({ point, cx: x(point.count), cy: y(point.average), r: radius(point.amount) }));

  // Names, biggest bubble first: try right, left, above, below; keep the first spot that clears
  // every other bubble, every placed name and the corner captions.
  const corners: Box[] = [
    { x1: plot.x1, y1: plot.y1, x2: plot.x1 + 96, y2: plot.y1 + 20 },
    { x1: plot.x2 - 104, y1: plot.y1, x2: plot.x2, y2: plot.y1 + 20 },
    { x1: plot.x1, y1: plot.y2 - 20, x2: plot.x1 + 92, y2: plot.y2 },
    { x1: plot.x2 - 100, y1: plot.y2 - 20, x2: plot.x2, y2: plot.y2 },
  ];
  const placed: Box[] = [...corners];
  const labels: Array<{ id: number; text: string; x: number; y: number; anchor: 'start' | 'end' | 'middle' }> = [];
  for (const { point, cx, cy, r } of drawn) {
    const width = point.name.length * 6.1 + 2;
    const spots = [
      { x: cx + r + 5, y: cy, anchor: 'start' as const, box: { x1: cx + r + 4, y1: cy - LABEL_HEIGHT / 2, x2: cx + r + 6 + width, y2: cy + LABEL_HEIGHT / 2 } },
      { x: cx - r - 5, y: cy, anchor: 'end' as const, box: { x1: cx - r - 6 - width, y1: cy - LABEL_HEIGHT / 2, x2: cx - r - 4, y2: cy + LABEL_HEIGHT / 2 } },
      { x: cx, y: cy - r - 9, anchor: 'middle' as const, box: { x1: cx - width / 2, y1: cy - r - 4 - LABEL_HEIGHT, x2: cx + width / 2, y2: cy - r - 3 } },
      { x: cx, y: cy + r + 10, anchor: 'middle' as const, box: { x1: cx - width / 2, y1: cy + r + 3, x2: cx + width / 2, y2: cy + r + 4 + LABEL_HEIGHT } },
    ];
    const spot = spots.find(({ box }) =>
      box.x1 >= plot.x1 + 2 && box.x2 <= plot.x2 - 2 && box.y1 >= plot.y1 && box.y2 <= plot.y2
      && !placed.some((other) => overlaps(box, other))
      && !drawn.some((other) => other.point.id !== point.id && hitsCircle(box, other.cx, other.cy, other.r)));
    if (!spot) continue;
    placed.push(spot.box);
    labels.push({ id: point.id, text: point.name, x: spot.x, y: spot.y, anchor: spot.anchor });
  }

  const active = drawn.find((item) => item.point.id === hovered) ?? null;
  const corner = 'pointer-events-none fill-[var(--ref-outline)] text-[9.5px] font-semibold uppercase tracking-wider';
  const quadrant = (x1: number, y1: number, x2: number, y2: number, tint: number) => (
    <rect x={x1} y={y1} width={Math.max(0, x2 - x1)} height={Math.max(0, y2 - y1)} fill="var(--ref-on-surface)" fillOpacity={tint} />
  );

  return (
    <div className="relative" onMouseLeave={() => setHovered(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Categories by how often you spend and how much each time">
        <defs>
          <clipPath id="habit-plot">
            <rect x={plot.x1} y={plot.y1} width={plot.x2 - plot.x1} height={plot.y2 - plot.y1} rx={12} />
          </clipPath>
        </defs>
        {/* Four softly tinted quadrants in a rounded plot, split at the medians: no axis lines. */}
        <g clipPath="url(#habit-plot)">
          {quadrant(plot.x1, plot.y1, midX, midY, 0.035)}
          {quadrant(midX, plot.y1, plot.x2, midY, 0.055)}
          {quadrant(plot.x1, midY, midX, plot.y2, 0.02)}
          {quadrant(midX, midY, plot.x2, plot.y2, 0.035)}
          <line x1={midX} x2={midX} y1={plot.y1} y2={plot.y2} stroke="var(--ref-surface-container-lowest)" strokeWidth={2} />
          <line x1={plot.x1} x2={plot.x2} y1={midY} y2={midY} stroke="var(--ref-surface-container-lowest)" strokeWidth={2} />
        </g>

        <text x={plot.x1 + 10} y={plot.y1 + 14} className={corner}>Rare & pricey</text>
        <text x={plot.x2 - 10} y={plot.y1 + 14} textAnchor="end" className={corner}>Often & pricey</text>
        <text x={plot.x1 + 10} y={plot.y2 - 8} className={corner}>Rare & cheap</text>
        <text x={plot.x2 - 10} y={plot.y2 - 8} textAnchor="end" className={corner}>Small & often</text>

        {decades(xMin, xMax).map((power) => (
          <text key={`x${power}`} x={x(10 ** power)} y={H - 8} textAnchor="middle" className="fill-[var(--ref-outline)] text-[10px] tabular-nums">{(10 ** power).toLocaleString('id-ID')}×</text>
        ))}
        <text x={plot.x2} y={H - 8} textAnchor="end" className="fill-[var(--ref-outline)] text-[10px]">entries →</text>
        {decades(yMin, yMax).map((power) => (
          <text key={`y${power}`} x={PLOT.left - 8} y={y(10 ** power)} textAnchor="end" dominantBaseline="middle" className="fill-[var(--ref-outline)] text-[10px] tabular-nums">{short(10 ** power)}</text>
        ))}
        <text x={PLOT.left - 8} y={plot.y1 + 8} textAnchor="end" className="fill-[var(--ref-outline)] text-[10px]">each ↑</text>

        {drawn.map(({ point, cx, cy, r }) => {
          const color = point.color ?? 'var(--ref-outline)';
          const dim = hovered != null && hovered !== point.id;
          return (
            <g key={point.id} onMouseEnter={() => setHovered(point.id)} className={cn('transition-opacity', dim && 'opacity-25')}>
              {/* A bigger invisible target than the mark, so small bubbles are easy to hover. */}
              <circle cx={cx} cy={cy} r={Math.max(r, 10)} fill="transparent" />
              <circle cx={cx} cy={cy} r={r} fill={color} fillOpacity={hovered === point.id ? 1 : 0.82} stroke="var(--ref-surface-container-lowest)" strokeWidth={2} />
              {r >= ICON_RADIUS && createElement(categoryIcon(point.name), {
                x: cx - r * 0.42,
                y: cy - r * 0.42,
                width: r * 0.84,
                height: r * 0.84,
                color: 'white',
                strokeWidth: 2.25,
                className: 'pointer-events-none',
                'aria-hidden': true,
              })}
            </g>
          );
        })}
        {labels.map((label) => (
          <text
            key={`label-${label.id}`}
            x={label.x}
            y={label.y}
            textAnchor={label.anchor}
            dominantBaseline="middle"
            className={cn('pointer-events-none fill-[var(--ref-on-surface-variant)] text-[11px] font-medium transition-opacity', hovered != null && hovered !== label.id && 'opacity-25')}
          >
            {label.text}
          </text>
        ))}
      </svg>

      {active && (
        <div
          className="pointer-events-none absolute z-20 w-52 -translate-y-1/2 rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-2.5 text-xs shadow-xl"
          style={{
            top: `${(active.cy / H) * 100}%`,
            ...(active.cx < W * 0.6
              ? { left: `calc(${(active.cx / W) * 100}% + ${active.r + 12}px)` }
              : { right: `calc(${100 - (active.cx / W) * 100}% + ${active.r + 12}px)` }),
          }}
          role="status"
        >
          <p className="flex items-center gap-1.5 font-semibold text-[var(--ref-on-surface)]">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: active.point.color ?? 'var(--ref-outline)' }} aria-hidden />
            {active.point.name}
          </p>
          <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[var(--ref-on-surface-variant)]">
            <dt>Entries</dt>
            <dd className="text-right tabular-nums text-[var(--ref-on-surface)]">{active.point.count.toLocaleString('id-ID')}</dd>
            <dt>Each, on average</dt>
            <dd className="text-right tabular-nums text-[var(--ref-on-surface)]">{format(active.point.average)}</dd>
            <dt>Total</dt>
            <dd className="text-right font-semibold tabular-nums text-[var(--ref-on-surface)]">{format(active.point.amount)}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}
