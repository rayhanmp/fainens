import type { PeriodRecap, SavedRecapStory } from './queries';
import type { YearRecap } from './year';
import { recapDisplayCopy, shortDisplayLabel } from './display-copy';
import { pickFrom, runVariants, seeded } from './motion';
import { bonusCopy, chapterCopy, chapterEyebrows, yearCopy, type CopyFacts } from './variations';
import { categoryFlavour, type Flavour } from './flavour';
import { formatRecapCurrency } from './currency';
import { DAY_MS, formatRecapDay, periodDateRange, recapDay, recapDayKey, recapWeekday } from './dates';

export { formatRecapDay, periodDateRange, recapDay, recapDayKey, recapWeekday } from './dates';
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export type RecapTheme = 'lime' | 'ink' | 'lilac' | 'peach' | 'cream' | 'sky' | 'rose' | 'mint' | 'butter' | 'tangerine' | 'coral'
  | 'acid' | 'plum' | 'navy' | 'cocoa' | 'noir' | 'electric';
// The same paper and ink pairs as the story themes in recaps.css, for drawing outside CSS.
export const themeColors: Record<RecapTheme, { paper: string; ink: string }> = {
  lime: { paper: '#d5f478', ink: '#183529' }, ink: { paper: '#1f3a31', ink: '#e2f5bd' }, lilac: { paper: '#d8cff7', ink: '#2d2348' },
  peach: { paper: '#ffd2b7', ink: '#5e3021' }, cream: { paper: '#eee9dd', ink: '#2f3a30' },
  sky: { paper: '#bfe3ff', ink: '#0f2e4d' }, rose: { paper: '#ffc9d6', ink: '#5a1730' }, mint: { paper: '#bff0d9', ink: '#0f3d2c' },
  butter: { paper: '#fbe7a1', ink: '#4a3510' }, tangerine: { paper: '#ffb37a', ink: '#4a1f05' }, coral: { paper: '#ff8f7a', ink: '#3d0d05' },
  acid: { paper: '#e6ff3d', ink: '#1a1a1a' }, plum: { paper: '#3a1f4d', ink: '#f2d9ff' }, navy: { paper: '#14223d', ink: '#cfe3ff' },
  cocoa: { paper: '#3b2a22', ink: '#ffe2c7' }, noir: { paper: '#121212', ink: '#f5f5f0' }, electric: { paper: '#2d1fd8', ink: '#f3f1ff' },
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
  | { kind: 'piggy'; prompt: string }
  // The games below live in a lazily loaded group (extra/GamesExtra).
  | { kind: 'higherLower'; anchor: { label: string; amount: number }; challenger: { label: string; amount: number }; answer: 'Higher' | 'Lower' }
  | { kind: 'memory'; cards: Array<{ name: string; label: string }> }
  | { kind: 'wheel'; slices: Array<{ name: string; label: string; share: number }>; winner: string }
  | { kind: 'truefalse'; statement: string; answer: boolean; reveal: string };
export const EXTRA_GAMES = new Set<Play['kind']>(['higherLower', 'memory', 'wheel', 'truefalse']);
export type InterludeVariant = 'marquee' | 'orbit' | 'tunnel' | 'liquid' | 'rain' | 'kaleido' | 'ejected';
/** How the ejection reads each verdict; `{x}` is the category and `{n}` the suspects still standing. */
export type EjectVerdicts = { innocent: string; guilty: string; remain: string };
const EJECT_VERDICTS: EjectVerdicts[] = [
  { innocent: '{x} was not The Big Spender.', guilty: '{x} was The Big Spender.', remain: 'Suspects left: {n}' },
  { innocent: '{x} was not the impostor.', guilty: '{x} was the impostor.', remain: 'On the ship: {n}' },
  { innocent: '{x} was ejected. Innocent.', guilty: '{x} was ejected. Guilty.', remain: 'Crew left: {n}' },
  { innocent: '{x} has been voted out. Not it.', guilty: '{x} has been voted out. Busted.', remain: 'Still on board: {n}' },
  { innocent: 'Not {x}. Keep looking.', guilty: 'It was {x} all along.', remain: 'Left to question: {n}' },
  { innocent: '{x}: innocent.', guilty: '{x}: caught red-handed.', remain: 'In the lineup: {n}' },
  { innocent: '{x} had an alibi.', guilty: '{x} had no alibi.', remain: 'Alibis to check: {n}' },
];
/** What the finale prints, whichever form it takes: receipt, credits, certificate or high scores. */
export type FinaleFacts = {
  period: string; dateLabel: string; income: number; expenses: number; net: number; keptShare: number | null;
  categories: Array<{ label: string; share: number }>; peakLabel: string | null; purchaseCount: number; spendingDays: number; passenger: string;
};
/** What the cover prints: the issue, the dates, and teasers for this run's chapters. */
export type CoverFacts = {
  issue: number; year: string; startLabel: string; endLabel: string; teasers: string[]; chapterCount: number;
  purchaseCount: number; keptShare: number | null; passenger: string; seat: string;
};
export type PersonaKey = 'weekend' | 'bigTicket' | 'steady' | 'monk' | 'loyal' | 'devotee' | 'explorer' | 'allRounder';
export type Persona = {
  key: PersonaKey; name: string; tagline: string; evidence: string[]; dash: string | null;
  /** The number the persona's scene is built around, with how to print it. */
  figure: number; figureLabel: string; figurePrefix?: string; figureSuffix?: string;
};
/** Each persona dresses its chapter in its own colours, whatever the run's palette. */
export const PERSONA_THEMES: Record<PersonaKey, RecapTheme> = {
  weekend: 'plum', bigTicket: 'noir', steady: 'cocoa', monk: 'mint', loyal: 'rose', devotee: 'electric', explorer: 'sky', allRounder: 'butter',
};
export type MixtapeTrack = { title: string; artist: string; length: string; share: number };
/**
 * Bonus slides are earned, not dealt: each appears only when the period's figures meet its trigger.
 * When several qualify, the two furthest past their thresholds make the cut.
 */
export type Bonus =
  | { kind: 'payday'; days: Array<{ amount: number; rush: boolean }>; share: number; amount: number }
  | { kind: 'boss'; label: string; fullLabel: string; amount: number; share: number; date: number; category: string }
  | { kind: 'suspects'; items: Array<{ label: string; fullLabel: string; occurrences: number; total: number }> }
  | { kind: 'milestone'; count: number; date: number; dayIndex: number; totalDays: number }
  | { kind: 'takeover'; categoryId: number | null; name: string; label: string; share: number }
  | { kind: 'comeback'; categoryId: number | null; name: string; label: string; rank: number; share: number; previousRank: number | null; previousPeriod: string };
export type BonusKind = Bonus['kind'];

/** Insights only a year can show, read from its periods' own recaps rather than the year's sums. */
export type YearMonth = { label: string; name: string };
export type YearInsight =
  // Each period's top category, in order: who headlined which month.
  | { kind: 'headliners'; months: Array<YearMonth & { category: string | null; categoryLabel: string | null; share: number }>; leader: { name: string; label: string; count: number; tied: boolean }; distinct: number }
  // Income against expenses, period by period, and how many kept something back.
  | { kind: 'green'; months: Array<YearMonth & { income: number; expenses: number; kept: number | null }>; green: number; best: (YearMonth & { kept: number }) | null }
  // The money personality each period earned.
  | { kind: 'personas'; months: Array<YearMonth & { key: PersonaKey; persona: string }>; leader: { key: PersonaKey; name: string; count: number; tied: boolean }; distinct: number }
  // Categories that showed up in every period, and ones that appeared in just one.
  | { kind: 'regulars'; regulars: Array<{ name: string; label: string }>; cameos: Array<{ name: string; label: string; month: string }>; regularCount: number; cameoCount: number; periods: number };
export type YearInsightKind = YearInsight['kind'];
const MILESTONES = [50, 100, 150, 200, 250, 300, 400, 500, 750, 1000];

type Copy = { eyebrow: string; title: string; body: string; flavour?: Flavour };
// Every chapter can carry a mini-game, a fun comparison line, a question to hand to Fainens Agent,
// and its own autoplay length.
/** A pixel-game toast a chapter can unlock when it arrives. */
export type Achievement = { title: string; detail: string };
type Extras = { play?: Play; flavour?: Flavour; equivalence?: string; ask: string; duration?: number; achievement?: Achievement };
export type RecapStory = Copy & Extras & { theme: RecapTheme } & (
  | { id: 'intro'; dateRange: string; isPartial: boolean; elapsedDays: number; totalDays: number; monthWord: string; cover: CoverFacts }
  | { id: 'overview'; lead: 'left' | 'ratio'; income: number; expenses: number; net: number; keptShare: number | null; spentPer100: number | null; reveal: 'scratch' | 'piggy' | 'none' }
  | { id: 'interlude'; variant: InterludeVariant; words: string[]; orbit: CategoryShare[]; value: number; share: number | null; slot: number; verdicts: EjectVerdicts }
  | { id: 'budget'; planned: number; spent: number; remaining: number; percentUsed: number | null; elapsedShare: number | null; over: Array<{ name: string; over: number }>; unbudgeted: number }
  | { id: 'categories'; lead: 'top' | 'top3' | 'count'; total: number; rows: CategoryShare[]; others: { count: number; amount: number; share: number } | null; count: number; top3Share: number }
  | { id: 'calendar'; lead: 'days' | 'peak'; days: RecapDayCell[] | null; spendingDays: number; elapsedDays: number; peak: { date: number; amount: number; purchaseCount: number } | null;
    /** Some runs fold the weekday chapter into the calendar as a strip under the grid. */
    week?: { totals: number[]; busiest: number; weekendShare: number } }
  | { id: 'weekdays'; lead: 'weekday' | 'weekend'; totals: number[]; busiest: number; weekendShare: number }
  | { id: 'streak'; lead: 'quiet' | 'busy'; days: RecapDayCell[]; quiet: Streak; busy: Streak }
  | { id: 'receipts'; items: ReceiptItem[]; largestShare: number | null; topShare: number | null; purchaseCount: number }
  | { id: 'habits'; lead: 'count' | 'typical' | 'perDay'; purchaseCount: number; median: number | null; average: number | null; perDay: number; spendingDays: number; repeat: { label: string; fullLabel: string; occurrences: number; total: number } | null }
  | { id: 'comparison'; mode: 'average' | 'total'; now: number; before: number; change: number; beforeLabel: string; matchedElapsed: boolean }
  | { id: 'months'; months: Array<{ label: string; amount: number }>; busiest: number }
  | { id: 'mixtape'; tracks: MixtapeTrack[]; tapeName: string }
  | { id: 'persona'; persona: Persona; early?: boolean }
  | { id: 'bonus'; bonus: Bonus }
  | { id: 'year'; insight: YearInsight }
  | { id: 'closing'; tiles: ClosingTile[]; persona: Persona; finale: FinaleFacts }
);
export type RecapStoryId = RecapStory['id'];
type ChapterData = RecapStory extends infer Story ? Story extends RecapStory ? Omit<Story, 'theme' | keyof Copy | keyof Extras> : never : never;

// Older editions saved app-written transfer fees as a "recurring purchase"; they are not habits.
const isSystemDescription = (description: string) => /^transfer fee:/i.test(description.trim());

/** Palette families: a run picks one and deals its colours out, so each viewing has its own mood. */
export const PALETTE_FAMILIES: Record<string, RecapTheme[]> = {
  original: ['lime', 'ink', 'lilac', 'cream', 'peach'],
  sunset: ['tangerine', 'plum', 'rose', 'butter', 'cocoa', 'coral'],
  ocean: ['sky', 'navy', 'mint', 'cream', 'electric'],
  candy: ['rose', 'lilac', 'butter', 'mint', 'plum', 'sky'],
  midnight: ['noir', 'navy', 'plum', 'cocoa', 'electric', 'ink'],
  neon: ['acid', 'noir', 'electric', 'coral', 'ink'],
  earth: ['cocoa', 'butter', 'mint', 'cream', 'ink', 'tangerine'],
};

const roman = (value: number) => {
  let n = Math.max(1, Math.min(3999, Math.round(value))); let out = '';
  for (const [v, s] of [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']] as const) while (n >= v) { out += s; n -= v; }
  return out;
};

/** The opening crawl: an episode number, a title and a few paragraphs written from the period's figures. */
export function crawlText(recap: PeriodRecap, run: number) {
  const random = seeded(run + 307);
  const top = recap.categories.find(row => row.amount > 0);
  const total = recap.categories.filter(row => row.amount > 0).reduce((sum, row) => sum + row.amount, 0);
  const share = top && total > 0 ? Math.round(top.amount / total * 100) : null;
  const peak = recap.highlights?.peakSpendingDay;
  const titles = ['The receipts awaken', 'A new budget', 'The spending strikes back', 'Return of the salary', 'Revenge of the receipts', 'The last payday',
    'Attack of the receipts', 'The phantom budget', 'Rogue receipt', 'A new hope', 'A ledger of the galaxy', 'Rise of the budget', 'The force of habit', 'The empire of expenses'];
  const money = formatRecapCurrency;
  const pick = (lines: string[]) => lines[Math.floor(random() * lines.length)];
  const income = money(recap.income);
  const expenses = money(Math.max(0, recap.expenses));
  const next = /^\d{4}$/.test(recap.period.name) ? 'year' : 'period';
  const paragraphs = [
    recap.net >= 0 ? pick([
      `It is a period of surplus. ${income} came in, and only ${expenses} went out.`,
      `Peace holds across the ledger. ${income} arrived; ${expenses} escaped.`,
      `The treasury stands strong. ${income} in, ${expenses} out, and the difference kept safe.`,
    ]) : pick([
      `It is a period of unrest. ${expenses} went out against ${income} coming in.`,
      `Turmoil grips the ledger. ${expenses} has fled, outrunning the ${income} that arrived.`,
      `The treasury is under siege. Expenses of ${expenses} broke past ${income} of income.`,
    ]),
    top && share !== null ? pick([
      `But ${top.name} has seized ${share}% of the galaxy’s spending, and its grip only tightens.`,
      `Meanwhile, the mighty ${top.name} commands ${share}% of every coin that leaves.`,
      `From its distant stronghold, ${top.name} has claimed ${share}% of all spending.`,
    ]) : 'The categories are restless, each claiming a share of the galaxy.',
    peak ? pick([
      `On ${formatRecapDay(peak.date, { weekday: 'long', day: 'numeric', month: 'long' })}, ${peak.purchaseCount} receipts were filed in a single day.`,
      `Legends still speak of ${formatRecapDay(peak.date, { weekday: 'long', day: 'numeric', month: 'long' })}, when ${peak.purchaseCount} receipts fell in one day.`,
      `The great battle came on ${formatRecapDay(peak.date, { weekday: 'long', day: 'numeric', month: 'long' })}: ${peak.purchaseCount} receipts, one day.`,
    ]) : `${recap.purchaseCount} receipts have been filed across the period.`,
    pick([
      `Now, with ${recap.purchaseCount} receipts behind it, the budget prepares for the next ${next}…`,
      `As ${recap.purchaseCount} receipts settle into the archives, a new ${next} rises on the horizon…`,
      `With ${recap.purchaseCount} receipts recorded, the ledger turns toward the next ${next}…`,
    ]),
  ];
  return { episode: `Episode ${roman(recap.period.id)}`, title: titles[Math.floor(random() * titles.length)], paragraphs };
}

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
export function buildStories(recap: PeriodRecap, edition?: SavedRecapStory, run = 0, previous?: PeriodRecap | null): RecapStory[] {
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

  // A period shows its top three receipts; a year, its top five.
  const purchases = (recap.highlights?.topPurchases ?? []).slice(0, (recap as YearRecap).yearPeriods ? 5 : 3);
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
  // A year's periods, each named for the month it ends in (salary periods run across two months).
  const yearPeriods = (recap as YearRecap).yearPeriods?.filter(period => period.activityCount > 0) ?? [];
  const monthOf = (period: PeriodRecap): YearMonth => ({ label: formatRecapDay(period.period.endDate, { month: 'short' }), name: formatRecapDay(period.period.endDate, { month: 'long' }) });
  // Without daily figures for every period the year's months come from the periods' own totals.
  const months = monthTotals.size > 1 || yearPeriods.length < 2 ? [...monthTotals.values()]
    : yearPeriods.map(period => ({ ...monthOf(period), amount: Math.max(0, period.expenses) }));
  const busiestMonth = months.reduce((best, month, i) => month.amount > months[best].amount ? i : best, 0);
  const yearInsights = yearPeriods.length >= 3 ? readYear(yearPeriods, monthOf) : [];

  // How long this run is: the director's cut shows every optional chapter, a speedrun keeps a short lap.
  const cut = run === 0 ? 'standard' : runVariants(run).cut;
  const optional = (p: number) => cut === 'directors' || (cut === 'standard' && chance(p));
  // Bonus chapters appear in some runs; when one is left out its fact can lead another chapter instead.
  const hasWeek = elapsed.length >= 7 && recap.spendingDays >= 4 && weekTotal > 0;
  const showWeekdays = hasWeek && optional(.65);
  const showStreak = !longView && elapsed.length >= 7 && Boolean((quiet && quiet.length >= 2) || (busy && busy.length >= 3)) && optional(.6);
  const showMixtape = positiveCategories.length >= 3 && optional(.5);
  // Now and then the weekday chapter folds into the calendar, as a strip under the grid.
  const pairWeek = showWeekdays && !longView && Boolean(recap.daily) && chance(.3);
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
    top: top ? { label: top.label, share: top.share, flavour: categoryFlavour(top.name) } : null, top3Share, categoryCount: positiveCategories.length,
    spendingDays: recap.spendingDays, elapsedDays, peak: peak ? { label: dayLabel(peak.date), weekday: WEEKDAYS[recapWeekday(peak.date)], amount: peak.amount, purchaseCount: peak.purchaseCount } : null,
    busiestWeekday: hasWeek ? WEEKDAYS[busiestWeekday] : null, weekendShare,
    quiet: quiet?.length ?? 0, busy: busy?.length ?? 0,
    receipt: receiptItems[0] ? { label: receiptItems[0].label, amount: receiptItems[0].amount, count: receiptItems.length, flavour: categoryFlavour(receiptItems[0].category) } : null, largestShare, topShare,
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
    // Like the generated copy, a saved body is shown only when it carries a figure; the rest
    // ("…side by side. The rest of the story is in the receipts.") only describes the chart.
    const written = compact(source.body).replace(/^\p{Ll}/u, letter => letter.toUpperCase());
    const body = /\d/.test(written) ? written : '';
    const titleFits = title.length <= 56 && !/(?:\b(?:and|with|at|dan|dengan|di)|[,;:]|…|\.\.\.)\s*$/i.test(title);
    if (!titleFits || body.length > 160) return null;
    return { eyebrow: shortDisplayLabel(source.eyebrow, 40), title, body };
  };
  // Flavoured lines talk about this period's own subject (its top category, its busiest day), so when a
  // chapter has some they lead half the time instead of being one voice among many.
  const pickCopy = (pool: Copy[]): Copy => {
    const flavoured = pool.filter(line => line.flavour);
    return flavoured.length && random() < .5 ? pickFrom(flavoured, random) : pickFrom(pool, random);
  };
  const copyFor = (id: RecapStoryId, lead?: string): Copy => {
    const pool = chapterCopy(id, lead, facts);
    const saved = savedCopy(id);
    // Without a run (the share card, first paint) the saved edition's copy leads; otherwise it is one
    // voice among the generated ones.
    if (saved && (run === 0 || random() < .2)) return { ...saved, eyebrow: pool[0]?.eyebrow ?? saved.eyebrow };
    const copy = pool.length ? pickCopy(pool) : saved ?? { eyebrow: '', title: recap.period.name, body: '' };
    // Half the time the eyebrow comes from the chapter's own pool, so labels and headlines mix freely.
    // A flavoured line keeps its own: its eyebrow is part of the joke.
    const eyebrows = chapterEyebrows(id);
    return run !== 0 && !copy.flavour && eyebrows.length && random() < .5 ? { ...copy, eyebrow: pickFrom(eyebrows, random) } : copy;
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
    recap.purchaseCount > 0 && !longView ? { id: 'calendar', lead: leads.calendar, days, spendingDays: recap.spendingDays, elapsedDays, peak,
      week: pairWeek ? { totals: weekdayTotals, busiest: busiestWeekday, weekendShare } : undefined } : null,
    longView && months.length > 1 ? { id: 'months', months, busiest: busiestMonth } : null,
    showMixtape ? { id: 'mixtape', tracks, tapeName: `${recap.period.name} mixtape` } : null,
    showWeekdays && !pairWeek ? { id: 'weekdays', lead: leads.weekdays, totals: weekdayTotals, busiest: busiestWeekday, weekendShare } : null,
    showStreak ? { id: 'streak', lead: leads.streak, days: elapsed, quiet, busy } : null,
    receiptItems.length ? { id: 'receipts', items: receiptItems, largestShare, topShare, purchaseCount: recap.purchaseCount } : null,
    recap.purchaseCount > 1 ? { id: 'habits', lead: leads.habits, purchaseCount: recap.purchaseCount, median: profile?.medianAmount ?? null, average, perDay, spendingDays: recap.spendingDays, repeat: facts.repeat && repeatRow ? { ...facts.repeat, fullLabel: repeatRow.description, total: repeatRow.totalAmount } : null } : null,
  ];
  const shuffled = <T,>(items: T[]) => items.map(item => ({ item, sort: random() })).sort((a, b) => a.sort - b.sort).map(entry => entry.item);
  const others = <T,>(items: T[], exclude: T, count: number) => shuffled(items.filter(item => item !== exclude)).slice(0, count);

  // Shuffle the middle chapters for a run, keeping the calendar ahead of the chapters built from it.
  // Now and then a regular chapter sits a run out, so no two viewings have the same lineup.
  const order: ChapterData[] = middle.filter(chapter => chapter !== null)
    .filter(chapter => run === 0 || cut === 'directors' || (chapter.id !== 'receipts' && chapter.id !== 'habits') || random() >= .2);
  if (run !== 0) {
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    // A speedrun keeps three middle chapters.
    if (cut === 'speedrun') order.splice(3);
    const calendarAt = order.findIndex(chapter => chapter.id === 'calendar');
    const firstDerived = order.findIndex(chapter => chapter.id === 'weekdays' || chapter.id === 'streak');
    if (calendarAt > firstDerived && firstDerived >= 0) [order[calendarAt], order[firstDerived]] = [order[firstDerived], order[calendarAt]];

    // Bonus slides: earned by the figures, scored by how far past the trigger they are, two at most.
    const earned: Array<{ bonus: Bonus; score: number }> = [];
    const elapsedTotal = elapsed.reduce((sum, day) => sum + day.amount, 0);
    // Share-based triggers only count when the total behind the share is a fair one: most of the period
    // has passed, and spending wasn't unusually small. Otherwise fixed costs (rent, utilities, bills paid
    // early) take a big share without anything about them changing.
    const sharesMeaningful = (!recap.isPartial || elapsedDays / totalDays >= .7)
      && (!baseline || baseline.expenses <= 0 || recap.expenses >= baseline.expenses * .6);
    if (!longView && sharesMeaningful && elapsed.length >= 14 && elapsedTotal > 0) {
      const rush = elapsed.slice(0, 3).reduce((sum, day) => sum + day.amount, 0);
      const rushShare = Math.round(rush / elapsedTotal * 100);
      if (rushShare >= 35) earned.push({ score: rushShare / 35, bonus: { kind: 'payday', share: rushShare, amount: rush, days: elapsed.map((day, i) => ({ amount: day.amount, rush: i < 3 })) } });
    }
    if (sharesMeaningful && largestShare !== null && largestShare >= 25 && receiptItems[0]) {
      const item = receiptItems[0];
      earned.push({ score: largestShare / 25, bonus: { kind: 'boss', label: item.label, fullLabel: item.fullLabel, amount: item.amount, share: largestShare, date: item.date, category: item.category } });
    }
    const repeats = (recap.highlights?.repeatPurchases ?? []).filter(row => !isSystemDescription(row.description));
    if (repeats.length >= 2 && repeats.every(row => row.occurrences >= 3)) {
      earned.push({ score: Math.min(...repeats.map(row => row.occurrences)) / 3, bonus: { kind: 'suspects', items: repeats.slice(0, 2).map((row, i) => {
        const saved = labels[`repeatPurchase${i + 1}`];
        return { label: saved && !isSystemDescription(saved) ? saved : shortDisplayLabel(row.description), fullLabel: row.description, occurrences: row.occurrences, total: row.totalAmount };
      }) } });
    }
    if (days && recap.purchaseCount >= MILESTONES[0]) {
      let running = 0;
      const counted = days.map(day => (running += day.purchaseCount));
      const milestone = [...MILESTONES].reverse().find(count => count <= running);
      const dayIndex = milestone ? counted.findIndex(total => total >= milestone) : -1;
      if (milestone && dayIndex >= 0) earned.push({ score: 1.1 + milestone / 1000, bonus: { kind: 'milestone', count: milestone, date: days[dayIndex].date, dayIndex, totalDays: days.length } });
    }
    if (sharesMeaningful && top && top.share >= 50) earned.push({ score: top.share / 50, bonus: { kind: 'takeover', categoryId: top.categoryId, name: top.name, label: top.label, share: top.share } });
    // A comeback: one of this period's top three was nowhere near the top five last period, and its
    // spending at least doubled. Rank alone isn't enough: a fixed cost climbs the ranks whenever the rest
    // of the period is quiet, without anything about it changing.
    const before = !longView && previous ? previous.categories.filter(row => row.amount > 0).sort((a, b) => b.amount - a.amount) : [];
    if (before.length >= 3) {
      const rankBefore = (row: CategoryShare) => before.findIndex(old => row.categoryId != null && old.categoryId != null ? old.categoryId === row.categoryId : old.name === row.name);
      const back = topRows.slice(0, 3).map((row, i) => ({ row, rank: i + 1, was: rankBefore(row) }))
        .find(entry => entry.row.share >= 8 && (entry.was < 0 || entry.was >= 5) && entry.row.amount >= 2 * (entry.was < 0 ? 0 : before[entry.was].amount));
      if (back) earned.push({ score: 1.25, bonus: { kind: 'comeback', categoryId: back.row.categoryId, name: back.row.name, label: back.row.label, rank: back.rank, share: back.row.share,
        previousRank: back.was < 0 ? null : back.was + 1, previousPeriod: previous!.period.name } });
    }
    const bonuses = earned.sort((a, b) => b.score - a.score).slice(0, cut === 'speedrun' ? 1 : 2).map(entry => entry.bonus);
    // Dropped into the middle at distinct slots; splicing the later slot first keeps them apart.
    const bonusSlots = shuffled(Array.from({ length: Math.max(1, order.length) }, (_, i) => i + 1)).slice(0, bonuses.length).sort((a, b) => b - a);
    bonuses.forEach((bonus, i) => order.splice(bonusSlots[i], 0, { id: 'bonus', bonus }));
    // A year's own insights: every one in the director's cut, one in a speedrun, up to three otherwise.
    const insights = shuffled(yearInsights).slice(0, cut === 'directors' ? yearInsights.length : cut === 'speedrun' ? 1 : 3);
    const insightSlots = shuffled(Array.from({ length: order.length }, (_, i) => i + 1)).slice(0, insights.length).sort((a, b) => b - a);
    insights.forEach((insight, i) => order.splice(insightSlots[i], 0, { id: 'year', insight }));

    // Motion interludes: one or two showpieces dropped between chapters, never side by side.
    const marqueeWords = [recap.period.name, top?.label, `${recap.purchaseCount} receipts`, peak ? dayLabel(peak.date) : null, persona.name.replace(/^The /, '')].filter((word): word is string => Boolean(word));
    const available: InterludeVariant[] = ['marquee', 'kaleido', ...(topRows.length >= 3 ? ['orbit' as const] : []), ...(recap.purchaseCount > 0 ? ['tunnel' as const] : []),
      ...(keptShare !== null || budget?.percentUsed != null ? ['liquid' as const] : []), ...(recap.purchaseCount >= 3 ? ['rain' as const] : []),
      // Three suspects and a culprit; it is drawn twice as often as the others.
      ...(topRows.length >= 4 ? ['ejected' as const, 'ejected' as const] : [])];
    // The director's cut always gets two showpieces; a speedrun skips them.
    const picks = [...new Set(shuffled(available))].slice(0, cut === 'directors' ? 2 : cut === 'speedrun' ? 0 : random() < .45 ? 2 : 1);
    const slots = shuffled(Array.from({ length: Math.max(1, order.length - 1) }, (_, i) => i + 1)).slice(0, picks.length).sort((a, b) => b - a);
    const verdicts = pickFrom(EJECT_VERDICTS, random);
    picks.forEach((variant, i) => {
      if (i > 0 && Math.abs(slots[i] - slots[i - 1]) < 2) return;
      order.splice(slots[i], 0, { id: 'interlude', variant, words: marqueeWords, orbit: topRows, value: recap.purchaseCount,
        share: keptShare ?? budget?.percentUsed ?? null, slot: i, verdicts });
    });
  }

  const chapters: ChapterData[] = [
    { id: 'intro', dateRange: periodDateRange(recap.period), isPartial: recap.isPartial, elapsedDays, totalDays, monthWord: recap.period.name.split(' ')[0],
      cover: { issue: recap.period.id, year: String(recapDay(recap.period.endDate).getUTCFullYear()), startLabel: formatRecapDay(recap.period.startDate, { day: 'numeric', month: 'short' }),
        endLabel: formatRecapDay(recap.period.endDate, { day: 'numeric', month: 'short' }), teasers: [], chapterCount: 0, purchaseCount: recap.purchaseCount, keptShare,
        passenger: (edition?.personalization?.preferredName ?? 'You').slice(0, 14), seat: `${(seed % 30) + 1}${'ABCDEF'[seed % 6]}` } },
    { id: 'overview', lead: leads.overview, income: recap.income, expenses: recap.expenses, net: recap.net, keptShare, spentPer100, reveal: leads.overview === 'left' && recap.net > 0 ? 'scratch' : 'none' },
    ...(budget && cut !== 'speedrun' ? [{ id: 'budget' as const, planned: budget.planned, spent: budget.spent, remaining: budget.remaining, percentUsed: budget.percentUsed,
      elapsedShare: facts.elapsedShare, over: budget.overBudgetCategories.map(row => ({ name: row.name, over: row.over })), unbudgeted: budget.unbudgetedExpenses }] : []),
    ...order,
    ...(cut === 'speedrun' ? [] : averageChange !== null ? [{ id: 'comparison' as const, mode: 'average' as const, now: Math.round(average!), before: Math.round(priorAverage!), change: averageChange,
      beforeLabel: baseline!.periodCount === 1 ? 'Previous period' : `Avg of ${baseline!.periodCount} periods`, matchedElapsed: Boolean(baseline?.matchedElapsed) }]
      : recap.comparison ? [{ id: 'comparison' as const, mode: 'total' as const, now: recap.expenses, before: recap.comparison.previousExpenses, change: Math.round(recap.comparison.changePercent),
        beforeLabel: shortDisplayLabel(recap.comparison.periodName, 24), matchedElapsed: false }] : []),
    ...(recap.purchaseCount > 2 ? [{ id: 'persona' as const, persona }] : []),
    { id: 'closing', tiles: closingTiles, persona, finale: {
      period: recap.period.name, dateLabel: periodDateRange(recap.period), income: recap.income, expenses: recap.expenses, net: recap.net, keptShare,
      categories: topRows.slice(0, 3).map(row => ({ label: row.label, share: row.share })), peakLabel: peak ? dayLabel(peak.date) : null,
      purchaseCount: recap.purchaseCount, spendingDays: recap.spendingDays, passenger: (edition?.personalization?.preferredName ?? 'You').slice(0, 18),
    } },
  ];
  // Spoiler first: now and then the personality opens the story and the evidence follows.
  const personaAt = chapters.findIndex(chapter => chapter.id === 'persona');
  if (run !== 0 && cut !== 'speedrun' && personaAt > 0 && random() < .18) {
    const [early] = chapters.splice(personaAt, 1);
    if (early.id === 'persona') chapters.splice(1, 0, { ...early, early: true });
  }

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
    // Higher or lower: one big receipt against another.
    if (receiptItems.length >= 2) {
      const [a, b] = shuffled(receiptItems.slice(0, 3)).slice(0, 2);
      if (a.amount !== b.amount) candidates.push({ id: 'receipts', play: { kind: 'higherLower', anchor: { label: a.label, amount: a.amount }, challenger: { label: b.label, amount: b.amount }, answer: b.amount > a.amount ? 'Higher' : 'Lower' } });
    }
    if (topRows.length >= 3) {
      candidates.push({ id: 'categories', play: { kind: 'memory', cards: topRows.slice(0, 3).map(row => ({ name: row.name, label: row.label })) } });
      candidates.push({ id: 'categories', play: { kind: 'wheel', winner: topRows[0].name, slices: [...topRows.map(row => ({ name: row.name, label: row.label, share: row.share })),
        ...(rest.length ? [{ name: 'Other', label: 'Everything else', share: share(restAmount) }] : [])] } });
    }
    // True or false, with a threshold rolled so the answer isn't always the same.
    if (hasWeek) {
      const line = pickFrom([20, 33, 50], random);
      candidates.push({ id: 'weekdays', play: { kind: 'truefalse', statement: `More than ${line === 33 ? 'a third' : line === 50 ? 'half' : 'a fifth'} of spending landed on weekends.`, answer: weekendShare > line, reveal: `Weekends took ${weekendShare}%.` } });
    }
    if (keptShare !== null) {
      const line = pickFrom([10, 25, 50], random);
      candidates.push({ id: 'overview', play: { kind: 'truefalse', statement: `More than ${line === 50 ? 'half' : line === 25 ? 'a quarter' : 'a tenth'} of what came in was left over.`, answer: keptShare > line, reveal: `${keptShare}% was left.` } });
    }
    if (elapsedDays >= 7) {
      candidates.push({ id: 'habits', play: { kind: 'truefalse', statement: 'Most days of the period had some spending.', answer: recap.spendingDays > elapsedDays / 2, reveal: `${recap.spendingDays} of ${elapsedDays} days did.` } });
    }
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
  // Achievements: unlocked by what the figures actually show, one per chapter at most.
  const quietRun = quiet?.length ?? 0;
  const achievements: Partial<Record<RecapStoryId, Achievement>> = {
    overview: keptShare !== null && keptShare >= 50 ? { title: 'Half and half', detail: `Kept ${keptShare}% of what came in` } : undefined,
    budget: budget && budget.overBudgetCategoryCount === 0 && budget.planned > 0 ? { title: 'Stayed in the lines', detail: 'No category went over its allocation' } : undefined,
    calendar: !showStreak && quietRun >= 3 ? { title: 'Zen mode', detail: `${quietRun} days in a row, nothing spent` } : undefined,
    streak: quietRun >= 3 ? { title: 'Zen mode', detail: `${quietRun} days in a row, nothing spent` } : busy && busy.length >= 5 ? { title: 'On a roll', detail: `${busy.length} spending days in a row` } : undefined,
    categories: positiveCategories.length >= 8 ? { title: 'Explorer', detail: `${positiveCategories.length} categories visited` } : undefined,
    receipts: receiptItems[0] ? { title: 'Big ticket', detail: `${receiptItems[0].label}: ${formatRecapCurrency(receiptItems[0].amount)}` } : undefined,
    habits: recap.purchaseCount >= 30 ? { title: 'Regular customer', detail: `${recap.purchaseCount} purchases this period` } : undefined,
    comparison: averageChange !== null && averageChange <= -10 ? { title: 'Trimmed down', detail: `Average receipt ${Math.abs(averageChange)}% smaller` } : undefined,
  };
  // A toast on every chapter wears thin: a run unlocks just one, on a chapter of its choosing.
  achievements.closing = pickFrom([
    { title: 'Recap complete', detail: `You watched all of ${recap.period.name}` },
    { title: '100% completion', detail: `Every chapter of ${recap.period.name}, seen` },
    { title: 'Credits watched', detail: `Stayed to the end of ${recap.period.name}` },
    { title: 'Level cleared', detail: `${recap.period.name}, start to finish` },
  ], random);
  const shown = new Set(shuffled(chapters.map(chapter => chapter.id).filter(id => achievements[id])).slice(0, 1));
  const equivalences: Partial<Record<RecapStoryId, string>> = {
    overview: recap.net > 0 && perDay > 0 ? `Left over ≈ ${Math.round(recap.net / perDay)} days of spending at this pace.` : undefined,
    categories: top && typical ? `${top.label} ≈ ${Math.round(top.amount / typical)} typical receipts.` : undefined,
    // The chips already carry the money per day; this one counts receipts instead.
    habits: recap.spendingDays > 0 && recap.purchaseCount > recap.spendingDays ? `About ${Math.round(recap.purchaseCount / recap.spendingDays * 10) / 10} receipts on each day you spent.` : undefined,
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

  // Without a run the original family leads; a run deals one family's colours in a shuffled order.
  const familyNames = Object.keys(PALETTE_FAMILIES);
  const family = PALETTE_FAMILIES[run === 0 ? 'original' : familyNames[Math.floor(random() * familyNames.length)]];
  const palette = run === 0 ? [...family.slice(seed % family.length), ...family.slice(0, seed % family.length)] : shuffled(family);
  // A year in review reuses the period copy, reworded for a year.
  const yearView = /^\d{4}$/.test(recap.period.name);
  const forYear = (text: string) => !yearView ? text : text
    .replace(/\b(this|the|your) period\b/gi, (_, word: string) => `${word} year`)
    .replace(/\bnext period\b/gi, 'next year').replace(/\bper period\b/gi, 'per year')
    .replace(/\bsalary to salary\b/gi, 'month to month');
  // The cover's teasers advertise what this run actually holds, games included.
  const teaserFor: Partial<Record<RecapStoryId, string>> = {
    budget: 'The plan vs. reality', categories: 'Where the money really went', calendar: 'The day that turned up the volume',
    weekdays: 'Which weekday ran the show?', streak: 'The longest streak, revealed', receipts: 'The receipts that stole the show',
    habits: 'How you really buy', comparison: 'Then vs. now', persona: 'Your money personality, unmasked',
    mixtape: 'Side A of your period mixtape', months: 'Every month, ranked', bonus: 'A bonus round your figures unlocked',
  };
  const gameTeaser: Record<Play['kind'], string> = { quiz: 'a pop quiz', slider: 'a guessing game', reels: 'a jackpot round', hold: 'a drumroll', gift: 'a surprise gift', piggy: 'a piggy bank to smash',
    higherLower: 'a game of higher or lower', memory: 'a memory match', wheel: 'a spin of the wheel', truefalse: 'a true-or-false round' };
  const games = [...dealt.values()].map(item => gameTeaser[item.kind]);
  const cutLine = cut === 'directors' ? 'The director’s cut: every chapter' : cut === 'speedrun' ? 'Speedrun edition: the quick lap' : null;
  const teasers = [...(cutLine ? [cutLine] : []), ...shuffled(chapters.map(chapter => teaserFor[chapter.id]).filter((line): line is string => Boolean(line))).slice(0, cutLine ? 2 : 3),
    ...(games.length ? [`Plus ${games.slice(0, 2).join(' and ')}`] : [])].map(forYear);
  const built = chapters.map((chapter, i) => {
    if (chapter.id === 'intro') chapter = { ...chapter, cover: { ...chapter.cover, teasers, chapterCount: chapters.length } };
    const raw = chapter.id === 'bonus' ? pickCopy(bonusCopy(chapter.bonus, facts)) : chapter.id === 'year' ? pickCopy(yearCopy(chapter.insight))
      : copyFor(chapter.id, 'lead' in chapter ? chapter.lead : chapter.id === 'interlude' ? chapter.variant : chapter.id === 'persona' ? chapter.persona.key : undefined);
    const early = chapter.id === 'persona' && chapter.early;
    const copy = { eyebrow: forYear(early ? 'Spoiler first' : raw.eyebrow), title: forYear(raw.title), body: forYear(raw.body), flavour: early ? undefined : raw.flavour };
    const equivalence = equivalences[chapter.id];
    const play = dealt.get(chapter.id);
    return {
      // The ejection is set in space: the whole card goes dark.
      ...chapter, ...copy, theme: chapter.id === 'persona' && run !== 0 ? PERSONA_THEMES[chapter.persona.key] : chapter.id === 'interlude' && chapter.variant === 'ejected' ? 'noir' : palette[i % palette.length],
      // The piggy bank replaces the scratch card when it is dealt.
      ...(chapter.id === 'overview' && play?.kind === 'piggy' ? { reveal: 'piggy' } : {}),
      // Some runs swap the closing line for a playful equivalence.
      body: equivalence && run !== 0 && random() < .55 ? equivalence : copy.body,
      play: play?.kind === 'quiz' ? { ...play, quiz: { ...play.quiz, question: forYear(play.quiz.question) } } : play, equivalence,
      // Interludes are showpieces: they move on sooner, except the ejection, which needs its full sequence.
      // A speedrun moves every chapter along faster.
      duration: chapter.id === 'interlude' ? (chapter.variant === 'ejected' ? 9_000 : 6_500) : cut === 'speedrun' ? 6_000 : undefined,
      achievement: run !== 0 && shown.has(chapter.id) && achievements[chapter.id] ?{ ...achievements[chapter.id]!, detail: forYear(achievements[chapter.id]!.detail) } : undefined,
      ask: asks[chapter.id] ?? `Tell me more about this from my ${period} recap: ${copy.title}`,
    } as RecapStory;
  });
  // Colour rule: two chapters in a row never share a theme. A chapter whose colour is fixed (the
  // personality's own theme, the ejection's space) keeps it; its neighbour takes another from the run.
  const fixed = (story: RecapStory) => (story.id === 'persona' && run !== 0) || (story.id === 'interlude' && story.variant === 'ejected');
  for (let i = 1; i < built.length; i++) {
    if (built[i].theme !== built[i - 1].theme) continue;
    const j = fixed(built[i]) ? i - 1 : i;
    const swap = palette.find(theme => theme !== built[j - 1]?.theme && theme !== built[j + 1]?.theme);
    if (swap) built[j] = { ...built[j], theme: swap };
  }
  return built;
}

/** The most frequent value and how often it came up; ties go to the one that came first, and say so. */
function mostFrequent<T>(values: T[]): { value: T; count: number; tied: boolean } | null {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: { value: T; count: number } | null = null;
  for (const [value, count] of counts) if (!best || count > best.count) best = { value, count };
  return best ? { ...best, tied: [...counts.values()].filter(count => count === best.count).length > 1 } : null;
}

/**
 * What a year's periods say that its sums can't: who headlined each month, which months kept something
 * back, the personality each period earned, and the categories that never missed a month. Each insight
 * is offered only when there is enough behind it.
 */
function readYear(periods: PeriodRecap[], monthOf: (period: PeriodRecap) => YearMonth): YearInsight[] {
  const insights: YearInsight[] = [];
  const label = (name: string) => shortDisplayLabel(name, 18);

  const headliners = periods.map(period => {
    const spent = period.categories.filter(row => row.amount > 0);
    const total = spent.reduce((sum, row) => sum + row.amount, 0);
    const top = spent.sort((a, b) => b.amount - a.amount)[0];
    return { ...monthOf(period), category: top?.name ?? null, categoryLabel: top ? label(top.name) : null, share: top && total > 0 ? Math.round(top.amount / total * 100) : 0 };
  });
  const leader = mostFrequent(headliners.flatMap(month => month.category ? [month.category] : []));
  if (leader && headliners.filter(month => month.category).length >= 3) {
    insights.push({ kind: 'headliners', months: headliners, leader: { name: leader.value, label: label(leader.value), count: leader.count, tied: leader.tied },
      distinct: new Set(headliners.flatMap(month => month.category ? [month.category] : [])).size });
  }

  const earning = periods.filter(period => period.income > 0);
  if (earning.length >= 3) {
    const months = periods.map(period => ({ ...monthOf(period), income: Math.max(0, period.income), expenses: Math.max(0, period.expenses),
      kept: period.income > 0 ? Math.round(period.net / period.income * 100) : null }));
    const best = months.filter(month => month.kept !== null && month.kept > 0).sort((a, b) => b.kept! - a.kept!)[0];
    insights.push({ kind: 'green', months, green: months.filter(month => month.income > 0 && month.income >= month.expenses).length, best: best ? { label: best.label, name: best.name, kept: best.kept! } : null });
  }

  // Each period's personality as its own recap reads it, without a run's dice.
  const personas = periods.filter(period => period.purchaseCount > 2).map(period => {
    const closing = buildStories(period).find(story => story.id === 'closing');
    return closing?.id === 'closing' ? { ...monthOf(period), key: closing.persona.key, persona: closing.persona.name } : null;
  }).filter(month => month !== null);
  const topPersona = mostFrequent(personas.map(month => month.key));
  if (topPersona && personas.length >= 3) {
    insights.push({ kind: 'personas', months: personas, leader: { key: topPersona.value, name: personas.find(month => month.key === topPersona.value)!.persona, count: topPersona.count, tied: topPersona.tied },
      distinct: new Set(personas.map(month => month.key)).size });
  }

  const seen = new Map<string, string[]>();
  for (const period of periods) for (const row of period.categories) if (row.amount > 0) seen.set(row.name, [...(seen.get(row.name) ?? []), monthOf(period).label]);
  const regulars = [...seen].filter(([, months]) => months.length === periods.length).map(([name]) => ({ name, label: label(name) }));
  const cameos = [...seen].filter(([, months]) => months.length === 1).map(([name, months]) => ({ name, label: label(name), month: months[0] }));
  if (regulars.length || cameos.length) insights.push({ kind: 'regulars', regulars: regulars.slice(0, 10), cameos: cameos.slice(0, 6), regularCount: regulars.length, cameoCount: cameos.length, periods: periods.length });
  return insights;
}

/** The period's money personality: the pattern that stands out most, with a dash of the runner-up. */
function pickPersona(f: CopyFacts, random: () => number): Persona {
  const ratio = f.elapsedDays > 0 ? f.spendingDays / f.elapsedDays : 0;
  const spread = f.average !== null && f.median ? f.average / f.median : 1;
  const candidates: Array<Omit<Persona, 'dash' | 'figure' | 'figureLabel' | 'figurePrefix' | 'figureSuffix'> & { score: number }> = [
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
  // The one number each persona's scene is built around: the figure that actually earned the title.
  const quietDays = Math.max(0, f.elapsedDays - f.spendingDays);
  const figures: Record<PersonaKey, Pick<Persona, 'figure' | 'figureLabel' | 'figurePrefix' | 'figureSuffix'>> = {
    weekend: { figure: f.weekendShare, figureSuffix: '%', figureLabel: 'of spending on weekends' },
    bigTicket: f.largestShare ? { figure: f.largestShare, figureSuffix: '%', figureLabel: 'of purchase spend in one receipt' } : { figure: Math.round(spread * 10) / 10, figureSuffix: '×', figureLabel: 'the typical receipt, on average' },
    steady: { figure: f.spendingDays, figureLabel: `of ${f.elapsedDays} days had spending` },
    monk: f.quiet >= 2 ? { figure: f.quiet, figureLabel: 'days in a row, nothing out' } : { figure: quietDays, figureLabel: 'days with nothing going out' },
    loyal: { figure: f.repeat?.occurrences ?? 0, figurePrefix: '×', figureLabel: 'the same again' },
    devotee: { figure: f.top?.share ?? 0, figureSuffix: '%', figureLabel: 'to a single category' },
    explorer: { figure: f.categoryCount, figureLabel: 'categories visited' },
    allRounder: { figure: f.purchaseCount, figureLabel: 'purchases, all sorts' },
  };
  return { key: first.key, name: first.name, tagline: first.tagline, evidence: first.evidence.slice(0, 3), ...figures[first.key],
    dash: second && second.key !== 'allRounder' && second.score > 20 ? second.name.replace(/^The /, '') : null };
}
