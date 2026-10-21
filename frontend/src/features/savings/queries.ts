import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createSavingsPlan,
  deleteSavingsPlan,
  listSavingsPlans,
  updateSavingsPlan,
} from '../../generated/client';
import { useAccountsLedgerQuery } from '../accounts/queries';
import { usePeriodSummariesQuery } from '../analytics/queries';
import { useBudgetPeriodsQuery } from '../budgets/queries';
import { unwrapGenerated } from '../core/generated-response';
import { queryKeys } from '../core/query-keys';
import { useGoalsQuery, type GoalsOverview } from '../goals/queries';
import { useWishlistQuery } from '../wishlist/queries';
import { findCurrentPeriod } from '../../lib/utils';
import { normalizePlan, planMonthOf, recentSaving, type PlanInputs } from './plan';

export type SavedPlan = { id: number; name: string; inputs: PlanInputs; createdAt: number; updatedAt: number };

export function useSavingsPlansQuery() {
  return useQuery({
    queryKey: queryKeys.savings.plans,
    queryFn: async ({ signal }): Promise<SavedPlan[]> => {
      const plans = await unwrapGenerated(listSavingsPlans({ signal }), 200, 'Failed to load saved plans');
      return plans.map((plan) => ({ id: plan.id, name: plan.name, inputs: normalizePlan(plan.inputs), createdAt: plan.createdAt, updatedAt: plan.updatedAt }));
    },
    placeholderData: (previous) => previous,
  });
}

export function useCreateSavingsPlanMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; inputs: PlanInputs }) => unwrapGenerated(createSavingsPlan(input), 201, 'Could not save the plan'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.savings.plans }),
  });
}

export function useUpdateSavingsPlanMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number; name?: string; inputs?: PlanInputs }) => unwrapGenerated(updateSavingsPlan(id, input), 200, 'Could not update the plan'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.savings.plans }),
  });
}

export function useDeleteSavingsPlanMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrapGenerated(deleteSavingsPlan(id), 204, 'Could not delete the plan'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.savings.plans }),
  });
}

export type LedgerFacts = {
  loading: boolean;
  /** Cash and investments across active accounts, without money owed to you. */
  liquid: number | null;
  liquidAccounts: number;
  /** Average saved per finished period (income minus spending), the last six. */
  saving: ReturnType<typeof recentSaving>;
  /** This period's savings target from the budget, in rupiah. */
  target: number | null;
  /** Active wishlist items, as goals dated by their target period. */
  wishlist: Array<{ id: number; name: string; amount: number; byMonth: number | null }>;
  /** Your real goals and what's set aside for them, once loaded. */
  goals: GoalsOverview | null;
};

/** What the ledger already knows that a plan can start from, as of `now`. */
export function useLedgerFacts(now: number): LedgerFacts {
  const accounts = useAccountsLedgerQuery({ type: 'asset' });
  const summaries = usePeriodSummariesQuery();
  const periods = useBudgetPeriodsQuery();
  const wishlist = useWishlistQuery();
  const goals = useGoalsQuery();
  return useMemo(() => {
    const liquidRows = (accounts.data ?? []).filter((account) => account.isActive && !account.systemKey && (account.liquidityClass === 'cash_equivalent' || account.liquidityClass === 'investment'));
    const saving = recentSaving(summaries.data ?? [], now);
    const current = findCurrentPeriod(periods.data ?? [], now);
    const currentSummary = current ? summaries.data?.find((summary) => summary.periodId === current.id) : undefined;
    let target: number | null = null;
    if (current?.savingsTargetMode === 'income_percent' && (current.savingsTargetRate ?? 0) > 0) {
      const income = currentSummary?.income || (saving ? saving.average + saving.averageSpending : 0);
      target = income > 0 ? Math.round((income * (current.savingsTargetRate ?? 0)) / 100) : null;
    } else if ((current?.savingsTargetAmount ?? 0) > 0) {
      target = current!.savingsTargetAmount!;
    }
    const periodEnd = new Map((periods.data ?? []).map((period) => [period.id, Number(period.endDate)]));
    return {
      loading: accounts.isPending || summaries.isPending || goals.isPending,
      liquid: accounts.data ? liquidRows.reduce((sum, account) => sum + account.balance, 0) : null,
      liquidAccounts: liquidRows.length,
      saving,
      target,
      goals: goals.data ?? null,
      // Items you already save for through a goal are covered by that goal.
      wishlist: (wishlist.data?.items ?? [])
        .filter((item) => item.status === 'active' && item.amount > 0 && !goals.data?.goals.some((goal) => goal.wishlistId === item.id && goal.status === 'active'))
        .map((item) => {
          const end = item.periodId != null ? periodEnd.get(item.periodId) : undefined;
          return { id: item.id, name: item.name, amount: item.amount, byMonth: end && end > now ? planMonthOf(new Date(end)) : null };
        }),
    };
  }, [now, accounts.data, accounts.isPending, summaries.data, summaries.isPending, periods.data, wishlist.data, goals.data, goals.isPending]);
}
