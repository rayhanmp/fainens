import { useQuery } from '@tanstack/react-query';
import {
  getNetWorthTrend,
  getSpendingTrend,
  type GetNetWorthTrend200,
  type GetSpendingTrend200,
} from '../../generated/client';
import { api } from '../../lib/api';
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

export type PeriodSummary = Awaited<ReturnType<typeof api.analytics.periodSummaries>>[number];

/**
 * The legacy endpoint includes income/expense/net totals that the current
 * generated OpenAPI schema does not yet describe. Keep that adapter isolated
 * here until the contract is expanded, while still giving consumers a typed
 * React Query cache and cancellation lifecycle.
 */
export function usePeriodSummariesQuery() {
  return useQuery<PeriodSummary[]>({
    queryKey: queryKeys.analytics.periodSummaries,
    queryFn: ({ signal }) => api.analytics.periodSummaries({ signal }),
    placeholderData: (previous) => previous,
  });
}
