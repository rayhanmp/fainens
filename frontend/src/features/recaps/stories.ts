import type { PeriodRecap, SavedRecapStory } from './queries';
import { recapDisplayCopy, shortDisplayLabel } from './display-copy';
import { pickFrom, seeded } from './motion';
import { chapterCopy, type CopyFacts } from './variations';

const DAY_MS = 86_400_000;

/** Recap days are local midnights in the server's time zone. Noon of the same instant lands on the same
 * calendar date for any zone within ±12h, so dates read the same whether the server runs in WIB or UTC. */
export const recapDay = (ms: number) => new Date(ms + DAY_MS / 2);
export const recapDayKey = (ms: number) => recapDay(ms).toISOString().slice(0, 10);
export const formatRecapDay = (ms: number, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en', { ...options, timeZone: 'UTC' }).format(recapDay(ms));
/** Monday-first weekday index of a recap day. */
export const recapWeekday = (ms: number) => (recapDay(ms).getUTCDay() + 6) % 7;
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function periodDateRange(period: { startDate: number; endDate: number }) {
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  return `${formatRecapDay(period.startDate, options)} – ${formatRecapDay(period.endDate, options)}`;
}

export type RecapTheme = 'lime' | 'ink' | 'lilac' | 'peach' | 'cream';
// The same paper and ink pairs as the story themes in recaps.css, for drawing outside CSS.
export const themeColors: Record<RecapTheme, { paper: string; ink: string }> = {
  lime: { paper: '#d5f478', ink: '#183529' }, ink: { paper: '#1f3a31', ink: '#e2f5bd' }, lilac: { paper: '#d8cff7', ink: '#2d2348' },
  peach: { paper: '#ffd2b7', ink: '#5e3021' }, cream: { paper: '#eee9dd', ink: '#2f3a30' },
};
export type CategoryShare = { categoryId: number | null; name: string; label: string; amount: number; share: number };
export type RecapDayCell = { key: string; date: number; amount: number; purchaseCount: number; future: boolean; peak: boolean };
export type ReceiptItem = { label: string; fullLabel: string; category: string; date: number; amount: number };
export type ClosingTile = { label: string; value: string; money?: number; note?: string };
export type Streak = { start: number; length: number } | null;

type Copy = { eyebrow: string; title: string; body: string };
export type RecapStory = Copy & { theme: RecapTheme } & (
  | { id: 'intro'; dateRange: string; isPartial: boolean; elapsedDays: number; totalDays: number; monthWord: string }
  | { id: 'overview'; lead: 'left' | 'ratio'; income: number; expenses: number; net: number; keptShare: number | null; spentPer100: number | null }
  | { id: 'budget'; planned: number; spent: number; remaining: number; percentUsed: number | null; elapsedShare: number | null; over: Array<{ name: string; over: number }>; unbudgeted: number }
  | { id: 'categories'; lead: 'top' | 'top3' | 'count'; total: number; rows: CategoryShare[]; others: { count: number; amount: number; share: number } | null; count: number; top3Share: number }
  | { id: 'calendar'; lead: 'days' | 'peak'; days: RecapDayCell[] | null; spendingDays: number; elapsedDays: number; peak: { date: number; amount: number; purchaseCount: number } | null }
  | { id: 'weekdays'; lead: 'weekday' | 'weekend'; totals: number[]; busiest: number; weekendShare: number }
  | { id: 'streak'; lead: 'quiet' | 'busy'; days: RecapDayCell[]; quiet: Streak; busy: Streak }
  | { id: 'receipts'; items: ReceiptItem[]; largestShare: number | null; topShare: number | null; purchaseCount: number }
  | { id: 'habits'; lead: 'count' | 'typical' | 'perDay'; purchaseCount: number; median: number | null; average: number | null; perDay: number; spendingDays: number; repeat: { label: string; fullLabel: string; occurrences: number; total: number } | null }
  | { id: 'comparison'; mode: 'average' | 'total'; now: number; before: number; change: number; beforeLabel: string; matchedElapsed: boolean }
  | { id: 'closing'; tiles: ClosingTile[] }
);
export type RecapStoryId = RecapStory['id'];
type ChapterData = RecapStory extends infer Story ? Story extends RecapStory ? Omit<Story, 'theme' | keyof Copy> : never : never;

// Older editions saved app-written transfer fees as a "recurring purchase"; they are not habits.
const isSystemDescription = (description: string) => /^transfer fee:/i.test(description.trim());

const palettes: RecapTheme[][] = [
  ['lime', 'ink', 'lilac', 'cream', 'peach', 'ink', 'lilac', 'cream', 'lime', 'peach', 'ink'],
  ['lilac', 'cream', 'ink', 'peach', 'lime', 'ink', 'cream', 'peach', 'lilac', 'lime', 'ink'],
  ['peach', 'ink', 'lime', 'lilac', 'cream', 'ink', 'peach', 'lilac', 'lime', 'cream', 'peach'],
  ['cream', 'peach', 'ink', 'lime', 'lilac', 'ink', 'cream', 'lime', 'peach', 'lilac', 'cream'],
  ['ink', 'lime', 'peach', 'cream', 'lilac', 'ink', 'lime', 'peach', 'lilac', 'cream', 'ink'],
  ['peach', 'cream', 'lilac', 'ink', 'lime', 'peach', 'ink', 'lime', 'cream', 'lilac', 'peach'],
  ['lilac', 'lime', 'cream', 'ink', 'peach', 'lilac', 'ink', 'cream', 'lime', 'peach', 'lilac'],
  ['lime', 'peach', 'cream', 'lilac', 'ink', 'lime', 'peach', 'ink', 'cream', 'lilac', 'lime'],
];

/** Longest run of days matching `test`, among elapsed days. */
function longestRun(days: RecapDayCell[], test: (day: RecapDayCell) => boolean): Streak {
  let best: Streak = null;
  let start = -1;
  days.forEach((day, i) => {
    if (test(day)) {
      if (start < 0) start = i;
      const length = i - start + 1;
      if (!best || length > best.length) best = { start, length };
    } else start = -1;
  });
  return best;
}

/**
 * The recap's chapters. `run` rolls the dice for this viewing: which fact each chapter leads with, the
 * copy it uses (the saved edition's copy is one of the options), the bonus chapters, their order and the
 * colours. The same run always builds the same chapters, so stepping back shows what you saw.
 */
export function buildStories(recap: PeriodRecap, edition?: SavedRecapStory, run = 0): RecapStory[] {
  const { labels, compact } = recapDisplayCopy(recap, edition);
  const seed = edition?.seed ?? recap.period.id;
  const random = seeded(seed * 31 + run);
  const chance = (p: number) => run !== 0 && random() < p;
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
  const spentPer100 = recap.income > 0 && recap.expenses >= 0 ? Math.round(recap.expenses / recap.income * 100) : null;
  const positiveCategories = recap.categories.filter(row => row.amount > 0);
  const categoryTotal = positiveCategories.reduce((sum, row) => sum + row.amount, 0);
  const share = (amount: number) => categoryTotal > 0 ? Math.round(amount / categoryTotal * 100) : 0;
  const topRows: CategoryShare[] = positiveCategories.slice(0, 5).map((row, i) => ({
    categoryId: row.categoryId ?? null, name: row.name, label: labels[`category${i + 1}`] ?? shortDisplayLabel(row.name), amount: row.amount, share: share(row.amount),
  }));
  const rest = positiveCategories.slice(5);
  const restAmount = rest.reduce((sum, row) => sum + row.amount, 0);
  const top = topRows[0];
  const top3Share = share(positiveCategories.slice(0, 3).reduce((sum, row) => sum + row.amount, 0));

  // Every day of the period, with net expenses where the saved edition has them.
  const dailyByKey = new Map((recap.daily ?? []).map(day => [recapDayKey(day.date), day]));
  const peakKey = peak ? recapDayKey(peak.date) : null;
  const days: RecapDayCell[] | null = recap.daily ? Array.from({ length: totalDays }, (_, i) => {
    const date = recap.startMs + i * DAY_MS;
    const key = recapDayKey(date);
    const day = dailyByKey.get(key);
    return { key, date, amount: day?.amount ?? 0, purchaseCount: day?.purchaseCount ?? 0, future: recap.isPartial && i >= elapsedDays, peak: key === peakKey };
  }) : null;
  const elapsed = days?.filter(day => !day.future) ?? [];
  const weekdayTotals = Array.from({ length: 7 }, (_, weekday) => elapsed.filter(day => recapWeekday(day.date) === weekday).reduce((sum, day) => sum + day.amount, 0));
  const weekTotal = weekdayTotals.reduce((sum, amount) => sum + amount, 0);
  const busiestWeekday = weekdayTotals.indexOf(Math.max(...weekdayTotals));
  const weekendShare = weekTotal > 0 ? Math.round((weekdayTotals[5] + weekdayTotals[6]) / weekTotal * 100) : 0;
  const quiet = longestRun(elapsed, day => day.amount === 0);
  const busy = longestRun(elapsed, day => day.amount > 0);

  const purchases = recap.highlights?.topPurchases ?? [];
  const receiptItems: ReceiptItem[] = purchases.map((row, i) => ({
    label: labels[`purchase${i + 1}`] ?? shortDisplayLabel(row.description), fullLabel: row.description, category: row.category, date: row.date, amount: row.amount,
  }));
  const largestShare = profile && recap.largestPurchase ? Math.min(100, Math.round(recap.largestPurchase.amount / profile.totalAmount * 100)) : null;
  const topShare = profile && purchases.length ? Math.min(100, Math.round(purchases.reduce((sum, row) => sum + row.amount, 0) / profile.totalAmount * 100)) : null;
  const dayLabel = (ms: number) => formatRecapDay(ms, { weekday: 'short', day: 'numeric', month: 'short' });
  const perDay = Math.round(Math.max(0, recap.expenses) / elapsedDays);

  // Bonus chapters appear in some runs; when one is left out its fact can lead another chapter instead.
  const hasWeek = elapsed.length >= 7 && recap.spendingDays >= 4 && weekTotal > 0;
  const showWeekdays = hasWeek && chance(.65);
  const showStreak = elapsed.length >= 7 && Boolean((quiet && quiet.length >= 2) || (busy && busy.length >= 3)) && chance(.6);
  const leads = {
    overview: spentPer100 !== null && chance(.45) ? 'ratio' as const : 'left' as const,
    categories: run === 0 ? 'top' as const : pickFrom(positiveCategories.length >= 4 ? ['top', 'top3', 'count'] as const : ['top'] as const, random),
    calendar: peak && chance(.5) ? 'peak' as const : 'days' as const,
    weekdays: weekendShare >= 35 && chance(.5) ? 'weekend' as const : 'weekday' as const,
    streak: quiet && quiet.length >= 2 && (!busy || busy.length < 3 || random() < .6) ? 'quiet' as const : 'busy' as const,
    habits: run === 0 ? (repeatRow ? 'count' as const : 'typical' as const) : pickFrom(profile ? ['count', 'typical', 'perDay'] as const : ['count', 'perDay'] as const, random),
  };

  const facts: CopyFacts = {
    period: recap.period.name, isPartial: recap.isPartial, net: recap.net, income: recap.income, expenses: recap.expenses, keptShare, spentPer100,
    budgetUsed: budget?.percentUsed ?? null, elapsedShare: recap.isPartial ? Math.round(elapsedDays / totalDays * 100) : null,
    remaining: budget?.remaining ?? null, overCategory: budget?.overBudgetCategories[0] ? labels.budgetCategory1 ?? budget.overBudgetCategories[0].name : null,
    top: top ? { label: top.label, share: top.share } : null, top3Share, categoryCount: positiveCategories.length,
    spendingDays: recap.spendingDays, elapsedDays, peak: peak ? { label: dayLabel(peak.date), weekday: WEEKDAYS[recapWeekday(peak.date)], amount: peak.amount, purchaseCount: peak.purchaseCount } : null,
    busiestWeekday: hasWeek ? WEEKDAYS[busiestWeekday] : null, weekendShare,
    quiet: quiet?.length ?? 0, busy: busy?.length ?? 0,
    receipt: receiptItems[0] ? { label: receiptItems[0].label, amount: receiptItems[0].amount, count: receiptItems.length } : null, largestShare, topShare,
    purchaseCount: recap.purchaseCount, median: profile?.medianAmount ?? null, average, perDay,
    repeat: repeatRow ? { label: labels.repeatPurchase1 && !isSystemDescription(labels.repeatPurchase1) ? labels.repeatPurchase1 : shortDisplayLabel(repeatRow.description), occurrences: repeatRow.occurrences } : null,
    change: averageChange ?? (recap.comparison ? Math.round(recap.comparison.changePercent) : null), changeMode: averageChange !== null ? 'average' : 'total',
  };

  // The saved edition's copy was written for these facts, so it is an option only where the chapter
  // leads with the same fact it described.
  const copySource: Partial<Record<RecapStoryId, string>> = {
    intro: 'intro', overview: leads.overview === 'left' ? 'overview' : undefined, budget: 'budget', categories: leads.categories === 'top' ? 'spotlight' : undefined,
    calendar: leads.calendar === 'peak' ? 'peak' : undefined, receipts: 'moment', habits: leads.habits === 'count' && repeatRow ? 'purchases' : leads.habits === 'typical' ? 'balance' : undefined,
    comparison: 'comparison', closing: 'closing',
  };
  const savedCopy = (id: RecapStoryId): Copy | null => {
    const source = copySource[id] ? edition?.copy.chapters.find(chapter => chapter.id === copySource[id]) : undefined;
    if (!source) return null;
    // A fee-led "recurring receipt" line from an older edition no longer matches what the chapter shows.
    if (id === 'habits' && /transfer fee:/i.test(source.body)) return null;
    const title = compact(source.title);
    // Older editions could open a body with an interpolated lower-case insight ("income rose…").
    const body = compact(source.body).replace(/^\p{Ll}/u, letter => letter.toUpperCase());
    const titleFits = title.length <= 56 && !/(?:\b(?:and|with|at|dan|dengan|di)|[,;:]|…|\.\.\.)\s*$/i.test(title);
    if (!titleFits || body.length > 160) return null;
    return { eyebrow: shortDisplayLabel(source.eyebrow, 40), title, body };
  };
  const copyFor = (id: RecapStoryId, lead?: string): Copy => {
    const pool = chapterCopy(id, lead, facts);
    const saved = savedCopy(id);
    // Without a run (the share card, first paint) the saved edition's copy leads; otherwise it is one
    // voice among the generated ones.
    if (saved && (run === 0 || random() < .4)) return { ...saved, eyebrow: pool[0]?.eyebrow ?? saved.eyebrow };
    return pool.length ? pickFrom(pool, random) : saved ?? { eyebrow: '', title: recap.period.name, body: '' };
  };

  const closingTiles: ClosingTile[] = [
    { label: recap.net >= 0 ? 'Left over' : 'Shortfall', value: '', money: Math.abs(recap.net), note: keptShare !== null ? `${keptShare}% of income` : undefined },
    ...(top ? [{ label: 'Top category', value: top.label, note: `${top.share}% of spending` }] : []),
    ...(peak ? [{ label: 'Busiest day', value: dayLabel(peak.date), note: `${peak.purchaseCount} ${peak.purchaseCount === 1 ? 'purchase' : 'purchases'}` }] : []),
    ...(showStreak && quiet && quiet.length >= 2 ? [{ label: 'Quiet streak', value: `${quiet.length} days`, note: 'without spending' }]
      : [{ label: 'Purchases', value: String(recap.purchaseCount), note: `over ${recap.spendingDays} ${recap.spendingDays === 1 ? 'day' : 'days'}` }]),
  ];

  const middle: Array<ChapterData | null> = [
    top ? { id: 'categories', lead: leads.categories, total: categoryTotal, rows: topRows, others: rest.length ? { count: rest.length, amount: restAmount, share: share(restAmount) } : null, count: positiveCategories.length, top3Share } : null,
    recap.purchaseCount > 0 ? { id: 'calendar', lead: leads.calendar, days, spendingDays: recap.spendingDays, elapsedDays, peak } : null,
    showWeekdays ? { id: 'weekdays', lead: leads.weekdays, totals: weekdayTotals, busiest: busiestWeekday, weekendShare } : null,
    showStreak ? { id: 'streak', lead: leads.streak, days: elapsed, quiet, busy } : null,
    receiptItems.length ? { id: 'receipts', items: receiptItems, largestShare, topShare, purchaseCount: recap.purchaseCount } : null,
    recap.purchaseCount > 1 ? { id: 'habits', lead: leads.habits, purchaseCount: recap.purchaseCount, median: profile?.medianAmount ?? null, average, perDay, spendingDays: recap.spendingDays, repeat: facts.repeat && repeatRow ? { ...facts.repeat, fullLabel: repeatRow.description, total: repeatRow.totalAmount } : null } : null,
  ];
  // Shuffle the middle chapters for a run, keeping the calendar ahead of the chapters built from it.
  const order = middle.filter(chapter => chapter !== null);
  if (run !== 0) {
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const calendarAt = order.findIndex(chapter => chapter.id === 'calendar');
    const firstDerived = order.findIndex(chapter => chapter.id === 'weekdays' || chapter.id === 'streak');
    if (calendarAt > firstDerived && firstDerived >= 0) [order[calendarAt], order[firstDerived]] = [order[firstDerived], order[calendarAt]];
  }

  const chapters: ChapterData[] = [
    { id: 'intro', dateRange: periodDateRange(recap.period), isPartial: recap.isPartial, elapsedDays, totalDays, monthWord: recap.period.name.split(' ')[0] },
    { id: 'overview', lead: leads.overview, income: recap.income, expenses: recap.expenses, net: recap.net, keptShare, spentPer100 },
    ...(budget ? [{ id: 'budget' as const, planned: budget.planned, spent: budget.spent, remaining: budget.remaining, percentUsed: budget.percentUsed,
      elapsedShare: facts.elapsedShare, over: budget.overBudgetCategories.map(row => ({ name: row.name, over: row.over })), unbudgeted: budget.unbudgetedExpenses }] : []),
    ...order,
    ...(averageChange !== null ? [{ id: 'comparison' as const, mode: 'average' as const, now: Math.round(average!), before: Math.round(priorAverage!), change: averageChange,
      beforeLabel: baseline!.periodCount === 1 ? 'Previous period' : `Avg of ${baseline!.periodCount} periods`, matchedElapsed: Boolean(baseline?.matchedElapsed) }]
      : recap.comparison ? [{ id: 'comparison' as const, mode: 'total' as const, now: recap.expenses, before: recap.comparison.previousExpenses, change: Math.round(recap.comparison.changePercent),
        beforeLabel: shortDisplayLabel(recap.comparison.periodName, 24), matchedElapsed: false }] : []),
    { id: 'closing', tiles: closingTiles },
  ];
  const palette = palettes[(seed + run) % palettes.length];
  return chapters.map((chapter, i) => ({
    ...chapter, ...copyFor(chapter.id, 'lead' in chapter ? chapter.lead : undefined), theme: palette[i % palette.length],
  }) as RecapStory);
}
