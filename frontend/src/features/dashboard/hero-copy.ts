export type HeroCopyInput = {
  /** Amount over the browsed period's plan, or null when it is within budget or untracked. */
  budgetOverrun: number | null;
  periodName: string | null;
  /** The browsed period has ended, so an overrun is reported in the past tense. */
  periodEnded: boolean;
  /** Net worth change over the last 30 days, or null without enough history. */
  netWorthChangePercent: number | null;
  upcomingCommitmentTotal: number;
};

export type HeroCopy = { headline: string; message: string };

export function heroCopy(input: HeroCopyInput, formatAmount: (cents: number) => string): HeroCopy {
  const { budgetOverrun, periodName, periodEnded, netWorthChangePercent: change, upcomingCommitmentTotal } = input;
  const hasCommitments = upcomingCommitmentTotal > 0;
  const commitments = formatAmount(upcomingCommitmentTotal);

  if (budgetOverrun != null) {
    const overrun = formatAmount(Math.abs(budgetOverrun));
    return periodEnded && periodName
      ? { headline: `${periodName} ran over budget.`, message: `It finished ${overrun} over plan. Check which categories drove it before setting your next budget.` }
      : { headline: 'Your budget needs attention.', message: `${overrun} over the ${periodName ?? 'current'} budget. Review the categories driving the overrun.` };
  }

  if (change == null) {
    return hasCommitments
      ? { headline: 'Your next moves are visible.', message: `${commitments} in commitments are due within the next 30 days. Keep them in your plan.` }
      : { headline: 'Your position is taking shape.', message: 'Keep building your financial history. A clearer trend is just ahead.' };
  }

  const percent = `${Math.abs(change).toFixed(1)}%`;
  if (change > 0) {
    return {
      headline: change >= 10 ? 'Strong momentum is building.' : 'Progress is moving in the right direction.',
      message: `Your net worth increased by ${percent} in the last 30 days.${hasCommitments ? ` Upcoming commitments total ${commitments}.` : ' Keep building momentum.'}`,
    };
  }
  if (change < 0) {
    return {
      headline: change < -5 ? 'Let’s protect your runway.' : 'A small reset can help.',
      message: `Your net worth decreased by ${percent} in the last 30 days. Review the trend and plan your next move.`,
    };
  }
  return hasCommitments
    ? { headline: 'Your next commitments are in view.', message: `Your net worth held steady over the last 30 days. Upcoming commitments total ${commitments}.` }
    : { headline: 'You’re holding steady.', message: 'Your net worth held steady over the last 30 days. Consistency is a strong foundation.' };
}

/** Percent change between the first and last points of a series, or null when it can't be computed. */
export function percentChange(start: number | null | undefined, end: number | null | undefined): number | null {
  if (start == null || end == null || start === 0) return null;
  return ((end - start) / Math.abs(start)) * 100;
}

export function timeOfDayGreeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function fallbackName(email: string | undefined): string {
  const localPart = email?.split('@')[0].replace(/[._-]+/g, ' ').trim();
  if (!localPart || localPart === 'demo') return 'there';
  return localPart.replace(/\b\w/g, (letter) => letter.toUpperCase());
}
