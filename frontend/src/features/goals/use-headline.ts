import { useCallback, useMemo, useState } from 'react';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { usePeriodSummariesQuery } from '../analytics/queries';
import { recentSaving } from '../savings/plan';
import { goalHeadline, type HeadlineContext, type HeadlineGoal } from './goal-types';

/** Your average spending a month over your last finished periods, or null before there are any. */
export function useAverageSpending(): number | null {
  const summaries = usePeriodSummariesQuery();
  const [now] = useState(() => Date.now());
  return useMemo(() => recentSaving(summaries.data ?? [], now)?.averageSpending ?? null, [summaries.data, now]);
}

/** Each goal's headline for its type, with your spending and the amount format filled in. */
export function useGoalHeadline() {
  const { formatAmount } = useBalanceVisibility();
  const spending = useAverageSpending();
  const [now] = useState(() => Date.now());
  return useCallback(
    (goal: HeadlineGoal, parts?: HeadlineContext['parts']) => goalHeadline(goal, { now, spending, parts, amount: formatAmount }),
    [now, spending, formatAmount],
  );
}
