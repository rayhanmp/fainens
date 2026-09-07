import { Link, createFileRoute } from '@tanstack/react-router';
import { ArrowRight, BookOpen, FileText, PiggyBank, Receipt, ShieldCheck, Wallet } from 'lucide-react';
import { PageContainer } from '../components/ui/PageContainer';
import { PageHeader } from '../components/ui/PageHeader';
import { RequireAuth } from '../lib/auth';

export const Route = createFileRoute('/help')({
  component: HelpPage,
} as any);

const coreConcepts = [
  {
    icon: BookOpen,
    title: 'The ledger is the source of truth',
    body: 'Fainens builds balances and reports from posted ledger entries. A dashboard number is a view of those entries, not a separate value to maintain.',
  },
  {
    icon: Wallet,
    title: 'Accounts hold balances',
    body: 'Accounts represent cash, cards, savings, investments, and liabilities. Their ledger balances drive net worth and cash movement.',
  },
  {
    icon: Receipt,
    title: 'Transactions explain movement',
    body: 'Income increases your position, expenses reduce it, and transfers move money between accounts without changing income or spending.',
  },
];

const areaLinks = [
  { to: '/transactions', icon: Receipt, title: 'Transactions', body: 'Record, review, categorize, and correct activity.' },
  { to: '/accounts', icon: Wallet, title: 'Accounts', body: 'See balances and reconcile them with reality.' },
  { to: '/budget', icon: PiggyBank, title: 'Budget', body: 'Set a plan and compare it with recorded spending.' },
  { to: '/reports', icon: FileText, title: 'Reports', body: 'Turn a period of ledger activity into a shareable snapshot.' },
] as const;

const glossary = [
  ['Posted transaction', 'A saved transaction that is included in balances, analysis, and reports.'],
  ['Transfer', 'Money moving between two of your own accounts. It changes account balances but is not income or spending.'],
  ['Reconciliation', 'A check that compares a real-world account balance with the balance calculated from the ledger.'],
  ['Budget variance', 'Planned spending minus recorded spending. A positive amount remains available; a negative amount is over plan.'],
  ['Reporting period', 'The date range used to calculate income, spending, budgets, and the report snapshot.'],
  ['Audit log', 'An immutable record of important changes, useful when you need to understand what changed and when.'],
] as const;

function HelpPage() {
  return <RequireAuth><PageContainer>
    <PageHeader
      subtext="Help & glossary"
      title="How Fainens works"
      description="A plain-language guide to the ledger, accounts, transactions, budgets, and reports behind your numbers."
    />

    <section className="rounded-3xl bg-[var(--ref-primary)] p-6 text-white shadow-sm sm:p-8">
      <div className="max-w-2xl">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/70">A simple mental model</p>
        <h2 className="mt-3 font-headline text-2xl font-extrabold tracking-tight sm:text-3xl">Record once. Understand everywhere.</h2>
        <p className="mt-3 max-w-xl text-sm leading-6 text-white/80">Fainens keeps one ledger and uses it to power balances, budgets, insights, and reports. When a number looks wrong, trace it back to the entries that produced it.</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {['1. Set up accounts', '2. Post transactions', '3. Review the period'].map((step) => <div key={step} className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-semibold">{step}</div>)}
        </div>
      </div>
    </section>

    <section>
      <div className="mb-4"><p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ref-secondary)]">The foundation</p><h2 className="mt-1 font-headline text-2xl font-extrabold tracking-tight text-[var(--ref-on-surface)]">Three things to know</h2></div>
      <div className="grid gap-4 lg:grid-cols-3">{coreConcepts.map(({ icon: Icon, title, body }) => <article key={title} className="rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-5 shadow-sm"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--ref-primary)]/10 text-[var(--ref-primary)]"><Icon className="h-5 w-5" aria-hidden="true" /></span><h3 className="mt-4 font-headline text-base font-extrabold text-[var(--ref-on-surface)]">{title}</h3><p className="mt-2 text-sm leading-6 text-[var(--ref-on-surface-variant)]">{body}</p></article>)}</div>
    </section>

    <section className="grid gap-5 lg:grid-cols-[1.05fr_.95fr]">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-5 shadow-sm sm:p-6">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ref-secondary)]">Money flow</p>
        <h2 className="mt-1 font-headline text-xl font-extrabold text-[var(--ref-on-surface)]">How a number gets to your dashboard</h2>
        <div className="mt-5 space-y-3">{[
          ['Account', 'Choose where the money came from or went to.'],
          ['Transaction', 'Describe the real-world event and its amount.'],
          ['Ledger entry', 'Fainens posts the balanced accounting movement.'],
          ['Views', 'Balances, budgets, analytics, and reports read the same record.'],
        ].map(([title, body], index) => <div key={title} className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--ref-surface-container-low)] text-xs font-bold text-[var(--ref-primary)]">{index + 1}</span><div><p className="text-sm font-bold text-[var(--ref-on-surface)]">{title}</p><p className="mt-0.5 text-sm leading-5 text-[var(--ref-on-surface-variant)]">{body}</p></div></div>)}</div>
      </div>
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-5 shadow-sm sm:p-6">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ref-secondary)]">When something looks wrong</p>
        <h2 className="mt-1 font-headline text-xl font-extrabold text-[var(--ref-on-surface)]">Trace it from the view back to the ledger</h2>
        <div className="mt-5 space-y-3 text-sm leading-6 text-[var(--ref-on-surface-variant)]"><p>Start with the period and account filters. Then open the transaction behind the total and check its type, amount, date, and category.</p><p>For balance differences, compare the account with a real statement using reconciliation. For unexpected edits, use the security audit.</p></div>
        <div className="mt-5 flex flex-wrap gap-3"><Link to="/transactions" className="inline-flex items-center gap-1 text-sm font-bold text-[var(--ref-primary)] hover:underline">Review transactions <ArrowRight className="h-4 w-4" /></Link><Link to="/audit-log" className="inline-flex items-center gap-1 text-sm font-bold text-[var(--ref-primary)] hover:underline">Open audit log <ShieldCheck className="h-4 w-4" /></Link></div>
      </div>
    </section>

    <section>
      <div className="mb-4"><p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ref-secondary)]">Go deeper</p><h2 className="mt-1 font-headline text-2xl font-extrabold tracking-tight text-[var(--ref-on-surface)]">Find the right place</h2></div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{areaLinks.map(({ to, icon: Icon, title, body }) => <Link key={to} to={to} className="group rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--ref-primary)]"><Icon className="h-5 w-5 text-[var(--ref-primary)]" aria-hidden="true" /><h3 className="mt-4 font-headline text-base font-extrabold text-[var(--ref-on-surface)]">{title}</h3><p className="mt-2 text-sm leading-5 text-[var(--ref-on-surface-variant)]">{body}</p><span className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-[var(--ref-primary)]">Open <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" /></span></Link>)}</div>
    </section>

    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] p-5 sm:p-6">
      <div className="mb-4"><p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ref-secondary)]">Glossary</p><h2 className="mt-1 font-headline text-2xl font-extrabold tracking-tight text-[var(--ref-on-surface)]">Words you’ll see in Fainens</h2></div>
      <dl className="grid gap-x-8 gap-y-5 md:grid-cols-2">{glossary.map(([term, definition]) => <div key={term}><dt className="text-sm font-extrabold text-[var(--ref-on-surface)]">{term}</dt><dd className="mt-1 text-sm leading-5 text-[var(--ref-on-surface-variant)]">{definition}</dd></div>)}</dl>
    </section>
  </PageContainer></RequireAuth>;
}
