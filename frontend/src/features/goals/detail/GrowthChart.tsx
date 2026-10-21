import { useMemo, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useBalanceVisibility } from '../../../hooks/useBalanceVisibility';
import { compactRupiah } from '../../savings/plan';
import { InfoHint } from '../../savings/InfoHint';
import { Section } from '../../subscriptions/PageParts';
import { goalGrowth, type GrowthPoint } from '../growth';
import { useGoalAllocationsQuery, type GoalDetail } from '../queries';

const monthYear = (time: number) => new Date(time).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
const day = (time: number) => new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * How the goal is growing: what it held at the end of each month (solid, filled) and where it's
 * headed at its monthly amount and return (dashed), against the target and the needed-by date.
 * Milestones it reached sit on the line as gold dots.
 */
export function GrowthChart({ detail, color }: { detail: GoalDetail; color: string }) {
  const { formatAmount, balancesHidden } = useBalanceVisibility();
  const history = useGoalAllocationsQuery(detail.goal.id);
  const { goal } = detail;
  const [now] = useState(() => Date.now());
  const points = useMemo<GrowthPoint[]>(
    () => goalGrowth((history.data ?? []).map((row) => ({ amount: row.amount, createdAt: row.createdAt })), goal, now),
    [history.data, goal, now],
  );
  const short = (value: number) => (balancesHidden ? '•••' : compactRupiah(value).replace('Rp', ''));
  const last = points.at(-1)?.time ?? now;
  const first = points[0]?.time ?? now;
  const domainEnd = goal.byDate ? Math.max(last, goal.byDate) : last;
  const projecting = points.some((point) => point.held === undefined);
  const gradient = `goal-growth-${goal.id}`;

  return (
    <Section
      title="How it’s growing"
      aside={(
        <div className="flex items-center gap-3 text-[11px] text-[var(--ref-on-surface-variant)]">
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full" style={{ background: color }} aria-hidden />Held</span>
          {projecting && <span className="flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: color }} aria-hidden />{goal.paused ? 'Paused' : `At ${short(goal.monthlyAmount)} a month`}</span>}
          <InfoHint label="About this chart" align="right">The solid line is what the goal held at the end of each month. The dashed line is where it’s headed, adding its monthly amount and what it earns where its money sits. Gold dots are the quarters of the target it reached.</InfoHint>
        </div>
      )}
    >
      <div className="h-[220px] px-2 pb-3 pt-4 sm:h-[260px] sm:px-4">
        {history.isPending ? (
          <div className="h-full animate-pulse rounded-xl bg-[var(--ref-surface-container-low)]" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="2 4" />
              <XAxis
                dataKey="time"
                type="number"
                scale="time"
                domain={[first, domainEnd]}
                tickFormatter={monthYear}
                tick={{ fontSize: 11, fill: 'var(--ref-on-surface-variant)' }}
                tickLine={false}
                axisLine={{ stroke: 'var(--color-border)' }}
                minTickGap={28}
              />
              <YAxis
                width={48}
                domain={[0, 'auto']}
                tickFormatter={short}
                tick={{ fontSize: 11, fill: 'var(--ref-on-surface-variant)' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ stroke: 'var(--ref-outline)', strokeWidth: 1, strokeDasharray: '3 3' }}
                isAnimationActive={false}
                content={({ active, payload }) => {
                  const point = active ? (payload?.[0]?.payload as GrowthPoint | undefined) : undefined;
                  if (!point) return null;
                  const today = point.held !== undefined && point.projected !== undefined;
                  return (
                    <div className="min-w-[180px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-xs shadow-lg">
                      <p className="font-semibold text-[var(--ref-on-surface)]">{today ? 'Today' : new Date(point.time).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
                      <div className="mt-1 flex justify-between gap-4">
                        <span className="text-[var(--ref-on-surface-variant)]">{point.held !== undefined ? 'Held' : 'On track to hold'}</span>
                        <span className="font-semibold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(point.held ?? point.projected ?? 0)}</span>
                      </div>
                      <p className="mt-0.5 text-[11px] tabular-nums text-[var(--ref-on-surface-variant)]">{Math.min(100, Math.round(((point.held ?? point.projected ?? 0) / Math.max(1, goal.targetAmount)) * 100))}% of the target</p>
                    </div>
                  );
                }}
              />
              <ReferenceLine y={goal.targetAmount} ifOverflow="extendDomain" stroke="var(--ref-on-surface-variant)" strokeDasharray="4 4" strokeWidth={1} label={{ value: `Target ${short(goal.targetAmount)}`, position: 'insideTopLeft', fontSize: 11, fill: 'var(--ref-on-surface-variant)' }} />
              {goal.byDate && <ReferenceLine x={goal.byDate} stroke="var(--ref-on-surface-variant)" strokeWidth={1} label={{ value: `Needed ${monthYear(goal.byDate)}`, position: 'insideTopRight', fontSize: 11, fill: 'var(--ref-on-surface-variant)' }} />}
              <Area type="stepAfter" dataKey="held" stroke={color} strokeWidth={2} fill={`url(#${gradient})`} isAnimationActive={false} connectNulls={false} activeDot={{ r: 4, stroke: 'var(--color-surface)', strokeWidth: 2, fill: color }} />
              <Line type="linear" dataKey="projected" stroke={color} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls={false} activeDot={{ r: 4, stroke: 'var(--color-surface)', strokeWidth: 2, fill: color }} />
              {detail.milestones.map((milestone) => (
                <ReferenceDot key={milestone.share} x={Math.max(first, milestone.at)} y={(goal.targetAmount * milestone.share) / 100} r={5} fill="#fbbf24" stroke="var(--color-surface)" strokeWidth={2} ifOverflow="extendDomain">
                  <title>{`${milestone.share === 100 ? 'All there' : `${milestone.share}% there`} on ${day(milestone.at)}`}</title>
                </ReferenceDot>
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </Section>
  );
}
