import { useBalanceVisibility } from '../hooks/useBalanceVisibility';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RequireAuth } from '../lib/auth';
import { useSalaryCatchUpMutation, useSalaryCatchUpPreviewQuery, useSalaryIncomeQuery, useSalarySettingsQuery } from '../features/salary/queries';
import { monthlyIncomeSeries, payCycle, takeHomeBreakdown } from '../features/salary/income-insights';
import { IncomeHistoryCard, PaydayCard, RecentIncomeCard, SalarySetupCard, TakeHomeCard } from '../features/salary/SalaryCards';
import { queryKeys } from '../features/core/query-keys';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/ui/PageHeader';
import { PageContainer } from '../components/ui/PageContainer';
import { SalaryProfileModal } from '../components/salary/SalaryProfileModal';
import { useConfirm } from '../components/ui/ConfirmDialog';
import { toast, errorMessage } from '../components/ui/useToast';
import { Calendar, ChevronRight, Download, MoreHorizontal, Plus } from 'lucide-react';

export const Route = createFileRoute('/salary-income')({
  component: SalaryIncomePage,
});

interface TxRow {
  id: number;
  date: number;
  description: string;
  txType: string;
  incomeCents: number;
}

function downloadIncomeCsv(rows: TxRow[]) {
  const header = 'Date,Description,Amount (IDR)\n';
  const body = rows
    .map((tx) => {
      const d = new Date(tx.date).toISOString().slice(0, 10);
      const desc = tx.description.replace(/"/g, '""');
      return `${d},"${desc}",${Math.max(0, tx.incomeCents)}`;
    })
    .join('\n');
  const blob = new Blob([header + body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const el = document.createElement('a');
  el.href = url;
  el.download = `income-${new Date().toISOString().slice(0, 10)}.csv`;
  el.click();
  URL.revokeObjectURL(url);
}

type Account = { id: number; name: string; type: string };

const menuItem = 'flex min-h-10 w-full cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 text-left text-sm font-medium text-[var(--ref-on-surface)] outline-none hover:bg-[var(--ref-surface-container-low)] focus-visible:bg-[var(--ref-surface-container-low)]';

function SalaryIncomePage() {
  const { formatAmount } = useBalanceVisibility();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const incomeQuery = useSalaryIncomeQuery();
  const salaryQuery = useSalarySettingsQuery();
  const catchUpPreviewQuery = useSalaryCatchUpPreviewQuery();
  const salaryCatchUpMutation = useSalaryCatchUpMutation();
  const { confirm } = useConfirm();
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const salary = salaryQuery.data ?? null;
  const accounts = (incomeQuery.data?.accounts ?? []) as Account[];
  const transactions = (incomeQuery.data?.transactions ?? []) as TxRow[];
  const isLoading = incomeQuery.isPending && !incomeQuery.data;
  const salaryLoading = salaryQuery.isPending && !salaryQuery.data;

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [menuOpen]);

  const incomeTxs = useMemo(
    () => transactions.filter((tx) => tx.incomeCents > 0).sort((a, b) => b.date - a.date),
    [transactions],
  );
  const now = Date.now();
  const series = useMemo(() => monthlyIncomeSeries(incomeTxs, now), [incomeTxs, now]);
  const payrollDay = salary?.settings.payrollDay ?? 25;
  const cycle = useMemo(() => payCycle(payrollDay, now), [payrollDay, now]);
  const recordedSinceLastPayday = useMemo(
    () => incomeTxs.filter((tx) => tx.date >= cycle.lastPayday).reduce((sum, tx) => sum + tx.incomeCents, 0),
    [incomeTxs, cycle.lastPayday],
  );
  const computed = salary?.computed;
  const hasPayroll = (salary?.settings.grossMonthly ?? 0) > 0 && computed != null;
  const segments = useMemo(() => (hasPayroll && computed ? takeHomeBreakdown(computed) : []), [hasPayroll, computed]);
  const monthName = new Date(now).toLocaleDateString('en-US', { month: 'long' });
  const recordedThisMonth = series[series.length - 1]?.total ?? 0;

  const postDueSalary = async () => {
    setPosting(true);
    try {
      const previewResult = await catchUpPreviewQuery.refetch();
      const preview = previewResult.data;
      if (!preview) throw new Error('Could not load salary catch-up preview');
      const due = preview.occurrences.filter((occurrence) => occurrence.status === 'due');
      if (due.length === 0) {
        toast.info('Salary is up to date', preview.message || 'No unprocessed salary months are due.');
        return;
      }
      const firstMonth = new Date(due[0].occurrenceDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      const lastMonth = new Date(due[due.length - 1].occurrenceDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      const monthCount = `${due.length} salary month${due.length === 1 ? '' : 's'}`;
      if (!await confirm({
        title: 'Post due salary?',
        message: `Post ${monthCount} (${firstMonth}${due.length > 1 ? `–${lastMonth}` : ''}) using the saved payroll estimate?`,
        confirmLabel: `Post ${monthCount}`,
      })) return;
      await salaryCatchUpMutation.mutateAsync({ mode: 'post', occurrenceDates: due.map((occurrence) => occurrence.occurrenceDate) });
      toast.success(`Posted ${monthCount}`);
    } catch (e) {
      toast.error('Could not post salary', errorMessage(e));
    } finally {
      setPosting(false);
    }
  };

  return (
    <RequireAuth>
      <PageContainer>
        <SalaryProfileModal
          isOpen={profileOpen}
          onClose={() => setProfileOpen(false)}
          initial={{
            grossMonthly: salary?.settings.grossMonthly ?? 0,
            payrollDay: salary?.settings.payrollDay ?? 25,
            ptkpCode: salary?.settings.ptkpCode ?? 'TK0',
            depositAccountId: salary?.settings.depositAccountId ?? null,
            terCategory: salary?.settings.terCategory ?? 'A',
            jkkRiskGrade: salary?.settings.jkkRiskGrade ?? 24,
            jkmRate: salary?.settings.jkmRate ?? 30,
            bpjsKesehatanActive: salary?.settings.bpjsKesehatanActive ?? true,
            jpWageCap: salary?.settings.jpWageCap ?? 10042300,
            bpjsKesWageCap: salary?.settings.bpjsKesWageCap ?? 12000000,
            jhtWageCap: salary?.settings.jhtWageCap ?? 12000000,
          }}
          ptkpOptions={salary?.ptkpOptions ?? []}
          accounts={accounts}
          onSaved={(res) => queryClient.setQueryData(queryKeys.salary.settings, res)}
        />

        <header className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <PageHeader
            subtext="Income management"
            title="Salary & income"
            description={isLoading || salaryLoading
              ? 'Loading earnings…'
              : hasPayroll
                ? 'Payroll estimates from your profile, next to the income your ledger has actually recorded.'
                : `Income recorded so far, with ${monthName} on top. Add a salary profile for tax and BPJS estimates.`}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" className="rounded-full px-5 py-3 shadow-lg shadow-[var(--color-accent)]/20" onClick={() => navigate({ to: '/transactions', search: { action: 'new-income' } })}>
              <Plus className="h-4 w-4" />
              Add income
            </Button>
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                className="grid h-11 w-11 cursor-pointer place-items-center rounded-full border border-[var(--color-border)] text-[var(--ref-on-surface-variant)] transition-colors hover:bg-[var(--ref-surface-container-low)] hover:text-[var(--ref-on-surface)]"
                aria-label="More actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
              {menuOpen && (
                <div role="menu" className="absolute right-0 top-full z-20 mt-1.5 min-w-52 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-xl ring-1 ring-black/5">
                  <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenuOpen(false); navigate({ to: '/periods' }); }}>
                    <Calendar className="h-4 w-4 text-[var(--ref-on-surface-variant)]" aria-hidden />Salary periods
                  </button>
                  <button type="button" role="menuitem" className={menuItem} disabled={incomeTxs.length === 0} onClick={() => { setMenuOpen(false); downloadIncomeCsv(incomeTxs); }}>
                    <Download className="h-4 w-4 text-[var(--ref-on-surface-variant)]" aria-hidden />Download CSV
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-8">
            {hasPayroll && computed ? (
              <TakeHomeCard
                gross={computed.grossMonthly}
                net={computed.estimatedNetMonthly}
                segments={segments}
                method={computed.calculationMethod}
                notes={computed.notes}
                depositAccountName={salary?.settings.depositAccountName ?? null}
                payrollDay={payrollDay}
                formatAmount={formatAmount}
                onEditProfile={() => setProfileOpen(true)}
              />
            ) : (
              <SalarySetupCard recordedThisMonth={recordedThisMonth} monthName={monthName} formatAmount={formatAmount} onEditProfile={() => setProfileOpen(true)} />
            )}
          </div>
          <div className="lg:col-span-4">
            <PaydayCard
              cycle={cycle}
              expectedNet={hasPayroll && computed ? computed.estimatedNetMonthly : null}
              depositAccountName={salary?.settings.depositAccountName ?? null}
              recordedSinceLastPayday={recordedSinceLastPayday}
              formatAmount={formatAmount}
              postAction={hasPayroll && salary?.settings.depositAccountId ? { label: 'Post due salary', busy: posting, onClick: () => void postDueSalary() } : undefined}
            />
          </div>
          <div className="lg:col-span-7">
            <IncomeHistoryCard series={series} formatAmount={formatAmount} loading={isLoading} />
          </div>
          <div className="lg:col-span-5">
            <RecentIncomeCard
              rows={incomeTxs.slice(0, 8)}
              loading={isLoading}
              formatAmount={formatAmount}
              viewAllHref={(
                <Link to="/transactions" className="inline-flex shrink-0 items-center gap-0.5 text-sm font-bold text-[var(--color-accent)] hover:underline">
                  View all<ChevronRight className="h-4 w-4" aria-hidden />
                </Link>
              )}
            />
          </div>
        </div>
      </PageContainer>
    </RequireAuth>
  );
}
