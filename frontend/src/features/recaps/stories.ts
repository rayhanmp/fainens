import type { PeriodRecap, SavedRecapStory } from './queries';
import { formatRecapCurrency as formatCurrency } from './currency';
import { recapDisplayCopy, shortDisplayLabel } from './display-copy';

const DAY_MS = 86_400_000;

/** Recap days are local midnights in the server's time zone. Noon of the same instant lands on the same
 * calendar date for any zone within ±12h, so dates read the same whether the server runs in WIB or UTC. */
export const recapDay = (ms: number) => new Date(ms + DAY_MS / 2);
export const recapDayKey = (ms: number) => recapDay(ms).toISOString().slice(0, 10);
export const formatRecapDay = (ms: number, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en', { ...options, timeZone: 'UTC' }).format(recapDay(ms));

export function periodDateRange(period: { startDate: number; endDate: number }) {
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  return `${formatRecapDay(period.startDate, options)} – ${formatRecapDay(period.endDate, options)}`;
}

export type RecapTheme = 'lime' | 'ink' | 'lilac' | 'peach' | 'cream';
export type CategoryShare = { categoryId: number | null; name: string; label: string; amount: number; share: number };
export type RecapDayCell = { key: string; date: number; amount: number; purchaseCount: number; future: boolean; peak: boolean };
export type ReceiptItem = { label: string; fullLabel: string; category: string; date: number; amount: number };
export type ClosingTile = { label: string; value: string; money?: number; note?: string };

type Copy = { eyebrow: string; title: string; body: string };
export type RecapStory = Copy & { theme: RecapTheme } & (
  | { id: 'intro'; dateRange: string; isPartial: boolean; elapsedDays: number; totalDays: number }
  | { id: 'overview'; income: number; expenses: number; net: number; keptShare: number | null }
  | { id: 'budget'; planned: number; spent: number; remaining: number; percentUsed: number | null; elapsedShare: number | null; over: Array<{ name: string; over: number }>; unbudgeted: number }
  | { id: 'categories'; total: number; rows: CategoryShare[]; others: { count: number; amount: number; share: number } | null; count: number }
  | { id: 'calendar'; days: RecapDayCell[] | null; spendingDays: number; totalDays: number; peak: { date: number; amount: number; purchaseCount: number } | null }
  | { id: 'receipts'; items: ReceiptItem[]; largestShare: number | null; purchaseCount: number }
  | { id: 'habits'; purchaseCount: number; median: number | null; average: number | null; spendingDays: number; repeat: { label: string; fullLabel: string; occurrences: number; total: number } | null }
  | { id: 'comparison'; mode: 'average' | 'total'; now: number; before: number; change: number; beforeLabel: string; matchedElapsed: boolean }
  | { id: 'closing'; tiles: ClosingTile[] }
);
export type RecapStoryId = RecapStory['id'];
type ChapterData = RecapStory extends infer Story ? Story extends RecapStory ? Omit<Story, 'theme' | keyof Copy> : never : never;

// Older editions saved app-written transfer fees as a "recurring purchase"; they are not habits.
const isSystemDescription = (description: string) => /^transfer fee:/i.test(description.trim());

const palettes: RecapTheme[][] = [
  ['lime', 'ink', 'lilac', 'cream', 'peach', 'ink', 'lilac', 'cream', 'lime'],
  ['lilac', 'cream', 'ink', 'peach', 'lime', 'ink', 'cream', 'peach', 'lilac'],
  ['peach', 'ink', 'lime', 'lilac', 'cream', 'ink', 'peach', 'lilac', 'peach'],
  ['cream', 'peach', 'ink', 'lime', 'lilac', 'ink', 'cream', 'lime', 'cream'],
  ['ink', 'lime', 'peach', 'cream', 'lilac', 'ink', 'lime', 'peach', 'ink'],
  ['peach', 'cream', 'lilac', 'ink', 'lime', 'peach', 'ink', 'lime', 'peach'],
  ['lilac', 'lime', 'cream', 'ink', 'peach', 'lilac', 'ink', 'cream', 'lilac'],
  ['lime', 'peach', 'cream', 'lilac', 'ink', 'lime', 'peach', 'ink', 'lime'],
];

export function buildStories(recap: PeriodRecap, edition?: SavedRecapStory): RecapStory[] {
  const { labels, compact } = recapDisplayCopy(recap, edition);
  const seed = edition?.seed ?? recap.period.id;
  const saved = (id: string) => edition?.copy.chapters.find(chapter => chapter.id === id);
  const totalDays = Math.max(1, Math.round((recap.endMs - recap.startMs + 1) / DAY_MS));
  const elapsedDays = Math.min(totalDays, Math.max(1, Math.floor((Math.min(recap.generatedAt, recap.endMs) - recap.startMs) / DAY_MS) + 1));
  const peak = recap.highlights?.peakSpendingDay ?? null;
  const budget = recap.budget;
  const profile = recap.purchaseProfile ?? null;
  const repeatRow = recap.highlights?.repeatPurchases?.find(row => !isSystemDescription(row.description)) ?? null;
  const baseline = recap.coverageComplete ? recap.baseline : null;
  const average = profile && recap.purchaseCount > 0 ? profile.totalAmount / recap.purchaseCount : null;
  const priorAverage = baseline?.purchaseTotal !== undefined && baseline.purchaseTotal > 0 && baseline.purchaseCount > 0
    ? baseline.purchaseTotal / baseline.purchaseCount : null;
  const averageChange = average !== null && priorAverage !== null ? Math.round((average - priorAverage) / priorAverage * 100) : null;
  const keptShare = recap.income > 0 && recap.net >= 0 ? Math.round(recap.net / recap.income * 100) : null;
  const positiveCategories = recap.categories.filter(row => row.amount > 0);
  const categoryTotal = positiveCategories.reduce((sum, row) => sum + row.amount, 0);
  const share = (amount: number) => categoryTotal > 0 ? Math.round(amount / categoryTotal * 100) : 0;
  const topRows: CategoryShare[] = positiveCategories.slice(0, 5).map((row, i) => ({
    categoryId: row.categoryId ?? null, name: row.name, label: labels[`category${i + 1}`] ?? shortDisplayLabel(row.name), amount: row.amount, share: share(row.amount),
  }));
  const rest = positiveCategories.slice(5);
  const restAmount = rest.reduce((sum, row) => sum + row.amount, 0);
  const top = topRows[0];

  // Every day of the period, with net expenses where the saved edition has them.
  const dailyByKey = new Map((recap.daily ?? []).map(day => [recapDayKey(day.date), day]));
  const peakKey = peak ? recapDayKey(peak.date) : null;
  const days: RecapDayCell[] | null = recap.daily ? Array.from({ length: totalDays }, (_, i) => {
    const date = recap.startMs + i * DAY_MS;
    const key = recapDayKey(date);
    const day = dailyByKey.get(key);
    return { key, date, amount: day?.amount ?? 0, purchaseCount: day?.purchaseCount ?? 0, future: recap.isPartial && i >= elapsedDays, peak: key === peakKey };
  }) : null;

  const purchases = recap.highlights?.topPurchases ?? [];
  const receiptItems: ReceiptItem[] = purchases.map((row, i) => ({
    label: labels[`purchase${i + 1}`] ?? shortDisplayLabel(row.description), fullLabel: row.description, category: row.category, date: row.date, amount: row.amount,
  }));
  const largestShare = profile && recap.largestPurchase ? Math.min(100, Math.round(recap.largestPurchase.amount / profile.totalAmount * 100)) : null;
  const dayLabel = (ms: number) => formatRecapDay(ms, { weekday: 'short', day: 'numeric', month: 'short' });

  const fallback: Record<RecapStoryId, Copy> = {
    intro: { eyebrow: 'Your period, in review', title: 'Roll the highlights.', body: `${recap.period.name}${recap.isPartial ? ', so far' : ''}. Let’s look back.` },
    overview: { eyebrow: 'Money in, money out', title: recap.net >= 0 ? 'More came in than went out.' : 'Expenses overtook income.', body: 'Income and expenses for the period, side by side.' },
    budget: { eyebrow: recap.isPartial ? 'The plan, so far' : 'The plan meets the receipts', title: budget?.overBudgetCategoryCount ? 'Some categories redrew the lines.' : 'The plan held its shape.', body: 'Your allocations next to what was spent in them.' },
    categories: { eyebrow: 'Where it went', title: top ? `${top.label} led the way.` : 'A quiet period.', body: 'Your expense categories, by share of spending.' },
    calendar: { eyebrow: 'The period, day by day', title: peak ? 'One day turned up the volume.' : 'Your period had a beat.', body: 'Darker days had more spending.' },
    receipts: { eyebrow: 'The standout receipts', title: 'The biggest receipts.', body: 'Your three largest purchases this period.' },
    habits: { eyebrow: 'How you bought', title: 'Small receipts did the heavy lifting.', body: 'How often you bought, and what a typical receipt looked like.' },
    comparison: { eyebrow: 'Then and now', title: averageChange !== null ? 'The average receipt changed size.' : 'The expense total changed.', body: 'Compared with your previous periods.' },
    closing: { eyebrow: 'The period, in one card', title: 'Same you. Fresh chapter.', body: 'What gets a little more room next period?' },
  };
  // Each new chapter reads the saved copy written for the chapter whose job it now does.
  const copySource: Record<RecapStoryId, string> = {
    intro: 'intro', overview: 'overview', budget: 'budget', categories: 'spotlight', calendar: peak ? 'peak' : 'rhythm',
    receipts: 'moment', habits: repeatRow ? 'purchases' : 'balance', comparison: 'comparison', closing: 'closing',
  };
  const copyFor = (id: RecapStoryId): Copy => {
    const source = saved(copySource[id]);
    const base = fallback[id];
    if (!source) return base;
    // A fee-led "recurring receipt" line from an older edition no longer matches what the chapter shows.
    if (id === 'habits' && /transfer fee:/i.test(source.body)) return base;
    const title = compact(source.title);
    // Older editions could open a body with an interpolated lower-case insight ("income rose…").
    const body = compact(source.body).replace(/^\p{Ll}/u, letter => letter.toUpperCase());
    // A complete fallback hook is preferable to clipping an overlong old headline.
    const titleFits = title.length <= 56 && !/(?:\b(?:and|with|at|dan|dengan|di)|[,;:]|…|\.\.\.)\s*$/i.test(title);
    return {
      eyebrow: id === 'categories' || id === 'calendar' || id === 'receipts' || id === 'closing' ? base.eyebrow : shortDisplayLabel(source.eyebrow, 40),
      title: titleFits ? title : base.title,
      body: body.length <= 160 ? body : base.body,
    };
  };

  const closingTiles: ClosingTile[] = [
    { label: recap.net >= 0 ? 'Left over' : 'Shortfall', value: formatCurrency(Math.abs(recap.net)), money: Math.abs(recap.net), note: keptShare !== null ? `${keptShare}% of income` : undefined },
    ...(top ? [{ label: 'Top category', value: top.label, note: `${top.share}% of spending` }] : []),
    ...(peak ? [{ label: 'Busiest day', value: dayLabel(peak.date), note: `${peak.purchaseCount} ${peak.purchaseCount === 1 ? 'purchase' : 'purchases'}` }] : []),
    { label: 'Purchases', value: String(recap.purchaseCount), note: `over ${recap.spendingDays} ${recap.spendingDays === 1 ? 'day' : 'days'}` },
  ];

  const chapters: Array<ChapterData | null> = [
    { id: 'intro', dateRange: periodDateRange(recap.period), isPartial: recap.isPartial, elapsedDays, totalDays },
    { id: 'overview', income: recap.income, expenses: recap.expenses, net: recap.net, keptShare },
    budget ? { id: 'budget', planned: budget.planned, spent: budget.spent, remaining: budget.remaining, percentUsed: budget.percentUsed,
      elapsedShare: recap.isPartial ? Math.round(elapsedDays / totalDays * 100) : null,
      over: budget.overBudgetCategories.map(row => ({ name: row.name, over: row.over })), unbudgeted: budget.unbudgetedExpenses } : null,
    top ? { id: 'categories', total: categoryTotal, rows: topRows, others: rest.length ? { count: rest.length, amount: restAmount, share: share(restAmount) } : null, count: positiveCategories.length } : null,
    recap.purchaseCount > 0 ? { id: 'calendar', days, spendingDays: recap.spendingDays, totalDays, peak } : null,
    receiptItems.length ? { id: 'receipts', items: receiptItems, largestShare, purchaseCount: recap.purchaseCount } : null,
    recap.purchaseCount > 1 ? { id: 'habits', purchaseCount: recap.purchaseCount, median: profile?.medianAmount ?? null, average, spendingDays: recap.spendingDays,
      repeat: repeatRow ? { label: labels.repeatPurchase1 && !isSystemDescription(labels.repeatPurchase1) ? labels.repeatPurchase1 : shortDisplayLabel(repeatRow.description), fullLabel: repeatRow.description, occurrences: repeatRow.occurrences, total: repeatRow.totalAmount } : null } : null,
    averageChange !== null ? { id: 'comparison', mode: 'average', now: Math.round(average!), before: Math.round(priorAverage!), change: averageChange,
      beforeLabel: baseline!.periodCount === 1 ? 'Previous period' : `Avg of ${baseline!.periodCount} periods`, matchedElapsed: Boolean(baseline?.matchedElapsed) }
      : recap.comparison ? { id: 'comparison', mode: 'total', now: recap.expenses, before: recap.comparison.previousExpenses, change: Math.round(recap.comparison.changePercent),
        beforeLabel: shortDisplayLabel(recap.comparison.periodName, 24), matchedElapsed: false } : null,
    { id: 'closing', tiles: closingTiles },
  ];
  const palette = palettes[seed % palettes.length];
  return chapters.filter(chapter => chapter !== null).map((chapter, i) => ({
    ...chapter, ...copyFor(chapter.id), theme: palette[i % palette.length],
  }) as RecapStory);
}
