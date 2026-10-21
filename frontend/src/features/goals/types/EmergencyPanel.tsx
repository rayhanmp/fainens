import { Button } from '../../../components/ui/Button';
import { useBalanceVisibility } from '../../../hooks/useBalanceVisibility';
import { cn } from '../../../lib/utils';
import { Section } from '../../subscriptions/PageParts';
import { Sources } from './PanelParts';
import { EMERGENCY_ADVICE, EMERGENCY_FLOOR, emergencyTarget, monthsCovered, type EmergencyData } from './type-math';

const decimal = (value: number) => value.toLocaleString('id-ID', { maximumFractionDigits: 1 });

/**
 * An emergency fund in months of your spending: one block a month, filled as far as the money goes,
 * the usual advice for one person or a family, and, when your spending has moved, the target that
 * would cover the same months now.
 */
export function EmergencyPanel({ color, held, target, spending, data, onUseTarget }: {
  color: string;
  held: number;
  target: number;
  /** Your average spending a month; null before a period has finished. */
  spending: number | null;
  data: EmergencyData;
  onUseTarget?: (amount: number) => void;
}) {
  const { formatAmount } = useBalanceVisibility();
  const covered = monthsCovered(held, spending);
  const advice = EMERGENCY_ADVICE[data.household];
  const suggested = spending ? emergencyTarget(data.months, spending) : null;
  const moved = suggested !== null && target > 0 && Math.abs(suggested - target) / target > 0.05;

  return (
    <Section title="Months covered">
      <div className="px-4 py-4 sm:px-5">
        {covered === null ? (
          <p className="text-sm text-[var(--ref-on-surface-variant)]">Once a salary period has finished, this counts the fund in months of what you spend.</p>
        ) : (
          <>
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className={cn('font-headline text-3xl font-black tabular-nums', covered < EMERGENCY_FLOOR ? 'text-[var(--color-warning)]' : 'text-[var(--ref-on-surface)]')}>{decimal(covered)}</span>
              <span className="text-sm text-[var(--ref-on-surface-variant)]">of {data.months} months of spending, at {formatAmount(spending!)} a month</span>
            </p>
            {/* One block a month of the target, filled as far as the money reaches. */}
            <div className="mt-3 flex gap-1" role="img" aria-label={`${decimal(covered)} of ${data.months} months covered`}>
              {Array.from({ length: data.months }, (_, index) => {
                const filled = Math.max(0, Math.min(1, covered - index));
                return (
                  <span key={index} className="h-7 flex-1 overflow-hidden rounded-md bg-[var(--ref-surface-container-high)]">
                    <span className="block h-full rounded-md" style={{ width: `${filled * 100}%`, background: color }} />
                  </span>
                );
              })}
            </div>
            <div className="mt-1 flex justify-between text-[11px] tabular-nums text-[var(--ref-on-surface-variant)]"><span>1</span><span>{data.months} months</span></div>
          </>
        )}
        <p className="mt-4 text-sm text-[var(--ref-on-surface)]">
          {data.household === 'single'
            ? <>On your own, <span className="font-semibold">{advice.min} to {advice.max} months</span> of spending is the usual advice.</>
            : <>With a family relying on you, <span className="font-semibold">{advice.min} to {advice.max} months</span> is the usual advice.</>}
          {' '}Keep it where it comes out fast, like a savings account.
        </p>
        <Sources keys={['emergencyOjk', 'emergencyFamily']} className="mt-1" />
        {moved && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--ref-surface-container-low)] px-3 py-2.5 text-sm">
            <span className="text-[var(--ref-on-surface)]">Your spending moved: {data.months} months is now <span className="font-semibold tabular-nums">{formatAmount(suggested!)}</span>.</span>
            {onUseTarget && <Button type="button" size="sm" variant="secondary" onClick={() => onUseTarget(suggested!)}>Make it the target</Button>}
          </div>
        )}
      </div>
    </Section>
  );
}
