import { formatRecapCurrency as money } from './currency';
import { BANKS, categoryFlavour, DAY_BANKS, dayFlavour, type CategoryFlavour, type Flavour } from './flavour';
import type { Bonus, RecapStoryId, YearInsight } from './stories';

export type CopyFacts = {
  period: string; isPartial: boolean; net: number; income: number; expenses: number; keptShare: number | null; spentPer100: number | null;
  budgetUsed: number | null; elapsedShare: number | null; remaining: number | null; overCategory: string | null;
  top: { label: string; share: number; flavour: CategoryFlavour | null } | null; top3Share: number; categoryCount: number;
  spendingDays: number; elapsedDays: number; peak: { label: string; weekday: string; amount: number; purchaseCount: number } | null;
  busiestWeekday: string | null; weekendShare: number; quiet: number; busy: number;
  receipt: { label: string; amount: number; count: number; flavour: CategoryFlavour | null } | null; largestShare: number | null; topShare: number | null;
  purchaseCount: number; median: number | null; average: number | null; perDay: number;
  repeat: { label: string; occurrences: number } | null; change: number | null; changeMode: 'average' | 'total';
  busiestMonth: string | null;
};
/** A flavoured line carries its flavour, so the chapter can show the matching mark beside its eyebrow. */
export type Copy = { eyebrow: string; title: string; body: string; flavour?: Flavour };

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
/** No body line: the visual says it, and a line that only describes the chart is noise. */
const NONE = '';

/**
 * Alternative copy for each chapter and the fact it leads with. Every line is built from the verified
 * figures the chapter shows: playful about the data, never a guess about why money was spent, and no
 * praise or shame. A body adds a figure or a name the headline doesn't have, or is left empty (and
 * isn't shown); it never just describes the chart. The first option sets the chapter's eyebrow when
 * the saved edition's copy is used.
 */
export function chapterCopy(id: RecapStoryId, lead: string | undefined, f: CopyFacts): Copy[] {
  return [...plainCopy(id, lead, f), ...flavouredCopy(id, lead, f)];
}

const tag = (flavour: Flavour, lines: Copy[]): Copy[] => lines.map(line => ({ ...line, flavour }));

/** Lines in the voice of what the chapter is about: the top category's family, the busiest weekday. */
function flavouredCopy(id: RecapStoryId, lead: string | undefined, f: CopyFacts): Copy[] {
  const top = f.top?.flavour ? { ...f.top, flavour: f.top.flavour, bank: BANKS[f.top.flavour] } : null;
  const eyebrow = (eyebrows: string[], i: number) => eyebrows[i % eyebrows.length];
  switch (id) {
    case 'intro': return top ? tag(top.flavour, [
      { eyebrow: 'Previously on your finances', title: 'Roll the highlights.', body: top.bank.star[0](top.label) },
      { eyebrow: 'The period edit', title: `${f.period}, the highlights.`, body: top.bank.star[1](top.label) },
    ]) : [];
    case 'categories': return top && (lead === 'top' || lead === undefined) ? tag(top.flavour, top.bank.lead.map((line, i) => ({
      eyebrow: eyebrow(top.bank.eyebrows, i), title: line(top.label, top.share), body: i === 1 ? `The top three together: ${f.top3Share}%.` : NONE,
    }))) : [];
    case 'mixtape': return top ? tag(top.flavour, [
      { eyebrow: 'Side A', title: `${top.label} topped the ${top.bank.playlist}.`, body: NONE },
      { eyebrow: eyebrow(top.bank.eyebrows, 0), title: `Now playing: the ${top.bank.playlist}.`, body: `Track one: ${top.label}, ${top.share}% of the side.` },
    ]) : [];
    case 'receipts': {
      const flavour = f.receipt?.flavour;
      if (!f.receipt || !flavour) return [];
      const { thing, eyebrows } = BANKS[flavour];
      return tag(flavour, [
        { eyebrow: eyebrow(eyebrows, 0), title: `${f.receipt.label}: the priciest ${thing}.`, body: NONE },
        { eyebrow: 'The standout receipts', title: `The big ${thing}: ${f.receipt.label}.`, body: f.largestShare !== null ? `On its own, ${f.largestShare}% of purchase spend.` : NONE },
      ]);
    }
    case 'weekdays': {
      if (lead === 'weekend') return tag('weekend', [{ eyebrow: 'Weekend mode', title: `Weekend mode: ${f.weekendShare}% of spending.`, body: NONE }]);
      const day = dayFlavour(f.busiestWeekday);
      if (!day || !f.busiestWeekday) return [];
      const bank = DAY_BANKS[day];
      return tag(day, bank.week.map((line, i) => ({ eyebrow: eyebrow(bank.eyebrows, i), title: line(f.busiestWeekday!), body: i === 0 ? `Weekends took ${f.weekendShare}%.` : NONE })));
    }
    case 'calendar': {
      const day = lead === 'peak' && f.peak ? dayFlavour(f.peak.weekday) : null;
      if (!day || !f.peak) return [];
      const peak = f.peak;
      return tag(day, DAY_BANKS[day].peak.map((line, i) => ({ eyebrow: eyebrow(DAY_BANKS[day].eyebrows, i), title: line(peak.label), body: `${money(peak.amount)} went out that day.` })));
    }
    default: return [];
  }
}

function plainCopy(id: RecapStoryId, lead: string | undefined, f: CopyFacts): Copy[] {
  const soFar = f.isPartial ? ' so far' : '';
  switch (id) {
    case 'intro': return [
      { eyebrow: 'Your period, in review', title: 'Roll the highlights.', body: `${f.period}${f.isPartial ? ', so far' : ''}: ${plural(f.purchaseCount, 'receipt')}.` },
      { eyebrow: 'Previously on your finances', title: `Previously, in ${f.period}…`, body: `${plural(f.purchaseCount, 'receipt')}, ${plural(f.spendingDays, 'day')} of spending.` },
      { eyebrow: 'Press play', title: 'Ready for a rewind?', body: f.top ? `Spoiler: ${f.top.label} has a big part.` : NONE },
      { eyebrow: 'The period edit', title: f.top ? `Starring ${f.top.label}.` : 'Your period, the movie.', body: `With ${plural(f.purchaseCount, 'purchase')} in supporting roles.` },
      { eyebrow: 'Fresh off the ledger', title: 'Your receipts, remixed.', body: `${plural(f.purchaseCount, 'receipt')} over ${plural(f.spendingDays, 'day')}${soFar}.` },
      { eyebrow: 'Now showing', title: `${f.period}: the director’s cut.`, body: f.top ? `Featuring ${f.top.label}.` : NONE },
      { eyebrow: 'Breaking news', title: 'This just in: your period.', body: `${plural(f.purchaseCount, 'receipt')} filed.` },
      { eyebrow: 'Loading memories', title: 'Remember this one?', body: `${f.period}, ${plural(f.spendingDays, 'day')} of spending.` },
      { eyebrow: 'Hot off the press', title: `The ${f.period} issue.`, body: f.top ? `Cover story: ${f.top.label}.` : NONE },
      { eyebrow: 'Tap to begin', title: 'Your money had a story.', body: `${plural(f.purchaseCount, 'receipt')} long.` },
      { eyebrow: 'Season finale', title: `Last time, on ${f.period}…`, body: `${plural(f.purchaseCount, 'purchase')} and a few surprises.` },
      { eyebrow: 'Unboxing', title: 'Let’s open this period up.', body: `What’s inside: ${plural(f.purchaseCount, 'receipt')}, ${plural(f.spendingDays, 'day')}.` },
    ];
    case 'overview': return lead === 'ratio' && f.spentPer100 !== null ? [
      { eyebrow: 'Money in, money out', title: `Every Rp100 in, Rp${f.spentPer100} out.`, body: f.keptShare !== null ? `The other ${f.keptShare}% was left after expenses.` : 'Expenses went past what came in.' },
      { eyebrow: 'The exchange rate', title: `${f.spentPer100}% of income went to expenses.`, body: `${money(f.expenses)} out of ${money(f.income)} in${soFar}.` },
      { eyebrow: 'Quick maths', title: `Rp100 came in. Rp${f.spentPer100} went out.`, body: `In total: ${money(f.expenses)} of ${money(f.income)}.` },
      { eyebrow: 'The ratio', title: `${f.spentPer100} out of every 100.`, body: `${money(f.expenses)} out, ${money(f.income)} in${soFar}.` },
      ...(f.keptShare !== null ? [{ eyebrow: 'The split', title: `${f.spentPer100} spent, ${f.keptShare} kept.`, body: `${money(f.net)} left over.` }] : []),
    ] : [
      { eyebrow: 'Money in, money out', title: f.net >= 0 ? 'More came in than went out.' : 'Expenses overtook income.', body: `${money(f.income)} in, ${money(f.expenses)} out${soFar}.` },
      { eyebrow: 'The scoreboard', title: f.net >= 0 ? 'Income takes the lead.' : 'Expenses take the lead.', body: `In: ${money(f.income)}. Out: ${money(f.expenses)}.` },
      { eyebrow: 'Head to head', title: 'In versus out.', body: `${money(f.income)} against ${money(f.expenses)}${soFar}.` },
      ...(f.net >= 0 ? [
        { eyebrow: 'The bottom line', title: `${money(f.net)} left over.`, body: f.keptShare !== null ? `That’s ${f.keptShare}% of what came in, after expenses.` : NONE },
        { eyebrow: 'After the receipts', title: 'Income won this round.', body: `${money(f.net)} more came in than went out${soFar}.` },
        { eyebrow: 'What’s left', title: `${money(f.net)} still standing.`, body: f.keptShare !== null ? `${f.keptShare}% of income.` : NONE },
        { eyebrow: 'The difference', title: `A ${money(f.net)} gap, in your favour.`, body: `Between ${money(f.income)} in and ${money(f.expenses)} out.` },
        ...(f.keptShare !== null ? [{ eyebrow: 'Kept', title: `${f.keptShare}% made it through.`, body: `${money(f.net)} of ${money(f.income)}.` }] : []),
      ] : [
        { eyebrow: 'The bottom line', title: `Short by ${money(-f.net)}.`, body: `${money(f.expenses)} out, ${money(f.income)} in${soFar}.` },
        { eyebrow: 'The difference', title: `${money(-f.net)} past income.`, body: `${money(f.expenses)} out against ${money(f.income)} in.` },
        { eyebrow: 'Over the line', title: 'Out outran in.', body: `By ${money(-f.net)}${soFar}.` },
      ]),
    ];
    // The budget visual prints its own figures (used, remaining, the day marker), so bodies only add
    // what it doesn't: which category ran over.
    case 'budget': return [
      { eyebrow: f.isPartial ? 'The plan, so far' : 'The plan meets the receipts', title: f.overCategory ? `${f.overCategory} went off-script.` : 'The plan held its shape.', body: NONE },
      { eyebrow: 'Script versus scene', title: f.overCategory ? `${f.overCategory} improvised.` : 'Everyone stuck to the script.', body: NONE },
      { eyebrow: 'Inside the lines', title: f.overCategory ? `${f.overCategory} coloured outside the lines.` : 'Every category stayed inside the lines.', body: NONE },
      ...(f.budgetUsed !== null && f.elapsedShare !== null ? [
        { eyebrow: 'Plan versus calendar', title: `${f.budgetUsed}% of the plan, ${f.elapsedShare}% of the days.`, body: f.overCategory ? `${f.overCategory} ran past its allocation.` : NONE },
        { eyebrow: 'The race', title: `Budget: ${f.budgetUsed}%. Calendar: ${f.elapsedShare}%.`, body: f.overCategory ? `${f.overCategory} ran past its allocation.` : NONE },
      ] : []),
      ...(f.remaining !== null && f.remaining > 0 ? [
        { eyebrow: 'Still in the plan', title: `${money(f.remaining)} still unspent.`, body: f.budgetUsed !== null ? `${f.budgetUsed}% of the plan used${soFar}.` : NONE },
        { eyebrow: 'Left in the envelopes', title: `${money(f.remaining)} untouched.`, body: f.overCategory ? `Though ${f.overCategory} ran over.` : NONE },
      ] : []),
      ...(f.budgetUsed !== null ? [
        { eyebrow: 'The plan, by the numbers', title: `${f.budgetUsed}% of the plan used.`, body: f.overCategory ? `${f.overCategory} spent past its allocation.` : 'Every category stayed inside its allocation.' },
        { eyebrow: 'Fuel gauge', title: `The plan reads ${f.budgetUsed}%.`, body: f.overCategory ? `${f.overCategory} ran past its allocation.` : NONE },
      ] : []),
    ];
    case 'categories':
      if (lead === 'top3') return [
        { eyebrow: 'Where it went', title: `Three categories, ${f.top3Share}% of spending.`, body: `${f.top?.label} led the trio.` },
        { eyebrow: 'The big three', title: 'Three categories ran the show.', body: `Together they took ${f.top3Share}% of what went out.` },
        { eyebrow: 'Podium finish', title: `Gold, silver, bronze: ${f.top3Share}%.`, body: `${f.top?.label} on the top step.` },
        { eyebrow: 'The trio', title: `${f.top3Share}% in three names.`, body: f.categoryCount > 3 ? `${plural(f.categoryCount - 3, 'other category', 'other categories')} shared the rest.` : NONE },
        { eyebrow: 'Top of the charts', title: 'A three-way headline.', body: `${f.top?.label} and two others: ${f.top3Share}% of spending.` },
      ];
      if (lead === 'count') return [
        { eyebrow: 'Where it went', title: `${f.categoryCount} categories split the bill.`, body: `${f.top?.label} took the biggest slice, at ${f.top?.share}%.` },
        { eyebrow: 'The full spread', title: `Spending touched ${f.categoryCount} categories.`, body: `The top three took ${f.top3Share}%.` },
        { eyebrow: 'Roll call', title: `${f.categoryCount} categories answered.`, body: `${f.top?.label} answered loudest, at ${f.top?.share}%.` },
        { eyebrow: 'The guest list', title: `${f.categoryCount} categories on the list.`, body: `${f.top?.label} at the top, with ${f.top?.share}%.` },
      ];
      return f.top ? [
        { eyebrow: 'Where it went', title: `${f.top.label} led the way.`, body: `${f.top.share}% of spending.` },
        { eyebrow: 'Top billing', title: `${f.top.label} took ${f.top.share}%.`, body: `${f.categoryCount} categories in all.` },
        { eyebrow: 'And the winner is…', title: `${f.top.label}, by a slice.`, body: `${f.top.share}% of everything that went out.` },
        { eyebrow: 'Main character', title: `${f.top.label} had the most lines.`, body: `${f.top.share}% of the spending script.` },
        { eyebrow: 'Number one', title: `${f.top.label} tops the chart.`, body: `With ${f.top.share}%, ahead of ${f.categoryCount - 1} others.` },
        { eyebrow: 'Biggest slice', title: `${f.top.label} cut ${f.top.share}% of the pie.`, body: `The top three together: ${f.top3Share}%.` },
        { eyebrow: 'The headliner', title: `Headlining: ${f.top.label}.`, body: `With ${f.top.share}% of spending on stage.` },
      ] : [];
    case 'calendar':
      if (lead === 'peak' && f.peak) return [
        { eyebrow: 'The period, day by day', title: `${f.peak.label} turned up the volume.`, body: `${money(f.peak.amount)} across ${plural(f.peak.purchaseCount, 'purchase')}.` },
        { eyebrow: 'Mark the calendar', title: `${f.peak.weekday} had the spotlight.`, body: `The busiest day: ${f.peak.label}, ${money(f.peak.amount)}.` },
        { eyebrow: 'Save the date', title: `${f.peak.label}. Remember it?`, body: `${plural(f.peak.purchaseCount, 'purchase')}, ${money(f.peak.amount)} in one day.` },
        { eyebrow: 'Peak day', title: `${f.peak.label} hit the high note.`, body: `${money(f.peak.amount)} went out that day.` },
        { eyebrow: 'Circled in red', title: `One date stood out: ${f.peak.label}.`, body: `${plural(f.peak.purchaseCount, 'purchase')} that day.` },
      ];
      return [
        { eyebrow: 'The period, day by day', title: `${f.spendingDays} of ${f.elapsedDays} days had spending.`, body: f.peak ? `The busiest: ${f.peak.label}.` : NONE },
        { eyebrow: 'Your calendar, coloured in', title: 'Your period had a beat.', body: `Spending showed up on ${plural(f.spendingDays, 'day')}${soFar}.` },
        { eyebrow: 'Heat map', title: `${plural(f.spendingDays, 'warm day')}.`, body: `Out of ${f.elapsedDays}.` },
        { eyebrow: 'Every square counts', title: 'One square, one day.', body: `${f.spendingDays} of them saw spending${soFar}.` },
        ...(f.elapsedDays - f.spendingDays > 0 ? [
          { eyebrow: 'Days off', title: `${plural(f.elapsedDays - f.spendingDays, 'day')} without spending.`, body: `Out of ${f.elapsedDays}${soFar}.` },
          { eyebrow: 'Blank squares', title: `${plural(f.elapsedDays - f.spendingDays, 'day')} stayed blank.`, body: f.peak ? `And one ran hot: ${f.peak.label}.` : NONE },
        ] : []),
      ];
    case 'weekdays':
      if (lead === 'weekend') return [
        { eyebrow: 'Your week', title: `Weekends took ${f.weekendShare}%.`, body: f.busiestWeekday ? `Busiest single day: ${f.busiestWeekday}.` : NONE },
        { eyebrow: 'Weekday or weekend?', title: 'The weekend had a say.', body: `${f.weekendShare}% of spending landed on Saturdays and Sundays.` },
        { eyebrow: 'Two days, one share', title: `Saturday plus Sunday: ${f.weekendShare}%.`, body: `The other five days: ${100 - f.weekendShare}%.` },
        { eyebrow: 'Weekend edition', title: `${f.weekendShare}% happened on the weekend.`, body: f.busiestWeekday ? `${f.busiestWeekday}s led the week.` : NONE },
      ];
      return [
        { eyebrow: 'Your week', title: `${f.busiestWeekday}s did the heavy lifting.`, body: `Weekends took ${f.weekendShare}%.` },
        { eyebrow: 'The weekly rhythm', title: `Big day of the week: ${f.busiestWeekday}.`, body: `Weekends took ${f.weekendShare}%.` },
        { eyebrow: 'Day of the week', title: `${f.busiestWeekday} wins the week.`, body: NONE },
        { eyebrow: 'Weekly chart', title: `${f.busiestWeekday}s ran the tallest.`, body: NONE },
        { eyebrow: 'Seven days', title: `Most money moved on ${f.busiestWeekday}s.`, body: `Saturday and Sunday together: ${f.weekendShare}%.` },
      ];
    // The strip prints the streak's dates, so bodies only add the other streak.
    case 'streak':
      if (lead === 'busy') return [
        { eyebrow: 'On a roll', title: `${f.busy} spending days in a row.`, body: f.quiet >= 2 ? `The longest pause: ${plural(f.quiet, 'day')}.` : NONE },
        { eyebrow: 'Streaks', title: `A ${f.busy}-day spending streak.`, body: NONE },
        { eyebrow: 'Combo', title: `${f.busy}× combo.`, body: NONE },
        { eyebrow: 'Unbroken', title: `${plural(f.busy, 'day')}, no gaps.`, body: f.quiet >= 2 ? `The longest pause: ${plural(f.quiet, 'day')}.` : NONE },
      ];
      return [
        { eyebrow: 'Quiet time', title: `${f.quiet} days in a row, no spending.`, body: f.busy >= 3 ? `The longest spending run: ${plural(f.busy, 'day')}.` : NONE },
        { eyebrow: 'Streaks', title: `The longest pause: ${plural(f.quiet, 'day')}.`, body: NONE },
        { eyebrow: 'Radio silence', title: `${plural(f.quiet, 'day')} of silence.`, body: NONE },
        { eyebrow: 'Pause button', title: `Paused for ${plural(f.quiet, 'day')}.`, body: f.busy >= 3 ? `Then a ${f.busy}-day run elsewhere.` : NONE },
      ];
    case 'receipts': return f.receipt ? [
      { eyebrow: 'The standout receipts', title: 'The biggest receipts.', body: `Your ${f.receipt.count} largest purchases this period.` },
      { eyebrow: 'Top of the pile', title: `${f.receipt.label} topped the receipts.`, body: f.largestShare !== null ? `On its own, ${f.largestShare}% of purchase spend.` : NONE },
      { eyebrow: 'Hall of fame', title: `${f.receipt.label}, in the top spot.`, body: `${money(f.receipt.amount)} on one receipt.` },
      { eyebrow: 'The long ones', title: 'The receipts that needed scrolling.', body: `The ${f.receipt.count} biggest of ${f.purchaseCount}.` },
      { eyebrow: 'Heavyweight', title: `${money(f.receipt.amount)}: the heaviest receipt.`, body: `${f.receipt.label}, at the top of the pile.` },
      { eyebrow: 'Price tags', title: 'The biggest price tags.', body: `Your top ${f.receipt.count}, out of ${f.purchaseCount}.` },
      ...(f.topShare !== null ? [
        { eyebrow: 'The heavy hitters', title: `${plural(f.receipt.count, 'receipt')}, ${f.topShare}% of the spend.`, body: `Out of ${plural(f.purchaseCount, 'purchase')} in total.` },
        ...(f.purchaseCount > f.receipt.count ? [{ eyebrow: 'A few big ones', title: `${plural(f.receipt.count, 'receipt')} carried ${f.topShare}%.`, body: `The other ${f.purchaseCount - f.receipt.count} shared the rest.` }] : []),
      ] : []),
    ] : [];
    case 'habits':
      if (lead === 'typical' && f.median !== null) return [
        { eyebrow: 'How you bought', title: `A typical receipt: ${money(f.median)}.`, body: f.average !== null ? `Half were smaller, half bigger. The average ran to ${money(Math.round(f.average))}.` : 'Half were smaller, half bigger.' },
        { eyebrow: 'The everyday receipt', title: 'Small receipts did the heavy lifting.', body: `The middle receipt came to ${money(f.median)}.` },
        { eyebrow: 'Right in the middle', title: `${money(f.median)}, dead centre.`, body: `Half of ${f.purchaseCount} receipts came in under it.` },
        { eyebrow: 'Median energy', title: `The median receipt: ${money(f.median)}.`, body: `Across ${plural(f.purchaseCount, 'purchase')}.` },
      ];
      if (lead === 'perDay') return [
        { eyebrow: 'How you bought', title: `About ${money(f.perDay)} a day.`, body: `Expenses spread over ${plural(f.elapsedDays, 'day')}${soFar}.` },
        { eyebrow: 'The daily rate', title: `${money(f.perDay)}, give or take, per day.`, body: `${money(f.expenses)} over ${plural(f.elapsedDays, 'day')}.` },
        { eyebrow: 'Per diem', title: `${money(f.perDay)} a day, on average.`, body: `Spending landed on ${f.spendingDays} of those days.` },
        { eyebrow: 'Daily meter', title: `The meter ran ${money(f.perDay)} a day.`, body: `Over ${plural(f.elapsedDays, 'day')}${soFar}.` },
      ];
      return [
        { eyebrow: 'How you bought', title: `${plural(f.purchaseCount, 'purchase')}, ${plural(f.spendingDays, 'day')}.`, body: NONE },
        { eyebrow: 'Checkout count', title: `${plural(f.purchaseCount, 'checkout')}.`, body: NONE },
        ...(f.repeat ? [
          { eyebrow: 'Encore', title: `${f.repeat.label} came back ${f.repeat.occurrences} times.`, body: `Out of ${plural(f.purchaseCount, 'purchase')}.` },
          { eyebrow: 'On repeat', title: `${f.repeat.label}, ×${f.repeat.occurrences}.`, body: NONE },
          { eyebrow: 'Familiar face', title: `${f.repeat.label} again. And again.`, body: `${f.repeat.occurrences} times this period.` },
        ] : []),
      ];
    // These bodies name the measure being compared, which the chart alone doesn't say.
    case 'comparison': return f.change !== null ? [
      { eyebrow: 'Then and now', title: f.change === 0 ? 'Right where it was.' : `${Math.abs(f.change)}% ${f.change > 0 ? 'higher' : 'lower'} than before.`, body: f.changeMode === 'average' ? 'Average purchase size, against your previous periods.' : 'Total expenses, against the previous period.' },
      { eyebrow: 'Plot twist', title: f.changeMode === 'average' ? `The average receipt got ${f.change > 0 ? 'bigger' : 'smaller'}.` : `The expense total went ${f.change > 0 ? 'up' : 'down'}.`, body: NONE },
      { eyebrow: 'Before and after', title: f.change === 0 ? 'No change. None.' : `${f.change > 0 ? 'Up' : 'Down'} ${Math.abs(f.change)}%.`, body: f.changeMode === 'average' ? 'The average receipt, compared with earlier periods.' : 'Total expenses, compared with last period.' },
      { eyebrow: 'The sequel', title: f.change === 0 ? 'Same as the original.' : `The sequel ran ${Math.abs(f.change)}% ${f.change > 0 ? 'bigger' : 'smaller'}.`, body: f.changeMode === 'average' ? 'Measured by average purchase size.' : 'Measured by total expenses.' },
      { eyebrow: 'Side by side', title: 'This period, meet the last.', body: `${f.changeMode === 'average' ? 'Average receipt' : 'Total expenses'}: ${f.change > 0 ? '+' : f.change < 0 ? '−' : '±'}${Math.abs(f.change)}%.` },
    ] : [];
    case 'months': return [
      { eyebrow: 'Month by month', title: f.busiestMonth ? `${f.busiestMonth} was the big one.` : 'The year, month by month.', body: NONE },
      { eyebrow: 'The year’s rhythm', title: 'Twelve months, one beat.', body: f.busiestMonth ? `${f.busiestMonth} spent the most.` : NONE },
      { eyebrow: 'Monthly chart', title: f.busiestMonth ? `${f.busiestMonth} topped the chart.` : 'Every month, ranked.', body: NONE },
      { eyebrow: 'Calendar year', title: 'A year in twelve bars.', body: f.busiestMonth ? `The tallest one: ${f.busiestMonth}.` : NONE },
    ];
    // Interludes are showpieces: the motion is the point, so they carry a headline and nothing else.
    case 'interlude':
      if (lead === 'orbit') return [
        { eyebrow: `Planet ${f.top?.label ?? 'You'}`, title: `Everything orbits ${f.top?.label ?? 'you'}.`, body: NONE },
        { eyebrow: 'Solar system', title: `${f.top?.label ?? 'One category'} is the sun.`, body: NONE },
        { eyebrow: 'Gravity', title: `${f.top?.label ?? 'The top category'} pulls hardest.`, body: NONE },
      ];
      if (lead === 'tunnel') return [
        { eyebrow: 'Warp speed', title: `${plural(f.purchaseCount, 'receipt')}, one tunnel.`, body: NONE },
        { eyebrow: 'Hyperdrive', title: 'Punch it.', body: NONE },
        { eyebrow: 'Wormhole', title: 'Skipping ahead.', body: NONE },
        { eyebrow: 'Fast forward', title: 'Zoom.', body: NONE },
      ];
      if (lead === 'liquid') return f.keptShare !== null
        ? [
          { eyebrow: 'Fill it up', title: `${f.keptShare}% left in the glass.`, body: NONE },
          { eyebrow: 'Half full?', title: `The glass reads ${f.keptShare}%.`, body: NONE },
        ]
        : [
          { eyebrow: 'Fill it up', title: `${f.budgetUsed}% of the plan, poured.`, body: NONE },
          { eyebrow: 'Pour it out', title: `${f.budgetUsed}% to the line.`, body: NONE },
        ];
      if (lead === 'rain') return [
        { eyebrow: 'Today’s forecast', title: `Cloudy with a chance of ${f.purchaseCount} receipts.`, body: NONE },
        { eyebrow: 'It’s raining', title: 'It’s raining receipts.', body: NONE },
        { eyebrow: 'Weather report', title: `${plural(f.purchaseCount, 'receipt')} of rainfall.`, body: NONE },
        { eyebrow: 'Downpour', title: 'Here they come.', body: NONE },
      ];
      if (lead === 'ejected') return [
        { eyebrow: 'Emergency meeting', title: 'Who was The Big Spender?', body: NONE },
        { eyebrow: 'Emergency meeting', title: 'There is a big spender among us.', body: NONE },
        { eyebrow: 'Body reported', title: 'Someone emptied the wallet.', body: NONE },
        { eyebrow: 'Voting time', title: 'Who’s acting sus?', body: NONE },
        { eyebrow: 'Emergency meeting', title: 'Where were you on payday?', body: NONE },
      ];
      if (lead === 'kaleido') return [
        { eyebrow: 'A little trip', title: `${f.period}, through the looking glass.`, body: NONE },
        { eyebrow: 'Breathe', title: 'Breathe in. Breathe out.', body: NONE },
        { eyebrow: 'Screensaver', title: 'Nothing to see. Just vibes.', body: NONE },
        { eyebrow: 'Brain break', title: 'Pretty colours, no numbers.', body: NONE },
      ];
      return [
        { eyebrow: 'Intermission', title: 'Grab a snack.', body: NONE },
        { eyebrow: 'Intermission', title: 'Stretch break.', body: NONE },
        { eyebrow: 'Halftime', title: 'Halftime show.', body: NONE },
        { eyebrow: 'Ad break', title: 'We’ll be right back.', body: NONE },
      ];
    case 'mixtape': return [
      { eyebrow: 'Side A', title: 'Your period, as a mixtape.', body: f.top ? `${f.top.label} plays longest, at ${f.top.share}% of spending.` : NONE },
      { eyebrow: 'Now playing', title: f.top ? `Now playing: ${f.top.label}.` : 'Now playing: your receipts.', body: f.top ? `${f.top.share}% of the side.` : NONE },
      { eyebrow: 'The B-sides', title: 'Press play on your receipts.', body: f.top ? `Track one: ${f.top.label}.` : NONE },
      { eyebrow: 'On rotation', title: f.top ? `${f.top.label} on heavy rotation.` : 'Your receipts, on rotation.', body: f.top ? `${f.top.share}% of the airtime.` : NONE },
      { eyebrow: 'Greatest hits', title: `${f.period}: greatest hits.`, body: f.top ? `Number one: ${f.top.label}.` : NONE },
      { eyebrow: 'Track list', title: 'Rewind. Play. Repeat.', body: NONE },
    ];
    // The personality chapter prints its own tagline and evidence, so its copy is a headline only.
    case 'persona': {
      // Each persona speaks in its own voice; the plain introductions stay in the mix.
      const voices: Record<string, Copy[]> = {
        weekend: [
          { eyebrow: 'Party mode: on', title: 'The weekend called. You answered.', body: NONE },
          { eyebrow: 'Clubbing, financially', title: 'Weekdays rest. Weekends rave.', body: NONE },
          { eyebrow: 'TGIF', title: 'Friday night, then the weekend.', body: NONE },
          { eyebrow: 'Weekend warrior', title: 'Two days. All the action.', body: NONE },
        ],
        bigTicket: [
          { eyebrow: 'Big spender energy', title: 'Go big or go home.', body: NONE },
          { eyebrow: 'Luxury edition', title: 'Rare finds, big tickets.', body: NONE },
          { eyebrow: 'Main event', title: 'Fewer receipts, bigger moments.', body: NONE },
          { eyebrow: 'High roller', title: 'When it’s big, it’s big.', body: NONE },
        ],
        steady: [
          { eyebrow: 'Slow and steady', title: 'A little, every day.', body: NONE },
          { eyebrow: 'Daily ritual', title: 'Same time tomorrow?', body: NONE },
          { eyebrow: 'Like clockwork', title: 'Tick, tock, receipt.', body: NONE },
          { eyebrow: 'Metronome', title: 'Keeping perfect time.', body: NONE },
        ],
        monk: [
          { eyebrow: 'Enlightenment reached', title: 'Shhh. The wallet is meditating.', body: NONE },
          { eyebrow: 'Inner peace', title: 'Breathe in. Spend nothing.', body: NONE },
          { eyebrow: 'Vow of silence', title: 'The wallet took a vow.', body: NONE },
          { eyebrow: 'Zen garden', title: 'Raked sand. No receipts.', body: NONE },
        ],
        loyal: [
          { eyebrow: 'Member since forever', title: 'Same again, please.', body: NONE },
          { eyebrow: 'Loyalty card: full', title: 'You know what you like.', body: NONE },
          { eyebrow: 'The usual', title: '“The usual?” “The usual.”', body: NONE },
          { eyebrow: 'Regular', title: 'They know your order.', body: NONE },
        ],
        devotee: [
          { eyebrow: 'All hail', title: 'One category to rule them all.', body: NONE },
          { eyebrow: 'Long live the king', title: 'Crowned by your receipts.', body: NONE },
          { eyebrow: 'Fan club', title: 'President of one fan club.', body: NONE },
          { eyebrow: 'Ride or die', title: 'One category. Total devotion.', body: NONE },
        ],
        explorer: [
          { eyebrow: 'Off the map', title: 'You went everywhere.', body: NONE },
          { eyebrow: 'Passport stamped', title: 'Here, there, everywhere.', body: NONE },
          { eyebrow: 'Side quests', title: 'Every side quest, accepted.', body: NONE },
          { eyebrow: 'Grand tour', title: 'A world tour of categories.', body: NONE },
        ],
        allRounder: [
          { eyebrow: 'Jack of all trades', title: 'A bit of everything.', body: NONE },
          { eyebrow: 'Perfectly balanced', title: 'Juggling it all.', body: NONE },
          { eyebrow: 'Swiss army', title: 'A tool for every job.', body: NONE },
          { eyebrow: 'Ensemble cast', title: 'No lead role. All supporting.', body: NONE },
        ],
      };
      return [...(lead && voices[lead] ? voices[lead] : []),
        { eyebrow: 'Drumroll, please', title: 'This period, you were…', body: NONE },
        { eyebrow: 'The verdict', title: 'Your money personality is in.', body: NONE }];
    }
    // Bonus slides write their own copy from the figures that earned them; see bonusCopy.
    case 'bonus': case 'year': return [];
    case 'closing': return [
      { eyebrow: 'The period, in one card', title: 'Same you. Fresh chapter.', body: NONE },
      { eyebrow: 'That’s a wrap', title: `That’s a wrap on ${f.period}.`, body: NONE },
      { eyebrow: 'Roll credits', title: 'Keep the plot. Turn the page.', body: NONE },
      { eyebrow: 'Until next time', title: 'See you next period.', body: NONE },
      { eyebrow: 'Fin', title: 'The end. For now.', body: NONE },
      { eyebrow: 'Game saved', title: 'Progress saved.', body: `${f.period}, complete.` },
      { eyebrow: 'Mic drop', title: `${f.period}, signing off.`, body: NONE },
      { eyebrow: 'Post-credits scene', title: 'Stick around.', body: NONE },
      { eyebrow: 'Closing time', title: 'Lights on. Tabs closed.', body: `${plural(f.purchaseCount, 'receipt')}, all accounted for.` },
    ];
  }
}

/** Copy for the bonus slides, each written from the figures that earned it. Both looks of every bonus
 * already draw its share, names, counts and date, so a body only carries a figure they don't. */
export function bonusCopy(b: Bonus, f: CopyFacts): Copy[] {
  return [...plainBonusCopy(b, f), ...flavouredBonusCopy(b)];
}

function flavouredBonusCopy(b: Bonus): Copy[] {
  const flavour = categoryFlavour(b.kind === 'boss' ? b.category : b.kind === 'takeover' || b.kind === 'comeback' ? b.name : null);
  if (!flavour) return [];
  const bank = BANKS[flavour];
  switch (b.kind) {
    case 'boss': return tag(flavour, [
      { eyebrow: 'Bonus: boss fight', title: `${b.label}: the priciest ${bank.thing}.`, body: `${money(b.amount)} in one go.` },
    ]);
    case 'takeover': return tag(flavour, bank.lead.slice(0, 2).map((line, i) => ({ eyebrow: `Bonus: ${bank.eyebrows[i % bank.eyebrows.length]}`, title: line(b.label, b.share), body: NONE })));
    case 'comeback': return tag(flavour, [
      { eyebrow: `Bonus: ${bank.eyebrows[0]}`, title: `Encore: ${b.label}.`, body: `Now #${b.rank}, with ${b.share}% of spending.` },
    ]);
    default: return [];
  }
}

/** Copy for a year's own insights. Each visual lays the months out, so bodies add a figure it leaves implicit. */
export function yearCopy(insight: YearInsight): Copy[] {
  switch (insight.kind) {
    case 'headliners': {
      const { leader, distinct } = insight;
      const months = insight.months.filter(month => month.category).length;
      if (leader.count === 1) return [
        { eyebrow: 'Month by month', title: 'A different headliner every month.', body: `${distinct} categories took a turn on top.` },
        { eyebrow: 'The headliners', title: `${distinct} months, ${distinct} headliners.`, body: NONE },
      ];
      // A tie at the top is said as a tie: no "most" when another category matched it.
      const most = leader.tied ? `${leader.label} shared the top spot: ${leader.count} months each.` : `${leader.label} topped the bill most: ${leader.count} times.`;
      return [
        { eyebrow: 'Month by month', title: `${leader.label} headlined ${leader.count} of ${months} months.`, body: distinct > 1 ? `${plural(distinct, 'different headliner')} in all.` : NONE },
        { eyebrow: 'The headliners', title: distinct === 1 ? `${leader.label}, top of the bill every month.` : `${plural(distinct, 'headliner')}, one year.`, body: distinct > 1 ? most : NONE },
        ...(leader.count * 2 > months ? [{ eyebrow: 'Top of the bill', title: `Most months, ${leader.label} led.`, body: `${leader.count} of ${months}.` }] : []),
      ];
    }
    case 'green': {
      const total = insight.months.length;
      const best = insight.best ? `Best: ${insight.best.name}, ${insight.best.kept}% kept.` : NONE;
      return [
        { eyebrow: 'In the green', title: `${insight.green} of ${total} months kept something back.`, body: best },
        { eyebrow: 'Month by month', title: insight.green === total ? 'Every month stayed in the green.' : insight.green === 0 ? 'Expenses led every month.' : `${plural(total - insight.green, 'month')} ran past income.`, body: best },
        { eyebrow: 'The scorecard', title: `In the green: ${insight.green} out of ${total}.`, body: best },
      ];
    }
    case 'personas': {
      const name = insight.leader.name.replace(/^The /, 'the ');
      const months = insight.months.length;
      return [
        { eyebrow: 'Your year, in personas', title: `${plural(insight.leader.count, 'month')} as ${name}.`, body: insight.distinct > 1 ? `${plural(insight.distinct, 'personality', 'personalities')} across ${months} months.` : NONE },
        { eyebrow: 'Many sides of you', title: insight.distinct === 1 ? `${insight.leader.name}, all year long.` : `${plural(insight.distinct, 'money personality', 'money personalities')}, one year.`, body: insight.distinct > 1 ? (insight.leader.tied ? `${insight.leader.name} tied for most: ${insight.leader.count} months.` : `Most often: ${name}, ${insight.leader.count} times.`) : NONE },
      ];
    }
    case 'regulars': {
      const { regulars, cameos, regularCount, cameoCount } = insight;
      const once = cameos.length ? `Just once: ${cameos.slice(0, 2).map(cameo => `${cameo.label} (${cameo.month})`).join(', ')}.` : NONE;
      return [
        ...(regularCount ? [
          { eyebrow: 'The regulars', title: regularCount === 1 ? `${regulars[0].label} never missed a month.` : `${regularCount} categories never missed a month.`, body: once },
          { eyebrow: 'Every month, without fail', title: regularCount === 1 ? `Every month: ${regulars[0].label}.` : `${plural(regularCount, 'regular')}, ${insight.periods} months.`, body: once },
        ] : []),
        ...(cameoCount ? [
          { eyebrow: 'Cameos', title: cameoCount === 1 ? `${cameos[0].label} showed up once.` : `${cameoCount} categories showed up just once.`, body: regularCount ? `And ${plural(regularCount, 'regular')} every month.` : NONE },
        ] : []),
      ];
    }
  }
}

function plainBonusCopy(b: Bonus, f: CopyFacts): Copy[] {
  switch (b.kind) {
    case 'payday': return [
      { eyebrow: 'Bonus: payday rush', title: `${b.share}% went in the first three days.`, body: `${money(b.amount)} out of the gate.` },
      { eyebrow: 'Bonus: off the blocks', title: 'Payday, then a sprint.', body: NONE },
      { eyebrow: 'Bonus: day one energy', title: `Three days, ${b.share}% of the spend.`, body: `${money(b.amount)} in the first three days.` },
      { eyebrow: 'Bonus: fresh salary', title: 'The salary landed. So did the receipts.', body: `${money(b.amount)} by day three.` },
    ];
    case 'boss': return [
      { eyebrow: 'Bonus: boss fight', title: `${b.label} dealt ${b.share}% damage.`, body: `One receipt, ${money(b.amount)}.` },
      { eyebrow: 'Bonus: critical hit', title: `One hit: ${b.share}%.`, body: `${b.label}, ${money(b.amount)} in one go.` },
      { eyebrow: 'Bonus: final boss', title: `A wild ${b.label} appeared.`, body: `${money(b.amount)} in one go.` },
      { eyebrow: 'Bonus: one-hit wonder', title: `${b.label}, the heavyweight.`, body: `${money(b.amount)} on a single receipt.` },
    ];
    case 'suspects': {
      const [a, c] = b.items;
      return [
        { eyebrow: 'Bonus: the usual suspects', title: `${a.label} and ${c.label}.`, body: `${money(a.total + c.total)} between them.` },
        { eyebrow: 'Bonus: lineup', title: 'Two regulars, one lineup.', body: `${money(a.total + c.total)} between them.` },
        { eyebrow: 'Bonus: repeat offenders', title: `${a.occurrences + c.occurrences} visits between them.`, body: NONE },
        { eyebrow: 'Bonus: rivalry', title: `${a.label} vs ${c.label}.`, body: NONE },
      ];
    }
    case 'milestone': return [
      { eyebrow: 'Bonus: milestone', title: `Receipt #${b.count}.`, body: `${f.purchaseCount} receipts in all.` },
      { eyebrow: 'Bonus: level up', title: `${b.count} receipts reached.`, body: `The count finished at ${f.purchaseCount}.` },
      { eyebrow: 'Bonus: round number', title: `#${b.count}. Ding.`, body: NONE },
      { eyebrow: 'Bonus: counting up', title: `Receipt number ${b.count}.`, body: `The count kept going, to ${f.purchaseCount}.` },
    ];
    case 'takeover': return [
      { eyebrow: 'Bonus: hostile takeover', title: `${b.label} holds the majority.`, body: NONE },
      { eyebrow: 'Bonus: landslide', title: `${b.label} wins in a landslide.`, body: NONE },
      { eyebrow: 'Bonus: majority rule', title: `More than half: ${b.label}.`, body: NONE },
      { eyebrow: 'Bonus: the chamber', title: `${b.share} seats out of 100.`, body: NONE },
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
