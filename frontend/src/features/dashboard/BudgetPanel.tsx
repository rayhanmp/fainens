import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { CircleAlert, TriangleAlert } from 'lucide-react';
import type { BudgetOutlook, BudgetPlan } from '../../lib/api';
import { cn } from '../../lib/utils';
import { PanelLink } from './PanelParts';
import { panelCard, panelSubtitle, panelTitle, tooltipSurface } from './panel-styles';
import { planRowsFor, riskCounts, type PlanRow } from './budget-rows';
import { squarify } from './budget-treemap';

const TILE_GAP = 4;
const clampRatio = (value: number) => Math.max(0, Math.min(1, value));
const percentOf = (actual: number, planned: number) => `${Math.round((actual / Math.max(1, planned)) * 100)}%`;

function formatForecastRange(low: number | null, high: number | null, midpoint: number | null, formatAmount: (cents: number) => string): string | null {
  if (midpoint == null) return null;
  if (low == null || high == null || low === high) return formatAmount(midpoint);
  return `${formatAmount(low)}–${formatAmount(high)}`;
}

/** Width and height of an element, tracked through resizes. A callback ref, so it also works for an element that mounts later. */
function useElementSize() {
  const observerRef = useRef<ResizeObserver | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const ref = useCallback((element: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setSize((previous) => (previous.width === box.width && previous.height === box.height ? previous : { width: box.width, height: box.height }));
    });
    observer.observe(element);
    observerRef.current = observer;
  }, []);
  return [ref, size] as const;
}

type LabelLevel = 'full' | 'name' | 'none';
/** Height of the label block per level, so lines and the fill edge can tell when they would cross it. */
const LABEL_ZONE: Record<LabelLevel, number> = { full: 84, name: 34, none: 0 };

/** Labels wrap instead of hiding; only a sliver too short for a line of text shows nothing. */
function labelLevel(width: number, height: number): LabelLevel {
  if (width >= 56 && height >= 60) return 'full';
  if (width >= 40 && height >= 28) return 'name';
  return 'none';
}

/** Height of the frosted strip at the top of the glass that keeps the label readable when liquid rises behind it. */
function headerHeight(level: LabelLevel, width: number): number {
  return level === 'none' ? 0 : level === 'name' ? LABEL_ZONE.name : width < 120 ? 94 : 78;
}

/** Keep the forecast dashes clear of the liquid's surface, where the wave would swallow them. */
function forecastOffset(forecast: number, used: number, height: number): number {
  const gap = 7 / Math.max(1, height);
  return forecast - used < gap ? Math.min(1, used + gap) : forecast;
}

/** The liquid's surface, two wave periods wide so the drift animation loops seamlessly. */
function Wave() {
  return (
    <span className="dashboard-budget-tile-wave-wrap" aria-hidden>
      <svg className="dashboard-budget-tile-wave" viewBox="0 0 240 8" preserveAspectRatio="none">
        <path d="M0 5.5 Q15 3.5 30 5.5 T60 5.5 T90 5.5 T120 5.5 T150 5.5 T180 5.5 T210 5.5 T240 5.5 V8 H0 Z" fill="currentColor" />
      </svg>
    </span>
  );
}

/*
 * Ripple response. The level never moves; a cursor sweep across a tile only agitates its surface. Agitation is an
 * energy that builds with cursor speed and bleeds off over a couple of seconds, and the wave height follows it
 * smoothly in both directions, so nothing jumps.
 */
type Slosh = { energy: number; chop: number };
const ENERGY_GAIN = 1 / 2600; // energy per px/s of cursor speed
const ENERGY_DECAY = 1.4;     // per second
const MAX_CHOP = 1.7;         // wave height multiplier at full agitation
const CHOP_FOLLOW = 5;        // how quickly the wave height follows the energy, per second
const REDUCED_MOTION = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function createSlosh() {
  const states = new Map<HTMLElement, Slosh>();
  let frame: number | null = null;
  let lastTick = 0;
  let pointer: { x: number; y: number; t: number } | null = null;

  const tick = (now: number) => {
    const dt = Math.min(0.05, Math.max(0.001, (now - lastTick) / 1000));
    lastTick = now;
    let energy = 0;
    for (const [tile, s] of states) {
      if (!tile.isConnected) { states.delete(tile); continue; }
      s.energy *= Math.max(0, 1 - ENERGY_DECAY * dt);
      const target = 1 + (MAX_CHOP - 1) * Math.min(1, s.energy);
      s.chop += (target - s.chop) * Math.min(1, dt * CHOP_FOLLOW);
      tile.style.setProperty('--chop', s.chop.toFixed(3));
      energy += s.energy + Math.abs(s.chop - 1);
    }
    frame = energy > 0.01 ? requestAnimationFrame(tick) : null;
  };

  const wake = () => {
    if (frame != null) return;
    lastTick = performance.now();
    frame = requestAnimationFrame(tick);
  };

  return {
    /** Point every tile's shine at the cursor (map coordinates) and shove the liquid of the tiles it sweeps over. */
    move(map: HTMLElement, x: number, y: number, now: number) {
      map.dataset.lit = 'true';
      const previous = pointer;
      pointer = { x, y, t: now };
      const dt = previous ? (now - previous.t) / 1000 : 0;
      const vx = previous && dt > 0 && dt < 0.25 ? Math.max(-3000, Math.min(3000, (x - previous.x) / dt)) : 0;
      let disturbed = false;
      map.querySelectorAll<HTMLElement>('.dashboard-budget-tile').forEach((tile) => {
        tile.style.setProperty('--lx', `${x - tile.offsetLeft}px`);
        tile.style.setProperty('--ly', `${y - tile.offsetTop}px`);
        if (REDUCED_MOTION || vx === 0) return;
        // Only the tile under the cursor is nudged; neighbours just catch the glow.
        const inside = x >= tile.offsetLeft && x <= tile.offsetLeft + tile.offsetWidth && y >= tile.offsetTop && y <= tile.offsetTop + tile.offsetHeight;
        if (!inside) return;
        const s = states.get(tile) ?? { energy: 0, chop: 1 };
        states.set(tile, s);
        s.energy = Math.min(1.5, s.energy + Math.abs(vx) * ENERGY_GAIN * dt * 60);
        disturbed = true;
      });
      if (disturbed) wake();
    },
    leave(map: HTMLElement) {
      map.dataset.lit = 'false';
      pointer = null;
      map.querySelectorAll<HTMLElement>('.dashboard-budget-tile').forEach((tile) => {
        tile.style.setProperty('--lx', '-999px');
        tile.style.setProperty('--ly', '-999px');
      });
    },
    dispose() {
      if (frame != null) cancelAnimationFrame(frame);
      frame = null;
      states.clear();
    },
  };
}

function useSlosh() {
  const [slosh] = useState(createSlosh);
  useEffect(() => () => slosh.dispose(), [slosh]);
  return slosh;
}

function Tile({ row, tile, mapWidth, note, formatAmount }: {
  row: PlanRow;
  tile: { x: number; y: number; width: number; height: number };
  mapWidth: number;
  /** The user's own note on this category's budget, shown on hover. */
  note: string | null;
  formatAmount: (cents: number) => string;
}) {
  const hasPlan = row.planned > 0;
  const used = hasPlan ? clampRatio(row.actual / row.planned) : 1;
  const forecast = hasPlan && row.projected != null ? clampRatio(row.projected / row.planned) : null;
  const forecastText = formatForecastRange(row.projectedLow, row.projectedHigh, row.projected, formatAmount);
  const width = Math.max(0, tile.width - TILE_GAP);
  const height = Math.max(0, tile.height - TILE_GAP);
  const level = labelLevel(width, height);
  const Icon = row.tone === 'danger' ? CircleAlert : TriangleAlert;
  const status = row.tone === 'danger' ? 'over plan' : row.tone === 'warning' ? 'at risk' : null;
  const summary = `${row.name}${status ? ` (${status})` : ''}: ${hasPlan
    ? `${formatAmount(row.actual)} of ${formatAmount(row.planned)}${forecastText ? `, likely ${forecastText} by period end` : ''}`
    : `${formatAmount(row.actual)} recorded, no plan set`}`;
  const header = headerHeight(level, width);
  const headline = hasPlan ? percentOf(row.actual, row.planned) : formatAmount(row.actual);
  const amountText = hasPlan ? `${formatAmount(row.actual)} of ${formatAmount(row.planned)}` : null;
  const style: CSSProperties = { left: tile.x + TILE_GAP / 2, top: tile.y + TILE_GAP / 2, width, height, '--header': `${header}px` } as CSSProperties;
  const labelContent = (
    <span className="dashboard-budget-tile-text">
      <b><span className="dashboard-budget-tile-name" lang="en">{row.name}</span></b>
      {level === 'full' && <em>{headline}</em>}
      {level === 'full' && amountText && <small>{amountText}</small>}
    </span>
  );
  const tooltipFromRight = tile.x + 240 > mapWidth;
  return (
    <div className="dashboard-budget-tile group" role="listitem" data-tone={row.tone} data-level={level} data-narrow={width < 120} style={style} tabIndex={0} aria-label={summary}>
      {/* The liquid sits behind the glass and can fill the whole tile. */}
      <span className="dashboard-budget-tile-liquid" aria-hidden>
        <i className="dashboard-budget-tile-fill" data-empty={used <= 0} style={{ height: `${used * 100}%` }}><Wave /></i>
      </span>
      <span className="dashboard-budget-tile-body" aria-hidden>
        <i className="dashboard-budget-tile-shine" />
      </span>
      {/* The likely-finish mark is drawn on top of the glass so it stays crisp. */}
      {forecast != null && forecast > used && forecast < 1 && <i className="dashboard-budget-tile-forecast" aria-hidden style={{ bottom: `${forecastOffset(forecast, used, height) * 100}%` }} />}
      {/* The label is drawn twice and clipped at the waterline: ink above the liquid, white inside it. */}
      {level !== 'none' && <>
        <span className="dashboard-budget-tile-label" aria-hidden style={{ clipPath: `inset(0 0 ${used * 100}% 0)` }}>{labelContent}</span>
        <span className="dashboard-budget-tile-label" data-on-liquid aria-hidden style={{ clipPath: `inset(${(1 - used) * 100}% 0 0 0)` }}>{labelContent}</span>
      </>}
      {/* Hover adds only what the tile does not already show: the budget note, or else the likely finish. */}
      {(note || forecastText || row.scheduledRemaining > 0 || status) && <div className={cn(tooltipSurface, 'top-full mt-1 w-56', tooltipFromRight ? 'right-0' : 'left-0')} role="tooltip">
        <p className="flex items-center gap-1.5 font-bold">{row.name}{status && <span className="dashboard-budget-status" data-tone={row.tone}><Icon size={12} strokeWidth={2.25} aria-hidden />{status === 'over plan' ? 'Over plan' : 'At risk'}</span>}</p>
        {note && <p className="mt-1 whitespace-pre-line text-[var(--ref-on-surface)]">{note}</p>}
        {!note && (forecastText || row.scheduledRemaining > 0) && <p className="mt-1 text-[var(--ref-on-surface-variant)]">
          {forecastText && `Likely ${forecastText} by period end`}{forecastText && row.scheduledRemaining > 0 && ', '}{row.scheduledRemaining > 0 && `${formatAmount(row.scheduledRemaining)} still scheduled`}.
        </p>}
      </div>}
    </div>
  );
}

// `remaining` stays in the contract for the hero's "Budget left"; this panel no longer repeats it.
export function BudgetPanel({ periodId, coverageStatus, isLoading, isTracked, outlook, budgetRows, spending, totalPlanned, dailyBudget, formatAmount }: {
  periodId: number | null;
  coverageStatus: string | null | undefined;
  isLoading: boolean;
  isTracked: boolean;
  /** May briefly hold the previous period's outlook while the next one loads. */
  outlook: BudgetOutlook | null;
  budgetRows: readonly BudgetPlan[];
  spending: readonly { category: string; spentCents: number }[];
  totalPlanned: number;
  remaining: number;
  dailyBudget: number | null;
  formatAmount: (cents: number) => string;
}) {
  const currentOutlook = outlook?.periodId === periodId ? outlook : null;
  const elapsedRatio = currentOutlook && currentOutlook.totalDays > 0 ? clampRatio(currentOutlook.daysElapsed / currentOutlook.totalDays) : null;
  // Every budgeted category; the treemap sizes each tile by its plan.
  const planRows = useMemo(
    () => planRowsFor(currentOutlook?.categories ?? null, budgetRows, spending, elapsedRatio ?? 0, Infinity),
    [budgetRows, currentOutlook, elapsedRatio, spending],
  );
  const counts = currentOutlook ? riskCounts(currentOutlook.categories, elapsedRatio ?? 0) : null;
  const hasPlan = totalPlanned > 0 && isTracked;
  const likelyFinish = currentOutlook ? formatForecastRange(currentOutlook.total.projectedLowAmount, currentOutlook.total.projectedHighAmount, currentOutlook.total.projectedAmount, formatAmount) : null;
  const daysLeft = currentOutlook?.daysRemaining ?? null;
  const subtitle = !hasPlan || !counts
    ? 'Spending by category'
    : [
      counts.over > 0 && `${counts.over} over plan`,
      counts.atRisk > 0 && `${counts.atRisk} at risk`,
      counts.over === 0 && counts.atRisk === 0 && 'Every category on pace',
      likelyFinish && `Likely ${likelyFinish} by period end`,
    ].filter(Boolean).join(' · ');

  const [mapRef, mapSize] = useElementSize();
  const { move, leave } = useSlosh();
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    move(event.currentTarget, event.clientX - bounds.left, event.clientY - bounds.top, event.timeStamp);
  };
  const onPointerLeave = (event: PointerEvent<HTMLDivElement>) => leave(event.currentTarget);
  const tiles = useMemo(
    () => squarify(planRows.map((row) => ({ key: row.key, value: row.planned > 0 ? row.planned : row.actual })), mapSize.width, mapSize.height),
    [mapSize.height, mapSize.width, planRows],
  );
  const rowsByKey = useMemo(() => new Map(planRows.map((row) => [row.key, row])), [planRows]);
  // A note of just punctuation ("-") is a placeholder, not a note.
  const notesByKey = useMemo(() => new Map(budgetRows.flatMap((plan) => {
    const note = plan.note?.trim() ?? '';
    return /[\p{L}\p{N}]/u.test(note) ? [[`c${plan.categoryId}`, note] as const] : [];
  })), [budgetRows]);

  return (
    <div className={cn('dashboard-budget', panelCard)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className={panelTitle}>Budget health</h2>
          <p className={panelSubtitle}>{subtitle}</p>
        </div>
        <PanelLink to="/budget" className="shrink-0">{hasPlan ? 'Manage' : totalPlanned > 0 ? 'Review coverage' : 'Set a budget'}</PanelLink>
      </div>

      {isLoading
        ? <div className="dashboard-budget-map mt-4 animate-pulse rounded-2xl bg-white/40" />
        : !isTracked
          ? <div className="dashboard-budget-notice">Actuals are <strong>not tracked</strong> for this {coverageStatus === 'skipped' ? 'skipped' : 'incomplete'} period, so empty totals are not a zero-activity result.</div>
          : planRows.length === 0
            ? <div className="dashboard-budget-notice">No categorized spending yet. Add transactions or set a budget to start planning.</div>
            : <>
              <div ref={mapRef} className="dashboard-budget-map mt-4" role="list" aria-label="Budget by category, tile size is the plan" onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
                {tiles.map((tile) => {
                  const row = rowsByKey.get(tile.key);
                  return row ? <Tile key={tile.key} row={row} tile={tile} mapWidth={mapSize.width} note={notesByKey.get(tile.key) ?? null} formatAmount={formatAmount} /> : null;
                })}
              </div>
              <div className="dashboard-budget-legend">
                <span aria-hidden><i data-key="spent" />Spent of plan</span>
                {currentOutlook?.total.projectedAmount != null && <span aria-hidden><i data-key="forecast" />Likely finish</span>}
                <span aria-hidden><i data-key="tile" />Tile size is the plan</span>
                {dailyBudget != null && daysLeft != null && daysLeft > 0 && <span className="dashboard-budget-legend-note">Safe pace {formatAmount(dailyBudget)} a day · {daysLeft} day{daysLeft === 1 ? '' : 's'} left</span>}
              </div>
            </>}
    </div>
  );
}
