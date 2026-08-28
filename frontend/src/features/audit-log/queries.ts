import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { queryKeys } from '../core/query-keys';

export type AuditLogQueryParams = {
  page: number;
  pageSize: number;
  entityType?: string;
  action?: string;
  search?: string;
};

export function useAuditLogQuery(params: AuditLogQueryParams) {
  return useQuery({
    queryKey: queryKeys.auditLog.list(params),
    queryFn: () => api.auditLog.list(params),
    placeholderData: (previous) => previous,
  });
}
