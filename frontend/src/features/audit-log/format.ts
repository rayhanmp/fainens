import { useMemo } from 'react';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { useAccountsQuery } from '../accounts/queries';
import { useCategoriesQuery, useTagsQuery } from '../categories/queries';
import { usePeriodsQuery } from '../periods/queries';
import { formatDate, formatDateTime } from '../../lib/utils';
import { auditName, entityLabel, type AuditEntry, type AuditFormat } from './describe';

type Named = ReadonlyArray<{ id: number; name: string }> | undefined;

/** Names for the ids snapshots hold, and money that respects hidden balances. */
export function useAuditFormat(): AuditFormat {
  const { formatAmount } = useBalanceVisibility();
  const categories = useCategoriesQuery().data as Named;
  const accounts = useAccountsQuery().data as Named;
  const periods = usePeriodsQuery().data as Named;
  const tags = useTagsQuery().data as Named;
  return useMemo(() => {
    const names = (rows: Named) => new Map((rows ?? []).map((row) => [row.id, row.name]));
    const categoryNames = names(categories);
    const accountNames = names(accounts);
    const periodNames = names(periods);
    const tagNames = names(tags);
    return {
      amount: formatAmount,
      date: formatDate,
      dateTime: (ms) => formatDateTime(ms),
      category: (id) => categoryNames.get(id) ?? null,
      account: (id) => accountNames.get(id) ?? null,
      period: (id) => periodNames.get(id) ?? null,
      tag: (id) => tagNames.get(id) ?? null,
    };
  }, [accounts, categories, formatAmount, periods, tags]);
}

/** The record's own name, or its kind and number when it has none. */
export function entryTitle(entry: AuditEntry): string {
  return auditName(entry) ?? `${entityLabel(entry.entityType)} #${entry.entityId}`;
}
