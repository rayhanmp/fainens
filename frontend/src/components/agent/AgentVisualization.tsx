import { BarChart3, CalendarDays, CircleDollarSign, Gauge, PieChart, TrendingUp, Wallet } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { formatCurrency } from '../../lib/utils';
import { SplitBillCard, parseSplitBillVisualization, type SplitBillAccount, type SplitBillVisualization } from './SplitBillCard';

type VisualizationUnit = 'IDR' | 'number' | 'percent' | 'months';
type VisualizationTone = 'positive' | 'negative' | 'neutral';

type MetricVisualization = {
  type: 'metric';
  title: string;
  value: number;
  unit: VisualizationUnit;
  subtitle?: string;
  tone: VisualizationTone;
};

type RankedBarVisualization = {
  type: 'ranked_bar';
  title: string;
  unit: VisualizationUnit;
  items: Array<{ label: string; value: number }>;
};

type ComparisonVisualization = {
  type: 'comparison';
  title: string;
  unit: VisualizationUnit;
  currentLabel: string;
  previousLabel: string;
  items: Array<{ label: string; current: number; previous: number }>;
};

type SparklineVisualization = {
  type: 'sparkline';
  title: string;
  unit: VisualizationUnit;
  points: Array<{ label: string; value: number }>;
};

type DonutVisualization = {
  type: 'donut';
  title: string;
  unit: VisualizationUnit;
  items: Array<{ label: string; value: number }>;
};

type BudgetProgressVisualization = {
  type: 'budget_progress';
  title: string;
  unit: VisualizationUnit;
  planned: number;
  actual: number;
  remaining?: number;
  status: VisualizationTone;
};

type CashFlowVisualization = {
  type: 'cash_flow';
  title: string;
  unit: VisualizationUnit;
  income: number;
  spending: number;
  net: number;
  periodLabel?: string;
};

type ActivityHeatmapVisualization = {
  type: 'activity_heatmap';
  title: string;
  unit: VisualizationUnit;
  cells: Array<{ label: string; value: number }>;
};

type ProjectionVisualization = {
  type: 'projection';
  title: string;
  unit: VisualizationUnit;
  startingValue: number;
  monthlyContribution: number;
  monthlyGrowthRate: number;
  horizonMonths: number;
  target?: number;
  subtitle?: string;
};

type RunwayScenarioVisualization = {
  type: 'runway_scenario';
  title: string;
  unit: VisualizationUnit;
  cash: number;
  monthlyBurn: number;
  monthlyIncome: number;
  subtitle?: string;
};

type CalculationVisualization = {
  type: 'calculation';
  title: string;
  operation: CalculationOperation;
  left: { label: string; value: number; unit: VisualizationUnit };
  right: { label: string; value: number; unit: VisualizationUnit };
  resultLabel: string;
  resultUnit: VisualizationUnit;
};

type CalculationOperation = 'add' | 'subtract' | 'multiply' | 'divide' | 'percent_change';

type ScenarioCompareVisualization = {
  type: 'scenario_compare';
  title: string;
  scenarios: Array<{ label: string; description?: string; metrics: Array<{ label: string; value: number; unit: VisualizationUnit }> }>;
};

type AllocationEditorVisualization = {
  type: 'allocation_editor';
  title: string;
  unit: VisualizationUnit;
  total: number;
  rows: Array<{ label: string; value: number; locked: boolean }>;
};

type TimeSeriesExplorerVisualization = {
  type: 'time_series_explorer';
  title: string;
  unit: VisualizationUnit;
  series: Array<{ label: string; points: Array<{ label: string; value: number }> }>;
};

type GoalTrackerVisualization = {
  type: 'goal_tracker';
  title: string;
  unit: VisualizationUnit;
  current: number;
  target: number;
  monthlyContribution: number;
  deadlineMonths?: number;
};

type WorksheetInputColumn = { key: string; label: string; unit: VisualizationUnit };
type WorksheetFormulaColumn = { key: string; label: string; unit: VisualizationUnit; operation: CalculationOperation; left: string; right: string };
type WorksheetVisualization = {
  type: 'worksheet';
  title: string;
  rows: Array<{ label: string; values: Record<string, number> }>;
  inputColumns: WorksheetInputColumn[];
  formulaColumns: WorksheetFormulaColumn[];
};

type AgentVisualization =
  | MetricVisualization
  | RankedBarVisualization
  | ComparisonVisualization
  | SparklineVisualization
  | DonutVisualization
  | BudgetProgressVisualization
  | CashFlowVisualization
  | ActivityHeatmapVisualization
  | ProjectionVisualization
  | RunwayScenarioVisualization
  | CalculationVisualization
  | ScenarioCompareVisualization
  | AllocationEditorVisualization
  | TimeSeriesExplorerVisualization
  | GoalTrackerVisualization
  | WorksheetVisualization
  | SplitBillVisualization;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim().slice(0, 120) : fallback;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readUnit(value: unknown): VisualizationUnit {
  return value === 'IDR' || value === 'percent' || value === 'months' || value === 'number' ? value : 'number';
}

function readTone(value: unknown): VisualizationTone {
  return value === 'positive' || value === 'negative' ? value : 'neutral';
}

function isCalculationOperation(value: unknown): value is CalculationOperation {
  return value === 'add' || value === 'subtract' || value === 'multiply' || value === 'divide' || value === 'percent_change';
}

function calculateOperation(operation: CalculationOperation, left: number, right: number): number {
  if (operation === 'add') return left + right;
  if (operation === 'subtract') return left - right;
  if (operation === 'multiply') return left * right;
  if (operation === 'divide') return right === 0 ? 0 : left / right;
  return left === 0 ? 0 : (right - left) / Math.abs(left) * 100;
}

function readKey(value: unknown): string {
  const key = readString(value);
  return /^[a-z][a-z0-9_]{0,30}$/i.test(key) ? key : '';
}

function parseVisualization(value: string): AgentVisualization | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.trim());
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const splitBill = parseSplitBillVisualization(parsed);
  if (splitBill) return splitBill;
  const type = parsed.type;
  const title = readString(parsed.title);
  if (!title || typeof type !== 'string') return null;

  if (type === 'metric') {
    const metric = readNumber(parsed.value);
    if (metric == null) return null;
    const subtitle = readString(parsed.subtitle);
    return {
      type,
      title,
      value: metric,
      unit: readUnit(parsed.unit),
      tone: readTone(parsed.tone),
      ...(subtitle ? { subtitle } : {}),
    };
  }

  if (type === 'ranked_bar') {
    const items = Array.isArray(parsed.items)
      ? parsed.items.filter(isRecord).slice(0, 10).flatMap((item) => {
        const label = readString(item.label);
        const itemValue = readNumber(item.value);
        return label && itemValue != null ? [{ label, value: itemValue }] : [];
      })
      : [];
    return items.length > 0 ? { type, title, unit: readUnit(parsed.unit), items } : null;
  }

  if (type === 'comparison') {
    const items = Array.isArray(parsed.items)
      ? parsed.items.filter(isRecord).slice(0, 8).flatMap((item) => {
        const label = readString(item.label);
        const current = readNumber(item.current);
        const previous = readNumber(item.previous);
        return label && current != null && previous != null ? [{ label, current, previous }] : [];
      })
      : [];
    if (items.length === 0) return null;
    return {
      type,
      title,
      unit: readUnit(parsed.unit),
      currentLabel: readString(parsed.currentLabel, 'Current'),
      previousLabel: readString(parsed.previousLabel, 'Previous'),
      items,
    };
  }

  if (type === 'sparkline') {
    const points = Array.isArray(parsed.points)
      ? parsed.points.filter(isRecord).slice(0, 24).flatMap((point) => {
        const label = readString(point.label);
        const pointValue = readNumber(point.value);
        return label && pointValue != null ? [{ label, value: pointValue }] : [];
      })
      : [];
    return points.length >= 2 ? { type, title, unit: readUnit(parsed.unit), points } : null;
  }

  if (type === 'donut') {
    const items = Array.isArray(parsed.items)
      ? parsed.items.filter(isRecord).slice(0, 8).flatMap((item) => {
        const label = readString(item.label);
        const itemValue = readNumber(item.value);
        return label && itemValue != null && itemValue >= 0 ? [{ label, value: itemValue }] : [];
      })
      : [];
    return items.length > 0 && items.some((item) => item.value > 0) ? { type, title, unit: readUnit(parsed.unit), items } : null;
  }

  if (type === 'budget_progress') {
    const planned = readNumber(parsed.planned);
    const actual = readNumber(parsed.actual);
    const remaining = readNumber(parsed.remaining);
    if (planned == null || actual == null || planned < 0 || actual < 0) return null;
    return {
      type,
      title,
      unit: readUnit(parsed.unit),
      planned,
      actual,
      status: readTone(parsed.status),
      ...(remaining != null ? { remaining } : {}),
    };
  }

  if (type === 'cash_flow') {
    const income = readNumber(parsed.income);
    const spending = readNumber(parsed.spending);
    const net = readNumber(parsed.net);
    if (income == null || spending == null || net == null) return null;
    const periodLabel = readString(parsed.periodLabel);
    return {
      type,
      title,
      unit: readUnit(parsed.unit),
      income,
      spending,
      net,
      ...(periodLabel ? { periodLabel } : {}),
    };
  }

  if (type === 'activity_heatmap') {
    const cells = Array.isArray(parsed.cells)
      ? parsed.cells.filter(isRecord).slice(0, 62).flatMap((cell) => {
        const label = readString(cell.label);
        const cellValue = readNumber(cell.value);
        return label && cellValue != null && cellValue >= 0 ? [{ label, value: cellValue }] : [];
      })
      : [];
    return cells.length > 0 ? { type, title, unit: readUnit(parsed.unit), cells } : null;
  }

  if (type === 'projection') {
    const startingValue = readNumber(parsed.startingValue);
    const monthlyContribution = readNumber(parsed.monthlyContribution);
    const monthlyGrowthRate = readNumber(parsed.monthlyGrowthRate);
    const horizonMonths = readNumber(parsed.horizonMonths);
    const target = readNumber(parsed.target);
    if (startingValue == null || monthlyContribution == null || monthlyGrowthRate == null || horizonMonths == null) return null;
    if (horizonMonths < 3 || horizonMonths > 120 || monthlyGrowthRate < -100 || monthlyGrowthRate > 100) return null;
    const subtitle = readString(parsed.subtitle);
    return {
      type,
      title,
      unit: readUnit(parsed.unit),
      startingValue,
      monthlyContribution,
      monthlyGrowthRate,
      horizonMonths: Math.round(horizonMonths),
      ...(target != null ? { target } : {}),
      ...(subtitle ? { subtitle } : {}),
    };
  }

  if (type === 'runway_scenario') {
    const cash = readNumber(parsed.cash);
    const monthlyBurn = readNumber(parsed.monthlyBurn);
    const monthlyIncome = readNumber(parsed.monthlyIncome);
    if (cash == null || monthlyBurn == null || monthlyIncome == null || cash < 0 || monthlyBurn < 0 || monthlyIncome < 0) return null;
    const subtitle = readString(parsed.subtitle);
    return {
      type,
      title,
      unit: readUnit(parsed.unit),
      cash,
      monthlyBurn,
      monthlyIncome,
      ...(subtitle ? { subtitle } : {}),
    };
  }

  if (type === 'calculation' || type === 'live_calculation') {
    const leftValue = readNumber(isRecord(parsed.left) ? parsed.left.value : null);
    const rightValue = readNumber(isRecord(parsed.right) ? parsed.right.value : null);
    const leftLabel = readString(isRecord(parsed.left) ? parsed.left.label : null);
    const rightLabel = readString(isRecord(parsed.right) ? parsed.right.label : null);
    const resultLabel = readString(parsed.resultLabel, 'Result');
    const operation = parsed.operation;
    if (leftValue == null || rightValue == null || !leftLabel || !rightLabel || !isCalculationOperation(operation)) return null;
    return {
      type: 'calculation',
      title,
      operation,
      left: { label: leftLabel, value: leftValue, unit: readUnit(isRecord(parsed.left) ? parsed.left.unit : null) },
      right: { label: rightLabel, value: rightValue, unit: readUnit(isRecord(parsed.right) ? parsed.right.unit : null) },
      resultLabel,
      resultUnit: readUnit(parsed.resultUnit),
    };
  }

  if (type === 'scenario_compare') {
    const scenarios = Array.isArray(parsed.scenarios)
      ? parsed.scenarios.filter(isRecord).slice(0, 4).flatMap((scenario) => {
        const label = readString(scenario.label);
        const description = readString(scenario.description);
        const metrics = Array.isArray(scenario.metrics)
          ? scenario.metrics.filter(isRecord).slice(0, 5).flatMap((metric) => {
            const metricLabel = readString(metric.label);
            const metricValue = readNumber(metric.value);
            return metricLabel && metricValue != null ? [{ label: metricLabel, value: metricValue, unit: readUnit(metric.unit) }] : [];
          })
          : [];
        return label && metrics.length > 0 ? [{ label, metrics, ...(description ? { description } : {}) }] : [];
      })
      : [];
    return scenarios.length >= 2 ? { type, title, scenarios } : null;
  }

  if (type === 'allocation_editor') {
    const total = readNumber(parsed.total);
    const rows = Array.isArray(parsed.rows)
      ? parsed.rows.filter(isRecord).slice(0, 10).flatMap((row) => {
        const label = readString(row.label);
        const rowValue = readNumber(row.value);
        return label && rowValue != null && rowValue >= 0 ? [{ label, value: rowValue, locked: row.locked === true }] : [];
      })
      : [];
    return total != null && total >= 0 && rows.length > 0 ? { type, title, unit: readUnit(parsed.unit), total, rows } : null;
  }

  if (type === 'time_series_explorer') {
    const series = Array.isArray(parsed.series)
      ? parsed.series.filter(isRecord).slice(0, 4).flatMap((entry) => {
        const label = readString(entry.label);
        const points = Array.isArray(entry.points)
          ? entry.points.filter(isRecord).slice(0, 90).flatMap((point) => {
            const pointLabel = readString(point.label);
            const pointValue = readNumber(point.value);
            return pointLabel && pointValue != null ? [{ label: pointLabel, value: pointValue }] : [];
          })
          : [];
        return label && points.length >= 2 ? [{ label, points }] : [];
      })
      : [];
    return series.length > 0 ? { type, title, unit: readUnit(parsed.unit), series } : null;
  }

  if (type === 'goal_tracker') {
    const current = readNumber(parsed.current);
    const target = readNumber(parsed.target);
    const monthlyContribution = readNumber(parsed.monthlyContribution);
    const deadlineMonths = readNumber(parsed.deadlineMonths);
    if (current == null || target == null || monthlyContribution == null || current < 0 || target <= 0 || monthlyContribution < 0) return null;
    if (deadlineMonths != null && (deadlineMonths < 1 || deadlineMonths > 600)) return null;
    return { type, title, unit: readUnit(parsed.unit), current, target, monthlyContribution, ...(deadlineMonths != null ? { deadlineMonths: Math.round(deadlineMonths) } : {}) };
  }

  if (type === 'worksheet') {
    const inputColumns = Array.isArray(parsed.inputColumns)
      ? parsed.inputColumns.filter(isRecord).slice(0, 3).flatMap((column) => {
        const key = readKey(column.key);
        const label = readString(column.label);
        return key && label ? [{ key, label, unit: readUnit(column.unit) }] : [];
      })
      : [];
    const inputKeys = new Set(inputColumns.map((column) => column.key));
    if (inputColumns.length === 0 || inputKeys.size !== inputColumns.length) return null;
    const formulaColumns = Array.isArray(parsed.formulaColumns)
      ? parsed.formulaColumns.filter(isRecord).slice(0, 3).flatMap((column) => {
        const key = readKey(column.key);
        const label = readString(column.label);
        const left = readKey(column.left);
        const right = readKey(column.right);
        return key && label && isCalculationOperation(column.operation) && inputKeys.has(left) && inputKeys.has(right) && !inputKeys.has(key)
          ? [{ key, label, unit: readUnit(column.unit), operation: column.operation, left, right }]
          : [];
      })
      : [];
    const allKeys = new Set([...inputColumns, ...formulaColumns].map((column) => column.key));
    if (allKeys.size !== inputColumns.length + formulaColumns.length) return null;
    const rows = Array.isArray(parsed.rows)
      ? parsed.rows.filter(isRecord).slice(0, 12).flatMap((row) => {
        const label = readString(row.label);
        const rawValues = isRecord(row.values) ? row.values : null;
        if (!label || !rawValues) return [];
        const values: Record<string, number> = {};
        for (const column of inputColumns) {
          const cell = readNumber(rawValues[column.key]);
          if (cell == null) return [];
          values[column.key] = cell;
        }
        return [{ label, values }];
      })
      : [];
    return rows.length > 0 ? { type, title, inputColumns, formulaColumns, rows } : null;
  }

  return null;
}

function formatValue(value: number, unit: VisualizationUnit): string {
  if (unit === 'IDR') return formatCurrency(value);
  if (unit === 'percent') return `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
  if (unit === 'months') return `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })} mo`;
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function toneClass(tone: VisualizationTone): string {
  if (tone === 'positive') return 'text-[var(--color-success)]';
  if (tone === 'negative') return 'text-[var(--color-danger)]';
  return 'text-[var(--color-text-primary)]';
}

function VizHeader({ title, icon }: { title: string; icon: ReactNode }) {
  return <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text-secondary)]"><span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--ref-surface-container-low)] text-[var(--ref-primary)]">{icon}</span><span>{title}</span></div>;
}

function MetricCard({ visualization }: { visualization: MetricVisualization }) {
  return <article className="agent-viz-card" aria-label={visualization.title}>
    <VizHeader title={visualization.title} icon={<Gauge className="h-4 w-4" />} />
    <p className={`mt-3 text-2xl font-bold tracking-tight ${toneClass(visualization.tone)}`}>{formatValue(visualization.value, visualization.unit)}</p>
    {visualization.subtitle && <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{visualization.subtitle}</p>}
  </article>;
}

function RankedBarCard({ visualization }: { visualization: RankedBarVisualization }) {
  const max = Math.max(...visualization.items.map((item) => Math.abs(item.value)), 1);
  return <article className="agent-viz-card" aria-label={visualization.title}>
    <VizHeader title={visualization.title} icon={<BarChart3 className="h-4 w-4" />} />
    <div className="mt-4 space-y-3" role="list">
      {visualization.items.map((item, index) => <div key={`${item.label}-${index}`} role="listitem">
        <div className="mb-1 flex items-center justify-between gap-3 text-xs"><span className="min-w-0 truncate text-[var(--color-text-secondary)]">{item.label}</span><span className="shrink-0 font-semibold text-[var(--color-text-primary)]">{formatValue(item.value, visualization.unit)}</span></div>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--ref-surface-container-highest)]"><div className="h-full rounded-full bg-[var(--ref-primary)]" style={{ width: `${Math.max(3, Math.min(100, Math.abs(item.value) / max * 100))}%` }} /></div>
      </div>)}
    </div>
  </article>;
}

function ComparisonCard({ visualization }: { visualization: ComparisonVisualization }) {
  const max = Math.max(...visualization.items.flatMap((item) => [Math.abs(item.current), Math.abs(item.previous)]), 1);
  return <article className="agent-viz-card" aria-label={visualization.title}>
    <VizHeader title={visualization.title} icon={<TrendingUp className="h-4 w-4" />} />
    <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-[var(--color-text-secondary)]"><span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[var(--ref-primary)]" />{visualization.currentLabel}</span><span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[var(--ref-secondary)]" />{visualization.previousLabel}</span></div>
    <div className="mt-4 space-y-3" role="list">
      {visualization.items.map((item, index) => <div key={`${item.label}-${index}`} role="listitem">
        <div className="mb-1 flex items-center justify-between gap-3 text-xs"><span className="min-w-0 truncate text-[var(--color-text-secondary)]">{item.label}</span><span className="shrink-0 font-semibold text-[var(--color-text-primary)]">{formatValue(item.current, visualization.unit)}</span></div>
        <div className="grid gap-1"><div className="h-1.5 overflow-hidden rounded-full bg-[var(--ref-surface-container-highest)]"><div className="h-full rounded-full bg-[var(--ref-primary)]" style={{ width: `${Math.max(3, Math.min(100, Math.abs(item.current) / max * 100))}%` }} /></div><div className="h-1.5 overflow-hidden rounded-full bg-[var(--ref-surface-container-highest)]"><div className="h-full rounded-full bg-[var(--ref-secondary)]" style={{ width: `${Math.max(3, Math.min(100, Math.abs(item.previous) / max * 100))}%` }} /></div></div>
      </div>)}
    </div>
  </article>;
}

const VIZ_COLORS = ['var(--ref-primary)', 'var(--ref-secondary)', 'var(--ref-tertiary)', 'var(--color-warning)', 'var(--color-danger)', 'var(--ref-primary-container)', 'var(--ref-on-secondary-container)', 'var(--color-muted)'];
const COMPOSITION_COLORS = ['var(--ref-primary)', 'var(--color-warning)', 'var(--ref-secondary)', 'var(--color-danger)', 'var(--ref-tertiary)', 'var(--ref-primary-container)', 'var(--ref-on-secondary-container)', 'var(--color-muted)'];

function donutSegmentPath(startFraction: number, endFraction: number): string {
  const center = 60;
  const outerRadius = 48;
  const innerRadius = 32;
  const startAngle = startFraction * Math.PI * 2 - Math.PI / 2;
  const endAngle = endFraction * Math.PI * 2 - Math.PI / 2;
  const point = (radius: number, angle: number) => [center + radius * Math.cos(angle), center + radius * Math.sin(angle)];
  const [outerStartX, outerStartY] = point(outerRadius, startAngle);
  const [outerEndX, outerEndY] = point(outerRadius, endAngle);
  const [innerStartX, innerStartY] = point(innerRadius, startAngle);
  const [innerEndX, innerEndY] = point(innerRadius, endAngle);
  const largeArc = endFraction - startFraction > 0.5 ? 1 : 0;
  return `M ${outerStartX} ${outerStartY} A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEndX} ${outerEndY} L ${innerEndX} ${innerEndY} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStartX} ${innerStartY} Z`;
}

function DonutCard({ visualization }: { visualization: DonutVisualization }) {
  const items = [...visualization.items].sort((left, right) => right.value - left.value);
  const total = items.reduce((sum, item) => sum + item.value, 0) || 1;
  const [hoveredSegmentIndex, setHoveredSegmentIndex] = useState<number | null>(null);
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState<number | null>(null);
  let cursor = 0;
  const segments = items.map((item, index) => {
    const start = cursor;
    cursor += item.value / total;
    return { item, index, start, end: cursor, percentage: item.value / total * 100, color: COMPOSITION_COLORS[index % COMPOSITION_COLORS.length] };
  });
  const highlightedSegmentIndex = hoveredSegmentIndex ?? selectedSegmentIndex;
  const highlightedSegment = highlightedSegmentIndex == null ? null : segments[highlightedSegmentIndex] ?? null;
  return <article className="agent-viz-card" aria-label={visualization.title}>
    <div className="flex items-center justify-between gap-3"><VizHeader title={visualization.title} icon={<PieChart className="h-4 w-4" />} /><span className="shrink-0 text-[11px] text-[var(--color-text-secondary)]">{items.length} categories</span></div>
    <div className="mt-4 grid gap-5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center">
      <div className="flex items-center gap-4 sm:flex-col sm:items-start sm:gap-2">
        <div className="agent-viz-donut shrink-0">
          <svg viewBox="0 0 120 120" role="group" aria-label={`${visualization.title} composition`}>
            <title>{visualization.title} composition</title>
            {segments.map((segment) => <path
              key={`${segment.item.label}-${segment.index}`}
              d={donutSegmentPath(segment.start, segment.end)}
              fill={segment.color}
              opacity={highlightedSegmentIndex == null || highlightedSegmentIndex === segment.index ? 1 : 0.35}
              role="button"
              tabIndex={0}
              aria-label={`${segment.item.label}: ${formatValue(segment.item.value, visualization.unit)}, ${segment.percentage.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`}
              aria-pressed={selectedSegmentIndex === segment.index}
              onMouseEnter={() => setHoveredSegmentIndex(segment.index)}
              onMouseLeave={() => setHoveredSegmentIndex(null)}
              onFocus={() => setHoveredSegmentIndex(segment.index)}
              onBlur={() => setHoveredSegmentIndex(null)}
              onClick={() => setSelectedSegmentIndex((current) => current === segment.index ? null : segment.index)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setSelectedSegmentIndex((current) => current === segment.index ? null : segment.index);
                }
              }}
            />)}
          </svg>
          <span>{highlightedSegment ? <><strong>{highlightedSegment.percentage.toLocaleString('en-US', { maximumFractionDigits: 1 })}%</strong><small>{highlightedSegment.item.label}</small></> : 'Total'}</span>
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">{highlightedSegment ? 'Selected category' : 'Total spent'}</p>
          <p className="mt-0.5 whitespace-nowrap text-lg font-bold tabular-nums tracking-tight text-[var(--color-text-primary)]">{formatValue(highlightedSegment?.item.value ?? total, visualization.unit)}</p>
          <p className="mt-0.5 max-w-36 truncate text-[11px] text-[var(--color-text-secondary)]">{highlightedSegment ? `${highlightedSegment.item.label} · ${highlightedSegment.percentage.toLocaleString('en-US', { maximumFractionDigits: 1 })}%` : `Across ${items.length} categories`}</p>
        </div>
      </div>
      <div className="min-w-0 space-y-2.5" role="list" aria-label={`${visualization.title} breakdown`}>
        {items.map((item, index) => {
          const percentage = item.value / total * 100;
          const color = COMPOSITION_COLORS[index % COMPOSITION_COLORS.length];
          const isHighlighted = highlightedSegmentIndex == null || highlightedSegmentIndex === index;
          return <div key={`${item.label}-${index}`} role="listitem" aria-label={`${item.label}: ${formatValue(item.value, visualization.unit)}, ${percentage.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`} className={`transition-opacity ${isHighlighted ? 'opacity-100' : 'opacity-45'}`}>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="flex min-w-0 items-center gap-2 font-medium text-[var(--color-text-primary)]"><i className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} /> <span className="truncate">{item.label}</span></span>
              <span className="shrink-0 text-right tabular-nums"><strong className="font-semibold text-[var(--color-text-primary)]">{formatValue(item.value, visualization.unit)}</strong><span className="ml-1.5 text-[var(--color-text-secondary)]">{percentage.toLocaleString('en-US', { maximumFractionDigits: 1 })}%</span></span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--ref-surface-container-highest)]" role="presentation"><div className="h-full rounded-full" style={{ width: `${Math.max(2, percentage)}%`, backgroundColor: color }} /></div>
          </div>;
        })}
      </div>
    </div>
  </article>;
}

function BudgetProgressCard({ visualization }: { visualization: BudgetProgressVisualization }) {
  const percent = visualization.planned > 0 ? visualization.actual / visualization.planned * 100 : 0;
  const remaining = visualization.remaining ?? visualization.planned - visualization.actual;
  const tone = visualization.status === 'negative' || visualization.actual > visualization.planned ? 'negative' : visualization.status === 'positive' ? 'positive' : 'neutral';
  return <article className="agent-viz-card" aria-label={visualization.title}>
    <VizHeader title={visualization.title} icon={<Wallet className="h-4 w-4" />} />
    <div className="mt-3 flex items-baseline justify-between gap-3"><p className="text-xl font-bold tracking-tight text-[var(--color-text-primary)]">{formatValue(visualization.actual, visualization.unit)}</p><p className="text-xs text-[var(--color-text-secondary)]">of {formatValue(visualization.planned, visualization.unit)}</p></div>
    <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-[var(--ref-surface-container-highest)]"><div className={`h-full rounded-full ${tone === 'negative' ? 'bg-[var(--color-danger)]' : tone === 'positive' ? 'bg-[var(--color-success)]' : 'bg-[var(--ref-primary)]'}`} style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} /></div>
    <div className="mt-2 flex items-center justify-between gap-3 text-xs text-[var(--color-text-secondary)]"><span>{Math.round(percent)}% used</span><span className={toneClass(tone)}>{remaining >= 0 ? `${formatValue(remaining, visualization.unit)} left` : `${formatValue(Math.abs(remaining), visualization.unit)} over`}</span></div>
  </article>;
}

function CashFlowCard({ visualization }: { visualization: CashFlowVisualization }) {
  return <article className="agent-viz-card" aria-label={visualization.title}>
    <VizHeader title={visualization.title} icon={<CircleDollarSign className="h-4 w-4" />} />
    {visualization.periodLabel && <p className="mt-2 text-xs text-[var(--color-text-secondary)]">{visualization.periodLabel}</p>}
    <div className="mt-4 grid grid-cols-3 divide-x divide-[var(--color-border)]">
      <div className="pr-3"><p className="text-[11px] text-[var(--color-text-secondary)]">Income</p><p className="mt-1 text-sm font-semibold text-[var(--color-success)]">{formatValue(visualization.income, visualization.unit)}</p></div>
      <div className="px-3"><p className="text-[11px] text-[var(--color-text-secondary)]">Spending</p><p className="mt-1 text-sm font-semibold text-[var(--color-danger)]">{formatValue(visualization.spending, visualization.unit)}</p></div>
      <div className="pl-3"><p className="text-[11px] text-[var(--color-text-secondary)]">Net</p><p className={`mt-1 text-sm font-semibold ${toneClass(visualization.net >= 0 ? 'positive' : 'negative')}`}>{formatValue(visualization.net, visualization.unit)}</p></div>
    </div>
  </article>;
}

function ActivityHeatmapCard({ visualization }: { visualization: ActivityHeatmapVisualization }) {
  const max = Math.max(...visualization.cells.map((cell) => cell.value), 1);
  return <article className="agent-viz-card" aria-label={visualization.title}>
    <VizHeader title={visualization.title} icon={<CalendarDays className="h-4 w-4" />} />
    <div className="mt-4 grid grid-cols-7 gap-1.5" role="list" aria-label={`${visualization.title} by day`}>
      {visualization.cells.map((cell, index) => <div key={`${cell.label}-${index}`} className="agent-viz-heat-cell" role="listitem" title={`${cell.label}: ${formatValue(cell.value, visualization.unit)}`} aria-label={`${cell.label}: ${formatValue(cell.value, visualization.unit)}`} style={{ backgroundColor: cell.value === 0 ? 'var(--ref-surface-container-low)' : VIZ_COLORS[Math.min(VIZ_COLORS.length - 1, Math.ceil(cell.value / max * (VIZ_COLORS.length - 1)))] }} />)}
    </div>
    <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--color-text-secondary)]"><span>{visualization.cells[0]?.label}</span><span>{visualization.cells[visualization.cells.length - 1]?.label}</span></div>
  </article>;
}

function ScenarioSlider({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (value: number) => string; onChange: (value: number) => void }) {
  return <label className="block text-xs text-[var(--color-text-secondary)]"><span className="mb-1 flex items-center justify-between gap-3"><span>{label}</span><strong className="font-semibold text-[var(--color-text-primary)]">{format(value)}</strong></span><input type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} className="agent-viz-range" /></label>;
}

function ScenarioNumberInput({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min?: number; max?: number; step: number; unit: VisualizationUnit; onChange: (value: number) => void }) {
  return <label className="block min-w-0 text-xs text-[var(--color-text-secondary)]"><span className="mb-1 block truncate">{label}</span><span className="relative block"><input type="number" value={Number.isFinite(value) ? value : ''} min={min} max={max} step={step} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(next); }} className="agent-viz-number" aria-label={label} /><span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] text-[var(--color-muted)]">{unit === 'IDR' ? 'Rp' : unit === 'percent' ? '%' : unit === 'months' ? 'mo' : ''}</span></span></label>;
}

function ProjectionCard({ visualization }: { visualization: ProjectionVisualization }) {
  const [contribution, setContribution] = useState(visualization.monthlyContribution);
  const [growthRate, setGrowthRate] = useState(visualization.monthlyGrowthRate);
  const [horizon, setHorizon] = useState(visualization.horizonMonths);
  const series = useMemo(() => {
    const values = [{ month: 0, value: visualization.startingValue }];
    let value = visualization.startingValue;
    for (let month = 1; month <= horizon; month += 1) {
      value = value * (1 + growthRate / 100) + contribution;
      values.push({ month, value });
    }
    return values;
  }, [contribution, growthRate, horizon, visualization.startingValue]);
  const values = series.map((point) => point.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, visualization.target ?? 0, 1);
  const range = max - min || 1;
  const points = series.map((point) => `${10 + point.month / horizon * 300},${82 - ((point.value - min) / range) * 68}`).join(' ');
  const projected = series[series.length - 1]?.value ?? visualization.startingValue;
  return <article className="agent-viz-card" aria-label={visualization.title}>
    <VizHeader title={visualization.title} icon={<TrendingUp className="h-4 w-4" />} />
    {visualization.subtitle && <p className="mt-2 text-xs text-[var(--color-text-secondary)]">{visualization.subtitle}</p>}
    <div className="mt-3 grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,auto)]"><div><p className="text-xs text-[var(--color-text-secondary)]">Projected value</p><p className="mt-1 text-xl font-bold tracking-tight text-[var(--color-text-primary)]">{formatValue(projected, visualization.unit)}</p></div><p className="text-right text-xs text-[var(--color-text-secondary)]">after {horizon} months</p></div>
    <svg className="mt-3 h-24 w-full overflow-visible" viewBox="0 0 320 96" role="img" aria-label={`${visualization.title} scenario projection`} preserveAspectRatio="none">
      <line x1="10" y1="82" x2="310" y2="82" stroke="var(--ref-outline-variant)" strokeWidth="1" />
      {visualization.target != null && <line x1="10" x2="310" y1={82 - ((visualization.target - min) / range) * 68} y2={82 - ((visualization.target - min) / range) * 68} stroke="var(--color-warning)" strokeDasharray="4 4" strokeWidth="1.5" />}
      <polyline points={points} fill="none" stroke="var(--ref-primary)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <ScenarioSlider label="Monthly addition" value={contribution} min={Math.min(0, visualization.monthlyContribution * 0.25)} max={Math.max(1000, visualization.monthlyContribution * 3 + 1000)} step={1000} format={(value) => formatValue(value, visualization.unit)} onChange={setContribution} />
      <ScenarioSlider label="Growth / month" value={growthRate} min={-5} max={10} step={0.1} format={(value) => `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`} onChange={setGrowthRate} />
      <ScenarioSlider label="Horizon" value={horizon} min={3} max={120} step={1} format={(value) => `${value} mo`} onChange={(value) => setHorizon(Math.round(value))} />
    </div>
    <p className="mt-3 text-[11px] text-[var(--color-text-secondary)]">Scenario only · adjust the assumptions above; nothing is written to your ledger.</p>
  </article>;
}

function RunwayScenarioCard({ visualization }: { visualization: RunwayScenarioVisualization }) {
  const [burn, setBurn] = useState(visualization.monthlyBurn);
  const [income, setIncome] = useState(visualization.monthlyIncome);
  const netBurn = burn - income;
  const runway = netBurn > 0 ? visualization.cash / netBurn : Number.POSITIVE_INFINITY;
  return <article className="agent-viz-card" aria-label={visualization.title}>
    <VizHeader title={visualization.title} icon={<Gauge className="h-4 w-4" />} />
    {visualization.subtitle && <p className="mt-2 text-xs text-[var(--color-text-secondary)]">{visualization.subtitle}</p>}
    <div className="mt-3 grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,auto)]"><div><p className="text-xs text-[var(--color-text-secondary)]">Estimated runway</p><p className="mt-1 text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">{Number.isFinite(runway) ? `${runway.toLocaleString('en-US', { maximumFractionDigits: 1 })} months` : 'Cash-flow positive'}</p></div><p className="text-right text-xs text-[var(--color-text-secondary)]">Cash: {formatValue(visualization.cash, visualization.unit)}</p></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <ScenarioSlider label="Monthly spending" value={burn} min={0} max={Math.max(1000, visualization.monthlyBurn * 3 + 1000)} step={1000} format={(value) => formatValue(value, visualization.unit)} onChange={setBurn} />
      <ScenarioSlider label="Monthly income" value={income} min={0} max={Math.max(1000, visualization.monthlyIncome * 3 + 1000)} step={1000} format={(value) => formatValue(value, visualization.unit)} onChange={setIncome} />
    </div>
    <p className="mt-3 text-[11px] text-[var(--color-text-secondary)]">Scenario only · this changes the projection, not your recorded burn or income.</p>
  </article>;
}

function CalculationCard({ visualization }: { visualization: CalculationVisualization }) {
  const [left, setLeft] = useState(visualization.left.value);
  const [right, setRight] = useState(visualization.right.value);
  const result = calculateOperation(visualization.operation, left, right);
  const operator = visualization.operation === 'add' ? '+' : visualization.operation === 'subtract' ? '−' : visualization.operation === 'multiply' ? '×' : visualization.operation === 'divide' ? '÷' : '→';
  return <article className="agent-viz-card" aria-label={visualization.title}>
    <VizHeader title={visualization.title} icon={<CircleDollarSign className="h-4 w-4" />} />
    <div className="mt-4 grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
      <ScenarioNumberInput label={visualization.left.label} value={left} step={visualization.left.unit === 'percent' ? 0.1 : 1000} unit={visualization.left.unit} onChange={setLeft} />
      <span className="pb-2 text-lg font-semibold text-[var(--color-text-secondary)]">{operator}</span>
      <ScenarioNumberInput label={visualization.right.label} value={right} step={visualization.right.unit === 'percent' ? 0.1 : 1000} unit={visualization.right.unit} onChange={setRight} />
      <span className="hidden pb-2 text-lg font-semibold text-[var(--color-text-secondary)] sm:block">=</span>
      <div className="rounded-lg bg-[var(--ref-surface-container-low)] px-3 py-2"><p className="text-[11px] text-[var(--color-text-secondary)]">{visualization.resultLabel}</p><p className="mt-1 text-lg font-bold tabular-nums text-[var(--color-text-primary)]">{formatValue(result, visualization.resultUnit)}</p></div>
    </div>
    <p className="mt-3 text-[11px] text-[var(--color-text-secondary)]">Interactive calculation · changing either value updates the result locally.</p>
  </article>;
}

function ScenarioCompareCard({ visualization }: { visualization: ScenarioCompareVisualization }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = visualization.scenarios[activeIndex] ?? visualization.scenarios[0];
  if (!active) return null;
  return <article className="agent-viz-card" aria-label={visualization.title}>
    <VizHeader title={visualization.title} icon={<TrendingUp className="h-4 w-4" />} />
    <div className="mt-4 grid gap-2 sm:grid-cols-2">
      {visualization.scenarios.map((scenario, index) => <button key={`${scenario.label}-${index}`} type="button" onClick={() => setActiveIndex(index)} aria-pressed={activeIndex === index} className={`rounded-lg border p-3 text-left transition-colors ${activeIndex === index ? 'border-[var(--ref-primary)] bg-[var(--ref-primary)]/5' : 'border-[var(--color-border)] hover:border-[var(--ref-primary)]/60'}`}><span className="block text-sm font-semibold text-[var(--color-text-primary)]">{scenario.label}</span>{scenario.description && <span className="mt-1 block text-xs text-[var(--color-text-secondary)]">{scenario.description}</span>}</button>)}
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      {active.metrics.map((metric, index) => <div key={`${metric.label}-${index}`} className="min-w-0 rounded-lg bg-[var(--ref-surface-container-low)] p-3"><p className="truncate text-[11px] text-[var(--color-text-secondary)]">{metric.label}</p><p className="mt-1 truncate text-base font-bold tabular-nums text-[var(--color-text-primary)]">{formatValue(metric.value, metric.unit)}</p></div>)}
    </div>
    <p className="mt-3 text-[11px] text-[var(--color-text-secondary)]">Select a scenario to inspect its assumptions and outcome.</p>
  </article>;
}

function AllocationEditorCard({ visualization }: { visualization: AllocationEditorVisualization }) {
  const [values, setValues] = useState(() => visualization.rows.map((row) => row.value));
  const assigned = values.reduce((sum, value) => sum + value, 0);
  const remaining = visualization.total - assigned;
  const usage = visualization.total > 0 ? assigned / visualization.total * 100 : 0;
  const updateRow = (index: number, next: number) => setValues((current) => current.map((value, rowIndex) => rowIndex === index ? Math.max(0, next) : value));
  return <article className="agent-viz-card" aria-label={visualization.title}>
    <VizHeader title={visualization.title} icon={<Wallet className="h-4 w-4" />} />
    <div className="mt-3 flex items-end justify-between gap-3"><div><p className="text-xs text-[var(--color-text-secondary)]">Allocated</p><p className="mt-1 text-xl font-bold tabular-nums text-[var(--color-text-primary)]">{formatValue(assigned, visualization.unit)}</p></div><div className="text-right text-xs text-[var(--color-text-secondary)]"><p>of {formatValue(visualization.total, visualization.unit)}</p><p className={remaining < 0 ? 'mt-1 font-semibold text-[var(--color-danger)]' : 'mt-1 font-semibold text-[var(--color-success)]'}>{remaining < 0 ? `${formatValue(Math.abs(remaining), visualization.unit)} over` : `${formatValue(remaining, visualization.unit)} left`}</p></div></div>
    <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-[var(--ref-surface-container-highest)]"><div className={remaining < 0 ? 'h-full rounded-full bg-[var(--color-danger)]' : 'h-full rounded-full bg-[var(--ref-primary)]'} style={{ width: `${Math.min(100, Math.max(0, usage))}%` }} /></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {visualization.rows.map((row, index) => row.locked
        ? <div key={`${row.label}-${index}`} className="rounded-lg border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-2"><p className="text-[11px] text-[var(--color-text-secondary)]">{row.label}</p><p className="mt-1 text-sm font-semibold tabular-nums text-[var(--color-text-primary)]">{formatValue(values[index] ?? row.value, visualization.unit)}</p></div>
        : <ScenarioNumberInput key={`${row.label}-${index}`} label={row.label} value={values[index] ?? row.value} min={0} step={visualization.unit === 'percent' ? 0.1 : 1000} unit={visualization.unit} onChange={(next) => updateRow(index, next)} />)}
    </div>
    <p className="mt-3 text-[11px] text-[var(--color-text-secondary)]">Worksheet-style allocation · edits are local until you explicitly turn them into a plan.</p>
  </article>;
}

function TimeSeriesExplorerCard({ visualization }: { visualization: TimeSeriesExplorerVisualization }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [windowSize, setWindowSize] = useState<number | null>(null);
  const active = visualization.series[activeIndex] ?? visualization.series[0];
  if (!active) return null;
  const options = [7, 30, 90].filter((option) => option < active.points.length);
  const visible = windowSize == null ? active.points : active.points.slice(-windowSize);
  const values = visible.map((point) => point.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0, 1);
  const range = max - min || 1;
  const path = visible.map((point, index) => `${10 + index / Math.max(visible.length - 1, 1) * 300},${82 - ((point.value - min) / range) * 68}`).join(' ');
  const latest = visible[visible.length - 1];
  return <article className="agent-viz-card" aria-label={visualization.title}>
    <div className="flex flex-wrap items-center justify-between gap-3"><VizHeader title={visualization.title} icon={<BarChart3 className="h-4 w-4" />} /><div className="flex flex-wrap gap-1">{options.map((option) => <button key={option} type="button" onClick={() => setWindowSize(option)} className={`rounded-md px-2 py-1 text-[11px] font-semibold ${windowSize === option ? 'bg-[var(--ref-primary)] text-white' : 'bg-[var(--ref-surface-container-low)] text-[var(--color-text-secondary)] hover:text-[var(--ref-primary)]'}`}>Last {option}</button>)}<button type="button" onClick={() => setWindowSize(null)} className={`rounded-md px-2 py-1 text-[11px] font-semibold ${windowSize == null ? 'bg-[var(--ref-primary)] text-white' : 'bg-[var(--ref-surface-container-low)] text-[var(--color-text-secondary)] hover:text-[var(--ref-primary)]'}`}>All</button></div></div>
    {visualization.series.length > 1 && <div className="mt-3 flex flex-wrap gap-2">{visualization.series.map((series, index) => <button key={`${series.label}-${index}`} type="button" onClick={() => { setActiveIndex(index); setWindowSize(null); }} aria-pressed={index === activeIndex} className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${index === activeIndex ? 'border-[var(--ref-primary)] text-[var(--ref-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)]'}`}>{series.label}</button>)}</div>}
    <div className="mt-3 flex items-baseline justify-between gap-3"><p className="text-xl font-bold tabular-nums text-[var(--color-text-primary)]">{latest ? formatValue(latest.value, visualization.unit) : '—'}</p><p className="text-xs text-[var(--color-text-secondary)]">{latest?.label}</p></div>
    <svg className="mt-3 h-24 w-full overflow-visible" viewBox="0 0 320 96" role="img" aria-label={`${visualization.title}: ${active.label}`} preserveAspectRatio="none"><line x1="10" y1="82" x2="310" y2="82" stroke="var(--ref-outline-variant)" strokeWidth="1" /><polyline points={path} fill="none" stroke="var(--ref-primary)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
    <div className="mt-1 flex justify-between text-[11px] text-[var(--color-text-secondary)]"><span>{visible[0]?.label}</span><span>{latest?.label}</span></div>
  </article>;
}

function GoalTrackerCard({ visualization }: { visualization: GoalTrackerVisualization }) {
  const [target, setTarget] = useState(visualization.target);
  const [monthlyContribution, setMonthlyContribution] = useState(visualization.monthlyContribution);
  const [deadlineMonths, setDeadlineMonths] = useState(visualization.deadlineMonths ?? 12);
  const gap = Math.max(0, target - visualization.current);
  const progress = target > 0 ? Math.min(100, visualization.current / target * 100) : 0;
  const estimatedMonths = gap === 0 ? 0 : monthlyContribution > 0 ? Math.ceil(gap / monthlyContribution) : Number.POSITIVE_INFINITY;
  const requiredContribution = deadlineMonths > 0 ? gap / deadlineMonths : 0;
  return <article className="agent-viz-card" aria-label={visualization.title}>
    <VizHeader title={visualization.title} icon={<Gauge className="h-4 w-4" />} />
    <div className="mt-3 flex items-end justify-between gap-3"><div><p className="text-xs text-[var(--color-text-secondary)]">Current progress</p><p className="mt-1 text-xl font-bold tabular-nums text-[var(--color-text-primary)]">{formatValue(visualization.current, visualization.unit)}</p></div><p className="text-right text-sm font-semibold text-[var(--ref-primary)]">{progress.toLocaleString('en-US', { maximumFractionDigits: 1 })}%</p></div>
    <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-[var(--ref-surface-container-highest)]"><div className="h-full rounded-full bg-[var(--ref-primary)]" style={{ width: `${progress}%` }} /></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-3"><ScenarioNumberInput label="Goal" value={target} min={1} step={visualization.unit === 'percent' ? 0.1 : 1000} unit={visualization.unit} onChange={setTarget} /><ScenarioNumberInput label="Monthly addition" value={monthlyContribution} min={0} step={visualization.unit === 'percent' ? 0.1 : 1000} unit={visualization.unit} onChange={setMonthlyContribution} /><ScenarioNumberInput label="Target horizon" value={deadlineMonths} min={1} max={600} step={1} unit="months" onChange={(next) => setDeadlineMonths(Math.round(next))} /></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-lg bg-[var(--ref-surface-container-low)] p-3"><p className="text-[11px] text-[var(--color-text-secondary)]">At this contribution</p><p className="mt-1 text-base font-bold text-[var(--color-text-primary)]">{Number.isFinite(estimatedMonths) ? `${estimatedMonths} months` : 'Set a monthly addition'}</p></div><div className="rounded-lg bg-[var(--ref-surface-container-low)] p-3"><p className="text-[11px] text-[var(--color-text-secondary)]">Needed for this horizon</p><p className="mt-1 text-base font-bold tabular-nums text-[var(--color-text-primary)]">{formatValue(requiredContribution, visualization.unit)} / mo</p></div></div>
    <p className="mt-3 text-[11px] text-[var(--color-text-secondary)]">Goal scenario · values update locally and do not edit your financial plan.</p>
  </article>;
}

function WorksheetCard({ visualization }: { visualization: WorksheetVisualization }) {
  const [values, setValues] = useState(() => visualization.rows.map((row) => ({ ...row.values })));
  const updateCell = (rowIndex: number, key: string, next: number) => setValues((current) => current.map((row, index) => index === rowIndex ? { ...row, [key]: next } : row));
  const cellValue = (rowIndex: number, key: string): number => values[rowIndex]?.[key] ?? visualization.rows[rowIndex]?.values[key] ?? 0;
  const formulaValue = (rowIndex: number, column: WorksheetFormulaColumn): number => calculateOperation(column.operation, cellValue(rowIndex, column.left), cellValue(rowIndex, column.right));
  const totalInput = (key: string) => visualization.rows.reduce((sum, _row, index) => sum + cellValue(index, key), 0);
  const totalFormula = (column: WorksheetFormulaColumn) => {
    // A row-level amount such as `unit price × quantity` must total by adding
    // each computed row. Multiplying the two column totals would create a
    // cross-product (the source of inflated worksheet totals).
    if (column.operation === 'add' || column.operation === 'subtract' || column.operation === 'multiply') {
      return visualization.rows.reduce((sum, _row, rowIndex) => sum + formulaValue(rowIndex, column), 0);
    }
    // Ratios and percentage changes remain meaningful only when calculated
    // from the aggregate inputs rather than summed row by row.
    return calculateOperation(column.operation, totalInput(column.left), totalInput(column.right));
  };
  const reset = () => setValues(visualization.rows.map((row) => ({ ...row.values })));
  return <article className="agent-viz-card" aria-label={visualization.title}>
    <div className="flex items-center justify-between gap-3"><VizHeader title={visualization.title} icon={<BarChart3 className="h-4 w-4" />} /><button type="button" onClick={reset} className="text-[11px] font-semibold text-[var(--ref-primary)] hover:underline">Reset values</button></div>
    <div className="agent-viz-worksheet-wrap mt-4"><table><caption className="sr-only">{visualization.title}</caption><thead><tr><th scope="col">Item</th>{visualization.inputColumns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}{visualization.formulaColumns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead><tbody>{visualization.rows.map((row, rowIndex) => <tr key={`${row.label}-${rowIndex}`}><th scope="row">{row.label}</th>{visualization.inputColumns.map((column) => <td key={column.key}><input type="number" value={cellValue(rowIndex, column.key)} step={column.unit === 'percent' ? 0.1 : 1000} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) updateCell(rowIndex, column.key, next); }} className="agent-viz-workbook-input" aria-label={`${row.label} ${column.label}`} /></td>)}{visualization.formulaColumns.map((column) => <td key={column.key} className="agent-viz-workbook-result">{formatValue(formulaValue(rowIndex, column), column.unit)}</td>)}</tr>)}</tbody><tfoot><tr><th scope="row">Total</th>{visualization.inputColumns.map((column) => <td key={column.key}>{formatValue(totalInput(column.key), column.unit)}</td>)}{visualization.formulaColumns.map((column) => <td key={column.key}>{formatValue(totalFormula(column), column.unit)}</td>)}</tr></tfoot></table></div>
    <p className="mt-3 text-[11px] text-[var(--color-text-secondary)]">Interactive worksheet · input cells are editable locally; computed columns and totals update automatically.</p>
  </article>;
}

function SparklineCard({ visualization }: { visualization: SparklineVisualization }) {
  const values = visualization.points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = visualization.points.map((point, index) => `${(index / (visualization.points.length - 1)) * 300 + 10},${82 - ((point.value - min) / range) * 68}`).join(' ');
  const latest = visualization.points[visualization.points.length - 1];
  return <article className="agent-viz-card" aria-label={visualization.title}>
    <VizHeader title={visualization.title} icon={<CircleDollarSign className="h-4 w-4" />} />
    {latest && <p className="mt-3 text-xl font-bold tracking-tight text-[var(--color-text-primary)]">{formatValue(latest.value, visualization.unit)}</p>}
    <svg className="mt-3 h-20 w-full overflow-visible" viewBox="0 0 320 96" role="img" aria-label={`${visualization.title} trend`} preserveAspectRatio="none">
      <line x1="10" y1="82" x2="310" y2="82" stroke="var(--ref-outline-variant)" strokeWidth="1" />
      <polyline points={points} fill="none" stroke="var(--ref-primary)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    <div className="mt-1 flex justify-between gap-3 text-[11px] text-[var(--color-text-secondary)]"><span>{visualization.points[0]?.label}</span><span>{latest?.label}</span></div>
  </article>;
}

export function AgentVisualizationBlock({ source, accounts = [] }: { source: string; accounts?: SplitBillAccount[] }) {
  const visualization = parseVisualization(source);
  if (!visualization) return null;
  if (visualization.type === 'split_bill') return <SplitBillCard visualization={visualization} accounts={accounts} />;
  if (visualization.type === 'metric') return <MetricCard visualization={visualization} />;
  if (visualization.type === 'ranked_bar') return <RankedBarCard visualization={visualization} />;
  if (visualization.type === 'comparison') return <ComparisonCard visualization={visualization} />;
  if (visualization.type === 'sparkline') return <SparklineCard visualization={visualization} />;
  if (visualization.type === 'donut') return <DonutCard visualization={visualization} />;
  if (visualization.type === 'budget_progress') return <BudgetProgressCard visualization={visualization} />;
  if (visualization.type === 'cash_flow') return <CashFlowCard visualization={visualization} />;
  if (visualization.type === 'activity_heatmap') return <ActivityHeatmapCard visualization={visualization} />;
  if (visualization.type === 'projection') return <ProjectionCard visualization={visualization} />;
  if (visualization.type === 'runway_scenario') return <RunwayScenarioCard visualization={visualization} />;
  if (visualization.type === 'scenario_compare') return <ScenarioCompareCard visualization={visualization} />;
  if (visualization.type === 'allocation_editor') return <AllocationEditorCard visualization={visualization} />;
  if (visualization.type === 'time_series_explorer') return <TimeSeriesExplorerCard visualization={visualization} />;
  if (visualization.type === 'goal_tracker') return <GoalTrackerCard visualization={visualization} />;
  if (visualization.type === 'worksheet') return <WorksheetCard visualization={visualization} />;
  return <CalculationCard visualization={visualization} />;
}

export function isValidAgentVisualization(source: string): boolean {
  return parseVisualization(source) != null;
}
