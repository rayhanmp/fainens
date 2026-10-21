import { useQuery } from '@tanstack/react-query';
import { getAuditActivity, getEntityAuditHistory, listAuditLogs, type ListAuditLogsParams } from '../../generated/client';
import { unwrapGenerated } from '../core/generated-response';
import { queryKeys } from '../core/query-keys';

export type AuditLogQueryParams = {
  page: number;
  pageSize: number;
  entityType?: string;
  action?: string;
  search?: string;
  /** Inclusive range, in ms. */
  startDate?: number;
  endDate?: number;
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
      ...(params.startDate != null ? { startDate: String(params.startDate) } : {}),
      ...(params.endDate != null ? { endDate: String(params.endDate) } : {}),
    }), 200, 'Failed to load audit log'),
    placeholderData: (previous) => previous,
  });
}

/** Entries per day of this browser's calendar since `since`. */
export function useAuditActivityQuery(since: number) {
  return useQuery({
    queryKey: [...queryKeys.auditLog.all, 'activity', since] as const,
    queryFn: () => unwrapGenerated(getAuditActivity({ since, utcOffsetMinutes: -new Date(since).getTimezoneOffset() }), 200, 'Failed to load activity'),
  });
}

/** Every entry for one record, newest first. */
export function useAuditRecordHistoryQuery(entityType: string | null, entityId: number | null) {
  return useQuery({
    queryKey: [...queryKeys.auditLog.all, 'record', entityType, entityId] as const,
    queryFn: () => unwrapGenerated(getEntityAuditHistory(entityType!, entityId!), 200, 'Failed to load this record’s history'),
    enabled: entityType != null && entityId != null && entityId > 0,
  });
}
