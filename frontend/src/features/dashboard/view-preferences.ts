import { defaultPulseMetrics, normalizePulseMetrics, type PulseMetricId } from './pulse-metrics.ts';

export const dashboardSectionIds = ['budget', 'payments', 'activity', 'netWorth', 'spending', 'pulse'] as const;
export type DashboardSection = typeof dashboardSectionIds[number];
export type DashboardMetric = 'cash' | 'budget' | 'netWorth';
export type DashboardSectionSize = 'small' | 'wide' | 'full';
export type DashboardPreset = 'original' | 'everyday' | 'overview' | 'minimal';
export type DashboardViewPreferences = {
  mainMetric: DashboardMetric;
  sectionOrder: DashboardSection[];
  hiddenSections: DashboardSection[];
  sectionSizes: Partial<Record<DashboardSection, DashboardSectionSize>>;
  /** The four metrics in the Financial pulse strip, in display order. Not part of any preset. */
  pulseMetrics: PulseMetricId[];
};

export const dashboardSectionLabels: Record<DashboardSection, string> = {
  budget: 'Budget health', payments: 'Upcoming payments', activity: 'Recent activity',
  netWorth: 'Net worth trend', spending: 'Spending activity', pulse: 'Financial pulse',
};

export function dashboardPreset(preset: DashboardPreset): DashboardViewPreferences {
  const pulseMetrics = [...defaultPulseMetrics];
  if (preset === 'original') return {
    mainMetric: 'cash', sectionOrder: ['pulse', 'netWorth', 'spending', 'budget', 'activity', 'payments'], hiddenSections: ['payments'], sectionSizes: {}, pulseMetrics,
  };
  if (preset === 'overview') return {
    mainMetric: 'netWorth', sectionOrder: ['pulse', 'netWorth', 'spending', 'budget', 'payments', 'activity'], hiddenSections: [], sectionSizes: {}, pulseMetrics,
  };
  if (preset === 'minimal') return {
    mainMetric: 'cash', sectionOrder: ['activity', 'budget', 'payments', 'netWorth', 'spending', 'pulse'], hiddenSections: ['budget', 'payments', 'netWorth', 'spending', 'pulse'], sectionSizes: {}, pulseMetrics,
  };
  return {
    mainMetric: 'budget', sectionOrder: [...dashboardSectionIds], hiddenSections: ['netWorth', 'spending', 'pulse'], sectionSizes: {}, pulseMetrics,
  };
}

/** Applies a preset's panels without discarding the user's chosen pulse metrics. */
export function applyDashboardPreset(current: DashboardViewPreferences, preset: DashboardPreset): DashboardViewPreferences {
  return { ...dashboardPreset(preset), pulseMetrics: current.pulseMetrics };
}

export function dashboardViewStorageKey(email: string) {
  return `fainens.dashboard.view:${encodeURIComponent(email)}`;
}

const isSection = (value: unknown): value is DashboardSection => typeof value === 'string' && dashboardSectionIds.includes(value as DashboardSection);

export function parseDashboardViewPreferences(raw: string | null): DashboardViewPreferences {
  const defaults = dashboardPreset('original');
  if (!raw) return defaults;
  try {
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return defaults;
    const { mainMetric, sectionOrder, hiddenSections, sectionSizes, pulseMetrics } = saved as Record<string, unknown>;
    const order = Array.isArray(sectionOrder) ? [...new Set(sectionOrder.filter(isSection))] : defaults.sectionOrder;
    const hidden = Array.isArray(hiddenSections) ? [...new Set(hiddenSections.filter(isSection))] : defaults.hiddenSections;
    const sizes: DashboardViewPreferences['sectionSizes'] = {};
    if (sectionSizes && typeof sectionSizes === 'object' && !Array.isArray(sectionSizes)) {
      for (const id of dashboardSectionIds) {
        const size = (sectionSizes as Record<string, unknown>)[id];
        if ((size === 'small' || size === 'wide' || size === 'full') && size !== defaultDashboardSectionSize(id)) sizes[id] = size;
      }
    }
    return {
      mainMetric: mainMetric === 'cash' || mainMetric === 'netWorth' || mainMetric === 'budget' ? mainMetric : defaults.mainMetric,
      sectionOrder: [...order, ...dashboardSectionIds.filter(id => !order.includes(id))],
      hiddenSections: hidden.length === dashboardSectionIds.length ? hidden.filter(id => id !== 'activity') : hidden,
      sectionSizes: sizes,
      pulseMetrics: normalizePulseMetrics(pulseMetrics),
    };
  } catch {
    return defaults;
  }
}

export function selectedDashboardPreset(preferences: DashboardViewPreferences): DashboardPreset | 'custom' {
  for (const preset of ['original', 'everyday', 'overview', 'minimal'] as const) {
    const candidate = dashboardPreset(preset);
    if (candidate.mainMetric === preferences.mainMetric
      && candidate.sectionOrder.join(',') === preferences.sectionOrder.join(',')
      && candidate.hiddenSections.length === preferences.hiddenSections.length
      && candidate.hiddenSections.every(id => preferences.hiddenSections.includes(id))
      && Object.keys(preferences.sectionSizes).length === 0) return preset;
  }
  return 'custom';
}

/** Whether panels match the original preset, ignoring the main metric and desktop-only widths. */
export function usesOriginalDashboardSections(preferences: DashboardViewPreferences): boolean {
  const original = dashboardPreset('original');
  return original.sectionOrder.join(',') === preferences.sectionOrder.join(',')
    && original.hiddenSections.length === preferences.hiddenSections.length
    && original.hiddenSections.every(id => preferences.hiddenSections.includes(id));
}

export function defaultDashboardSectionSize(id: DashboardSection): DashboardSectionSize {
  return id === 'pulse' ? 'full' : id === 'budget' || id === 'netWorth' ? 'wide' : 'small';
}

export function dashboardSectionSize(preferences: DashboardViewPreferences, id: DashboardSection): DashboardSectionSize {
  return preferences.sectionSizes[id] ?? defaultDashboardSectionSize(id);
}

export function dashboardSectionRows(preferences: DashboardViewPreferences): DashboardSection[][] {
  const rows: DashboardSection[][] = [];
  let pair: DashboardSection[] = [];
  const flush = () => { if (pair.length) { rows.push(pair); pair = []; } };
  for (const id of preferences.sectionOrder.filter(id => !preferences.hiddenSections.includes(id))) {
    if (dashboardSectionSize(preferences, id) === 'full') { flush(); rows.push([id]); }
    else { pair.push(id); if (pair.length === 2) flush(); }
  }
  flush();
  return rows;
}

export function dashboardSectionWidth(preferences: DashboardViewPreferences, id: DashboardSection, width: number, gap: number): number {
  const row = dashboardSectionRows(preferences).find(ids => ids.includes(id));
  if (!row || row.length === 1) return width;
  const wide = (section: DashboardSection) => dashboardSectionSize(preferences, section) === 'wide';
  const mixed = wide(row[0]) !== wide(row[1]);
  return (width - gap) * (mixed ? wide(id) ? 2 / 3 : 1 / 3 : 1 / 2);
}

export function resizeDashboardSection(preferences: DashboardViewPreferences, id: DashboardSection, size: DashboardSectionSize): DashboardViewPreferences {
  const sectionSizes = { ...preferences.sectionSizes };
  if (size === defaultDashboardSectionSize(id)) delete sectionSizes[id];
  else sectionSizes[id] = size;
  return { ...preferences, sectionSizes };
}

export function moveDashboardSection(preferences: DashboardViewPreferences, from: DashboardSection, to: DashboardSection): DashboardViewPreferences {
  if (from === to || preferences.hiddenSections.includes(from) || preferences.hiddenSections.includes(to)) return preferences;
  const fromIndex = preferences.sectionOrder.indexOf(from);
  const toIndex = preferences.sectionOrder.indexOf(to);
  if (fromIndex < 0 || toIndex < 0) return preferences;
  const sectionOrder = [...preferences.sectionOrder];
  sectionOrder.splice(fromIndex, 1);
  sectionOrder.splice(toIndex, 0, from);
  return { ...preferences, sectionOrder };
}

export function resetDashboardLayout(preferences: DashboardViewPreferences): DashboardViewPreferences {
  return { ...preferences, sectionOrder: dashboardPreset('original').sectionOrder, sectionSizes: {} };
}

export function mergeDashboardViewChange(current: DashboardViewPreferences, visible: DashboardViewPreferences, next: DashboardViewPreferences): DashboardViewPreferences {
  const sameSections = next.sectionOrder.join(',') === visible.sectionOrder.join(',')
    && next.hiddenSections.length === visible.hiddenSections.length
    && next.hiddenSections.every(id => visible.hiddenSections.includes(id));
  return sameSections ? { ...next, sectionOrder: current.sectionOrder, hiddenSections: current.hiddenSections } : next;
}
