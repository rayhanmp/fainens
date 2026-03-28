import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: {
    padding: 30,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: '#1f2937',
  },
  bold: {
    fontFamily: 'Helvetica-Bold',
  },
  boldLarge: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 18,
  },
  header: {
    marginBottom: 30,
    borderBottomWidth: 2,
    borderBottomColor: '#3b82f6',
    paddingBottom: 20,
  },
  brandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brandName: {
    fontSize: 24,
    fontWeight: 700,
    color: '#3b82f6',
  },
  reportTitle: {
    fontSize: 14,
    color: '#6b7280',
  },
  period: {
    fontSize: 12,
    color: '#374151',
    marginTop: 4,
  },
  section: {
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#1f2937',
    marginBottom: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: 15,
    marginBottom: 10,
  },
  summaryGridRow: {
    flexDirection: 'row',
    gap: 15,
    marginBottom: 10,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#f9fafb',
    padding: 15,
    borderRadius: 8,
    minHeight: 60,
  },
  summaryLabel: {
    fontSize: 9,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: 700,
    color: '#1f2937',
  },
  summaryPositive: {
    color: '#10b981',
  },
  summaryNegative: {
    color: '#ef4444',
  },
  table: {
    marginTop: 8,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#3b82f6',
    padding: 10,
    borderRadius: 4,
    marginBottom: 4,
  },
  tableHeaderCell: {
    fontSize: 9,
    fontWeight: 700,
    color: '#ffffff',
    textTransform: 'uppercase',
    paddingRight: 8,
  },
  tableRow: {
    flexDirection: 'row',
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  tableRowAlt: {
    flexDirection: 'row',
    padding: 8,
    backgroundColor: '#f9fafb',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  tableCell: {
    fontSize: 10,
    color: '#374151',
    paddingRight: 8,
  },
  tableCellRight: {
    fontSize: 10,
    color: '#374151',
    textAlign: 'right',
    paddingLeft: 8,
    paddingRight: 4,
  },
  colDate: { width: '15%' },
  colDesc: { width: '50%' },
  colCat: { width: '20%' },
  colAmt: { width: '15%' },
  col1: { width: '50%' },
  col2: { width: '25%' },
  col3: { width: '25%' },
  col4: { width: '15%' },
  col5: { width: '20%' },
  col6: { width: '15%' },
  
  rowTotal: {
    flexDirection: 'row',
    padding: 10,
    backgroundColor: '#f9fafb',
    borderRadius: 4,
    marginTop: 4,
  },
  rowTotalCell: {
    fontSize: 11,
    fontWeight: 600,
    color: '#1f2937',
  },
  
  twoCol: {
    flexDirection: 'row',
    gap: 20,
  },
  colLeft: { flex: 1 },
  colRight: { flex: 1 },
  
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 30,
    right: 30,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 10,
  },
  footerText: {
    fontSize: 8,
    color: '#9ca3af',
  },
  pageNumber: {
    fontSize: 8,
    color: '#9ca3af',
  },
  
  positive: { color: '#10b981' },
  negative: { color: '#ef4444' },
  neutral: { color: '#6b7280' },
  accent: { color: '#3b82f6' },
});

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

const formatPercent = (value: number) => {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
};

interface MonthlyReportProps {
  periodName: string;
  startDate: string;
  endDate: string;
  totalIncome: number;
  totalExpenses: number;
  netIncome: number;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  incomeBySource: Array<{ name: string; amount: number }>;
  expensesByCategory: Array<{ name: string; amount: number; color: string }>;
  budgetComparison: Array<{ category: string; budget: number; actual: number; variance: number }>;
  allTransactions: Array<{ date: string; description: string; category: string; amount: number; type: string }>;
}

export function MonthlyReportPDF({
  periodName,
  startDate,
  endDate,
  totalIncome,
  totalExpenses,
  netIncome,
  totalAssets,
  totalLiabilities,
  netWorth,
  incomeBySource,
  expensesByCategory,
  budgetComparison,
  allTransactions,
}: MonthlyReportProps) {
  const savingsRate = totalIncome > 0 ? (netIncome / totalIncome) * 100 : 0;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <View>
              <Text style={styles.brandName}>Fainens</Text>
              <Text style={styles.reportTitle}>Monthly Financial Statement</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.period}>{periodName}</Text>
              <Text style={styles.neutral}>{startDate} - {endDate}</Text>
            </View>
          </View>
        </View>

        {/* Executive Summary */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Executive Summary</Text>
          <View style={styles.summaryGridRow}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Total Income</Text>
              <Text style={styles.summaryValue}>{formatCurrency(totalIncome)}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Total Expenses</Text>
              <Text style={styles.summaryValue}>{formatCurrency(totalExpenses)}</Text>
            </View>
          </View>
          <View style={styles.summaryGridRow}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Net Income</Text>
              <Text style={[styles.summaryValue, netIncome >= 0 ? styles.positive : styles.negative]}>
                {formatCurrency(netIncome)}
              </Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Savings Rate</Text>
              <Text style={[styles.summaryValue, savingsRate >= 0 ? styles.positive : styles.negative]}>
                {savingsRate.toFixed(1)}%
              </Text>
            </View>
          </View>
        </View>

        {/* Net Worth */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Net Worth Summary</Text>
          <View style={styles.summaryGrid}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Total Assets</Text>
              <Text style={[styles.summaryValue, styles.positive]}>{formatCurrency(totalAssets)}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Total Liabilities</Text>
              <Text style={[styles.summaryValue, styles.negative]}>{formatCurrency(totalLiabilities)}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Net Worth</Text>
              <Text style={[styles.summaryValue, styles.accent]}>{formatCurrency(netWorth)}</Text>
            </View>
          </View>
        </View>

        {/* Income & Expenses */}
        <View style={styles.section}>
          <View style={styles.twoCol}>
            {/* Income by Source */}
            <View style={styles.colLeft}>
              <Text style={styles.sectionTitle}>Income by Source</Text>
              <View style={styles.table}>
                <View style={styles.tableHeader}>
                  <Text style={[styles.tableHeaderCell, styles.col1]}>Source</Text>
                  <Text style={[styles.tableHeaderCell, styles.col2, styles.col3]}>Amount</Text>
                </View>
                {incomeBySource.map((item, index) => (
                  <View key={index} style={styles.tableRow}>
                    <Text style={[styles.tableCell, styles.col1]}>{item.name}</Text>
                    <Text style={[styles.tableCellRight, styles.col2, styles.col3]}>{formatCurrency(item.amount)}</Text>
                  </View>
                ))}
                <View style={styles.rowTotal}>
                  <Text style={[styles.rowTotalCell, styles.col1]}>Total</Text>
                  <Text style={[styles.rowTotalCell, styles.col2, styles.col3]}>{formatCurrency(totalIncome)}</Text>
                </View>
              </View>
            </View>

            {/* Top Expenses */}
            <View style={styles.colRight}>
              <Text style={styles.sectionTitle}>Top Expenses</Text>
              <View style={styles.table}>
                <View style={styles.tableHeader}>
                  <Text style={[styles.tableHeaderCell, styles.col1]}>Category</Text>
                  <Text style={[styles.tableHeaderCell, styles.col2, styles.col3]}>Amount</Text>
                </View>
                {expensesByCategory.slice(0, 8).map((item, index) => (
                  <View key={index} style={styles.tableRow}>
                    <Text style={[styles.tableCell, styles.col1]}>{item.name}</Text>
                    <Text style={[styles.tableCellRight, styles.col2, styles.col3]}>{formatCurrency(item.amount)}</Text>
                  </View>
                ))}
                <View style={styles.rowTotal}>
                  <Text style={[styles.rowTotalCell, styles.col1]}>Total</Text>
                  <Text style={[styles.rowTotalCell, styles.col2, styles.col3]}>{formatCurrency(totalExpenses)}</Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* Budget Comparison */}
        {budgetComparison.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Budget vs Actual</Text>
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderCell, styles.col1]}>Category</Text>
                <Text style={[styles.tableHeaderCell, styles.col4]}>Budget</Text>
                <Text style={[styles.tableHeaderCell, styles.col5]}>Actual</Text>
                <Text style={[styles.tableHeaderCell, styles.col6]}>Variance</Text>
              </View>
              {budgetComparison.map((item, index) => (
                <View key={index} style={styles.tableRow}>
                  <Text style={[styles.tableCell, styles.col1]}>{item.category}</Text>
                  <Text style={[styles.tableCellRight, styles.col4]}>{formatCurrency(item.budget)}</Text>
                  <Text style={[styles.tableCellRight, styles.col5]}>{formatCurrency(item.actual)}</Text>
                  <Text style={[styles.tableCellRight, styles.col6, item.variance >= 0 ? styles.positive : styles.negative]}>
                    {formatPercent(item.variance)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>Generated by Fainens Personal Finance</Text>
          <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => (
            `${pageNumber} of ${totalPages}`
          )} />
        </View>
      </Page>

      {/* Page 2: All Transactions */}
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <View>
              <Text style={styles.brandName}>Fainens</Text>
              <Text style={styles.reportTitle}>Transaction Details</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.period}>{periodName}</Text>
              <Text style={styles.neutral}>{allTransactions.length} transactions</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          {/* Render transactions in chunks that fit on pages - header is 1 row, footer space ~2 rows, so ~22 rows max per page */}
          {Array.from({ length: Math.ceil(allTransactions.length / 22) }).map((_, pageIndex) => {
            const startIdx = pageIndex * 22;
            const pageTransactions = allTransactions.slice(startIdx, startIdx + 22);
            return (
              <View key={pageIndex} style={styles.table} break={pageIndex > 0}>
                <View style={styles.tableHeader}>
                  <Text style={[styles.tableHeaderCell, styles.colDate]}>Date</Text>
                  <Text style={[styles.tableHeaderCell, styles.colDesc]}>Description</Text>
                  <Text style={[styles.tableHeaderCell, styles.colCat]}>Category</Text>
                  <Text style={[styles.tableHeaderCell, styles.colAmt]}>Amount</Text>
                </View>
                {pageTransactions.map((tx, idx) => (
                  <View key={idx} style={idx % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
                    <Text style={[styles.tableCell, styles.colDate]}>{tx.date}</Text>
                    <Text style={[styles.tableCell, styles.colDesc]}>{tx.description}</Text>
                    <Text style={[styles.tableCell, styles.colCat]}>{tx.category}</Text>
                    <Text style={[styles.tableCellRight, styles.colAmt, tx.type === 'income' ? styles.positive : styles.negative]}>
                      {tx.type === 'income' ? '+' : '-'}{formatCurrency(tx.amount)}
                    </Text>
                  </View>
                ))}
              </View>
            );
          })}
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>Generated by Fainens Personal Finance</Text>
          <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => (
            `${pageNumber} of ${totalPages}`
          )} />
        </View>
      </Page>
    </Document>
  );
}
