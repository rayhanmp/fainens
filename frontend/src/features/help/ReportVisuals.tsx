import { useState } from 'react';
import { ArrowRightLeft, FileText, PieChart, Radio, Scale, TrendingUp } from 'lucide-react';
import { BalanceSheetReport, CashFlowReport, IncomeStatementReport, SpendingReport, TabButton, TrendsReport } from '../../routes/reports';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { useHelpPersonal } from './personal';

/**
 * The Reports page’s own tabs and reports, reading your current period. Read-only: the export
 * buttons inside them are held here; use the Reports page to download.
 */

type Tab = 'income' | 'balance' | 'cashflow' | 'spending' | 'trends';

export function LiveReports() {
  const personal = useHelpPersonal();
  const { balancesHidden } = useBalanceVisibility();
  const [tab, setTab] = useState<Tab>('income');
  const period = personal.currentPeriod;
  const none = () => undefined;

  return (
    <figure className="not-prose my-6">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)] p-3 sm:p-4">
        <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-accent)]"><Radio className="h-3.5 w-3.5" aria-hidden />Live · your {period ? period.name : 'recorded'} figures{balancesHidden ? ' · amounts hidden' : ''}</p>
        <div className="-mx-2 flex gap-1 overflow-x-auto rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)]/90 p-1.5 shadow-sm sm:gap-1.5">
          <TabButton active={tab === 'income'} onClick={() => setTab('income')} icon={<FileText className="h-4 w-4" />} label="Income Statement" />
          <TabButton active={tab === 'balance'} onClick={() => setTab('balance')} icon={<Scale className="h-4 w-4" />} label="Balance Sheet" />
          <TabButton active={tab === 'cashflow'} onClick={() => setTab('cashflow')} icon={<ArrowRightLeft className="h-4 w-4" />} label="Cash Flow" />
          <TabButton active={tab === 'spending'} onClick={() => setTab('spending')} icon={<PieChart className="h-4 w-4" />} label="Spending" />
          <TabButton active={tab === 'trends'} onClick={() => setTab('trends')} icon={<TrendingUp className="h-4 w-4" />} label="Trends" />
        </div>
        {/* Exports are held: clicks on their buttons don't reach them. */}
        <div className="mt-4" onClickCapture={(event) => { if ((event.target as HTMLElement).closest('button')?.textContent?.match(/export|csv|pdf/i)) { event.preventDefault(); event.stopPropagation(); } }}>
          {tab === 'income' && <IncomeStatementReport periodId={period?.id} onExport={none} onExportPDF={none} />}
          {tab === 'balance' && <BalanceSheetReport periodEndDate={period?.endDate} onExport={none} />}
          {tab === 'cashflow' && <CashFlowReport periodId={period?.id} onExport={none} />}
          {tab === 'spending' && <SpendingReport periodId={period?.id} />}
          {tab === 'trends' && <TrendsReport />}
        </div>
      </div>
      <figcaption className="mt-2 text-center text-xs text-[var(--ref-on-surface-variant)]">The same reports as on the Reports page, for your current period. Download them from the Reports page.</figcaption>
    </figure>
  );
}
