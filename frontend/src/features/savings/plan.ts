/**
 * The savings simulator's arithmetic. A plan is a set of pots (a savings account, SBN, equity
 * funds…), each with its own start, monthly saving, yearly raise, return and uncertainty. Goals
 * belong to a pot, so two goals never count the same money: a goal you spend leaves its pot when
 * it's bought, and a pot's goals are paid in order (dated ones by date, then the rest). Goals are
 * in today's rupiah and compared with the pot after inflation.
 */

export type Uncertainty = 'off' | 'low' | 'medium' | 'high';

export type PlanPot = {
  id: string;
  name: string;
  start: number;
  monthly: number;
  /** Yearly raise to the monthly saving, in percent. */
  raise: number;
  /** Yearly return, in percent. */
  returnRate: number;
  uncertainty: Uncertainty;
};

/** Money in (positive) or out (negative) of a pot in a plan month, counted from 1; `yearly` repeats it every 12 months. */
export type PlanEvent = { id: string; label: string; month: number; amount: number; yearly: boolean; potId: string };

/**
 * Something to save for in today's rupiah, paid from pot `potId`, wanted by plan month `byMonth`
 * (null: whenever). `spend` goals are bought and leave the pot; the others are amounts to keep.
 */
export type PlanGoal = { id: string; name: string; amount: number; byMonth: number | null; potId: string; spend: boolean };

export type PlanInputs = {
  years: number;
  /** Yearly inflation, in percent. */
  inflation: number;
  pots: PlanPot[];
  events: PlanEvent[];
  goals: PlanGoal[];
};

export const MAX_MONTHS = 600;
export const MAX_POTS = 6;

export const DEFAULT_POT: PlanPot = { id: 'main', name: 'Savings', start: 0, monthly: 0, raise: 0, returnRate: 4.5, uncertainty: 'off' };

export const DEFAULT_PLAN: PlanInputs = { years: 10, inflation: 3, pots: [DEFAULT_POT], events: [], goals: [] };

/** Yearly spread of returns for each uncertainty level. */
export const VOLATILITY: Record<Uncertainty, number> = { off: 0, low: 0.05, medium: 0.1, high: 0.18 };

export type PlanMonth = {
  /** 0 is today. */
  month: number;
  balance: number;
  /** Start plus every monthly saving and deposit so far. */
  deposits: number;
  /** What withdrawals and goal purchases actually took out so far. */
  withdrawals: number;
  /** Deposits minus withdrawals, each in today's money at the month it happened. */
  realNetDeposits: number;
  /** What a rupiah today is worth in rupiah of this month: divide by it for today's money. */
  deflator: number;
};

export type PotRun = {
  pot: PlanPot;
  months: PlanMonth[];
  /** The first month a withdrawal asked for more than the pot held, or null. */
  emptiedAt: number | null;
  /** The month each of this pot's goals was reached (kept) or bought (spent). */
  reached: Record<string, number>;
};

export type PlanRun = PotRun & { pots: PotRun[] };

export function monthlyRate(yearlyPercent: number): number {
  return (1 + yearlyPercent / 100) ** (1 / 12) - 1;
}

export function deflatorAt(inputs: Pick<PlanInputs, 'inflation'>, month: number): number {
  return (1 + inputs.inflation / 100) ** (month / 12);
}

/** A pot's monthly saving in plan month `month` (from 1), after yearly raises. */
export function savingInMonth(pot: Pick<PlanPot, 'monthly' | 'raise'>, month: number): number {
  return pot.monthly * (1 + pot.raise / 100) ** Math.floor((month - 1) / 12);
}

/** Money in or out from events in plan month `month` (from 1). */
export function eventsInMonth(events: readonly PlanEvent[], month: number): number {
  let total = 0;
  for (const event of events) {
    if (event.yearly ? month >= event.month && (month - event.month) % 12 === 0 : month === event.month) total += event.amount;
  }
  return total;
}

/** A pot's goals in the order they're paid: dated ones by date, then the rest as listed. */
export function potGoals(inputs: PlanInputs, potId: string): PlanGoal[] {
  const goals = inputs.goals.filter((goal) => goal.potId === potId);
  return [...goals.filter((goal) => goal.byMonth !== null).sort((a, b) => a.byMonth! - b.byMonth!), ...goals.filter((goal) => goal.byMonth === null)];
}

/**
 * One pot month by month. `growth` gives each month's growth factor (the pot's steady return
 * unless a random run passes its own). After each month, goals settle one at a time in order: a
 * kept goal is reached when the pot (in today's money) holds it on top of earlier kept goals, and
 * from then holds it back; a spent goal is bought, no earlier than its date, and its cost
 * (inflated to that month) leaves the pot.
 */
export function runPot(inputs: PlanInputs, pot: PlanPot, months: number, growth?: (month: number) => number): PotRun {
  const rate = monthlyRate(pot.returnRate);
  const events = inputs.events.filter((event) => event.potId === pot.id);
  const goals = potGoals(inputs, pot.id);
  const reached: Record<string, number> = {};
  let balance = pot.start;
  let deposits = pot.start;
  let withdrawals = 0;
  let realNetDeposits = pot.start;
  let emptiedAt: number | null = null;
  let next = 0;
  // What kept goals hold back, in today's money: later goals can only use what's above it.
  let reserved = 0;

  const settle = (month: number, deflator: number) => {
    while (next < goals.length) {
      const goal = goals[next]!;
      const free = balance / deflator - reserved;
      if (goal.spend) {
        if ((goal.byMonth !== null && month < goal.byMonth) || free < goal.amount) break;
        const cost = goal.amount * deflator;
        balance -= cost;
        withdrawals += cost;
        realNetDeposits -= goal.amount;
      } else {
        if (free < goal.amount) break;
        reserved += goal.amount;
      }
      reached[goal.id] = month;
      next += 1;
    }
  };

  settle(0, 1);
  const rows: PlanMonth[] = [{ month: 0, balance, deposits, withdrawals, realNetDeposits, deflator: 1 }];
  for (let month = 1; month <= months; month++) {
    const saving = savingInMonth(pot, month);
    const moved = eventsInMonth(events, month);
    const deflator = deflatorAt(inputs, month);
    const before = balance * (growth ? growth(month) : 1 + rate) + saving + Math.max(0, moved);
    deposits += saving + Math.max(0, moved);
    // A withdrawal takes what is there and no more.
    const taken = Math.min(before, Math.max(0, -moved));
    if (moved < 0 && taken < -moved && emptiedAt === null) emptiedAt = month;
    withdrawals += taken;
    // Money put in years from now is worth less today: deflate each amount at its own month.
    realNetDeposits += (saving + Math.max(0, moved) - taken) / deflator;
    balance = before - taken;
    settle(month, deflator);
    rows.push({ month, balance, deposits, withdrawals, realNetDeposits, deflator });
  }
  return { pot, months: rows, emptiedAt, reached };
}

/** Every pot without randomness, and their total, for `months` months (defaults to the plan's length). */
export function runPlan(inputs: PlanInputs, months = inputs.years * 12): PlanRun {
  const pots = inputs.pots.map((pot) => runPot(inputs, pot, months));
  const total = Array.from({ length: months + 1 }, (_, month): PlanMonth => {
    const row: PlanMonth = { month, balance: 0, deposits: 0, withdrawals: 0, realNetDeposits: 0, deflator: deflatorAt(inputs, month) };
    for (const run of pots) {
      const part = run.months[month]!;
      row.balance += part.balance;
      row.deposits += part.deposits;
      row.withdrawals += part.withdrawals;
      row.realNetDeposits += part.realNetDeposits;
    }
    return row;
  });
  const emptied = pots.map((run) => run.emptiedAt).filter((month): month is number => month !== null);
  return {
    pot: { ...DEFAULT_POT, id: 'total', name: 'All pots' },
    months: total,
    emptiedAt: emptied.length ? Math.min(...emptied) : null,
    reached: Object.assign({}, ...pots.map((run) => run.reached)),
    pots,
  };
}

/**
 * The monthly saving into a goal's pot (rounded up to Rp1.000, raises, events and the pot's other
 * goals kept) that reaches the goal by its date; 0 when it already does, null when no amount can.
 */
export function monthlyNeeded(inputs: PlanInputs, goal: PlanGoal): number | null {
  const pot = inputs.pots.find((candidate) => candidate.id === goal.potId);
  if (!pot || goal.byMonth === null) return null;
  const reachedWith = (monthly: number) => {
    const at = runPot(inputs, { ...pot, monthly }, goal.byMonth!).reached[goal.id];
    return at !== undefined && at <= goal.byMonth!;
  };
  if (reachedWith(0)) return 0;
  let low = 0;
  let high = Math.max(1_000, goal.amount);
  for (let attempt = 0; !reachedWith(high); attempt++) {
    if (attempt > 40) return null;
    high *= 2;
  }
  while (high - low > 1_000) {
    const middle = (low + high) / 2;
    if (reachedWith(middle)) high = middle;
    else low = middle;
  }
  return Math.ceil(high / 1_000) * 1_000;
}

/**
 * The plan with `goal` (new or edited) saved into a pot of its own, named after it. A dated goal's
 * pot saves each month what reaches it on time; an undated one starts at zero for you to fill.
 */
export function withOwnPot(inputs: PlanInputs, goal: PlanGoal, potId = newId()): PlanInputs {
  const pot: PlanPot = { ...DEFAULT_POT, id: potId, name: goal.name };
  const placed = { ...goal, potId };
  const exists = inputs.goals.some((item) => item.id === goal.id);
  const next: PlanInputs = {
    ...inputs,
    pots: [...inputs.pots, pot],
    goals: exists ? inputs.goals.map((item) => (item.id === goal.id ? placed : item)) : [...inputs.goals, placed],
  };
  const monthly = goal.byMonth === null ? 0 : monthlyNeeded(next, placed) ?? 0;
  return { ...next, pots: next.pots.map((item) => (item.id === potId ? { ...item, monthly } : item)) };
}

/** A small seeded generator, so the same plan always draws the same range. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function gaussian(random: () => number): number {
  let u = 0;
  while (u === 0) u = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

export type PlanRange = {
  /** The 10th and 90th percentile of all pots together (nominal) for each month from 0. */
  low: number[];
  high: number[];
  /** For each goal with a date, the share of runs (0–1) that reached it by then. */
  chances: Record<string, number>;
};

/**
 * Many runs in which each pot's returns swing by its own uncertainty while averaging its return;
 * goals are bought or reached inside each run. Covers the plan's length and any goal date beyond
 * it. Null when every pot's uncertainty is off.
 */
export function planRange(inputs: PlanInputs, runs = 400): PlanRange | null {
  if (inputs.pots.every((pot) => !VOLATILITY[pot.uncertainty])) return null;
  const dated = inputs.goals.filter((goal) => goal.byMonth !== null);
  const months = Math.max(inputs.years * 12, ...dated.map((goal) => goal.byMonth!));
  const random = mulberry32(1729);
  const byMonth: Float64Array[] = Array.from({ length: months + 1 }, () => new Float64Array(runs));
  const reachedCount: Record<string, number> = Object.fromEntries(dated.map((goal) => [goal.id, 0]));
  for (let run = 0; run < runs; run++) {
    for (const pot of inputs.pots) {
      const sigma = VOLATILITY[pot.uncertainty] / Math.sqrt(12);
      const steady = 1 + monthlyRate(pot.returnRate);
      const drift = Math.log(steady) - (sigma * sigma) / 2;
      const result = runPot(inputs, pot, months, sigma ? () => Math.exp(drift + sigma * gaussian(random)) : () => steady);
      for (const row of result.months) byMonth[row.month]![run]! += row.balance;
      for (const goal of dated) {
        const at = result.reached[goal.id];
        if (goal.potId === pot.id && at !== undefined && at <= goal.byMonth!) reachedCount[goal.id]! += 1;
      }
    }
  }
  const low: number[] = [];
  const high: number[] = [];
  for (const values of byMonth) {
    values.sort();
    low.push(values[Math.floor(runs * 0.1)]!);
    high.push(values[Math.floor(runs * 0.9)]!);
  }
  return { low, high, chances: Object.fromEntries(Object.entries(reachedCount).map(([id, count]) => [id, count / runs])) };
}

export type GoalOutlook = {
  goal: PlanGoal;
  /** The month the plan reaches (or buys) it, or null within 50 years. */
  reach: number | null;
  /** Months after its date that it's reached (0 on time); null without a date or when never reached. */
  late: number | null;
  /** The monthly saving into its pot that would reach it by its date, when the plan misses it. */
  needed: number | null;
  /** The share of runs that reach it by its date, with uncertainty on. */
  chance: number | null;
};

export function goalOutlooks(inputs: PlanInputs, range: PlanRange | null): GoalOutlook[] {
  const { reached } = runPlan(inputs, MAX_MONTHS);
  return inputs.goals.map((goal) => {
    const reach = reached[goal.id] ?? null;
    const missed = goal.byMonth !== null && (reach === null || reach > goal.byMonth);
    return {
      goal,
      reach,
      late: goal.byMonth === null || reach === null ? null : Math.max(0, reach - goal.byMonth),
      needed: missed ? monthlyNeeded(inputs, goal) : null,
      chance: goal.byMonth !== null ? range?.chances[goal.id] ?? null : null,
    };
  });
}

/** A plan month as a calendar month from `now`. */
export function monthDate(month: number, now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth() + month, 1);
}

/** The plan month (from 1) a calendar month falls in, counting from `now`'s month. */
export function planMonthOf(date: Date, now = new Date()): number {
  return Math.max(1, (date.getFullYear() - now.getFullYear()) * 12 + date.getMonth() - now.getMonth());
}

/** "2 yrs 3 mo", "8 mo", "Now". */
export function durationLabel(months: number): string {
  if (months <= 0) return 'Now';
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return [years ? `${years} yr${years === 1 ? '' : 's'}` : '', rest ? `${rest} mo` : ''].filter(Boolean).join(' ');
}

/** Rp1,2 jt, Rp450 jt, Rp1,25 M: short rupiah for axes and tight spots. */
export function compactRupiah(value: number): string {
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  const format = (amount: number, digits: number) => amount.toLocaleString('id-ID', { maximumFractionDigits: digits });
  if (absolute >= 1e12) return `${sign}Rp${format(absolute / 1e12, 2)} T`;
  if (absolute >= 1e9) return `${sign}Rp${format(absolute / 1e9, 2)} M`;
  if (absolute >= 1e6) return `${sign}Rp${format(absolute / 1e6, absolute >= 1e8 ? 0 : 1)} jt`;
  if (absolute >= 1e3) return `${sign}Rp${format(absolute / 1e3, 0)} rb`;
  return `${sign}Rp${format(absolute, 0)}`;
}

export const newId = () => Math.random().toString(36).slice(2, 10);

/**
 * Plan inputs from anything stored, with every field checked and out-of-range values replaced. A
 * plan saved before pots existed becomes one pot holding its start, saving, raise, return and
 * uncertainty.
 */
export function normalizePlan(value: unknown): PlanInputs {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const number = (source: Record<string, unknown>, key: string, fallback: number, min: number, max: number, integer = false) => {
    const candidate = source[key];
    if (typeof candidate !== 'number' || !Number.isFinite(candidate)) return fallback;
    const clamped = Math.min(max, Math.max(min, candidate));
    return integer ? Math.round(clamped) : clamped;
  };
  const text = (item: Record<string, unknown>, key: string, fallback: string) => (typeof item[key] === 'string' ? (item[key] as string).slice(0, 80) : fallback);
  const month = (candidate: unknown) => (typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 1 && candidate <= MAX_MONTHS ? candidate : null);
  const id = (item: Record<string, unknown>) => (typeof item.id === 'string' && item.id ? item.id.slice(0, 40) : newId());
  const objects = (candidate: unknown) => (Array.isArray(candidate) ? candidate : []).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
  const uncertainty = (candidate: unknown): Uncertainty => (candidate === 'low' || candidate === 'medium' || candidate === 'high' ? candidate : 'off');
  const pot = (item: Record<string, unknown>): PlanPot => ({
    id: id(item),
    name: text(item, 'name', DEFAULT_POT.name).trim() || DEFAULT_POT.name,
    start: number(item, 'start', 0, 0, 1e13, true),
    monthly: number(item, 'monthly', 0, 0, 1e13, true),
    raise: number(item, 'raise', 0, 0, 50),
    returnRate: number(item, 'returnRate', DEFAULT_POT.returnRate, -20, 50),
    uncertainty: uncertainty(item.uncertainty),
  });

  const pots = Array.isArray(raw.pots)
    ? objects(raw.pots).slice(0, MAX_POTS).map(pot)
    : [pot({ ...raw, id: DEFAULT_POT.id, name: DEFAULT_POT.name })];
  if (pots.length === 0) pots.push({ ...DEFAULT_POT });
  const potIds = new Set(pots.map((item) => item.id));
  const potOf = (item: Record<string, unknown>) => (typeof item.potId === 'string' && potIds.has(item.potId) ? item.potId : pots[0]!.id);

  return {
    years: number(raw, 'years', DEFAULT_PLAN.years, 1, 50, true),
    inflation: number(raw, 'inflation', DEFAULT_PLAN.inflation, 0, 30),
    pots,
    events: objects(raw.events).flatMap((item): PlanEvent[] => {
      const at = month(item.month);
      if (at === null || typeof item.amount !== 'number' || !Number.isFinite(item.amount) || item.amount === 0) return [];
      return [{ id: id(item), label: text(item, 'label', ''), month: at, amount: Math.round(Math.max(-1e13, Math.min(1e13, item.amount))), yearly: item.yearly === true, potId: potOf(item) }];
    }).slice(0, 20),
    goals: objects(raw.goals).flatMap((item): PlanGoal[] => {
      if (typeof item.amount !== 'number' || !Number.isFinite(item.amount) || item.amount <= 0) return [];
      const name = text(item, 'name', '').trim();
      if (!name) return [];
      return [{ id: id(item), name, amount: Math.round(Math.min(1e13, item.amount)), byMonth: month(item.byMonth), potId: potOf(item), spend: item.spend === true }];
    }).slice(0, 20),
  };
}

export function samePlan(a: PlanInputs, b: PlanInputs): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Saved per period over the last `count` finished periods, from period summaries (oldest first). */
export function recentSaving(
  periods: ReadonlyArray<{ periodName: string; startDate: number; endDate: number; income: number; expenses: number; net: number }>,
  now = Date.now(),
  count = 6,
): { average: number; averageSpending: number; periods: Array<{ name: string; net: number }> } | null {
  const finished = periods.filter((period) => period.endDate < now).sort((a, b) => a.startDate - b.startDate).slice(-count);
  if (finished.length === 0) return null;
  const average = finished.reduce((sum, period) => sum + period.net, 0) / finished.length;
  const averageSpending = finished.reduce((sum, period) => sum + period.expenses, 0) / finished.length;
  return { average: Math.round(average), averageSpending: Math.round(averageSpending), periods: finished.map((period) => ({ name: period.periodName, net: period.net })) };
}
