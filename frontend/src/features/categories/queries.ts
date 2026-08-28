import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { queryKeys } from '../core/query-keys';

export const useCategoriesQuery = () => useQuery({ queryKey: queryKeys.categories.all, queryFn: () => api.categories.list() });
