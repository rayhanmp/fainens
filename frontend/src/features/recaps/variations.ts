import { formatRecapCurrency as money } from './currency';
import { formatRecapDay } from './dates';
import type { Bonus, RecapStoryId } from './stories';

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
      { eyebrow: 'Now showing', title: `${f.period}: the director’s cut.`, body: 'Every scene taken straight from your ledger.' },
      { eyebrow: 'Breaking news', title: 'This just in: your period.', body: `${plural(f.purchaseCount, 'receipt')} filed. Full report to follow.` },
      { eyebrow: 'Loading memories', title: 'Remember this one?', body: `${f.period}, retold in ${plural(f.spendingDays, 'day')} of spending.` },
      { eyebrow: 'Hot off the press', title: `The ${f.period} issue.`, body: f.top ? `Cover story: ${f.top.label}.` : 'Every page from your own receipts.' },
      { eyebrow: 'Tap to begin', title: 'Your money had a story.', body: 'Here’s how it went, chapter by chapter.' },
      { eyebrow: 'Season finale', title: `Last time, on ${f.period}…`, body: `${plural(f.purchaseCount, 'purchase')} and a few surprises.` },
      { eyebrow: 'Unboxing', title: 'Let’s open this period up.', body: `What’s inside: ${plural(f.purchaseCount, 'receipt')}, ${plural(f.spendingDays, 'day')}.` },
    ];
    case 'overview': return lead === 'ratio' && f.spentPer100 !== null ? [
      { eyebrow: 'Money in, money out', title: `Every Rp100 in, Rp${f.spentPer100} out.`, body: f.keptShare !== null ? `The other ${f.keptShare}% was left after expenses.` : 'Expenses went past what came in.' },
      { eyebrow: 'The exchange rate', title: `${f.spentPer100}% of income went to expenses.`, body: `${money(f.expenses)} out of ${money(f.income)} in${soFar}.` },
      { eyebrow: 'Quick maths', title: `Rp100 came in. Rp${f.spentPer100} went out.`, body: 'Repeat that across the whole period.' },
      { eyebrow: 'The ratio', title: `${f.spentPer100} out of every 100.`, body: `That’s how much of income became expenses${soFar}.` },
      ...(f.keptShare !== null ? [{ eyebrow: 'The split', title: `${f.spentPer100} spent, ${f.keptShare} kept.`, body: 'Out of every Rp100 that came in.' }] : []),
    ] : [
      { eyebrow: 'Money in, money out', title: f.net >= 0 ? 'More came in than went out.' : 'Expenses overtook income.', body: `${money(f.income)} in, ${money(f.expenses)} out${soFar}.` },
      { eyebrow: 'The scoreboard', title: f.net >= 0 ? 'Income takes the lead.' : 'Expenses take the lead.', body: `In: ${money(f.income)}. Out: ${money(f.expenses)}.` },
      { eyebrow: 'Head to head', title: 'In versus out.', body: `${money(f.income)} against ${money(f.expenses)}${soFar}.` },
      ...(f.net >= 0 ? [
        { eyebrow: 'The bottom line', title: `${money(f.net)} left over.`, body: f.keptShare !== null ? `That’s ${f.keptShare}% of what came in, after expenses.` : 'Income minus expenses, as recorded.' },
        { eyebrow: 'After the receipts', title: 'Income won this round.', body: `${money(f.net)} more came in than went out${soFar}.` },
        { eyebrow: 'What’s left', title: `${money(f.net)} still standing.`, body: 'Income minus every expense recorded.' },
        { eyebrow: 'The difference', title: `A ${money(f.net)} gap, in your favour.`, body: `Between ${money(f.income)} in and ${money(f.expenses)} out.` },
        ...(f.keptShare !== null ? [{ eyebrow: 'Kept', title: `${f.keptShare}% made it through.`, body: 'The share of income left after expenses.' }] : []),
      ] : [
        { eyebrow: 'The bottom line', title: `Short by ${money(-f.net)}.`, body: `Expenses ran past income${soFar}.` },
        { eyebrow: 'The difference', title: `${money(-f.net)} past income.`, body: `${money(f.expenses)} out against ${money(f.income)} in.` },
        { eyebrow: 'Over the line', title: 'Out outran in.', body: `By ${money(-f.net)}${soFar}.` },
      ]),
    ];
    case 'budget': return [
      { eyebrow: f.isPartial ? 'The plan, so far' : 'The plan meets the receipts', title: f.overCategory ? `${f.overCategory} went off-script.` : 'The plan held its shape.', body: 'Your allocations next to what was spent in them.' },
      { eyebrow: 'Script versus scene', title: f.overCategory ? `${f.overCategory} improvised.` : 'Everyone stuck to the script.', body: 'Each category against the amount set aside for it.' },
      { eyebrow: 'Inside the lines', title: f.overCategory ? `${f.overCategory} coloured outside the lines.` : 'Every category stayed inside the lines.', body: 'The plan, category by category.' },
      ...(f.budgetUsed !== null && f.elapsedShare !== null ? [
        { eyebrow: 'Plan versus calendar', title: `${f.budgetUsed}% of the plan, ${f.elapsedShare}% of the days.`, body: 'How the budget kept pace with the period.' },
        { eyebrow: 'The race', title: `Budget: ${f.budgetUsed}%. Calendar: ${f.elapsedShare}%.`, body: 'Two progress bars, side by side.' },
      ] : []),
      ...(f.remaining !== null && f.remaining > 0 ? [
        { eyebrow: 'Still in the plan', title: `${money(f.remaining)} still unspent.`, body: `In budgeted categories${soFar}.` },
        { eyebrow: 'Left in the envelopes', title: `${money(f.remaining)} untouched.`, body: 'What the budgeted categories haven’t used.' },
      ] : []),
      ...(f.budgetUsed !== null ? [
        { eyebrow: 'The plan, by the numbers', title: `${f.budgetUsed}% of the plan used.`, body: f.overCategory ? `${f.overCategory} spent past its allocation.` : 'Every category stayed inside its allocation.' },
        { eyebrow: 'Fuel gauge', title: `The plan reads ${f.budgetUsed}%.`, body: 'Budgeted spending against the allocations.' },
      ] : []),
    ];
    case 'categories':
      if (lead === 'top3') return [
        { eyebrow: 'Where it went', title: `Three categories, ${f.top3Share}% of spending.`, body: `${f.top?.label} led the trio.` },
        { eyebrow: 'The big three', title: 'Three categories ran the show.', body: `Together they took ${f.top3Share}% of what went out.` },
        { eyebrow: 'Podium finish', title: `Gold, silver, bronze: ${f.top3Share}%.`, body: `${f.top?.label} on the top step.` },
        { eyebrow: 'The trio', title: `${f.top3Share}% in three names.`, body: 'Everything else shared what was left.' },
        { eyebrow: 'Top of the charts', title: 'A three-way headline.', body: `${f.top?.label} and two others: ${f.top3Share}% of spending.` },
      ];
      if (lead === 'count') return [
        { eyebrow: 'Where it went', title: `${f.categoryCount} categories split the bill.`, body: `${f.top?.label} took the biggest slice, at ${f.top?.share}%.` },
        { eyebrow: 'The full spread', title: `Spending touched ${f.categoryCount} categories.`, body: 'Here’s how the slices stacked up.' },
        { eyebrow: 'Roll call', title: `${f.categoryCount} categories answered.`, body: `${f.top?.label} answered loudest, at ${f.top?.share}%.` },
        { eyebrow: 'The guest list', title: `${f.categoryCount} categories on the list.`, body: 'Sized by their share of spending.' },
      ];
      return f.top ? [
        { eyebrow: 'Where it went', title: `${f.top.label} led the way.`, body: 'Your expense categories, by share of spending.' },
        { eyebrow: 'Top billing', title: `${f.top.label} took ${f.top.share}%.`, body: 'The rest of the categories, in order of appearance.' },
        { eyebrow: 'And the winner is…', title: `${f.top.label}, by a slice.`, body: `${f.top.share}% of everything that went out.` },
        { eyebrow: 'Main character', title: `${f.top.label} had the most lines.`, body: `${f.top.share}% of the spending script.` },
        { eyebrow: 'Number one', title: `${f.top.label} tops the chart.`, body: 'Every category, ranked by share of spending.' },
        { eyebrow: 'Biggest slice', title: `${f.top.label} cut ${f.top.share}% of the pie.`, body: 'The rest split what was left.' },
        { eyebrow: 'The headliner', title: `Headlining: ${f.top.label}.`, body: `With ${f.top.share}% of spending on stage.` },
      ] : [];
    case 'calendar':
      if (lead === 'peak' && f.peak) return [
        { eyebrow: 'The period, day by day', title: `${f.peak.label} turned up the volume.`, body: `${money(f.peak.amount)} across ${plural(f.peak.purchaseCount, 'purchase')}. The darker the day, the more went out.` },
        { eyebrow: 'Mark the calendar', title: `${f.peak.weekday} had the spotlight.`, body: `The busiest day: ${f.peak.label}, ${money(f.peak.amount)}.` },
        { eyebrow: 'Save the date', title: `${f.peak.label}. Remember it?`, body: `${plural(f.peak.purchaseCount, 'purchase')}, ${money(f.peak.amount)} in one day.` },
        { eyebrow: 'Peak day', title: `${f.peak.label} hit the high note.`, body: `${money(f.peak.amount)} went out that day.` },
        { eyebrow: 'Circled in red', title: `One date stood out: ${f.peak.label}.`, body: 'The darkest square on the calendar.' },
      ];
      return [
        { eyebrow: 'The period, day by day', title: `${f.spendingDays} of ${f.elapsedDays} days had spending.`, body: 'The darker the day, the more went out.' },
        { eyebrow: 'Your calendar, coloured in', title: 'Your period had a beat.', body: `Spending showed up on ${plural(f.spendingDays, 'day')}${soFar}.` },
        { eyebrow: 'Heat map', title: `${plural(f.spendingDays, 'warm day')}.`, body: `Out of ${f.elapsedDays}. The darker, the more went out.` },
        { eyebrow: 'Every square counts', title: 'One square, one day.', body: `${f.spendingDays} of them saw spending${soFar}.` },
        ...(f.elapsedDays - f.spendingDays > 0 ? [
          { eyebrow: 'Days off', title: `${plural(f.elapsedDays - f.spendingDays, 'day')} without spending.`, body: 'The pale squares. Each one is a day with nothing out.' },
          { eyebrow: 'Blank squares', title: `${plural(f.elapsedDays - f.spendingDays, 'day')} stayed blank.`, body: 'No receipts on those dates.' },
        ] : []),
      ];
    case 'weekdays':
      if (lead === 'weekend') return [
        { eyebrow: 'Your week', title: `Weekends took ${f.weekendShare}%.`, body: 'Saturdays and Sundays, against the rest of the week.' },
        { eyebrow: 'Weekday or weekend?', title: 'The weekend had a say.', body: `${f.weekendShare}% of spending landed on Saturdays and Sundays.` },
        { eyebrow: 'Two days, one share', title: `Saturday plus Sunday: ${f.weekendShare}%.`, body: 'Of everything that went out.' },
        { eyebrow: 'Weekend edition', title: `${f.weekendShare}% happened on the weekend.`, body: 'Each bar adds up one day of the week.' },
      ];
      return [
        { eyebrow: 'Your week', title: `${f.busiestWeekday}s did the heavy lifting.`, body: 'Spending, by day of the week.' },
        { eyebrow: 'The weekly rhythm', title: `Big day of the week: ${f.busiestWeekday}.`, body: 'Each bar adds up every one of that weekday.' },
        { eyebrow: 'Day of the week', title: `${f.busiestWeekday} wins the week.`, body: 'Seven bars, one tallest.' },
        { eyebrow: 'Weekly chart', title: `${f.busiestWeekday}s ran the tallest.`, body: 'All spending, folded into one week.' },
        { eyebrow: 'Seven days', title: `Most money moved on ${f.busiestWeekday}s.`, body: 'Each bar sums one weekday across the period.' },
      ];
    case 'streak':
      if (lead === 'busy') return [
        { eyebrow: 'On a roll', title: `${f.busy} spending days in a row.`, body: 'The longest run of days with something going out.' },
        { eyebrow: 'Streaks', title: `A ${f.busy}-day spending streak.`, body: 'The highlighted run on the strip.' },
        { eyebrow: 'Combo', title: `${f.busy}× combo.`, body: 'Consecutive days with at least one receipt.' },
        { eyebrow: 'Unbroken', title: `${plural(f.busy, 'day')}, no gaps.`, body: 'The longest chain of spending days.' },
      ];
      return [
        { eyebrow: 'Quiet time', title: `${f.quiet} days in a row, no spending.`, body: 'The longest stretch with nothing going out.' },
        { eyebrow: 'Streaks', title: `The longest pause: ${plural(f.quiet, 'day')}.`, body: 'The highlighted run on the strip.' },
        { eyebrow: 'Radio silence', title: `${plural(f.quiet, 'day')} of silence.`, body: 'Not a single receipt in that stretch.' },
        { eyebrow: 'Pause button', title: `Paused for ${plural(f.quiet, 'day')}.`, body: 'The longest run with nothing going out.' },
      ];
    case 'receipts': return f.receipt ? [
      { eyebrow: 'The standout receipts', title: 'The biggest receipts.', body: `Your ${f.receipt.count} largest purchases this period.` },
      { eyebrow: 'Top of the pile', title: `${f.receipt.label} topped the receipts.`, body: f.largestShare !== null ? `On its own, ${f.largestShare}% of purchase spend.` : 'The largest purchase of the period.' },
      { eyebrow: 'Hall of fame', title: `${f.receipt.label}, in the top spot.`, body: `${money(f.receipt.amount)} on one receipt.` },
      { eyebrow: 'The long ones', title: 'The receipts that needed scrolling.', body: `The ${f.receipt.count} biggest of the period.` },
      { eyebrow: 'Heavyweight', title: `${money(f.receipt.amount)}: the heaviest receipt.`, body: `${f.receipt.label}, at the top of the pile.` },
      { eyebrow: 'Price tags', title: 'The biggest price tags.', body: `Your top ${f.receipt.count}, largest first.` },
      ...(f.topShare !== null ? [
        { eyebrow: 'The heavy hitters', title: `${plural(f.receipt.count, 'receipt')}, ${f.topShare}% of the spend.`, body: `Out of ${plural(f.purchaseCount, 'purchase')} in total.` },
        ...(f.purchaseCount > f.receipt.count ? [{ eyebrow: 'A few big ones', title: `${plural(f.receipt.count, 'receipt')} carried ${f.topShare}%.`, body: `The other ${f.purchaseCount - f.receipt.count} shared the rest.` }] : []),
      ] : []),
    ] : [];
    case 'habits':
      if (lead === 'typical' && f.median !== null) return [
        { eyebrow: 'How you bought', title: `A typical receipt: ${money(f.median)}.`, body: f.average !== null ? `Half were smaller, half bigger. The average ran to ${money(Math.round(f.average))}.` : 'Half were smaller, half bigger.' },
        { eyebrow: 'The everyday receipt', title: 'Small receipts did the heavy lifting.', body: `The middle receipt came to ${money(f.median)}.` },
        { eyebrow: 'Right in the middle', title: `${money(f.median)}, dead centre.`, body: 'Half your receipts came in under it.' },
        { eyebrow: 'Median energy', title: `The median receipt: ${money(f.median)}.`, body: `Across ${plural(f.purchaseCount, 'purchase')}.` },
      ];
      if (lead === 'perDay') return [
        { eyebrow: 'How you bought', title: `About ${money(f.perDay)} a day.`, body: `Expenses spread over ${plural(f.elapsedDays, 'day')}${soFar}.` },
        { eyebrow: 'The daily rate', title: `${money(f.perDay)}, give or take, per day.`, body: 'What went out, averaged across the period.' },
        { eyebrow: 'Per diem', title: `${money(f.perDay)} a day, on average.`, body: 'Every expense, spread evenly over the calendar.' },
        { eyebrow: 'Daily meter', title: `The meter ran ${money(f.perDay)} a day.`, body: `Over ${plural(f.elapsedDays, 'day')}${soFar}.` },
      ];
      return [
        { eyebrow: 'How you bought', title: `${plural(f.purchaseCount, 'purchase')}, ${plural(f.spendingDays, 'day')}.`, body: 'How often you bought, and what a typical receipt looked like.' },
        { eyebrow: 'Checkout count', title: `${plural(f.purchaseCount, 'checkout')}.`, body: `Spread over ${plural(f.spendingDays, 'spending day')}.` },
        ...(f.repeat ? [
          { eyebrow: 'Encore', title: `${f.repeat.label} came back ${f.repeat.occurrences} times.`, body: 'Your most repeated purchase this period.' },
          { eyebrow: 'On repeat', title: `${f.repeat.label}, ×${f.repeat.occurrences}.`, body: 'The purchase that showed up most often.' },
          { eyebrow: 'Familiar face', title: `${f.repeat.label} again. And again.`, body: `${f.repeat.occurrences} times this period.` },
        ] : []),
      ];
    case 'comparison': return f.change !== null ? [
      { eyebrow: 'Then and now', title: f.change === 0 ? 'Right where it was.' : `${Math.abs(f.change)}% ${f.change > 0 ? 'higher' : 'lower'} than before.`, body: f.changeMode === 'average' ? 'Average purchase size, against your previous periods.' : 'Total expenses, against the previous period.' },
      { eyebrow: 'Plot twist', title: f.changeMode === 'average' ? `The average receipt got ${f.change > 0 ? 'bigger' : 'smaller'}.` : `The expense total went ${f.change > 0 ? 'up' : 'down'}.`, body: `By ${Math.abs(f.change)}%.` },
      { eyebrow: 'Before and after', title: f.change === 0 ? 'No change. None.' : `${f.change > 0 ? 'Up' : 'Down'} ${Math.abs(f.change)}%.`, body: f.changeMode === 'average' ? 'The average receipt, compared with earlier periods.' : 'Total expenses, compared with last period.' },
      { eyebrow: 'The sequel', title: f.change === 0 ? 'Same as the original.' : `The sequel ran ${Math.abs(f.change)}% ${f.change > 0 ? 'bigger' : 'smaller'}.`, body: f.changeMode === 'average' ? 'Measured by average purchase size.' : 'Measured by total expenses.' },
      { eyebrow: 'Side by side', title: 'This period, meet the last.', body: `${f.changeMode === 'average' ? 'Average receipt' : 'Total expenses'}: ${f.change > 0 ? '+' : f.change < 0 ? '−' : '±'}${Math.abs(f.change)}%.` },
    ] : [];
    case 'months': return [
      { eyebrow: 'Month by month', title: f.busiestMonth ? `${f.busiestMonth} was the big one.` : 'The year, month by month.', body: 'Spending in each month of the year.' },
      { eyebrow: 'The year’s rhythm', title: 'Twelve months, one beat.', body: f.busiestMonth ? `${f.busiestMonth} spent the most.` : 'Each bar is a month of spending.' },
      { eyebrow: 'Monthly chart', title: f.busiestMonth ? `${f.busiestMonth} topped the chart.` : 'Every month, ranked.', body: 'One bar for each month.' },
      { eyebrow: 'Calendar year', title: 'A year in twelve bars.', body: f.busiestMonth ? `The tallest one: ${f.busiestMonth}.` : 'Spending by month.' },
    ];
    case 'interlude':
      if (lead === 'orbit') return [
        { eyebrow: `Planet ${f.top?.label ?? 'You'}`, title: `Everything orbits ${f.top?.label ?? 'you'}.`, body: 'Your categories, circling the biggest one.' },
        { eyebrow: 'Solar system', title: `${f.top?.label ?? 'One category'} is the sun.`, body: 'The rest just orbit.' },
        { eyebrow: 'Gravity', title: `${f.top?.label ?? 'The top category'} pulls hardest.`, body: 'Bigger share, stronger pull.' },
      ];
      if (lead === 'tunnel') return [
        { eyebrow: 'Warp speed', title: `${plural(f.purchaseCount, 'receipt')}, one tunnel.`, body: 'Hold on to your receipts.' },
        { eyebrow: 'Hyperdrive', title: 'Punch it.', body: `${plural(f.purchaseCount, 'purchase')} at light speed.` },
        { eyebrow: 'Wormhole', title: 'Skipping ahead.', body: 'Through the receipts, out the other side.' },
        { eyebrow: 'Fast forward', title: 'Zoom.', body: `The whole period in a blur of ${plural(f.purchaseCount, 'receipt')}.` },
      ];
      if (lead === 'liquid') return f.keptShare !== null
        ? [
          { eyebrow: 'Fill it up', title: `${f.keptShare}% left in the glass.`, body: 'Income left after expenses, poured out.' },
          { eyebrow: 'Half full?', title: `The glass reads ${f.keptShare}%.`, body: 'What income had left after expenses.' },
        ]
        : [
          { eyebrow: 'Fill it up', title: `${f.budgetUsed}% of the plan, poured.`, body: 'The budget, by the glass.' },
          { eyebrow: 'Pour it out', title: `${f.budgetUsed}% to the line.`, body: 'The plan, as a glass.' },
        ];
      if (lead === 'rain') return [
        { eyebrow: 'Today’s forecast', title: `Cloudy with a chance of ${f.purchaseCount} receipts.`, body: 'Every slip of the period, coming down.' },
        { eyebrow: 'It’s raining', title: 'It’s raining receipts.', body: `${plural(f.purchaseCount, 'receipt')}, in one downpour.` },
        { eyebrow: 'Weather report', title: `${plural(f.purchaseCount, 'receipt')} of rainfall.`, body: 'Bring an umbrella.' },
        { eyebrow: 'Downpour', title: 'Here they come.', body: `All ${plural(f.purchaseCount, 'slip')}, at once.` },
      ];
      if (lead === 'ejected') return [
        { eyebrow: 'Emergency meeting', title: 'Who was The Big Spender?', body: 'Every category is a suspect.' },
        { eyebrow: 'Emergency meeting', title: 'There is a big spender among us.', body: 'Vote them out, one category at a time.' },
        { eyebrow: 'Body reported', title: 'Someone emptied the wallet.', body: 'Time to find out who.' },
        { eyebrow: 'Voting time', title: 'Who’s acting sus?', body: 'Your categories, under suspicion.' },
        { eyebrow: 'Emergency meeting', title: 'Where were you on payday?', body: 'Every category gets a vote.' },
      ];
      if (lead === 'kaleido') return [
        { eyebrow: 'A little trip', title: `${f.period}, through the looking glass.`, body: 'Just a pause. Nothing to read here.' },
        { eyebrow: 'Breathe', title: 'Breathe in. Breathe out.', body: 'More numbers in a moment.' },
        { eyebrow: 'Screensaver', title: 'Nothing to see. Just vibes.', body: 'The receipts will be right back.' },
        { eyebrow: 'Brain break', title: 'Pretty colours, no numbers.', body: 'Back to it in a second.' },
      ];
      return [
        { eyebrow: 'Intermission', title: 'Grab a snack.', body: 'The second half starts in a moment.' },
        { eyebrow: 'Intermission', title: 'Stretch break.', body: 'Back to the receipts in a sec.' },
        { eyebrow: 'Halftime', title: 'Halftime show.', body: 'The receipts are warming up again.' },
        { eyebrow: 'Ad break', title: 'We’ll be right back.', body: 'Don’t touch that dial.' },
      ];
    case 'mixtape': return [
      { eyebrow: 'Side A', title: 'Your period, as a mixtape.', body: 'Each category gets airtime by its share of spending.' },
      { eyebrow: 'Now playing', title: f.top ? `Now playing: ${f.top.label}.` : 'Now playing: your receipts.', body: 'Thirty minutes, timed by where the money went.' },
      { eyebrow: 'The B-sides', title: 'Press play on your receipts.', body: 'Track lengths follow each category’s share of spending.' },
      { eyebrow: 'On rotation', title: f.top ? `${f.top.label} on heavy rotation.` : 'Your receipts, on rotation.', body: 'Longest track, biggest share.' },
      { eyebrow: 'Greatest hits', title: `${f.period}: greatest hits.`, body: 'Every track timed by its share of spending.' },
      { eyebrow: 'Track list', title: 'Rewind. Play. Repeat.', body: 'A side of tape, split by where the money went.' },
    ];
    case 'persona': {
      // Each persona speaks in its own voice; the plain introductions stay in the mix.
      const voices: Record<string, Copy[]> = {
        weekend: [
          { eyebrow: 'Party mode: on', title: 'The weekend called. You answered.', body: 'Saturdays and Sundays set the tempo.' },
          { eyebrow: 'Clubbing, financially', title: 'Weekdays rest. Weekends rave.', body: 'Your receipts came alive on the weekend.' },
          { eyebrow: 'TGIF', title: 'Friday night, then the weekend.', body: 'The receipts know what day it is.' },
          { eyebrow: 'Weekend warrior', title: 'Two days. All the action.', body: 'Saturdays and Sundays did the most.' },
        ],
        bigTicket: [
          { eyebrow: 'Big spender energy', title: 'Go big or go home.', body: 'A few receipts did most of the talking.' },
          { eyebrow: 'Luxury edition', title: 'Rare finds, big tickets.', body: 'Small receipts, then the occasional showstopper.' },
          { eyebrow: 'Main event', title: 'Fewer receipts, bigger moments.', body: 'A handful carried the period.' },
          { eyebrow: 'High roller', title: 'When it’s big, it’s big.', body: 'The top receipts took a large share.' },
        ],
        steady: [
          { eyebrow: 'Slow and steady', title: 'A little, every day.', body: 'Spending showed up most days, in small sips.' },
          { eyebrow: 'Daily ritual', title: 'Same time tomorrow?', body: 'A steady drip of everyday receipts.' },
          { eyebrow: 'Like clockwork', title: 'Tick, tock, receipt.', body: 'Spending on most days of the period.' },
          { eyebrow: 'Metronome', title: 'Keeping perfect time.', body: 'A small receipt here, another there.' },
        ],
        monk: [
          { eyebrow: 'Enlightenment reached', title: 'Shhh. The wallet is meditating.', body: 'Long, quiet stretches with nothing going out.' },
          { eyebrow: 'Inner peace', title: 'Breathe in. Spend nothing.', body: 'The calm between the receipts.' },
          { eyebrow: 'Vow of silence', title: 'The wallet took a vow.', body: 'Whole stretches without a receipt.' },
          { eyebrow: 'Zen garden', title: 'Raked sand. No receipts.', body: 'Quiet days, and plenty of them.' },
        ],
        loyal: [
          { eyebrow: 'Member since forever', title: 'Same again, please.', body: 'One favourite kept coming back.' },
          { eyebrow: 'Loyalty card: full', title: 'You know what you like.', body: 'A regular, through and through.' },
          { eyebrow: 'The usual', title: '“The usual?” “The usual.”', body: 'One purchase, on repeat.' },
          { eyebrow: 'Regular', title: 'They know your order.', body: 'The same receipt, again and again.' },
        ],
        devotee: [
          { eyebrow: 'All hail', title: 'One category to rule them all.', body: 'A single category wore the crown.' },
          { eyebrow: 'Long live the king', title: 'Crowned by your receipts.', body: 'One category, all the attention.' },
          { eyebrow: 'Fan club', title: 'President of one fan club.', body: 'A single category took the spotlight.' },
          { eyebrow: 'Ride or die', title: 'One category. Total devotion.', body: 'The rest barely got a look in.' },
        ],
        explorer: [
          { eyebrow: 'Off the map', title: 'You went everywhere.', body: 'Spending wandered into every corner.' },
          { eyebrow: 'Passport stamped', title: 'Here, there, everywhere.', body: 'So many categories, one period.' },
          { eyebrow: 'Side quests', title: 'Every side quest, accepted.', body: 'Spending reached category after category.' },
          { eyebrow: 'Grand tour', title: 'A world tour of categories.', body: 'Barely a corner left unvisited.' },
        ],
        allRounder: [
          { eyebrow: 'Jack of all trades', title: 'A bit of everything.', body: 'No single habit ran the show.' },
          { eyebrow: 'Perfectly balanced', title: 'Juggling it all.', body: 'Your receipts kept every ball in the air.' },
          { eyebrow: 'Swiss army', title: 'A tool for every job.', body: 'No category hogged the stage.' },
          { eyebrow: 'Ensemble cast', title: 'No lead role. All supporting.', body: 'Spending shared out across the board.' },
        ],
      };
      return [...(lead && voices[lead] ? voices[lead] : []),
        { eyebrow: 'Drumroll, please', title: 'This period, you were…', body: 'Based on the rhythm of your receipts.' },
        { eyebrow: 'The verdict', title: 'Your money personality is in.', body: 'Read straight from your receipts.' }];
    }
    // Bonus slides write their own copy from the figures that earned them; see bonusCopy.
    case 'bonus': return [];
    case 'closing': return [
      { eyebrow: 'The period, in one card', title: 'Same you. Fresh chapter.', body: 'What gets a little more room next period?' },
      { eyebrow: 'That’s a wrap', title: `That’s a wrap on ${f.period}.`, body: 'Share the card, or take one more look at the budget.' },
      { eyebrow: 'Roll credits', title: 'Keep the plot. Turn the page.', body: 'The next period starts with a blank budget.' },
      { eyebrow: 'Until next time', title: 'See you next period.', body: 'Same time, new receipts.' },
      { eyebrow: 'Fin', title: 'The end. For now.', body: 'A new period is already writing itself.' },
      { eyebrow: 'Game saved', title: 'Progress saved.', body: `${f.period}, complete. Next level loading.` },
      { eyebrow: 'Mic drop', title: `${f.period}, signing off.`, body: 'Share the card before the next one starts.' },
      { eyebrow: 'Post-credits scene', title: 'Stick around.', body: 'The next period has its own story to tell.' },
      { eyebrow: 'Closing time', title: 'Lights on. Tabs closed.', body: `${plural(f.purchaseCount, 'receipt')}, all accounted for.` },
    ];
  }
}

/** Copy for the bonus slides, each written from the figures that earned it. */
export function bonusCopy(b: Bonus, f: CopyFacts): Copy[] {
  const day = (ms: number) => formatRecapDay(ms, { weekday: 'short', day: 'numeric', month: 'short' });
  switch (b.kind) {
    case 'payday': return [
      { eyebrow: 'Bonus: payday rush', title: `${b.share}% went in the first three days.`, body: `${money(b.amount)} out of the gate, then the pace settled.` },
      { eyebrow: 'Bonus: off the blocks', title: 'Payday, then a sprint.', body: `Days one to three took ${b.share}% of the period’s spending.` },
      { eyebrow: 'Bonus: day one energy', title: `Three days, ${b.share}% of the spend.`, body: `${money(b.amount)} before the period had warmed up.` },
      { eyebrow: 'Bonus: fresh salary', title: 'The salary landed. So did the receipts.', body: `The first three days: ${money(b.amount)}, ${b.share}% of the total.` },
    ];
    case 'boss': return [
      { eyebrow: 'Bonus: boss fight', title: `${b.label} dealt ${b.share}% damage.`, body: `One receipt, ${money(b.amount)}, on ${day(b.date)}.` },
      { eyebrow: 'Bonus: critical hit', title: `One hit: ${b.share}%.`, body: `${b.label} took ${b.share}% of purchase spending on its own.` },
      { eyebrow: 'Bonus: final boss', title: `A wild ${b.label} appeared.`, body: `${money(b.amount)} in one go. ${b.share}% of the period’s purchases.` },
      { eyebrow: 'Bonus: one-hit wonder', title: `${b.label}, the heavyweight.`, body: `A single receipt carried ${b.share}% of purchase spend.` },
    ];
    case 'suspects': {
      const [a, c] = b.items;
      return [
        { eyebrow: 'Bonus: the usual suspects', title: `${a.label} and ${c.label}.`, body: `${a.occurrences} and ${c.occurrences} visits. Same faces, again and again.` },
        { eyebrow: 'Bonus: lineup', title: 'Two regulars, one lineup.', body: `${a.label} ×${a.occurrences}, ${c.label} ×${c.occurrences}.` },
        { eyebrow: 'Bonus: repeat offenders', title: `${a.occurrences + c.occurrences} visits between them.`, body: `${a.label} and ${c.label} kept turning up.` },
        { eyebrow: 'Bonus: rivalry', title: `${a.label} vs ${c.label}.`, body: `${a.occurrences} to ${c.occurrences}. Both kept coming back.` },
      ];
    }
    case 'milestone': return [
      { eyebrow: 'Bonus: milestone', title: `Receipt #${b.count} landed on ${day(b.date)}.`, body: `Day ${b.dayIndex + 1} of ${b.totalDays}. ${f.purchaseCount} receipts in all.` },
      { eyebrow: 'Bonus: level up', title: `${b.count} receipts reached.`, body: `The ${b.count}th came on ${day(b.date)}.` },
      { eyebrow: 'Bonus: round number', title: `#${b.count}. Ding.`, body: `It arrived on day ${b.dayIndex + 1}, ${day(b.date)}.` },
      { eyebrow: 'Bonus: counting up', title: `Receipt number ${b.count}.`, body: `Logged on ${day(b.date)}, and the count kept going to ${f.purchaseCount}.` },
    ];
    case 'takeover': return [
      { eyebrow: 'Bonus: hostile takeover', title: `${b.label} holds the majority.`, body: `${b.share}% of the seats. Every other category shares the rest.` },
      { eyebrow: 'Bonus: landslide', title: `${b.label} wins in a landslide.`, body: `${b.share}% of the vote, as counted by your receipts.` },
      { eyebrow: 'Bonus: majority rule', title: `More than half: ${b.label}.`, body: `${b.share}% of spending sat in one category.` },
      { eyebrow: 'Bonus: the chamber', title: `${b.share} seats out of 100.`, body: `${b.label} controls the house.` },
    ];
    case 'comeback': {
      const was = b.previousRank ? `#${b.previousRank} in ${b.previousPeriod}` : `off the chart in ${b.previousPeriod}`;
      return [
        { eyebrow: 'Bonus: comeback', title: `${b.label} is back.`, body: `Was ${was}. Now #${b.rank}, with ${b.share}% of spending.` },
        { eyebrow: 'Bonus: the return', title: `Look who’s back: ${b.label}.`, body: `From ${was} to #${b.rank} this period.` },
        { eyebrow: 'Bonus: climber', title: `${b.label} climbed to #${b.rank}.`, body: `Last time it was ${was}.` },
        { eyebrow: 'Bonus: sequel', title: `${b.label} returns.`, body: `${b.share}% of spending this time. Last time: ${b.previousRank ? `#${b.previousRank}` : 'nowhere near the top'}.` },
      ];
    }
  }
}

/**
 * Eyebrows that fit a chapter whatever it leads with. A run may swap one in over the eyebrow of the
 * picked copy, so the same headline turns up under different labels.
 */
export function chapterEyebrows(id: RecapStoryId): string[] {
  switch (id) {
    case 'overview': return ['Money in, money out', 'The balance sheet', 'Cash flow', 'In and out', 'The big picture', 'Bottom line'];
    case 'budget': return ['The plan', 'Budget check', 'Plan versus reality', 'The allocations', 'Budget report'];
    case 'categories': return ['Where it went', 'Category breakdown', 'The line-up', 'Slices', 'Who took what'];
    case 'calendar': return ['Day by day', 'The calendar', 'Heat map', 'Every day, coloured in'];
    case 'weekdays': return ['Your week', 'The weekly rhythm', 'Seven days', 'Day of the week'];
    case 'streak': return ['Streaks', 'In a row', 'The strip', 'Runs'];
    case 'receipts': return ['The standout receipts', 'Big ones', 'Top receipts', 'Hall of fame', 'The heavy hitters'];
    case 'habits': return ['How you bought', 'Habits', 'Shopping style', 'The routine', 'Checkout stats'];
    case 'comparison': return ['Then and now', 'Compared', 'Versus last time', 'The trend'];
    case 'months': return ['Month by month', 'The year', 'Monthly'];
    case 'mixtape': return ['Side A', 'Now playing', 'The playlist', 'Mixtape'];
    default: return [];
  }
}
