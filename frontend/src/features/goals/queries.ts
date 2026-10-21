import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addGoalPart,
  allocateToGoal,
  completeGoal,
  createGoal,
  deleteGoal,
  deleteGoalAttachment,
  deleteGoalPart,
  fundGoalsMonthly,
  getGoal,
  getGoalsOverview,
  listGoalAllocations,
  previewGoalLink,
  reopenGoal,
  reorderGoals,
  spendFromGoal,
  updateGoal,
  updateGoalAttachment,
  updateGoalPart,
  updateGoalSettings,
  uploadGoalAttachment,
  UploadGoalAttachmentBodyContentType,
  type AddGoalPartBody,
  type CreateGoalBody,
  type GetGoal200,
  type GetGoalsOverview200,
  type SpendFromGoalBody,
  type UpdateGoalAttachmentBody,
  type UpdateGoalBody,
  type UpdateGoalPartBody,
  type UpdateGoalSettingsBody,
  type UploadGoalAttachmentBody,
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
export const useFundMonthlyMutation = () => useGoalMutation((goalIds: number[] | null) => unwrapGenerated(fundGoalsMonthly({ goalIds }), 200, 'Could not put the money in'));
export const useGoalSettingsMutation = () => useGoalMutation((body: UpdateGoalSettingsBody) => unwrapGenerated(updateGoalSettings(body), 200, 'Could not save'));
export const useReorderGoalsMutation = () => useGoalMutation((ids: number[]) => unwrapGenerated(reorderGoals({ ids }), 200, 'Could not change the order'));
export const useSpendFromGoalMutation = () => useGoalMutation(({ id, ...body }: SpendFromGoalBody & { id: number }) => unwrapGenerated(spendFromGoal(id, body), 200, 'Could not pay from the goal'));
export const useAddPartMutation = () => useGoalMutation(({ id, ...body }: AddGoalPartBody & { id: number }) => unwrapGenerated(addGoalPart(id, body), 201, 'Could not add the part'));
export const useUpdatePartMutation = () => useGoalMutation(({ id, ...body }: UpdateGoalPartBody & { id: number }) => unwrapGenerated(updateGoalPart(id, body), 200, 'Could not save the part'));
export const useDeletePartMutation = () => useGoalMutation((id: number) => unwrapGenerated(deleteGoalPart(id), 204, 'Could not remove the part'));
export const useUpdateGoalFileMutation = () => useGoalMutation(({ id, ...body }: UpdateGoalAttachmentBody & { id: number }) => unwrapGenerated(updateGoalAttachment(id, body), 200, 'Could not save the file'));
export const useDeleteGoalFileMutation = () => useGoalMutation((id: number) => unwrapGenerated(deleteGoalAttachment(id), 204, 'Could not remove the file'));

/** The file types a goal can hold, as the server accepts them. */
export const GOAL_FILE_TYPES = Object.values(UploadGoalAttachmentBodyContentType) as string[];
export const GOAL_FILE_MAX_BYTES = 5 * 1024 * 1024;

/** Reads a file and uploads it to the goal. */
export const useUploadGoalFileMutation = () => useGoalMutation(async ({ id, file, fromNotes }: { id: number; file: File; fromNotes?: boolean }) => {
  if (!GOAL_FILE_TYPES.includes(file.type)) throw new Error('Use a picture, PDF or text file');
  if (file.size > GOAL_FILE_MAX_BYTES) throw new Error('Files can be up to 5 MB');
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
  return unwrapGenerated(uploadGoalAttachment(id, { filename: file.name, contentType: file.type as UploadGoalAttachmentBody['contentType'], data, ...(fromNotes ? { fromNotes } : {}) }), 201, 'Could not upload the file');
});

/** Reads a product link: its title, price and picture. Shops outside the scraper's list say so. */
export function usePreviewLinkMutation() {
  return useMutation({ mutationFn: (url: string) => unwrapGenerated(previewGoalLink({ url }), 200, 'Couldn’t read that page; the link is still saved') });
}

export type GoalDetail = GetGoal200;
export type GoalPart = GoalDetail['parts'][number];
export type GoalFile = GoalDetail['attachments'][number];

export function useGoalQuery(id: number) {
  return useQuery({
    queryKey: queryKeys.goals.detail(id),
    queryFn: ({ signal }) => unwrapGenerated(getGoal(id, { signal }), 200, 'We couldn’t load this goal'),
    placeholderData: (previous) => (previous?.goal.id === id ? previous : undefined),
  });
}

/** Where a goal's file and link picture are served from. */
export const goalFileUrl = (id: number) => `/api/goal-attachments/${id}/file`;
export const goalLinkImageUrl = (key: string) => `/api/goal-link-images/${key}`;
