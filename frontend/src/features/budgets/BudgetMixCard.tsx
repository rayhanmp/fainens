import { useState } from 'react';
import { cn } from '../../lib/utils';

export type BudgetMixSlice = {
  id: number;
  name: string;
  plannedAmount: number;
  color: string;
};

type BudgetMixCardProps = {
  slices: BudgetMixSlice[];
  /** Period income, used for the "x% of income" line under the total; 0 hides it. */
  income: number;
  formatAmount: (amount: number) => string;
};

type Arc = { slice: BudgetMixSlice; start: number; end: number; share: number };

/** Beyond this many categories the smallest fold into one "Other" slice so the ring stays readable. */
const VISIBLE_LIMIT = 12;
const OTHER_COLOR = 'var(--ref-outline)';

const SIZE = 180;
const RADIUS = 72;
const STROKE = 22;
const GAP_DEGREES = 1.6;

const polar = (angle: number, radius = RADIUS) => {
  const rad = ((angle - 90) * Math.PI) / 180;
  return [SIZE / 2 + radius * Math.cos(rad), SIZE / 2 + radius * Math.sin(rad)] as const;
};

/** A stroked arc from `start` to `end` degrees, clockwise from twelve o'clock. */
const arcPath = (start: number, end: number) => {
  const [sx, sy] = polar(start);
  const [ex, ey] = polar(end);
  const large = end - start > 180 ? 1 : 0;
  return `M ${sx} ${sy} A ${RADIUS} ${RADIUS} 0 ${large} 1 ${ex} ${ey}`;
};

function layoutArcs(slices: BudgetMixSlice[], total: number): Arc[] {
  const arcs: Arc[] = [];
  let cursor = 0;
  for (const slice of slices) {
    const sweep = (slice.plannedAmount / total) * 360;
    // A hairline gap between neighbours; a slice too thin for a gap just becomes a dot.
    const gap = Math.min(GAP_DEGREES, sweep / 3);
    arcs.push({ slice, start: cursor + gap / 2, end: cursor + sweep - gap / 2, share: (slice.plannedAmount / total) * 100 });
    cursor += sweep;
  }
  return arcs;
}

const formatShare = (share: number) => (share < 1 ? '<1%' : `${Math.round(share)}%`);

/**
 * How the plan is split across categories. The ring shows proportion, which the category list
 * beside it cannot; the centre carries the total, or the hovered slice's amount. The legend only
 * names each slice with its share, since amounts already live in the list.
 */
export function BudgetMixCard({ slices, income, formatAmount }: BudgetMixCardProps) {
  const [activeId, setActiveId] = useState<number | null>(null);
  const total = slices.reduce((sum, slice) => sum + slice.plannedAmount, 0);
  const sorted = [...slices].filter((slice) => slice.plannedAmount > 0).sort((a, b) => b.plannedAmount - a.plannedAmount);
  const folded = sorted.length > VISIBLE_LIMIT ? sorted.slice(VISIBLE_LIMIT - 1) : [];
  const shown = folded.length > 0
    ? [...sorted.slice(0, VISIBLE_LIMIT - 1), { id: -1, name: `${folded.length} smaller`, plannedAmount: folded.reduce((sum, slice) => sum + slice.plannedAmount, 0), color: OTHER_COLOR }]
    : sorted;
  const arcs = layoutArcs(shown, total);
  const active = arcs.find((arc) => arc.slice.id === activeId);
  const centre = active
    ? { title: formatAmount(active.slice.plannedAmount), caption: `${formatShare(active.share)} · ${active.slice.name}` }
    : { title: formatAmount(total), caption: income > 0 ? `${Math.round((total / income) * 100)}% of income` : 'Planned in total' };

  if (total <= 0) {
    return <p className="py-8 text-center text-sm text-[var(--ref-on-surface-variant)]">No budget categories yet.</p>;
  }

  return (
    <div className="@container space-y-5">
      <div className="relative mx-auto" style={{ width: SIZE, height: SIZE }}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full" role="img" aria-label={`Planned budget split across ${sorted.length} categories`}>
          {arcs.map(({ slice, start, end }) => {
            const dimmed = activeId != null && activeId !== slice.id;
            return (
              <path
                key={slice.id}
                d={arcPath(start, Math.max(end, start + 0.5))}
                fill="none"
                stroke={slice.color}
                strokeWidth={activeId === slice.id ? STROKE + 4 : STROKE}
                className="cursor-pointer transition-[opacity,stroke-width] duration-150"
                style={{ opacity: dimmed ? 0.3 : 1 }}
                onMouseEnter={() => setActiveId(slice.id)}
                onMouseLeave={() => setActiveId(null)}
              />
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          {/* Lifted by half the caption's height so the pair reads as centred, not just the number. */}
          <p className="relative -translate-y-1 text-base font-bold tabular-nums leading-none text-[var(--ref-on-surface)]">
            {centre.title}
            <span className="absolute left-1/2 top-full mt-1.5 block max-w-28 -translate-x-1/2 truncate text-[11px] font-normal leading-none text-[var(--ref-on-surface-variant)]">{centre.caption}</span>
          </p>
        </div>
      </div>

      <ul className="grid grid-cols-1 gap-x-4 gap-y-0.5 @[20rem]:grid-cols-2" aria-label="Categories in the plan" onMouseLeave={() => setActiveId(null)}>
        {arcs.map(({ slice, share }) => (
          <li
            key={slice.id}
            tabIndex={0}
            onMouseEnter={() => setActiveId(slice.id)}
            onFocus={() => setActiveId(slice.id)}
            onBlur={() => setActiveId(null)}
            className={cn(
              'flex min-w-0 cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-xs outline-none transition-[opacity,background-color]',
              activeId === slice.id && 'bg-[var(--ref-surface-container-low)]',
              activeId != null && activeId !== slice.id && 'opacity-45',
            )}
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: slice.color }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[var(--ref-on-surface)]">{slice.name}</span>
            <span className="shrink-0 font-semibold tabular-nums text-[var(--ref-on-surface-variant)]">{formatShare(share)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
