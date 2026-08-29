import { useMemo } from 'react';
import {
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Line,
  ComposedChart,
} from 'recharts';
import { Card } from '../ui/Card';
import { formatCurrency } from '../../lib/utils';
import { PieChart } from 'lucide-react';
import { usePeriodSummariesQuery } from '../../features/analytics/queries';

interface PeriodData {
  name: string;
  income: number;
  expenses: number;
  net: number;
  savingsRate: number;
}

export function PeriodSummariesChart() {
  const periodSummariesQuery = usePeriodSummariesQuery();
  const data = useMemo<PeriodData[]>(() => (periodSummariesQuery.data ?? []).map((period) => ({
    name: period.periodName,
    income: period.income,
    expenses: period.expenses,
    net: period.net,
    savingsRate: period.income > 0 ? (period.net / period.income) * 100 : 0,
  })), [periodSummariesQuery.data]);
  const totals = useMemo(() => ({
    income: data.reduce((sum, period) => sum + period.income, 0),
    expenses: data.reduce((sum, period) => sum + period.expenses, 0),
    net: data.reduce((sum, period) => sum + period.net, 0),
  }), [data]);
  const isLoading = periodSummariesQuery.isPending && periodSummariesQuery.data == null;

  const avgSavingsRate = totals.income > 0 ? (totals.net / totals.income) * 100 : 0;

  if (isLoading) {
    return (
      <Card title="Period Summary" className="h-96">
        <div className="h-full flex items-center justify-center">
          <p>Loading chart...</p>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Period Summary" className="h-96">
      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="text-center p-2 bg-[var(--color-success)]/10 border-2 border-[var(--color-border)]">
          <p className="text-xs text-[var(--color-text-secondary)]">Total Income</p>
          <p className="font-mono font-bold text-[var(--color-success)]">
            {formatCurrency(totals.income)}
          </p>
        </div>
        <div className="text-center p-2 bg-[var(--color-danger)]/10 border-2 border-[var(--color-border)]">
          <p className="text-xs text-[var(--color-text-secondary)]">Total Expenses</p>
          <p className="font-mono font-bold text-[var(--color-danger)]">
            {formatCurrency(totals.expenses)}
          </p>
        </div>
        <div className="text-center p-2 bg-[var(--color-accent)]/10 border-2 border-[var(--color-border)]">
          <p className="text-xs text-[var(--color-text-secondary)]">Avg Savings Rate</p>
          <p className="font-mono font-bold">
            {avgSavingsRate.toFixed(1)}%
          </p>
        </div>
      </div>

      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height="65%">
          <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11, fontFamily: 'Space Mono' }}
              stroke="#1A1A1A"
              angle={-45}
              textAnchor="end"
              height={60}
            />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 11, fontFamily: 'Space Mono' }}
              stroke="#1A1A1A"
              tickFormatter={(value) => `Rp ${(value / 1000000).toFixed(0)}M`}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 11, fontFamily: 'Space Mono' }}
              stroke="#1A1A1A"
              tickFormatter={(value) => `${value.toFixed(0)}%`}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="bg-[var(--color-surface)] border-2 border-[var(--color-border)] p-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)]">
                      <p className="font-mono text-sm font-bold mb-2">{label}</p>
                      {payload.map((entry, index) => (
                        <p key={index} className="text-sm" style={{ color: entry.color }}>
                          {entry.name}: {entry.name === 'Savings Rate' 
                            ? `${(entry.value as number).toFixed(1)}%`
                            : formatCurrency(entry.value as number)
                          }
                        </p>
                      ))}
                    </div>
                  );
                }
                return null;
              }}
            />
            <Legend />
            <Bar
              yAxisId="left"
              dataKey="income"
              name="Income"
              fill="#5A9E6F"
              radius={[4, 4, 0, 0]}
            />
            <Bar
              yAxisId="left"
              dataKey="expenses"
              name="Expenses"
              fill="#D94F4F"
              radius={[4, 4, 0, 0]}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="savingsRate"
              name="Savings Rate"
              stroke="#8BA888"
              strokeWidth={2}
              dot={{ fill: '#8BA888', r: 4 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-[65%] flex items-center justify-center text-[var(--color-muted)]">
          <div className="text-center">
            <PieChart className="w-12 h-12 mx-auto mb-2" />
            <p>No period data available</p>
            <p className="text-sm">Create salary periods to see analytics</p>
          </div>
        </div>
      )}
    </Card>
  );
}
