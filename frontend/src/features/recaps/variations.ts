import { formatRecapCurrency as money } from './currency';
import type { RecapStoryId } from './stories';

export type CopyFacts = {
  period: string; isPartial: boolean; net: number; income: number; expenses: number; keptShare: number | null; spentPer100: number | null;
  budgetUsed: number | null; elapsedShare: number | null; remaining: number | null; overCategory: string | null;
  top: { label: string; share: number } | null; top3Share: number; categoryCount: number;
  spendingDays: number; elapsedDays: number; peak: { label: string; weekday: string; amount: number; purchaseCount: number } | null;
  busiestWeekday: string | null; weekendShare: number; quiet: number; busy: number;
  receipt: { label: string; amount: number; count: number } | null; largestShare: number | null; topShare: number | null;
  purchaseCount: number; median: number | null; average: number | null; perDay: number;
  repeat: { label: string; occurrences: number } | null; change: number | null; changeMode: 'average' | 'total';
  busiestMonth: string | null;
};
type Copy = { eyebrow: string; title: string; body: string };

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * Alternative copy for each chapter and the fact it leads with. Every line is built from the verified
 * figures the chapter shows: playful about the data, never a guess about why money was spent, and no
 * praise or shame. The first option sets the chapter's eyebrow when the saved edition's copy is used.
 */
export function chapterCopy(id: RecapStoryId, lead: string | undefined, f: CopyFacts): Copy[] {
  const soFar = f.isPartial ? ' so far' : '';
  switch (id) {
    case 'intro': return [
      { eyebrow: 'Your period, in review', title: 'Roll the highlights.', body: `${f.period}${f.isPartial ? ', so far' : ''}. Let’s look back.` },
      { eyebrow: 'Previously on your finances', title: `Previously, in ${f.period}…`, body: `${plural(f.purchaseCount, 'receipt')}, ${plural(f.spendingDays, 'day')} of spending. Here’s the story.` },
      { eyebrow: 'Press play', title: 'Ready for a rewind?', body: f.top ? `Spoiler: ${f.top.label} has a big part.` : 'A few details are worth a second look.' },
      { eyebrow: 'The period edit', title: f.top ? `Starring ${f.top.label}.` : 'Your period, the movie.', body: `With ${plural(f.purchaseCount, 'purchase')} in supporting roles.` },
      { eyebrow: 'Fresh off the ledger', title: 'Your receipts, remixed.', body: `Everything ${f.period} recorded${soFar}, in a few quick chapters.` },
    ];
    case 'overview': return lead === 'ratio' && f.spentPer100 !== null ? [
      { eyebrow: 'Money in, money out', title: `Every Rp100 in, Rp${f.spentPer100} out.`, body: f.keptShare !== null ? `The other ${f.keptShare}% was left after expenses.` : 'Expenses went past what came in.' },
      { eyebrow: 'The exchange rate', title: `${f.spentPer100}% of income went to expenses.`, body: `${money(f.expenses)} out of ${money(f.income)} in${soFar}.` },
    ] : [
      { eyebrow: 'Money in, money out', title: f.net >= 0 ? 'More came in than went out.' : 'Expenses overtook income.', body: `${money(f.income)} in, ${money(f.expenses)} out${soFar}.` },
      ...(f.net >= 0 ? [
        { eyebrow: 'The bottom line', title: `${money(f.net)} left over.`, body: f.keptShare !== null ? `That’s ${f.keptShare}% of what came in, after expenses.` : 'Income minus expenses, as recorded.' },
        { eyebrow: 'After the receipts', title: 'Income won this round.', body: `${money(f.net)} more came in than went out${soFar}.` },
      ] : [{ eyebrow: 'The bottom line', title: `Short by ${money(-f.net)}.`, body: `Expenses ran past income${soFar}.` }]),
    ];
    case 'budget': return [
      { eyebrow: f.isPartial ? 'The plan, so far' : 'The plan meets the receipts', title: f.overCategory ? `${f.overCategory} went off-script.` : 'The plan held its shape.', body: 'Your allocations next to what was spent in them.' },
      ...(f.budgetUsed !== null && f.elapsedShare !== null ? [{ eyebrow: 'Plan versus calendar', title: `${f.budgetUsed}% of the plan, ${f.elapsedShare}% of the days.`, body: 'How the budget kept pace with the period.' }] : []),
      ...(f.remaining !== null && f.remaining > 0 ? [{ eyebrow: 'Still in the plan', title: `${money(f.remaining)} still unspent.`, body: `In budgeted categories${soFar}.` }] : []),
      ...(f.budgetUsed !== null ? [{ eyebrow: 'The plan, by the numbers', title: `${f.budgetUsed}% of the plan used.`, body: f.overCategory ? `${f.overCategory} spent past its allocation.` : 'Every category stayed inside its allocation.' }] : []),
    ];
    case 'categories':
      if (lead === 'top3') return [
        { eyebrow: 'Where it went', title: `Three categories, ${f.top3Share}% of spending.`, body: `${f.top?.label} led the trio.` },
        { eyebrow: 'The big three', title: 'Three categories ran the show.', body: `Together they took ${f.top3Share}% of what went out.` },
      ];
      if (lead === 'count') return [
        { eyebrow: 'Where it went', title: `${f.categoryCount} categories split the bill.`, body: `${f.top?.label} took the biggest slice, at ${f.top?.share}%.` },
        { eyebrow: 'The full spread', title: `Spending touched ${f.categoryCount} categories.`, body: 'Here’s how the slices stacked up.' },
      ];
      return f.top ? [
        { eyebrow: 'Where it went', title: `${f.top.label} led the way.`, body: 'Your expense categories, by share of spending.' },
        { eyebrow: 'Top billing', title: `${f.top.label} took ${f.top.share}%.`, body: 'The rest of the categories, in order of appearance.' },
        { eyebrow: 'And the winner is…', title: `${f.top.label}, by a slice.`, body: `${f.top.share}% of everything that went out.` },
      ] : [];
    case 'calendar':
      if (lead === 'peak' && f.peak) return [
        { eyebrow: 'The period, day by day', title: `${f.peak.label} turned up the volume.`, body: `${money(f.peak.amount)} across ${plural(f.peak.purchaseCount, 'purchase')}. The darker the day, the more went out.` },
        { eyebrow: 'Mark the calendar', title: `${f.peak.weekday} had the spotlight.`, body: `The busiest day: ${f.peak.label}, ${money(f.peak.amount)}.` },
      ];
      return [
        { eyebrow: 'The period, day by day', title: `${f.spendingDays} of ${f.elapsedDays} days had spending.`, body: 'The darker the day, the more went out.' },
        { eyebrow: 'Your calendar, coloured in', title: 'Your period had a beat.', body: `Spending showed up on ${plural(f.spendingDays, 'day')}${soFar}.` },
        ...(f.elapsedDays - f.spendingDays > 0 ? [{ eyebrow: 'Days off', title: `${plural(f.elapsedDays - f.spendingDays, 'day')} without spending.`, body: 'The pale squares. Each one is a day with nothing out.' }] : []),
      ];
    case 'weekdays':
      if (lead === 'weekend') return [
        { eyebrow: 'Your week', title: `Weekends took ${f.weekendShare}%.`, body: 'Saturdays and Sundays, against the rest of the week.' },
        { eyebrow: 'Weekday or weekend?', title: 'The weekend had a say.', body: `${f.weekendShare}% of spending landed on Saturdays and Sundays.` },
      ];
      return [
        { eyebrow: 'Your week', title: `${f.busiestWeekday}s did the heavy lifting.`, body: 'Spending, by day of the week.' },
        { eyebrow: 'The weekly rhythm', title: `Big day of the week: ${f.busiestWeekday}.`, body: 'Each bar adds up every one of that weekday.' },
      ];
    case 'streak':
      if (lead === 'busy') return [
        { eyebrow: 'On a roll', title: `${f.busy} spending days in a row.`, body: 'The longest run of days with something going out.' },
        { eyebrow: 'Streaks', title: `A ${f.busy}-day spending streak.`, body: 'The highlighted run on the strip.' },
      ];
      return [
        { eyebrow: 'Quiet time', title: `${f.quiet} days in a row, no spending.`, body: 'The longest stretch with nothing going out.' },
        { eyebrow: 'Streaks', title: `The longest pause: ${plural(f.quiet, 'day')}.`, body: 'The highlighted run on the strip.' },
      ];
    case 'receipts': return f.receipt ? [
      { eyebrow: 'The standout receipts', title: 'The biggest receipts.', body: `Your ${f.receipt.count} largest purchases this period.` },
      { eyebrow: 'Top of the pile', title: `${f.receipt.label} topped the receipts.`, body: f.largestShare !== null ? `On its own, ${f.largestShare}% of purchase spend.` : 'The largest purchase of the period.' },
      ...(f.topShare !== null ? [{ eyebrow: 'The heavy hitters', title: `${plural(f.receipt.count, 'receipt')}, ${f.topShare}% of the spend.`, body: `Out of ${plural(f.purchaseCount, 'purchase')} in total.` }] : []),
    ] : [];
    case 'habits':
      if (lead === 'typical' && f.median !== null) return [
        { eyebrow: 'How you bought', title: `A typical receipt: ${money(f.median)}.`, body: f.average !== null ? `Half were smaller, half bigger. The average ran to ${money(Math.round(f.average))}.` : 'Half were smaller, half bigger.' },
        { eyebrow: 'The everyday receipt', title: 'Small receipts did the heavy lifting.', body: `The middle receipt came to ${money(f.median)}.` },
      ];
      if (lead === 'perDay') return [
        { eyebrow: 'How you bought', title: `About ${money(f.perDay)} a day.`, body: `Expenses spread over ${plural(f.elapsedDays, 'day')}${soFar}.` },
        { eyebrow: 'The daily rate', title: `${money(f.perDay)}, give or take, per day.`, body: 'What went out, averaged across the period.' },
      ];
      return [
        { eyebrow: 'How you bought', title: `${plural(f.purchaseCount, 'purchase')}, ${plural(f.spendingDays, 'day')}.`, body: 'How often you bought, and what a typical receipt looked like.' },
        ...(f.repeat ? [{ eyebrow: 'Encore', title: `${f.repeat.label} came back ${f.repeat.occurrences} times.`, body: 'Your most repeated purchase this period.' }] : []),
      ];
    case 'comparison': return f.change !== null ? [
      { eyebrow: 'Then and now', title: f.change === 0 ? 'Right where it was.' : `${Math.abs(f.change)}% ${f.change > 0 ? 'higher' : 'lower'} than before.`, body: f.changeMode === 'average' ? 'Average purchase size, against your previous periods.' : 'Total expenses, against the previous period.' },
      { eyebrow: 'Plot twist', title: f.changeMode === 'average' ? `The average receipt got ${f.change > 0 ? 'bigger' : 'smaller'}.` : `The expense total went ${f.change > 0 ? 'up' : 'down'}.`, body: `By ${Math.abs(f.change)}%.` },
    ] : [];
    case 'months': return [
      { eyebrow: 'Month by month', title: f.busiestMonth ? `${f.busiestMonth} was the big one.` : 'The year, month by month.', body: 'Spending in each month of the year.' },
      { eyebrow: 'The year’s rhythm', title: 'Twelve months, one beat.', body: f.busiestMonth ? `${f.busiestMonth} spent the most.` : 'Each bar is a month of spending.' },
    ];
    case 'mixtape': return [
      { eyebrow: 'Side A', title: 'Your period, as a mixtape.', body: 'Each category gets airtime by its share of spending.' },
      { eyebrow: 'Now playing', title: f.top ? `Now playing: ${f.top.label}.` : 'Now playing: your receipts.', body: 'Thirty minutes, timed by where the money went.' },
      { eyebrow: 'The B-sides', title: 'Press play on your receipts.', body: 'Track lengths follow each category’s share of spending.' },
    ];
    case 'persona': return [
      { eyebrow: 'Your money personality', title: 'Meet your money personality.', body: 'Read from when and how you spent. Nothing more.' },
      { eyebrow: 'The verdict is in', title: 'Who were you this period?', body: 'A personality built from your patterns, not your choices.' },
      { eyebrow: 'Drumroll, please', title: 'This period, you were…', body: 'Based on the rhythm of your receipts.' },
    ];
    case 'closing': return [
      { eyebrow: 'The period, in one card', title: 'Same you. Fresh chapter.', body: 'What gets a little more room next period?' },
      { eyebrow: 'That’s a wrap', title: `That’s a wrap on ${f.period}.`, body: 'Share the card, or take one more look at the budget.' },
      { eyebrow: 'Roll credits', title: 'Keep the plot. Turn the page.', body: 'The next period starts with a blank budget.' },
      { eyebrow: 'Until next time', title: 'See you next period.', body: 'Same time, new receipts.' },
    ];
  }
}
