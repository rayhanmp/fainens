import type { ReactNode } from 'react';
import type { LinkProps } from '@tanstack/react-router';
import {
  AgentProposalDemo,
  BudgetBarsDemo,
  ClaimPipelineDemo,
  ClosedPeriodDemo,
  ComposerDemo,
  CorrectionDemo,
  HiddenBalanceDemo,
  ImportFlowDemo,
  InstallmentDemo,
  LedgerFlow,
  PeriodTimeline,
  ReconcileDemo,
  SplitBillDemo,
  TransferDemo,
} from './visuals';

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
  | { type: 'visual'; node: ReactNode }
  | { type: 'table'; head: [string, string]; rows: Array<[string, string]> }
  | { type: 'qa'; items: Array<{ q: string; a: string }> }
  | { type: 'open'; link: DocLink }
  | { type: 'special'; name: 'can-i' | 'limits' | 'shortcuts' | 'glossary' | 'changelog' };

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

export const DOC_GROUPS = ['Getting started', 'Everyday money', 'Planning', 'Debts and sharing', 'Agent', 'Your data', 'Reference'] as const;

export const DOCS: DocPage[] = [
  // ── Getting started ───────────────────────────────────────────────
  {
    slug: 'welcome',
    group: 'Getting started',
    title: 'Welcome to Fainens',
    summary: 'What Fainens is and how it thinks about money',
    lead: 'Fainens is a private finance app built around one ledger. You record money once; balances, budgets, reports and recaps are all read from that same record.',
    blocks: [
      { type: 'visual', node: <LedgerFlow /> },
      { type: 'h2', id: 'mental-model', text: 'The idea in one sentence' },
      { type: 'p', text: 'Every rupiah that moves is written down as a transaction, and every number you see is a view of those transactions. When something looks off, you can always trace it back to the entries behind it.' },
      { type: 'h2', id: 'what-you-can-do', text: 'What you can do with it' },
      { type: 'list', items: ['Record spending, income and transfers in seconds, or let bank emails and Agent draft them for you.', 'Plan a budget for each salary period and watch it fill in.', 'Track loans, pay later, split bills, subscriptions and reimbursements without them counting as spending.', 'Reconcile accounts against your bank so balances stay right.', 'Ask Agent about your own money, and replay each period as a recap.'] },
      { type: 'callout', tone: 'note', title: 'Private by design', text: 'Fainens is a single-user app: only its owner’s Google account can sign in.' },
    ],
    related: ['quick-start', 'key-ideas'],
  },
  {
    slug: 'quick-start',
    group: 'Getting started',
    title: 'Quick start',
    summary: 'Set up Fainens in four steps',
    lead: 'Fifteen minutes now saves you guesswork later. Do these four things in order.',
    blocks: [
      { type: 'h2', id: 'accounts', text: '1. Add your accounts' },
      { type: 'steps', items: ['Open Accounts and choose Add account.', 'Pick Asset for money you hold (bank, e-wallet, cash, investments) or Liability for what you owe (credit card, pay later).', 'Enter today’s balance as the opening balance.', 'Repeat for every place your money lives, and pin the ones you use most.'] },
      { type: 'open', link: { to: '/accounts', label: 'Open Accounts' } },
      { type: 'h2', id: 'payday', text: '2. Set your salary day' },
      { type: 'p', text: 'Budgets and reports follow your pay cycle, not the calendar month. Set your salary day in Settings → General, then create your first period in Income & salary → Salary periods.' },
      { type: 'open', link: { to: '/periods', label: 'Open Salary periods' } },
      { type: 'h2', id: 'record', text: '3. Record what you spend' },
      { type: 'p', text: 'Press N anywhere (or the + button on phones). Shorthand like 25k works, and Fainens suggests a category from the name.' },
      { type: 'visual', node: <ComposerDemo /> },
      { type: 'h2', id: 'budget', text: '4. Plan a budget' },
      { type: 'p', text: 'Open Budget, choose Manage budget, and give each category an amount. Start from scratch, from a preset, or by copying last period.' },
      { type: 'open', link: { to: '/budget', label: 'Open Budget' } },
      { type: 'callout', tone: 'tip', title: 'Then, once a week', text: 'Glance at the Dashboard’s Needs attention strip, approve pending items in Transactions, and reconcile your main accounts.' },
    ],
    related: ['recording', 'periods', 'budgets'],
  },
  {
    slug: 'key-ideas',
    group: 'Getting started',
    title: 'Key ideas',
    summary: 'Ledger, periods, posted and drafts',
    lead: 'A handful of ideas explain almost everything Fainens does, including the moments it says no.',
    blocks: [
      { type: 'h2', id: 'balances', text: 'Every entry balances' },
      { type: 'p', text: 'Money always comes from somewhere and goes somewhere. A Rp45.000 lunch paid from BCA adds Rp45.000 to Food & dining and takes Rp45.000 from BCA. Fainens keeps every amount in whole rupiah.' },
      { type: 'h2', id: 'posted', text: 'Posted, draft and pending' },
      { type: 'table', head: ['State', 'What it means'], rows: [['Posted', 'Counts in balances, budgets and reports. Kept permanently; corrected, never erased.'], ['Draft', 'Doesn’t count yet. Edit or delete freely, then post (for example in Backfill).'], ['Pending', 'Imported (for example from a bank email) and waiting for your approval.']] },
      { type: 'h2', id: 'periods', text: 'Periods follow your pay' },
      { type: 'visual', node: <PeriodTimeline /> },
      { type: 'h2', id: 'not-spending', text: 'Not everything is spending' },
      { type: 'p', text: 'Transfers between your own accounts, money you lend, loan repayments, other people’s share of a split bill, and expenses waiting to be reimbursed all move money, but none of them is spending.' },
      { type: 'h2', id: 'you-confirm', text: 'Nothing posts without you' },
      { type: 'p', text: 'Bank emails wait as pending items, salary and subscription renewals ask first, and Agent’s drafts need your approval.' },
    ],
    related: ['fixing-mistakes', 'periods', 'glossary'],
  },

  // ── Everyday money ────────────────────────────────────────────────
  {
    slug: 'recording',
    group: 'Everyday money',
    title: 'Recording transactions',
    summary: 'Expenses, income, receipts and rides',
    lead: 'The composer handles everyday entries in a few taps, and switches to a full journal when you need it.',
    blocks: [
      { type: 'visual', node: <ComposerDemo /> },
      { type: 'h2', id: 'basics', text: 'Add an expense or income' },
      { type: 'steps', items: ['Press N anywhere, or Add transaction (the + button on phones).', 'Choose Expense, Income, Transfer or Settle PayLater.', 'Enter the amount, a name, the category and the account.', 'Read the sentence at the bottom to check it, then save.'] },
      { type: 'callout', tone: 'tip', text: 'Defaults come from Settings → Accounts, and Fainens remembers the accounts and categories you use most.' },
      { type: 'h2', id: 'journal', text: 'One payment, several categories' },
      { type: 'p', text: 'Switch the composer’s header from Simple to Journal and add a line for each category. The lines must add up to what you paid.' },
      { type: 'h2', id: 'receipts', text: 'Receipts and photos' },
      { type: 'p', text: 'Attach a receipt in the composer: images, PDF, text, CSV and Excel files up to 5 MB each. Every image also appears in Image storage.' },
      { type: 'h2', id: 'rides', text: 'Gojek and Grab rides' },
      { type: 'p', text: 'Choose a transport category and a trip section appears: set pickup and drop-off on a map, the provider and the service. Save a route you take often and reuse it next time.' },
      { type: 'h2', id: 'tags', text: 'Tags, notes and places' },
      { type: 'p', text: 'Add tags (Fainens suggests some), a note, or a place. These can always be changed later, even after posting.' },
      { type: 'open', link: { to: '/transactions', label: 'Open Transactions' } },
    ],
    related: ['transfers', 'fixing-mistakes', 'importing'],
  },
  {
    slug: 'transfers',
    group: 'Everyday money',
    title: 'Transfers and fees',
    summary: 'Moving money between your own accounts',
    lead: 'A transfer moves money between two of your accounts. Both balances change, but nothing is income or spending.',
    blocks: [
      { type: 'visual', node: <TransferDemo /> },
      { type: 'h2', id: 'how', text: 'Record a transfer' },
      { type: 'steps', items: ['Press N and choose Transfer.', 'Pick the account the money leaves and the one it arrives in. Use swap to flip them.', 'If there was a fee, enter it and choose who paid it: sender or recipient.', 'Save.'] },
      { type: 'h2', id: 'fees', text: 'Fees you pay every time' },
      { type: 'p', text: 'If moving money between two accounts always costs the same, set it once in Settings → Accounts → Transfer fees and it’s added automatically.' },
      { type: 'callout', tone: 'note', text: 'Transfers move money between your asset accounts, like bank to e-wallet. Pay-later installments are paid from Pay later, or with Settle PayLater in the composer.' },
    ],
    related: ['recording', 'pay-later'],
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
      { type: 'h2', id: 'locked', text: 'Why can’t I change it?' },
      { type: 'qa', items: [
        { q: 'It belongs to another feature', a: 'Entries made by loans, pay later, salary, subscriptions, split bills, reimbursements and reconciliations are changed from their own page.' },
        { q: 'Its period is closed', a: 'Reopen the period in Salary periods, make the change, then close it again.' },
        { q: 'I want to delete it', a: 'Posted entries can’t be deleted; correct them instead. Drafts can be deleted.' },
      ] },
      { type: 'callout', tone: 'tip', text: 'Not sure what changed? Security audit lists important changes and when they happened.' },
    ],
    related: ['periods', 'accounts', 'troubleshooting'],
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
      { type: 'h2', id: 'reconcile', text: 'Reconcile with your bank' },
      { type: 'visual', node: <ReconcileDemo /> },
      { type: 'steps', items: ['Open Accounts and choose Reconcile.', 'For a routine check, enter the balance each bank shows today.', 'Look at any difference and check for a missing or doubled transaction first.', 'Confirm to record what’s left as a balance adjustment. You can void it later with a reason.'] },
      { type: 'callout', tone: 'note', title: 'Coming back after a gap?', text: 'Choose “Catch up after a gap” in Reconcile for a one-time bridge across all accounts.' },
      { type: 'open', link: { to: '/accounts', label: 'Open Accounts' } },
    ],
    related: ['periods', 'fixing-mistakes'],
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
      { type: 'open', link: { to: '/backfill', label: 'Open Backfill' } },
    ],
    related: ['recording', 'can-i'],
  },

  // ── Planning ──────────────────────────────────────────────────────
  {
    slug: 'periods',
    group: 'Planning',
    title: 'Salary periods',
    summary: 'Paydays, closing periods, and catching up',
    lead: 'Everything in Fainens is grouped into periods that run from one payday to the next.',
    blocks: [
      { type: 'visual', node: <PeriodTimeline /> },
      { type: 'p', text: 'Set your salary day in Settings → General. In months without that day, the last day of the month is used. Periods never overlap.' },
      { type: 'h2', id: 'close', text: 'Close a period' },
      { type: 'visual', node: <ClosedPeriodDemo /> },
      { type: 'steps', items: ['Post or delete any drafts left in the period.', 'Reconcile your accounts so closing balances are right.', 'In Salary periods, choose Close period.'] },
      { type: 'p', text: 'A closed period’s transactions and budget are locked. Reopen it if you need to correct something, and archive old periods once they’re closed.' },
      { type: 'h2', id: 'break', text: 'After a break' },
      { type: 'p', text: 'Choose Resume tracking and enter the day you came back. The gap is marked skipped, so nothing is made up. Then reconcile your accounts from today.' },
      { type: 'open', link: { to: '/periods', label: 'Open Salary periods' } },
    ],
    related: ['budgets', 'accounts'],
  },
  {
    slug: 'budgets',
    group: 'Planning',
    title: 'Budgets',
    summary: 'Plan spending per category each period',
    lead: 'A budget gives each category a limit for the period, so you can see what’s left before you spend.',
    blocks: [
      { type: 'visual', node: <BudgetBarsDemo /> },
      { type: 'h2', id: 'build', text: 'Build a plan' },
      { type: 'steps', items: ['Open Budget and choose Manage budget.', 'Copy the previous period, start from a preset, or start from scratch.', 'Give each category an amount, with a note if you like.', 'Optionally set a savings target, as an amount or a share of income.', 'Read the checks before you save.'] },
      { type: 'h2', id: 'track', text: 'Track it' },
      { type: 'p', text: 'Each category shows over, near limit, on track or not started. Edit amounts inline, move a line to another open period, compare with another period, and save your plan as a preset for next time.' },
      { type: 'callout', tone: 'note', text: 'Budgets in closed periods are read-only. Only real spending counts: transfers, loans and splits don’t use up a budget.' },
      { type: 'open', link: { to: '/budget', label: 'Open Budget' } },
    ],
    related: ['periods', 'subscriptions-salary'],
  },
  {
    slug: 'subscriptions-salary',
    group: 'Planning',
    title: 'Subscriptions and salary',
    summary: 'Renewals, take-home pay and tax estimates',
    lead: 'Recurring money in and out, without it posting behind your back.',
    blocks: [
      { type: 'h2', id: 'subscriptions', text: 'Subscriptions' },
      { type: 'p', text: 'Add each monthly or annual subscription with the account it’s paid from. You’ll see the monthly total and what renews next. When a renewal is due, Fainens asks: post it, or skip it if you weren’t charged.' },
      { type: 'open', link: { to: '/subscriptions', label: 'Open Subscriptions' } },
      { type: 'h2', id: 'salary', text: 'Salary profile' },
      { type: 'p', text: 'In Income & salary, add your gross pay, payday, PTKP status and BPJS options. Fainens estimates PPh 21, BPJS deductions and your take-home pay, and lets you post your salary when it’s due.' },
      { type: 'h2', id: 'tax', text: 'Yearly tax outlook' },
      { type: 'p', text: 'See your estimated annual tax and mark other income as taxable, final or exempt.' },
      { type: 'callout', tone: 'warning', text: 'These are planning estimates, not a tax filing.' },
      { type: 'open', link: { to: '/salary-income', label: 'Open Income & salary' } },
    ],
    related: ['budgets', 'periods'],
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
      { type: 'open', link: { to: '/savings-simulator', label: 'Open Savings simulator' } },
      { type: 'h2', id: 'wishlist', text: 'Wishlist' },
      { type: 'p', text: 'Paste a product link from Tokopedia, Shopee, Bukalapak, Lazada or Blibli and the picture and details fill in; other shops are tried too. Set a priority and a target period. When you buy it, mark it fulfilled to record the purchase.' },
      { type: 'open', link: { to: '/wishlist', label: 'Open Wishlist' } },
    ],
    related: ['budgets'],
  },

  // ── Debts and sharing ─────────────────────────────────────────────
  {
    slug: 'loans',
    group: 'Debts and sharing',
    title: 'Loans and contacts',
    summary: 'Money you lent or borrowed',
    lead: 'Keep track of who owes whom, without loans showing up as spending or income.',
    blocks: [
      { type: 'steps', items: ['In Loans, choose New loan.', 'Pick Lend or Borrow, the person (or create a contact), the amount and the account the money moved through.', 'Add a due date if there is one.', 'Record each repayment as it comes.'] },
      { type: 'p', text: 'Loans shows what you’re owed, what you owe and the net. Each contact’s page lists their loans, and split bills appear under their own tab.' },
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
      { type: 'h2', id: 'pay', text: 'Pay an installment' },
      { type: 'p', text: 'Open Pay later to see the calendar and what each provider is owed, then Pay now on an installment. You can also use Settle PayLater in the composer.' },
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
      { type: 'open', link: { to: '/reimbursements', label: 'Open Reimbursements' } },
    ],
    related: ['recording', 'loans'],
  },

  // ── Agent ─────────────────────────────────────────────────────────
  {
    slug: 'agent',
    group: 'Agent',
    title: 'Using Agent',
    summary: 'Ask about your money; approve what it drafts',
    lead: 'Agent is an assistant that can read your recorded money and answer with charts, tables and plain words.',
    blocks: [
      { type: 'h2', id: 'ask', text: 'What to ask' },
      { type: 'list', items: ['Where did my money go this period?', 'Am I on track with my budget?', 'What bills are coming up?', 'Can I afford this purchase?'] },
      { type: 'p', text: 'Ask across all your history or one period. Attach up to 3 images (receipts, screenshots). Type / for tasks: /split, /trx to prepare a transaction, /photo, and /model to switch model.' },
      { type: 'h2', id: 'approve', text: 'Agent drafts, you approve' },
      { type: 'visual', node: <AgentProposalDemo /> },
      { type: 'p', text: 'Agent can draft expenses, income, transfers, budgets and split bills. Each one waits as a card: Confirm & post, Edit, or Dismiss. When you ask, it can also add a note or tags to a transaction.' },
      { type: 'callout', tone: 'note', text: 'Drafts expire after 15 minutes, or sooner if your data changes. Just ask again for a fresh one.' },
      { type: 'h2', id: 'privacy', text: 'What Agent knows' },
      { type: 'p', text: 'Your recorded finances, the profile details you share (Settings → Agent → What Agent can see), and the memories you save. Memories are context only: never proof of a transaction or permission to change data.' },
      { type: 'h2', id: 'models', text: 'Models' },
      { type: 'p', text: 'Agent works with any OpenAI-compatible model. Add your own in Settings → Agent → Models (OpenRouter and OpenAI are one tap) and choose a default; API keys are stored encrypted.' },
      { type: 'open', link: { to: '/agent', label: 'Open Agent' } },
    ],
    related: ['split-bills', 'data-privacy'],
  },

  // ── Your data ─────────────────────────────────────────────────────
  {
    slug: 'data-privacy',
    group: 'Your data',
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
      { type: 'p', text: 'See important changes with when they happened, filter by type, and open the details.' },
      { type: 'open', link: { to: '/settings', label: 'Open Settings' } },
    ],
    related: ['can-i', 'agent'],
  },

  // ── Reference ─────────────────────────────────────────────────────
  {
    slug: 'can-i',
    group: 'Reference',
    title: 'Can I…?',
    summary: 'What’s supported, and what isn’t yet',
    lead: 'The quick answer to what Fainens can do, partly does, and doesn’t do yet.',
    blocks: [{ type: 'special', name: 'can-i' }],
    related: ['limits', 'importing'],
  },
  {
    slug: 'limits',
    group: 'Reference',
    title: 'Limits',
    summary: 'Sizes, counts and ranges',
    lead: 'The numbers worth knowing before you hit them.',
    blocks: [{ type: 'special', name: 'limits' }],
    related: ['can-i'],
  },
  {
    slug: 'shortcuts',
    group: 'Reference',
    title: 'Keyboard shortcuts',
    summary: 'Faster with a keyboard',
    lead: 'Shortcuts work when you’re not typing in a field.',
    blocks: [{ type: 'special', name: 'shortcuts' }],
  },
  {
    slug: 'troubleshooting',
    group: 'Reference',
    title: 'Troubleshooting',
    summary: 'When something looks wrong',
    lead: 'The most common surprises, and what to do about them.',
    blocks: [
      { type: 'qa', items: [
        { q: 'My balance doesn’t match my bank.', a: 'Reconcile the account in Accounts. Check the difference for a missing or doubled transaction first, then record what’s left as a balance adjustment.' },
        { q: 'A number on the dashboard looks wrong.', a: 'Check which period the Dashboard shows, then open Transactions for that period, filter by the account or category, and check the entries behind the number. Transfers, loans and splits don’t count as spending.' },
        { q: 'I can’t edit or delete a transaction.', a: 'It’s posted (correct it instead), it belongs to another feature (change it from that page), or its period is closed (reopen it first).' },
        { q: 'I can’t close a period.', a: 'It still has drafts. Post or delete them, then close it.' },
        { q: 'My bank email didn’t show up.', a: 'Only wondr by BNI emails are read. Fainens checks every 15 minutes; use Sync now in Transactions, then look in Review pending.' },
        { q: 'Agent’s draft won’t post.', a: 'Drafts expire after 15 minutes or when your data changes. Ask Agent to prepare it again.' },
        { q: 'Something changed and I don’t know why.', a: 'Open Security audit to see important changes and when they happened.' },
      ] },
    ],
    related: ['fixing-mistakes', 'accounts'],
  },
  {
    slug: 'glossary',
    group: 'Reference',
    title: 'Glossary',
    summary: 'Words you’ll see in Fainens',
    lead: 'Plain-language meanings for the terms Fainens uses.',
    blocks: [{ type: 'special', name: 'glossary' }],
  },
  {
    slug: 'whats-new',
    group: 'Reference',
    title: 'What’s new',
    summary: 'Changes, month by month',
    lead: 'The highlights of each month’s updates, newest first.',
    blocks: [{ type: 'special', name: 'changelog' }],
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
