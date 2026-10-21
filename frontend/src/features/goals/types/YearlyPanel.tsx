import type { ReactNode } from 'react';
import { useBalanceVisibility } from '../../../hooks/useBalanceVisibility';
import { Field, MoneyField } from '../../savings/fields';
import { Section } from '../../subscriptions/PageParts';
import { Actions, Figure, Sources } from './PanelParts';
import { plateRenewalDue, STNK_YEARS, THR_DAYS_BEFORE, yearlyMonthly } from './type-math';

const date = (time: number) => new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * A bill that comes every year (vehicle tax, insurance, Lebaran): what it took last year, what to
 * put in a month for it, and for a vehicle the year its plate and STNK renew; for Lebaran, when THR
 * comes and a way to put it in.
 */
export function YearlyPanel({ kind, lastYear, lastPaidAt, onLastYear, held, dueAt, now, plateUntil, monthly, onUseMonthly, onPutInThr, actions }: {
  kind: 'vehicle-tax' | 'insurance' | 'lebaran';
  lastYear: number;
  lastPaidAt: number | null;
  onLastYear: (value: number) => void;
  held: number;
  dueAt: number | null;
  now: number;
  /** The year a vehicle's plate and STNK run until. */
  plateUntil: number | null;
  /** What the goal puts in each month now. */
  monthly: number;
  onUseMonthly?: (amount: number) => void;
  onPutInThr?: () => void;
  actions?: ReactNode;
}) {
  const { formatAmount } = useBalanceVisibility();
  const plan = yearlyMonthly(lastYear, held, dueAt, now);
  const renews = kind === 'vehicle-tax' && plateRenewalDue(plateUntil, dueAt);
  const thrBy = kind === 'lebaran' && dueAt !== null ? dueAt - THR_DAYS_BEFORE * 86_400_000 : null;

  return (
    <Section title={kind === 'lebaran' ? 'This Lebaran' : 'This year’s bill'}>
      <div className="@container px-4 py-4 sm:px-5">
        <div className="settings-compact grid grid-cols-1 items-end gap-4 @md:grid-cols-2">
          <Field label="Last year it took" htmlFor="yearly-last" hint={lastPaidAt ? `Paid ${date(lastPaidAt)}; filled in from what came out of the goal` : 'Filled in when you mark it paid; or type it'}>
            <MoneyField id="yearly-last" value={lastYear} onChange={onLastYear} />
          </Field>
          <Figure label="Due" value={dueAt ? date(dueAt) : 'Set a date'} hint={dueAt ? `You’re reminded a month before` : 'Give the goal its month'} />
        </div>
        {lastYear > 0 && (
          <div className="mt-4 grid grid-cols-1 gap-3 @md:grid-cols-2">
            <div className="rounded-xl bg-[var(--ref-surface-container-low)] px-3 py-2.5">
              <p className="text-sm text-[var(--ref-on-surface)]">A twelfth of last year: <span className="font-semibold tabular-nums">{formatAmount(plan.twelfth)}</span> a month</p>
              {onUseMonthly && plan.twelfth !== monthly && <button type="button" onClick={() => onUseMonthly(plan.twelfth)} className="mt-1 text-xs font-semibold text-[var(--ref-primary)] hover:underline">Put this in each month</button>}
            </div>
            {plan.toDue !== null && (
              <div className="rounded-xl bg-[var(--ref-surface-container-low)] px-3 py-2.5">
                <p className="text-sm text-[var(--ref-on-surface)]">
                  {plan.toDue > 0
                    ? <>To be ready on time: <span className="font-semibold tabular-nums">{formatAmount(plan.toDue)}</span> a month for {plan.months} month{plan.months === 1 ? '' : 's'}</>
                    : <>It already holds what last year took.</>}
                </p>
                {onUseMonthly && plan.toDue > 0 && plan.toDue !== monthly && <button type="button" onClick={() => onUseMonthly(plan.toDue!)} className="mt-1 text-xs font-semibold text-[var(--ref-primary)] hover:underline">Put this in each month</button>}
              </div>
            )}
          </div>
        )}
        {kind === 'vehicle-tax' && (
          <>
            <p className={renews ? 'mt-4 text-sm text-[var(--color-warning)]' : 'mt-4 text-sm text-[var(--ref-on-surface)]'}>
              {renews
                ? <>This year the plate and STNK renew too, which they do every {STNK_YEARS} years: it costs more than the yearly tax, with a new plate and STNK and a check of the vehicle.</>
                : <>The STNK and plate last {STNK_YEARS} years{plateUntil ? `, until ${plateUntil}` : ''}; in between, the tax is paid and the STNK stamped each year.</>}
            </p>
            <Sources keys={['stnk']} className="mt-1" />
          </>
        )}
        {kind === 'lebaran' && (
          <div className="mt-4">
            <p className="text-sm text-[var(--ref-on-surface)]">
              THR has to be paid at the latest {THR_DAYS_BEFORE} days before Lebaran{thrBy ? `, by ${date(thrBy)}` : ''}. When it comes in, put some here; you’re reminded if it goes nowhere.
            </p>
            <Sources keys={['thr']} className="mt-1" />
            {onPutInThr && <button type="button" onClick={onPutInThr} className="mt-2 text-sm font-semibold text-[var(--ref-primary)] hover:underline">Put in my THR</button>}
          </div>
        )}
        {actions && <Actions>{actions}</Actions>}
      </div>
    </Section>
  );
}
