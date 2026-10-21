import type { ReactNode } from 'react';
import { useBalanceVisibility } from '../../../hooks/useBalanceVisibility';
import { cn } from '../../../lib/utils';
import { Field, MoneyField, PercentField } from '../../savings/fields';
import { Section } from '../../subscriptions/PageParts';
import { Actions, Figure, Sources } from './PanelParts';
import { BPHTB_RATE, BPHTB_UNTAXED, houseCosts, kprFit, type HouseData } from './type-math';

const pct = (value: number) => `${value.toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`;
const jt = (value: number) => `Rp${(value / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} juta`;

/** One cost of buying: its name, an editable share, and what that comes to. */
function CostRow({ label, hint, share, onShare, amount }: { label: string; hint: string; share?: number; onShare?: (value: number) => void; amount: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-[var(--ref-on-surface)]">{label}</p>
        <p className="text-xs text-[var(--ref-on-surface-variant)]">{hint}</p>
      </div>
      {share !== undefined && onShare && <div className="w-[88px] shrink-0"><PercentField ariaLabel={`${label} share`} value={share} min={0} max={10} onChange={onShare} /></div>}
      <span className="w-[120px] shrink-0 text-right text-sm font-semibold tabular-nums text-[var(--ref-on-surface)]">{amount}</span>
    </div>
  );
}

/**
 * A house's down payment and KPR, worked out together: the price, the share paid down, the loan's
 * years and rate give the monthly payment, set against what a bank usually allows from your
 * take-home pay; BPHTB, the notary, the bank's provisi and the appraisal add to what's needed upfront.
 */
export function HousePanel({ value, onChange, salary, actions }: {
  value: HouseData;
  onChange: (patch: Partial<HouseData>) => void;
  /** Your take-home pay; null when salary isn't set up. */
  salary: number | null;
  actions?: ReactNode;
}) {
  const { formatAmount } = useBalanceVisibility();
  const costs = houseCosts(value);
  const fit = kprFit(costs.monthly, salary, value.limit);

  return (
    <Section title="House and KPR">
      <div className="@container px-4 py-4 sm:px-5">
        <div className="settings-compact grid grid-cols-2 gap-3 @xl:grid-cols-5">
          <Field label="Price" htmlFor="house-price" className="col-span-2">
            <MoneyField id="house-price" value={value.price} onChange={(price) => onChange({ price })} />
          </Field>
          <Field label="Down payment" htmlFor="house-dp">
            <PercentField id="house-dp" value={value.dpShare} min={0} max={100} onChange={(dpShare) => onChange({ dpShare })} />
          </Field>
          <Field label="Loan for" htmlFor="house-years">
            <PercentField id="house-years" suffix="years" value={value.years} min={1} max={35} onChange={(years) => onChange({ years: Math.round(years) })} />
          </Field>
          <Field label="Interest a year" htmlFor="house-rate" info="The rate the bank fixes for the loan. Many fix it for the first years and then float it; ask what it becomes after." className="col-span-2 @xl:col-span-1">
            <PercentField id="house-rate" value={value.rate} min={0} max={30} onChange={(rate) => onChange({ rate })} />
          </Field>
        </div>

        {value.price > 0 ? (
          <>
            <div className="mt-5 grid grid-cols-1 gap-4 @lg:grid-cols-3">
              <Figure label="Down payment" value={formatAmount(costs.downPayment)} hint={`${pct(value.dpShare)} of the price`} />
              <Figure label="Needed upfront" value={formatAmount(costs.upfront)} hint="Down payment and the costs below" large />
              <Figure label="KPR a month" value={formatAmount(costs.monthly)} hint={`${jt(costs.loan)} over ${value.years} years at ${pct(value.rate)}`} tone={fit?.over ? 'warn' : 'plain'} />
            </div>

            {/* What the payment takes from your pay, against what banks usually allow. */}
            {fit ? (
              <div className="mt-4">
                <div className="relative h-2.5 overflow-hidden rounded-full bg-[var(--ref-surface-container-high)]" role="img" aria-label={`${Math.round(fit.share)}% of your take-home pay`}>
                  <div className={cn('h-full rounded-full', fit.over ? 'bg-[var(--color-warning)]' : 'bg-[var(--ref-primary)]')} style={{ width: `${Math.min(100, fit.share)}%` }} />
                  <span className="absolute inset-y-0 w-0.5 bg-[var(--ref-on-surface)]" style={{ left: `${value.limit}%` }} aria-hidden />
                </div>
                <p className={cn('mt-2 text-sm', fit.over ? 'text-[var(--color-warning)]' : 'text-[var(--ref-on-surface)]')}>
                  {Math.round(fit.share)}% of your {formatAmount(salary!)} take-home pay.{' '}
                  {fit.over
                    ? <>Banks usually keep it within {value.limit}%, about {formatAmount(fit.allowed)}; a bigger down payment or a longer loan brings it down.</>
                    : <>Within the {value.limit}% banks usually allow.</>}
                </p>
              </div>
            ) : (
              <p className="mt-4 text-sm text-[var(--ref-on-surface-variant)]">Set up your salary in Income & salary to see whether a bank would lend it.</p>
            )}

            <div className="mt-4 divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
              <CostRow label="BPHTB" hint={`Up to ${BPHTB_RATE}% of the price above ${jt(BPHTB_UNTAXED)}; your region sets both`} amount={formatAmount(costs.bphtb)} />
              <CostRow label="Notary, AJB and certificate" hint="Share of the price" share={value.notary} onShare={(notary) => onChange({ notary })} amount={formatAmount(costs.notary)} />
              <CostRow label="Bank provisi and fees" hint="Share of the loan" share={value.provisi} onShare={(provisi) => onChange({ provisi })} amount={formatAmount(costs.provisi)} />
              <CostRow label="Appraisal" hint="Share of the price" share={value.appraisal} onShare={(appraisal) => onChange({ appraisal })} amount={formatAmount(costs.appraisal)} />
            </div>
            <p className="mt-3 text-xs text-[var(--ref-on-surface-variant)]">Until the end of 2026, Bank Indonesia lets banks that qualify lend up to the whole price, so some offer a 0% down payment. The fees are typical; ask your bank and notary for theirs.</p>
            <Sources keys={['kprLimit', 'ltv', 'bphtb']} className="mt-1" />
            {actions && <Actions>{actions}</Actions>}
          </>
        ) : (
          <p className="mt-4 text-sm text-[var(--ref-on-surface-variant)]">Enter the price of a house you’re looking at to work out the down payment, the costs and the monthly KPR.</p>
        )}
      </div>
    </Section>
  );
}
