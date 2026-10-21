/**
 * What a goal's history says about its progress: when it first reached each quarter of its target,
 * and how many months in a row it got its monthly amount.
 */

export type ProgressEntry = { amount: number; kind: string; createdAt: number };
export type Milestone = { share: 25 | 50 | 75 | 100; at: number };

const SHARES = [25, 50, 75, 100] as const;

/** The first time the goal held each quarter of its target, oldest entry first. */
export function milestones(entries: readonly ProgressEntry[], target: number): Milestone[] {
  if (target <= 0) return [];
  const reached: Milestone[] = [];
  let held = 0;
  for (const entry of [...entries].sort((a, b) => a.createdAt - b.createdAt)) {
    held += entry.amount;
    for (const share of SHARES) {
      if (held >= (target * share) / 100 && !reached.some((item) => item.share === share)) reached.push({ share, at: entry.createdAt });
    }
  }
  return reached;
}

const monthKey = (time: number) => {
  const date = new Date(time);
  return date.getFullYear() * 12 + date.getMonth();
};

/**
 * Months in a row that the goal got at least its monthly amount put in, counting back from this
 * month. A month still under way that hasn't got it yet doesn't break the run; it just isn't counted.
 */
export function streak(entries: readonly ProgressEntry[], monthly: number, now = Date.now()): number {
  if (monthly <= 0) return 0;
  const putIn = new Map<number, number>();
  for (const entry of entries) {
    if (entry.kind !== "assign") continue;
    const key = monthKey(entry.createdAt);
    putIn.set(key, (putIn.get(key) ?? 0) + entry.amount);
  }
  const met = (key: number) => (putIn.get(key) ?? 0) >= monthly;
  let key = monthKey(now);
  if (!met(key)) key -= 1;
  let count = 0;
  while (met(key)) {
    count += 1;
    key -= 1;
  }
  return count;
}

/**
 * Months until a goal holding `held` reaches `target`, putting in `monthly` each month and earning
 * `yearlyReturn` % on what it holds; null when it never gets there within fifty years.
 */
export function monthsToReach(held: number, target: number, monthly: number, yearlyReturn = 0): number | null {
  if (held >= target) return 0;
  const rate = yearlyReturn / 100 / 12;
  let balance = held;
  for (let month = 1; month <= 600; month += 1) {
    balance = balance * (1 + rate) + monthly;
    if (balance >= target) return month;
  }
  return null;
}
