import { useState, useEffect } from 'react';
import { pdf } from '@react-pdf/renderer';
import { Modal } from '../ui/Modal';
import { api } from '../../lib/api';
import { formatCurrency, formatDate, cn } from '../../lib/utils';
import { MonthlyReportPDF } from './MonthlyReportPDF';
import { Download, FileText, Loader2 } from 'lucide-react';

interface MonthlyReportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MonthlyReportModal({ isOpen, onClose }: MonthlyReportModalProps) {
  const [periods, setPeriods] = useState<Array<{ id: number; name: string; startDate: number; endDate: number }>>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [reportData, setReportData] = useState<any>(null);

  useEffect(() => {
    loadPeriods();
  }, []);

  const loadPeriods = async () => {
    try {
      const data = await api.periods.list();
      setPeriods(data);
      if (data.length > 0) {
        setSelectedPeriodId(data[data.length - 1].id.toString());
      }
    } catch (err) {
      console.error('Failed to load periods:', err);
    }
  };

  const handleGenerate = async () => {
    try {
      const periodId = parseInt(selectedPeriodId);
      const period = periods.find(p => p.id === periodId);
      
      // Fetch transactions and categories in parallel
      const [transactionsData, categoriesData, balanceData] = await Promise.all([
        api.transactions.list({ periodId: selectedPeriodId, limit: '10000' }),
        api.categories.list(),
        api.reports.balanceSheet(),
      ]);

      const transactions = transactionsData.data || [];
      const categories = categoriesData || [];
      const categoryMap = new Map(categories.map((c: any) => [c.id, c.name]));

      // Process transactions - separate income and expenses
      const incomeMap = new Map<number, number>();
      const expenseMap = new Map<number, number>();
      const allTransactions: Array<{
        date: string;
        description: string;
        category: string;
        amount: number;
        type: string;
      }> = [];

      let totalIncome = 0;
      let totalExpenses = 0;

      for (const tx of transactions) {
        // Determine if income or expense based on txType
        const isIncome = tx.txType?.includes('income') || tx.txType === 'simple_income';
        
        // Get category name - use "Income" for income transactions
        let categoryName: string;
        if (isIncome) {
          categoryName = 'Income';
        } else {
          categoryName = tx.categoryId ? categoryMap.get(tx.categoryId) || 'Uncategorized' : 'No Category';
        }
        
        // Calculate amount from lines
        const debit = tx.lines?.reduce((sum, line) => sum + (line.debit || 0), 0) || 0;
        const credit = tx.lines?.reduce((sum, line) => sum + (line.credit || 0), 0) || 0;
        
        // Determine amount and type - use credit for income, debit for expense
        let amount = 0;
        let txType = 'expense';
        
        if (isIncome && credit > 0) {
          amount = credit;
          txType = 'income';
          const current = incomeMap.get(0) || 0;
          incomeMap.set(0, current + amount);
          totalIncome += amount;
        } else if (!isIncome && debit > 0) {
          amount = debit;
          txType = 'expense';
          const current = expenseMap.get(tx.categoryId || 0) || 0;
          expenseMap.set(tx.categoryId || 0, current + amount);
          totalExpenses += amount;
        }
        
        // Only add if there's a valid amount
        if (amount > 0) {
          allTransactions.push({
            date: formatDate(tx.date),
            description: tx.description || '-',
            category: categoryName,
            amount: amount,
            type: txType,
          });
        }
      }

      // Convert maps to arrays
      const incomeBySource = Array.from(incomeMap.entries())
        .map(([catId, amount]) => ({
          name: categoryMap.get(catId) || 'Uncategorized',
          amount,
        }))
        .sort((a, b) => b.amount - a.amount);

      const expensesByCategory = Array.from(expenseMap.entries())
        .map(([catId, amount]) => ({
          name: categoryMap.get(catId) || 'Uncategorized',
          amount,
        }))
        .sort((a, b) => b.amount - a.amount);

      // Sort transactions by date (newest first)
      allTransactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());



      const budgetComparison: any[] = [];

      const newReportData = {
        periodName: period?.name || 'Unknown',
        startDate: period ? formatDate(period.startDate) : '',
        endDate: period ? formatDate(period.endDate) : '',
        totalIncome,
        totalExpenses,
        netIncome: totalIncome - totalExpenses,
        totalAssets: balanceData?.totalAssets || 0,
        totalLiabilities: balanceData?.totalLiabilities || 0,
        netWorth: (balanceData?.totalAssets || 0) - (balanceData?.totalLiabilities || 0),
        incomeBySource,
        expensesByCategory,
        budgetComparison,
        allTransactions,
      };
      
      setReportData(newReportData);
    } catch (err) {
      console.error('Error in handleGenerate:', err);
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
          incomeBySource={reportData.incomeBySource}
          expensesByCategory={reportData.expensesByCategory}
          budgetComparison={reportData.budgetComparison}
          allTransactions={reportData.allTransactions}
        />
      );
      const blob = await pdf(doc).toBlob();

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Fainens-Report-${reportData.periodName.replace(/\s+/g, '-')}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      console.error('Failed to generate PDF:', err);
      alert('Failed to generate PDF: ' + err.message);
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
    >
      <div className="space-y-4">
        {/* Debug info removed */}
        {periods.length === 0 ? (
          <p className="text-center text-[var(--color-text-secondary)] py-4">
            No periods available. Create a salary period first.
          </p>
        ) : (
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
              Select Period
            </label>
            <select
              value={selectedPeriodId}
              onChange={(e) => setSelectedPeriodId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)]"
            >
              {periods.map((p) => (
                <option key={p.id} value={p.id.toString()}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex gap-3 pt-4">
          <button
            type="button"
            onClick={() => { console.log('Preview clicked'); handleGenerate(); }}
            disabled={periods.length === 0}
            className="px-4 py-2 bg-[var(--color-secondary)] text-[var(--color-secondary)] rounded-lg font-medium disabled:opacity-50"
          >
            <FileText className="w-4 h-4 inline mr-2" />
            Preview
          </button>
          <button
            type="button"
            onClick={() => { console.log('Download clicked'); handleDownload(); }}
            disabled={!reportData || isGenerating || periods.length === 0}
            className="px-4 py-2 bg-[var(--color-accent)] text-white rounded-lg font-medium disabled:opacity-50"
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 inline mr-2 animate-spin" />
            ) : (
              <Download className="w-4 h-4 inline mr-2" />
            )}
            Download PDF
          </button>
        </div>

        {reportData && (
          <div className="mt-6 p-4 bg-[var(--ref-surface-container-low)] rounded-lg space-y-3">
            <h4 className="font-medium text-sm">Report Preview</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
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
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
