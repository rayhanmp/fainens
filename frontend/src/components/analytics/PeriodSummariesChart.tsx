import { useEffect, useState } from 'react';
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
import { api } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { PieChart } from 'lucide-react';

interface PeriodData {
  name: string;
  income: number;
  expenses: number;
  net: number;
  savingsRate: number;
}

export function PeriodSummariesChart() {
  const [data, setData] = useState<PeriodData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [totals, setTotals] = useState({ income: 0, expenses: 0, net: 0 });

  useEffect(() => {
    loadPeriodData();
  }, []);

  const loadPeriodData = async () => {
    try {
      const summaries = await api.analytics.periodSummaries();
      
      const periodData: PeriodData[] = summaries.map((period) => ({
        name: period.periodName,
        income: period.income,
        expenses: period.expenses,
        net: period.net,
        savingsRate: period.income > 0 ? (period.net / period.income) * 100 : 0,
      }));

      // Calculate totals
      const totalIncome = periodData.reduce((sum, p) => sum + p.income, 0);
      const totalExpenses = periodData.reduce((sum, p) => sum + p.expenses, 0);
      const totalNet = periodData.reduce((sum, p) => sum + p.net, 0);

      setData(periodData);
      setTotals({ income: totalIncome, expenses: totalExpenses, net: totalNet });
    } catch (err) {
      console.error('Failed to load period data:', err);
    } finally {
      setIsLoading(false);
    }
  };

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
                    <div className="bg-white border-2 border-[var(--color-border)] p-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)]">
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
