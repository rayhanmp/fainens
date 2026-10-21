import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addTripBooking,
  addTripPacking,
  addTripPlan,
  addTripTraveller,
  deleteTripBooking,
  deleteTripPacking,
  deleteTripPlan,
  deleteTripTraveller,
  getGoalTrip,
  listGoalReminders,
  moveTripPlans,
  planTripAgain,
  updateGoalTrip,
  updateTripBooking,
  updateTripPacking,
  updateTripPlan,
  updateTripTraveller,
  type AddTripBookingBody,
  type AddTripPackingBody,
  type AddTripPlanBody,
  type AddTripTravellerBody,
  type GetGoalTrip200,
  type MoveTripPlansBody,
  type UpdateGoalTripBody,
  type UpdateTripBookingBody,
  type UpdateTripPackingBody,
  type UpdateTripPlanBody,
  type UpdateTripTravellerBody,
} from '../../../generated/client';
import { unwrapGenerated } from '../../core/generated-response';
import { queryKeys } from '../../core/query-keys';

export type Trip = GetGoalTrip200;
export type Booking = Trip['bookings'][number];
export type Plan = Trip['plans'][number];
export type Traveller = Trip['travellers'][number];
export type PackingItem = Trip['packing'][number];

export function useTripQuery(goalId: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.goals.trip(goalId),
    queryFn: ({ signal }) => unwrapGenerated(getGoalTrip(goalId, { signal }), 200, 'We couldn’t load the trip'),
    placeholderData: (previous) => previous,
    enabled,
  });
}

/** What goals need from you soon: a trip's bookings and papers, parts due, a fund to refill, a THR to put in. */
export function useGoalRemindersQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.goals.reminders,
    queryFn: ({ signal }) => unwrapGenerated(listGoalReminders({ signal }), 200, 'Failed to load goal reminders'),
    enabled,
  });
}

/**
 * Trip changes refresh the whole goals cache: a booking's cost moves its part of the breakdown,
 * the trip's dates move the goal's headline, and both feed reminders.
 */
function useTripMutation<TInput, TResult>(run: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.goals.all }),
  });
}

export const useUpdateTripMutation = () => useTripMutation(({ id, ...body }: UpdateGoalTripBody & { id: number }) => unwrapGenerated(updateGoalTrip(id, body), 200, 'Could not save the trip'));
export const usePlanAgainMutation = () => useTripMutation((id: number) => unwrapGenerated(planTripAgain(id), 201, 'Could not plan it again'));
export const useAddTravellerMutation = () => useTripMutation(({ goalId, ...body }: AddTripTravellerBody & { goalId: number }) => unwrapGenerated(addTripTraveller(goalId, body), 201, 'Could not add them'));
export const useUpdateTravellerMutation = () => useTripMutation(({ id, ...body }: UpdateTripTravellerBody & { id: number }) => unwrapGenerated(updateTripTraveller(id, body), 200, 'Could not save'));
export const useDeleteTravellerMutation = () => useTripMutation((id: number) => unwrapGenerated(deleteTripTraveller(id), 204, 'Could not remove them'));
export const useAddBookingMutation = () => useTripMutation(({ goalId, ...body }: AddTripBookingBody & { goalId: number }) => unwrapGenerated(addTripBooking(goalId, body), 201, 'Could not add the booking'));
export const useUpdateBookingMutation = () => useTripMutation(({ id, ...body }: UpdateTripBookingBody & { id: number }) => unwrapGenerated(updateTripBooking(id, body), 200, 'Could not save the booking'));
export const useDeleteBookingMutation = () => useTripMutation((id: number) => unwrapGenerated(deleteTripBooking(id), 204, 'Could not remove the booking'));
export const useAddPlanMutation = () => useTripMutation(({ goalId, ...body }: AddTripPlanBody & { goalId: number }) => unwrapGenerated(addTripPlan(goalId, body), 201, 'Could not add the plan'));
export const useUpdatePlanMutation = () => useTripMutation(({ id, ...body }: UpdateTripPlanBody & { id: number }) => unwrapGenerated(updateTripPlan(id, body), 200, 'Could not save the plan'));
export const useDeletePlanMutation = () => useTripMutation((id: number) => unwrapGenerated(deleteTripPlan(id), 204, 'Could not remove the plan'));
export const useAddPackingMutation = () => useTripMutation(({ goalId, ...body }: AddTripPackingBody & { goalId: number }) => unwrapGenerated(addTripPacking(goalId, body), 201, 'Could not add it'));
export const useUpdatePackingMutation = () => useTripMutation(({ id, ...body }: UpdateTripPackingBody & { id: number }) => unwrapGenerated(updateTripPacking(id, body), 200, 'Could not save'));
export const useDeletePackingMutation = () => useTripMutation((id: number) => unwrapGenerated(deleteTripPacking(id), 204, 'Could not remove it'));

/** Moving plans changes their order and day at once, so the trip's cache is set straight away. */
export function useMovePlansMutation(goalId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: MoveTripPlansBody) => unwrapGenerated(moveTripPlans(goalId, body), 200, 'Could not move the plan'),
    onMutate: (body) => {
      // Shown in its new place before the server answers.
      queryClient.setQueryData<Trip>(queryKeys.goals.trip(goalId), (trip) => trip && {
        ...trip,
        plans: trip.plans.map((plan) => {
          const index = body.ids.indexOf(plan.id);
          return index === -1 ? plan : { ...plan, day: body.day, sortOrder: index };
        }),
      });
    },
    onSuccess: (plans) => queryClient.setQueryData<Trip>(queryKeys.goals.trip(goalId), (trip) => trip && { ...trip, plans }),
    onError: () => queryClient.invalidateQueries({ queryKey: queryKeys.goals.trip(goalId) }),
  });
}
