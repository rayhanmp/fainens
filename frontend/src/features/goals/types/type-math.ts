/**
 * The arithmetic behind each kind of goal's own tool, kept apart from the page so it can be tested:
 * months of spending an emergency fund covers, a house's down payment, costs and KPR payment, a
 * wedding's catering, an umrah's packages, a school's next fee, a gadget's prices, and what a
 * yearly bill asks each month. The facts it leans on are sourced where they're shown.
 */

const DAY = 86_400_000;
const num = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
export const roundTo = (value: number, step: number) => Math.round(value / step) * step;
const daysUntil = (time: number, now: number) => Math.round((new Date(time).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / DAY);

/* Emergency fund ---------------------------------------------------------------------------- */

/** Months of spending usually advised: from three for one person, more with a family relying on you. */
export const EMERGENCY_ADVICE = { single: { min: 3, max: 6 }, family: { min: 6, max: 12 } } as const;
/** Below this many months, the fund is reminded of. */
export const EMERGENCY_FLOOR = 3;

export type EmergencyData = {
  months: number;
  household: 'single' | 'family';
  /** Your own figure for a month's spending, like just the essentials; null to go by your average. */
  burn: number | null;
};

/** The month's spending a fund is counted in: your own figure when you set one, else your average. */
export function emergencyBurn(typeData: Record<string, unknown>, average: number | null): number | null {
  const own = num(typeData.burn, 0);
  return own > 0 ? own : average && average > 0 ? average : null;
}

export function emergencyData(typeData: Record<string, unknown>, targetAmount: number, average: number | null): EmergencyData {
  const household = typeData.household === 'family' ? 'family' : 'single';
  const own = num(typeData.burn, 0);
  const spending = emergencyBurn(typeData, average);
  // Without months chosen, they're what the target covers, like 3,6; the page shows a block for each started month.
  const fallback = spending ? Math.max(1, targetAmount / spending) : EMERGENCY_ADVICE[household].min;
  return { months: Math.min(24, Math.max(1, num(typeData.months, fallback))), household, burn: own > 0 ? own : null };
}

/** What the fund covers, in months of your average spending; null before there's spending to go by. */
export const monthsCovered = (held: number, spending: number | null) => (spending && spending > 0 ? held / spending : null);

/** The target for so many months of spending, to the nearest Rp100 ribu. */
export const emergencyTarget = (months: number, spending: number) => roundTo(months * spending, 100_000);

/* House ------------------------------------------------------------------------------------- */

/** Banks commonly keep a KPR payment within about 30% of take-home pay; some go to 40%. */
export const KPR_LIMIT = 30;
/** BPHTB is at most 5% of the price above the region's untaxed amount, at least Rp80 juta for a first home (UU 1/2022). */
export const BPHTB_RATE = 5;
export const BPHTB_UNTAXED = 80_000_000;

export type HouseData = {
  price: number;
  /** Down payment, % of the price. */
  dpShare: number;
  years: number;
  /** Yearly interest, %. */
  rate: number;
  /** Notary, AJB and certificate, % of the price. */
  notary: number;
  /** The bank's provisi and admin, % of the loan. */
  provisi: number;
  /** Appraisal, % of the price. */
  appraisal: number;
  /** The share of take-home pay the payment should stay within, %. */
  limit: number;
};

export const HOUSE_DEFAULTS: Omit<HouseData, 'price'> = { dpShare: 20, years: 15, rate: 8, notary: 1, provisi: 1, appraisal: 0.1, limit: KPR_LIMIT };

export function houseData(typeData: Record<string, unknown>): HouseData {
  return {
    price: Math.max(0, num(typeData.price, 0)),
    dpShare: Math.min(100, Math.max(0, num(typeData.dpShare, HOUSE_DEFAULTS.dpShare))),
    years: Math.min(35, Math.max(1, num(typeData.years, HOUSE_DEFAULTS.years))),
    rate: Math.min(30, Math.max(0, num(typeData.rate, HOUSE_DEFAULTS.rate))),
    notary: Math.max(0, num(typeData.notary, HOUSE_DEFAULTS.notary)),
    provisi: Math.max(0, num(typeData.provisi, HOUSE_DEFAULTS.provisi)),
    appraisal: Math.max(0, num(typeData.appraisal, HOUSE_DEFAULTS.appraisal)),
    limit: Math.min(60, Math.max(10, num(typeData.limit, KPR_LIMIT))),
  };
}

/** The monthly payment that clears a loan in so many years at a fixed yearly rate. */
export function kprPayment(loan: number, yearlyRate: number, years: number) {
  const months = Math.max(1, Math.round(years * 12));
  if (loan <= 0) return 0;
  const rate = yearlyRate / 100 / 12;
  if (rate === 0) return Math.round(loan / months);
  return Math.round((loan * rate) / (1 - (1 + rate) ** -months));
}

/** A house's down payment, the costs of buying it, the loan and its monthly payment. */
export function houseCosts(house: HouseData) {
  const downPayment = Math.round((house.price * house.dpShare) / 100);
  const loan = Math.max(0, house.price - downPayment);
  const bphtb = Math.round(Math.max(0, house.price - BPHTB_UNTAXED) * BPHTB_RATE / 100);
  const notary = Math.round((house.price * house.notary) / 100);
  const provisi = Math.round((loan * house.provisi) / 100);
  const appraisal = Math.round((house.price * house.appraisal) / 100);
  const costs = bphtb + notary + provisi + appraisal;
  return { downPayment, loan, bphtb, notary, provisi, appraisal, costs, upfront: downPayment + costs, monthly: kprPayment(loan, house.rate, house.years) };
}

/** The payment against what the bank would allow from take-home pay; null without a salary. */
export function kprFit(monthly: number, salary: number | null, limit: number) {
  if (!salary || salary <= 0) return null;
  const allowed = Math.round((salary * limit) / 100);
  return { allowed, share: (monthly / salary) * 100, over: monthly > allowed };
}

/* Wedding ----------------------------------------------------------------------------------- */

export type WeddingData = { guests: number; perGuest: number };
export const weddingData = (typeData: Record<string, unknown>): WeddingData => ({ guests: Math.max(0, Math.round(num(typeData.guests, 0))), perGuest: Math.max(0, num(typeData.perGuest, 0)) });

/** Catering for everyone, and the rest of the wedding from its parts (leaving out a part called catering). */
export function weddingTotal(wedding: WeddingData, parts: ReadonlyArray<{ name: string; amount: number }>) {
  const catering = wedding.guests * wedding.perGuest;
  const others = parts.filter((part) => !/^catering$/i.test(part.name.trim())).reduce((sum, part) => sum + part.amount, 0);
  return { catering, others, total: catering + others };
}

/* Umrah ------------------------------------------------------------------------------------- */

/** Kemenag's reference price for an umrah package (KMA 1021/2023): not a minimum, but agents must report packages priced lower. */
export const UMRAH_REFERENCE = 23_000_000;
export const UMRAH_PAPERS_DAYS = 60;

export type UmrahData = { travellers: number; packagePrice: number; spending: number };
export const umrahData = (typeData: Record<string, unknown>): UmrahData => ({
  travellers: Math.max(1, Math.round(num(typeData.travellers, 1))),
  packagePrice: Math.max(0, num(typeData.packagePrice, 0)),
  spending: Math.max(0, num(typeData.spending, 0)),
});
export const umrahTotal = (umrah: UmrahData) => umrah.travellers * (umrah.packagePrice + umrah.spending);

/* Education --------------------------------------------------------------------------------- */

type DatedPart = { id: number; name: string; amount: number; dueAt: number | null; paidAt: number | null };

/** The next fee not paid yet, from yesterday on, and the days until it. */
export function nextFee<T extends DatedPart>(parts: readonly T[], now: number): { part: T; days: number } | null {
  const next = parts.filter((part) => part.paidAt === null && part.dueAt !== null && part.dueAt >= now - DAY).sort((a, b) => a.dueAt! - b.dueAt!)[0];
  return next ? { part: next, days: daysUntil(next.dueAt!, now) } : null;
}

/** Due dates for fees that repeat every so many months, from the first one. */
export function termDates(first: number, everyMonths: number, count: number) {
  const start = new Date(first);
  return Array.from({ length: Math.max(0, count) }, (_, index) => new Date(start.getFullYear(), start.getMonth() + index * everyMonths, start.getDate(), 12).getTime());
}

/* Gadget ------------------------------------------------------------------------------------ */

export type GadgetOption = { url: string; title: string | null; image: string | null; price: number | null; firstPrice: number | null; checkedAt: number | null };
export type GadgetData = { options: GadgetOption[]; pick: number; tradeIn: number };
export const GADGET_OPTIONS_MAX = 3;

export function gadgetData(typeData: Record<string, unknown>): GadgetData {
  const options = Array.isArray(typeData.options) ? typeData.options.filter((item): item is GadgetOption => !!item && typeof item === 'object' && typeof (item as GadgetOption).url === 'string').slice(0, GADGET_OPTIONS_MAX) : [];
  return { options, pick: Math.min(Math.max(0, Math.round(num(typeData.pick, 0))), Math.max(0, options.length - 1)), tradeIn: Math.max(0, num(typeData.tradeIn, 0)) };
}

/** What the picked one costs with the old one traded in; null before it has a price. */
export function gadgetTarget(gadget: GadgetData) {
  const price = gadget.options[gadget.pick]?.price ?? null;
  return price === null ? null : Math.max(0, price - gadget.tradeIn);
}

/** The cheapest option with a price, by index. */
export function cheapestOption(options: readonly GadgetOption[]) {
  let best = -1;
  options.forEach((option, index) => {
    if (option.price !== null && (best === -1 || option.price < options[best].price!)) best = index;
  });
  return best === -1 ? null : best;
}

/* Yearly bills ------------------------------------------------------------------------------ */

/** A vehicle's STNK and plate last five years, with the tax paid and the STNK stamped every year (UU 22/2009, Pasal 70). */
export const STNK_YEARS = 5;
/** THR is paid at the latest seven days before the holiday (Permenaker 6/2016). */
export const THR_DAYS_BEFORE = 7;
export const YEARLY_REMIND_DAYS = 30;

/** What to put in a month: a twelfth of last year's, and what's left divided over the months until it's due. */
export function yearlyMonthly(lastYear: number, held: number, dueAt: number | null, now: number) {
  const twelfth = roundTo(lastYear / 12, 1_000);
  if (dueAt === null) return { twelfth, toDue: null, months: null };
  const due = new Date(dueAt);
  const today = new Date(now);
  const months = Math.max(1, (due.getFullYear() - today.getFullYear()) * 12 + due.getMonth() - today.getMonth());
  return { twelfth, toDue: roundTo(Math.max(0, lastYear - held) / months, 1_000), months };
}

/** Whether this year's tax also renews the plate and STNK, from the year they run until. */
export const plateRenewalDue = (plateUntil: number | null, dueAt: number | null) => (plateUntil !== null && dueAt !== null ? new Date(dueAt).getFullYear() >= plateUntil : false);

/* Reminders --------------------------------------------------------------------------------- */

export type TypeReminderGoal = {
  id: number;
  name: string;
  status: string;
  goalType: string | null;
  typeData: Record<string, unknown>;
  targetAmount: number;
  setAside: number;
  byDate: number | null;
};

export type TypeReminder =
  | { kind: 'emergency-low'; goalId: number; goalName: string; months: number }
  | { kind: 'kpr-limit'; goalId: number; goalName: string; monthly: number; allowed: number }
  | { kind: 'umrah-papers'; goalId: number; goalName: string; at: number; days: number }
  | { kind: 'price-drop'; goalId: number; goalName: string; from: number; to: number }
  | { kind: 'yearly-due'; goalId: number; goalName: string; at: number; days: number; short: number };

/**
 * What a goal's kind asks of you, from the Goals overview alone: an emergency fund under three
 * months of spending, a house whose KPR payment is past what the bank would allow, an umrah two
 * months out (papers and vaccines), a gadget that got cheaper, and a yearly bill due within a month.
 */
export function typeReminders(goals: readonly TypeReminderGoal[], context: { spending: number | null; salary: number | null; now: number }): TypeReminder[] {
  const out: TypeReminder[] = [];
  for (const goal of goals) {
    if (goal.status !== 'active') continue;
    const base = { goalId: goal.id, goalName: goal.name };
    switch (goal.goalType) {
      case 'emergency': {
        const months = monthsCovered(goal.setAside, emergencyBurn(goal.typeData, context.spending));
        if (months !== null && months < EMERGENCY_FLOOR) out.push({ ...base, kind: 'emergency-low', months });
        break;
      }
      case 'house': {
        const house = houseData(goal.typeData);
        if (!house.price) break;
        const { monthly } = houseCosts(house);
        const fit = kprFit(monthly, context.salary, house.limit);
        if (fit?.over) out.push({ ...base, kind: 'kpr-limit', monthly, allowed: fit.allowed });
        break;
      }
      case 'umrah': {
        if (goal.byDate === null) break;
        const days = daysUntil(goal.byDate, context.now);
        if (days >= 0 && days <= UMRAH_PAPERS_DAYS) out.push({ ...base, kind: 'umrah-papers', at: goal.byDate, days });
        break;
      }
      case 'gadget': {
        const gadget = gadgetData(goal.typeData);
        const option = gadget.options[gadget.pick];
        if (option?.price != null && option.firstPrice != null && option.price < option.firstPrice) out.push({ ...base, kind: 'price-drop', from: option.firstPrice, to: option.price });
        break;
      }
      case 'vehicle-tax':
      case 'insurance':
      case 'lebaran': {
        if (goal.byDate === null) break;
        const days = daysUntil(goal.byDate, context.now);
        if (days >= 0 && days <= YEARLY_REMIND_DAYS) out.push({ ...base, kind: 'yearly-due', at: goal.byDate, days, short: Math.max(0, goal.targetAmount - goal.setAside) });
        break;
      }
    }
  }
  return out;
}
