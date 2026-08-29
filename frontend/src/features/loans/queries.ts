import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContact,
  createLoan,
  deleteLoan,
  getLoanSummary,
  listContacts,
  listLoans,
  recordLoanPayment,
  updateContact,
  updateLoan,
  type CreateContactBody,
  type CreateLoanBody,
  type RecordLoanPaymentBody,
  type UpdateContactBody,
  type UpdateLoanBody,
} from '../../generated/client';
import { unwrapGenerated } from '../core/generated-response';
import { invalidateFinancialSummaries, queryKeys } from '../core/query-keys';

export type LoansPageData = {
  loans: Awaited<ReturnType<typeof listLoans>>['data'];
  contacts: Awaited<ReturnType<typeof listContacts>>['data'];
  summary: Awaited<ReturnType<typeof getLoanSummary>>['data'];
};

/** Aggregates the records needed by the loans screen into one server-state query. */
export function useLoansQuery() {
  return useQuery<LoansPageData>({
    queryKey: queryKeys.loans.all,
    queryFn: async () => {
      const [activeLoans, repaidLoans, contacts, summary] = await Promise.all([
        unwrapGenerated(listLoans({ status: 'active' }), 200, 'Failed to load active loans'),
        unwrapGenerated(listLoans({ status: 'repaid' }), 200, 'Failed to load repaid loans'),
        unwrapGenerated(listContacts(), 200, 'Failed to load contacts'),
        unwrapGenerated(getLoanSummary(), 200, 'Failed to load loan summary'),
      ]);
      return { loans: [...activeLoans, ...repaidLoans], contacts, summary };
    },
    placeholderData: (previous) => previous,
  });
}

export function useDeleteLoanMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrapGenerated(deleteLoan(id), 204, 'Failed to delete loan'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useCreateLoanMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLoanBody) => unwrapGenerated(createLoan(input), 201, 'Failed to create loan'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useRecordLoanPaymentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: RecordLoanPaymentBody }) => unwrapGenerated(recordLoanPayment(id, data), 201, 'Failed to record loan payment'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useUpdateLoanMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateLoanBody }) => unwrapGenerated(updateLoan(id, data), 200, 'Failed to update loan'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useCreateContactMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateContactBody) => unwrapGenerated(createContact(input), 201, 'Failed to create contact'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useUpdateContactMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateContactBody }) => unwrapGenerated(updateContact(id, data), 200, 'Failed to update contact'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}
