import { createFileRoute } from '@tanstack/react-router';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { RequireAuth } from '../lib/auth';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatCurrency, cn } from '../lib/utils';
import {
  Download,
  FileText,
  PieChart,
  TrendingUp,
  Scale,
  ArrowRightLeft,
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
  component: ReportsPage,
} as any);

type ReportTab = 'income' | 'balance' | 'cashflow' | 'spending' | 'trends';

function ReportsPage() {
  const [activeTab, setActiveTab] = useState<ReportTab>('income');
  const [periods, setPeriods] = useState<Array<{ id: number; name: string }>>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');

  useEffect(() => {
    loadPeriods();
  }, []);

  const loadPeriods = async () => {
    try {
      const data = await api.periods.list();
      setPeriods(data);
      if (data.length > 0) {
        setSelectedPeriodId(data[data.length - 1].id.toString());
      }
    } catch (err) {
      console.error('Failed to load periods:', err);
    }
  };

  const handleExport = async (reportType: 'income-statement' | 'balance-sheet' | 'cash-flow') => {
    try {
      const csv = await api.reports.export(
        reportType,
        selectedPeriodId ? parseInt(selectedPeriodId) : undefined
      );

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
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-mono text-3xl font-bold">Financial Reports</h1>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">
              Income statements, balance sheets, and analytics
            </p>
          </div>
          <Select
            value={selectedPeriodId}
            onChange={(e) => setSelectedPeriodId(e.target.value)}
            options={[
              { value: '', label: 'All Periods' },
              ...periods.map((p) => ({ value: p.id.toString(), label: p.name })),
            ]}
            className="w-48"
          />
        </div>

        {/* Report Tabs — scroll on small screens */}
        <div className="reports-tabs-scroll flex gap-1 sm:gap-2 border-b border-[var(--color-border)] overflow-x-auto pb-px">
          <TabButton
            active={activeTab === 'income'}
            onClick={() => setActiveTab('income')}
            icon={<FileText className="w-4 h-4" />}
            label="Income Statement"
          />
          <TabButton
            active={activeTab === 'balance'}
            onClick={() => setActiveTab('balance')}
            icon={<Scale className="w-4 h-4" />}
            label="Balance Sheet"
          />
          <TabButton
            active={activeTab === 'cashflow'}
            onClick={() => setActiveTab('cashflow')}
            icon={<ArrowRightLeft className="w-4 h-4" />}
            label="Cash Flow"
          />
          <TabButton
            active={activeTab === 'spending'}
            onClick={() => setActiveTab('spending')}
            icon={<PieChart className="w-4 h-4" />}
            label="Spending"
          />
          <TabButton
            active={activeTab === 'trends'}
            onClick={() => setActiveTab('trends')}
            icon={<TrendingUp className="w-4 h-4" />}
            label="Trends"
          />
        </div>

        {/* Report Content */}
        <div className="mt-6">
          {activeTab === 'income' && (
            <IncomeStatementReport
              periodId={selectedPeriodId ? parseInt(selectedPeriodId) : undefined}
              onExport={() => handleExport('income-statement')}
            />
          )}
          {activeTab === 'balance' && (
            <BalanceSheetReport onExport={() => handleExport('balance-sheet')} />
          )}
          {activeTab === 'cashflow' && (
            <CashFlowReport
              periodId={selectedPeriodId ? parseInt(selectedPeriodId) : undefined}
              onExport={() => handleExport('cash-flow')}
            />
          )}
          {activeTab === 'spending' && (
            <SpendingReport periodId={selectedPeriodId ? parseInt(selectedPeriodId) : undefined} />
          )}
          {activeTab === 'trends' && <TrendsReport />}
        </div>
      </div>
    </RequireAuth>
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
        'flex shrink-0 items-center gap-2 px-3 sm:px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
        active
          ? 'border-[var(--color-accent)] text-[var(--color-text-primary)]'
          : 'border-transparent text-[var(--color-muted)] hover:text-[var(--color-text-primary)]'
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
}: {
  periodId?: number;
  onExport: () => void;
}) {
  const [data, setData] = useState<{
    revenue: Array<{ name: string; amount: number; level: number }>;
    expenses: Array<{ name: string; amount: number; level: number }>;
    totalRevenue: number;
    totalExpenses: number;
    netIncome: number;
    periodName?: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [periodId]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const report = await api.reports.incomeStatement(periodId);
      setData(report);
    } catch (err) {
      console.error('Failed to load income statement:', err);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) return <Card className="p-8 text-center"><p>Loading...</p></Card>;
  if (!data) return <Card className="p-8 text-center"><p>Failed to load report</p></Card>;

  return (
    <Card
      title={`Income Statement - ${data.periodName || 'All Periods'}`}
      action={
        <Button variant="secondary" size="sm" onClick={onExport}>
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Revenue Section */}
        <div>
          <h3 className="font-mono font-bold text-lg border-b-2 border-[var(--color-border)] pb-2 mb-3">
            Revenue
          </h3>
          {data.revenue.map((item, i) => (
            <div
              key={i}
              className={cn(
                'flex justify-between py-1',
                item.level === 0 ? 'font-medium' : 'pl-6 text-sm'
              )}
            >
              <span>{item.name}</span>
              <span className="font-mono">{formatCurrency(item.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between py-2 font-bold border-t-2 border-[var(--color-border)] mt-2">
            <span>Total Revenue</span>
            <span className="font-mono text-[var(--color-success)]">
              {formatCurrency(data.totalRevenue)}
            </span>
          </div>
        </div>

        {/* Expenses Section */}
        <div>
          <h3 className="font-mono font-bold text-lg border-b-2 border-[var(--color-border)] pb-2 mb-3">
            Expenses
          </h3>
          {data.expenses.map((item, i) => (
            <div
              key={i}
              className={cn(
                'flex justify-between py-1',
                item.level === 0 ? 'font-medium' : 'pl-6 text-sm'
              )}
            >
              <span>{item.name}</span>
              <span className="font-mono">{formatCurrency(item.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between py-2 font-bold border-t-2 border-[var(--color-border)] mt-2">
            <span>Total Expenses</span>
            <span className="font-mono text-[var(--color-danger)]">
              {formatCurrency(data.totalExpenses)}
            </span>
          </div>
        </div>

        {/* Net Income */}
        <div className="flex justify-between py-3 font-bold text-lg border-t-4 border-[var(--color-border)]">
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
function BalanceSheetReport({ onExport }: { onExport: () => void }) {
  const [data, setData] = useState<{
    assets: Array<{ name: string; code: string; balance: number; level: number }>;
    liabilities: Array<{ name: string; code: string; balance: number; level: number }>;
    equity: Array<{ name: string; code: string; balance: number; level: number }>;
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
    asOfDate: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const report = await api.reports.balanceSheet();
      setData(report);
    } catch (err) {
      console.error('Failed to load balance sheet:', err);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) return <Card className="p-8 text-center"><p>Loading...</p></Card>;
  if (!data) return <Card className="p-8 text-center"><p>Failed to load report</p></Card>;

  const Section = ({
    title,
    items,
    total,
    color,
  }: {
    title: string;
    items: typeof data.assets;
    total: number;
    color: string;
  }) => (
    <div className="mb-6">
      <h3 className="font-mono font-bold text-lg border-b-2 border-[var(--color-border)] pb-2 mb-3">
        {title}
      </h3>
      {items.map((item, i) => (
        <div
          key={i}
          className={cn(
            'flex justify-between py-1',
            item.level === 0 ? 'font-medium' : 'pl-6 text-sm'
          )}
        >
          <span>
            <span className="text-xs text-[var(--color-muted)] mr-2">{item.code}</span>
            {item.name}
          </span>
          <span className="font-mono">{formatCurrency(item.balance)}</span>
        </div>
      ))}
      <div className={cn('flex justify-between py-2 font-bold border-t-2 border-[var(--color-border)] mt-2', color)}>
        <span>Total {title}</span>
        <span className="font-mono">{formatCurrency(total)}</span>
      </div>
    </div>
  );

  return (
    <Card
      title={`Balance Sheet - As of ${data.asOfDate}`}
      action={
        <Button variant="secondary" size="sm" onClick={onExport}>
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
      }
    >
      <Section title="Assets" items={data.assets} total={data.totalAssets} color="text-[var(--color-success)]" />
      <Section title="Liabilities" items={data.liabilities} total={data.totalLiabilities} color="text-[var(--color-danger)]" />
      <Section title="Equity" items={data.equity} total={data.totalEquity} color="text-[var(--color-accent)]" />

      {/* Balance Check */}
      <div className="flex justify-between py-3 font-bold text-lg border-t-4 border-[var(--color-border)]">
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
  const [data, setData] = useState<{
    operating: Array<{ description: string; amount: number }>;
    investing: Array<{ description: string; amount: number }>;
    financing: Array<{ description: string; amount: number }>;
    netOperating: number;
    netInvesting: number;
    netFinancing: number;
    netChange: number;
    beginningCash: number;
    endingCash: number;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [periodId]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const report = await api.reports.cashFlow(periodId);
      setData(report);
    } catch (err) {
      console.error('Failed to load cash flow:', err);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) return <Card className="p-8 text-center"><p>Loading...</p></Card>;
  if (!data) return <Card className="p-8 text-center"><p>Failed to load report</p></Card>;

  const Section = ({
    title,
    items,
    total,
  }: {
    title: string;
    items: typeof data.operating;
    total: number;
  }) => (
    <div className="mb-4">
      <h3 className="font-mono font-bold border-b-2 border-[var(--color-border)] pb-2 mb-2">{title}</h3>
      {items.slice(0, 5).map((item, i) => (
        <div key={i} className="flex justify-between py-1 text-sm">
          <span className="truncate max-w-[70%]">{item.description}</span>
          <span className={cn('font-mono', item.amount >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]')}>
            {item.amount >= 0 ? '+' : ''}
            {formatCurrency(item.amount)}
          </span>
        </div>
      ))}
      {items.length > 5 && (
        <p className="text-xs text-[var(--color-muted)] pl-4">+ {items.length - 5} more items</p>
      )}
      <div className="flex justify-between py-2 font-bold border-t border-[var(--color-border)] mt-2">
        <span>Net {title}</span>
        <span className={cn('font-mono', total >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]')}>
          {total >= 0 ? '+' : ''}
          {formatCurrency(total)}
        </span>
      </div>
    </div>
  );

  return (
    <Card
      title="Cash Flow Statement"
      action={
        <Button variant="secondary" size="sm" onClick={onExport}>
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
      }
    >
      <Section title="Operating Activities" items={data.operating} total={data.netOperating} />
      <Section title="Investing Activities" items={data.investing} total={data.netInvesting} />
      <Section title="Financing Activities" items={data.financing} total={data.netFinancing} />

      <div className="border-t-4 border-[var(--color-border)] pt-4 space-y-2">
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
        <div className="flex justify-between font-bold text-lg">
          <span>Ending Cash</span>
          <span className="font-mono">{formatCurrency(data.endingCash)}</span>
        </div>
      </div>
    </Card>
  );
}

// Spending Report
function SpendingReport({ periodId }: { periodId?: number }) {
  const [data, setData] = useState<{
    breakdown: Array<{ category: string; amount: number; percentage: number }>;
    total: number;
  } | null>(null);
  const [categories, setCategories] = useState<Array<{ id: number; name: string; color: string | null }>>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [periodId]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [report, cats] = await Promise.all([
        api.reports.spending(periodId),
        api.categories.list(),
      ]);
      setData(report);
      setCategories(cats);
    } catch (err) {
      console.error('Failed to load spending:', err);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) return <Card className="p-8 text-center"><p>Loading...</p></Card>;
  if (!data || data.breakdown.length === 0) {
    return (
      <Card className="p-8 text-center">
        <PieChart className="w-12 h-12 mx-auto mb-4 text-[var(--color-muted)]" />
        <p>No spending data available for this period</p>
      </Card>
    );
  }

  const chartData = data.breakdown.slice(0, 8).map((item) => {
    const cat = categories.find((c) => c.name === item.category);
    return {
      name: item.category,
      value: item.amount,
      percentage: item.percentage,
      color: cat?.color || '#737785',
    };
  });

  return (
    <Card title={`Spending Breakdown - Total: ${formatCurrency(data.total)}`}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Pie Chart */}
        <div className="h-64">
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
                  <Cell key={`cell-${index}`} fill={entry.color} stroke="#1A1A1A" strokeWidth={2} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload as typeof chartData[0];
                    return (
                      <div className="bg-white border-2 border-[var(--color-border)] p-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)]">
                        <p className="font-mono text-sm font-bold">{data.name}</p>
                        <p className="font-mono">{formatCurrency(data.value)}</p>
                        <p className="text-xs text-[var(--color-muted)]">{data.percentage.toFixed(1)}%</p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
            </RePieChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="space-y-2">
          {chartData.map((item, i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="w-4 h-4 border-2 border-[var(--color-border)]"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-sm">{item.name}</span>
              </div>
              <div className="text-right">
                <span className="font-mono text-sm">{formatCurrency(item.value)}</span>
                <span className="text-xs text-[var(--color-muted)] ml-2">
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
  const [data, setData] = useState<Array<{
    periodName: string;
    revenue: number;
    expenses: number;
    netIncome: number;
  }> | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const report = await api.reports.trends(6);
      setData(report);
    } catch (err) {
      console.error('Failed to load trends:', err);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) return <Card className="p-8 text-center"><p>Loading...</p></Card>;
  if (!data || data.length === 0) {
    return (
      <Card className="p-8 text-center">
        <TrendingUp className="w-12 h-12 mx-auto mb-4 text-[var(--color-muted)]" />
        <p>No trend data available</p>
      </Card>
    );
  }

  return (
    <Card title="Trend Analysis - Last 6 Periods">
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
            <XAxis
              dataKey="periodName"
              tick={{ fontSize: 11, fontFamily: 'Space Mono' }}
              stroke="#1A1A1A"
            />
            <YAxis
              tick={{ fontSize: 11, fontFamily: 'Space Mono' }}
              stroke="#1A1A1A"
              tickFormatter={(value) => `Rp ${(value / 1000000).toFixed(0)}M`}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="bg-white border-2 border-[var(--color-border)] p-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)]">
                      <p className="font-mono text-sm font-bold">{label}</p>
                      {payload.map((entry, index) => (
                        <p key={index} className="text-sm" style={{ color: entry.color }}>
                          {entry.name}: {formatCurrency(entry.value as number)}
                        </p>
                      ))}
                    </div>
                  );
                }
                return null;
              }}
            />
            <Legend />
            <Bar dataKey="revenue" name="Revenue" fill="#5A9E6F" radius={[4, 4, 0, 0]} />
            <Bar dataKey="expenses" name="Expenses" fill="#D94F4F" radius={[4, 4, 0, 0]} />
            <Bar dataKey="netIncome" name="Net Income" fill="#8BA888" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
