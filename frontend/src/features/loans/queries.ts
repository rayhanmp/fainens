import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContact,
  createLoan,
  deleteLoan,
  getLoanSummary,
  getContact,
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
import { normalizeTimestamp, unwrapGenerated } from '../core/generated-response';
import { invalidateFinancialSummaries, queryKeys } from '../core/query-keys';

export type LoansPageData = {
  loans: Awaited<ReturnType<typeof listLoans>>['data'];
  contacts: Awaited<ReturnType<typeof listContacts>>['data'];
  summary: Awaited<ReturnType<typeof getLoanSummary>>['data'];
};

/** Shared contact lookup for loan and split-bill forms. */
export function useContactsQuery(includeInactive = false, enabled = true) {
  return useQuery({
    queryKey: queryKeys.contacts.list({ includeInactive }),
    queryFn: ({ signal }) => unwrapGenerated(
      listContacts(includeInactive ? { includeInactive: 'true' } : undefined, { signal }),
      200,
      'Failed to load contacts',
    ),
    placeholderData: (previous) => previous,
    enabled,
  });
}

/** Detail query used by the contact profile modal. */
export function useContactDetailQuery(contactId: number | null) {
  return useQuery({
    queryKey: queryKeys.contacts.detail(contactId ?? 0),
    queryFn: ({ signal }) => unwrapGenerated(getContact(contactId!, { signal }), 200, 'Failed to load contact details'),
    enabled: contactId != null,
  });
}

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
    mutationFn: async ({ id, data }: { id: number; data: UpdateContactBody }) => {
      const updated = await unwrapGenerated(updateContact(id, data), 200, 'Failed to update contact');
      return { ...updated, createdAt: normalizeTimestamp(updated.createdAt), updatedAt: normalizeTimestamp(updated.updatedAt) };
    },
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}
