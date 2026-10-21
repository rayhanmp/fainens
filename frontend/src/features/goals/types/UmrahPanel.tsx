import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useBalanceVisibility } from '../../../hooks/useBalanceVisibility';
import { Field, MoneyField, PercentField } from '../../savings/fields';
import { Section } from '../../subscriptions/PageParts';
import { Actions, Figure, Sources } from './PanelParts';
import { UMRAH_PAPERS_DAYS, UMRAH_REFERENCE, umrahTotal, type UmrahData } from './type-math';

/**
 * An umrah for everyone going: the package and spending money for each, against the target, with
 * Kemenag's reference price beside a package priced under it, and when to sort papers and vaccines.
 */
export function UmrahPanel({ value, onChange, target, leaves, now, actions }: {
  value: UmrahData;
  onChange: (patch: Partial<UmrahData>) => void;
  target: number;
  /** When you leave, from the goal's date. */
  leaves: number | null;
  now: number;
  actions?: ReactNode;
}) {
  const { formatAmount } = useBalanceVisibility();
  const total = umrahTotal(value);
  const cheap = value.packagePrice > 0 && value.packagePrice < UMRAH_REFERENCE;
  const papersAt = leaves !== null ? leaves - UMRAH_PAPERS_DAYS * 86_400_000 : null;
  const papers = papersAt === null ? null : papersAt <= now ? 'Now' : new Date(papersAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <Section title="Package">
      <div className="@container px-4 py-4 sm:px-5">
        <div className="settings-compact grid grid-cols-1 gap-3 @lg:grid-cols-3">
          <Field label="Going" htmlFor="umrah-travellers">
            <PercentField id="umrah-travellers" suffix={value.travellers === 1 ? 'person' : 'people'} value={value.travellers} min={1} max={50} onChange={(travellers) => onChange({ travellers: Math.round(travellers) })} />
          </Field>
          <Field label="Package for each" htmlFor="umrah-package">
            <MoneyField id="umrah-package" value={value.packagePrice} onChange={(packagePrice) => onChange({ packagePrice })} />
          </Field>
          <Field label="Spending money" htmlFor="umrah-spending" info="For each person: food beyond the package, gifts, zamzam, local transport and a little spare.">
            <MoneyField id="umrah-spending" value={value.spending} onChange={(spending) => onChange({ spending })} />
          </Field>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-4 @md:grid-cols-2">
          <Figure label="Altogether" value={formatAmount(total)} hint={total > target ? `${formatAmount(total - target)} more than the target` : `${formatAmount(target - total)} under the target`} tone={total > target ? 'warn' : 'plain'} large />
          <Figure label="Papers and vaccines" value={papers ?? 'Set a date'} hint={papers === 'Now' ? 'Less than two months before you leave: check what your travel agent needs' : papers ? 'Two months before you leave; you’re reminded then' : 'Give the goal the month you leave'} tone={papers === 'Now' ? 'warn' : 'plain'} />
        </div>
        {cheap && (
          <p className="mt-4 flex items-start gap-1.5 text-sm text-[var(--color-warning)]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            The package is under Kemenag’s reference price of {formatAmount(UMRAH_REFERENCE)}. That isn’t a minimum, but agents must report packages priced lower, so ask what’s left out.
          </p>
        )}
        <p className="mt-3 text-xs text-[var(--ref-on-surface-variant)]">Kemenag’s reference price for a package is {formatAmount(UMRAH_REFERENCE)}. Choose a travel agent licensed by Kemenag (PPIU).</p>
        <Sources keys={['umrahReference', 'umrahReport']} className="mt-1" />
        {actions && <Actions>{actions}</Actions>}
      </div>
    </Section>
  );
}
