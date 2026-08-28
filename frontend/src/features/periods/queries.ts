import { useQuery } from '@tanstack/react-query';
import { listPeriods } from '../../generated/client';
import { queryKeys } from '../core/query-keys';

export const usePeriodsQuery = () => useQuery({
  queryKey: queryKeys.periods.all,
  queryFn: async ({ signal }) => (await listPeriods({ signal })).data,
});
