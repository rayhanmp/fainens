import { useQuery } from '@tanstack/react-query';
import { listCategories } from '../../generated/client';
import { queryKeys } from '../core/query-keys';

export const useCategoriesQuery = () => useQuery({
  queryKey: queryKeys.categories.all,
  queryFn: async () => (await listCategories()).data,
});
