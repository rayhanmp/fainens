import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

// Print palette follows the app's blue accent and neutral surfaces.
const C = { ink: '#191B23', body: '#424654', muted: '#737785', line: '#E1E2EC', wash: '#F5F6FA', blue: '#0056D2', blueSoft: '#EBF1FC', green: '#006B5E', red: '#BA1A1A', white: '#FFFFFF' };
const s = StyleSheet.create({
  page: { paddingHorizontal: 40, paddingTop: 92, paddingBottom: 62, fontFamily: 'Helvetica', fontSize: 9, lineHeight: 1.4, color: C.body, backgroundColor: C.white },
  cover: { padding: 40, fontFamily: 'Helvetica', color: C.ink, backgroundColor: C.white },
  header: { height: 40, position: 'absolute', top: 28, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: C.line, paddingBottom: 10 },
  brand: { flexDirection: 'row', alignItems: 'center' }, mark: { width: 28, height: 28, backgroundColor: C.blue, borderRadius: 8, marginRight: 9, alignItems: 'center', justifyContent: 'center' },
  markText: { color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 16 }, brandName: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: C.ink },
  micro: { lineHeight: 1.2, flexShrink: 0, fontSize: 7.5, color: C.muted }, right: { textAlign: 'right' }, bold: { fontFamily: 'Helvetica-Bold' }, blue: { color: C.blue }, positive: { color: C.green }, negative: { color: C.red },
  footer: { height: 20, position: 'absolute', bottom: 25, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: C.line, paddingTop: 8 }, pageNumber: { position: 'absolute', right: 0, top: 8, width: 68, textAlign: 'right', color: C.muted, fontFamily: 'Helvetica-Bold' },
  eyebrow: { color: C.blue, fontSize: 8, fontFamily: 'Helvetica-Bold', letterSpacing: 1.4, textTransform: 'uppercase' },
  title: { fontSize: 26, fontFamily: 'Helvetica-Bold', color: C.ink, marginTop: 5, lineHeight: 1.15 }, lead: { color: C.muted, fontSize: 9, marginTop: 8, lineHeight: 1.5 },
  coverTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, badge: { height: 25, minWidth: 98, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line, paddingHorizontal: 10, borderRadius: 13 }, badgeText: { color: C.muted, fontSize: 7, letterSpacing: 1 },
  coverIntro: { marginTop: 92 }, coverTitle: { fontSize: 42, fontFamily: 'Helvetica-Bold', lineHeight: 1.1, color: C.ink, marginTop: 14 }, coverPeriod: { fontSize: 23, color: C.blue, marginTop: 18 },
  coverHero: { marginTop: 38, padding: 24, backgroundColor: C.blue, borderRadius: 12 }, coverHeroLabel: { color: '#D9E6FF', fontSize: 8 }, coverHeroValue: { color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 31, marginTop: 7 },
  coverMetrics: { flexDirection: 'row', alignItems: 'stretch', marginTop: 24, borderTopWidth: 1, borderTopColor: '#568DDD', paddingTop: 16 }, coverMetric: { flex: 1, minHeight: 43, justifyContent: 'center' }, coverMetricValue: { color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 13, marginTop: 5 },
  contents: { marginTop: 35 }, contentsRow: { flexDirection: 'row', alignItems: 'center', minHeight: 30, borderBottomWidth: 1, borderBottomColor: C.line, paddingVertical: 8 }, contentsNumber: { width: 30, color: C.blue, fontSize: 8 }, contentsText: { fontSize: 10, color: C.body },
  coverFoot: { position: 'absolute', left: 40, right: 40, bottom: 35, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 13 },
  section: { marginTop: 19 }, sectionTitle: { color: C.ink, fontSize: 12, fontFamily: 'Helvetica-Bold', marginBottom: 9 }, sectionDivider: { borderTopWidth: .5, borderTopColor: '#EEF0F5', marginTop: 24, paddingTop: 14 },
  metrics: { flexDirection: 'row', marginTop: 18, gap: 10 }, metric: { flex: 1, minHeight: 62, backgroundColor: C.wash, borderRadius: 8, paddingVertical: 11, paddingHorizontal: 14 }, metricContent: { flex: 1, justifyContent: 'center' }, metricLabel: { color: C.muted, fontSize: 7.5, lineHeight: 1.2, marginBottom: 6 }, metricValue: { fontSize: 16, lineHeight: 1.15, color: C.ink, fontFamily: 'Helvetica-Bold' },
  cashFlow: { flexDirection: 'row', gap: 8, alignItems: 'stretch' }, cashFlowCard: { flex: 1, minHeight: 68, justifyContent: 'center', paddingVertical: 11, paddingHorizontal: 10, borderRadius: 8, backgroundColor: C.wash }, cashFlowIn: { backgroundColor: '#EAF6F2' }, cashFlowOut: { backgroundColor: '#FCEDED' }, cashFlowClose: { backgroundColor: C.blueSoft }, cashFlowLabel: { color: C.muted, fontSize: 7, fontFamily: 'Helvetica-Bold', letterSpacing: .5, textTransform: 'uppercase' }, cashFlowValue: { color: C.ink, fontFamily: 'Helvetica-Bold', fontSize: 11.5, lineHeight: 1.15, marginTop: 6 }, cashFlowValueIn: { color: C.green }, cashFlowValueOut: { color: C.red }, cashFlowValueClose: { color: C.blue },
  split: { flexDirection: 'row', gap: 24 }, column: { flex: 1 }, barRow: { marginBottom: 11 }, barLabels: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 5 }, barName: { flex: 1, fontSize: 8 }, barAmount: { fontFamily: 'Helvetica-Bold', color: C.ink, fontSize: 8 }, track: { height: 4, borderRadius: 2, backgroundColor: C.wash }, fill: { height: 4, borderRadius: 2, backgroundColor: C.blue },
  incomeTransaction: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 35, paddingVertical: 8, borderBottomWidth: .5, borderBottomColor: C.line }, incomeTransactionCopy: { flex: 1, paddingRight: 8 }, incomeTransactionDescription: { fontSize: 8, lineHeight: 1.3, color: C.body }, incomeTransactionDate: { fontSize: 7, lineHeight: 1.2, color: C.muted, marginTop: 3 }, incomeTransactionAmount: { width: '38%', fontSize: 8, textAlign: 'right', color: C.ink, fontFamily: 'Helvetica-Bold' },
  note: { justifyContent: 'center', paddingVertical: 11, paddingHorizontal: 12, backgroundColor: C.wash, borderLeftWidth: 2, borderLeftColor: C.blue, marginTop: 15, fontSize: 8, color: C.body }, warning: { backgroundColor: '#FFF5E6', borderLeftColor: '#B86B00' },
  tablePage: { paddingTop: 187 }, tableTitle: { height: 60, position: 'absolute', top: 90, left: 40, right: 40 }, tableHeading: { lineHeight: 1.2, marginTop: 3, marginBottom: 6, fontSize: 20, fontFamily: 'Helvetica-Bold', color: C.ink },
  tableHead: { height: 27, position: 'absolute', top: 158, left: 40, right: 40, flexDirection: 'row', alignItems: 'stretch', backgroundColor: C.blueSoft, borderRadius: 4, paddingHorizontal: 8 }, tableHeadCell: { justifyContent: 'center' }, headText: { lineHeight: 1.2, flexShrink: 0, fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.blue }, headTextRight: { textAlign: 'right' },
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: .5, borderBottomColor: C.line, paddingHorizontal: 8, paddingVertical: 9 }, alt: { backgroundColor: '#F8F9FC' }, cell: { fontSize: 8, paddingRight: 9, lineHeight: 1.5 }, date: { width: '16%' }, description: { width: '40%' }, category: { width: '22%' }, amount: { width: '22%', textAlign: 'right', paddingRight: 0 },
  budgetCategory: { width: '29%' }, budgetUsedPlan: { width: '36%', textAlign: 'right' }, budgetUsage: { width: '23%', paddingHorizontal: 10 }, budgetUsageCell: { justifyContent: 'center' }, budgetTrack: { width: '100%', height: 5, borderRadius: 3, backgroundColor: C.line }, budgetFill: { height: 5, borderRadius: 3 }, budgetVariance: { width: '12%', textAlign: 'right', paddingRight: 0 },
  total: { minHeight: 40, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, backgroundColor: C.blueSoft, borderRadius: 5, marginTop: 14, flexDirection: 'row', justifyContent: 'space-between' },
  notesBlock: { marginTop: 22, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: C.line }, notesTitle: { fontSize: 11, color: C.ink, fontFamily: 'Helvetica-Bold', marginBottom: 7 }, notesCopy: { fontSize: 9, color: C.body, lineHeight: 1.65 }, hash: { fontFamily: 'Courier', fontSize: 7.5, marginTop: 8, color: C.muted },
});

const money = (value: number) => `${value < 0 ? '-' : ''}Rp ${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.abs(value))}`;
const percent = (value: number, total: number) => total > 0 ? `${(value / total * 100).toFixed(1)}%` : 'N/A';

export interface MonthlyReportProps {
  periodName: string; startDate: string; endDate: string; totalIncome: number; totalExpenses: number; netIncome: number;
  totalAssets: number; totalLiabilities: number; netWorth: number; previousBalance: number; totalIncoming: number; totalOutgoing: number; closingBalance: number; reportHash: string;
  incomeBySource: Array<{ name: string; amount: number }>;
  expensesByCategory: Array<{ name: string; amount: number; color: string }>;
  budgetComparison: Array<{ category: string; budget: number; actual: number; variance: number }>;
  allTransactions: Array<{ date: string; description: string; category: string; amount: number; type: string }>;
  coverage?: { isComparable: boolean; warnings: string[] };
}

function Brand() {
  return <View style={s.brand}><View style={s.mark}><Text style={s.markText}>f</Text></View><Text style={s.brandName}>Fainens</Text></View>;
}
function Header({ report }: { report: MonthlyReportProps }) {
  return <View style={s.header} fixed><Brand /><View><Text style={[s.micro, s.right, s.bold]}>{report.periodName}</Text><Text style={[s.micro, s.right]}>{report.startDate} - {report.endDate}</Text></View></View>;
}
function PageNumber() {
  return <Text style={[s.micro, s.pageNumber]} fixed render={({ pageNumber, totalPages }) => `Page ${Math.max(1, pageNumber - 1)} of ${Math.max(1, totalPages - 1)}`}>Page</Text>;
}
function Footer() {
  return <View style={s.footer} fixed><Text style={s.micro}>Fainens / Personal financial report / Confidential</Text><PageNumber /></View>;
}
function Metric({ label, value }: { label: string; value: number }) {
  return <View style={s.metric}><View style={s.metricContent}><Text style={s.metricLabel}>{label}</Text><Text style={[s.metricValue, value < 0 ? s.negative : {}]}>{money(value)}</Text></View></View>;
}
function Breakdown({ title, items }: { title: string; items: Array<{ name: string; amount: number }> }) {
  const sorted = items.filter(item => item.amount > 0).sort((a, b) => b.amount - a.amount);
  const rows = sorted.length > 5 ? [...sorted.slice(0, 4), { name: 'Other sources / categories', amount: sorted.slice(4).reduce((sum, item) => sum + item.amount, 0) }] : sorted;
  const total = sorted.reduce((sum, item) => sum + item.amount, 0);
  return <View style={s.column}><Text style={s.sectionTitle}>{title}</Text>{rows.length ? rows.map((item, index) => <View key={index} style={s.barRow} wrap={false}><View style={s.barLabels}><Text style={s.barName}>{item.name}</Text><Text style={s.barAmount}>{money(item.amount)}</Text></View><View style={s.track}><View style={[s.fill, { width: `${total > 0 ? item.amount / total * 100 : 0}%` }]} /></View></View>) : <Text style={s.micro}>No activity recorded.</Text>}</View>;
}
function IncomeActivity({ transactions }: { transactions: MonthlyReportProps['allTransactions'] }) {
  const incomeTransactions = transactions.filter((transaction) => transaction.type === 'income' && transaction.amount > 0);
  if (!incomeTransactions.length) return <View style={s.column}><Text style={s.sectionTitle}>Income activity</Text><Text style={s.micro}>No income transactions recorded.</Text></View>;
  return <View style={s.column}><Text style={s.sectionTitle}>Income transactions</Text>{incomeTransactions.map((income, index) => <View key={`${income.date}-${income.description}-${index}`} style={s.incomeTransaction} wrap={false}><View style={s.incomeTransactionCopy}><Text style={s.incomeTransactionDescription}>{income.description || 'Income transaction'}</Text><Text style={s.incomeTransactionDate}>{income.date}</Text></View><Text style={s.incomeTransactionAmount}>{money(income.amount)}</Text></View>)}</View>;
}

export function MonthlyReportPDF(p: MonthlyReportProps) {
  const generatedAt = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
  const plan = p.budgetComparison.reduce((sum, row) => sum + row.budget, 0);
  const spent = p.budgetComparison.reduce((sum, row) => sum + row.actual, 0);
  const hasBudget = p.budgetComparison.length > 0;
  const sections = ['Financial overview', ...(hasBudget ? ['Budget performance'] : []), 'Transaction detail', 'Report notes'];
  const sectionNumber = (name: string) => String(sections.indexOf(name) + 1).padStart(2, '0');

  return <Document title={`Fainens - ${p.periodName}`} author="Fainens" subject="Personal financial report">
    <Page size="A4" style={s.cover}>
      <View style={s.coverTop}><Brand /><View style={s.badge}><Text style={s.badgeText}>PRIVATE REPORT</Text></View></View>
      <View style={s.coverIntro}><Text style={s.eyebrow}>Your money, in perspective</Text><Text style={s.coverTitle}>Monthly financial{'\n'}report</Text><Text style={s.coverPeriod}>{p.periodName}</Text><Text style={s.lead}>{p.startDate} - {p.endDate}</Text></View>
      <View style={s.coverHero} wrap={false}>
        <Text style={s.coverHeroLabel}>NET INCOME FOR THE PERIOD</Text><Text style={s.coverHeroValue}>{money(p.netIncome)}</Text>
        <View style={s.coverMetrics}><View style={s.coverMetric}><Text style={s.coverHeroLabel}>Income</Text><Text style={s.coverMetricValue}>{money(p.totalIncome)}</Text></View><View style={s.coverMetric}><Text style={s.coverHeroLabel}>Spending</Text><Text style={s.coverMetricValue}>{money(p.totalExpenses)}</Text></View><View style={s.coverMetric}><Text style={s.coverHeroLabel}>Savings rate</Text><Text style={s.coverMetricValue}>{percent(p.netIncome, p.totalIncome)}</Text></View></View>
      </View>
      <View style={s.contents}><Text style={s.eyebrow}>In this report</Text>{sections.map((section, i) => <View key={section} style={s.contentsRow}><Text style={s.contentsNumber}>{String(i + 1).padStart(2, '0')}</Text><Text style={s.contentsText}>{section}</Text></View>)}</View>
      <View style={s.coverFoot}><Text style={s.micro}>Prepared {generatedAt} / {p.allTransactions.length} recorded transactions</Text><Text style={[s.micro, { marginTop: 5 }]}>A personal record of your finances. Keep this report in a secure place.</Text></View>
    </Page>

    <Page size="A4" style={s.page}><Header report={p} /><Text style={s.eyebrow}>01 / Overview</Text><Text style={s.title}>The period at a glance</Text><Text style={s.lead}>Income, spending, and the financial position recorded for {p.periodName}.</Text>
      {p.coverage && !p.coverage.isComparable && <View style={[s.note, s.warning]} wrap={false}><Text style={s.bold}>Coverage note</Text><Text>{p.coverage.warnings.join(' ')}</Text></View>}
      <View style={[s.metrics, { marginTop: 0 }]} wrap={false}><Metric label="Total income" value={p.totalIncome} /><Metric label="Total spending" value={p.totalExpenses} /><Metric label="Net income" value={p.netIncome} /></View>
      <View style={s.section} wrap={false}><Text style={s.sectionTitle}>Cash movement</Text><View style={s.cashFlow}><View style={s.cashFlowCard}><Text style={s.cashFlowLabel}>Opening balance</Text><Text style={s.cashFlowValue}>{money(p.previousBalance)}</Text></View><View style={[s.cashFlowCard, s.cashFlowIn]}><Text style={s.cashFlowLabel}>Money in</Text><Text style={[s.cashFlowValue, s.cashFlowValueIn]}>{money(p.totalIncoming)}</Text></View><View style={[s.cashFlowCard, s.cashFlowOut]}><Text style={s.cashFlowLabel}>Money out</Text><Text style={[s.cashFlowValue, s.cashFlowValueOut]}>{money(-p.totalOutgoing)}</Text></View><View style={[s.cashFlowCard, s.cashFlowClose]}><Text style={s.cashFlowLabel}>Closing balance</Text><Text style={[s.cashFlowValue, s.cashFlowValueClose]}>{money(p.closingBalance)}</Text></View></View><Text style={[s.micro, { marginTop: 7 }]}>Cash-equivalent accounts. Transfers may differ from income and expenses.</Text></View>
      <View style={[s.section, s.sectionDivider, s.split]} wrap={false}><Breakdown title="Where money went" items={p.expensesByCategory} /><IncomeActivity transactions={p.allTransactions} /></View>
      <View style={[s.section, s.sectionDivider]} wrap={false}><Text style={s.sectionTitle}>Your position at period end</Text><View style={[s.metrics, { marginTop: 0 }]}><Metric label="Assets" value={p.totalAssets} /><Metric label="Liabilities" value={p.totalLiabilities} /><Metric label="Net worth" value={p.netWorth} /></View></View>
      <Footer />
    </Page>

    {hasBudget && <Page size="A4" style={[s.page, s.tablePage]}><Header report={p} />
      <View style={s.tableTitle} fixed><Text style={s.eyebrow}>{sectionNumber('Budget performance')} / Budget</Text><Text style={s.tableHeading}>Budget performance</Text><Text style={s.micro}>Used {money(spent)} / Planned {money(plan)} / {percent(spent, plan)} used</Text></View>
      <View style={s.tableHead} fixed><View style={[s.tableHeadCell, s.budgetCategory]}><Text style={s.headText}>CATEGORY</Text></View><View style={[s.tableHeadCell, s.budgetUsedPlan]}><Text style={[s.headText, s.headTextRight]}>USED / PLANNED</Text></View><View style={[s.tableHeadCell, s.budgetUsage]}><Text style={s.headText}>PROGRESS</Text></View><View style={[s.tableHeadCell, s.budgetVariance]}><Text style={[s.headText, s.headTextRight]}>VARIANCE</Text></View></View>
      {p.budgetComparison.map((row, i) => {
        const usage = row.budget > 0 ? Math.min(100, Math.max(0, row.actual / row.budget * 100)) : row.actual > 0 ? 100 : 0;
        const overBudget = row.budget > 0 && row.actual > row.budget;
        const variance = row.variance === 0 ? money(0) : `${row.variance > 0 ? '+' : ''}${money(row.variance)}`;
        return <View key={`${row.category}-${i}`} style={[s.row, i % 2 ? s.alt : {}]} wrap={false}><Text style={[s.cell, s.budgetCategory, s.bold]}>{row.category}</Text><Text style={[s.cell, s.budgetUsedPlan]}>{money(row.actual)} / {money(row.budget)}</Text><View style={[s.budgetUsage, s.budgetUsageCell]}><View style={s.budgetTrack}><View style={[s.budgetFill, { width: `${usage}%`, backgroundColor: overBudget ? C.red : C.green }]} /></View></View><Text style={[s.cell, s.budgetVariance, row.variance < 0 ? s.negative : s.positive]}>{variance}</Text></View>;
      })}
      <View style={s.total} wrap={false}><Text style={s.bold}>{plan - spent < 0 ? 'Over budget' : 'Remaining budget'}</Text><Text style={[s.bold, plan - spent < 0 ? s.negative : s.blue]}>{money(Math.abs(plan - spent))}</Text></View>
      <Footer />
    </Page>}

    <Page size="A4" style={[s.page, s.tablePage]}><Header report={p} />
      <View style={s.tableTitle} fixed><Text style={s.eyebrow}>{sectionNumber('Transaction detail')} / Transactions</Text><Text style={s.tableHeading}>Transaction detail</Text><Text style={s.micro}>{p.allTransactions.length} recorded transactions / Amounts in Indonesian rupiah</Text></View>
      <View style={s.tableHead} fixed><View style={[s.tableHeadCell, s.date]}><Text style={s.headText}>DATE</Text></View><View style={[s.tableHeadCell, s.description]}><Text style={s.headText}>DESCRIPTION</Text></View><View style={[s.tableHeadCell, s.category]}><Text style={s.headText}>CATEGORY</Text></View><View style={[s.tableHeadCell, s.amount]}><Text style={[s.headText, s.headTextRight]}>AMOUNT</Text></View></View>
      {p.allTransactions.map((row, i) => <View key={i} style={[s.row, i % 2 ? s.alt : {}]} wrap={false}><Text style={[s.cell, s.date]}>{row.date}</Text><Text style={[s.cell, s.description]}>{row.description || '-'}</Text><Text style={[s.cell, s.category]}>{row.category || 'Uncategorized'}</Text><Text style={[s.cell, s.amount, s.bold, row.type === 'income' ? s.positive : row.type === 'expense' ? s.negative : {}]}>{row.type === 'income' ? '+' : row.type === 'expense' ? '-' : ''}{money(Math.abs(row.amount))}</Text></View>)}
      {!p.allTransactions.length && <Text style={s.note}>No transactions recorded in this period.</Text>}
      <View style={s.total} wrap={false}><Text style={s.bold}>Period net income</Text><Text style={[s.bold, p.netIncome < 0 ? s.negative : s.blue]}>{money(p.netIncome)}</Text></View><Footer />
    </Page>

    <Page size="A4" style={s.page}><Header report={p} /><Text style={s.eyebrow}>{sectionNumber('Report notes')} / Notes</Text><Text style={s.title}>About these figures</Text><Text style={s.lead}>Scope, privacy, and the record behind this report.</Text>
      <View style={s.notesBlock} wrap={false}><Text style={s.notesTitle}>What this report covers</Text><Text style={s.notesCopy}>Figures reflect the transactions, balances, categories, and coverage available in Fainens for {p.periodName}. Pending, missing, or uncategorized records can affect totals. Cash movement tracks cash-equivalent accounts, while income and spending follow the recorded ledger classification.</Text></View>
      <View style={s.notesBlock} wrap={false}><Text style={s.notesTitle}>Reading the numbers</Text><Text style={s.notesCopy}>Net income is recorded income less expenses. Savings rate is net income divided by income; it is shown as N/A when income is zero or negative. Budget variance is planned spending minus recorded spending, so a positive value is still available and a negative value is over plan. Charts show the share of each source or category, with smaller items grouped together.</Text></View>
      <View style={s.notesBlock} wrap={false}><Text style={s.notesTitle}>Personal use and privacy</Text><Text style={s.notesCopy}>This is a personal financial record, not professional tax, legal, investment, or accounting advice. Verify underlying entries before relying on the figures. Store the report securely and share it only with intended recipients.</Text></View>
      <View style={s.note} wrap={false}><Text style={s.notesTitle}>Report identity</Text><Text style={s.notesCopy}>Prepared {generatedAt}. The snapshot fingerprint below identifies the period data and ledger revision used to generate this report.</Text><Text style={s.hash}>SHA-256 / {p.reportHash}</Text></View><Footer />
    </Page>
  </Document>;
}
