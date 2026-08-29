import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  generateBudgetInsight,
  generateDashboardInsight,
  getLatestBudgetInsight,
  getLatestDashboardInsight,
} from '../../generated/client';
import { unwrapGenerated } from '../core/generated-response';
import { queryKeys } from '../core/query-keys';

export type InsightType = 'dashboard' | 'budget';

/** Cached insight is server state and should be shared by every insight card. */
export function useLatestInsightQuery(type: InsightType, periodId?: number) {
  return useQuery({
    queryKey: queryKeys.insights.latest(type, periodId ?? null),
    queryFn: ({ signal }) => {
      const params = periodId == null ? undefined : { periodId: String(periodId) };
      return type === 'dashboard'
        ? unwrapGenerated(getLatestDashboardInsight(params, { signal }), 200, 'Failed to load latest insight')
        : unwrapGenerated(getLatestBudgetInsight(params, { signal }), 200, 'Failed to load latest insight');
    },
  });
}

export function useGenerateInsightMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ type, periodId }: { type: InsightType; periodId?: number }) => {
      if (type === 'dashboard') {
        const params = periodId == null ? undefined : { periodId: String(periodId) };
        return unwrapGenerated(generateDashboardInsight(params), 200, 'Failed to generate insight');
      }
      return unwrapGenerated(generateBudgetInsight(periodId == null ? {} : { periodId }), 200, 'Failed to generate insight');
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.insights.latest(variables.type, variables.periodId ?? null) });
    },
  });
}
