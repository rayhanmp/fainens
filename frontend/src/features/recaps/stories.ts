import type { PeriodRecap, SavedRecapStory } from './queries';
import { recapDisplayCopy, shortDisplayLabel } from './display-copy';
import { pickFrom, seeded } from './motion';
import { chapterCopy, type CopyFacts } from './variations';
import { formatRecapCurrency } from './currency';

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
/** A guess-first question shown before a chapter reveals its answer. */
export type Quiz = { question: string; options: Array<{ label: string; correct: boolean }>; answer: string };
/** A mini-game a chapter plays before its reveal. A run deals a few, never the same kind twice. */
export type Play =
  | { kind: 'quiz'; quiz: Quiz }
  | { kind: 'slider'; question: string; answer: number; label: string }
  | { kind: 'reels'; prompt: string; symbols: Array<{ categoryId: number | null; name: string; label: string }>; winner: string }
  | { kind: 'hold'; prompt: string }
  | { kind: 'gift'; prompt: string }
  | { kind: 'piggy'; prompt: string };
export type InterludeVariant = 'marquee' | 'orbit' | 'tunnel' | 'liquid' | 'rain' | 'kaleido';
export type PersonaKey = 'weekend' | 'bigTicket' | 'steady' | 'monk' | 'loyal' | 'devotee' | 'explorer' | 'allRounder';
export type Persona = { key: PersonaKey; name: string; tagline: string; evidence: string[]; dash: string | null };
export type MixtapeTrack = { title: string; artist: string; length: string; share: number };

type Copy = { eyebrow: string; title: string; body: string };
// Every chapter can carry a mini-game, a fun comparison line, a question to hand to Fainens Agent,
// and its own autoplay length.
type Extras = { play?: Play; equivalence?: string; ask: string; duration?: number };
export type RecapStory = Copy & Extras & { theme: RecapTheme } & (
  | { id: 'intro'; dateRange: string; isPartial: boolean; elapsedDays: number; totalDays: number; monthWord: string }
  | { id: 'overview'; lead: 'left' | 'ratio'; income: number; expenses: number; net: number; keptShare: number | null; spentPer100: number | null; reveal: 'scratch' | 'piggy' | 'none' }
  | { id: 'interlude'; variant: InterludeVariant; words: string[]; orbit: CategoryShare[]; value: number; share: number | null; slot: number }
  | { id: 'budget'; planned: number; spent: number; remaining: number; percentUsed: number | null; elapsedShare: number | null; over: Array<{ name: string; over: number }>; unbudgeted: number }
  | { id: 'categories'; lead: 'top' | 'top3' | 'count'; total: number; rows: CategoryShare[]; others: { count: number; amount: number; share: number } | null; count: number; top3Share: number }
  | { id: 'calendar'; lead: 'days' | 'peak'; days: RecapDayCell[] | null; spendingDays: number; elapsedDays: number; peak: { date: number; amount: number; purchaseCount: number } | null }
  | { id: 'weekdays'; lead: 'weekday' | 'weekend'; totals: number[]; busiest: number; weekendShare: number }
  | { id: 'streak'; lead: 'quiet' | 'busy'; days: RecapDayCell[]; quiet: Streak; busy: Streak }
  | { id: 'receipts'; items: ReceiptItem[]; largestShare: number | null; topShare: number | null; purchaseCount: number }
  | { id: 'habits'; lead: 'count' | 'typical' | 'perDay'; purchaseCount: number; median: number | null; average: number | null; perDay: number; spendingDays: number; repeat: { label: string; fullLabel: string; occurrences: number; total: number } | null }
  | { id: 'comparison'; mode: 'average' | 'total'; now: number; before: number; change: number; beforeLabel: string; matchedElapsed: boolean }
  | { id: 'months'; months: Array<{ label: string; amount: number }>; busiest: number }
  | { id: 'mixtape'; tracks: MixtapeTrack[]; tapeName: string }
  | { id: 'persona'; persona: Persona }
  | { id: 'closing'; tiles: ClosingTile[]; persona: Persona }
);
export type RecapStoryId = RecapStory['id'];
type ChapterData = RecapStory extends infer Story ? Story extends RecapStory ? Omit<Story, 'theme' | keyof Copy | keyof Extras> : never : never;

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

  // A year in review is too long for a day grid: its calendar becomes months, and streaks stay out.
  const longView = totalDays > 62;
  const monthTotals = new Map<string, { label: string; name: string; amount: number }>();
  for (const day of elapsed) {
    const key = recapDayKey(day.date).slice(0, 7);
    const month = monthTotals.get(key) ?? { label: formatRecapDay(day.date, { month: 'short' }), name: formatRecapDay(day.date, { month: 'long' }), amount: 0 };
    month.amount += day.amount;
    monthTotals.set(key, month);
  }
  const months = [...monthTotals.values()];
  const busiestMonth = months.reduce((best, month, i) => month.amount > months[best].amount ? i : best, 0);

  // Bonus chapters appear in some runs; when one is left out its fact can lead another chapter instead.
  const hasWeek = elapsed.length >= 7 && recap.spendingDays >= 4 && weekTotal > 0;
  const showWeekdays = hasWeek && chance(.65);
  const showStreak = !longView && elapsed.length >= 7 && Boolean((quiet && quiet.length >= 2) || (busy && busy.length >= 3)) && chance(.6);
  const showMixtape = positiveCategories.length >= 3 && chance(.5);
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
    busiestMonth: longView && months.length > 1 ? months[busiestMonth].name : null,
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

  const persona = pickPersona(facts, random);
  // The mixtape runs to a 30-minute side; each category gets airtime by its share of spending.
  const artists = ['Various receipts', 'The Small Change', 'Cash & Carry', 'DJ Ledger', 'The Debits', 'Petty Cash Quartet'];
  const tracks: MixtapeTrack[] = topRows.slice(0, 4).map(row => {
    const seconds = Math.max(15, Math.round(row.share / 100 * 1800));
    const purchase = receiptItems.find(item => item.category === row.name);
    return { title: row.label, artist: purchase ? `feat. ${purchase.label}` : pickFrom(artists, random), length: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, share: row.share };
  });

  const closingTiles: ClosingTile[] = [
    { label: recap.net >= 0 ? 'Left over' : 'Shortfall', value: '', money: Math.abs(recap.net), note: keptShare !== null ? `${keptShare}% of income` : undefined },
    ...(top ? [{ label: 'Top category', value: top.label, note: `${top.share}% of spending` }] : []),
    ...(peak ? [{ label: 'Busiest day', value: dayLabel(peak.date), note: `${peak.purchaseCount} ${peak.purchaseCount === 1 ? 'purchase' : 'purchases'}` }] : []),
    ...(showStreak && quiet && quiet.length >= 2 ? [{ label: 'Quiet streak', value: `${quiet.length} days`, note: 'without spending' }]
      : [{ label: 'Purchases', value: String(recap.purchaseCount), note: `over ${recap.spendingDays} ${recap.spendingDays === 1 ? 'day' : 'days'}` }]),
  ];

  const middle: Array<ChapterData | null> = [
    top ? { id: 'categories', lead: leads.categories, total: categoryTotal, rows: topRows, others: rest.length ? { count: rest.length, amount: restAmount, share: share(restAmount) } : null, count: positiveCategories.length, top3Share } : null,
    recap.purchaseCount > 0 && !longView ? { id: 'calendar', lead: leads.calendar, days, spendingDays: recap.spendingDays, elapsedDays, peak } : null,
    longView && months.length > 1 ? { id: 'months', months, busiest: busiestMonth } : null,
    showMixtape ? { id: 'mixtape', tracks, tapeName: `${recap.period.name} mixtape` } : null,
    showWeekdays ? { id: 'weekdays', lead: leads.weekdays, totals: weekdayTotals, busiest: busiestWeekday, weekendShare } : null,
    showStreak ? { id: 'streak', lead: leads.streak, days: elapsed, quiet, busy } : null,
    receiptItems.length ? { id: 'receipts', items: receiptItems, largestShare, topShare, purchaseCount: recap.purchaseCount } : null,
    recap.purchaseCount > 1 ? { id: 'habits', lead: leads.habits, purchaseCount: recap.purchaseCount, median: profile?.medianAmount ?? null, average, perDay, spendingDays: recap.spendingDays, repeat: facts.repeat && repeatRow ? { ...facts.repeat, fullLabel: repeatRow.description, total: repeatRow.totalAmount } : null } : null,
  ];
  const shuffled = <T,>(items: T[]) => items.map(item => ({ item, sort: random() })).sort((a, b) => a.sort - b.sort).map(entry => entry.item);
  const others = <T,>(items: T[], exclude: T, count: number) => shuffled(items.filter(item => item !== exclude)).slice(0, count);

  // Shuffle the middle chapters for a run, keeping the calendar ahead of the chapters built from it.
  // Now and then a regular chapter sits a run out, so no two viewings have the same lineup.
  const order: ChapterData[] = middle.filter(chapter => chapter !== null)
    .filter(chapter => run === 0 || (chapter.id !== 'receipts' && chapter.id !== 'habits') || random() >= .2);
  if (run !== 0) {
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const calendarAt = order.findIndex(chapter => chapter.id === 'calendar');
    const firstDerived = order.findIndex(chapter => chapter.id === 'weekdays' || chapter.id === 'streak');
    if (calendarAt > firstDerived && firstDerived >= 0) [order[calendarAt], order[firstDerived]] = [order[firstDerived], order[calendarAt]];
    // Motion interludes: one or two showpieces dropped between chapters, never side by side.
    const marqueeWords = [recap.period.name, top?.label, `${recap.purchaseCount} receipts`, peak ? dayLabel(peak.date) : null, persona.name.replace(/^The /, '')].filter((word): word is string => Boolean(word));
    const available: InterludeVariant[] = ['marquee', 'kaleido', ...(topRows.length >= 3 ? ['orbit' as const] : []), ...(recap.purchaseCount > 0 ? ['tunnel' as const] : []),
      ...(keptShare !== null || budget?.percentUsed != null ? ['liquid' as const] : []), ...(recap.purchaseCount >= 3 ? ['rain' as const] : [])];
    const picks = shuffled(available).slice(0, random() < .45 ? 2 : 1);
    const slots = shuffled(Array.from({ length: Math.max(1, order.length - 1) }, (_, i) => i + 1)).slice(0, picks.length).sort((a, b) => b - a);
    picks.forEach((variant, i) => {
      if (i > 0 && Math.abs(slots[i] - slots[i - 1]) < 2) return;
      order.splice(slots[i], 0, { id: 'interlude', variant, words: marqueeWords, orbit: topRows, value: recap.purchaseCount,
        share: keptShare ?? budget?.percentUsed ?? null, slot: i });
    });
  }

  const chapters: ChapterData[] = [
    { id: 'intro', dateRange: periodDateRange(recap.period), isPartial: recap.isPartial, elapsedDays, totalDays, monthWord: recap.period.name.split(' ')[0] },
    { id: 'overview', lead: leads.overview, income: recap.income, expenses: recap.expenses, net: recap.net, keptShare, spentPer100, reveal: leads.overview === 'left' && recap.net > 0 ? 'scratch' : 'none' },
    ...(budget ? [{ id: 'budget' as const, planned: budget.planned, spent: budget.spent, remaining: budget.remaining, percentUsed: budget.percentUsed,
      elapsedShare: facts.elapsedShare, over: budget.overBudgetCategories.map(row => ({ name: row.name, over: row.over })), unbudgeted: budget.unbudgetedExpenses }] : []),
    ...order,
    ...(averageChange !== null ? [{ id: 'comparison' as const, mode: 'average' as const, now: Math.round(average!), before: Math.round(priorAverage!), change: averageChange,
      beforeLabel: baseline!.periodCount === 1 ? 'Previous period' : `Avg of ${baseline!.periodCount} periods`, matchedElapsed: Boolean(baseline?.matchedElapsed) }]
      : recap.comparison ? [{ id: 'comparison' as const, mode: 'total' as const, now: recap.expenses, before: recap.comparison.previousExpenses, change: Math.round(recap.comparison.changePercent),
        beforeLabel: shortDisplayLabel(recap.comparison.periodName, 24), matchedElapsed: false }] : []),
    ...(recap.purchaseCount > 2 ? [{ id: 'persona' as const, persona }] : []),
    { id: 'closing', tiles: closingTiles, persona },
  ];

  // Mini-games: every eligible (chapter, game) pair goes in a hat, and a run deals two or three of
  // them with no chapter and no kind of game twice, so the quiz is one game among several.
  const present = new Set(chapters.map(chapter => chapter.id));
  const spendingDayLabels = elapsed.filter(day => day.amount > 0 && !day.peak).map(day => dayLabel(day.date));
  const quiz = (question: string, answer: string, options: string[]): Play => ({ kind: 'quiz', quiz: { question, answer, options: shuffled(options).map(label => ({ label, correct: label === answer })) } });
  const candidates: Array<{ id: RecapStoryId; play: Play }> = [];
  if (run !== 0) {
    if (top && topRows.length >= 3) {
      candidates.push({ id: 'categories', play: quiz('Which category took the biggest slice?', top.label, [top.label, ...others(topRows.slice(1).map(row => row.label), top.label, 2)]) });
      candidates.push({ id: 'categories', play: { kind: 'slider', question: `What share of spending went to ${top.label}?`, answer: top.share, label: top.label } });
      candidates.push({ id: 'categories', play: { kind: 'reels', prompt: 'Pull the lever. Three of a kind wins.', symbols: topRows.map(row => ({ categoryId: row.categoryId, name: row.name, label: row.label })), winner: top.name } });
    }
    if (peak && !longView) {
      if (spendingDayLabels.length >= 2) candidates.push({ id: 'calendar', play: quiz('Which day had the most spending?', dayLabel(peak.date), [dayLabel(peak.date), ...others(spendingDayLabels, dayLabel(peak.date), 2)]) });
      candidates.push({ id: 'calendar', play: { kind: 'hold', prompt: 'Hold to reveal your busiest day' } });
    }
    if (receiptItems.length >= 3) candidates.push({ id: 'receipts', play: quiz('Which was your biggest purchase?', receiptItems[0].label, receiptItems.map(item => item.label)) });
    if (receiptItems.length) candidates.push({ id: 'receipts', play: { kind: 'gift', prompt: 'Tap to unwrap your biggest receipts' } });
    if (recap.purchaseCount >= 5) {
      const truth = recap.purchaseCount;
      const decoys = [...new Set([Math.round(truth * 1.45), Math.max(1, Math.round(truth * .6)), truth + 7].filter(value => value !== truth))].slice(0, 2);
      candidates.push({ id: 'habits', play: quiz('How many purchases this period?', String(truth), [truth, ...decoys].map(String)) });
    }
    if (hasWeek) {
      candidates.push({ id: 'weekdays', play: quiz('Which day of the week spent the most?', WEEKDAYS[busiestWeekday], [WEEKDAYS[busiestWeekday], ...others(WEEKDAYS, WEEKDAYS[busiestWeekday], 2)]) });
      candidates.push({ id: 'weekdays', play: { kind: 'slider', question: 'What share of spending landed on weekends?', answer: weekendShare, label: 'weekends' } });
    }
    if (averageChange !== null && averageChange !== 0) { const answer = averageChange > 0 ? 'Higher' : 'Lower'; candidates.push({ id: 'comparison', play: quiz('Was the average receipt higher or lower than before?', answer, ['Higher', 'Lower']) }); }
    if (leads.overview === 'left' && recap.net > 0) candidates.push({ id: 'overview', play: { kind: 'piggy', prompt: 'Tap the piggy bank to crack it open' } });
  }
  const dealt = new Map<RecapStoryId, Play>();
  const kindsUsed = new Set<Play['kind']>();
  const hand = 2 + (random() < .5 ? 1 : 0);
  for (const candidate of shuffled(candidates)) {
    if (dealt.size >= hand) break;
    if (!present.has(candidate.id) || dealt.has(candidate.id) || kindsUsed.has(candidate.play.kind)) continue;
    dealt.set(candidate.id, candidate.play);
    kindsUsed.add(candidate.play.kind);
  }

  // Playful equivalences, computed only from the figures on the card.
  const typical = profile?.medianAmount ?? null;
  const equivalences: Partial<Record<RecapStoryId, string>> = {
    overview: recap.net > 0 && perDay > 0 ? `Left over ≈ ${Math.round(recap.net / perDay)} days of spending at this pace.` : undefined,
    categories: top && typical ? `${top.label} ≈ ${Math.round(top.amount / typical)} typical receipts.` : undefined,
    habits: recap.spendingDays > 0 ? `That’s about ${formatRecapCurrency(Math.round(Math.max(0, recap.expenses) / recap.spendingDays))} per spending day.` : undefined,
  };
  const period = recap.period.name;
  const asks: Partial<Record<RecapStoryId, string>> = {
    overview: `How did my income and expenses compare in ${period}?`,
    budget: `How did my budget for ${period} go, category by category?`,
    categories: top ? `What did I spend on ${top.name} in ${period}?` : undefined,
    calendar: peak ? `What did I spend on ${formatRecapDay(peak.date, { weekday: 'long', day: 'numeric', month: 'long' })}?` : undefined,
    weekdays: `Which days of the week do I usually spend the most on?`,
    receipts: receiptItems[0] ? `Tell me about my biggest purchases in ${period}.` : undefined,
    habits: `What were my most frequent purchases in ${period}?`,
    comparison: `How does ${period} compare with my previous periods?`,
    persona: `What do my spending patterns in ${period} say about my habits?`,
  };

  const palette = palettes[(seed + run) % palettes.length];
  return chapters.map((chapter, i) => {
    const copy = copyFor(chapter.id, 'lead' in chapter ? chapter.lead : chapter.id === 'interlude' ? chapter.variant : undefined);
    const equivalence = equivalences[chapter.id];
    const play = dealt.get(chapter.id);
    return {
      ...chapter, ...copy, theme: palette[i % palette.length],
      // The piggy bank replaces the scratch card when it is dealt.
      ...(chapter.id === 'overview' && play?.kind === 'piggy' ? { reveal: 'piggy' } : {}),
      // Some runs swap the closing line for a playful equivalence.
      body: equivalence && run !== 0 && random() < .55 ? equivalence : copy.body,
      play, equivalence,
      // Interludes are showpieces: they move on sooner.
      duration: chapter.id === 'interlude' ? 6_500 : undefined,
      ask: asks[chapter.id] ?? `Tell me more about this from my ${period} recap: ${copy.title}`,
    } as RecapStory;
  });
}

/** The period's money personality: the pattern that stands out most, with a dash of the runner-up. */
function pickPersona(f: CopyFacts, random: () => number): Persona {
  const ratio = f.elapsedDays > 0 ? f.spendingDays / f.elapsedDays : 0;
  const spread = f.average !== null && f.median ? f.average / f.median : 1;
  const candidates: Array<Omit<Persona, 'dash'> & { score: number }> = [
    { key: 'weekend', score: f.busiestWeekday && f.weekendShare >= 40 ? f.weekendShare - 22 : 0, name: 'The Weekend Warrior', tagline: 'Saturdays and Sundays carried the receipts.',
      evidence: [`${f.weekendShare}% of spending on weekends`, ...(f.busiestWeekday ? [`${f.busiestWeekday}s led the week`] : [])] },
    { key: 'bigTicket', score: spread >= 2.4 ? (spread - 1) * 14 : 0, name: 'The Big-Ticket Hunter', tagline: 'A few big receipts, a lot of small ones.',
      evidence: [`Average receipt ${formatRecapCurrency(Math.round(f.average ?? 0))}`, `Typical receipt ${formatRecapCurrency(f.median ?? 0)}`, ...(f.largestShare !== null ? [`Largest: ${f.largestShare}% of purchase spend`] : [])] },
    { key: 'steady', score: ratio >= .55 ? ratio * 60 : 0, name: 'The Steady Sipper', tagline: 'Little and often: something went out most days.',
      evidence: [`${f.spendingDays} of ${f.elapsedDays} days with spending`, ...(f.median ? [`Typical receipt ${formatRecapCurrency(f.median)}`] : [])] },
    { key: 'monk', score: f.quiet >= 4 ? f.quiet * 7 : ratio <= .35 ? (1 - ratio) * 45 : 0, name: 'The Quiet Monk', tagline: 'Long stretches with nothing going out.',
      evidence: [...(f.quiet >= 2 ? [`${f.quiet} days in a row without spending`] : []), `${f.spendingDays} spending days in ${f.elapsedDays}`] },
    { key: 'loyal', score: f.repeat && f.repeat.occurrences >= 4 ? f.repeat.occurrences * 7 : 0, name: 'The Loyal Regular', tagline: `${f.repeat?.label ?? 'One favourite'} kept coming back.`,
      evidence: f.repeat ? [`${f.repeat.label} ×${f.repeat.occurrences}`] : [] },
    { key: 'devotee', score: f.top && f.top.share >= 40 ? f.top.share - 12 : 0, name: 'The Category Devotee', tagline: `${f.top?.label ?? 'One category'} took the lion’s share.`,
      evidence: f.top ? [`${f.top.share}% of spending on ${f.top.label}`] : [] },
    { key: 'explorer', score: f.categoryCount >= 9 ? f.categoryCount * 3 : 0, name: 'The Explorer', tagline: 'Spending wandered into a little bit of everything.',
      evidence: [`${f.categoryCount} categories with spending`, ...(f.top ? [`${f.top.label} led with ${f.top.share}%`] : [])] },
    { key: 'allRounder', score: 12, name: 'The All-Rounder', tagline: 'No single habit ran the show.',
      evidence: [`${f.purchaseCount} purchases`, `${f.categoryCount} categories`] },
  ];
  // Near-ties are broken by the run's dice, so a balanced period can wear a different hat on replay.
  const ranked = candidates.map(candidate => ({ ...candidate, score: candidate.score + random() * 4 })).sort((a, b) => b.score - a.score);
  const [first, second] = ranked;
  return { key: first.key, name: first.name, tagline: first.tagline, evidence: first.evidence.slice(0, 3),
    dash: second && second.key !== 'allRounder' && second.score > 20 ? second.name.replace(/^The /, '') : null };
}
