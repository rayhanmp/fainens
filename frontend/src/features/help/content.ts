/**
 * Reference data for the help docs (Can I…?, limits, shortcuts, glossary, changelog). Every fact
 * was checked against the code; when a limit or feature changes, update it here.
 */

export type CanIAnswer = { question: string; answer: 'yes' | 'partly' | 'no'; detail: string };

export const CAN_I: CanIAnswer[] = [
  { question: 'Use it on my phone like an app?', answer: 'yes', detail: 'Add it to your home screen for a full-screen app with its own navigation bar.' },
  { question: 'Customize the dashboard?', answer: 'yes', detail: 'Presets, which panels show, their order and size, and the pulse metrics.' },
  { question: 'Use my own AI model?', answer: 'yes', detail: 'Any OpenAI-compatible model, with keys stored encrypted.' },
  { question: 'Export my data?', answer: 'yes', detail: 'JSON export, CSV statements, and monthly PDF reports.' },
  { question: 'Import from my bank?', answer: 'partly', detail: 'CSV from any bank; automatic only for wondr by BNI emails.' },
  { question: 'Change a closed period?', answer: 'partly', detail: 'Reopen it first, then close it again.' },
  { question: 'Use it offline?', answer: 'partly', detail: 'It opens, but balances can’t load and changes can’t be saved.' },
  { question: 'Use it in Bahasa Indonesia?', answer: 'partly', detail: 'Agent can reply in Bahasa Indonesia; the app itself is in English.' },
  { question: 'Track other currencies?', answer: 'partly', detail: 'Everything is counted in whole rupiah. A holiday’s bookings and plans can be priced in the local money at your rate, and Agent can look up exchange rates for reference.' },
  { question: 'Delete a posted transaction?', answer: 'no', detail: 'Correct it instead; the history keeps both entries.' },
  { question: 'Restore a backup in the app?', answer: 'no', detail: 'Backups and exports are kept safe, but restoring isn’t built in yet.' },
  { question: 'Share it with someone else?', answer: 'no', detail: 'It’s single-user; loans and split bills track people without giving them access.' },
];

export const LIMITS: Array<[string, string]> = [
  ['CSV import', '1,000 rows per file'],
  ['Attachments', '5 MB per file'],
  ['Images in Agent', '3 per message, 4 MB each, 8 MB in total'],
  ['Agent questions', '2,000 characters'],
  ['Agent memories', '50; names up to 80 characters, text up to 1,000'],
  ['Agent drafts', 'Expire after 15 minutes'],
  ['Agent batches', '20 expenses, 100 budget lines, 30 people in a split'],
  ['Gmail sync', 'Every 15 minutes; a manual sync looks back up to 365 days'],
  ['Salary day', 'Day 1–31; short months use their last day'],
  ['Bulk delete', '100 drafts at a time'],
  ['Catching up', '120 missed salaries or renewals at a time'],
  ['Report trends', 'The last 6 periods'],
  ['Sign-in session', '7 days'],
];

export const SHORTCUTS: Array<{ keys: string[]; action: string; where: string }> = [
  { keys: ['N'], action: 'New transaction', where: 'Anywhere' },
  { keys: ['/'], action: 'Jump to the page’s search', where: 'Anywhere' },
  { keys: ['Ctrl', 'Enter'], action: 'Save the open dialog (⌘ on Mac)', where: 'Dialogs' },
  { keys: ['Esc'], action: 'Close the top menu or dialog', where: 'Anywhere' },
  { keys: ['←', '→'], action: 'Previous or next period', where: 'Dashboard' },
  { keys: ['H'], action: 'Hide or show balances', where: 'Dashboard' },
  { keys: ['?'], action: 'All dashboard shortcuts', where: 'Dashboard' },
  { keys: ['/'], action: 'Pick a task like /split', where: 'Agent message box' },
  { keys: ['Enter'], action: 'Send (Shift + Enter for a new line)', where: 'Agent message box' },
  { keys: ['←', '→'], action: 'Previous or next chapter', where: 'Recaps' },
  { keys: ['Space'], action: 'Pause or play', where: 'Recaps' },
  { keys: ['R'], action: 'Replay with fresh visuals', where: 'Recaps' },
];

export const GLOSSARY: Array<[string, string]> = [
  ['Ledger', 'The single record of every money movement. Balances, budgets and reports are all read from it.'],
  ['Posted', 'Saved and counted in balances, budgets and reports.'],
  ['Draft', 'Not counted yet, and still free to edit or delete.'],
  ['Pending item', 'Something imported, like a bank email, waiting for your approval.'],
  ['Correction', 'An opposite entry that cancels a posted one, so history is never erased.'],
  ['Transfer', 'Money moving between two of your own accounts; not income or spending.'],
  ['Period', 'From one salary day to the day before the next; budgets and reports use it.'],
  ['Closed period', 'A period whose history is locked until you reopen it.'],
  ['Reconcile', 'Match an account to its real balance and record any difference.'],
  ['Coverage', 'How fully a period is tracked: complete, partial, or skipped during a break.'],
  ['Reallocation', 'Money that came back and went out again, linked so it counts as neither income nor spending.'],
  ['Balance adjustment', 'A recorded correction to a balance that isn’t income or spending.'],
  ['Asset / liability', 'What you own (cash, savings, money owed to you) versus what you owe.'],
  ['Net worth', 'Everything you own minus everything you owe.'],
  ['Cash runway', 'How long your available cash would last at your recent spending pace.'],
  ['Budget variance', 'Planned minus actual spending; negative means over plan.'],
  ['Opportunity cost', 'What idle money could have earned at your chosen yearly rate.'],
  ['Audit log', 'A history of important changes, for checking what changed and when.'],
];

export type ChangelogMonth = { month: string; highlights: Array<{ title: string; body: string }> };

/** User-facing highlights by month, newest first, summarised from the project history. */
export const CHANGELOG: ChangelogMonth[] = [
  {
    month: 'October 2026',
    highlights: [
      { title: 'Goals for your money', body: 'Split your cash and investments into goals, each its own pot, and see what’s still free. Put in every goal’s monthly amount in one tap or on payday, in priority order, save for a wishlist item, and finish a goal with the purchase that paid for it.' },
      { title: 'Every kind of goal has its own tool', body: 'Months of spending an emergency fund covers; a house’s down payment, buying costs and KPR against your pay; a wedding by its guests; an umrah’s packages; school fees by when they’re due; a gadget compared across shops; and what a yearly bill took last year, with THR for Lebaran. Each has its own picture, reminders in the bell, and parts with due dates.' },
      { title: 'Plan a holiday on its goal', body: 'Places, dates and the money there; flights, stays, passes and tickets with codes, maps and files; a day-by-day plan you can drag, export to your calendar or print; who’s going with their passports and visas; packing lists; a budget against the target; a Today view on the trip and a look back after it, with reminders before you go.' },
      { title: 'Notes you write in place', body: 'A goal’s notes have pages, tables, pictures, link cards, highlights, dates that remind you, and live links to its parts and files. Fold sections, drag blocks, search across goals, look back at earlier copies, and export to Markdown or PDF.' },
      { title: 'Every goal has its own page', body: 'Notes with checklists, a cost breakdown you pay part by part, files and a cover photo, a product link, where its money sits and what it earns, the category whose expenses it pays, milestones and a monthly streak. Start from templates, repeat a goal every year, pause one, and get reminders in the Dashboard’s bell.' },
      { title: 'A new savings simulator', body: 'Start a plan from your ledger, split it into pots like Tabungan, SBN and Saham, and give each goal its own pot so no two goals count the same money. Save plans to compare on any device, and plan retirement in today’s prices with BPJS, health cover and sourced guidance.' },
      { title: 'Subscriptions, rebuilt', body: 'See what they cost a month and a year, this year’s running total, a renewal calendar, which accounts can cover what’s due, and a month-by-month record of every charge, skip and pause.' },
      { title: 'Renewals the way they really happen', body: 'Custom intervals, free trials, cancel dates and dollar prices; record a payment late or early with its real amount, choose whether the schedule moves, or link a charge you already entered.' },
      { title: 'Find missing payments', body: 'A subscription finds the expenses you entered by hand that paid it and attaches them, one by one, without changing the transactions.' },
      { title: 'Recaps of your spending', body: 'Replay any period or your whole year as an animated story with quizzes, mini-games, music and a money personality.' },
      { title: 'Share your recap', body: 'Download a recap as a story video, or print its cover as a magazine, poster, record sleeve or boarding pass.' },
      { title: 'A dashboard you can arrange', body: 'Reorder, resize and hide dashboard panels, choose your pulse metrics, and see budget health and weekly net worth at a glance.' },
      { title: 'Rebuilt categories and income pages', body: 'Categories shows spending by period, trends and habits; Salary & income adds a yearly tax outlook.' },
      { title: 'Rebuild history from statements', body: 'Import a statement CSV as drafts, then search, filter, bulk-edit and post them, with balances settled automatically.' },
      { title: 'Better on phones', body: 'Menus open as bottom sheets, rows swipe for quick actions, tap areas are bigger, and balances start hidden.' },
      { title: 'A calmer, more personal Settings', body: 'Settings saves as you go, search jumps to the right option, and you can choose an accent colour, time format, week start, text size and reduced motion.' },
      { title: 'These help docs', body: 'Guides for every part of Fainens, with worked examples, what you can and can’t do, and what’s new.' },
    ],
  },
  {
    month: 'September 2026',
    highlights: [
      { title: 'Install it as an app', body: 'Add Fainens to your home screen, with a phone navigation bar and a friendly page when you’re offline.' },
      { title: 'Reimbursement claims', body: 'Track money you’re owed back for expenses, from the claim to repayment or write-off.' },
      { title: 'Bank emails become transactions', body: 'Connect Gmail to turn wondr by BNI emails into pending transactions you review and approve.' },
      { title: 'Redesigned budget planning', body: 'Plan from presets, compare with last period, edit allocations and watch spending fill in.' },
      { title: 'Automatic cloud backups', body: 'Your database is backed up on a schedule, with the history shown in Settings.' },
      { title: 'Profile and model settings', body: 'Add a profile so Agent understands your situation, and choose which AI model it uses.' },
      { title: 'Retirement planner and gallery', body: 'Plan for retirement in the savings simulator, and browse every receipt and photo in one gallery.' },
      { title: 'Balance adjustments', body: 'Correct an account balance with a recorded adjustment that isn’t income or spending.' },
    ],
  },
  {
    month: 'August 2026',
    highlights: [
      { title: 'Meet Agent', body: 'Chat about your finances with an assistant that shows charts and tables, accepts images and keeps separate conversations.' },
      { title: 'Agent prepares transactions', body: 'Agent drafts transactions for you to approve or reject, and asks when something is unclear.' },
      { title: 'Agent remembers you', body: 'Personal memories help later answers fit your habits.' },
      { title: 'A clearer dashboard', body: 'The dashboard leads with what needs attention, cash runway and a daily spending trend.' },
      { title: 'Easier salary periods', body: 'Manage periods in a redesigned screen, close past periods to lock their history, and catch up after time away.' },
      { title: 'Edit details inline', body: 'Change notes, tags and other safe details directly on a transaction.' },
      { title: 'More trustworthy numbers', body: 'Balances, loans, pay later, split bills and reports stay consistent when entries are edited or reversed.' },
    ],
  },
  {
    month: 'March 2026',
    highlights: [
      { title: 'The first release', body: 'Accounts, salary periods, budgets, subscriptions and pay later, with a dashboard for net worth and spending.' },
      { title: 'Faster entry', body: 'Type amounts like 25k, and use keyboard shortcuts such as N for a new transaction.' },
      { title: 'Contacts, loans and split bills', body: 'Record money lent or borrowed with repayments, and split a bill between people.' },
      { title: 'Wishlist', body: 'Save things you want by pasting a product link; the picture and details fill in.' },
      { title: 'AI insights', body: 'Get insights on your spending and category suggestions from a transaction’s name.' },
      { title: 'Import and attachments', body: 'Import transactions from CSV, attach receipts, and record routes for transport expenses.' },
      { title: 'Savings simulator and PDF reports', body: 'Simulate savings with inflation and goal templates, and export a monthly report as a PDF.' },
      { title: 'Account reconciliation', body: 'Match an account to its real balance and record the difference in one step.' },
    ],
  },
];
