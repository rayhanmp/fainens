import { useState, useEffect } from 'react';
import { pdf } from '@react-pdf/renderer';
import { Modal } from '../ui/Modal';
import { formatCurrency, formatDate, cn } from '../../lib/utils';
import { MonthlyReportPDF } from './MonthlyReportPDF';
import { Download, FileText, Loader2 } from 'lucide-react';
import { birthdayPassword, loadReportSecuritySettings, passwordFormatDescription, type ReportSecuritySettings } from '../../lib/reportSecurity';
import { usePeriodsLedgerQuery } from '../../features/periods/queries';
import { useMonthlyReportQuery } from '../../features/reports/queries';

interface MonthlyReportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MonthlyReportModal({ isOpen, onClose }: MonthlyReportModalProps) {
  const periodsQuery = usePeriodsLedgerQuery();
  const periods = periodsQuery.data ?? [];
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [reportData, setReportData] = useState<any>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportSecurity, setReportSecurity] = useState<ReportSecuritySettings>(() => loadReportSecuritySettings());

  const monthlyReportQuery = useMonthlyReportQuery(selectedPeriodId ? Number(selectedPeriodId) : null);
  const configuredPdfPassword = reportSecurity.pdfPasswordEnabled
    ? birthdayPassword(reportSecurity.birthDate, reportSecurity.pdfPasswordFormat)
    : null;

  useEffect(() => {
    if (periods.length > 0 && !selectedPeriodId) {
      // Periods are returned newest first; default to the current/latest one.
      setSelectedPeriodId(periods[0].id.toString());
    }
  }, [periods, selectedPeriodId]);

  useEffect(() => {
    if (isOpen) setReportSecurity(loadReportSecuritySettings());
  }, [isOpen]);

  const handleGenerate = async () => {
    if (isPreviewing) return;
    setIsPreviewing(true);
    setReportData(null);
    setReportError(null);
    try {
      const periodId = parseInt(selectedPeriodId);
      const period = periods.find(p => p.id === periodId);
      if (!period) throw new Error('Selected period not found');

      // The backend returns one canonical period-scoped payload. This avoids
      // txType heuristics, the 100-row transaction cap, and a current-date
      // balance sheet leaking into a historical report.
      const monthly = (await monthlyReportQuery.refetch()).data;
      if (!monthly) throw new Error('Failed to generate report preview');
      const allTransactions = monthly.transactions.map((tx) => ({
        date: formatDate(tx.date),
        description: tx.description || '-',
        category: tx.category,
        amount: tx.amountCents,
        type: tx.type,
      }));

      const newReportData = {
        periodId: selectedPeriodId,
        periodName: monthly.period.name,
        startDate: formatDate(monthly.period.startDate),
        endDate: formatDate(monthly.period.endDate),
        totalIncome: monthly.incomeStatement.totalRevenue,
        totalExpenses: monthly.incomeStatement.totalExpenses,
        netIncome: monthly.incomeStatement.netIncome,
        totalAssets: monthly.balanceSheet.totalAssets,
        totalLiabilities: monthly.balanceSheet.totalLiabilities,
        netWorth: monthly.balanceSheet.totalAssets - monthly.balanceSheet.totalLiabilities,
        previousBalance: monthly.previousBalance,
        totalIncoming: monthly.totalIncoming,
        totalOutgoing: monthly.totalOutgoing,
        closingBalance: monthly.closingBalance,
        reportHash: monthly.reportHash,
        incomeBySource: monthly.incomeBySource,
        expensesByCategory: monthly.expensesByCategory,
        budgetComparison: monthly.budgetComparison,
        revision: monthly.revision,
        provenance: monthly.provenance,
        allTransactions,
        coverage: monthly.coverage,
      };
      
      setReportData(newReportData);
    } catch (err) {
      console.error('Error in handleGenerate:', err);
      setReportData(null);
      setReportError(err instanceof Error ? err.message : 'Failed to generate report preview');
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleDownload = async () => {
    if (!reportData) return;
    
    setIsGenerating(true);
    try {
      const doc = (
        <MonthlyReportPDF
          periodName={reportData.periodName}
          startDate={reportData.startDate}
          endDate={reportData.endDate}
          totalIncome={reportData.totalIncome}
          totalExpenses={reportData.totalExpenses}
          netIncome={reportData.netIncome}
          totalAssets={reportData.totalAssets}
          totalLiabilities={reportData.totalLiabilities}
          netWorth={reportData.netWorth}
          previousBalance={reportData.previousBalance}
          totalIncoming={reportData.totalIncoming}
          totalOutgoing={reportData.totalOutgoing}
          closingBalance={reportData.closingBalance}
          reportHash={reportData.reportHash}
          incomeBySource={reportData.incomeBySource}
          expensesByCategory={reportData.expensesByCategory}
          budgetComparison={reportData.budgetComparison}
          allTransactions={reportData.allTransactions}
          coverage={reportData.coverage}
        />
      );
      const sourceBlob = await pdf(doc).toBlob();
      const password = configuredPdfPassword;
      if (reportSecurity.pdfPasswordEnabled && !password) {
        throw new Error('Add a valid birthday in Settings before downloading a protected report.');
      }
      let blob = sourceBlob;
      if (password) {
        const encrypted = await (await import('@pdfsmaller/pdf-encrypt')).encryptPDF(new Uint8Array(await sourceBlob.arrayBuffer()), password, {
              algorithm: 'AES-256',
              allowPrinting: true,
              allowHighQualityPrint: true,
              allowModifying: false,
              allowCopying: false,
              allowAnnotating: false,
              allowFillingForms: false,
              allowAssembly: false,
              allowExtraction: true,
            });
        const encryptedBytes = new Uint8Array(encrypted.byteLength);
        encryptedBytes.set(encrypted);
        blob = new Blob([encryptedBytes.buffer], { type: 'application/pdf' });
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Fainens-Report-${reportData.periodName.replace(/\s+/g, '-')}${password ? '-Protected' : ''}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      console.error('Failed to generate PDF:', err);
      setReportError('Failed to generate PDF: ' + err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Monthly Report"
      subtitle="Generate and download your monthly financial statement"
      size="xl"
      showCloseLabel={false}
      className="max-w-2xl"
      contentClassName="px-6 py-6 sm:px-8 sm:py-7"
      footer={
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-[var(--color-text-secondary)]">
            {reportSecurity.pdfPasswordEnabled && !configuredPdfPassword
              ? 'Protection enabled · add a valid birthday in Settings'
              : reportSecurity.pdfPasswordEnabled
              ? `AES-256 protected · birthday in ${passwordFormatDescription(reportSecurity.pdfPasswordFormat)} format`
              : reportData ? 'Preview generated and ready to download.' : 'Generate a preview before downloading.'}
          </p>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={periods.length === 0 || isPreviewing}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] bg-transparent px-4 py-2.5 text-sm font-semibold text-[var(--color-text-primary)] transition-colors hover:border-[var(--ref-primary)]/40 hover:bg-[var(--ref-primary)]/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ref-primary)]/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPreviewing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileText className="h-4 w-4" aria-hidden="true" />}
              {reportData ? 'Refresh preview' : 'Preview'}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={!reportData || reportData.periodId !== selectedPeriodId || isGenerating || periods.length === 0 || (reportSecurity.pdfPasswordEnabled && !configuredPdfPassword)}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--ref-primary)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--ref-primary-container)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ref-primary)]/35 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
              Download PDF
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        {periods.length === 0 ? (
          <p className="py-5 text-center text-sm text-[var(--color-text-secondary)]">
            No periods available. Create a salary period first.
          </p>
        ) : (
          <div className="space-y-2">
            <label htmlFor="monthly-report-period" className="block text-sm font-semibold text-[var(--color-text-primary)]">
              Select period
            </label>
            <select
              id="monthly-report-period"
              value={selectedPeriodId}
              onChange={(e) => {
                setSelectedPeriodId(e.target.value);
                setReportData(null);
                setReportError(null);
              }}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-3 text-[var(--color-text-primary)] shadow-sm outline-none transition-colors focus:border-[var(--ref-primary)] focus:ring-2 focus:ring-[var(--ref-primary)]/15"
            >
              {periods.map((p) => (
                <option key={p.id} value={p.id.toString()}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {reportError && <p className="rounded-lg border border-[var(--ref-error)]/20 bg-[var(--ref-error)]/5 px-3 py-2.5 text-sm text-[var(--ref-error)]">{reportError}</p>}

        {reportData && (
          <div className="border-t border-[var(--color-border)] pt-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">Report preview</h4>
              <span className="text-xs text-[var(--color-text-secondary)]">{reportData.periodName}</span>
            </div>
            <div className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div>
                <span className="text-[var(--color-text-secondary)]">Period:</span>
                <span className="ml-2 font-medium">{reportData.periodName}</span>
              </div>
              <div>
                <span className="text-[var(--color-text-secondary)]">Total Income:</span>
                <span className="ml-2 font-medium text-green-600">{formatCurrency(reportData.totalIncome)}</span>
              </div>
              <div>
                <span className="text-[var(--color-text-secondary)]">Total Expenses:</span>
                <span className="ml-2 font-medium text-red-600">{formatCurrency(reportData.totalExpenses)}</span>
              </div>
              <div>
                <span className="text-[var(--color-text-secondary)]">Net Income:</span>
                <span className={cn('ml-2 font-medium', reportData.netIncome >= 0 ? 'text-green-600' : 'text-red-600')}>
                  {formatCurrency(reportData.netIncome)}
                </span>
              </div>
              <div>
                <span className="text-[var(--color-text-secondary)]">Net Worth:</span>
                <span className="ml-2 font-medium">{formatCurrency(reportData.netWorth)}</span>
              </div>
              <div>
                <span className="text-[var(--color-text-secondary)]">Ledger revision:</span>
                <span className="ml-2 font-medium">{reportData.revision}</span>
              </div>
            </div>
            {reportData.coverage && !reportData.coverage.isComparable && <p className="mt-4 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">Coverage warning: {reportData.coverage.warnings.join(' ')}</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}
