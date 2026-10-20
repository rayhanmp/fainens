import { useState, type ReactNode } from 'react';
import { TakeHomeCard } from '../salary/SalaryCards';
import { takeHomeBreakdown } from '../salary/income-insights';
import { Button } from '../../components/ui/Button';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { formatDate } from '../../lib/utils';
import { exampleAccounts, useHelpPersonal } from './personal';
import { VisualFrame } from './visuals';

/**
 * Income & salary’s take-home card (the real component, with example figures), and the
 * Subscriptions page’s missed-renewals notice as it appears there. Clicks are held.
 */

function Inert({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className} onClickCapture={(event) => { event.preventDefault(); event.stopPropagation(); }}>{children}</div>;
}

/** Example monthly figures for a TK/0 employee on Rp15.000.000 gross. */
const EXAMPLE = { grossMonthly: 15_000_000, pph21Monthly: 1_050_000, jhtMonthly: 300_000, jpMonthly: 105_474, bpjsKesehatanMonthly: 120_000 };
const NET = EXAMPLE.grossMonthly - EXAMPLE.pph21Monthly - EXAMPLE.jhtMonthly - EXAMPLE.jpMonthly - EXAMPLE.bpjsKesehatanMonthly;

export function SalaryAndRenewalDemo() {
  const { formatAmount } = useBalanceVisibility();
  const { first } = exampleAccounts(useHelpPersonal());
  const segments = takeHomeBreakdown({ ...EXAMPLE, estimatedNetMonthly: NET });
  const [due] = useState(() => Date.now() - 4 * 86_400_000);

  return (
    <VisualFrame caption="The Income & salary page’s take-home card with example figures, and the Subscriptions notice for renewals missed while you were away.">
      <Inert className="grid gap-5 2xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] 2xl:items-start">
        <TakeHomeCard
          gross={EXAMPLE.grossMonthly}
          net={NET}
          segments={segments}
          method="TER"
          notes={['Example figures for a TK/0 employee.']}
          depositAccountName={first}
          payrollDay={25}
          ptkpCode="TK/0"
          ptkpAnnual={54_000_000}
          employerContribution={561_000}
          formatAmount={formatAmount}
          onEditProfile={() => undefined}
        />
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-950">
          <div className="flex flex-col justify-between gap-4">
            <div>
              <h2 className="font-headline text-lg font-bold">2 missed renewal occurrence(s) need a decision</h2>
              <p className="mt-1 text-sm">Nothing was posted automatically. Confirm charges only if the subscriptions were active on these dates, or skip them to resume the schedules without changing the ledger.</p>
              <p className="mt-2 text-xs">{`Netflix · ${formatDate(due)} · ${formatAmount(186_000)}  |  Spotify · ${formatDate(due + 86_400_000)} · ${formatAmount(64_990)}`}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="secondary" tabIndex={-1}>Skip &amp; resume</Button>
              <Button tabIndex={-1}>Review confirmed · Post</Button>
            </div>
          </div>
        </section>
      </Inert>
    </VisualFrame>
  );
}
