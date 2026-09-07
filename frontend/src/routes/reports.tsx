import { createFileRoute, Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { PageHeader } from '../components/ui/PageHeader';
import { PageContainer } from '../components/ui/PageContainer';
import { RequireAuth } from '../lib/auth';
import { useState } from 'react';
import { usePeriodsLedgerQuery } from '../features/periods/queries';
import {
  useBalanceSheetQuery,
  useCashFlowQuery,
  useIncomeStatementQuery,
  useReportSummaryQuery,
  useSpendingQuery,
  useTrendsQuery,
  useExportReportMutation,
} from '../features/reports/queries';
import { formatCurrency, cn } from '../lib/utils';
import { CardSkeleton } from '../components/ui/Skeleton';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  Download,
  FileText,
  PieChart,
  TrendingUp,
  Scale,
  ArrowRightLeft,
  RefreshCw,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Plus,
  FileDown,
  Wallet,
  TrendingDown,
  PiggyBank,
} from 'lucide-react';
import {
  PieChart as RePieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';

export const Route = createFileRoute('/reports')({
  validateSearch: (search: Record<string, unknown>) => ({
    periodId: typeof search.periodId === 'string' ? search.periodId : undefined,
    tab: search.tab === 'balance' || search.tab === 'cashflow' || search.tab === 'spending' || search.tab === 'trends' ? search.tab : 'income',
  }),
  component: ReportsPage,
} as any);

type ReportTab = 'income' | 'balance' | 'cashflow' | 'spending' | 'trends';

function inclusivePeriodEnd(timestamp: number): number {
  return timestamp % 86_400_000 === 0 ? timestamp + 86_400_000 - 1 : timestamp;
}

function ReportsPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: '/reports' }) as { periodId?: string; tab?: ReportTab };
  const activeTab: ReportTab = search.tab ?? 'income';
  const periodsQuery = usePeriodsLedgerQuery();
  const exportReportMutation = useExportReportMutation();
  const periods = periodsQuery.data ?? [];
  // Null means “use the newest period”; an explicit empty string means All Periods.
  const selectedPeriodId = search.periodId ?? null;
  const effectivePeriodId = selectedPeriodId ?? periods[0]?.id.toString() ?? '';
  const selectedPeriod = periods.find((p) => p.id.toString() === effectivePeriodId);
  const selectedNumericPeriodId = effectivePeriodId ? Number(effectivePeriodId) : null;
  const currentPeriodIndex = selectedNumericPeriodId == null
    ? -1
    : periods.findIndex((period) => period.id === selectedNumericPeriodId);
  const previousPeriodId = currentPeriodIndex >= 0 ? periods[currentPeriodIndex + 1]?.id : undefined;
  const summaryQuery = useReportSummaryQuery({
    periodId: selectedNumericPeriodId,
    periodEndDate: selectedPeriod?.endDate,
    previousPeriodId,
  });
  const summaryData = summaryQuery.data ?? null;

  const handleExportPDF = (reportTitle: string, data: any[]) => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    doc.setProperties({ title: reportTitle, subject: 'Confidential personal financial report', author: 'Fainens', creator: 'Fainens' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 42;
    const navy: [number, number, number] = [16, 42, 67];
    const blue: [number, number, number] = [33, 85, 197];
    const muted: [number, number, number] = [98, 125, 152];
    const pale: [number, number, number] = [245, 248, 252];

    const moneyKey = (key: string) => /amount|total|revenue|expense|income|variance|budget|actual|balance|net/i.test(key) && !/id/i.test(key);
    const formatCell = (value: unknown, key: string) => {
      if (typeof value === 'number' && moneyKey(key)) return formatCurrency(value);
      if (value == null || value === '') return '-';
      return String(value);
    };
    const keys = Object.keys(data[0] || {});
    const title = reportTitle.replace(/\s+-\s+[^-]+$/, '');
    const period = reportTitle.includes(' - ') ? reportTitle.split(' - ').slice(1).join(' - ') : 'Fainens report';

    const drawPageChrome = (pageNumber: number, totalPages?: number) => {
      doc.setFillColor(...navy);
      doc.rect(0, 0, pageWidth, 10, 'F');
      doc.setTextColor(...navy);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(20);
      doc.text('Fainens', margin, 48);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...muted);
      doc.text('Personal finance, made clearer', margin, 64);
      doc.setDrawColor(217, 226, 236);
      doc.line(margin, 78, pageWidth - margin, 78);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...muted);
      doc.text('Confidential - generated ' + new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date()), margin, pageHeight - 25);
      doc.text(`${pageNumber}${totalPages ? ` / ${totalPages}` : ''}`, pageWidth - margin, pageHeight - 25, { align: 'right' });
    };

    drawPageChrome(1);
    doc.setFillColor(...pale);
    doc.roundedRect(margin, 102, pageWidth - margin * 2, 104, 12, 12, 'F');
    doc.setTextColor(...muted);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('REPORT EXPORT', margin + 18, 126);
    doc.setTextColor(...navy);
    doc.setFontSize(19);
    doc.text(title, margin + 18, 154);
    doc.setTextColor(...muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(period, margin + 18, 174);
    doc.setFontSize(8.5);
    doc.text('Prepared for personal record-keeping and planning. Not professional advice.', margin + 18, 191);
    doc.setFillColor(...blue);
    doc.roundedRect(pageWidth - margin - 110, 132, 92, 28, 14, 14, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(`${data.length} rows`, pageWidth - margin - 64, 150, { align: 'center' });

    if (keys.length > 0) {
      autoTable(doc, {
        startY: 230,
        margin: { left: margin, right: margin, bottom: 42 },
        head: [keys.map((key) => key.replace(/([a-z])([A-Z])/g, '$1 $2'))],
        body: data.map((row) => keys.map((key) => formatCell(row[key], key))),
        theme: 'plain',
        styles: { font: 'helvetica', fontSize: 9, textColor: [51, 78, 104], cellPadding: { top: 8, right: 8, bottom: 8, left: 8 }, lineColor: [237, 242, 247], lineWidth: 0.5 },
        headStyles: { fillColor: navy, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8, cellPadding: { top: 9, right: 8, bottom: 9, left: 8 } },
        alternateRowStyles: { fillColor: pale },
        columnStyles: keys.reduce<Record<string, { halign?: 'left' | 'right' }>>((styles, key, index) => {
          if (moneyKey(key)) styles[index] = { halign: 'right' };
          return styles;
        }, {}),
        didDrawPage: (hookData) => {
          drawPageChrome(hookData.pageNumber);
        },
      });
    } else {
      doc.setTextColor(...muted);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.text('No rows were available for this export.', margin, 250);
    }

    doc.save(`${reportTitle.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.pdf`);
  };

  const handleExport = async (reportType: 'income-statement' | 'balance-sheet' | 'cash-flow') => {
    try {
      const csv = await exportReportMutation.mutateAsync({
        reportType,
        periodId: effectivePeriodId ? parseInt(effectivePeriodId) : undefined,
      });

      // Download CSV
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${reportType}-${Date.now()}.csv`;
      a.click();
    } catch (err) {
      alert('Export failed: ' + (err as Error).message);
    }
  };

  return (
    <RequireAuth>
      <PageContainer>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <PageHeader
            subtext="Analytics & insights"
            title="Financial Reports"
            description="A clear view of your income, balances, cash movement, and spending patterns."
          />
          <div className="w-full lg:w-64">
            <label htmlFor="reports-period" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">Reporting period</label>
            <Select
              id="reports-period"
              value={effectivePeriodId}
              onChange={(e) => void navigate({ search: { periodId: e.target.value || undefined, tab: activeTab } } as any)}
              options={[
                { value: '', label: 'All Periods' },
                ...periods.map((p) => ({ value: p.id.toString(), label: p.name })),
              ]}
              className="w-full"
            />
          </div>
        </div>
        {selectedPeriod && selectedPeriod.coverageStatus !== 'complete' && (
          <div role="status" className="flex items-start gap-3 rounded-2xl border border-[var(--color-warning)]/25 bg-[var(--color-warning)]/10 px-4 py-3 text-sm text-[var(--color-text-primary)]">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[var(--color-warning)]/15 text-[var(--color-warning)]"><AlertTriangle className="h-4 w-4" /></span>
            <span className="pt-1"><strong className="font-semibold">{selectedPeriod.coverageStatus} coverage.</strong> {selectedPeriod.coverageReason ?? 'Recorded figures do not establish complete activity for this period; empty totals are not zero activity.'}</span>
          </div>
        )}

        {/* Report Tabs — scroll on small screens */}
        <div className="reports-tabs-scroll sticky top-3 z-20 -mx-2 flex gap-1 overflow-x-auto rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)]/90 p-1.5 shadow-sm backdrop-blur-md sm:gap-1.5">
          <TabButton
            active={activeTab === 'income'}
            onClick={() => void navigate({ search: { periodId: selectedPeriodId ?? undefined, tab: 'income' } } as any)}
            icon={<FileText className="w-4 h-4" />}
            label="Income Statement"
          />
          <TabButton
            active={activeTab === 'balance'}
            onClick={() => void navigate({ search: { periodId: selectedPeriodId ?? undefined, tab: 'balance' } } as any)}
            icon={<Scale className="w-4 h-4" />}
            label="Balance Sheet"
          />
          <TabButton
            active={activeTab === 'cashflow'}
            onClick={() => void navigate({ search: { periodId: selectedPeriodId ?? undefined, tab: 'cashflow' } } as any)}
            icon={<ArrowRightLeft className="w-4 h-4" />}
            label="Cash Flow"
          />
          <TabButton
            active={activeTab === 'spending'}
            onClick={() => void navigate({ search: { periodId: selectedPeriodId ?? undefined, tab: 'spending' } } as any)}
            icon={<PieChart className="w-4 h-4" />}
            label="Spending"
          />
          <TabButton
            active={activeTab === 'trends'}
            onClick={() => void navigate({ search: { periodId: selectedPeriodId ?? undefined, tab: 'trends' } } as any)}
            icon={<TrendingUp className="w-4 h-4" />}
            label="Trends"
          />
        </div>

        {/* Summary Dashboard */}
        {summaryData && effectivePeriodId && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              title="Total Revenue"
              amount={summaryData.totalRevenue}
              icon={<TrendingUp className="w-5 h-5" />}
              color="success"
              previousAmount={summaryData.previousPeriodRevenue}
            />
            <SummaryCard
              title="Total Expenses"
              amount={summaryData.totalExpenses}
              icon={<TrendingDown className="w-5 h-5" />}
              color="danger"
              previousAmount={summaryData.previousPeriodExpenses}
            />
            <SummaryCard
              title="Net Income"
              amount={summaryData.netIncome}
              icon={<Wallet className="w-5 h-5" />}
              color={summaryData.netIncome >= 0 ? 'success' : 'danger'}
            />
            <SummaryCard
              title="Net Worth"
              amount={summaryData.totalAssets - summaryData.totalLiabilities}
              icon={<PiggyBank className="w-5 h-5" />}
              color="accent"
            />
          </div>
        )}

        {/* Report Content */}
        <div className="mt-2">
          {activeTab === 'income' && (
            <IncomeStatementReport
              periodId={effectivePeriodId ? parseInt(effectivePeriodId) : undefined}
              onExport={() => handleExport('income-statement')}
              onExportPDF={handleExportPDF}
            />
          )}
          {activeTab === 'balance' && (
            <BalanceSheetReport 
              periodEndDate={selectedPeriod?.endDate}
              onExport={() => handleExport('balance-sheet')} 
            />
          )}
          {activeTab === 'cashflow' && (
            <CashFlowReport
              periodId={effectivePeriodId ? parseInt(effectivePeriodId) : undefined}
              onExport={() => handleExport('cash-flow')}
            />
          )}
          {activeTab === 'spending' && (
            <SpendingReport periodId={effectivePeriodId ? parseInt(effectivePeriodId) : undefined} />
          )}
          {activeTab === 'trends' && <TrendsReport />}
        </div>
      </PageContainer>
    </RequireAuth>
  );
}

// Summary Card Component
function SummaryCard({
  title,
  amount,
  icon,
  color,
  previousAmount,
}: {
  title: string;
  amount: number;
  icon: React.ReactNode;
  color: 'success' | 'danger' | 'accent';
  previousAmount?: number;
}) {
  const colorClasses = {
    success: 'bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/30',
    danger: 'bg-[var(--color-danger)]/10 text-[var(--color-danger)] border-[var(--color-danger)]/30',
    accent: 'bg-[var(--color-accent)]/10 text-[var(--color-accent)] border-[var(--color-accent)]/30',
  };

  const percentageChange = previousAmount && previousAmount !== 0
    ? ((amount - previousAmount) / previousAmount) * 100
    : null;

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="mb-4 flex items-start justify-between gap-3">
        <span className="pt-1 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--color-muted)]">{title}</span>
        <div className={cn('rounded-xl border p-2.5', colorClasses[color])}>
          {icon}
        </div>
      </div>
      <p className="font-headline text-2xl font-extrabold tracking-tight text-[var(--color-text-primary)]">
        {formatCurrency(amount)}
      </p>
      {percentageChange !== null && (
        <div className={cn(
          'mt-3 flex items-center gap-1 text-xs font-medium',
          percentageChange >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'
        )}>
          {percentageChange >= 0 ? (
            <TrendingUp className="w-3 h-3" />
          ) : (
            <TrendingDown className="w-3 h-3" />
          )}
          <span>{Math.abs(percentageChange).toFixed(1)}% vs last period</span>
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex shrink-0 cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors sm:px-4',
        active
          ? 'bg-[var(--ref-primary-container)] text-white shadow-sm'
          : 'text-[var(--color-muted)] hover:bg-[var(--ref-surface-container-low)] hover:text-[var(--color-text-primary)]'
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// Income Statement Report
function IncomeStatementReport({
  periodId,
  onExport,
  onExportPDF,
}: {
  periodId?: number;
  onExport: () => void;
  onExportPDF: (title: string, data: any[]) => void;
}) {
  const query = useIncomeStatementQuery(periodId);
  const data = query.data ?? null;
  const isLoading = query.isPending && !query.data;
  const error = query.error ? 'Failed to load income statement report' : null;
  const loadData = () => query.refetch();

  const handlePDFExport = () => {
    if (!data) return;
    const exportData = [
      ...data.revenue.map(r => ({ Type: 'Revenue', Item: r.name, Amount: r.amount })),
      { Type: 'Total', Item: 'Total Revenue', Amount: data.totalRevenue },
      ...data.expenses.map(e => ({ Type: 'Expense', Item: e.name, Amount: e.amount })),
      { Type: 'Total', Item: 'Total Expenses', Amount: data.totalExpenses },
      { Type: 'Net', Item: 'Net Income', Amount: data.netIncome },
    ];
    onExportPDF(`Income Statement - ${data.periodName || 'All Periods'}`, exportData);
  };

  if (isLoading) return <CardSkeleton className="h-96" />;
  if (error) return (
    <Card className="p-8 text-center">
      <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-[var(--color-danger)]" />
      <p className="text-[var(--color-danger)] mb-4">{error}</p>
      <Button variant="secondary" className="rounded-full" onClick={loadData}>
        <RefreshCw className="w-4 h-4 mr-2" />
        Retry
      </Button>
    </Card>
  );
  if (!data || (data.revenue.length === 0 && data.expenses.length === 0)) return (
    <Card className="p-8 text-center">
      <FileText className="w-12 h-12 mx-auto mb-4 text-[var(--color-muted)]" />
      <p className="text-[var(--color-text-secondary)] mb-4">No income statement data available for this period</p>
      <Link to="/transactions">
        <Button className="rounded-full">
          <Plus className="w-4 h-4 mr-2" />
          Add Transaction
        </Button>
      </Link>
    </Card>
  );

  return (
    <Card
      className="overflow-hidden rounded-3xl [&>div:first-child]:bg-[var(--ref-surface-container-low)]/45 [&>div:first-child]:p-5 sm:[&>div:first-child]:p-6 [&>div:last-child]:p-5 sm:[&>div:last-child]:p-6"
      title={`Income Statement - ${data.periodName || 'All Periods'}`}
      action={
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" className="rounded-full" onClick={handlePDFExport}>
            <FileDown className="w-4 h-4 mr-2" />
            PDF
          </Button>
          <Button variant="secondary" size="sm" className="rounded-full" onClick={onExport}>
            <Download className="w-4 h-4 mr-2" />
            CSV
          </Button>
        </div>
      }
    >
      <div className="space-y-8 text-sm">
        {/* Revenue Section */}
        <div>
          <h3 className="mb-3 border-b border-[var(--color-border)] pb-2 text-sm font-bold uppercase tracking-[0.12em] text-[var(--color-muted)]">
            Revenue
          </h3>
          {data.revenue.map((item, i) => (
            <div
              key={i}
              className={cn(
                'flex items-center justify-between gap-4 border-b border-[var(--color-border)]/70 py-2.5 last:border-0',
                item.level === 0 ? 'font-medium text-[var(--color-text-primary)]' : 'pl-6 text-[var(--color-text-secondary)]'
              )}
            >
              <span>{item.name}</span>
              <span className="font-mono">{formatCurrency(item.amount)}</span>
            </div>
          ))}
          <div className="mt-3 flex justify-between border-t border-[var(--color-border)] pt-3 font-bold">
            <span>Total Revenue</span>
            <span className="font-mono text-[var(--color-success)]">
              {formatCurrency(data.totalRevenue)}
            </span>
          </div>
        </div>

        {/* Expenses Section */}
        <div>
          <h3 className="mb-3 border-b border-[var(--color-border)] pb-2 text-sm font-bold uppercase tracking-[0.12em] text-[var(--color-muted)]">
            Expenses
          </h3>
          {data.expenses.map((item, i) => (
            <div
              key={i}
              className={cn(
                'flex items-center justify-between gap-4 border-b border-[var(--color-border)]/70 py-2.5 last:border-0',
                item.level === 0 ? 'font-medium text-[var(--color-text-primary)]' : 'pl-6 text-[var(--color-text-secondary)]'
              )}
            >
              <span>{item.name}</span>
              <span className="font-mono">{formatCurrency(item.amount)}</span>
            </div>
          ))}
          <div className="mt-3 flex justify-between border-t border-[var(--color-border)] pt-3 font-bold">
            <span>Total Expenses</span>
            <span className="font-mono text-[var(--color-danger)]">
              {formatCurrency(data.totalExpenses)}
            </span>
          </div>
        </div>

        {/* Net Income */}
        <div className="flex justify-between rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-4 py-4 text-base font-bold">
          <span>Net Income</span>
          <span
            className={cn(
              'font-mono',
              data.netIncome >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'
            )}
          >
            {data.netIncome >= 0 ? '+' : ''}
            {formatCurrency(data.netIncome)}
          </span>
        </div>
      </div>
    </Card>
  );
}

// Balance Sheet Report
function BalanceSheetReport({ 
  periodEndDate,
  onExport 
}: { 
  periodEndDate?: number;
  onExport: () => void;
}) {
  const asOfDate = periodEndDate == null ? undefined : inclusivePeriodEnd(periodEndDate);
  const query = useBalanceSheetQuery(asOfDate);
  const data = query.data ?? null;
  const isLoading = query.isPending && !query.data;
  const error = query.error ? 'Failed to load balance sheet report' : null;
  const loadData = () => query.refetch();

  if (isLoading) return <CardSkeleton className="h-96" />;
  if (error) return (
    <Card className="p-8 text-center">
      <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-[var(--color-danger)]" />
      <p className="text-[var(--color-danger)] mb-4">{error}</p>
      <Button variant="secondary" className="rounded-full" onClick={loadData}>
        <RefreshCw className="w-4 h-4 mr-2" />
        Retry
      </Button>
    </Card>
  );
  if (!data) return (
    <Card className="p-8 text-center">
      <p className="text-[var(--color-text-secondary)] mb-4">No data available</p>
      <Link to="/transactions">
        <Button className="rounded-full">
          <Plus className="w-4 h-4 mr-2" />
          Add Transaction
        </Button>
      </Link>
    </Card>
  );

  const Section = ({
    title,
    items,
    total,
    color,
    icon,
  }: {
    title: string;
    items: typeof data.assets;
    total: number;
    color: string;
    icon: React.ReactNode;
  }) => (
    <div className="mb-8 last:mb-0">
      <h3 className="mb-3 flex items-center gap-2 border-b border-[var(--color-border)] pb-2 text-sm font-bold uppercase tracking-[0.12em] text-[var(--color-muted)]">
        {icon}
        {title}
      </h3>
      {items.map((item, i) => (
        <div
          key={i}
          className={cn(
            'flex items-center justify-between gap-4 border-b border-[var(--color-border)]/70 py-2.5 last:border-0',
            item.level === 0 ? 'font-medium text-[var(--color-text-primary)]' : 'pl-6 text-[var(--color-text-secondary)]'
          )}
        >
          <span>
            <span className="text-xs text-[var(--color-muted)] mr-2">{item.code}</span>
            {item.name}
          </span>
          <span className="font-mono">{formatCurrency(item.balance)}</span>
        </div>
      ))}
      <div className={cn('mt-3 flex justify-between border-t border-[var(--color-border)] pt-3 font-bold', color)}>
        <span>Total {title}</span>
        <span className="font-mono">{formatCurrency(total)}</span>
      </div>
    </div>
  );

  return (
    <Card
      className="overflow-hidden rounded-3xl [&>div:first-child]:bg-[var(--ref-surface-container-low)]/45 [&>div:first-child]:p-5 sm:[&>div:first-child]:p-6 [&>div:last-child]:p-5 sm:[&>div:last-child]:p-6"
      title={`Balance Sheet - As of ${data.asOfDate}`}
      action={
        <Button variant="secondary" size="sm" className="rounded-full" onClick={onExport}>
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
      }
    >
      <Section title="Assets" items={data.assets} total={data.totalAssets} color="text-[var(--color-success)]" icon={<Wallet className="w-5 h-5" />} />
      <Section title="Liabilities" items={data.liabilities} total={data.totalLiabilities} color="text-[var(--color-danger)]" icon={<ArrowRightLeft className="w-5 h-5" />} />
      <Section title="Equity" items={data.equity} total={data.totalEquity} color="text-[var(--color-accent)]" icon={<Scale className="w-5 h-5" />} />

      {/* Balance Check */}
      <div className="flex justify-between rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-4 py-4 text-base font-bold">
        <span>Total Liabilities + Equity</span>
        <span className="font-mono">
          {formatCurrency(data.totalLiabilities + data.totalEquity)}
        </span>
      </div>
      {data.totalAssets === data.totalLiabilities + data.totalEquity ? (
        <p className="text-sm text-[var(--color-success)] text-center">✓ Balanced</p>
      ) : (
        <p className="text-sm text-[var(--color-danger)] text-center">
          ⚠ Imbalance: {formatCurrency(data.totalAssets - (data.totalLiabilities + data.totalEquity))}
        </p>
      )}
    </Card>
  );
}

// Cash Flow Report
function CashFlowReport({
  periodId,
  onExport,
}: {
  periodId?: number;
  onExport: () => void;
}) {
  const [expandedSections, setExpandedSections] = useState<{
    operating: boolean;
    investing: boolean;
    financing: boolean;
  }>({ operating: false, investing: false, financing: false });
  const query = useCashFlowQuery(periodId);
  const data = query.data ?? null;
  const isLoading = query.isPending && !query.data;
  const error = query.error ? 'Failed to load cash flow report' : null;
  const loadData = () => query.refetch();

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  if (isLoading) return <CardSkeleton className="h-96" />;
  if (error) return (
    <Card className="p-8 text-center">
      <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-[var(--color-danger)]" />
      <p className="text-[var(--color-danger)] mb-4">{error}</p>
      <Button variant="secondary" className="rounded-full" onClick={loadData}>
        <RefreshCw className="w-4 h-4 mr-2" />
        Retry
      </Button>
    </Card>
  );
  if (!data) return (
    <Card className="p-8 text-center">
      <ArrowRightLeft className="w-12 h-12 mx-auto mb-4 text-[var(--color-muted)]" />
      <p className="text-[var(--color-text-secondary)] mb-4">No cash flow data available for this period</p>
      <Link to="/transactions">
        <Button className="rounded-full">
          <Plus className="w-4 h-4 mr-2" />
          Add Transaction
        </Button>
      </Link>
    </Card>
  );

  const Section = ({
    title,
    items,
    total,
    sectionKey,
  }: {
    title: string;
    items: typeof data.operating;
    total: number;
    sectionKey: keyof typeof expandedSections;
  }) => {
    const isExpanded = expandedSections[sectionKey];
    const displayItems = isExpanded ? items : items.slice(0, 5);
    const hasMore = items.length > 5;

    return (
      <div className="mb-8 last:mb-0">
        <h3 className="mb-2 border-b border-[var(--color-border)] pb-2 text-sm font-bold uppercase tracking-[0.12em] text-[var(--color-muted)]">{title}</h3>
        {displayItems.map((item, i) => (
          <div key={i} className="flex items-center justify-between gap-4 border-b border-[var(--color-border)]/70 py-2.5 text-sm last:border-0">
            <span className="flex min-w-0 max-w-[70%] items-center gap-2 truncate"><span className="truncate">{item.description}</span><span className="shrink-0 rounded bg-[var(--ref-surface-container-low)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--ref-on-surface-variant)]">{item.classificationSource === 'explicit' ? 'classified' : 'legacy inference'}</span></span>
            <span className={cn('font-mono', item.amount >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]')}>
              {item.amount >= 0 ? '+' : ''}
              {formatCurrency(item.amount)}
            </span>
          </div>
        ))}
        {hasMore && (
          <button
            onClick={() => toggleSection(sectionKey)}
            className="cursor-pointer flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline mt-2 ml-4"
          >
            {isExpanded ? (
              <>
                <ChevronUp className="w-3 h-3" />
                Show less
              </>
            ) : (
              <>
                <ChevronDown className="w-3 h-3" />
                + {items.length - 5} more items
              </>
            )}
          </button>
        )}
        <div className="mt-3 flex justify-between border-t border-[var(--color-border)] pt-3 text-sm font-bold">
          <span>Net {title}</span>
          <span className={cn('font-mono', total >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]')}>
            {total >= 0 ? '+' : ''}
            {formatCurrency(total)}
          </span>
        </div>
      </div>
    );
  };

  return (
    <Card
      className="overflow-hidden rounded-3xl [&>div:first-child]:bg-[var(--ref-surface-container-low)]/45 [&>div:first-child]:p-5 sm:[&>div:first-child]:p-6 [&>div:last-child]:p-5 sm:[&>div:last-child]:p-6"
      title="Cash Flow Statement"
      action={
        <Button variant="secondary" size="sm" className="rounded-full" onClick={onExport}>
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
      }
    >
      <Section title="Operating Activities" items={data.operating} total={data.netOperating} sectionKey="operating" />
      <Section title="Investing Activities" items={data.investing} total={data.netInvesting} sectionKey="investing" />
      <Section title="Financing Activities" items={data.financing} total={data.netFinancing} sectionKey="financing" />

      {data.coverage && !data.coverage.isComparable && (
        <div className="mb-4 rounded-md border border-[var(--color-warning)] bg-[var(--color-warning)]/10 p-3 text-xs text-[var(--ref-on-surface)]">
          {data.coverage.warnings.join(' ')}
        </div>
      )}

      <div className="space-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] p-4">
        <div className="flex justify-between font-bold">
          <span>Net Change in Cash</span>
          <span className={cn('font-mono', data.netChange >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]')}>
            {data.netChange >= 0 ? '+' : ''}
            {formatCurrency(data.netChange)}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Beginning Cash</span>
          <span className="font-mono">{formatCurrency(data.beginningCash)}</span>
        </div>
        {data.historicalRecoveryBridge ? (
          <div className="flex justify-between text-[var(--color-warning)]" title="Not operating, investing, or financing cash flow">
            <span>Historical recovery bridge</span>
            <span className="font-mono">{data.historicalRecoveryBridge > 0 ? '+' : ''}{formatCurrency(data.historicalRecoveryBridge)}</span>
          </div>
        ) : null}
        <div className="flex justify-between border-t border-[var(--color-border)] pt-3 text-base font-bold">
          <span>Ending Cash</span>
          <span className="font-mono">{formatCurrency(data.endingCash)}</span>
        </div>
      </div>
    </Card>
  );
}

// Spending Report
function SpendingReport({ periodId }: { periodId?: number }) {
  const query = useSpendingQuery(periodId);
  const data = query.data?.report ?? null;
  const categories = query.data?.categories ?? [];
  const isLoading = query.isPending && !query.data;
  const error = query.error ? 'Failed to load spending report' : null;
  const loadData = () => query.refetch();

  if (isLoading) return <CardSkeleton className="h-96" />;
  if (error) return (
    <Card className="p-8 text-center">
      <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-[var(--color-danger)]" />
      <p className="text-[var(--color-danger)] mb-4">{error}</p>
      <Button variant="secondary" className="rounded-full" onClick={loadData}>
        <RefreshCw className="w-4 h-4 mr-2" />
        Retry
      </Button>
    </Card>
  );
  if (!data || data.breakdown.length === 0) {
    return (
      <Card className="p-8 text-center">
        <PieChart className="w-12 h-12 mx-auto mb-4 text-[var(--color-muted)]" />
        <p className="text-[var(--color-text-secondary)] mb-4">{data?.coverage && !data.coverage.isComparable ? 'Spending coverage is incomplete; no recorded rows does not mean zero activity.' : 'No spending data available for this period'}</p>
        {data?.coverage && !data.coverage.isComparable && <p className="mb-4 text-xs text-[var(--color-warning)]">{data.coverage.warnings.join(' ')}</p>}
        <Link to="/transactions">
        <Button className="rounded-full">
            <Plus className="w-4 h-4 mr-2" />
            Add Expense
          </Button>
        </Link>
      </Card>
    );
  }

  const visibleBreakdown = data.breakdown.slice(0, 7);
  const omitted = data.breakdown.slice(7);
  const chartData = visibleBreakdown.map((item) => {
    const cat = categories.find((c) => c.name === item.category);
    return {
      name: item.category,
      value: item.amount,
      percentage: item.percentage,
      color: cat?.color || '#737785',
    };
  });
  if (omitted.length > 0) {
    const value = omitted.reduce((sum, item) => sum + item.amount, 0);
    chartData.push({
      name: `Other (${omitted.length})`,
      value,
      percentage: data.total > 0 ? (value / data.total) * 100 : 0,
      color: '#9ca3af',
    });
  }

  return (
    <Card className="overflow-hidden rounded-3xl [&>div:first-child]:bg-[var(--ref-surface-container-low)]/45 [&>div:first-child]:p-5 sm:[&>div:first-child]:p-6 [&>div:last-child]:p-5 sm:[&>div:last-child]:p-6" title={`Spending Breakdown - Total: ${formatCurrency(data.total)}`}>
      {data.coverage && !data.coverage.isComparable && <div className="mb-4 rounded-md border border-[var(--color-warning)] bg-[var(--color-warning)]/10 p-3 text-xs text-[var(--ref-on-surface)]">{data.coverage.warnings.join(' ')}</div>}
      <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-[minmax(16rem,0.9fr)_minmax(0,1.1fr)]">
        {/* Pie Chart */}
        <div className="relative h-72 sm:h-80">
          <ResponsiveContainer width="100%" height="100%">
            <RePieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                paddingAngle={2}
                dataKey="value"
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} stroke="var(--color-surface)" strokeWidth={3} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload as typeof chartData[0];
                    return (
                      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-lg">
                        <p className="text-xs font-semibold text-[var(--color-muted)]">{data.name}</p>
                        <p className="mt-1 font-mono text-sm font-bold">{formatCurrency(data.value)}</p>
                        <p className="mt-0.5 text-xs text-[var(--color-muted)]">{data.percentage.toFixed(1)}%</p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
            </RePieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">Period total</span>
            <span className="mt-1 font-headline text-lg font-extrabold tracking-tight text-[var(--color-text-primary)]">{formatCurrency(data.total)}</span>
          </div>
        </div>

        {/* Legend */}
        <div className="divide-y divide-[var(--color-border)]">
          {chartData.map((item, i) => (
            <div key={i} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <div className="flex items-center gap-2">
                <div
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                <span className="truncate text-sm font-medium">{item.name}</span>
              </div>
              <div className="text-right">
                <span className="font-mono text-sm font-semibold">{formatCurrency(item.value)}</span>
                <span className="ml-2 text-xs text-[var(--color-muted)]">
                  {item.percentage.toFixed(1)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// Trends Report
function TrendsReport() {
  const query = useTrendsQuery(6);
  const data = query.data ?? null;
  const isLoading = query.isPending && !query.data;

  if (isLoading) return <CardSkeleton className="h-80" />;
  if (!data || data.length === 0) {
    return (
      <Card className="p-8 text-center">
        <TrendingUp className="w-12 h-12 mx-auto mb-4 text-[var(--color-muted)]" />
        <p className="text-[var(--color-text-secondary)] mb-4">No trend data available</p>
        <p className="text-sm text-[var(--color-muted)]">Add transactions across multiple periods to see trends</p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden rounded-3xl [&>div:first-child]:bg-[var(--ref-surface-container-low)]/45 [&>div:first-child]:p-5 sm:[&>div:first-child]:p-6 [&>div:last-child]:p-5 sm:[&>div:last-child]:p-6" title="Trend Analysis - Last 6 Periods">
      {data.some((period) => period.coverage && !period.coverage.isComparable) && <div className="mb-4 rounded-md border border-[var(--color-warning)] bg-[var(--color-warning)]/10 p-3 text-xs text-[var(--ref-on-surface)]">Some trend periods have incomplete coverage. Comparisons and averages should not treat those periods as zero activity.</div>}
      <div className="h-80 sm:h-96">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 8, left: 8, bottom: 4 }} barCategoryGap="22%">
            <CartesianGrid strokeDasharray="4 4" stroke="var(--color-border)" vertical={false} />
            <XAxis
              dataKey="periodName"
              tick={{ fontSize: 11, fontFamily: 'Inter' }}
              tickLine={false}
              axisLine={false}
              stroke="var(--color-muted)"
            />
            <YAxis
              tick={{ fontSize: 11, fontFamily: 'Inter' }}
              tickLine={false}
              axisLine={false}
              stroke="var(--color-muted)"
              tickFormatter={(value) => `Rp ${(value / 1000000).toFixed(0)}M`}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-lg">
                      <p className="text-xs font-semibold text-[var(--color-muted)]">{label}</p>
                      {payload.map((entry, index) => (
                        <p key={index} className="mt-1 text-sm font-semibold" style={{ color: entry.color }}>
                          {entry.name}: {formatCurrency(entry.value as number)}
                        </p>
                      ))}
                    </div>
                  );
                }
                return null;
              }}
            />
            <Legend wrapperStyle={{ paddingTop: 16, fontSize: 12 }} iconType="circle" />
            <Bar dataKey="revenue" name="Revenue" fill="var(--color-success)" radius={[6, 6, 0, 0]} />
            <Bar dataKey="expenses" name="Expenses" fill="var(--color-danger)" radius={[6, 6, 0, 0]} />
            <Bar dataKey="netIncome" name="Net Income" fill="var(--ref-primary)" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
