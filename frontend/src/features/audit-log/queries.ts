import { useQuery } from '@tanstack/react-query';
import { listAuditLogs, type ListAuditLogsParams } from '../../generated/client';
import { unwrapGenerated } from '../core/generated-response';
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
    queryFn: () => unwrapGenerated(listAuditLogs({
      entityType: params.entityType as ListAuditLogsParams['entityType'],
      action: params.action as ListAuditLogsParams['action'],
      search: params.search,
      page: String(params.page),
      pageSize: String(params.pageSize),
    }), 200, 'Failed to load audit log'),
    placeholderData: (previous) => previous,
  });
}
