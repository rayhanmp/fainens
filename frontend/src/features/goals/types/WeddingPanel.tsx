import type { ReactNode } from 'react';
import { useBalanceVisibility } from '../../../hooks/useBalanceVisibility';
import { cn } from '../../../lib/utils';
import { Field, MoneyField, PercentField } from '../../savings/fields';
import { Section } from '../../subscriptions/PageParts';
import { Actions, Figure } from './PanelParts';
import { weddingTotal, type WeddingData } from './type-math';

/**
 * A wedding by its guests: catering for each of them, plus every other part of the breakdown
 * (venue, attire, documentation…), against the target. Deposits are parts with a due date, each
 * reminded of two weeks ahead.
 */
export function WeddingPanel({ value, onChange, parts, target, actions }: {
  value: WeddingData;
  onChange: (patch: Partial<WeddingData>) => void;
  parts: ReadonlyArray<{ name: string; amount: number; dueAt: number | null; paidAt: number | null }>;
  target: number;
  actions?: ReactNode;
}) {
  const { formatAmount } = useBalanceVisibility();
  const totals = weddingTotal(value, parts);
  const dated = parts.filter((part) => part.dueAt !== null && part.paidAt === null).length;
  const over = totals.total > target;

  return (
    <Section title="Guests and costs">
      <div className="@container px-4 py-4 sm:px-5">
        <div className="settings-compact grid grid-cols-1 gap-3 @md:grid-cols-2">
          <Field label="Guests" htmlFor="wedding-guests" info="Count invitations as two when couples come together. Caterers usually price by the portion, a little above the guests coming.">
            <PercentField id="wedding-guests" suffix="guests" value={value.guests} min={0} max={10_000} onChange={(guests) => onChange({ guests: Math.round(guests) })} />
          </Field>
          <Field label="Catering for each" htmlFor="wedding-per-guest">
            <MoneyField id="wedding-per-guest" value={value.perGuest} onChange={(perGuest) => onChange({ perGuest })} />
          </Field>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-4 @lg:grid-cols-3">
          <Figure label="Catering" value={formatAmount(totals.catering)} hint={value.guests ? `${value.guests} guests` : 'Add the guests'} />
          <Figure label="Everything else" value={formatAmount(totals.others)} hint="The other parts of the breakdown" />
          <Figure label="Altogether" value={formatAmount(totals.total)} hint={over ? `${formatAmount(totals.total - target)} more than the target` : `${formatAmount(target - totals.total)} under the target`} tone={over ? 'warn' : 'plain'} large />
        </div>
        <p className={cn('mt-4 text-xs text-[var(--ref-on-surface-variant)]')}>
          Give each vendor’s deposit a due date in the breakdown and you’re reminded two weeks before.{dated ? ` ${dated} payment${dated === 1 ? ' is' : 's are'} dated so far.` : ''}
        </p>
        {actions && <Actions>{actions}</Actions>}
      </div>
    </Section>
  );
}
