import { useMemo } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn } from '../../lib/utils';
import { compactRupiah, durationLabel, monthDate, type GoalOutlook, type PlanEvent, type PlanRange, type PlanRun } from './plan';
import { potColor } from './pots';

export type ValueMode = 'nominal' | 'real';

export type ComparedPlan = { id: number; name: string; run: PlanRun };

/** Dash patterns that tell compared plans apart without another colour. */
const COMPARE_DASHES = ['6 4', '2 3', '10 4 2 4'];

type Row = {
  month: number;
  putIn: number;
  growth: number;
  total: number;
  band?: [number, number];
  goal?: number;
  [compare: `plan${number}`]: number | undefined;
  /** Each pot's balance, by its place in the plan. */
  [pot: `pot${number}`]: number;
};

function yearStep(years: number): number {
  if (years <= 10) return 1;
  if (years <= 25) return 5;
  return 10;
}

/**
 * How the plan grows: with one pot, what you put in and what growth adds; with several, each pot
 * stacked in its colour. Either way the top edge is the balance. The likely range is a band, saved
 * plans are dashed lines, goals are dots where they're reached, and the selected goal's level is a
 * dotted line drawn on its own pot's layer.
 */
export function ProjectionChart({ run, range, mode, years, compared, outlooks, selectedGoalId, events }: {
  run: PlanRun;
  range: PlanRange | null;
  mode: ValueMode;
  years: number;
  compared: ComparedPlan[];
  outlooks: GoalOutlook[];
  selectedGoalId: string | null;
  /** One-off money in or out, marked where it lands. */
  events: PlanEvent[];
}) {
  const { balancesHidden, formatAmount } = useBalanceVisibility();
  const selected = outlooks.find((outlook) => outlook.goal.id === selectedGoalId) ?? null;
  const months = years * 12;
  const several = run.pots.length > 1;
  const potIndexOf = (potId: string) => Math.max(0, run.pots.findIndex((part) => part.pot.id === potId));
  // The balance of every pot below `index` in the stack, in the chosen money.
  const below = (month: number, index: number, scale: number) => run.pots.slice(0, index).reduce((sum, part) => sum + part.months[month]!.balance, 0) / scale;

  const rows = useMemo(() => run.months.slice(0, months + 1).map((point): Row => {
    const scale = mode === 'real' ? point.deflator : 1;
    const total = point.balance / scale;
    const putIn = Math.min(total, Math.max(0, mode === 'real' ? point.realNetDeposits : point.deposits - point.withdrawals));
    const row = { month: point.month, putIn, growth: total - putIn, total } as Row;
    run.pots.forEach((part, index) => { row[`pot${index}`] = part.months[point.month]!.balance / scale; });
    if (range) row.band = [range.low[point.month]! / scale, range.high[point.month]! / scale];
    // Goals are in today's money; in rupiah-then their level rises with inflation. A goal sits on its pot's layer.
    if (selected) row.goal = below(point.month, potIndexOf(selected.goal.potId), scale) + selected.goal.amount * (mode === 'real' ? 1 : point.deflator);
    for (const plan of compared) {
      const other = plan.run.months[point.month];
      if (other) row[`plan${plan.id}`] = other.balance / (mode === 'real' ? other.deflator : 1);
    }
    return row;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `below` and `potIndexOf` only read `run`.
  }), [run, range, mode, months, selected, compared]);

  const step = yearStep(years);
  const ticks = Array.from({ length: Math.floor(years / step) + 1 }, (_, index) => index * step * 12);
  const reached = outlooks.filter((outlook) => outlook.reach !== null && outlook.reach <= months);
  const now = new Date();

  return (
    <div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-[var(--ref-on-surface-variant)]" aria-label="Legend">
        {several ? run.pots.map((part, index) => (
          <li key={part.pot.id} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: potColor(index), opacity: 0.8 }} aria-hidden />{part.pot.name}</li>
        )) : (
          <>
            <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--color-accent)]/30" aria-hidden />You put in</li>
            <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--color-accent)]/75" aria-hidden />Growth</li>
          </>
        )}
        {range && <li className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm border border-dashed border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10" aria-hidden />Likely range</li>}
        {compared.map((plan, index) => (
          <li key={plan.id} className="flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden><line x1="0" y1="3" x2="18" y2="3" stroke="var(--ref-on-surface-variant)" strokeWidth="1.5" strokeDasharray={COMPARE_DASHES[index % COMPARE_DASHES.length]} /></svg>
            {plan.name}
          </li>
        ))}
      </ul>

      <div className="mt-3 h-[260px] sm:h-[340px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="2 4" />
            <XAxis
              dataKey="month"
              type="number"
              domain={[0, months]}
              ticks={ticks}
              tickFormatter={(month: number) => (month === 0 ? 'Now' : String(monthDate(month, now).getFullYear()))}
              tick={{ fontSize: 11, fill: 'var(--ref-on-surface-variant)' }}
              tickLine={false}
              axisLine={{ stroke: 'var(--color-border)' }}
            />
            <YAxis
              width={52}
              // The axis is plainly rupiah, so ticks drop the "Rp" and stay on one line on phones.
              tickFormatter={(value: number) => (balancesHidden ? '•••' : compactRupiah(value).replace('Rp', ''))}
              tick={{ fontSize: 11, fill: 'var(--ref-on-surface-variant)' }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ stroke: 'var(--ref-outline)', strokeWidth: 1, strokeDasharray: '3 3' }}
              offset={16}
              allowEscapeViewBox={{ x: false, y: true }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                const row = active ? (payload?.[0]?.payload as Row | undefined) : undefined;
                if (!row) return null;
                const date = monthDate(row.month, now);
                return (
                  <div className="min-w-[210px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-xs shadow-lg">
                    <p className="font-semibold text-[var(--ref-on-surface)]">
                      {row.month === 0 ? 'Today' : date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                      <span className="ml-1.5 font-normal text-[var(--ref-on-surface-variant)]">{row.month === 0 ? '' : durationLabel(row.month)}</span>
                    </p>
                    <dl className="mt-1.5 space-y-1">
                      {([
                        { label: 'Balance', value: formatAmount(Math.round(row.total)), strong: true },
                        ...(several ? run.pots.map((part, index) => ({ label: part.pot.name, value: formatAmount(Math.round(row[`pot${index}`])) })) : []),
                        { label: 'You put in', value: formatAmount(Math.round(row.putIn)) },
                        { label: 'Growth', value: formatAmount(Math.round(row.growth)) },
                        ...(row.band ? [{ label: 'Likely range', value: `${balancesHidden ? '•••' : compactRupiah(row.band[0])} – ${balancesHidden ? '•••' : compactRupiah(row.band[1])}` }] : []),
                        ...compared.map((plan) => ({ label: plan.name, value: row[`plan${plan.id}`] === undefined ? '—' : formatAmount(Math.round(row[`plan${plan.id}`]!)) })),
                      ] as Array<{ label: string; value: string; strong?: boolean }>).map((item) => (
                        <div key={item.label} className="flex justify-between gap-4">
                          <dt className="truncate text-[var(--ref-on-surface-variant)]">{item.label}</dt>
                          <dd className={cn('tabular-nums text-[var(--ref-on-surface)]', item.strong && 'font-semibold')}>{item.value}</dd>
                        </div>
                      ))}
                    </dl>
                    {mode === 'real' && <p className="mt-1.5 text-[10px] text-[var(--ref-outline)]">In today’s money</p>}
                  </div>
                );
              }}
            />
            {several ? run.pots.map((part, index) => (
              <Area key={part.pot.id} type="monotone" dataKey={`pot${index}`} stackId="balance" stroke="var(--color-surface)" strokeWidth={2} fill={potColor(index)} fillOpacity={0.7} isAnimationActive={false} activeDot={index === run.pots.length - 1 ? { r: 4, stroke: 'var(--color-surface)', strokeWidth: 2, fill: potColor(index) } : false} />
            )) : (
              <>
                <Area type="monotone" dataKey="putIn" stackId="balance" stroke="var(--color-surface)" strokeWidth={2} fill="var(--color-accent)" fillOpacity={0.28} isAnimationActive={false} activeDot={false} />
                <Area type="monotone" dataKey="growth" stackId="balance" stroke="var(--color-accent)" strokeWidth={2} fill="var(--color-accent)" fillOpacity={0.75} isAnimationActive={false} activeDot={{ r: 4, stroke: 'var(--color-surface)', strokeWidth: 2, fill: 'var(--color-accent)' }} />
              </>
            )}
            {range && <Area type="monotone" dataKey="band" stroke="var(--color-accent)" strokeOpacity={0.55} strokeDasharray="4 3" strokeWidth={1} fill="var(--color-accent)" fillOpacity={0.08} isAnimationActive={false} activeDot={false} />}
            {compared.map((plan, index) => (
              <Line key={plan.id} type="monotone" dataKey={`plan${plan.id}`} stroke="var(--ref-on-surface-variant)" strokeWidth={1.5} strokeDasharray={COMPARE_DASHES[index % COMPARE_DASHES.length]} dot={false} activeDot={false} isAnimationActive={false} />
            ))}
            {selected && <Line type="linear" dataKey="goal" stroke="var(--ref-on-surface)" strokeWidth={1.5} strokeDasharray="1 4" strokeLinecap="round" dot={false} activeDot={false} isAnimationActive={false} />}
            {/* The selected goal is named at the end of its line, so picking one never reflows the legend. */}
            {selected && rows[months]?.goal !== undefined && (
              <ReferenceDot
                x={months}
                y={rows[months]!.goal!}
                r={0}
                ifOverflow="visible"
                label={{ value: selected.goal.name, position: 'left', offset: 4, dy: -9, fill: 'var(--ref-on-surface)', fontSize: 11, fontWeight: 600 }}
              />
            )}
            {events.filter((event) => !event.yearly && event.month <= months).map((event) => (
              <ReferenceLine
                key={event.id}
                x={event.month}
                stroke="var(--ref-outline)"
                strokeDasharray="2 3"
                label={{ value: `${event.amount > 0 ? '+' : '−'} ${event.label || (event.amount > 0 ? 'In' : 'Out')}`, position: 'insideTopLeft', fill: 'var(--ref-on-surface-variant)', fontSize: 10 }}
              />
            ))}
            {reached.map((outlook) => {
              const row = rows[outlook.reach!];
              const point = run.months[outlook.reach!];
              if (!row || !point) return null;
              const isSelected = outlook.goal.id === selectedGoalId;
              const scale = mode === 'real' ? point.deflator : 1;
              // Where the goal's level meets its pot's layer when it's reached (a bought goal's pot drops right after).
              const level = below(row.month, potIndexOf(outlook.goal.potId), scale) + outlook.goal.amount * (mode === 'real' ? 1 : point.deflator);
              return (
                <ReferenceDot
                  key={outlook.goal.id}
                  x={row.month}
                  y={level}
                  r={isSelected ? 6 : 4}
                  fill={isSelected ? 'var(--ref-on-surface)' : 'var(--color-surface)'}
                  stroke={isSelected ? 'var(--color-surface)' : 'var(--ref-on-surface)'}
                  strokeWidth={2}
                  ifOverflow="visible"
                />
              );
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* The same figures as a table, for screen readers. */}
      <div className="sr-only">
      <table>
        <caption>Balance by year{mode === 'real' ? ', in today’s money' : ''}</caption>
        <thead><tr><th>Year</th><th>Balance</th><th>You put in</th><th>Growth</th></tr></thead>
        <tbody>
          {rows.filter((row) => row.month % 12 === 0).map((row) => (
            <tr key={row.month}><td>{monthDate(row.month, now).getFullYear()}</td><td>{formatAmount(Math.round(row.total))}</td><td>{formatAmount(Math.round(row.putIn))}</td><td>{formatAmount(Math.round(row.growth))}</td></tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
