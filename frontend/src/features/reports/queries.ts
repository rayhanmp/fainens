import { useQuery } from '@tanstack/react-query';
import {
  getBalanceSheet,
  getCashFlowStatement,
  getIncomeStatement,
  getReportTrends,
  getSpendingReport,
} from '../../generated/client';
import { queryKeys } from '../core/query-keys';
import { listCategories } from '../../generated/client';
import { unwrapGenerated } from '../core/generated-response';

export function useIncomeStatementQuery(periodId?: number) {
  return useQuery({
    queryKey: [...queryKeys.reports.income, periodId ?? null] as const,
    queryFn: () => unwrapGenerated(getIncomeStatement(periodId == null ? undefined : { periodId }), 200, 'Failed to load income statement'),
    placeholderData: (previous) => previous,
  });
}

export function useBalanceSheetQuery(asOfDate?: number) {
  return useQuery({
    queryKey: [...queryKeys.reports.balance, asOfDate ?? null] as const,
    queryFn: () => unwrapGenerated(getBalanceSheet(asOfDate == null ? undefined : { asOfDate }), 200, 'Failed to load balance sheet'),
    placeholderData: (previous) => previous,
  });
}

export function useCashFlowQuery(periodId?: number) {
  return useQuery({
    queryKey: [...queryKeys.reports.cashflow, periodId ?? null] as const,
    queryFn: () => unwrapGenerated(getCashFlowStatement(periodId == null ? undefined : { periodId }), 200, 'Failed to load cash flow'),
    placeholderData: (previous) => previous,
  });
}

export function useSpendingQuery(periodId?: number) {
  return useQuery({
    queryKey: [...queryKeys.reports.spending, periodId ?? null] as const,
    queryFn: async () => {
      const [report, categories] = await Promise.all([
        unwrapGenerated(getSpendingReport(periodId == null ? undefined : { periodId }), 200, 'Failed to load spending report'),
        unwrapGenerated(listCategories(), 200, 'Failed to load categories'),
      ]);
      return { report, categories };
    },
    placeholderData: (previous) => previous,
  });
}

export function useTrendsQuery(periodCount = 6) {
  return useQuery({
    queryKey: [...queryKeys.reports.trends, periodCount] as const,
    queryFn: () => unwrapGenerated(getReportTrends({ periodCount }), 200, 'Failed to load report trends'),
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
        unwrapGenerated(getIncomeStatement({ periodId: periodId! }), 200, 'Failed to load income statement'),
        unwrapGenerated(getBalanceSheet({
          asOfDate: periodEndDate == null ? undefined : (periodEndDate % 86_400_000 === 0 ? periodEndDate + 86_400_000 - 1 : periodEndDate),
        }), 200, 'Failed to load balance sheet'),
      ]);
      let previous: Pick<ReportSummary, 'previousPeriodRevenue' | 'previousPeriodExpenses'> = {};
      if (previousPeriodId != null) {
        try {
          const previousIncome = await unwrapGenerated(getIncomeStatement({ periodId: previousPeriodId }), 200, 'Failed to load comparison income statement');
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
