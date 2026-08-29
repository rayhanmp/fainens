import { useQuery } from '@tanstack/react-query';
import {
  getNetWorthTrend,
  getSpendingTrend,
  listPeriodSummaries,
  type GetNetWorthTrend200,
  type GetSpendingTrend200,
  type ListPeriodSummaries200Item,
  type ListPeriodSummaries200ItemAnyOf,
} from '../../generated/client';
import { queryKeys } from '../core/query-keys';
import { unwrapGenerated } from '../core/generated-response';

export type NetWorthRange = '7d' | '30d' | '3m' | '6m' | '1y';
export type SpendingScope = '30d' | 'period';

/**
 * Analytics are server facts, so the chart components only own display state
 * (range, view mode, and menus). The query key keeps each selectable range
 * independently cacheable and lets financial mutations invalidate all charts.
 */
export function useNetWorthTrendQuery(range: NetWorthRange) {
  return useQuery<GetNetWorthTrend200>({
    queryKey: queryKeys.analytics.netWorthTrend(range),
    queryFn: ({ signal }) => unwrapGenerated(getNetWorthTrend({ range }, { signal }), 200, 'Failed to load net worth trend'),
    placeholderData: (previous) => previous,
  });
}

export function useSpendingTrendQuery(input: { scope: SpendingScope; periodId: number | null }) {
  const { scope, periodId } = input;
  const enabled = scope === '30d' || periodId != null;
  return useQuery<GetSpendingTrend200>({
    queryKey: queryKeys.analytics.spendingTrend(scope, scope === 'period' ? periodId : null),
    enabled,
    queryFn: ({ signal }) => unwrapGenerated(
      getSpendingTrend(scope === 'period' && periodId != null ? { periodId: String(periodId) } : undefined, { signal }),
      200,
      'Failed to load spending trend',
    ),
    placeholderData: (previous) => previous,
  });
}

export type PeriodSummary = ListPeriodSummaries200ItemAnyOf;

function isCompletePeriodSummary(item: ListPeriodSummaries200Item): item is PeriodSummary {
  return 'income' in item && typeof item.income === 'number'
    && typeof item.expenses === 'number'
    && typeof item.net === 'number';
}

/**
 * Failed period computations are represented as an item-level error by the
 * endpoint. Hide those rows from ratio/chart calculations rather than letting
 * an error object masquerade as a zero-valued financial period.
 */
export function usePeriodSummariesQuery() {
  return useQuery<PeriodSummary[]>({
    queryKey: queryKeys.analytics.periodSummaries,
    queryFn: async ({ signal }) => {
      const summaries = await unwrapGenerated(listPeriodSummaries({ signal }), 200, 'Failed to load period summaries');
      return summaries.filter(isCompletePeriodSummary);
    },
    placeholderData: (previous) => previous,
  });
}
