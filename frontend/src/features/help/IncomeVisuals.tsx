import { useState, type ReactNode } from 'react';
import { IncomeHistoryCard, PaydayCard, TakeHomeCard, TaxOutlookCard, YearToDateCard } from '../salary/SalaryCards';
import { monthlyIncomeSeries, payCycle, takeHomeBreakdown, taxOutlook, yearToDateCurve, SALARY_TX_TYPE, type IncomeRow } from '../salary/income-insights';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { exampleAccounts, useHelpPersonal } from './personal';
import { VisualFrame } from './visuals';

/**
 * The Income & salary page's own cards (the real components) for one example employee: take-home
 * pay and payday, a year of income, and the yearly tax outlook. Clicks are held where a card would
 * open something.
 */

function Inert({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className} onClickCapture={(event) => { event.preventDefault(); event.stopPropagation(); }}>{children}</div>;
}

/** Example monthly figures for a TK/0 employee on Rp15.000.000 gross, paid on the 25th. */
const EXAMPLE = { grossMonthly: 15_000_000, pph21Monthly: 1_050_000, jhtMonthly: 300_000, jpMonthly: 105_474, bpjsKesehatanMonthly: 120_000 };
const NET = EXAMPLE.grossMonthly - EXAMPLE.pph21Monthly - EXAMPLE.jhtMonthly - EXAMPLE.jpMonthly - EXAMPLE.bpjsKesehatanMonthly;
const PAYDAY = 25;
const OTHER_INCOME = 6_000_000;

/** A year of example income: the salary every payday, and freelance work three times. */
function exampleIncome(now: number): IncomeRow[] {
  const today = new Date(now);
  const rows: IncomeRow[] = [];
  for (let ago = 11; ago >= 0; ago -= 1) {
    const payday = new Date(today.getFullYear(), today.getMonth() - ago, PAYDAY, 12).getTime();
    if (payday <= now) rows.push({ id: ago * 2 + 1, date: payday, description: 'Salary', incomeCents: NET, txType: SALARY_TX_TYPE });
    if (ago === 2 || ago === 6 || ago === 9) {
      rows.push({ id: ago * 2 + 2, date: new Date(today.getFullYear(), today.getMonth() - ago, 10, 12).getTime(), description: 'Freelance design project', incomeCents: 2_000_000 });
    }
  }
  return rows;
}

export function TakeHomeDemo() {
  const { formatAmount } = useBalanceVisibility();
  const { first } = exampleAccounts(useHelpPersonal());
  const [now] = useState(() => Date.now());
  const segments = takeHomeBreakdown({ ...EXAMPLE, estimatedNetMonthly: NET });
  const cycle = payCycle(PAYDAY, now);
  return (
    <VisualFrame caption="Take-home pay and the payday card, with example figures for a TK/0 employee on Rp15.000.000 gross, paid on the 25th.">
      <Inert className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <TakeHomeCard
          gross={EXAMPLE.grossMonthly}
          net={NET}
          segments={segments}
          method="TER"
          notes={['Example figures for a TK/0 employee.']}
          depositAccountName={first}
          payrollDay={PAYDAY}
          ptkpCode="TK/0"
          ptkpAnnual={54_000_000}
          employerContribution={561_000}
          formatAmount={formatAmount}
          onEditProfile={() => undefined}
        />
        <PaydayCard
          cycle={cycle}
          monthLabel={new Date(now).toLocaleDateString('en-US', { month: 'long' })}
          expectedNet={NET}
          depositAccountName={first}
          recordedSinceLastPayday={NET}
          formatAmount={formatAmount}
        />
      </Inert>
    </VisualFrame>
  );
}

export function IncomeTrendDemo() {
  const { formatAmount, balancesHidden } = useBalanceVisibility();
  const [now] = useState(() => Date.now());
  const rows = exampleIncome(now);
  const series = monthlyIncomeSeries(rows, now, 12);
  // Example spending: most of each month's pay, a little more in the months with freelance income.
  const spending = series.map((month, index) => ({ date: new Date(`${month.key}-15T12:00:00`).getTime(), expenseCents: Math.round(month.total * (0.72 + (index % 3) * 0.04)) }));
  const curve = yearToDateCurve(series, now, NET, spending);
  return (
    <VisualFrame caption="Income history and this year so far, with example income: the salary each month and freelance work three times, against the pay the profile expects.">
      <div className="grid gap-5 xl:grid-cols-2">
        <IncomeHistoryCard series={series} expectedNet={NET} balancesHidden={balancesHidden} formatAmount={formatAmount} loading={false} />
        <YearToDateCard curve={curve} year={new Date(now).getFullYear()} expectedNet={NET} balancesHidden={balancesHidden} formatAmount={formatAmount} loading={false} />
      </div>
    </VisualFrame>
  );
}

export function TaxOutlookDemo() {
  const { formatAmount } = useBalanceVisibility();
  const [share, setShare] = useState<0.5 | 1>(1);
  const outlook = taxOutlook({
    wageMonths: 12,
    monthlyBruto: EXAMPLE.grossMonthly,
    monthlyPension: EXAMPLE.jhtMonthly + EXAMPLE.jpMonthly,
    monthlyWithheld: EXAMPLE.pph21Monthly,
    ptkpAnnual: 54_000_000,
    otherIncome: OTHER_INCOME,
    otherTaxableShare: share,
  });
  return (
    <VisualFrame caption="The yearly tax outlook for the same example: a year of salary plus Rp6.000.000 of freelance income. Try the switch between counting it in full and at 50%.">
      <TaxOutlookCard
        year={new Date().getFullYear()}
        outlook={outlook}
        wageMonths={12}
        otherIncome={OTHER_INCOME}
        otherTaxableShare={share}
        onOtherTaxableShareChange={setShare}
        formatAmount={formatAmount}
      />
    </VisualFrame>
  );
}
