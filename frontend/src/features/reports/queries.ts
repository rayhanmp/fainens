import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { queryKeys } from '../core/query-keys';

export function useIncomeStatementQuery(periodId?: number) {
  return useQuery({
    queryKey: [...queryKeys.reports.income, periodId ?? null] as const,
    queryFn: () => api.reports.incomeStatement(periodId),
    placeholderData: (previous) => previous,
  });
}

export function useBalanceSheetQuery(asOfDate?: number) {
  return useQuery({
    queryKey: [...queryKeys.reports.balance, asOfDate ?? null] as const,
    queryFn: () => api.reports.balanceSheet(asOfDate),
    placeholderData: (previous) => previous,
  });
}

export function useCashFlowQuery(periodId?: number) {
  return useQuery({
    queryKey: [...queryKeys.reports.cashflow, periodId ?? null] as const,
    queryFn: () => api.reports.cashFlow(periodId),
    placeholderData: (previous) => previous,
  });
}

export function useSpendingQuery(periodId?: number) {
  return useQuery({
    queryKey: [...queryKeys.reports.spending, periodId ?? null] as const,
    queryFn: async () => {
      const [report, categories] = await Promise.all([
        api.reports.spending(periodId),
        api.categories.list(),
      ]);
      return { report, categories };
    },
    placeholderData: (previous) => previous,
  });
}

export function useTrendsQuery(periodCount = 6) {
  return useQuery({
    queryKey: [...queryKeys.reports.trends, periodCount] as const,
    queryFn: () => api.reports.trends(periodCount),
    placeholderData: (previous) => previous,
  });
}

export type ReportSummary = {
  totalRevenue: number;
  totalExpenses: number;
  netIncome: number;
  totalAssets: number;
  totalLiabilities: number;
  previousPeriodRevenue?: number;
  previousPeriodExpenses?: number;
};

export function useReportSummaryQuery(input: {
  periodId: number | null;
  periodEndDate?: number;
  previousPeriodId?: number;
}) {
  const { periodId, periodEndDate, previousPeriodId } = input;
  return useQuery<ReportSummary>({
    queryKey: [...queryKeys.reports.summary, periodId, periodEndDate ?? null, previousPeriodId ?? null] as const,
    enabled: periodId != null,
    queryFn: async () => {
      const [income, balance] = await Promise.all([
        api.reports.incomeStatement(periodId!),
        api.reports.balanceSheet(
          periodEndDate == null
            ? undefined
            : (periodEndDate % 86_400_000 === 0 ? periodEndDate + 86_400_000 - 1 : periodEndDate),
        ),
      ]);
      let previous: Pick<ReportSummary, 'previousPeriodRevenue' | 'previousPeriodExpenses'> = {};
      if (previousPeriodId != null) {
        try {
          const previousIncome = await api.reports.incomeStatement(previousPeriodId);
          previous = {
            previousPeriodRevenue: previousIncome.totalRevenue,
            previousPeriodExpenses: previousIncome.totalExpenses,
          };
        } catch {
          // A missing comparison period should not hide the current report.
        }
      }
      return {
        totalRevenue: income.totalRevenue,
        totalExpenses: income.totalExpenses,
        netIncome: income.netIncome,
        totalAssets: balance.totalAssets,
        totalLiabilities: balance.totalLiabilities,
        ...previous,
      };
    },
    placeholderData: (previous) => previous,
  });
}
