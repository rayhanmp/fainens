import type { ReactNode } from 'react';
import type { LinkProps } from '@tanstack/react-router';
import {
  ArchitectureDiagram,
  LedgerFlow,
  PeriodTimeline,
  SplitBillDemo,
  YourSetup,
} from './visuals';
import { PracticeComposer, PracticeSplitBill } from './PracticeComposer';
import { WorkedMonth } from './WorkedMonth';
import { AgentAnswerDemo, AgentLookupDemo, AgentProposalDemo } from './AgentVisuals';
import { ComposerDemo, InstallmentDemo, TransferDemo } from './ComposerVisuals';
import { SettingsPreviewDemo } from './SettingsVisuals';
import { SalaryAndRenewalDemo } from './SalaryVisuals';
import { MismatchDemo, ReconcileDemo } from './ReconcileVisuals';
import { ImportFlowDemo } from './ImportVisuals';
import { ClaimPipelineDemo } from './ClaimVisuals';
import { CorrectionDemo } from './TransactionVisuals';
import { LoanRepaymentDemo } from './LoanVisuals';
import { AgentFlow, SaveTransactionFlow } from './TechVisuals';
import { SchemaDiagram } from './SchemaDiagram';
import { RecapPlayerDemo } from './RecapVisuals';
import { LiveReports } from './ReportVisuals';
import { HiddenBalanceDemo, SampleDashboardDemo } from './DashboardVisuals';
import { LiveCategoryViews, LiveDashboardCharts } from './LiveVisuals';
import { BudgetForecastDemo, BudgetRowsDemo, ClosedBudgetDemo } from './BudgetVisuals';
import {
  AgentContextDemo,
  CanISummaryDemo,
  GlossaryCardDemo,
  SavingsFanDemo,
  ShortcutsDemo,
  WhatsNewDemo,
} from './PageVisuals';

/**
 * The help docs: one entry per page, grouped as in the sidebar. Every fact was checked against the
 * code (limits, rules, supported formats); when a feature changes, update its page here.
 */

type DocLink = { to: LinkProps['to']; label: string };

export type DocBlock =
  | { type: 'p'; text: string }
  | { type: 'h2'; id: string; text: string }
  | { type: 'steps'; items: string[] }
  | { type: 'list'; items: string[] }
  | { type: 'callout'; tone: 'tip' | 'note' | 'warning'; title?: string; text: string }
  /** `wide` lets a visual step out of the reading column on wide screens; only for ones laid out to use the room. */
  | { type: 'visual'; node: ReactNode; wide?: boolean }
  | { type: 'table'; head: [string, string]; rows: Array<[string, string]> }
  | { type: 'qa'; items: Array<{ q: string; a: string }> }
  | { type: 'open'; link: DocLink }
  | { type: 'special'; name: 'can-i' | 'limits' | 'shortcuts' | 'glossary' | 'changelog' }
  /** The exact ledger lines Fainens posts, collapsed by default. `{cash}`, `{cash2}` and `{paylater}` become the reader’s own account names. */
  | { type: 'under-hood'; entries: LedgerEntry[] };

export type LedgerEntry = {
  title: string;
  lines: Array<{ account: string; debit?: string; credit?: string; note?: string }>;
  explain: string;
};

export type DocPage = {
  slug: string;
  group: string;
  title: string;
  /** One line, used in lists and search results. */
  summary: string;
  lead: string;
  blocks: DocBlock[];
  related?: string[];
};

export const DOC_GROUPS = ['Getting started', 'Everyday money', 'Insights', 'Planning', 'Debts and sharing', 'Agent and your data', 'Reference'] as const;

/** Pages that were merged into another, so old links (and bookmarks) still land somewhere. */
export const DOC_REDIRECTS: Record<string, { slug: string; hash?: string }> = {
  welcome: { slug: 'how-it-works' },
  'key-ideas': { slug: 'how-it-works', hash: 'balances' },
  transfers: { slug: 'recording', hash: 'transfers' },
  periods: { slug: 'periods-budgets' },
  budgets: { slug: 'periods-budgets', hash: 'budget' },
  limits: { slug: 'can-i', hash: 'limits' },
};

export const DOCS: DocPage[] = [
  // ── Getting started ───────────────────────────────────────────────
  {
    slug: 'how-it-works',
    group: 'Getting started',
    title: 'How Fainens works',
    summary: 'One ledger, pay periods, and what counts as spending',
    lead: 'Fainens is a private finance app built around one ledger. You record money once; balances, budgets, reports and recaps are all read from that same record.',
    blocks: [
      { type: 'visual', node: <LedgerFlow />, wide: true },
      { type: 'h2', id: 'mental-model', text: 'The idea in one sentence' },
      { type: 'p', text: 'Every rupiah that moves is written down as a transaction, and every number you see is a view of those transactions. When something looks off, you can always trace it back to the entries behind it.' },
      { type: 'h2', id: 'what-you-can-do', text: 'What you can do with it' },
      { type: 'list', items: ['Record spending, income and transfers in seconds, or let bank emails and Agent draft them for you.', 'Plan a budget for each salary period and watch it fill in.', 'Track loans, pay later, split bills, subscriptions and reimbursements without them counting as spending.', 'Reconcile accounts against your bank so balances stay right.', 'Ask Agent about your own money, and replay each period as a recap.'] },
      { type: 'h2', id: 'balances', text: 'Every entry balances' },
      { type: 'p', text: 'Money always comes from somewhere and goes somewhere. A Rp45.000 lunch paid from BCA records Rp45.000 of spending (tagged Food & dining) and takes Rp45.000 out of BCA. Fainens keeps every amount in whole rupiah.' },
      { type: 'h2', id: 'posted', text: 'Posted, draft and pending' },
      { type: 'table', head: ['State', 'What it means'], rows: [['Posted', 'Counts in balances, budgets and reports. Kept permanently; corrected, never erased.'], ['Draft', 'Doesn’t count yet. Edit or delete freely, then post (for example in Backfill).'], ['Pending', 'Imported (for example from a bank email) and waiting for your approval.']] },
      { type: 'h2', id: 'periods', text: 'Periods follow your pay' },
      { type: 'visual', node: <PeriodTimeline />, wide: true },
      { type: 'h2', id: 'not-spending', text: 'Not everything is spending' },
      { type: 'p', text: 'Transfers between your own accounts, money you lend, loan repayments, other people’s share of a split bill, and expenses waiting to be reimbursed all move money, but none of them is spending.' },
      { type: 'h2', id: 'you-confirm', text: 'Nothing posts without you' },
      { type: 'p', text: 'Bank emails wait as pending items, salary and subscription renewals ask first, and Agent’s drafts need your approval.' },
      { type: 'callout', tone: 'note', title: 'Private by design', text: 'Fainens is a single-user app: only its owner’s Google account can sign in.' },
    ],
    related: ['quick-start', 'a-month', 'glossary'],
  },
  {
    slug: 'quick-start',
    group: 'Getting started',
    title: 'Quick start',
    summary: 'Set up Fainens in four steps',
    lead: 'Fifteen minutes now saves you guesswork later. Do these four things in order.',
    blocks: [
      { type: 'visual', node: <YourSetup /> },
      { type: 'h2', id: 'accounts', text: '1. Add your accounts' },
      { type: 'steps', items: ['Open Accounts and choose Add account.', 'Pick Asset for money you hold (bank, e-wallet, cash, investments) or Liability for what you owe (credit card, pay later).', 'Enter today’s balance as the opening balance.', 'Repeat for every place your money lives, and pin the ones you use most.'] },
      { type: 'open', link: { to: '/accounts', label: 'Open Accounts' } },
      { type: 'h2', id: 'payday', text: '2. Set your salary day' },
      { type: 'p', text: 'Budgets and reports follow your pay cycle, not the calendar month. Set your salary day in Settings → General, then create your first period in Income & salary → Salary periods.' },
      { type: 'open', link: { to: '/periods', label: 'Open Salary periods' } },
      { type: 'h2', id: 'record', text: '3. Record what you spend' },
      { type: 'p', text: 'Press N anywhere (or the + button on phones). Shorthand like 25k works, and Fainens suggests a category from the name.' },
      { type: 'visual', node: <ComposerDemo /> },
      { type: 'visual', node: <PracticeComposer /> },
      { type: 'h2', id: 'budget', text: '4. Plan a budget' },
      { type: 'p', text: 'Open Budget, choose Manage budget, and give each category an amount. Start from scratch, from a preset, or by copying last period.' },
      { type: 'open', link: { to: '/budget', label: 'Open Budget' } },
      { type: 'callout', tone: 'tip', title: 'Then, once a week', text: 'Glance at the Dashboard’s Needs attention strip, approve pending items in Transactions, and reconcile your main accounts.' },
    ],
    related: ['a-month', 'recording', 'periods-budgets'],
  },
  {
    slug: 'a-month',
    group: 'Getting started',
    title: 'A month, step by step',
    summary: 'Follow one salary period from payday to close',
    lead: 'Ten everyday moments from one period, from payday to closing it. Step through them to see what each one records and what it does to your balances and budget.',
    blocks: [
      { type: 'visual', node: <WorkedMonth />, wide: true },
      { type: 'h2', id: 'takeaways', text: 'What to notice' },
      { type: 'list', items: [
        'Spent ends at Rp4.270.500, which isn’t the same as what left your accounts: the top-up, your friends’ shares, the installment and the reconcile all moved money without being spending.',
        'The pay-later purchase counted in full on the day you bought it. Paying the installment later only lowered the debt.',
        'Only your share of the dinner was spending. What Ani and Budi owed showed up under Owed to you.',
        'The typo wasn’t deleted: it was cancelled by a correction, so the history still adds up.',
        'Reconciling fixed the balance without counting as spending, so your budget stayed accurate.',
      ] },
      { type: 'callout', tone: 'tip', title: 'Do it with your own money', text: 'Your real period works the same way. Open Transactions and filter by account or category to see every entry behind a number.' },
      { type: 'open', link: { to: '/transactions', label: 'Open Transactions' } },
    ],
    related: ['recording', 'pay-later', 'split-bills', 'fixing-mistakes'],
  },

  // ── Everyday money ────────────────────────────────────────────────
  {
    slug: 'recording',
    group: 'Everyday money',
    title: 'Recording and transfers',
    summary: 'Expenses, income, transfers, receipts and rides',
    lead: 'The composer handles everyday entries in a few taps, and switches to a full journal when you need it.',
    blocks: [
      { type: 'visual', node: <ComposerDemo /> },
      { type: 'h2', id: 'basics', text: 'Add an expense or income' },
      { type: 'steps', items: ['Press N anywhere, or Add transaction (the + button on phones).', 'Choose Expense, Income, Transfer or Settle PayLater.', 'Enter the amount, a name, the category and the account.', 'Read the sentence at the bottom to check it, then save.'] },
      { type: 'visual', node: <PracticeComposer /> },
      { type: 'callout', tone: 'tip', text: 'Defaults come from Settings → Accounts, and Fainens remembers the accounts and categories you use most.' },
      { type: 'h2', id: 'journal', text: 'One payment, several categories' },
      { type: 'p', text: 'Switch the composer’s header from Simple to Journal and add a line for each category. The lines must add up to what you paid.' },
      { type: 'h2', id: 'receipts', text: 'Receipts and photos' },
      { type: 'p', text: 'Attach a receipt in the composer: images, PDF, text, CSV and Excel files up to 5 MB each. Every image also appears in Image storage.' },
      { type: 'h2', id: 'rides', text: 'Gojek and Grab rides' },
      { type: 'p', text: 'Choose a transport category and a trip section appears: set pickup and drop-off on a map, the provider and the service. Save a route you take often and reuse it next time.' },
      { type: 'h2', id: 'tags', text: 'Tags, notes and places' },
      { type: 'p', text: 'Add tags (Fainens suggests some), a note, or a place. These can always be changed later, even after posting.' },
      { type: 'h2', id: 'transfers', text: 'Transfers between your accounts' },
      { type: 'p', text: 'A transfer moves money between two of your accounts. Both balances change, but nothing is income or spending.' },
      { type: 'visual', node: <TransferDemo /> },
      { type: 'steps', items: ['Press N and choose Transfer.', 'Pick the account the money leaves and the one it arrives in. Use swap to flip them.', 'If there was a fee, enter it and choose who paid it: sender or recipient.', 'Save.'] },
      { type: 'h2', id: 'fees', text: 'Transfer fees you pay every time' },
      { type: 'p', text: 'If moving money between two accounts always costs the same, set it once in Settings → Accounts → Transfer fees and it’s added automatically.' },
      { type: 'callout', tone: 'note', text: 'Transfers move money between your asset accounts, like bank to e-wallet. Pay-later installments are paid from Pay later, or with Settle PayLater in the composer.' },
      { type: 'under-hood', entries: [
        { title: 'Rp45.000 lunch paid from {cash}, category Food & dining', lines: [{ account: 'Expense (Auto)', note: 'Category: Food & dining', debit: '45.000' }, { account: '{cash}', credit: '45.000' }], explain: 'The spending is counted once, in the built-in Expense (Auto) account, labelled with its category. That label is what budgets and reports group by.' },
        { title: 'Rp1.000.000 income into {cash}', lines: [{ account: '{cash}', debit: '1.000.000' }, { account: 'Income (Auto)', credit: '1.000.000' }], explain: 'Income always lands in the built-in Income (Auto) account. CSV imports, Agent drafts and approved bank emails post exactly the same lines.' },
        { title: 'Rp100.000 from {cash} to {cash2}', lines: [{ account: '{cash2}', debit: '100.000' }, { account: '{cash}', credit: '100.000' }], explain: 'No income or expense account is touched, which is why a transfer never counts as spending.' },
        { title: '…with a Rp2.500 fee paid by the sender', lines: [{ account: 'Expense (Auto)', note: 'Category: Bank & Transfer Fees', debit: '2.500' }, { account: '{cash}', credit: '2.500' }], explain: 'The fee is a separate, linked expense from the account that paid it. Altogether {cash} goes down Rp102.500 and {cash2} up Rp100.000. If the recipient pays the fee instead, it comes out of {cash2}, which then goes up Rp97.500.' },
      ] },
      { type: 'h2', id: 'finding', text: 'Finding transactions' },
      { type: 'list', items: [
        'Tabs at the top narrow the list to Spending, Income, Transfers or Loans. Sort by newest, oldest or largest.',
        'Filters cover amount (from and to), dates, account and category, and whether to include corrections; on phones you can also filter by tag or split bill. Each filter shows as a chip you can remove.',
        'The summary above the list shows each category’s share and a day-by-day chart. Click a category or a day to filter to it. On phones, tap Insights to show them.',
        'On the Accounts page, click an account’s name to see just its transactions.',
      ] },
      { type: 'h2', id: 'row-actions', text: 'More you can do with a transaction' },
      { type: 'list', items: [
        'Repeat transaction opens the composer with the same details, for things you buy again.',
        'Void renewal, on a subscription renewal you were never charged for, cancels it.',
        'On phones, swipe a row to Reimburse, Correct or Delete.',
        'More tools has Export this page, Import CSV, Backfill history, Split a receipt, Review pending, and Compact rows for a denser list.',
        'Add transaction fills in the account, category and period from the page you’re on.',
      ] },
      { type: 'h2', id: 'reallocation', text: 'Reallocations' },
      { type: 'p', text: 'Sometimes money comes in that isn’t really income, and goes straight back out: a refund or a repayment for something paid before you started tracking, which you then spend again. Link the two with Link as reallocation in the row menu, and give a reason.' },
      { type: 'p', text: 'The matched amount is left out of income, spending and budgets, while both bank movements stay recorded. Anything beyond the matched amount is still counted as usual. Unlink it any time.' },
      { type: 'open', link: { to: '/transactions', label: 'Open Transactions' } },
    ],
    related: ['fixing-mistakes', 'importing', 'pay-later'],
  },
  {
    slug: 'fixing-mistakes',
    group: 'Everyday money',
    title: 'Fixing mistakes',
    summary: 'Edits, corrections, and why some things are locked',
    lead: 'You can always fix a mistake, but posted history is never erased. Small details are edited in place; anything that changes money is corrected.',
    blocks: [
      { type: 'h2', id: 'edit', text: 'Edit the details' },
      { type: 'p', text: 'Open a transaction to change its description, date (within the same period), note, place, reference or tags, then Apply changes.' },
      { type: 'h2', id: 'correct', text: 'Correct the amount, account or category' },
      { type: 'steps', items: ['Open the transaction’s row menu and choose Correct transaction.', 'Fainens posts an equal and opposite entry that cancels the original.', 'Choose Add replacement and record it the right way.'] },
      { type: 'visual', node: <CorrectionDemo /> },
      { type: 'under-hood', entries: [
        { title: 'Correcting a Rp45.000 expense paid from {cash}', lines: [{ account: '{cash}', debit: '45.000' }, { account: 'Expense (Auto)', note: 'Category: Food & dining, −45.000', credit: '45.000' }], explain: 'The correction mirrors the original exactly and links back to it; the original is marked reversed. It’s dated today, so it lands in the current period; choose “Move to the original’s date” if both periods are open. Linked entries, such as a transfer’s fee, are corrected together.' },
      ] },
      { type: 'h2', id: 'locked', text: 'Why can’t I change it?' },
      { type: 'qa', items: [
        { q: 'It belongs to another feature', a: 'Entries made by loans, pay later, salary, subscriptions, split bills, reimbursements and reconciliations are changed from their own page.' },
        { q: 'Its period is closed', a: 'Reopen the period in Salary periods, make the change, then close it again.' },
        { q: 'I want to delete it', a: 'Posted entries can’t be deleted; correct them instead. Drafts can be deleted.' },
      ] },
      { type: 'callout', tone: 'tip', text: 'Not sure what changed? Security audit lists important changes and when they happened.' },
    ],
    related: ['periods-budgets', 'accounts', 'troubleshooting'],
  },
  {
    slug: 'accounts',
    group: 'Everyday money',
    title: 'Accounts and reconciling',
    summary: 'Balances, pinning, and matching your bank',
    lead: 'Accounts are where your money lives and what you owe. Reconciling keeps them honest.',
    blocks: [
      { type: 'h2', id: 'types', text: 'Assets and liabilities' },
      { type: 'table', head: ['Kind', 'Examples'], rows: [['Asset · cash', 'Bank accounts, e-wallets, cash'], ['Asset · receivable', 'Money someone owes you'], ['Asset · investment', 'Savings, funds, stocks'], ['Liability', 'Credit cards, pay later (Kredivo, SPayLater, GoPayLater…)']] },
      { type: 'p', text: 'Liabilities can also have a credit limit, interest rate and due day. Pin accounts you use most, switch between list and wallet views, and archive accounts you no longer use (they need a zero balance first; archiving keeps their history).' },
      { type: 'h2', id: 'page', text: 'Reading the Accounts page' },
      { type: 'list', items: [
        'The top card shows net worth, assets and liabilities, and how many accounts have been checked against the bank, with when you last did it.',
        'Accounts are grouped automatically from their names and providers (cash, e-wallets, prepaid, investments, receivables, credit cards, pay later), each group with its total.',
        'Each card shows whether it’s been reconciled (not checked yet, needs review, or verified) and, for credit, how much of the limit is used.',
        'Filter to assets or liabilities, search, sort by balance or name, and show archived accounts to restore one. Export the list as CSV.',
        'When adding an account you can also note its number (shown masked), provider, billing date and how an asset should be counted.',
      ] },
      { type: 'h2', id: 'reconcile', text: 'Reconcile with your bank' },
      { type: 'visual', node: <ReconcileDemo /> },
      { type: 'steps', items: ['Open Accounts and choose Reconcile.', 'For a routine check, enter the balance each bank shows today.', 'Look at any difference and check for a missing or doubled transaction first.', 'Confirm to record what’s left as a balance adjustment. You can void it later with a reason.'] },
      { type: 'callout', tone: 'note', title: 'Coming back after a gap?', text: 'Choose “Catch up after a gap” in Reconcile for a one-time bridge across all accounts.' },
      { type: 'under-hood', entries: [
        { title: 'Opening balance: {cash} starts at Rp1.000.000', lines: [{ account: '{cash}', debit: '1.000.000' }, { account: 'Balance adjustments', note: 'Built-in equity account', credit: '1.000.000' }], explain: 'A starting balance isn’t income, so it’s recorded against Balance adjustments. It’s only possible before the account has any activity.' },
        { title: 'Reconcile: Fainens says Rp1.000.000, {cash} says Rp950.000', lines: [{ account: 'Balance adjustments', debit: '50.000' }, { account: '{cash}', credit: '50.000' }], explain: 'The gap is corrected through the same equity account, so it never counts as income, spending, or budget. One reconcile covers all the accounts you changed.' },
      ] },
      { type: 'open', link: { to: '/accounts', label: 'Open Accounts' } },
    ],
    related: ['periods-budgets', 'fixing-mistakes'],
  },
  {
    slug: 'importing',
    group: 'Everyday money',
    title: 'Importing transactions',
    summary: 'Gmail, CSV files and statement batches',
    lead: 'Three ways to get transactions in without typing them, and all of them let you check before anything posts.',
    blocks: [
      { type: 'h2', id: 'gmail', text: 'Bank emails from Gmail' },
      { type: 'visual', node: <ImportFlowDemo /> },
      { type: 'steps', items: ['In Transactions, choose Connect Gmail and allow read-only access.', 'Fainens checks for new emails every 15 minutes, or when you press Sync now.', 'Open Review pending to approve, edit or reject each one.'] },
      { type: 'callout', tone: 'warning', title: 'Only wondr by BNI for now', text: 'Fainens reads “Transaction successful” emails from wondr by BNI. Other banks and e-wallets need CSV for now.' },
      { type: 'h2', id: 'csv', text: 'CSV files' },
      { type: 'p', text: 'One row per income or expense. Columns are matched by name:' },
      { type: 'table', head: ['Column', 'Needed?'], rows: [['date', 'Required · 18/10/2026 works best'], ['amount', 'Required'], ['description', 'Required'], ['account', 'Required · must already exist'], ['type', 'Required · income or expense'], ['category, period, notes, reference', 'Optional']] },
      { type: 'p', text: 'Import from Transactions → More tools → Import CSV. Up to 1,000 rows per file.' },
      { type: 'h2', id: 'backfill', text: 'Statement batches (Backfill)' },
      { type: 'p', text: 'For months of history, create a Backfill batch and import a statement. Fainens maps the columns, spots duplicates, pairs transfers between your accounts, and lets you set categories in bulk. Post the batch when it looks right.' },
      { type: 'list', items: [
        'While importing, switch on “Money out is written as positive” if your bank lists spending without a minus sign, and include or exclude individual rows.',
        'Filter drafts by what still needs a category, salary, month, tag or account; add a tag to many at once, or delete them.',
        'Unpair two rows Fainens wrongly matched as a transfer.',
        'Before posting, see how each account’s balance will change and which periods are touched. Drafts in a closed period are marked.',
      ] },
      { type: 'h2', id: 'settle', text: 'Settle and post' },
      { type: 'p', text: 'Old transactions change past balances, and usually today’s too. When you post a batch, Settle and post asks what each account should do:' },
      { type: 'table', head: ['Choice', 'What happens'], rows: [
        ['Let it move', 'The account’s balance changes by the drafts’ total. Right when the history is truly new to Fainens.'],
        ['Keep today’s', 'Today’s balance stays as it is; an offsetting adjustment is booked on the date you choose. Suggested when you reconciled the account after those months, since that already counted them.'],
        ['Match a balance', 'Enter the balance your bank showed on a date, and the offset makes Fainens agree with it.'],
      ] },
      { type: 'open', link: { to: '/backfill', label: 'Open Backfill' } },
    ],
    related: ['recording', 'can-i'],
  },

  // ── Insights ──────────────────────────────────────────────────────
  {
    slug: 'dashboard',
    group: 'Insights',
    title: 'The Dashboard',
    summary: 'Your period at a glance, and how to make it yours',
    lead: 'The Dashboard is your decision centre: where this period stands, what needs attention, and what’s coming, for the period you pick at the top.',
    blocks: [
      { type: 'visual', node: <SampleDashboardDemo />, wide: true },
      { type: 'h2', id: 'glance', text: 'At a glance' },
      { type: 'p', text: 'The top card shows one headline number, which you choose: cash, budget left, or net worth. Under it, a pacing bar compares how far you are through the period with how much of the budget is used (“Day 12 of 30 · 48% budget used”), with a safe daily pace and what’s due in the next 30 days. On phones this becomes a Today card and a Safe daily pace card.' },
      { type: 'h2', id: 'pulse', text: 'Financial pulse' },
      { type: 'p', text: 'A strip of 2 to 6 tiles with the numbers you care about. Click a tile’s label to swap it for another, or choose Edit to add, remove and reorder (arrow keys move a tile, Delete removes it).' },
      { type: 'table', head: ['Group', 'Metrics you can pick'], rows: [
        ['This period', 'Cash flow, savings rate, income, spending, spending vs last period, daily spend, number of transactions, top category'],
        ['Budget', 'Budget used, safe daily pace, days left'],
        ['Wealth', 'Net worth, net worth change, debt, owed to you, monthly burn, cash runway'],
        ['Bills and follow-ups', 'Upcoming payments, monthly subscriptions, reimbursements due, items waiting for review'],
      ] },
      { type: 'h2', id: 'budget-health', text: 'Budget health and the forecast' },
      { type: 'p', text: 'Each category is a tile sized by its plan, showing how much is spent and where it’s likely to finish. The summary counts categories over plan and at risk, and the likely total by period end. Phones show the same as a list.' },
      { type: 'p', text: 'The likely finish is your spending so far, plus subscription renewals still scheduled in the period, plus what you typically spent over the rest of the period in past completed periods (the median, lined up by day of the pay cycle). Unusually large one-off purchases from the past are counted less, using a review Agent runs in the background. With no completed periods yet, there’s no forecast.' },
      { type: 'visual', node: <BudgetForecastDemo /> },
      { type: 'callout', tone: 'note', text: 'The forecast is an estimate. It never changes your budget or your ledger.' },
      { type: 'h2', id: 'charts', text: 'Charts and panels' },
      { type: 'visual', node: <LiveDashboardCharts />, wide: true },
      { type: 'list', items: [
        'Net worth trend for this period, 7 days, 30 days, 3, 6 or 12 months. Your choice is remembered.',
        'Spending activity for the last 30 days or this period, as a calendar heatmap, weekly bars or a cumulative line (pick in its gear menu).',
        'Upcoming payments: renewals, installments and loans that are due.',
        'Recent activity: your latest transactions.',
      ] },
      { type: 'h2', id: 'attention', text: 'Needs attention and notifications' },
      { type: 'p', text: 'The bell collects alerts such as overdue loans or pay-later installments, subscriptions to confirm, budgets over or at risk, accounts that haven’t been reconciled for a while, spending with no category, and periods that aren’t fully tracked. Mark them read or unread, undo, or mark all read.' },
      { type: 'h2', id: 'customise', text: 'Make it yours' },
      { type: 'steps', items: [
        'Open View at the top of the Dashboard.',
        'Pick a preset: Original dashboard, Everyday, Money overview or Minimal. Or show and hide panels one by one.',
        'Choose Edit layout to drag panels into a new order and resize their widths (keyboard works too). Done editing saves it; Reset layout restores the original.',
      ] },
      { type: 'h2', id: 'moving', text: 'Moving around' },
      { type: 'list', items: [
        'Change period with the picker at the top, the ← and → keys, or by swiping the picker on phones.',
        'Tap the eye (or press H) to hide every amount. On the Dashboard, press and hold a hidden amount to peek at it.',
        'The Recap button opens the story of the selected period (see Recaps).',
        'On desktop, the Agent button in the corner offers quick questions about what you’re looking at.',
      ] },
      { type: 'open', link: { to: '/', label: 'Open Dashboard' } },
    ],
    related: ['recaps', 'periods-budgets', 'reports'],
  },
  {
    slug: 'reports',
    group: 'Insights',
    title: 'Reports',
    summary: 'Income statement, balance sheet, cash flow, spending and trends',
    lead: 'Reports turns your ledger into proper financial statements for a period, or for everything you’ve recorded.',
    blocks: [
      { type: 'visual', node: <LiveReports />, wide: true },
      { type: 'table', head: ['Tab', 'What it shows'], rows: [
        ['Income statement', 'Revenue, expenses and net income, with each category'],
        ['Balance sheet', 'What you own, what you owe, and your net worth at the period’s end'],
        ['Cash flow', 'Money in and out, split into operating (everyday), investing and financing (loans and debts). Each section expands to its lines, including balance adjustments'],
        ['Spending', 'A pie chart of your top 7 categories plus everything else, with each share'],
        ['Trends', 'Revenue, expenses and net for the last 6 periods, side by side'],
      ] },
      { type: 'p', text: 'The summary cards at the top show revenue, expenses, net income and net worth, each with its change from the previous period. Choose All periods in the period picker to see everything at once.' },
      { type: 'callout', tone: 'note', title: '“Temporary” and coverage', text: 'A period that hasn’t ended yet is marked Temporary, because its numbers will still change. If a period isn’t fully tracked (see coverage in Periods and budgets), a banner says so: missing activity isn’t the same as zero.' },
      { type: 'h2', id: 'export', text: 'Export' },
      { type: 'p', text: 'Download the income statement, balance sheet or cash flow as CSV, or the income statement as a PDF. For a full monthly report as a PDF, use View report on the Dashboard.' },
      { type: 'open', link: { to: '/reports', label: 'Open Reports' } },
    ],
    related: ['dashboard', 'data-privacy'],
  },
  {
    slug: 'recaps',
    group: 'Insights',
    title: 'Recaps',
    summary: 'Your period told as a short, playful story',
    lead: 'A recap replays a salary period as a story in chapters: what came in, where it went, your busiest days, your habits, and a money personality to finish.',
    blocks: [
      { type: 'visual', node: <RecapPlayerDemo />, wide: true },
      { type: 'h2', id: 'open', text: 'Opening a recap' },
      { type: 'list', items: [
        'On the Dashboard, choose Recap for the period you’re viewing.',
        'In the first week of a new period, a “The Period Edit” card appears on the Dashboard. Open it, or dismiss it with the × once you’ve seen it.',
        'Inside a recap, pick another period from its menu. Once a calendar year has two or more periods, you can also open that year in review.',
      ] },
      { type: 'h2', id: 'chapters', text: 'What’s in it' },
      { type: 'p', text: 'Chapters appear only when there’s enough data for them, so every recap is a little different:' },
      { type: 'table', head: ['Chapter', 'What it tells you'], rows: [
        ['Cover and pace', 'The period’s dates; for a period that’s still running, how fast you’re spending and where that would end up'],
        ['Overview', 'Income, spending, and how much you kept'],
        ['Budget', 'Planned against spent, which categories went over, and unbudgeted spending'],
        ['Comparison', 'Spending against the previous period, matched day for day while a period is still running'],
        ['Categories', 'Where the money went, biggest first'],
        ['Calendar, weekdays and streaks', 'Which days you spent, your busiest day, weekday against weekend, and your longest runs with and without spending'],
        ['Receipts and habits', 'Your biggest purchases, a typical purchase, and things you bought again and again'],
        ['Persona', 'A money personality based on how you spent, with the evidence for it'],
        ['Closing', 'The highlights on one page, with a share card'],
      ] },
      { type: 'p', text: 'Some chapters open with a little game before the reveal: a quick quiz on your biggest category, a slider to guess its share, a slot-machine lever, a hold-for-the-drumroll, a gift to open or a piggy bank to break. Year in review adds month-by-month chapters.' },
      { type: 'h2', id: 'controls', text: 'Controls' },
      { type: 'table', head: ['Do this', 'How'], rows: [
        ['Next or previous chapter', 'Tap anywhere to go on, or the left third to go back; swipe on phones; or press → and ←'],
        ['Pause', 'Space'],
        ['A fresh look', 'New take (or R) rewrites the story and refreshes its figures'],
        ['Sound', 'Cycle between off, sound effects, and music'],
        ['Ask about a chapter', 'The Agent button opens Agent with that chapter as the question'],
      ] },
      { type: 'h2', id: 'share', text: 'Sharing' },
      { type: 'p', text: 'Choose Share card to download an image, or a short story video of the recap. Amounts are left off unless you switch on “Include my financial amounts”, and that switch is unavailable while balances are hidden. The card only draws the fields shown on it.' },
      { type: 'callout', tone: 'note', text: 'Recaps read your recorded transactions only. A period with gaps in tracking tells a partial story.' },
    ],
    related: ['dashboard', 'periods-budgets'],
  },
  {
    slug: 'categories',
    group: 'Insights',
    title: 'Categories and tags',
    summary: 'See where money goes, and organise categories and tags',
    lead: 'The Categories page is both a map of your spending and the place to manage the categories and tags you label it with.',
    blocks: [
      { type: 'h2', id: 'charts', text: 'Spending views' },
      { type: 'visual', node: <LiveCategoryViews />, wide: true },
      { type: 'list', items: [
        'Where the money goes: a map of categories sized by spending, for the last 30 days, this year or all time, by amount or by number of entries.',
        'Spending habits: each category placed by how often you spend on it and how much a purchase usually costs.',
        'Period spend: spending per period. Click a period, or shift-click to select a run of periods, and focus on one category.',
        'Category trends: each category against what’s usual for you.',
      ] },
      { type: 'p', text: 'Click anything in these views to open the transactions behind it.' },
      { type: 'h2', id: 'manage', text: 'Managing categories' },
      { type: 'p', text: 'Add or edit a category’s name, colour and group, and the expense account it uses by default. Archive one you no longer use (with Undo), and restore it later. Archived categories keep their history.' },
      { type: 'h2', id: 'tags', text: 'Tags and tag groups' },
      { type: 'p', text: 'Tags add a second label to any transaction, like a trip, a project or a person. Put tags into groups, drag them between groups, and rename or reorder groups.' },
      { type: 'callout', tone: 'tip', text: 'Categories are what budgets use. Tags are for everything else you want to slice by.' },
      { type: 'open', link: { to: '/categories', label: 'Open Categories' } },
    ],
    related: ['recording', 'periods-budgets'],
  },

  // ── Planning ──────────────────────────────────────────────────────
  {
    slug: 'periods-budgets',
    group: 'Planning',
    title: 'Periods and budgets',
    summary: 'Paydays, budgets per category, and closing a period',
    lead: 'Everything in Fainens is grouped into periods that run from one payday to the next, and each period gets its own budget.',
    blocks: [
      { type: 'h2', id: 'periods', text: 'Salary periods' },
      { type: 'visual', node: <PeriodTimeline />, wide: true },
      { type: 'p', text: 'Set your salary day in Settings → General. In months without that day, the last day of the month is used. Periods never overlap.' },
      { type: 'p', text: 'In Salary periods, create the next period, or set custom dates for one that has no activity yet. Each period shows its income, spending and net, with links to its budget and transactions. Archived periods can be restored.' },
      { type: 'h2', id: 'coverage', text: 'Coverage: how fully a period is tracked' },
      { type: 'table', head: ['Coverage', 'Meaning'], rows: [
        ['Complete', 'Everything that happened in the period is recorded'],
        ['Partial', 'Some activity is missing, for example the period you started tracking in'],
        ['Skipped', 'An untracked break; nothing is recorded or made up'],
      ] },
      { type: 'p', text: 'Set it with Review coverage on a period, with a reason. Fainens uses it to be honest about numbers: partial periods are labelled across the Dashboard, Reports and Recaps, and their totals aren’t treated as the whole story.' },
      { type: 'h2', id: 'budget', text: 'Plan a budget' },
      { type: 'visual', node: <BudgetRowsDemo /> },
      { type: 'steps', items: ['Open Budget and choose Manage budget (Modify budget once a plan exists).', 'Copy the previous period, start from a preset, or start from scratch.', 'Give each category an amount, with a note if you like. Categories with subscriptions due get a suggested amount.', 'Optionally set a savings target, as an amount or a share of income.', 'Read Plan checks and the Allocation audit before you save, for example if one category takes too large a share.'] },
      { type: 'p', text: 'Use Manage presets to preview, apply or delete saved plans. Add a note to the period’s plan (up to 2,000 characters) to remember what you were aiming for.' },
      { type: 'h2', id: 'track', text: 'Track it' },
      { type: 'p', text: 'Sorted by urgency, categories are grouped as Over budget, Needs a look, On track and Not started, and a chip flags Over, Near limit or Ahead of pace (spending faster than the period is passing). Edit amounts inline, move a line to another open period, compare with another period, and save your plan as a preset for next time.' },
      { type: 'list', items: [
        'The overview shows spent and remaining, and how income is planned: spending, saving rate, savings target and anything still unassigned.',
        'Search categories, sort by urgency, name, % used, spent or variance, and filter by status.',
        'Budget health counts each status, and Budget mix shows how the plan is split.',
        'The AI insight card summarises the budget using your Agent model; refresh it any time.',
        'Shortcuts lead to recurring commitments, planned purchases (wishlist), categories and the savings simulator.',
      ] },
      { type: 'callout', tone: 'note', text: 'Only real spending counts: transfers, loans and splits don’t use up a budget. Where each category is likely to finish is shown on the Dashboard (see The Dashboard).' },
      { type: 'open', link: { to: '/budget', label: 'Open Budget' } },
      { type: 'h2', id: 'close', text: 'Close a period' },
      { type: 'visual', node: <ClosedBudgetDemo /> },
      { type: 'steps', items: ['Post or delete any drafts left in the period.', 'Reconcile your accounts so closing balances are right.', 'In Salary periods, choose Close period.'] },
      { type: 'p', text: 'A closed period’s transactions and budget are locked (its budget becomes read-only). Reopen it if you need to correct something, and archive old periods once they’re closed.' },
      { type: 'h2', id: 'break', text: 'After a break' },
      { type: 'p', text: 'Choose Resume tracking and enter the day you came back. The gap is marked skipped, so nothing is made up. Then reconcile your accounts from today.' },
      { type: 'open', link: { to: '/periods', label: 'Open Salary periods' } },
    ],
    related: ['subscriptions-salary', 'accounts', 'a-month'],
  },
  {
    slug: 'subscriptions-salary',
    group: 'Planning',
    title: 'Subscriptions and salary',
    summary: 'Renewals, take-home pay and tax estimates',
    lead: 'Recurring money in and out, without it posting behind your back.',
    blocks: [
      { type: 'visual', node: <SalaryAndRenewalDemo />, wide: true },
      { type: 'h2', id: 'subscriptions', text: 'Subscriptions' },
      { type: 'p', text: 'Add each monthly or annual subscription with the account it’s paid from. You’ll see the monthly total and what renews next. When a renewal is due, Fainens asks: post it, or skip it if you weren’t charged.' },
      { type: 'p', text: 'Subscriptions can be paused or set to end; ones about to expire are flagged. If renewals were missed while you were away, a panel lists them so you can post or skip each one. The timeline shows upcoming renewals and the account each comes from.' },
      { type: 'open', link: { to: '/subscriptions', label: 'Open Subscriptions' } },
      { type: 'h2', id: 'income-page', text: 'The Income & salary page' },
      { type: 'list', items: [
        'Take-home pay, with where your gross pay goes (tax, BPJS) and how it’s calculated.',
        'A payday countdown and what’s been recorded since your last payday.',
        'Income history for 6 or 12 months, salary against other income, with the pay you expected.',
        'This year so far: expected, actual and spent.',
        'If several salaries are due, posting catches up all the missed months at once.',
        'More actions leads to Salary periods and downloads your income as CSV.',
      ] },
      { type: 'h2', id: 'salary', text: 'Salary profile' },
      { type: 'p', text: 'In Income & salary, add your gross pay, payday, PTKP status and BPJS options. Fainens estimates PPh 21, BPJS deductions and your take-home pay, and lets you post your salary when it’s due.' },
      { type: 'h2', id: 'tax', text: 'Yearly tax outlook' },
      { type: 'p', text: 'See your estimated annual tax and mark other income as taxable, final or exempt. A switch chooses whether other taxable income counts at 50% or 100%.' },
      { type: 'callout', tone: 'warning', text: 'These are planning estimates, not a tax filing.' },
      { type: 'under-hood', entries: [
        { title: 'A Rp186.000 subscription renewal from {cash}', lines: [{ account: 'Expense (Auto)', note: 'The subscription’s category', debit: '186.000' }, { account: '{cash}', credit: '186.000' }], explain: 'Each confirmed renewal is an ordinary expense, dated on its due date. Voiding a renewal you weren’t charged for cancels it on that same date.' },
        { title: 'Posting your salary into {cash}', lines: [{ account: '{cash}', debit: 'Take-home' }, { account: 'Income (Auto)', credit: 'Take-home' }], explain: 'Only your take-home pay is posted. Gross pay, PTKP status and the tax and BPJS estimates are kept in the entry’s notes, not as separate lines. One salary per month, and it needs an open period that includes payday.' },
      ] },
      { type: 'open', link: { to: '/salary-income', label: 'Open Income & salary' } },
    ],
    related: ['periods-budgets'],
  },
  {
    slug: 'savings-wishlist',
    group: 'Planning',
    title: 'Savings and wishlist',
    summary: 'Simulations, goals, retirement and planned buys',
    lead: 'Look ahead: what your savings could become, and what you’re saving for.',
    blocks: [
      { type: 'h2', id: 'simulator', text: 'Savings simulator' },
      { type: 'list', items: ['Projection: starting balance, monthly contribution, returns and inflation, with a Monte Carlo range.', 'Scenarios: compare plans side by side (kept in this browser).', 'Goals: start from templates like a 6-month emergency fund or a house down payment.', 'Retirement: include BPJS JHT and JP, salary growth and a lifestyle target.'] },
      { type: 'h2', id: 'reading-projection', text: 'Reading a projection' },
      { type: 'visual', node: <SavingsFanDemo />, wide: true },
      { type: 'list', items: [
        'Switch on Monte Carlo and set a volatility to see a range instead of one line. p50 is the middle outcome; p10 and p90 mean only 1 in 10 runs did worse, or better.',
        'Figures can be shown nominal (future rupiah) or real (in today’s money, after inflation).',
        'The milestone timeline, the month-by-month table and the time to reach your goal update as you change inputs.',
        'Retirement planning takes your BPJS worker type (employee, PU, or independent, BPU), a yearly withdrawal rate, and the JP wage cap into account. It’s a planning estimate, not an official BPJS calculation.',
      ] },
      { type: 'open', link: { to: '/savings-simulator', label: 'Open Savings simulator' } },
      { type: 'h2', id: 'wishlist', text: 'Wishlist' },
      { type: 'p', text: 'Paste a product link from Tokopedia, Shopee, Bukalapak, Lazada or Blibli and the picture and details fill in; other shops are tried too. Set a priority and a target period. When you buy it, mark it fulfilled to record the purchase.' },
      { type: 'p', text: 'Already bought it and recorded the purchase? Use Link to transaction instead of creating a new one. Filter the list by active or fulfilled items and by category; the page also totals what you’ve fulfilled. Open the wishlist from Budget → Planned purchases.' },
      { type: 'open', link: { to: '/wishlist', label: 'Open Wishlist' } },
    ],
    related: ['periods-budgets'],
  },

  // ── Debts and sharing ─────────────────────────────────────────────
  {
    slug: 'loans',
    group: 'Debts and sharing',
    title: 'Loans and contacts',
    summary: 'Money you lent or borrowed',
    lead: 'Keep track of who owes whom, without loans showing up as spending or income.',
    blocks: [
      { type: 'visual', node: <LoanRepaymentDemo /> },
      { type: 'steps', items: ['In Loans, choose New loan.', 'Pick Lend or Borrow, the person (or create a contact), the amount and the account the money moved through.', 'Add a due date if there is one.', 'Record each repayment as it comes.'] },
      { type: 'p', text: 'Loans shows what you’re owed, what you owe and the net. Switch between All loans, Contacts and Split bills, and filter by direction and by status: active, overdue, repaid, defaulted or written off.' },
      { type: 'list', items: [
        'Open a contact to see their profile: an overview with your net balance, and every loan between you. Contacts can be labelled as friend, family, colleague and so on, and archived.',
        'Recording a repayment shows the ledger lines it will post before you confirm.',
      ] },
      { type: 'under-hood', entries: [
        { title: 'Lending Rp500.000 from {cash}', lines: [{ account: 'Loans Receivable', debit: '500.000' }, { account: '{cash}', credit: '500.000' }], explain: 'Cash turns into money owed to you, so your net worth doesn’t change and nothing counts as spending.' },
        { title: 'They pay you back', lines: [{ account: '{cash}', debit: '500.000' }, { account: 'Loans Receivable', credit: '500.000' }], explain: 'A repayment can’t be more than what’s left on the loan.' },
        { title: 'Borrowing Rp500.000 into {cash}', lines: [{ account: '{cash}', debit: '500.000' }, { account: 'Loans Payable', credit: '500.000' }], explain: 'Repaying it reverses these lines. Neither borrowing nor repaying is income or spending.' },
      ] },
      { type: 'open', link: { to: '/loans', label: 'Open Loans' } },
    ],
    related: ['split-bills', 'pay-later'],
  },
  {
    slug: 'pay-later',
    group: 'Debts and sharing',
    title: 'Pay later',
    summary: 'Installments and what’s due',
    lead: 'Buy now, pay in installments: Fainens records the purchase once and schedules the rest.',
    blocks: [
      { type: 'visual', node: <InstallmentDemo /> },
      { type: 'h2', id: 'buy', text: 'Buy with pay later' },
      { type: 'steps', items: ['Record an Expense and choose your pay-later account as the account.', 'Pick 1, 3, 6 or 12 months and the first due date.', 'Add any interest or admin fee and check the schedule.', 'Save.'] },
      { type: 'visual', node: <PracticeComposer label="Try a pay-later purchase" /> },
      { type: 'h2', id: 'pay', text: 'Pay an installment' },
      { type: 'p', text: 'Open Pay later to see the calendar and what each provider is owed, then Pay now on an installment. You can also use Settle PayLater in the composer.' },
      { type: 'list', items: [
        'The top card shows your total outstanding.',
        'The payment calendar marks installments and interest, month by month.',
        'Provider exposure shows how much each provider is owed and how many days until its next due date.',
        'Individual accruals lists every installment; paying one lets you pick the wallet it comes from.',
      ] },
      { type: 'callout', tone: 'note', title: 'When does it count as spending?', text: 'On the purchase date, all of it: the price plus any interest and fee. Paying installments later only reduces the debt, so it doesn’t count as spending again.' },
      { type: 'under-hood', entries: [
        { title: 'Rp600.000 on {paylater}, 3 months, 12% a year, Rp5.000 admin fee', lines: [{ account: 'Expense (Auto)', note: 'Price', debit: '600.000' }, { account: 'Expense (Auto)', note: 'Interest: 600.000 × 1% × 3 months', debit: '18.000' }, { account: 'Expense (Auto)', note: 'Admin fee', debit: '5.000' }, { account: '{paylater}', note: 'Debt', credit: '623.000' }], explain: 'Interest is simple interest on the yearly rate. The fee is added to the first installment, so the schedule is Rp211.000, then Rp206.000, then Rp206.000.' },
        { title: 'Paying the first installment from {cash}', lines: [{ account: '{paylater}', debit: '211.000' }, { account: '{cash}', credit: '211.000' }], explain: 'Only the debt goes down. Payments go to the oldest open installment first.' },
      ] },
      { type: 'open', link: { to: '/paylater', label: 'Open Pay later' } },
    ],
    related: ['loans', 'recording'],
  },
  {
    slug: 'split-bills',
    group: 'Debts and sharing',
    title: 'Split bills',
    summary: 'Share a receipt with friends',
    lead: 'Paid for the group? Split the receipt, share it, and track what each person owes you.',
    blocks: [
      { type: 'visual', node: <SplitBillDemo /> },
      { type: 'steps', items: ['Open Agent, type /split and attach the receipt (or use Transactions → More tools → Split a receipt).', 'Check the items, add people and assign items to them.', 'Choose equal, proportional, or paid by one person.', 'Save it as an image or copy the summary to share.', 'Choose Create linked loans so what friends owe shows up in Loans.'] },
      { type: 'h2', id: 'try', text: 'Try the card' },
      { type: 'visual', node: <PracticeSplitBill /> },
      { type: 'under-hood', entries: [
        { title: 'Rp300.000 dinner paid from {cash}, split equally with Ani and Budi', lines: [{ account: 'Expense (Auto)', note: 'Your share', debit: '100.000' }, { account: 'Loans Receivable', note: 'Ani owes you', debit: '100.000' }, { account: 'Loans Receivable', note: 'Budi owes you', debit: '100.000' }, { account: '{cash}', credit: '300.000' }], explain: 'Only your share is spending. Each friend’s share becomes a loan they owe you, tagged with the bill so you can find it. When they pay you back, it’s recorded like any loan repayment.' },
      ] },
      { type: 'open', link: { to: '/agent', label: 'Open Agent' } },
    ],
    related: ['loans', 'agent'],
  },
  {
    slug: 'reimbursements',
    group: 'Debts and sharing',
    title: 'Reimbursements',
    summary: 'Expenses someone will pay back',
    lead: 'For work trips and paying on someone’s behalf: the expense waits as money owed to you, not spending.',
    blocks: [
      { type: 'visual', node: <ClaimPipelineDemo /> },
      { type: 'steps', items: ['In Transactions, open the expense’s row menu and choose Mark reimbursable (or create a claim in Reimbursements).', 'Save it as a draft, or mark it submitted.', 'Approve it when it’s accepted.', 'Record payment when the money arrives; partial payments are fine.'] },
      { type: 'p', text: 'Filter claims by status, see overdue ones, and open a claim for its linked expenses and receipts.' },
      { type: 'list', items: [
        'The summary cards (awaiting payment, awaiting approval, overdue, received to date) filter the list when you click them.',
        'More statuses covers partially paid, rejected, written off and cancelled claims. Search and sort the list.',
        'A claim can cover just part of an expense, such as one category of a split payment.',
        'Cancel a claim you no longer need, and see a claim’s payment history.',
      ] },
      { type: 'under-hood', entries: [
        { title: 'Marking a Rp150.000 taxi reimbursable', lines: [], explain: 'Nothing is posted yet: a draft or submitted claim is just a record. The taxi still counts as your spending.' },
        { title: 'When the claim is approved', lines: [{ account: 'Reimbursements Receivable', debit: '150.000' }, { account: 'Expense (Auto)', note: 'Category: Transportation, −150.000', credit: '150.000' }], explain: 'From approval on, the taxi stops counting as your spending and becomes money owed to you. It’s dated on the original expense’s date.' },
        { title: 'When the money arrives in {cash}', lines: [{ account: '{cash}', debit: '150.000' }, { account: 'Reimbursements Receivable', credit: '150.000' }], explain: 'Partial payments are fine; one payment can also cover several claims.' },
      ] },
      { type: 'open', link: { to: '/reimbursements', label: 'Open Reimbursements' } },
    ],
    related: ['recording', 'loans'],
  },

  // ── Agent and your data ───────────────────────────────────────────
  {
    slug: 'agent',
    group: 'Agent and your data',
    title: 'Using Agent',
    summary: 'Asking questions, reading answers, and managing chats',
    lead: 'Agent is an assistant that reads your own ledger to answer questions about your money, in plain words with charts, and drafts entries for you to approve.',
    blocks: [
      { type: 'visual', node: <AgentAnswerDemo /> },
      { type: 'h2', id: 'ask', text: 'Asking' },
      { type: 'p', text: 'Write the way you’d ask a friend who keeps your books. Agent looks things up in your ledger before answering, rather than guessing, and asks a quick multiple-choice question when something is unclear.' },
      { type: 'list', items: [
        'Where did my money go this period?',
        'How much did I spend on Grab last month compared with the month before?',
        'Am I on track with my budget? Which categories are close to the limit?',
        'What renewals and pay-later installments are due before payday?',
        'If I keep spending like this, how much will I have in three months?',
        'Who still owes me money?',
      ] },
      { type: 'h2', id: 'scope', text: 'Which period it looks at' },
      { type: 'p', text: 'The Chat scope menu sets the period Agent answers about. It starts on the current period; clear it to ask across everything you’ve recorded. You can still name another period in your question.' },
      { type: 'h2', id: 'answers', text: 'Reading an answer' },
      { type: 'list', items: [
        'Up to two cards per answer: a headline number, a category breakdown, a comparison, a trend, budget progress, cash flow, a projection, a what-if comparison, an allocation, a goal tracker, a worksheet, or a split-bill card.',
        'A Scope chip shows the period it used.',
        '“Evidence checked” lists what it looked up, with links to open the same records in the app.',
        'Charts can offer up to two follow-up questions you can tap.',
        'Copy an answer, Regenerate the latest one, or Save note to download it as a Markdown file.',
      ] },
      { type: 'h2', id: 'composer', text: 'The message box' },
      { type: 'table', head: ['Do this', 'How'], rows: [
        ['Split a receipt', 'Type /split and attach the receipt'],
        ['Draft a transaction', 'Type /trx, then describe it, for example “lunch 45k with GoPay”'],
        ['Attach a photo', 'Type /photo, paste, drag in, or choose from your image storage: up to 3 images (JPEG, PNG, WebP or GIF), 4 MB each and 8 MB in total'],
        ['Change model', 'Type /model or use the model menu at the top. This changes the default model for every chat'],
        ['Send', 'Enter; Shift + Enter for a new line. Messages can be up to 2,000 characters'],
      ] },
      { type: 'p', text: 'While Agent is answering you can press Stop; what it had written so far is kept. You can also leave the page: the answer keeps going and is there when you come back. If an answer was cut off, choose Retry. To change your question, edit your latest message (if it has no images) and Agent answers again.' },
      { type: 'h2', id: 'conversations', text: 'Conversations' },
      { type: 'p', text: 'Each chat keeps its own history and gets a short title automatically. From the list you can rename, pin, archive or delete a chat; deleting also deletes its images. The list also shows what each chat, and today, has cost in model usage.' },
      { type: 'callout', tone: 'note', text: 'One answer runs at a time in each chat. Ask your next question when the current one finishes, or start another chat.' },
      { type: 'open', link: { to: '/agent', label: 'Open Agent' } },
    ],
    related: ['agent-abilities', 'agent-drafts', 'agent-memory'],
  },
  {
    slug: 'agent-abilities',
    group: 'Agent and your data',
    title: 'What Agent can look up',
    summary: 'Everything Agent can check in your money, and what it can’t yet',
    lead: 'Agent answers by reading your records through a fixed set of tools. This is what those tools cover.',
    blocks: [
      { type: 'visual', node: <AgentLookupDemo /> },
      { type: 'table', head: ['Area', 'What Agent can check'], rows: [
        ['Accounts', 'Any account’s balance or all of them, totals by type or liquidity, how each account is treated, and its reconciliation history and differences'],
        ['Transactions', 'Search by text, account, category, amount, type or direction; totals grouped by category, account, merchant, day or month; one transaction’s full lines, note, tags and allocations; similar past transactions; your categories, tags and saved trips'],
        ['Cash flow', 'A period’s income, spending and net; cash flow by operating, investing and financing; comparisons across 2 to 12 periods; a projection of your cash 1 to 60 months ahead'],
        ['Budgets', 'Planned against actual for the whole budget or one category, spending breakdowns, and a review of unusually large past purchases'],
        ['Loans and contacts', 'Who owes you and whom you owe, each loan’s details, and contacts by partial name'],
        ['Pay later', 'What you owe each provider and what’s due'],
        ['Recurring money', 'Subscription renewals and salary postings that are due but not yet recorded'],
        ['Data quality', 'Open, resolved and dismissed anomaly signals'],
        ['Imports', 'Pending transactions from bank emails and other imports'],
        ['Utilities', 'Arithmetic, today’s date and time, the gap between two dates, and reference exchange rates'],
      ] },
      { type: 'callout', tone: 'note', title: 'Exchange rates are for reference', text: 'Rates come from the European Central Bank via Frankfurter. They aren’t part of your ledger, which stays in rupiah.' },
      { type: 'h2', id: 'examples', text: 'Questions that use them well' },
      { type: 'qa', items: [
        { q: 'Why is my BCA balance lower than I expected?', a: 'Agent checks the account’s recent transactions and its last reconciliation, then points to the entries or the adjustment that explain it.' },
        { q: 'Compare my food spending over the last three periods.', a: 'It compares category totals period by period and shows a comparison or trend card.' },
        { q: 'Can I afford a Rp5.000.000 laptop next month?', a: 'It projects your cash from your recorded income and spending and shows the result as a projection, clearly labelled as an estimate, not a promise.' },
        { q: 'Did I already pay Netflix this month?', a: 'It searches for the payment and checks whether the renewal is still due.' },
      ] },
      { type: 'h2', id: 'not-yet', text: 'Not covered yet' },
      { type: 'list', items: [
        'Reimbursement claims, tax estimates, the wishlist and savings simulator, and recaps: Agent can’t read these yet. Open their pages instead.',
        'Deleting anything. Agent has no way to delete transactions, accounts, budgets or loans.',
        'Remembering things on its own. Memories are only the ones you add (see Memory, privacy and models).',
      ] },
      { type: 'callout', tone: 'tip', text: 'Agent can make up to 30 lookups for one answer. For very broad questions, narrowing the period or the account gets you a sharper answer.' },
    ],
    related: ['agent', 'agent-drafts'],
  },
  {
    slug: 'agent-drafts',
    group: 'Agent and your data',
    title: 'Agent drafts and changes',
    summary: 'What Agent can prepare for you, and the few things it changes directly',
    lead: 'Agent never posts money on its own. It prepares a card; you review it, and only Confirm writes to your ledger.',
    blocks: [
      { type: 'visual', node: <AgentProposalDemo /> },
      { type: 'h2', id: 'what', text: 'What it can prepare' },
      { type: 'table', head: ['Draft', 'You confirm with'], rows: [
        ['An expense, income or transfer', 'Confirm & post'],
        ['Up to 20 expenses at once, for example from a receipt or a list', 'Confirm & post on each card'],
        ['A budget for the current open period, up to 100 lines', 'Confirm budget'],
        ['Loans for the people in a split bill, up to 30 people', 'Create linked loans'],
        ['Approving a pending import, such as a bank email', 'Confirm & post on the card it makes'],
      ] },
      { type: 'h2', id: 'review', text: 'Reviewing a draft' },
      { type: 'steps', items: [
        'Read the card: name, amount, category, account and date. Open Ledger entry to see the exact debit and credit lines.',
        'Choose Edit to change the name, amount, date and time, category, account, place, reference or notes, then Save changes. The old draft is replaced.',
        'Choose Confirm & post. The card shows the transaction number once it’s posted.',
        'Or choose Dismiss to throw the draft away.',
      ] },
      { type: 'callout', tone: 'note', title: 'When a draft stops working', text: 'Drafts expire after 15 minutes. A draft also stops working if your data changed after it was made (for example you recorded something else meanwhile), or if you edit or retry the question it answered. Ask again for a fresh one.' },
      { type: 'h2', id: 'direct', text: 'What Agent changes without a card' },
      { type: 'p', text: 'A few small changes that don’t move money are made straight away, and only when you ask for them:' },
      { type: 'list', items: [
        'Adding or changing a transaction’s note.',
        'Adding, removing or replacing a transaction’s tags, and creating a new tag.',
        'Editing the details of a pending import, or rejecting it. Approving one still makes a card.',
        'Starting a review of unusual past purchases for your budget outlook. This only adds notes to the forecast; it never changes amounts.',
      ] },
      { type: 'h2', id: 'rules', text: 'Rules it can’t bend' },
      { type: 'list', items: [
        'Closed periods are locked for Agent exactly as they are for you.',
        'A transfer must be between two of your cash accounts.',
        'Loans, reimbursements and investments can’t be recorded as plain income or spending.',
        'It won’t guess an account: if the one you name doesn’t exist, it asks instead of using another.',
        'Text in receipts, memories and merchant names is treated as information, never as instructions to follow.',
      ] },
    ],
    related: ['agent', 'split-bills', 'fixing-mistakes'],
  },
  {
    slug: 'agent-memory',
    group: 'Agent and your data',
    title: 'Memory, privacy and models',
    summary: 'What Agent knows about you, and which model it uses',
    lead: 'Agent can read your financial records. Everything else it knows about you, you choose.',
    blocks: [
      { type: 'h2', id: 'memory', text: 'Memories' },
      { type: 'p', text: 'Memories are short notes Agent reads at the start of every chat, like “My salary goes to BCA” or “Groceries include household supplies”. Add, edit and delete them from Memory on the Agent page or in Settings → Agent → Memory.' },
      { type: 'list', items: [
        'Up to 50 memories, each with a name of up to 80 characters and text of up to 1,000.',
        'Agent doesn’t save memories by itself. Telling it “remember…” in a chat doesn’t store anything; add the memory yourself.',
        'Memories are context, never evidence: Agent won’t treat one as proof of a transaction or as permission to change data.',
      ] },
      { type: 'h2', id: 'profile', text: 'What Agent can see about you' },
      { type: 'p', text: 'In Settings → Agent → What Agent can see, choose which profile details are shared. Anything switched off is left out, or replaced by a neutral default.' },
      { type: 'visual', node: <AgentContextDemo />, wide: true },
      { type: 'table', head: ['Group', 'Details (“shared” means on by default)'], rows: [
        ['About you', 'Full name, preferred name (shared), pronouns, age (your date of birth is never sent)'],
        ['Region and language', 'Country, time zone (shared), language (shared), currency (shared)'],
        ['Your finances', 'Income pattern, main goal'],
        ['Response style', 'Tone: warm, direct or encouraging (shared). Detail: concise, balanced or detailed (shared)'],
      ] },
      { type: 'callout', tone: 'note', text: 'These settings cover your profile only. Agent can always read your financial records, because that’s how it answers.' },
      { type: 'h2', id: 'insights', text: 'What a chat remembers' },
      { type: 'p', text: 'Within one conversation Agent keeps a few notes of what it has learned (up to 12), so follow-up questions stay consistent. They’re dropped when your data changes and don’t carry over to other chats.' },
      { type: 'h2', id: 'models', text: 'Models' },
      { type: 'steps', items: [
        'Open Settings → Agent → Models and choose Add model.',
        'Pick OpenRouter, OpenAI, or another OpenAI-compatible provider (with its base URL).',
        'Enter the model ID and a name, and optionally your own API key.',
        'Make it the default. /model in a chat switches the default too.',
      ] },
      { type: 'p', text: 'API keys are stored encrypted and never shown again; you can clear a saved key. Without one, the server’s own key is used. At least one model must remain.' },
      { type: 'callout', tone: 'warning', title: 'What leaves the app', text: 'To answer, Agent sends your question, the records it looked up, your memories and the profile details you share to the model provider you chose. Pick a provider you’re comfortable with.' },
    ],
    related: ['agent', 'data-privacy'],
  },
  {
    slug: 'data-privacy',
    group: 'Agent and your data',
    title: 'Backups, exports and privacy',
    summary: 'Keep your data safe and private',
    lead: 'Your ledger is yours. Here’s how to keep a copy, protect reports and keep amounts out of sight.',
    blocks: [
      { type: 'h2', id: 'backups', text: 'Cloud backups' },
      { type: 'p', text: 'Settings → Backups saves snapshots of your database to your cloud storage: weekly, every two weeks, monthly or quarterly, or now with Back up now.' },
      { type: 'h2', id: 'exports', text: 'Exports' },
      { type: 'list', items: ['Settings → Data downloads a JSON copy of the data you choose.', 'Reports exports the income statement, balance sheet and cash flow as CSV.', 'Transactions exports the rows you’re viewing as CSV.', 'The Dashboard’s View report downloads a monthly PDF.'] },
      { type: 'callout', tone: 'warning', text: 'Restoring from a backup or JSON file isn’t available in the app yet.' },
      { type: 'h2', id: 'hide', text: 'Hide balances' },
      { type: 'visual', node: <HiddenBalanceDemo /> },
      { type: 'p', text: 'Use the eye button in the sidebar, or press H on the Dashboard. Phones start with balances hidden.' },
      { type: 'h2', id: 'pdf', text: 'Password-protected reports' },
      { type: 'p', text: 'Turn it on in Settings → PDF reports. The password is your birthday in the order you choose, and each PDF is encrypted before it downloads.' },
      { type: 'h2', id: 'audit', text: 'Security audit' },
      { type: 'p', text: 'See important changes and when they happened. Filter by the kind of record and the action, search, and choose View payload to compare the record before and after the change.' },
      { type: 'h2', id: 'images', text: 'Image storage' },
      { type: 'p', text: 'Every receipt and photo you attach, whether in Agent, on a transaction or in the wishlist, is kept in Image storage. Filter by where it came from, search, preview, and delete images you don’t need.' },
      { type: 'open', link: { to: '/settings', label: 'Open Settings' } },
    ],
    related: ['can-i', 'agent'],
  },

  // ── Reference ─────────────────────────────────────────────────────
  {
    slug: 'can-i',
    group: 'Reference',
    title: 'Can I…? and limits',
    summary: 'What’s supported, what isn’t yet, and the numbers to know',
    lead: 'The quick answer to what Fainens can do, partly does, and doesn’t do yet, plus the limits worth knowing before you hit them.',
    blocks: [
      { type: 'visual', node: <CanISummaryDemo /> },
      { type: 'special', name: 'can-i' },
      { type: 'h2', id: 'limits', text: 'Limits' },
      { type: 'special', name: 'limits' },
    ],
    related: ['importing', 'troubleshooting'],
  },
  {
    slug: 'shortcuts',
    group: 'Reference',
    title: 'Keyboard shortcuts',
    summary: 'Faster with a keyboard',
    lead: 'Shortcuts work when you’re not typing in a field.',
    blocks: [{ type: 'visual', node: <ShortcutsDemo /> }, { type: 'special', name: 'shortcuts' }],
  },
  {
    slug: 'troubleshooting',
    group: 'Reference',
    title: 'Troubleshooting',
    summary: 'When something looks wrong',
    lead: 'The most common surprises, and what to do about them.',
    blocks: [
      { type: 'visual', node: <MismatchDemo /> },
      { type: 'qa', items: [
        { q: 'My balance doesn’t match my bank.', a: 'Reconcile the account in Accounts. Check the difference for a missing or doubled transaction first, then record what’s left as a balance adjustment.' },
        { q: 'A number on the dashboard looks wrong.', a: 'Check which period the Dashboard shows, then open Transactions for that period, filter by the account or category, and check the entries behind the number. Transfers, loans and splits don’t count as spending.' },
        { q: 'I can’t edit or delete a transaction.', a: 'It’s posted (correct it instead), it belongs to another feature (change it from that page), or its period is closed (reopen it first).' },
        { q: 'I can’t close a period.', a: 'It still has drafts. Post or delete them, then close it.' },
        { q: 'My bank email didn’t show up.', a: 'Only wondr by BNI emails are read. Fainens checks every 15 minutes; use Sync now in Transactions, then look in Review pending.' },
        { q: 'Agent’s draft won’t post.', a: 'Drafts expire after 15 minutes or when your data changes. Ask Agent to prepare it again.' },
        { q: 'Something changed and I don’t know why.', a: 'Open Security audit to see important changes and when they happened.' },
      ] },
      { type: 'h2', id: 'data-quality', text: 'Data quality checks' },
      { type: 'p', text: 'Data quality scans your ledger for entries that look like mistakes and lists them for you to review. Choose Scan ledger to check again.' },
      { type: 'table', head: ['Flag', 'What it suggests'], rows: [
        ['Possible 100× amount', 'An amount that looks 100 times too large or small, often from typing cents into a rupiah field'],
        ['Legacy reconciliation plug', 'An old balance adjustment that may be hiding a real missing transaction'],
      ] },
      { type: 'p', text: 'Fix the entry if it’s wrong (correct it as usual), then resolve the flag, or dismiss it if it’s fine. Either way you write a short review note, and the flag moves to the Resolved or Dismissed tab.' },
    ],
    related: ['fixing-mistakes', 'accounts'],
  },
  {
    slug: 'settings',
    group: 'Reference',
    title: 'Settings',
    summary: 'Every setting, and where to find it',
    lead: 'Open Settings from the sidebar (or More on phones). Search for any setting by name, or open a section. Changes save as you make them.',
    blocks: [
      { type: 'visual', node: <SettingsPreviewDemo />, wide: true },
      { type: 'table', head: ['Section', 'What’s in it'], rows: [
        ['Profile', 'Your name, preferred name, pronouns, date of birth, country, time zone, language, currency, income pattern and main goal. Signing out is here too'],
        ['General', 'Display: theme (light, dark or automatic), accent colour, date format, 12- or 24-hour time, the day weeks start, compact rows. Pay cycle: your salary day. Accessibility: text size and reduce motion'],
        ['Accounts', 'The bank, expense and income accounts new transactions start with, and transfer fees you pay every time'],
        ['Agent', 'Response tone and detail, what Agent can see about you, models, and memory'],
        ['Backups', 'Automatic cloud backups of your database, how often they run, and the backups saved so far'],
        ['PDF reports', 'Password protection for monthly report PDFs'],
        ['Data', 'Export a JSON copy of the data you choose; clear this browser; links to Data quality, Image storage and Security audit'],
      ] },
      { type: 'h2', id: 'display', text: 'Display and accessibility' },
      { type: 'list', items: [
        'Date and time formats, and the first day of the week, are used everywhere dates appear, including charts.',
        'Compact rows fits more on screen in long lists.',
        'Larger text scales text and spacing together across the app.',
        'Reduce motion turns animations off, including the ones in these help pages. It also follows your device’s setting.',
      ] },
      { type: 'h2', id: 'this-device', text: 'This device' },
      { type: 'table', head: ['Option', 'What it does'], rows: [
        ['Clear local cache', 'Reloads everything from the server. Your records aren’t affected'],
        ['Clear this browser and sign out', 'Removes everything Fainens keeps in this browser, such as preferences and unsent drafts. Your ledger on the server isn’t touched'],
      ] },
      { type: 'open', link: { to: '/settings', label: 'Open Settings' } },
    ],
    related: ['data-privacy', 'agent-memory'],
  },
  {
    slug: 'technical',
    group: 'Reference',
    title: 'Technical documentation',
    summary: 'Architecture, data model, API, security, jobs and deployment',
    lead: 'How Fainens is built and run: the pieces, where data lives, the rules the server enforces, and how to develop and deploy it.',
    blocks: [
      { type: 'h2', id: 'architecture', text: 'Architecture' },
      { type: 'p', text: 'Fainens is a pnpm monorepo with two apps: frontend (a single-page web app) and backend (an API server plus a background worker built from the same code). In production four containers run with Docker Compose: frontend (nginx), backend, worker and redis.' },
      { type: 'visual', node: <ArchitectureDiagram />, wide: true },
      { type: 'table', head: ['Layer', 'Technology'], rows: [
        ['Web app', 'React 19, TypeScript, Vite, TanStack Router (file routes, code-split) and TanStack Query, Tailwind CSS 4, zustand'],
        ['API server', 'Node.js 20, Fastify 5, zod schemas with fastify-type-provider-zod, OpenAPI via @fastify/swagger'],
        ['Database', 'SQLite through better-sqlite3, Drizzle ORM and SQL migrations'],
        ['Jobs and cache', 'BullMQ on Redis 7'],
        ['Files', 'Cloudflare R2 through the S3 SDK, or a local folder when R2 isn’t configured'],
        ['Hosting', 'Docker Compose; nginx serves the app and forwards /api to the API server; times use Asia/Jakarta'],
      ] },

      { type: 'h2', id: 'data', text: 'Data storage' },
      { type: 'p', text: 'All data lives in one SQLite file, backend/data/fainens.db (set FAINENS_DB_PATH to move it). It is the only source of truth: Redis holds queues and caches that can be rebuilt. The schema is defined with Drizzle in backend/src/db/schema.ts.' },
      { type: 'p', text: 'Migrations are numbered SQL files in backend/drizzle. Both the API server and the worker apply them on startup, check the schema, and refuse to start if it can’t be brought up to date.' },
      { type: 'table', head: ['Area', 'Main tables'], rows: [
        ['Ledger', 'account, transaction (the journal entry), transaction_line (debits and credits), transaction_batch, transaction_category_allocation'],
        ['Labels', 'category, tag, tag_group, transaction_tag'],
        ['Periods and budgets', 'salary_period, budget_plan, budget_template, salary_settings'],
        ['Debts and sharing', 'loan, loan_payment, contact, paylater_installment, splitbill_session'],
        ['Reimbursements', 'reimbursement_claim, reimbursement_receipt and their allocations'],
        ['Recurring', 'subscription, recurring_occurrence'],
        ['Agent', 'agent_conversation, agent_message, agent_memory, agent_pending_action, agent_approval, agent_model'],
        ['Imports', 'pending_transaction, gmail_connection, reconciliation_session'],
        ['Records', 'audit_log (before and after of every change), attachment, database_backup_settings'],
        ['Plumbing', 'financial_state (a revision number), cache_invalidation_outbox, storage_deletion_outbox, background_task'],
      ] },
      { type: 'h2', id: 'relations', text: 'How the ledger tables relate' },
      { type: 'p', text: 'Everything hangs off transaction. Its lines carry the money between accounts; categories and tags label it; its period decides whether it can still change. Feature tables (loans, pay later, reimbursements, subscriptions, attachments, reconciliations) are linked to the transactions they created rather than keeping money of their own.' },
      { type: 'visual', node: <SchemaDiagram />, wide: true },

      { type: 'h2', id: 'ledger', text: 'The ledger model' },
      { type: 'p', text: 'Fainens is double-entry. A transaction is a journal entry with two or more lines, and every line is either a debit or a credit. Amounts are whole rupiah stored as integers; some columns are named “cents” for historical reasons, but fractional rupiah are rejected.' },
      { type: 'list', items: [
        'Every entry is validated before it is written: at least two lines, each with exactly one positive whole-number debit or credit, and total debits equal to total credits.',
        'Account types are asset, liability, equity, revenue and expense. Categories are labels on expense and income lines, not accounts.',
        'Built-in system accounts: Income (Auto), Expense (Auto), Balance adjustments and Historical recovery adjustment.',
        'Posted entries are corrected with a linked reversal that mirrors the original line for line; the original is marked reversed. Entries owned by a feature (loans, pay later, subscriptions and so on) can only be changed from that feature.',
        'Drafts don’t count toward balances and aren’t period-checked until they’re posted.',
      ] },
      { type: 'callout', tone: 'note', title: 'Closed periods are enforced three times', text: 'The server checks the period before a write, checks it again inside the database transaction, and SQLite triggers refuse any transaction inserted into, or moved into, a closed period.' },

      { type: 'h2', id: 'api', text: 'API' },
      { type: 'list', items: [
        'All endpoints are under /api; /health reports the server and /health/worker reports whether a worker is alive.',
        'Requests and responses are described with zod. The OpenAPI contract is generated to contracts/openapi.json, and Orval generates the typed web client in frontend/src/generated.',
        'A contract check requires every route to have an operation ID, tags and documented responses.',
        'Errors are JSON, usually { "error": "message" }.',
        'Lists page with limit and offset (transactions: 50 by default, 100 at most). Request bodies can be up to 15 MB.',
        'Agent replies stream as server-sent events.',
      ] },
      { type: 'visual', node: <SaveTransactionFlow />, wide: true },

      { type: 'h2', id: 'security', text: 'Sign-in and security' },
      { type: 'steps', items: [
        'Signing in redirects to Google (scopes openid, email and profile).',
        'On return, the server compares the Google email to ALLOWED_EMAIL and refuses anyone else.',
        'It sets a signed session token in an httpOnly cookie that lasts 7 days. Every request checks the token and the email again.',
      ] },
      { type: 'list', items: [
        'Every request that changes data needs a CSRF token, fetched from /api/auth/csrf-token and sent in the x-csrf-token header.',
        'Security headers come from Helmet, with a Content Security Policy that only allows the app’s own origin (plus OpenRouter for network calls).',
        'Requests are rate-limited per signed-in user (1,000 a minute overall; sign-in callbacks 10 per 5 minutes).',
        'Secrets stored in the database, such as the Gmail refresh token and model API keys, are encrypted with AES-256-GCM.',
        'Changes to transactions, accounts, budgets, periods, loans, pay later and reimbursements are written to the audit log with before and after snapshots.',
      ] },

      { type: 'h2', id: 'jobs', text: 'Background jobs' },
      { type: 'p', text: 'The worker runs scheduled jobs from three BullMQ queues: maintenance, recurring and agent. It writes a heartbeat to Redis every 45 seconds.' },
      { type: 'table', head: ['Job', 'How often'], rows: [
        ['Dispatch background tasks', 'Every 30 seconds'],
        ['Cache invalidation', 'Every minute'],
        ['Delete removed files from storage', 'Every 5 minutes'],
        ['Subscription renewals', 'Every hour'],
        ['Salary posting', 'Every hour'],
        ['Gmail sync', 'Every 15 minutes (GMAIL_POLL_INTERVAL_MINUTES)'],
        ['Database backup check', 'Every hour (DATABASE_BACKUP_POLL_INTERVAL_MINUTES)'],
        ['Agent: conversation titles, budget reviews', 'When queued; 45-second timeout'],
      ] },
      { type: 'callout', tone: 'note', title: 'If Redis goes down', text: 'The app keeps working: SQLite is the source of truth, cache reads fall back to the database, and work that couldn’t be queued is kept in database outboxes and replayed later. Without a worker (JOB_RUNNER_MODE=interval), the API server runs the same jobs on timers itself.' },

      { type: 'h2', id: 'integrations', text: 'Integrations' },
      { type: 'table', head: ['Service', 'Used for'], rows: [
        ['Google OAuth', 'Signing in (single allowed account)'],
        ['Gmail API', 'Read-only access to “Transaction successful” emails from wondr by BNI, which become pending transactions'],
        ['Cloudflare R2', 'Receipts and attachments (served with short-lived signed links) and database backups'],
        ['OpenRouter', 'Agent, receipt reading for split bills, transaction parsing, tag suggestions and recap stories. Models and API keys are set in Settings → Agent'],
        ['Puppeteer', 'Reading product pages for the wishlist'],
      ] },
      { type: 'p', text: 'Agent works through a fixed set of tools. Most only read (balances, transactions, cash flow, budgets, loans, pay later, recurring charges, exchange rates, calculations). The ones that would change money only prepare a draft that waits for your approval; notes, tags and pending imports can be edited directly when you ask.' },
      { type: 'visual', node: <AgentFlow />, wide: true },

      { type: 'h2', id: 'backups', text: 'Backups and exports' },
      { type: 'list', items: [
        'A database backup takes a consistent SQLite snapshot, runs an integrity check, and uploads it to R2 as database-backups/fainens-<time>.db. Schedule it weekly, every two weeks, monthly or quarterly in Settings, or run one now.',
        'Old backups aren’t deleted automatically, and restoring is done by replacing the database file.',
        'Reports export as CSV from the server, and the monthly report is built as a PDF in the browser, optionally password-protected.',
      ] },

      { type: 'h2', id: 'web-app', text: 'Web app' },
      { type: 'list', items: [
        'Pages are file-based routes in frontend/src/routes, split into separate bundles and preloaded when you hover a link.',
        'Server data is cached with TanStack Query for 5 minutes and isn’t refetched when you switch back to the tab.',
        'Interface preferences and unsent composer drafts are kept in your browser’s local storage, not on the server.',
        'A service worker caches the app shell and shows an offline page when there’s no connection; it never caches API responses.',
        'Colours are CSS variables, with light, dark and automatic themes and a choice of accent colour.',
      ] },

      { type: 'h2', id: 'development', text: 'Development and deployment' },
      { type: 'table', head: ['Command', 'What it does'], rows: [
        ['pnpm dev:backend', 'API server with reload, on port 3000'],
        ['pnpm dev:frontend', 'Web app on port 8080, forwarding /api to port 3000'],
        ['pnpm --filter backend worker', 'The background worker'],
        ['pnpm generate:all', 'Regenerate the OpenAPI contract and the typed web client'],
        ['pnpm verify:generated', 'Fail if the contract or client is out of date'],
        ['backend: npm test', 'Vitest unit and integration tests'],
        ['frontend: npm test', 'Node test runner tests'],
        ['backend: npm run eval:agent', 'Agent evaluations, replayed offline by default'],
      ] },
      { type: 'steps', items: [
        'The deploy script refuses to run with uncommitted changes and tags images with the commit.',
        'It builds the images locally and copies them to the server over SSH.',
        'It stops the API server and worker, backs up the database, and starts the new containers, which apply migrations on startup.',
        'It waits for the health check, then keeps the last 10 images and backups. A rollback option restores the previous release.',
      ] },

      { type: 'h2', id: 'configuration', text: 'Configuration' },
      { type: 'p', text: 'The backend reads its settings from .env at the repository root, with .env.local overriding it.' },
      { type: 'table', head: ['Area', 'Variables'], rows: [
        ['Sign-in', 'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL, ALLOWED_EMAIL, SESSION_SECRET'],
        ['Storage', 'R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL, FAINENS_DB_PATH'],
        ['Server', 'HOST, PORT, REDIS_URL, CORS_ORIGINS, FRONTEND_URL, NODE_ENV, TZ'],
        ['Agent', 'OPENROUTER_API_KEY, OPENROUTER_MODEL, OPENROUTER_HTTP_REFERER'],
        ['Jobs', 'JOB_RUNNER_MODE, GMAIL_POLL_INTERVAL_MINUTES, DATABASE_BACKUP_ENABLED, DATABASE_BACKUP_POLL_INTERVAL_MINUTES, WORKER_*_CONCURRENCY, WORKER_AGENT_TIMEOUT_MS'],
        ['Local development', 'LOCAL_AUTH_BYPASS and LOCAL_AUTH_EMAIL (ignored in production); VITE_API_PROXY_TARGET, VITE_DEV_PORT'],
      ] },
    ],
    related: ['data-privacy', 'can-i', 'troubleshooting'],
  },
  {
    slug: 'glossary',
    group: 'Reference',
    title: 'Glossary',
    summary: 'Words you’ll see in Fainens',
    lead: 'Plain-language meanings for the terms Fainens uses.',
    blocks: [{ type: 'visual', node: <GlossaryCardDemo /> }, { type: 'special', name: 'glossary' }],
  },
  {
    slug: 'whats-new',
    group: 'Reference',
    title: 'What’s new',
    summary: 'Changes, month by month',
    lead: 'The highlights of each month’s updates, newest first.',
    blocks: [{ type: 'visual', node: <WhatsNewDemo /> }, { type: 'special', name: 'changelog' }],
  },
];

/** Plain text of a page, for search. */
export function docText(page: DocPage): string {
  const parts = [page.title, page.summary, page.lead];
  for (const block of page.blocks) {
    if (block.type === 'p' || block.type === 'h2') parts.push(block.text);
    else if (block.type === 'steps' || block.type === 'list') parts.push(...block.items);
    else if (block.type === 'callout') parts.push(block.title ?? '', block.text);
    else if (block.type === 'table') parts.push(...block.rows.flat());
    else if (block.type === 'qa') parts.push(...block.items.flatMap((item) => [item.q, item.a]));
  }
  return parts.join(' ');
}
