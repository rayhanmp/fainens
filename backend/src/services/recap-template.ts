import type { RecapCopy, SavedRecapStory } from './recap-schemas';
import { recapShortLabels } from './recap-labels';
import { recapOverview } from './recap-overview';
import { recapDetailInsights } from './recap-detail-insights';

type Snapshot = SavedRecapStory['snapshot'];
type Line = { eyebrow: string; title: string; body: string };
type Chapter = RecapCopy['chapters'][number];

const DAY_MS = 86_400_000;
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const dayLabel = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });

/** A stable number for one part of one edition, so the same seed always tells the same story. */
function hash(seed: number, key: string) {
  let value = 2166136261;
  for (const char of `${seed}:${key}`) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}

/** Editions a new one is written against: `avoid` is the one a New take replaces, so no line repeats it;
 * `keep` is the one a daily refresh updates, so every line it used and still supports stays. */
export type TemplateHistory = { avoid?: RecapCopy; keep?: RecapCopy };

/**
 * The built-in edition, used whenever AI doesn't write the story: no model set up, the provider refuses
 * or doesn't answer, or its copy fails the fact check. Each chapter has a pool of lines, and only lines
 * the snapshot supports join it: no guesses about why money was spent, no praise or shame, and nothing
 * called savings. Lines fit the portrait-slide limits (eyebrow 40, title 56, body 160, headline 64)
 * with labels at their 28-character maximum. The seed picks the lines.
 */
export function fallbackRecapCopy(snapshot: Snapshot, seed: number, preferredName?: string | null, language: 'en' | 'id' = 'en', history: TemplateHistory = {}): RecapCopy {
  const id = language === 'id';
  const name = preferredName?.slice(0, 24);
  const period = snapshot.period.name.slice(0, 42);
  const labels = recapShortLabels(snapshot);
  const partial = snapshot.isPartial;
  const soFar = partial ? ' so far' : '';
  const spending = snapshot.categories.filter(row => row.amount > 0);
  const spendTotal = spending.reduce((sum, row) => sum + row.amount, 0);
  const top = spending.length ? labels.category1 : undefined;
  const second = spending.length > 1 ? labels.category2 : undefined;
  const topShare = top && spendTotal > 0 ? Math.round(spending[0].amount / spendTotal * 100) : null;
  const repeatRow = snapshot.highlights?.repeatPurchases?.[0];
  const repeat = repeatRow ? labels.repeatPurchase1 : undefined;
  const standout = snapshot.largestPurchase ? labels.standoutPurchase : undefined;
  const focus = standout ?? top ?? 'your recorded activity';
  const peak = snapshot.highlights?.peakSpendingDay ?? null;
  const peakDay = peak ? dayLabel.format(peak.date) : null;
  const budget = snapshot.budget ?? null;
  const over = budget?.overBudgetCategoryCount ? labels.budgetCategory1 : undefined;
  const receipts = plural(snapshot.purchaseCount, 'receipt');
  const totalDays = Math.max(1, Math.round((snapshot.endMs - snapshot.startMs + 1) / DAY_MS));
  const elapsedDays = Math.min(totalDays, Math.max(1, Math.floor((Math.min(snapshot.generatedAt, snapshot.endMs) - snapshot.startMs) / DAY_MS) + 1));
  const overview = recapOverview(snapshot, seed, language);
  const insights = recapDetailInsights(snapshot, labels, language);
  /** One of `items` for `key`: the one `keep` used if it's still here, else the seed's pick, never the one `avoid` used. */
  const pick = <T>(key: string, items: T[], used: (item: T, copy: RecapCopy) => boolean): T => {
    const kept = history.keep && items.find(item => used(item, history.keep!));
    if (kept) return kept;
    const fresh = history.avoid ? items.filter(item => !used(item, history.avoid!)) : items;
    const pool = fresh.length ? fresh : items;
    return pool[hash(seed, key) % pool.length];
  };
  const saved = (copy: RecapCopy, key: string) => copy.chapters.find(item => item.id === key);
  const choose = (key: Chapter['id'], lines: Line[]) =>
    pick(key, lines, (line, copy) => saved(copy, key)?.title === line.title && saved(copy, key)?.eyebrow === line.eyebrow);
  const chapter = (key: Chapter['id'], lines: Line[]): Chapter => ({ id: key, ...choose(key, lines) });
  const eyebrowOf = (key: Chapter['id'], eyebrows: string[]) => pick(`${key}:eyebrow`, eyebrows, (eyebrow, copy) => saved(copy, key)?.eyebrow === eyebrow);
  const titleOf = (key: Chapter['id'], titles: string[]) => pick(key, titles, (title, copy) => saved(copy, key)?.title === title);
  const when = <T>(condition: unknown, lines: T[]): T[] => condition ? lines : [];

  const intro = chapter('intro', [
    { eyebrow: 'Open this time capsule', title: 'The receipts remember.', body: `Inside: ${focus}, and ${receipts}${soFar}.` },
    { eyebrow: 'Press rewind', title: name ? `${name}, shall we rewind a little?` : 'Shall we rewind a little?', body: `${period}${partial ? ', so far' : ''}, in ${plural(snapshot.spendingDays, 'spending day')}.` },
    { eyebrow: 'Fresh off the ledger', title: 'Your period, freshly printed.', body: `${receipts} made the edit.` },
    { eyebrow: 'A little receipt gossip', title: 'We need to talk about these receipts.', body: top ? `${top} took the largest slice. The rest is worth a look, too.` : 'The entries are in. Let’s look at the details.' },
    { eyebrow: 'Start with the good details', title: 'Here’s a detail worth keeping.', body: `Start with ${focus}. Ready for the rest?` },
    { eyebrow: 'The period edit', title: partial ? 'The story so far.' : 'The whole story, start to end.', body: `${plural(snapshot.spendingDays, 'day')} with spending, ${receipts} in all.` },
    { eyebrow: 'Tap to begin', title: 'Every receipt gets a scene.', body: `${receipts}, one story.` },
    ...when(top, [
      { eyebrow: 'On the cover', title: `${top} called. It wants the cover.`, body: `The biggest expense category is in. Now for the rest of ${period}.` },
      { eyebrow: 'Top of the bill', title: `Starring ${top}.`, body: second ? `With ${second} close behind.` : `With ${receipts} in supporting roles.` },
    ]),
    ...when(top && spending.length > 1, [
      { eyebrow: 'Cover story', title: `This issue: ${top}.`, body: `Plus ${plural(spending.length - 1, 'other category', 'other categories')} inside.` },
    ]),
    ...when(repeat, [
      { eyebrow: 'Look who’s back', title: `${repeat}. Again? Again.`, body: `A familiar receipt kept returning. ${period} had other surprises, too.` },
      { eyebrow: 'A familiar face', title: 'A familiar name made the guest list.', body: `${repeat} came back ${plural(repeatRow?.occurrences ?? 0, 'time')}.` },
      { eyebrow: 'Worth another look', title: 'Some receipts like an encore.', body: `${repeat} kept popping up. Let’s see what else did.` },
    ]),
    ...when(standout, [
      { eyebrow: 'The first clue', title: 'What made the biggest entrance?', body: `${standout}. Keep it in mind; we’ll come back to it.` },
      { eyebrow: 'Saving the best', title: 'One receipt stood taller than the rest.', body: `It was ${standout}. More on that later.` },
    ]),
    ...when(peakDay, [
      { eyebrow: 'Circle the date', title: 'One day turned the volume up.', body: `${peakDay} was the busiest. The rest of the period follows.` },
    ]),
    ...when(over, [
      { eyebrow: 'Plot twist', title: `${over} went off-script.`, body: 'It ran past its allocation. The rest of the story is here.' },
    ]),
  ]);

  // The Dashboard's teaser card: its own line, so it doesn't just repeat the cover.
  const teaser = pick('headline', [
    { eyebrow: '', title: 'Your period, freshly printed.', body: `${receipts} and a few surprises inside.` },
    { eyebrow: '', title: 'The receipts remember.', body: `Open ${period}${soFar} and see what stood out.` },
    { eyebrow: '', title: 'A little rewind, whenever you’re ready.', body: `${plural(snapshot.spendingDays, 'day')} of spending, told as a story.` },
    { eyebrow: '', title: 'Press play on your period.', body: `${receipts}, a few patterns, one story.` },
    partial
      ? { eyebrow: '', title: 'The story so far, in chapters.', body: `${period} isn’t finished, but the highlights are in.` }
      : { eyebrow: '', title: 'The whole period, in chapters.', body: `${period}, start to finish.` },
    ...when(top, [{ eyebrow: '', title: `${top} wants the cover.`, body: 'Your period story is ready when you are.' }]),
    ...when(repeat, [{ eyebrow: '', title: `${repeat} came back. Again.`, body: `Find out what else returned in ${period}.` }]),
    ...when(standout, [{ eyebrow: '', title: 'One receipt stood out.', body: `It was ${standout}. The rest of the period is waiting.` }]),
    ...when(peakDay, [{ eyebrow: '', title: 'One day turned the volume up.', body: `See which day ${period} remembers most.` }]),
    ...when(budget, [over
      ? { eyebrow: '', title: `${over} went off-script.`, body: 'See how the plan met the receipts.' }
      : { eyebrow: '', title: 'The plan met the receipts.', body: 'See how your budget played out.' }]),
  ], (line, copy) => copy.headline === line.title);

  const budgetLines: Line[] = !budget ? [
    { eyebrow: 'No plan this time', title: 'No budget lines this time.', body: 'This period has entries, but no category budgets to compare them with.' },
    { eyebrow: 'Freestyle', title: 'This period ran without a script.', body: 'No category budgets were set, so there’s nothing to measure against.' },
    { eyebrow: 'Off the grid', title: 'No envelopes, no lines to stay inside.', body: 'Set category budgets and this chapter compares them with your receipts.' },
  ] : over ? [
    { eyebrow: 'Plot twist', title: `${over} went off-script.`, body: `${over} crossed its category allocation. The receipts wrote that part.` },
    { eyebrow: 'Outside the lines', title: `${over} coloured outside the lines.`, body: `It spent past its allocation${soFar}.` },
    { eyebrow: 'The plan meets the receipts', title: 'Some categories redrew the lines.', body: `${over} ran past its allocation${budget.overBudgetCategoryCount > 1 ? `, with ${budget.overBudgetCategoryCount - 1} more` : ''}.` },
    { eyebrow: 'Script versus scene', title: `${over} improvised.`, body: 'Its allocation said one thing. The receipts said more.' },
  ] : budget.spent < 0 ? [
    { eyebrow: 'Credits in the mix', title: 'Credits rewrote part of the plan.', body: 'The budgeted categories show net expense credits in this edition.' },
    { eyebrow: 'A twist in the totals', title: 'Credits outweighed the receipts.', body: 'Budgeted categories ended with more credits than spending.' },
  ] : budget.remaining === 0 ? [
    { eyebrow: 'Right on the line', title: 'The recorded totals lined up.', body: 'Spending in budgeted categories matched the plan exactly.' },
    { eyebrow: 'To the rupiah', title: 'Plan and receipts met exactly.', body: 'Not a rupiah over, not a rupiah under.' },
  ] : partial ? [
    { eyebrow: 'The plan, so far', title: 'The outline is still taking shape.', body: 'Your allocations and the receipts so far, side by side.' },
    { eyebrow: 'Work in progress', title: 'The plan is still being written.', body: 'No category has gone past its allocation yet.' },
    { eyebrow: 'Plan versus calendar', title: 'Still inside the lines, for now.', body: 'No category has passed its allocation so far.' },
  ] : snapshot.coverageComplete ? [
    { eyebrow: 'The plan meets the receipts', title: 'The outline kept some room.', body: 'Every budgeted category stayed inside its allocation.' },
    { eyebrow: 'Inside the lines', title: 'Every category stayed inside the lines.', body: 'Some of the plan was left unspent at the end.' },
    { eyebrow: 'Script followed', title: 'The plan held its shape.', body: 'No category went past its allocation.' },
  ] : [
    { eyebrow: 'The plan meets the receipts', title: 'No category passed its allocation.', body: 'Tracking has gaps, so this covers what was recorded.' },
    { eyebrow: 'Inside the recorded lines', title: 'The recorded receipts stayed in the plan.', body: 'Coverage is incomplete, so some spending may be missing.' },
  ];

  const categoryBody = top ? `${plural(spending.length, 'category', 'categories')} with spending${soFar}.` : 'No category recorded net spending this time.';
  const categories = chapter('categories', [
    { eyebrow: 'The expense leaderboard', title: 'The nominees, biggest first.', body: categoryBody },
    { eyebrow: 'The countdown', title: 'Counting down to number one.', body: categoryBody },
    { eyebrow: 'Where it went', title: 'Here’s where the money went.', body: categoryBody },
    { eyebrow: 'Top of the list', title: 'The categories that spent the most.', body: categoryBody },
    { eyebrow: 'Ranked', title: 'Every category, in order of spend.', body: categoryBody },
  ]);

  const shareBody = topShare !== null ? `${topShare}% of everything that went out${soFar}.` : 'Your largest expense category, and its slice of the period.';
  const spotlight = chapter('spotlight', top ? [
    { eyebrow: 'Top billing', title: `${top} gets the mic.`, body: shareBody },
    { eyebrow: 'The headliner', title: `Headlining: ${top}.`, body: shareBody },
    { eyebrow: 'Number one', title: `${top} tops the chart.`, body: shareBody },
    { eyebrow: 'Main character', title: `${top} had the most lines.`, body: shareBody },
    { eyebrow: 'Biggest slice', title: `${top} took the biggest slice.`, body: shareBody },
    { eyebrow: 'In the spotlight', title: `All eyes on ${top}.`, body: shareBody },
  ] : [
    { eyebrow: 'Top billing', title: 'No category took the stage.', body: 'No expense category had positive spending this time.' },
    { eyebrow: 'Quiet stage', title: 'The spotlight stayed empty.', body: 'No category ended with positive spending.' },
  ]);

  const varietyBody = `${plural(spending.length, 'category', 'categories')} had spending${soFar}.`;
  const variety = chapter('variety', spending.length === 0 ? [
    { eyebrow: 'The supporting cast', title: 'A quiet cast this time.', body: 'No category recorded positive spending.' },
    { eyebrow: 'An empty stage', title: 'No categories stepped up.', body: 'No category recorded positive spending.' },
  ] : spending.length <= 2 ? [
    { eyebrow: 'A tight cast', title: 'A short list this time.', body: `Only ${varietyBody}` },
    { eyebrow: 'Keeping it simple', title: 'Just a few names on the list.', body: varietyBody },
    { eyebrow: 'Small cast', title: 'A small cast, a clear story.', body: varietyBody },
  ] : [
    { eyebrow: 'The supporting cast', title: 'A whole cast of categories.', body: varietyBody },
    { eyebrow: 'The range', title: 'From the big ones to the small ones.', body: varietyBody },
    { eyebrow: 'Everyone gets a line', title: 'Every category added a thread.', body: varietyBody },
    ...when(spending.length >= 4, [{ eyebrow: 'The spread', title: 'Spending went in many directions.', body: varietyBody }]),
  ]);

  const rhythmBody = `Spending showed up on ${plural(snapshot.spendingDays, 'day')}${soFar}.`;
  const rhythm = chapter('rhythm', [
    { eyebrow: 'The beat behind the receipts', title: 'Cue the receipt drumroll.', body: rhythmBody },
    { eyebrow: 'Your rhythm', title: 'Your period had a beat.', body: rhythmBody },
    { eyebrow: 'Tempo', title: 'Small moments. A whole rhythm.', body: rhythmBody },
    { eyebrow: 'Day by day', title: 'Day by day, receipt by receipt.', body: rhythmBody },
    { eyebrow: 'The calendar', title: 'The calendar kept the tempo.', body: rhythmBody },
    ...when(snapshot.spendingDays > 0 && snapshot.spendingDays < elapsedDays, [
      { eyebrow: 'Loud and quiet', title: 'Some days hummed, some stayed quiet.', body: `${plural(elapsedDays - snapshot.spendingDays, 'day')} passed without spending.` },
    ]),
  ]);

  // Insight chapters keep their verified body; English editions get a choice of headline for it.
  const insight = (key: Chapter['id'], base: { title: string; body: string }, eyebrows: string[], titles: string[], idEyebrow: string): Chapter => {
    if (id) return { id: key, eyebrow: idEyebrow, ...base };
    return { id: key, eyebrow: eyebrowOf(key, eyebrows), title: titleOf(key, titles), body: base.body };
  };

  const purchases = insight('purchases', insights.purchases,
    repeat ? ['The recurring receipts', 'On repeat', 'Encore', 'The regulars'] : ['One-offs', 'The recurring receipts', 'No repeats'],
    repeat ? ['One name kept coming back.', 'A familiar receipt, on repeat.', `${repeat} had an encore.`, `${repeat}, again and again.`, 'Some receipts love a sequel.']
      : ['No recurring receipt this time.', 'Every receipt was a one-off.', 'No repeats, all premieres.', 'A period of first-timers.'],
    'Nama yang berulang');

  const peakBody = peak ? `${plural(peak.purchaseCount, 'purchase')} on that one day.` : 'No day had recorded purchases to single out.';
  const peakChapter = chapter('peak', peakDay ? [
    { eyebrow: 'A day to remember', title: `${peakDay} turned up the volume.`, body: peakBody },
    { eyebrow: 'Mark the calendar', title: `${peakDay} had the spotlight.`, body: peakBody },
    { eyebrow: 'Circled in red', title: `Circle ${peakDay}.`, body: peakBody },
    { eyebrow: 'Peak day', title: 'One day outshone the rest.', body: `${peakDay}: ${peakBody}` },
    { eyebrow: 'The busiest day', title: 'The busiest day of the period.', body: `${peakDay}: ${peakBody}` },
    { eyebrow: 'Save the date', title: `${peakDay}. Remember it?`, body: peakBody },
  ] : [
    { eyebrow: 'The story, in entries', title: 'Every entry gets a part.', body: peakBody },
    { eyebrow: 'No peak', title: 'No single day stood out.', body: peakBody },
  ]);

  const profile = snapshot.purchaseProfile;
  const largestShare = profile && snapshot.largestPurchase ? Math.round(snapshot.largestPurchase.amount / profile.totalAmount * 100) : null;
  const moment = standout ? insight('moment', insights.moment, ['The standout receipt', 'The big one', 'Heavyweight', 'Biggest receipt'],
    largestShare !== null && largestShare >= 25
      ? ['One receipt took a sizeable slice.', `${standout} took a big bite.`, 'One receipt, a big share.', 'The heavyweight receipt.']
      : ['The biggest receipt, in perspective.', `${standout}, the top receipt.`, 'The largest receipt, sized up.', 'Biggest receipt, smaller share.'],
    'Struk paling menonjol') : { id: 'moment' as const, eyebrow: id ? 'Struk paling menonjol' : 'The standout receipt', ...insights.moment };

  const average = profile && snapshot.purchaseCount > 0 ? profile.totalAmount / snapshot.purchaseCount : null;
  const skewed = average !== null && profile ? average >= profile.medianAmount * 1.25 : false;
  const balance = profile ? insight('balance', insights.balance, ['The typical receipt', 'Middle of the pack', 'Receipt sizes', 'The usual'],
    skewed ? ['The big receipts weren’t the whole story.', 'Averages can be misleading.', 'A few big receipts pulled the average up.', 'The middle receipt tells another story.']
      : ['What did a middle-sized receipt look like?', 'The typical receipt, sized up.', 'Meet the middle-sized receipt.'],
    'Ukuran struk yang tipikal') : { id: 'balance' as const, eyebrow: id ? 'Ukuran struk yang tipikal' : 'The typical receipt', ...insights.balance };

  const comparisonTitles = (): string[] => {
    if (insights.averageChange !== null) {
      const change = insights.averageChange;
      return change >= 10 ? ['The average receipt got bigger.', 'Bigger receipts, on average.', 'Each purchase weighed a little more.']
        : change <= -10 ? ['The average receipt got smaller.', 'Smaller receipts, on average.', 'Each purchase came in lighter.']
          : ['A familiar average receipt size.', 'Receipt sizes held steady.', 'Same-sized receipts as before.'];
    }
    const change = snapshot.comparison?.changePercent ?? 0;
    return change > 0 ? ['The expense total climbed this time.', 'More went out than last time.', 'Spending stepped up.']
      : change < 0 ? ['The expense total came down.', 'Less went out than last time.', 'Spending stepped back.']
        : ['The expense total stayed level.', 'Spending matched last time.'];
  };
  const comparison = insights.comparison
    ? insight('comparison', insights.comparison, ['Then and now', 'Versus before', 'The rematch', 'Side by side'], comparisonTitles(), 'Dulu dan sekarang')
    : chapter('comparison', [
      { eyebrow: id ? 'Dulu dan sekarang' : 'Then and now', title: 'No comparable history yet.', body: 'This edition has no supported historical purchase comparison.' },
      { eyebrow: 'First of its kind', title: 'Nothing to compare with yet.', body: 'Earlier periods don’t have matching records to compare.' },
    ]);

  const overviewEyebrows = id ? ['Di balik angka'] : ['Behind the numbers', 'The bigger picture', 'Look at the contrast', 'In and out', 'The balance sheet'];
  const closing = chapter('closing', partial ? [
    { eyebrow: 'To be continued', title: 'To be continued.', body: 'The period is still running. The rest is yours to write.' },
    { eyebrow: 'Your next chapter', title: 'The story isn’t finished yet.', body: 'Check back before it ends for the full story.' },
    { eyebrow: 'More to come', title: 'More chapters to come.', body: 'The period is still running. The rest is yours to write.' },
    { eyebrow: 'Until next time', title: 'Same you. More pages left.', body: 'Check back before it ends for the full story.' },
  ] : [
    { eyebrow: 'Your next chapter', title: 'Same you. Fresh chapter.', body: 'What gets a little more room in the next period? Your budget is ready for its next edit.' },
    { eyebrow: 'That’s a wrap', title: 'Keep the plot. Turn the page.', body: 'The next period starts with a blank page.' },
    { eyebrow: 'Until next time', title: 'The sequel is yours.', body: 'Next period, new receipts, new story.' },
    { eyebrow: 'The end, for now', title: 'Roll credits.', body: 'Your budget is ready for its next edit.' },
    { eyebrow: 'See you soon', title: 'See you next period.', body: 'The next period starts with a blank page.' },
  ]);

  const chapters: RecapCopy['chapters'] = [
    intro,
    { id: 'overview', eyebrow: eyebrowOf('overview', overviewEyebrows), title: overview.title, body: overview.body },
    chapter('budget', budgetLines),
    categories, spotlight, variety, rhythm, purchases, peakChapter, moment, balance, comparison, closing,
  ];
  return { shortLabels: labels, headline: teaser.title, deck: teaser.body, chapters };
}
