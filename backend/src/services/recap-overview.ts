import type { SavedRecapStory } from './recap-schemas';

type Snapshot = SavedRecapStory['snapshot'];

export function recapOverview(snapshot: Snapshot, seed = 0, language: 'en' | 'id' = 'en') {
  const id = language === 'id';
  const take = seed % 3;
  const baseline = snapshot.coverageComplete ? snapshot.baseline : null;
  const change = (current: number, previous: number) =>
    previous > 0 && current >= 0 ? Math.round((current - previous) / previous * 100) : null;
  const changes = baseline ? {
    purchases: change(snapshot.purchaseCount, baseline.purchaseCount),
    income: change(snapshot.income, baseline.income),
    expenses: change(snapshot.expenses, baseline.expenses),
  } : null;
  const trend = (subject: string, delta: number) => {
    if (delta === 0) return `${subject} ${id ? 'hampir sama' : 'was about the same'}`;
    if (delta > 999) return `${subject} ${id ? 'naik lebih dari 10×' : 'rose more than tenfold'}`;
    return `${subject} ${id ? delta > 0 ? 'naik' : 'turun' : delta > 0 ? 'rose' : 'fell'} ${Math.abs(delta)}%`;
  };
  if (baseline && changes) {
    const metrics = [
      { key: 'purchases', label: id ? 'Pembelian' : 'Purchases', delta: changes.purchases },
      { key: 'income', label: id ? 'pemasukan' : 'income', delta: changes.income },
      { key: 'expenses', label: id ? 'pengeluaran' : 'expenses', delta: changes.expenses },
    ].filter((metric): metric is typeof metric & { delta: number } => metric.delta !== null);
    // Lead with a real contrast. More purchases do not necessarily mean more
    // spending, and larger income can change the meaning of a busy period.
    const pair = changes.purchases !== null && changes.purchases >= 10
      ? metrics.filter(metric => metric.key === 'purchases' || metric.key === (changes.income !== null && Math.abs(changes.income) >= 10 ? 'income' : 'expenses'))
      : metrics.filter(metric => metric.key !== 'purchases');
    const selected = (pair.length ? pair : metrics).slice(0, 2);
    if (selected.length) {
      const scope = baseline.periodCount === 1
        ? id ? 'vs satu period lengkap sebelumnya' : 'vs a prior complete period'
        : id ? `vs rata-rata ${baseline.periodCount} period sebelumnya` : `vs the average of ${baseline.periodCount} prior periods`;
      const timing = baseline.matchedElapsed ? id ? ' pada titik yang sama' : ' at the same point' : '';
      const body = `${selected.map(metric => trend(metric.label, metric.delta)).join(id ? ', sementara ' : ', while ')} ${scope}${timing}.`;
      const morePurchases = selected.some(metric => metric.key === 'purchases' && metric.delta >= 10);
      const biggerIncome = changes.income !== null && changes.income >= 10;
      const smallerExpenses = changes.expenses !== null && changes.expenses <= -10;
      const title = morePurchases && biggerIncome
        ? (id ? ['Lebih banyak struk. Pemasukan juga naik.', 'Struk ramai, pemasukan ikut naik.', 'Pembelian naik. Pemasukan menyusul.'] : ['More receipts. Bigger income, too.', 'A busier ledger. A bigger income.', 'Receipts multiplied. So did income.'])[take]
        : morePurchases && smallerExpenses
          ? id ? 'Struk bertambah, totalnya malah turun.' : 'More receipts. A smaller expense total.'
          : morePurchases && changes.income !== null && changes.income <= -10
            ? id ? 'Pembelian naik, pemasukan turun.' : 'More purchases. Less income this time.'
            : biggerIncome && smallerExpenses
              ? id ? 'Pemasukan naik, pengeluaran turun.' : 'Income grew. Expenses went the other way.'
              : selected.every(metric => Math.abs(metric.delta) < 10)
                ? id ? 'Ritme yang cukup familiar.' : 'A familiar pace, this time.'
                : id ? 'Ada yang berubah di angka-angka ini.' : 'The numbers took a different turn.';
      return { title, body, changes, expenseIncomeShare: null };
    }
  }
  const share = snapshot.income > 0 && snapshot.expenses >= 0 ? Math.round(snapshot.expenses / snapshot.income * 100) : null;
  const qualifier = snapshot.isPartial ? id ? ' sejauh ini' : ' so far' : '';
  if (share !== null) {
    const balance = snapshot.net > 0 ? id ? 'menyisakan surplus tercatat' : 'leaving a recorded surplus'
      : snapshot.net < 0 ? id ? 'lebih besar dari pemasukan' : 'exceeding recorded income'
        : id ? 'pas dengan pemasukan' : 'matching recorded income';
    const title = snapshot.net < 0 ? id ? 'Pengeluaran melampaui pemasukan.' : 'Expenses overtook income.'
      : share <= 50 ? (id ? ['Pemasukan punya porsi lebih besar.', share === 50 ? 'Struknya mengambil sekitar separuh.' : 'Struknya belum mengambil separuh.', 'Lebih banyak masuk daripada keluar.'] : ['Income had the bigger slice.', share === 50 ? 'The receipts took about half.' : 'The receipts took less than half.', 'More came in than went out.'])[take]
        : snapshot.net > 0 ? id ? 'Pengeluaran mendominasi, masih ada selisih.' : 'Expenses took most. Income still led.'
          : id ? 'Pemasukan dan pengeluaran bertemu.' : 'Income and expenses met in the middle.';
    const body = id ? `Pengeluaran${qualifier} setara ${share}% pemasukan tercatat, ${balance}.`
      : `Expenses${qualifier} used ${share}% of recorded income, ${balance}.`;
    return { title, body, changes, expenseIncomeShare: share };
  }
  return {
    title: snapshot.expenses < 0 ? id ? 'Kredit mengubah hasil akhirnya.' : 'Credits changed the balance.'
      : snapshot.expenses > 0 ? id ? 'Struk ada. Pemasukan belum tercatat.' : 'Receipts in. No recorded income yet.'
        : id ? 'Belum banyak angka untuk dibandingkan.' : 'A quiet ledger so far.',
    body: snapshot.expenses < 0 ? id ? 'Kredit pengeluaran melebihi pembelian dalam catatan period ini.' : 'Expense credits outweighed purchases in this period’s entries.'
      : snapshot.expenses > 0 ? id ? 'Ada pengeluaran, tetapi belum ada pemasukan positif untuk membandingkan porsinya.' : 'Expenses are present, but no positive income is recorded to compare their share with.'
        : id ? 'Belum ada pemasukan positif atau pengeluaran neto di catatan ini.' : 'These entries show neither positive income nor positive net expenses yet.',
    changes, expenseIncomeShare: null,
  };
}
