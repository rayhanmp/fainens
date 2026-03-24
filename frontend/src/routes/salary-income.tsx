import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { RequireAuth } from '../lib/auth';
import { api } from '../lib/api';
import { formatCurrency, cn } from '../lib/utils';
import { Button } from '../components/ui/Button';
import { SalaryProfileModal } from '../components/salary/SalaryProfileModal';
import {
  Download,
  Plus,
  TrendingUp,
  Calendar,
  Landmark,
  Gift,
  Banknote,
  Info,
  MoreVertical,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

export const Route = createFileRoute('/salary-income')({
  component: SalaryIncomePage,
} as any);

interface TxRow {
  id: number;
  date: number;
  description: string;
  txType: string;
  lines: Array<{ debit: number; credit: number; accountId: number }>;
}

function txAmount(tx: TxRow): number {
  if (!tx.lines?.length) return 0;
  return Math.max(...tx.lines.map((l) => Math.max(l.debit, l.credit)));
}

function isIncomeTx(tx: TxRow): boolean {
  return (
    tx.txType === 'simple_income' ||
    (typeof tx.txType === 'string' && tx.txType.includes('income'))
  );
}

function monthKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function daysUntilPayday(payDay = 25) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d = Math.min(Math.max(1, payDay), 31);
  let target = new Date(now.getFullYear(), now.getMonth(), d, 23, 59, 59, 999);
  if (today.getTime() > target.getTime()) {
    target = new Date(now.getFullYear(), now.getMonth() + 1, d, 23, 59, 59, 999);
  }
  const ms = target.getTime() - now.getTime();
  return { days: Math.max(0, Math.ceil(ms / 86400000)), date: target };
}

function downloadIncomeCsv(rows: TxRow[]) {
  const header = 'Date,Description,Amount (IDR)\n';
  const body = rows
    .map((tx) => {
      const a = txAmount(tx);
      const d = new Date(tx.date).toISOString().slice(0, 10);
      const desc = tx.description.replace(/"/g, '""');
      return `${d},"${desc}",${a}`;
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

type SalaryBundle = Awaited<ReturnType<typeof api.salarySettings.get>>;
type Account = { id: number; name: string; type: string };

function SalaryIncomePage() {
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [salary, setSalary] = useState<SalaryBundle | null>(null);
  const [salaryLoading, setSalaryLoading] = useState(true);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const [transactions, setTransactions] = useState<TxRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [txData, accData] = await Promise.all([
          api.transactions.list({ limit: '2000' }),
          api.accounts.list(),
        ]);
        setTransactions(txData.data as TxRow[]);
        setAccounts(accData as Account[]);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.salarySettings.get();
        setSalary(data);
      } catch {
        setSalary(null);
      } finally {
        setSalaryLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const incomeTxs = useMemo(
    () => transactions.filter(isIncomeTx).sort((a, b) => b.date - a.date),
    [transactions],
  );

  const now = new Date();
  const thisMonthStart = startOfMonth(now);
  const lastMonthStart = startOfMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1));

  const thisMonthIncome = useMemo(() => {
    return incomeTxs.filter((tx) => tx.date >= thisMonthStart).reduce((s, tx) => s + txAmount(tx), 0);
  }, [incomeTxs, thisMonthStart]);

  const lastMonthIncome = useMemo(() => {
    return incomeTxs
      .filter((tx) => tx.date >= lastMonthStart && tx.date < thisMonthStart)
      .reduce((s, tx) => s + txAmount(tx), 0);
  }, [incomeTxs, lastMonthStart, thisMonthStart]);

  const momPct = useMemo(() => {
    if (lastMonthIncome <= 0) return thisMonthIncome > 0 ? 100 : 0;
    return ((thisMonthIncome - lastMonthIncome) / lastMonthIncome) * 100;
  }, [thisMonthIncome, lastMonthIncome]);

  const last6Months = useMemo(() => {
    const today = new Date();
    const keys: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    const byMonth = new Map<string, number>();
    for (const k of keys) byMonth.set(k, 0);
    for (const tx of incomeTxs) {
      const k = monthKey(tx.date);
      if (byMonth.has(k)) byMonth.set(k, (byMonth.get(k) ?? 0) + txAmount(tx));
    }
    return keys.map((k) => ({
      key: k,
      label: monthLabel(k),
      net: byMonth.get(k) ?? 0,
    }));
  }, [incomeTxs]);

  const payrollDay = salary?.settings.payrollDay ?? 25;
  const payday = useMemo(() => daysUntilPayday(payrollDay), [payrollDay]);
  const computed = salary?.computed;
  const hasPayroll = (salary?.settings.grossMonthly ?? 0) > 0;
  const payJourney = useMemo(() => {
    const d = new Date();
    const day = d.getDate();
    return Math.min(100, Math.round((day / 30) * 100));
  }, []);

  const recentIncome = useMemo(() => incomeTxs.slice(0, 8), [incomeTxs]);

  const monthName = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const heroMainAmount = hasPayroll && computed ? computed.estimatedNetMonthly : thisMonthIncome;
  const heroTitle =
    hasPayroll && computed ? 'Estimated take-home (payroll)' : 'Total net take-home (this month)';

  return (
    <RequireAuth>
      <div className="space-y-8 pb-10">
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
          onSaved={(res) => setSalary(res)}
        />

        {/* Header */}
        <header className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div className="flex flex-1 flex-wrap items-start gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <h1 className="font-headline text-3xl font-extrabold tracking-tight text-[var(--color-text-primary)] sm:text-4xl">
                  Salary &amp; income
                </h1>
                <div className="relative" ref={menuRef}>
                  <button
                    type="button"
                    className="cursor-pointer rounded-full p-2 text-[var(--color-text-secondary)] transition hover:bg-[var(--ref-surface-container-low)] hover:text-[var(--color-text-primary)]"
                    aria-label="Open salary menu"
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((o) => !o)}
                  >
                    <MoreVertical className="h-6 w-6" />
                  </button>
                  {menuOpen && (
                    <div className="absolute left-0 top-full z-20 mt-1 min-w-[200px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-lg">
                      <button
                        type="button"
                        className="cursor-pointer w-full px-4 py-2.5 text-left text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--ref-surface-container-low)]"
                        onClick={() => {
                          setMenuOpen(false);
                          setProfileOpen(true);
                        }}
                      >
                        Edit salary profile…
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <p className="mt-2 max-w-xl font-body text-[var(--color-text-secondary)]">
                {isLoading || salaryLoading
                  ? 'Loading earnings…'
                  : hasPayroll
                    ? `Payroll estimates from your profile; ledger income for ${monthName} shown below for comparison.`
                    : `Recorded income credits for ${monthName}. Set salary via the menu for PPh 21 & BPJS estimates.`}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={incomeTxs.length === 0}
              onClick={() => downloadIncomeCsv(incomeTxs)}
              className="cursor-pointer disabled:cursor-not-allowed inline-flex items-center gap-2 rounded-full bg-[var(--ref-secondary-container)] px-6 py-3 text-sm font-bold text-[var(--ref-on-secondary-container)] transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Download className="h-4 w-4" />
              Download CSV
            </button>
            <Button
              type="button"
              className="rounded-full px-6 py-3 shadow-lg shadow-[var(--color-accent)]/20"
              onClick={() => navigate({ to: '/transactions' })}
            >
              <Plus className="h-4 w-4" />
              Add income
            </Button>
          </div>
        </header>

        {/* Bento grid */}
        <div className="grid grid-cols-12 gap-6">
          {/* Hero net */}
          <section className="relative col-span-12 flex min-h-[280px] flex-col justify-between overflow-hidden rounded-xl bg-[var(--ref-surface-container-low)] p-6 sm:p-8 lg:col-span-8">
            <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[var(--color-accent)]/5 blur-3xl" />
            <div className="relative z-10">
              <div className="mb-6 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[var(--color-success)] px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white">
                  Net credits
                </span>
                <span
                  className={cn(
                    'flex items-center gap-1 text-sm font-bold',
                    momPct >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]',
                  )}
                >
                  <TrendingUp className="h-4 w-4" />
                  {momPct >= 0 ? '+' : ''}
                  {momPct.toFixed(1)}% vs last month
                </span>
              </div>
              <h2 className="mb-1 font-body text-lg text-[var(--color-text-secondary)]">{heroTitle}</h2>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-headline text-2xl font-bold text-[var(--color-accent)]">Rp</span>
                <span className="font-headline text-4xl font-black tracking-tighter text-[var(--color-text-primary)] sm:text-5xl md:text-6xl">
                  {heroMainAmount.toLocaleString('id-ID')}
                </span>
              </div>
              {hasPayroll && computed && (
                <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                  Ledger this month:{' '}
                  <span className="font-semibold text-[var(--color-text-primary)]">
                    {formatCurrency(thisMonthIncome)}
                  </span>
                </p>
              )}
            </div>
            <div className="relative z-10 mt-8 grid grid-cols-1 gap-6 border-t border-[var(--color-border)]/60 pt-8 sm:grid-cols-3">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
                  Gross (payroll)
                </p>
                <p className="font-headline text-xl font-bold text-[var(--color-text-primary)]">
                  {hasPayroll && computed ? formatCurrency(computed.grossMonthly) : '—'}
                </p>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
                  Tax &amp; withholdings
                </p>
                <p className="font-headline text-xl font-bold text-[var(--color-danger)]">
                  {hasPayroll && computed ? formatCurrency(computed.pph21Monthly) : '—'}
                </p>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
                  BPJS (employee)
                </p>
                <p className="font-headline text-xl font-bold text-[var(--color-success)]">
                  {hasPayroll && computed
                    ? formatCurrency(
                        computed.jhtMonthly + computed.jpMonthly + computed.bpjsKesehatanMonthly,
                      )
                    : '—'}
                </p>
              </div>
            </div>
            <p className="relative z-10 mt-4 text-xs text-[var(--color-text-secondary)]">
              {hasPayroll && computed
                ? 'PPh 21 uses biaya jabatan, JHT/JP as iuran pensiun, PTKP, and Pasal 17 brackets. BPJS uses standard employee rates (capped bases). Not tax advice.'
                : 'Set your gross salary and PTKP via the menu to see automated PPh 21 and BPJS estimates. Ledger income stays separate.'}
            </p>
          </section>

          {/* Payday card */}
          <section className="relative col-span-12 flex flex-col justify-between overflow-hidden rounded-xl bg-[var(--color-accent)] p-6 text-white sm:p-8 lg:col-span-4">
            <div
              className="pointer-events-none absolute inset-0 opacity-10"
              style={{
                backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
                backgroundSize: '24px 24px',
              }}
            />
            <div className="relative z-10">
              <div className="mb-8 flex items-start justify-between">
                <div className="rounded-2xl bg-white/20 p-3 backdrop-blur-md">
                  <Calendar className="h-8 w-8" />
                </div>
                <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-bold">
                  {now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </span>
              </div>
              <h3 className="font-headline text-3xl font-extrabold leading-tight sm:text-4xl">
                {payday.days} day{payday.days === 1 ? '' : 's'}
                <br />
                to payday
              </h3>
              <p className="mt-2 text-sm text-[var(--ref-primary-fixed)]">
                Assumed disbursement:{' '}
                {payday.date.toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}{' '}
                (day {payrollDay} of each month)
              </p>
            </div>
            <div className="relative z-10 mt-8">
              <div className="mb-2 h-2 w-full rounded-full bg-white/20">
                <div
                  className="h-full rounded-full bg-white transition-all"
                  style={{ width: `${payJourney}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-white/60">
                <span>Month progress</span>
                <span>{payJourney}%</span>
              </div>
            </div>
          </section>

          {/* Breakdown */}
          <section className="col-span-12 rounded-xl bg-[var(--ref-surface-container-lowest)] p-6 shadow-sm sm:p-8 lg:col-span-7">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <h3 className="font-headline text-xl font-bold text-[var(--color-text-primary)]">
                Income breakdown
              </h3>
              <Link
                to="/transactions"
                className="inline-flex items-center gap-1 text-sm font-bold text-[var(--color-accent)] hover:underline"
              >
                View all <span aria-hidden>›</span>
              </Link>
            </div>
            {isLoading ? (
              <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>
            ) : recentIncome.length === 0 ? (
              <p className="text-sm text-[var(--color-text-secondary)]">
                No income transactions yet. Record salary or side income from Transactions → income.
              </p>
            ) : (
              <div className="space-y-4">
                {recentIncome.map((tx, i) => {
                  const amt = txAmount(tx);
                  const icons = [Landmark, Gift, Banknote];
                  const Icon = icons[i % 3];
                  return (
                    <div
                      key={tx.id}
                      className="flex flex-col gap-4 rounded-xl bg-[var(--ref-surface-container-low)] p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white shadow-sm">
                          <Icon className="h-6 w-6 text-[var(--color-accent)]" />
                        </div>
                        <div>
                          <h4 className="font-bold text-[var(--color-text-primary)]">{tx.description}</h4>
                          <p className="text-xs text-[var(--color-text-secondary)]">
                            Income ·{' '}
                            {new Date(tx.date).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </p>
                        </div>
                      </div>
                      <div className="text-left sm:text-right">
                        <p className="font-headline font-bold text-[var(--color-text-primary)]">
                          {formatCurrency(amt)}
                        </p>
                        <span className="mt-1 inline-block rounded bg-[var(--color-success)]/15 px-2 py-0.5 text-[10px] font-bold text-[var(--color-success)]">
                          POSTED
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Deductions placeholder */}
          <section className="col-span-12 rounded-xl bg-[var(--ref-surface-container-lowest)] p-6 shadow-sm sm:p-8 lg:col-span-5">
            <h3 className="mb-8 font-headline text-xl font-bold text-[var(--color-text-primary)]">
              Mandatory deductions
            </h3>
            <div className="space-y-6">
              <div className="relative border-l-2 border-[var(--color-danger)]/30 pl-6">
                <p className="mb-1 text-xs font-bold uppercase tracking-widest text-[var(--color-text-secondary)]">
                  PPh 21 (income tax)
                </p>
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <h4 className="font-headline text-2xl font-bold text-[var(--color-text-primary)]">
                    {hasPayroll && computed ? formatCurrency(computed.pph21Monthly) : '—'}
                  </h4>
                  <span className="text-xs italic text-[var(--color-text-secondary)]">
                    {hasPayroll && computed
                      ? `Method: ${computed.calculationMethod}`
                      : 'Set salary profile'}
                  </span>
                </div>
              </div>
              <div className="relative border-l-2 border-[var(--color-success)]/30 pl-6">
                <p className="mb-1 text-xs font-bold uppercase tracking-widest text-[var(--color-text-secondary)]">
                  BPJS Ketenagakerjaan (JHT + JP)
                </p>
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <h4 className="font-headline text-xl font-bold text-[var(--color-text-primary)]">
                    {hasPayroll && computed ? formatCurrency(computed.jhtMonthly + computed.jpMonthly) : '—'}
                  </h4>
                  <span className="text-xs text-[var(--color-text-secondary)]">
                    {hasPayroll && computed
                      ? `JHT ${formatCurrency(computed.jhtMonthly)} · JP ${formatCurrency(computed.jpMonthly)}`
                      : 'Employee share (estimated)'}
                  </span>
                </div>
              </div>
              <div className="relative border-l-2 border-[var(--color-accent)]/30 pl-6">
                <p className="mb-1 text-xs font-bold uppercase tracking-widest text-[var(--color-text-secondary)]">
                  BPJS Kesehatan
                </p>
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <h4 className="font-headline text-xl font-bold text-[var(--color-text-primary)]">
                    {hasPayroll && computed ? formatCurrency(computed.bpjsKesehatanMonthly) : '—'}
                  </h4>
                  <span className="text-xs text-[var(--color-text-secondary)]">Employee 1% (capped base)</span>
                </div>
              </div>
            </div>
            <div className="mt-8 flex items-start gap-3 rounded-xl bg-[var(--ref-surface-container-highest)] p-4">
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-accent)]" />
              <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
                {hasPayroll && computed
                  ? 'Figures are estimates from your salary profile. Your ledger still records actual bank credits when you add income transactions.'
                  : 'Open the menu → Edit salary profile to enter gross pay and PTKP. We’ll estimate PPh 21 and BPJS employee contributions.'}
              </p>
            </div>
          </section>

          {/* Chart */}
          <section className="col-span-12 rounded-xl bg-[var(--ref-surface-container-lowest)] p-6 shadow-sm sm:p-8">
            <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div>
                <h3 className="font-headline text-xl font-bold text-[var(--color-text-primary)]">
                  Historical trends
                </h3>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  Last 6 months — income credits (simple income)
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-[var(--color-accent)]" />
                  <span className="text-xs font-bold text-[var(--color-text-primary)]">Net income</span>
                </div>
              </div>
            </div>
            {isLoading ? (
              <p className="text-sm text-[var(--color-text-secondary)]">Loading chart…</p>
            ) : (
              <div className="h-52 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={last6Months} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--color-muted)' }} />
                    <Tooltip
                      formatter={(value: number) => [formatCurrency(value), 'Income']}
                      labelStyle={{ color: 'var(--color-text-primary)' }}
                      contentStyle={{
                        borderRadius: 12,
                        border: '1px solid var(--color-border)',
                        background: 'var(--color-surface)',
                      }}
                    />
                    <Bar
                      dataKey="net"
                      fill="var(--color-accent)"
                      radius={[6, 6, 0, 0]}
                      maxBarSize={48}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>
        </div>
      </div>
    </RequireAuth>
  );
}
