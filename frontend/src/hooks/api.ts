import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

// Categories
export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => api.categories.list(),
  });
}

// Accounts
export function useAccounts() {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.accounts.list(),
  });
}

// Tags
export function useTags() {
  return useQuery({
    queryKey: ['tags'],
    queryFn: () => api.tags.list(),
  });
}

// Periods
export function usePeriods() {
  return useQuery({
    queryKey: ['periods'],
    queryFn: () => api.periods.list(),
  });
}

// Transactions
export function useTransactions(params?: {
  startDate?: string;
  endDate?: string;
  accountId?: string;
  periodId?: string;
}) {
  return useQuery({
    queryKey: ['transactions', params],
    queryFn: async () => {
      const response = await api.transactions.list(params);
      return response.data;
    },
  });
}

// Example mutation for creating a category
export function useCreateCategory() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: { name: string; icon?: string | null; color?: string | null }) =>
      api.categories.create(data),
    onSuccess: () => {
      // Invalidate and refetch categories list
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}

// Example mutation for deleting a category
export function useDeleteCategory() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: number) => api.categories.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}
