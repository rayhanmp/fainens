import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { useBalanceVisibility } from '../../../hooks/useBalanceVisibility';
import { cn } from '../../../lib/utils';
import { MoneyField } from '../../savings/fields';
import { Section } from '../../subscriptions/PageParts';
import { Sources } from './PanelParts';
import { EMERGENCY_ADVICE, EMERGENCY_FLOOR, emergencyTarget, monthsCovered, type EmergencyData } from './type-math';

const decimal = (value: number) => value.toLocaleString('id-ID', { maximumFractionDigits: 1 });
const label = 'text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--ref-on-surface-variant)]';

/** The month's spending the fund is counted in: your average, or a figure of your own, like just the essentials. */
function BurnSetting({ average, own, onBurn }: { average: number | null; own: number | null; onBurn?: (burn: number | null) => void }) {
  const { formatAmount } = useBalanceVisibility();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(own ?? average ?? 0);
  const used = own ?? average;

  if (editing && onBurn) {
    return (
      <form onSubmit={(event) => { event.preventDefault(); if (draft > 0) { onBurn(draft); setEditing(false); } }} className="settings-compact flex flex-wrap items-center gap-2">
        <div className="w-[170px]"><MoneyField ariaLabel="Spending a month" value={draft} onChange={setDraft} autoFocus /></div>
        <Button type="submit" size="sm" disabled={!draft}>Use</Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
      </form>
    );
  }
  return (
    <div>
      <p className="text-base font-semibold tabular-nums text-[var(--ref-on-surface)]">{used ? <>{formatAmount(used)} <span className="text-sm font-normal text-[var(--ref-on-surface-variant)]">a month</span></> : '—'}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[var(--ref-on-surface-variant)]">
        <span title={average && !own ? 'Every expense you recorded in each salary period, averaged over your last finished periods (up to six).' : undefined}>{own ? 'Your own figure' : average ? 'Your average over your last salary periods' : 'No spending to go by yet'}</span>
        {onBurn && <button type="button" onClick={() => { setDraft(own ?? average ?? 0); setEditing(true); }} className="font-semibold text-[var(--ref-primary)] hover:underline">{own ? 'Change' : 'Use your own'}</button>}
        {onBurn && own && average && <button type="button" onClick={() => onBurn(null)} className="font-semibold text-[var(--ref-primary)] hover:underline">Use the average, {formatAmount(average)}</button>}
      </p>
    </div>
  );
}

/**
 * An emergency fund in months of spending: how many it covers against how many it aims for, one
 * bar a month filled as far as the money reaches, the usual advice for one person or a family, and
 * the target that the months come to. The spending is your average, or a figure of your own, like
 * only what you'd still have to pay if your income stopped.
 */
export function EmergencyPanel({ color, held, target, average, data, onUseTarget, onBurn }: {
  color: string;
  held: number;
  target: number;
  /** Your average spending a month; null before a period has finished. */
  average: number | null;
  data: EmergencyData;
  onUseTarget?: (amount: number) => void;
  onBurn?: (burn: number | null) => void;
}) {
  const { formatAmount } = useBalanceVisibility();
  const spending = data.burn ?? average;
  const covered = monthsCovered(held, spending);
  const reached = covered !== null && (covered > data.months || decimal(covered) === decimal(data.months));
  const extra = covered !== null && covered > data.months && decimal(covered) !== decimal(data.months) ? covered - data.months : 0;
  const blocks = Math.ceil(data.months);
  const advice = EMERGENCY_ADVICE[data.household];
  const suggested = spending ? emergencyTarget(data.months, spending) : null;
  const gap = suggested !== null && target > 0 && Math.abs(suggested - target) / target > 0.05 ? suggested - target : 0;

  return (
    <Section title="Months covered">
      <div className="@container px-4 py-4 sm:px-5">
        <div className="grid grid-cols-1 gap-4 @lg:grid-cols-[minmax(0,1fr)_auto] @lg:items-start">
          <div>
            <p className={label}>Covers</p>
            {covered === null ? (
              <p className="mt-1 text-sm text-[var(--ref-on-surface-variant)]">Set the spending it should cover, or it’s counted once a salary period has finished.</p>
            ) : (
              <>
                <p className="mt-1 flex items-baseline gap-2">
                  <span className={cn('font-headline text-4xl font-black leading-none tabular-nums', covered < EMERGENCY_FLOOR ? 'text-[var(--color-warning)]' : 'text-[var(--ref-on-surface)]')}>{decimal(covered)}</span>
                  <span className="text-base font-semibold text-[var(--ref-on-surface-variant)]">month{decimal(covered) === '1' ? '' : 's'}</span>
                </p>
                <p className="mt-1 text-sm text-[var(--ref-on-surface-variant)]">
                  {extra > 0 ? <>Past the {decimal(data.months)} months it aims for, by {decimal(extra)}</> : reached ? <>All {decimal(data.months)} months it aims for</> : <>Of the {decimal(data.months)} months it aims for</>}
                </p>
              </>
            )}
          </div>
          <div className="@lg:text-right">
            <p className={label}>A month’s spending</p>
            <div className="mt-1"><BurnSetting average={average} own={data.burn} onBurn={onBurn} /></div>
          </div>
        </div>

        {/* One bar a month of what it aims for, filled as far as the money reaches. */}
        {covered !== null && (
          <div className="mt-5">
            <div className="flex items-center gap-1.5" role="img" aria-label={`${decimal(covered)} of ${decimal(data.months)} months covered`}>
              {Array.from({ length: blocks }, (_, index) => {
                const filled = Math.max(0, Math.min(1, covered - index));
                return (
                  <span key={index} className="h-3 flex-1 overflow-hidden rounded-full bg-[var(--ref-surface-container-high)]">
                    <span className="block h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${filled * 100}%`, background: color }} />
                  </span>
                );
              })}
              {extra > 0 && <span className="ml-1 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums text-[var(--color-success)] ring-1 ring-inset ring-[var(--color-success)]/40">+{decimal(extra)}</span>}
            </div>
            {blocks <= 12 && (
              <div className="mt-1.5 flex gap-1.5 text-center text-[11px] tabular-nums text-[var(--ref-on-surface-variant)]" aria-hidden>
                {Array.from({ length: blocks }, (_, index) => <span key={index} className="flex-1">{index + 1}</span>)}
                {extra > 0 && <span className="ml-1 w-[42px] shrink-0" />}
              </div>
            )}
          </div>
        )}

        <div className="mt-5 border-t border-[var(--color-border)] pt-4">
          <p className="text-sm text-[var(--ref-on-surface)]">
            The usual advice is <span className="font-semibold">{advice.min} to {advice.max} months</span> {data.household === 'single' ? 'on your own' : 'with a family relying on you'}, kept where it comes out fast, like a savings account.
          </p>
          <Sources keys={['emergencyOjk', 'emergencyFamily']} className="mt-1" />
        </div>

        {gap !== 0 && suggested !== null && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--ref-surface-container-low)] px-3 py-2.5">
            <p className="text-sm text-[var(--ref-on-surface)]">
              {decimal(data.months)} months of spending is <span className="font-semibold tabular-nums">{formatAmount(suggested)}</span>, {formatAmount(Math.abs(gap))} {gap > 0 ? 'more' : 'less'} than the target.
            </p>
            {onUseTarget && <Button type="button" size="sm" variant="secondary" onClick={() => onUseTarget(suggested)}>Make it the target</Button>}
          </div>
        )}
      </div>
    </Section>
  );
}
