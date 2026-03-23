import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { Button } from '../components/ui/Button';
import { RequireAuth } from '../lib/auth';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { fetchOnboardingStatus } from '../lib/onboarding-status';
import { formatCurrency, formatDate, cn } from '../lib/utils';
import {
  Plus,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { NetWorthChart } from '../components/analytics';
import { CardSkeleton, StatCardSkeleton } from '../components/ui/Skeleton';
import { TransactionModal } from '../components/transactions/TransactionModal';

export const Route = createFileRoute('/')({
  component: DashboardPage,
  beforeLoad: async () => {
    const status = await fetchOnboardingStatus();
    if (status?.needsOnboarding) {
      throw redirect({ to: '/onboarding' });
    }
  },
} as any);

function classifyTx(tx: {
  categoryId: number | null;
  txType: string;
}): 'expense' | 'income' | 'neutral' {
  if (tx.categoryId) return 'expense';
  if (tx.txType?.includes('income') || tx.txType === 'simple_income') return 'income';
  return 'neutral';
}

function DashboardPage() {
  const [walletTotal, setWalletTotal] = useState(0);
  const [analytics, setAnalytics] = useState<{
    netWorth: { totalAssets: number; totalLiabilities: number; netWorth: number };
  } | null>(null);
  const [recent, setRecent] = useState<
    Array<{
      id: number;
      date: number;
      description: string;
      categoryId: number | null;
      txType: string;
      lines: Array<{ debit: number; credit: number }>;
    }>
  >([]);
  const [budgetRows, setBudgetRows] = useState<
    Array<{
      id: number;
      categoryName: string;
      plannedAmount: number;
      actualAmount: number;
      percentUsed: number;
    }>
  >([]);
  const [categorySpend, setCategorySpend] = useState<Array<{ name: string; value: number; color: string }>>([]);
  const [categories, setCategories] = useState<
    Array<{ id: number; name: string; color: string | null; icon: string | null }>
  >([]);
  const [periodLabel, setPeriodLabel] = useState('');
  const [periodIncome, setPeriodIncome] = useState<number | null>(null);
  const [periodExpense, setPeriodExpense] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [tags, setTags] = useState<Array<{ id: number; name: string; color: string }>>([]);
  const [accounts, setAccounts] = useState<Array<{ id: number; name: string; type: string; balance: number; systemKey?: string | null }>>([]);
  const [currentPeriodId, setCurrentPeriodId] = useState<number | null>(null);
  const [topExpenses, setTopExpenses] = useState<Array<{
    id: number;
    date: number;
    description: string;
    categoryId: number | null;
    amount: number;
  }>>([]);

  const statusLine = useMemo(() => {
    const now = new Date();
    return `Status as of ${now.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })} · ${now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const periods = await api.periods.list();
        // Periods are returned in descending order by startDate (newest first)
        const currentPeriod = periods.length ? periods[0] : null;
        const periodId = currentPeriod ? currentPeriod.id : undefined;
        if (currentPeriod) setPeriodLabel(currentPeriod.name);

        // Fetch transactions by date range to include those without period_id
        const periodStartDate = currentPeriod ? new Date(currentPeriod.startDate).toISOString() : undefined;
        const periodEndDate = currentPeriod ? new Date(currentPeriod.endDate).toISOString() : undefined;

        const [accList, dash, recentTxList, cats, budgets, periodTxs, , tagsList] = await Promise.all([
          api.accounts.list(),
          api.analytics.dashboard(),
          api.transactions.list({ limit: '8' }),
          api.categories.list(),
          periodId ? api.budgets.list(String(periodId)) : Promise.resolve([]),
          // Fetch all transactions within the period date range (includes those without period_id)
          periodStartDate && periodEndDate
            ? api.transactions.list({ startDate: periodStartDate, endDate: periodEndDate, limit: '500' })
            : Promise.resolve([]),
          api.analytics.periodSummaries(),
          api.tags.list(),
        ]);

        // Calculate period income and expense from actual transactions within date range
        const periodTxsArray = periodTxs as Array<{
          id: number;
          description: string;
          categoryId: number | null;
          txType: string;
          date: number;
          lines: Array<{ debit: number; credit: number }>;
        }>;
        
        let calculatedIncome = 0;
        let calculatedExpense = 0;
        
        for (const tx of periodTxsArray) {
          const amt = tx.lines.length > 0
            ? Math.max(...tx.lines.map((l) => Math.max(l.debit, l.credit)))
            : 0;
            
          if (tx.txType?.includes('income')) {
            calculatedIncome += amt;
          } else if (tx.txType?.includes('expense') || tx.categoryId) {
            calculatedExpense += amt;
          }
        }
        
        setPeriodIncome(calculatedIncome > 0 ? calculatedIncome : null);
        setPeriodExpense(calculatedExpense > 0 ? calculatedExpense : null);

        // Calculate top 5 most expensive expense transactions
        const expenseTxs = periodTxsArray
          .filter((tx) => tx.txType?.includes('expense') || tx.categoryId)
          .map((tx) => ({
            id: tx.id,
            date: tx.date,
            description: tx.description,
            categoryId: tx.categoryId,
            amount: tx.lines.length > 0
              ? Math.max(...tx.lines.map((l) => Math.max(l.debit, l.credit)))
              : 0,
          }))
          .filter((tx) => tx.amount > 0)
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 5);
        setTopExpenses(expenseTxs);

        const wallets = accList.filter((a) => a.type === 'asset' && !a.systemKey);
        setWalletTotal(wallets.reduce((s, a) => s + a.balance, 0));
        setAnalytics(dash);
        setRecent(recentTxList);
        setBudgetRows(budgets.slice(0, 5));
        setCategories(cats);
        setAccounts(accList);
        setTags(tagsList);
        setCurrentPeriodId(periodId ?? null);

        // Use all transactions within the date range for the pie chart
        const txsToAnalyze = periodTxsArray;
        
        const spendMap = new Map<number, number>();
        
        for (const tx of txsToAnalyze as Array<{
          categoryId: number | null;
          txType: string;
          lines: Array<{ debit: number; credit: number }>;
        }>) {
          if (!tx.categoryId) continue;
          // Count as expense if txType includes 'expense' OR if it has a categoryId
          const isExpense = tx.txType?.includes('expense') || tx.categoryId !== null;
          if (!isExpense) continue;
          const amt =
            tx.lines.length > 0
              ? Math.max(...tx.lines.map((l) => Math.max(l.debit, l.credit)))
              : 0;
          if (amt > 0) {
            spendMap.set(tx.categoryId, (spendMap.get(tx.categoryId) || 0) + amt);
          }
        }
        
        const pie = [...spendMap.entries()]
          .map(([cid, value]) => {
            const c = cats.find((x) => x.id === cid);
            return { name: c?.name ?? `Category ${cid}`, value, color: c?.color || '#737785' };
          })
          .filter((x) => x.value > 0)
          .sort((a, b) => b.value - a.value)
          .slice(0, 6);
        setCategorySpend(pie);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const txAmount = (tx: (typeof recent)[0]) =>
    tx.lines?.length ? Math.max(...tx.lines.map((l) => Math.max(l.debit, l.credit))) : 0;

  const txSubtitle = (tx: (typeof recent)[0]) => {
    if (tx.categoryId) {
      const c = categories.find((x) => x.id === tx.categoryId);
      return c?.name ?? '';
    }
    if (tx.txType?.includes('transfer')) return 'Transfer';
    if (tx.txType?.includes('income')) return 'Income';
    return '';
  };

  if (isLoading) {
    return (
      <RequireAuth>
        <div className="space-y-6 animate-slide-in max-w-7xl mx-auto">
          <div className="h-8 w-48 rounded-md bg-[var(--ref-surface-container-highest)] animate-pulse" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <CardSkeleton className="min-h-[280px]" />
            </div>
            <CardSkeleton />
          </div>
        </div>
      </RequireAuth>
    );
  }

  return (
    <RequireAuth>
      <div className="max-w-7xl mx-auto space-y-8 pb-4">
        {/* Header — Stitch “Financial Overview” */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4">
          <div>
            <h1 className="font-headline text-3xl font-extrabold tracking-tight text-[var(--ref-on-surface)]">
              Financial overview
            </h1>
            <p className="text-sm mt-1 text-[var(--ref-on-surface-variant)] font-body">
              {statusLine}
              {periodLabel ? ` · ${periodLabel}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            <Link to="/reports">
              <button
                type="button"
                className="px-5 py-2.5 bg-[var(--ref-surface-container-lowest)] text-[var(--ref-primary)] text-xs font-bold rounded-full editorial-shadow border border-[var(--color-border)] hover:bg-[var(--ref-surface-container-low)] transition-colors"
              >
                Export report
              </button>
            </Link>
            <Button className="rounded-full shadow-md" onClick={() => setIsModalOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add transaction
            </Button>
          </div>
        </div>

        {/* Bento summary — Stitch 3 cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="relative overflow-hidden bg-[var(--ref-primary-container)] p-8 rounded-[2rem] flex flex-col justify-between min-h-[180px] text-white group">
            <div className="relative z-10">
              <p className="text-[var(--ref-on-primary-container)] text-xs font-bold uppercase tracking-widest mb-2 opacity-90">
                Cash in wallets
              </p>
              <p className="text-3xl sm:text-4xl font-extrabold font-headline tracking-tight">
                {formatCurrency(walletTotal)}
              </p>
            </div>
            {analytics && (
              <div className="relative z-10 mt-4 text-xs font-medium text-[var(--ref-on-primary-container)] opacity-95">
                Net worth {formatCurrency(analytics.netWorth.netWorth)}
              </div>
            )}
            <div className="absolute -right-8 -bottom-8 w-32 h-32 bg-white/10 rounded-full blur-3xl group-hover:scale-125 transition-transform duration-500" />
          </div>

          <div className="bg-[var(--ref-surface-container-lowest)] p-8 rounded-[2rem] min-h-[180px] flex flex-col justify-between editorial-shadow border border-[var(--color-border)]">
            <div>
              <p className="text-[var(--ref-outline)] text-xs font-bold uppercase tracking-widest mb-2">
                Period income
              </p>
              <p className="text-2xl sm:text-3xl font-bold font-headline text-[var(--ref-on-surface)] tracking-tight">
                {periodIncome != null ? formatCurrency(periodIncome) : '—'}
              </p>
            </div>
            <div className="mt-4 flex items-center gap-2 text-[var(--ref-secondary)] text-xs font-semibold">
              <TrendingUp className="w-4 h-4 shrink-0" />
              Latest period in summaries
            </div>
          </div>

          <div className="bg-[var(--ref-surface-container-lowest)] p-8 rounded-[2rem] min-h-[180px] flex flex-col justify-between editorial-shadow border border-[var(--color-border)]">
            <div>
              <p className="text-[var(--ref-outline)] text-xs font-bold uppercase tracking-widest mb-2">
                Period expenses
              </p>
              <p className="text-2xl sm:text-3xl font-bold font-headline text-[var(--ref-on-surface)] tracking-tight">
                {periodExpense != null ? formatCurrency(periodExpense) : '—'}
              </p>
            </div>
            <div className="mt-4 flex items-center gap-2 text-[var(--ref-error)] text-xs font-semibold">
              <span className="inline-block rotate-0">↓</span>
              From analytics period summaries
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          {/* Left: trends + recent table */}
          <div className="lg:col-span-2 space-y-8">
            <NetWorthChart />

            <div className="bg-[var(--ref-surface-container-lowest)] rounded-xl overflow-hidden editorial-shadow border border-[var(--color-border)]">
              <div className="p-6 sm:px-8 pb-4 flex justify-between items-center border-b border-[var(--color-border)]">
                <h3 className="font-headline font-bold text-lg">Recent transactions</h3>
                <Link
                  to="/transactions"
                  className="text-[var(--ref-primary)] text-xs font-bold inline-flex items-center gap-1 hover:underline"
                >
                  View all
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
              {recent.length === 0 ? (
                <p className="p-8 text-sm text-[var(--ref-on-surface-variant)]">No transactions yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-[var(--ref-surface-container-low)]">
                        <th className="px-6 sm:px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]">
                          Date
                        </th>
                        <th className="px-6 sm:px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]">
                          Category
                        </th>
                        <th className="px-6 sm:px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]">
                          Description
                        </th>
                        <th className="px-6 sm:px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)] text-right">
                          Amount
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--ref-surface-container)]">
                      {recent.map((tx) => {
                        const kind = classifyTx(tx);
                        const amt = txAmount(tx);
                        const cat = tx.categoryId
                          ? categories.find((c) => c.id === tx.categoryId)
                          : null;
                        return (
                          <tr
                            key={tx.id}
                            className="hover:bg-[var(--ref-surface-container-low)]/60 transition-colors"
                          >
                            <td className="px-6 sm:px-8 py-4 text-sm text-[var(--ref-on-surface)]">
                              {formatDate(tx.date)}
                            </td>
                            <td className="px-6 sm:px-8 py-4 text-sm text-[var(--ref-on-surface)]">
                              {cat ? cat.name : (txSubtitle(tx) || '—')}
                            </td>
                            <td className="px-6 sm:px-8 py-4 text-sm font-medium text-[var(--ref-on-surface)] max-w-[200px] truncate">
                              {tx.description}
                            </td>
                            <td
                              className={cn(
                                'px-6 sm:px-8 py-4 text-sm font-bold text-right font-mono',
                                kind === 'expense' && 'text-[var(--ref-error)]',
                                kind === 'income' && 'text-[var(--ref-secondary)]',
                                kind === 'neutral' && 'text-[var(--ref-on-surface)]',
                              )}
                            >
                              {kind === 'expense' && '-'}
                              {kind === 'income' && '+'}
                              {formatCurrency(amt)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

          </div>

          {/* Right: top expenses + donut + budget */}
          <div className="space-y-8">
            {/* Top 5 Most Expensive Expenses */}
            <div className="bg-[var(--ref-surface-container-lowest)] p-6 sm:p-8 rounded-xl editorial-shadow border border-[var(--color-border)]">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-headline font-bold text-lg">Top 5 Expenses</h3>
                <Link
                  to="/transactions"
                  className="text-[var(--ref-primary)] text-xs font-bold inline-flex items-center gap-1 hover:underline"
                >
                  View all
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
              <p className="text-xs text-[var(--ref-on-surface-variant)] mb-4">
                {periodLabel ? `Most expensive transactions in ${periodLabel}` : 'Most expensive expense transactions'}
              </p>
              {topExpenses.length === 0 ? (
                <p className="text-sm text-[var(--ref-on-surface-variant)] py-4 text-center">
                  No expense transactions found in this period.
                </p>
              ) : (
                <div className="space-y-3">
                  {topExpenses.map((tx, index) => {
                    const cat = tx.categoryId
                      ? categories.find((c) => c.id === tx.categoryId)
                      : null;
                    return (
                      <Link
                        key={tx.id}
                        to="/transactions"
                        search={{ id: tx.id }}
                        className="flex items-center gap-3 p-3 rounded-lg hover:bg-[var(--ref-surface-container)] transition-colors group"
                      >
                        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--ref-error)]/10 flex items-center justify-center">
                          <span className="text-xs font-bold text-[var(--ref-error)]">{index + 1}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm text-[var(--ref-on-surface)] truncate group-hover:text-[var(--ref-primary)] transition-colors">
                            {tx.description}
                          </p>
                          <p className="text-xs text-[var(--ref-on-surface-variant)]">
                            {cat ? cat.name : 'Uncategorized'} · {formatDate(tx.date)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-sm text-[var(--ref-error)] font-mono">
                            -{formatCurrency(tx.amount)}
                          </p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="bg-[var(--ref-surface-container-lowest)] p-6 sm:p-8 rounded-xl editorial-shadow border border-[var(--color-border)]">
              <h3 className="font-headline font-bold text-lg mb-2">
                Monthly Expenses Breakdown
              </h3>
              <p className="text-xs text-[var(--ref-on-surface-variant)] mb-4">
                {periodLabel ? `Current period: ${periodLabel}` : 'Showing all expenses with categories'}
              </p>
              {categorySpend.length === 0 ? (
                <p className="text-sm text-[var(--ref-on-surface-variant)] py-8 text-center">
                  No categorized expenses found. Add categories to your expense transactions to see spending breakdown.
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="h-56 w-full relative">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={categorySpend}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={48}
                          outerRadius={72}
                          paddingAngle={2}
                          isAnimationActive={false}
                        >
                          {categorySpend.map((entry) => (
                            <Cell key={`cell-${entry.name}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value) =>
                            formatCurrency(typeof value === 'number' ? value : Number(value ?? 0))
                          }
                          contentStyle={{
                            fontFamily: 'var(--font-mono)',
                            borderRadius: 8,
                            border: '1px solid var(--ref-surface-container-highest)',
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  {/* Legend */}
                  <div className="flex flex-wrap justify-center gap-x-4 gap-y-2">
                    {categorySpend.map((entry) => (
                      <div key={entry.name} className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: entry.color }}
                        />
                        <span className="text-xs text-[var(--ref-on-surface-variant)]">
                          {entry.name}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="bg-[var(--ref-surface-container)] p-6 sm:p-8 rounded-xl border border-[var(--color-border)]">
              <h3 className="font-headline font-bold text-lg mb-6">Budget progress</h3>
              {budgetRows.length === 0 ? (
                <p className="text-sm text-[var(--ref-on-surface-variant)]">
                  <Link to="/budget" className="text-[var(--ref-primary)] font-semibold underline">
                    Set up budgets
                  </Link>{' '}
                  for this period.
                </p>
              ) : (
                <ul className="space-y-8">
                  {budgetRows.map((row) => {
                    const pct =
                      row.plannedAmount > 0
                        ? (row.actualAmount / row.plannedAmount) * 100
                        : 0;
                    return (
                      <li key={row.id}>
                        <div className="flex justify-between items-end mb-2 gap-2">
                          <div>
                            <p className="text-xs font-bold text-[var(--ref-on-surface)]">{row.categoryName}</p>
                            <p className="text-[10px] text-[var(--ref-outline)] font-medium">
                              {formatCurrency(row.actualAmount)} of {formatCurrency(row.plannedAmount)}
                            </p>
                          </div>
                          <span
                            className={cn(
                              'text-xs font-bold',
                              pct > 100 ? 'text-[var(--ref-error)]' : 'text-[var(--ref-primary)]',
                            )}
                          >
                            {pct.toFixed(0)}%
                          </span>
                        </div>
                        <div className="w-full h-3 bg-[var(--ref-surface-container-lowest)] rounded-full overflow-hidden">
                          <div
                            className={cn(
                              'h-full rounded-full',
                              pct > 100
                                ? 'bg-[var(--ref-error)]'
                                : pct > 85
                                  ? 'bg-amber-500'
                                  : 'bg-gradient-to-r from-[var(--ref-secondary)] to-[#83d5c5]',
                            )}
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <Link
                to="/budget"
                className="mt-8 block w-full py-3 text-center bg-[var(--ref-surface-container-highest)] text-[var(--ref-on-surface-variant)] text-xs font-bold rounded-full hover:bg-white border border-transparent hover:border-[var(--color-border)] transition-colors"
              >
                Manage all budgets
              </Link>
            </div>
          </div>
        </div>
      </div>

      <TransactionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSaved={() => {
          setIsModalOpen(false);
          // Refresh dashboard data
          window.location.reload();
        }}
        accounts={accounts}
        categories={categories}
        tags={tags}
        editingTransaction={null}
        periodId={currentPeriodId}
      />
    </RequireAuth>
  );
}
