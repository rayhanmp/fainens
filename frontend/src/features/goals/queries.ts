import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  allocateToGoal,
  completeGoal,
  createGoal,
  deleteGoal,
  fundGoalsMonthly,
  getGoalsOverview,
  listGoalAllocations,
  reopenGoal,
  updateGoal,
  updateGoalSettings,
  type CreateGoalBody,
  type GetGoalsOverview200,
  type UpdateGoalBody,
} from '../../generated/client';
import { unwrapGenerated } from '../core/generated-response';
import { queryKeys } from '../core/query-keys';

export type GoalsOverview = GetGoalsOverview200;
export type Goal = GoalsOverview['goals'][number];
export type GoalAccount = GoalsOverview['accounts'][number];

export function useGoalsQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.goals.all,
    queryFn: ({ signal }) => unwrapGenerated(getGoalsOverview({ signal }), 200, 'Failed to load goals'),
    placeholderData: (previous) => previous,
    enabled,
  });
}

export function useGoalAllocationsQuery(goalId: number | null) {
  return useQuery({
    queryKey: queryKeys.goals.allocations(goalId ?? 0),
    queryFn: ({ signal }) => unwrapGenerated(listGoalAllocations(goalId!, { signal }), 200, 'Failed to load the goal’s history'),
    enabled: goalId !== null,
  });
}

/** Every goal change can move money between goals and unassigned, so the whole overview refreshes. */
function useGoalMutation<TInput, TResult>(run: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.goals.all }),
  });
}

export const useCreateGoalMutation = () => useGoalMutation((body: CreateGoalBody) => unwrapGenerated(createGoal(body), 201, 'Could not add the goal'));
export const useUpdateGoalMutation = () => useGoalMutation(({ id, ...body }: UpdateGoalBody & { id: number }) => unwrapGenerated(updateGoal(id, body), 200, 'Could not save the goal'));
export const useDeleteGoalMutation = () => useGoalMutation((id: number) => unwrapGenerated(deleteGoal(id), 204, 'Could not delete the goal'));
export const useAllocateMutation = () => useGoalMutation(({ id, amount, note }: { id: number; amount: number; note?: string | null }) => unwrapGenerated(allocateToGoal(id, { amount, note: note ?? null }), 200, 'Could not move the money'));
export const useCompleteGoalMutation = () => useGoalMutation(({ id, transactionId }: { id: number; transactionId: number | null }) => unwrapGenerated(completeGoal(id, { transactionId }), 200, 'Could not finish the goal'));
export const useReopenGoalMutation = () => useGoalMutation((id: number) => unwrapGenerated(reopenGoal(id), 200, 'Could not reopen the goal'));
export const useFundMonthlyMutation = () => useGoalMutation((goalIds: number[] | null) => unwrapGenerated(fundGoalsMonthly({ goalIds }), 200, 'Could not set the money aside'));
export const useGoalSettingsMutation = () => useGoalMutation((excludedAccountIds: number[]) => unwrapGenerated(updateGoalSettings({ excludedAccountIds }), 200, 'Could not save'));
