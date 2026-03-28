import { useEffect, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { Card } from '../ui/Card';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle } from 'lucide-react';

interface MPCData {
  period: string;
  mpc: number; // 0-1
  income: number;
  discretionary: number;
}

export function LifestyleCreepGauge() {
  const [data, setData] = useState<MPCData[]>([]);
  const [currentMPC, setCurrentMPC] = useState(0);
  const [trend, setTrend] = useState<'increasing' | 'stable' | 'decreasing'>('stable');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadMPCData();
  }, []);

  const loadMPCData = async () => {
    try {
      // Get period summaries to calculate MPC
      const summaries = await api.analytics.periodSummaries();
      
      // Calculate MPC for each period
      // MPC = discretionary spending / income
      // discretionary = expenses - fixed costs (we approximate with budget data)
      const mpcData: MPCData[] = summaries.map((period) => {
        const income = period.income;
        const expenses = period.expenses;
        
        // Discretionary = total expenses (this is simplified - could be refined)
        const discretionary = expenses;
        const mpc = income > 0 ? discretionary / income : 0;

        return {
          period: period.periodName,
          mpc: Math.min(mpc, 2), // Cap at 200% for display
          income,
          discretionary,
        };
      });

      setData(mpcData);

      // Calculate current MPC and trend
      if (mpcData.length > 0) {
        const current = mpcData[mpcData.length - 1].mpc;
        setCurrentMPC(current);

        if (mpcData.length > 1) {
          const previous = mpcData[mpcData.length - 2].mpc;
          const diff = current - previous;
          
          if (diff > 0.05) setTrend('increasing');
          else if (diff < -0.05) setTrend('decreasing');
          else setTrend('stable');
        }
      }
    } catch (err) {
      console.error('Failed to load MPC data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Determine status based on MPC
  const getStatus = () => {
    if (currentMPC > 1) return { label: 'CRITICAL', color: 'text-[var(--color-danger)]', bg: 'bg-[var(--color-danger)]/20' };
    if (currentMPC > 0.8) return { label: 'WARNING', color: 'text-[var(--color-warning)]', bg: 'bg-[var(--color-warning)]/20' };
    if (currentMPC > 0.5) return { label: 'MODERATE', color: 'text-[var(--color-warning)]', bg: 'bg-[var(--color-warning)]/10' };
    return { label: 'HEALTHY', color: 'text-[var(--color-success)]', bg: 'bg-[var(--color-success)]/20' };
  };

  const status = getStatus();

  // Gauge arc calculation
  const radius = 80;
  const strokeWidth = 12;
  const normalizedValue = Math.min(currentMPC, 1.5) / 1.5; // Normalize to 0-1.5 range
  const angle = normalizedValue * 180; // 0-180 degrees

  if (isLoading) {
    return (
      <Card title="Lifestyle Creep Index" className="h-96">
        <div className="h-full flex items-center justify-center">
          <p>Loading...</p>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Lifestyle Creep Index" className="h-96">
      <div className="flex flex-col items-center">
        {/* Gauge Display */}
        <div className="relative w-48 h-32 mt-4">
          {/* Background arc */}
          <svg className="w-full h-full" viewBox="0 0 200 120">
            {/* Background track */}
            <path
              d="M 20 100 A 80 80 0 0 1 180 100"
              fill="none"
              stroke="#e5e5e5"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
            {/* Color zones */}
            <path
              d="M 20 100 A 80 80 0 0 1 73 32"
              fill="none"
              stroke="#5A9E6F"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
            <path
              d="M 73 32 A 80 80 0 0 1 127 32"
              fill="none"
              stroke="#D4A843"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
            <path
              d="M 127 32 A 80 80 0 0 1 180 100"
              fill="none"
              stroke="#D94F4F"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
            {/* Value arc */}
            <path
              d={`M 20 100 A ${radius} ${radius} 0 0 1 ${20 + 160 * Math.cos((180 - angle) * Math.PI / 180)} ${100 - 160 * Math.sin(angle * Math.PI / 180)}`}
              fill="none"
              stroke="#1A1A1A"
              strokeWidth={4}
              strokeLinecap="round"
              className="transition-all duration-500"
            />
            {/* Needle */}
            <line
              x1="100"
              y1="100"
              x2={100 + 70 * Math.cos((180 - angle) * Math.PI / 180)}
              y2={100 - 70 * Math.sin(angle * Math.PI / 180)}
              stroke="#1A1A1A"
              strokeWidth={3}
              strokeLinecap="round"
              className="transition-all duration-500"
            />
            {/* Center dot */}
            <circle cx="100" cy="100" r="6" fill="#1A1A1A" />
          </svg>

          {/* Value display */}
          <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 text-center">
            <p className="font-mono text-3xl font-bold">
              {(currentMPC * 100).toFixed(0)}%
            </p>
            <p className="text-xs text-[var(--color-text-secondary)]">MPC (Marginal Propensity to Consume)</p>
          </div>
        </div>

        {/* Status Badge */}
        <div className={cn('mt-4 px-4 py-2 border-2 border-[var(--color-border)]', status.bg)}>
          <div className={cn('flex items-center gap-2 font-mono font-bold', status.color)}>
            {currentMPC > 0.8 ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
            {status.label}
          </div>
        </div>

        {/* Trend indicator */}
        <div className="flex items-center gap-2 mt-2 text-sm">
          <span className="text-[var(--color-text-secondary)]">Trend:</span>
          {trend === 'increasing' && (
            <span className="flex items-center gap-1 text-[var(--color-danger)]">
              <TrendingUp className="w-4 h-4" /> Increasing
            </span>
          )}
          {trend === 'decreasing' && (
            <span className="flex items-center gap-1 text-[var(--color-success)]">
              <TrendingDown className="w-4 h-4" /> Decreasing
            </span>
          )}
          {trend === 'stable' && (
            <span className="text-[var(--color-muted)]">Stable</span>
          )}
        </div>

        {/* Explanation */}
        <p className="text-xs text-[var(--color-text-secondary)] mt-2 text-center px-4">
          MPC shows what % of new income goes to spending. &gt;100% means spending exceeds income growth.
        </p>
      </div>

      {/* MPC Trend Chart */}
      {data.length > 0 && (
        <div className="mt-4 h-24">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" vertical={false} />
              <XAxis
                dataKey="period"
                tick={{ fontSize: 10, fontFamily: 'Space Mono' }}
                stroke="#1A1A1A"
              />
              <YAxis
                tick={{ fontSize: 10, fontFamily: 'Space Mono' }}
                stroke="#1A1A1A"
                domain={[0, 1.5]}
                tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    return (
                      <div className="bg-[var(--color-surface)] border-2 border-[var(--color-border)] p-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)]">
                        <p className="font-mono text-xs font-bold">{label}</p>
                        <p className="font-mono text-sm">
                          MPC: {((payload[0].value as number) * 100).toFixed(1)}%
                        </p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <ReferenceLine y={1} stroke="#D94F4F" strokeDasharray="3 3" />
              <Bar
                dataKey="mpc"
                fill="#8BA888"
                radius={[2, 2, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
