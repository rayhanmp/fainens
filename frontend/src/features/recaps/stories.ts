import type { PeriodRecap, SavedRecapStory } from './queries';
import { formatRecapCurrency as formatCurrency } from './currency';
import { recapDisplayCopy, shortDisplayLabel } from './display-copy';

export function periodDateRange(period: { startDate: number; endDate: number }) {
  const format = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `${format.format(new Date(period.startDate))} – ${format.format(new Date(period.endDate))}`;
}

export type RecapStory = {
  id: string; eyebrow: string; title: string; body: string;
  theme: 'lime' | 'ink' | 'lilac' | 'peach' | 'cream';
  stat?: { value: number; money?: boolean; suffix?: string; label?: string };
  metrics?: Array<{ label: string; amount: number; fullLabel?: string }>;
  bars?: Array<{ label: string; value: number; fullLabel?: string }>;
  layout: 'cover' | 'flow' | 'budget' | 'podium' | 'spotlight' | 'mosaic' | 'orbit' | 'receipt' | 'calendar' | 'poster' | 'balance' | 'timeline' | 'outro';
  budgetUse?: number;
  detail?: string;
  fullDetail?: string;
};

export function buildStories(recap: PeriodRecap, edition?: SavedRecapStory): RecapStory[] {
  const period = recap.period.name;
  const { labels, compact } = recapDisplayCopy(recap, edition);
  const seed = edition?.seed ?? recap.period.id;
  const name = seed % 8 === 4 ? edition?.personalization?.preferredName : undefined;
  const top = recap.categories[0];
  const categoryShare = top && recap.expenses > 0 && top.amount <= recap.expenses
    ? Math.round(top.amount / recap.expenses * 100) : null;
  const peak = recap.highlights?.peakSpendingDay;
  const budget = recap.budget;
  const profile = recap.purchaseProfile;
  const repeat = recap.highlights?.repeatPurchases?.[0];
  const baseline = recap.coverageComplete ? recap.baseline : null;
  const averagePurchase = profile && recap.purchaseCount > 0 ? profile.totalAmount / recap.purchaseCount : null;
  const priorAverage = baseline?.purchaseTotal !== undefined && baseline.purchaseTotal > 0 && baseline.purchaseCount > 0
    ? baseline.purchaseTotal / baseline.purchaseCount : null;
  const averageChange = averagePurchase !== null && priorAverage !== null ? Math.round((averagePurchase - priorAverage) / priorAverage * 100) : null;
  const budgetDetails = budget ? [
    budget.overBudgetCategoryCount ? `${labels.budgetCategory1}${budget.overBudgetCategoryCount > 1 ? ` + ${budget.overBudgetCategoryCount - 1} more` : ''} above category allocation` : null,
    budget.unbudgetedExpenses !== 0 ? `${formatCurrency(budget.unbudgetedExpenses)} outside these allocations` : null,
  ].filter(Boolean).join(' · ') : undefined;
  const totalDays = Math.max(1, Math.ceil((recap.endMs - recap.startMs + 1) / 86_400_000));
  const elapsedDays = Math.min(totalDays, Math.max(1, Math.floor((Math.min(recap.generatedAt, recap.endMs) - recap.startMs) / 86_400_000) + 1));
  const dateFormat = new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const stories: RecapStory[] = [
    { id: 'intro', eyebrow: 'Your personal highlight reel', title: name ? `${name}, shall we rewind a little?` : 'Roll the highlights.', theme: 'lime', layout: 'cover',
      body: `${period} has entered the chat. Let’s give those receipts their close-up${recap.isPartial ? '—the story is still unfolding' : ''}.` },
    { id: 'overview', eyebrow: 'Meet the cast', title: 'Money in. Money out. Plot twist?', theme: 'ink', layout: 'flow',
      body: 'Income, expenses, and what sits between them. Everyone gets a speaking part.', metrics: [
        { label: 'Recorded income', amount: recap.income }, { label: 'Recorded expenses', amount: recap.expenses }, { label: 'Income − expenses', amount: recap.net },
      ] },
    { id: 'budget', eyebrow: recap.isPartial ? 'The plan, so far' : 'The plan meets the receipts',
      title: !budget ? 'No budget lines this time.' : budget.overBudgetCategoryCount ? 'Some categories redrew the lines.' : budget.spent < 0 ? 'Credits rewrote part of the plan.' : budget.remaining === 0 ? 'The recorded totals lined up.' : recap.coverageComplete && !recap.isPartial ? 'The outline kept some room.' : 'The outline is still taking shape.',
      theme: 'cream', layout: 'budget',
      body: !budget ? 'This period has entries, but no category budgets to compare them with.' : budget.overBudgetCategoryCount ? `${labels.budgetCategory1} crossed its category allocation. The receipts wrote that part.` : 'Your allocations and the entries captured so far, side by side.',
      stat: budget ? budget.percentUsed !== null ? { value: budget.percentUsed, suffix: '%', label: recap.isPartial ? 'recorded allocation use so far' : 'recorded allocation use' } : { value: budget.spent, money: true, label: 'recorded in budgeted categories' } : undefined,
      budgetUse: budget?.percentUsed ?? undefined,
      metrics: budget ? [{ label: 'Planned allocation', amount: budget.planned }, { label: budget.remaining < 0 ? 'Above allocation' : 'Recorded remainder', amount: Math.abs(budget.remaining) }] : undefined,
      detail: budgetDetails,
      fullDetail: budget?.overBudgetCategories.map(row => `${row.name}: ${formatCurrency(row.over)} above allocation`).join(' · '),
    },
    { id: 'categories', eyebrow: 'The expense leaderboard', title: 'And the nominees are…', theme: 'lilac', layout: 'podium',
      body: top ? 'Your largest expense categories, ranked by net recorded amounts. Refunds and shared-cost adjustments are included.' : 'No category with positive net expenses to rank this time.',
      bars: top ? recap.categories.slice(0, 3).map((category, i) => ({ label: labels[`category${i + 1}`], fullLabel: category.name, value: category.amount })) : undefined },
    { id: 'spotlight', eyebrow: 'Top billing', title: top ? `${labels.category1} gets the mic.` : 'A quiet spotlight.', theme: 'cream', layout: 'spotlight',
      body: top ? 'The leading category in your recorded expenses. Every headline has a story behind it.' : 'No positive expense category to put centre stage in this edition.',
      stat: categoryShare !== null ? { value: categoryShare, suffix: '%', label: 'of recorded net expenses' } : top ? { value: top.amount, money: true, label: 'largest category by net expenses' } : undefined,
      detail: categoryShare !== null ? `${labels.category1} · ${formatCurrency(top!.amount)}` : undefined,
      fullDetail: categoryShare !== null ? `${top!.name} · ${formatCurrency(top!.amount)}` : undefined },
    { id: 'variety', eyebrow: 'The supporting cast', title: 'Your receipts had range.', theme: 'peach', layout: 'mosaic',
      body: 'Every category with positive net expenses adds another thread. Variety, in ledger form.',
      stat: { value: recap.categories.length, label: 'categories with positive net expenses' },
      detail: recap.categories.slice(0, 4).map((_, i) => labels[`category${i + 1}`]).join(' · ') || 'No positive expense categories' },
    { id: 'rhythm', eyebrow: 'The beat behind the receipts', title: 'Cue the receipt drumroll.', theme: 'lime', layout: 'orbit',
      body: 'These are the days with recorded purchases. A rhythm made from entries, not a guess about your routine.',
      stat: { value: recap.spendingDays, label: 'days with purchases' } },
    { id: 'purchases', eyebrow: 'The little plot points', title: 'One entry at a time.', theme: 'ink', layout: 'receipt',
      body: recap.highlights?.repeatPurchases?.[0]
        ? `${labels.repeatPurchase1} came back for an encore. Even receipts have recurring characters.`
        : recap.highlights?.topPurchases?.[0]
          ? `${labels.purchase1} takes the close-up; ${labels.purchase2 ?? 'the supporting cast'} brings the plot.`
          : 'The small purchases had their moment. Every good story needs a supporting cast.',
      stat: { value: recap.purchaseCount, label: 'purchases' },
      detail: repeat ? `${formatCurrency(repeat.totalAmount)} across ${repeat.occurrences} ${labels.repeatPurchase1} entries` : undefined },
    { id: 'peak', eyebrow: peak ? 'A day with main-character energy' : 'The story, in entries', title: peak ? 'This day turned up the volume.' : 'Every entry gets a part.', theme: 'lilac', layout: 'calendar',
      body: peak ? 'The day with your highest net recorded expenses. A headline in the ledger, not a verdict on the day.' : 'Income, purchases and expense credits all have a place in this period’s recorded activity.',
      stat: peak ? { value: peak.amount, money: true, label: 'net expenses that day' } : { value: recap.activityCount, label: 'recorded financial entries' },
      detail: peak ? `${dateFormat.format(new Date(peak.date))} · ${peak.purchaseCount} ${peak.purchaseCount === 1 ? 'purchase' : 'purchases'}` : undefined },
    { id: 'moment', eyebrow: 'The standout receipt', title: recap.largestPurchase ? 'One receipt stole the scene.' : 'No purchase cameo this time.', theme: 'peach', layout: 'poster',
      body: recap.largestPurchase ? 'Your largest recorded purchase gets a close-up. You know the story behind this one.' : 'There’s no positive recorded purchase to feature. That doesn’t mean the period had no money movement.',
      stat: recap.largestPurchase ? { value: recap.largestPurchase.amount, money: true, label: 'largest recorded purchase' } : undefined,
      detail: labels.standoutPurchase, fullDetail: recap.largestPurchase?.description },
    { id: 'balance', eyebrow: 'The typical receipt', title: 'The big receipts weren’t the whole story.', theme: 'cream', layout: 'balance',
      body: 'The middle-sized receipt puts the larger purchases in perspective.',
      stat: profile ? { value: profile.medianAmount, money: true, label: 'middle purchase amount' } : undefined,
      detail: averagePurchase !== null ? `Average purchase: ${formatCurrency(Math.round(averagePurchase))}` : undefined },
    { id: 'comparison', eyebrow: 'Then and now', title: averageChange !== null ? 'The average receipt changed size.' : 'The expense total changed.', theme: 'ink', layout: 'poster',
      body: recap.comparison ? 'Different periods bring different needs. Here’s the change against your previous complete period.' : recap.isPartial ? 'This edition captures the period so far. No finished-period comparison yet.' : 'No comparable previous period is available for this edition. This chapter stands on its own.',
      stat: averageChange !== null ? { value: Math.abs(averageChange), suffix: '%', label: 'change in average purchase size' }
        : recap.comparison ? { value: Math.abs(Math.round(recap.comparison.changePercent)), suffix: '%', label: 'change in recorded expenses' } : { value: elapsedDays, label: `of ${totalDays} days elapsed when saved` },
      detail: averageChange !== null ? `${formatCurrency(Math.round(averagePurchase!))} now · ${formatCurrency(Math.round(priorAverage!))} before${recap.baseline?.matchedElapsed ? ' · same elapsed time' : ''}`
        : recap.comparison ? `${Math.abs(Math.round(recap.comparison.changePercent))}% ${recap.comparison.changePercent > 0 ? 'higher' : recap.comparison.changePercent < 0 ? 'lower' : 'change'} than ${recap.comparison.periodName}` : periodDateRange(recap.period) },
    { id: 'closing', eyebrow: 'Your next chapter', title: 'Same you. Fresh chapter.', theme: 'lime', layout: 'outro',
      body: 'What gets a little more room in the next period? Your budget is ready for its next edit.' },
  ];
  const palettes: RecapStory['theme'][][] = [
    ['lime', 'ink', 'lilac', 'cream', 'peach', 'lime', 'ink', 'lilac', 'peach', 'cream', 'ink', 'lime'],
    ['lilac', 'cream', 'ink', 'peach', 'lime', 'lilac', 'cream', 'peach', 'ink', 'lime', 'cream', 'lilac'],
    ['peach', 'ink', 'lime', 'lilac', 'cream', 'peach', 'ink', 'cream', 'lilac', 'lime', 'ink', 'peach'],
    ['cream', 'peach', 'ink', 'lime', 'lilac', 'cream', 'peach', 'ink', 'lime', 'lilac', 'cream', 'peach'],
    ['ink', 'lime', 'peach', 'cream', 'lilac', 'ink', 'lime', 'peach', 'cream', 'lilac', 'ink', 'lime'],
    ['peach', 'cream', 'lilac', 'ink', 'lime', 'peach', 'cream', 'lime', 'ink', 'lilac', 'peach', 'cream'],
    ['lilac', 'lime', 'cream', 'ink', 'peach', 'lilac', 'lime', 'cream', 'peach', 'ink', 'lilac', 'lime'],
    ['lime', 'peach', 'cream', 'lilac', 'ink', 'lime', 'peach', 'lilac', 'cream', 'ink', 'lime', 'peach'],
  ];
  const design = seed % palettes.length;
  return stories.filter(story => {
    if (story.id === 'budget') return recap.budget !== undefined;
    if (story.id === 'balance') return Boolean(profile && recap.purchaseCount > 1);
    if (story.id === 'comparison') return averageChange !== null || Boolean(recap.comparison);
    if (story.id === 'moment') return Boolean(recap.largestPurchase);
    if (story.id === 'peak') return Boolean(peak);
    if (story.id === 'purchases' || story.id === 'rhythm') return recap.purchaseCount > 0;
    if (story.id === 'categories' || story.id === 'spotlight') return recap.categories.length > 0;
    if (story.id === 'variety') return recap.categories.length > 1;
    return true;
  }).map((story, i) => {
    const saved = edition?.copy.chapters.find(chapter => chapter.id === story.id);
    // Old cached filler can still describe the saved figures accurately. This
    // display repair neither fetches fresh facts nor rewrites the saved edition.
    const oldOverview = story.id === 'overview' && (saved?.body ?? story.body) === 'Income, expenses, and what sits between them. Everyone gets a speaking part.';
    const observedShare = recap.income > 0 && recap.expenses >= 0 ? Math.round(recap.expenses / recap.income * 100) : null;
    const title = oldOverview ? observedShare !== null
      ? recap.net < 0 ? 'Expenses overtook income.' : recap.net > 0 ? 'More came in than went out.' : 'Income and expenses met in the middle.'
      : recap.expenses < 0 ? 'Credits changed the balance.' : 'No positive income recorded yet.'
      : compact(saved?.title ?? story.title);
    let body = oldOverview ? observedShare !== null
      ? `Expenses${recap.isPartial ? ' so far' : ''} used ${observedShare}% of recorded income, ${recap.net > 0 ? 'leaving a recorded surplus' : recap.net < 0 ? 'exceeding recorded income' : 'matching recorded income'}.`
      : recap.expenses < 0 ? 'Expense credits outweighed purchases in this period’s entries.' : 'No positive income is recorded to compare with these expenses.'
      : compact(saved?.body ?? story.body);
    if (story.id === 'purchases' && recap.purchaseProfile === undefined) body = repeat && recap.purchaseCount > 0
      ? `${labels.repeatPurchase1} appeared ${repeat.occurrences} times, accounting for ${Math.round(repeat.occurrences / recap.purchaseCount * 100)}% of your purchases.`
      : 'No named purchase repeated in these entries.';
    if (story.id === 'comparison' && recap.purchaseProfile === undefined && recap.comparison) body = `Recorded expenses were ${Math.abs(Math.round(recap.comparison.changePercent))}% ${recap.comparison.changePercent >= 0 ? 'higher' : 'lower'} than ${shortDisplayLabel(recap.comparison.periodName, 42)}.`;
    // A complete fallback hook is preferable to clipping an overlong old headline.
    const titleFits = title.length <= 56 && !/(?:\b(?:and|with|at|dan|dengan|di)|[,;:]|…|\.\.\.)\s*$/i.test(title);
    return { ...story, ...saved,
      title: titleFits ? title : compact(story.title),
      eyebrow: shortDisplayLabel(saved?.eyebrow ?? story.eyebrow, 40),
      body: body.length <= 160 ? body : compact(story.body),
      theme: palettes[design][i % palettes[design].length] };
  });
}
