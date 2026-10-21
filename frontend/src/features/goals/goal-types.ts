/**
 * What each kind of goal is: its name and emoji, whether it's bought or kept, whether it comes
 * round every year, its headline (the one figure that matters for it), the notes it starts from,
 * and the parts its cost is usually made of.
 */

export const GOAL_TYPE_KEYS = ['emergency', 'trip', 'house', 'wedding', 'umrah', 'education', 'gadget', 'vehicle-tax', 'insurance', 'lebaran'] as const;
export type GoalTypeKey = (typeof GOAL_TYPE_KEYS)[number];

export type GoalTypeInfo = {
  key: GoalTypeKey;
  label: string;
  icon: string;
  kind: 'spend' | 'keep';
  yearly: boolean;
  /** Markdown its notes can start from. */
  notes: string;
  /** Names of the parts its cost is usually made of. */
  parts: string[];
  /** More note pages it's offered, beyond its first. */
  pages?: Array<{ title: string; content: string }>;
};

export const isGoalTypeKey = (value: unknown): value is GoalTypeKey => typeof value === 'string' && (GOAL_TYPE_KEYS as readonly string[]).includes(value);

const YEARLY_NOTES = (thing: string) => `## This year\n\n- [ ] Check what it costs this year\n- [ ] Pay before the due date\n\n## Last year\n\nWhat ${thing} cost and anything to remember.\n`;

export const GOAL_TYPES: Record<GoalTypeKey, GoalTypeInfo> = {
  emergency: {
    key: 'emergency', label: 'Emergency fund', icon: '🛟', kind: 'keep', yearly: false,
    notes: '## Where it is\n\nWhich account, and how fast the money can come out.\n\n## What counts as an emergency\n\n- Losing income\n- Medical costs insurance doesn’t cover\n- Urgent home or vehicle repairs\n\n## Who to call\n\n',
    parts: [],
  },
  trip: {
    key: 'trip', label: 'Holiday', icon: '✈️', kind: 'spend', yearly: false,
    notes: '## Ideas\n\n\n\n## Must do\n\n- [ ] \n',
    parts: ['Flights', 'Stay', 'Local transport', 'Food', 'Activities', 'Shopping', 'Insurance'],
    pages: [
      { title: 'Itinerary ideas', content: '## Day 1\n\n\n\n## Day 2\n\n' },
      { title: 'Places to eat', content: '| Place | Area | What to get | Price |\n| --- | --- | --- | --- |\n|  |  |  |  |\n' },
      { title: 'Things to buy', content: '- [ ] \n' },
    ],
  },
  house: {
    key: 'house', label: 'House down payment', icon: '🏠', kind: 'spend', yearly: false,
    notes: '## Houses seen\n\n| House | Price | Notes |\n| --- | --- | --- |\n|  |  |  |\n\n## Banks compared\n\n| Bank | Rate | Fixed for | Notes |\n| --- | --- | --- | --- |\n|  |  |  |  |\n\n## Documents\n\n- [ ] KTP and KK\n- [ ] NPWP\n- [ ] Salary slips and bank statements\n- [ ] Employment letter\n',
    parts: ['Down payment', 'BPHTB', 'Notary and AJB', 'Bank fees and provisi', 'Appraisal', 'Moving'],
    pages: [{ title: 'Moving in', content: '- [ ] Furniture\n- [ ] Internet\n- [ ] Change of address\n' }],
  },
  wedding: {
    key: 'wedding', label: 'Wedding', icon: '💍', kind: 'spend', yearly: false,
    notes: '## Timeline\n\n- [ ] 12 months before: venue and date\n- [ ] 6 months before: catering, attire, documentation\n- [ ] 3 months before: invitations, KUA paperwork\n- [ ] 1 month before: final guest count and payments\n\n## Vendors\n\n| Vendor | For | Deposit | Rest due |\n| --- | --- | --- | --- |\n|  |  |  |  |\n\n## Guests\n\n',
    parts: ['Venue', 'Catering', 'Attire', 'Makeup', 'Documentation', 'Decoration', 'Invitations', 'KUA', 'Rings'],
    pages: [
      { title: 'Guests', content: '| Name | Side | Invited | Coming |\n| --- | --- | --- | --- |\n|  |  |  |  |\n' },
      { title: 'Ideas', content: '' },
    ],
  },
  umrah: {
    key: 'umrah', label: 'Umrah', icon: '🕋', kind: 'spend', yearly: false,
    notes: '## Packages compared\n\n| Travel agent | Price | Days | Hotel distance |\n| --- | --- | --- | --- |\n|  |  |  |  |\n\n## Documents\n\n- [ ] Passport\n- [ ] Vaccination certificate\n- [ ] Photos\n\n## Things to bring\n\n',
    parts: ['Package', 'Vaccines', 'Equipment', 'Spending money'],
  },
  education: {
    key: 'education', label: 'Education', icon: '🎓', kind: 'spend', yearly: false,
    notes: '## Schools compared\n\n| School | Entry fee | Term fee | Notes |\n| --- | --- | --- | --- |\n|  |  |  |  |\n\n## Registration\n\n- [ ] Open day\n- [ ] Application\n- [ ] Test or interview\n- [ ] Pay the entry fee\n',
    parts: ['Entry fee', 'Term fee', 'Books', 'Uniform', 'Activities'],
  },
  gadget: {
    key: 'gadget', label: 'Gadget', icon: '💻', kind: 'spend', yearly: false,
    notes: '## What it needs to do\n\n\n\n## Where to buy\n\n\n\n## The old one\n\n- [ ] Back it up\n- [ ] Sell or trade it in\n',
    parts: ['Device', 'Accessories', 'Case', 'Warranty'],
  },
  'vehicle-tax': {
    key: 'vehicle-tax', label: 'Vehicle tax', icon: '🚗', kind: 'spend', yearly: true,
    notes: YEARLY_NOTES('the tax'),
    parts: ['PKB', 'SWDKLLJ'],
  },
  insurance: {
    key: 'insurance', label: 'Yearly insurance', icon: '🛡️', kind: 'spend', yearly: true,
    notes: YEARLY_NOTES('the premium'),
    parts: ['Premium'],
  },
  lebaran: {
    key: 'lebaran', label: 'Lebaran', icon: '🌙', kind: 'spend', yearly: true,
    notes: '## This year\n\n- [ ] Mudik tickets\n- [ ] Hampers\n- [ ] THR envelopes for family\n- [ ] New clothes\n\n## Last year\n\n',
    parts: ['Mudik', 'Hampers', 'THR for family', 'Clothes', 'Food'],
  },
};

export type HeadlineGoal = {
  goalType: string | null;
  typeData: Record<string, unknown>;
  targetAmount: number;
  setAside: number;
  byDate: number | null;
};

export type HeadlineContext = {
  now: number;
  /** Average spending per month, for an emergency fund. */
  spending?: number | null;
  /** Its parts, for the next fee due. */
  parts?: ReadonlyArray<{ name: string; amount: number; dueAt: number | null; paidAt: number | null }>;
  amount: (value: number) => string;
};

const DAY = 86_400_000;
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const daysUntil = (time: number, now: number) => Math.round((new Date(time).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / DAY);
const countdown = (days: number, ending: string) => (days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days} days ${ending}`);
const monthYear = (time: number) => new Date(time).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
const decimal = (value: number) => value.toLocaleString('id-ID', { maximumFractionDigits: 1 });

/**
 * The one figure that matters most for a goal of this type, like "143 days to go" for a trip or
 * "4,2 of 6 months of spending" for an emergency fund; null when there's nothing to say yet.
 */
export function goalHeadline(goal: HeadlineGoal, context: HeadlineContext): string | null {
  const { now, amount } = context;
  const data = goal.typeData;
  switch (goal.goalType) {
    case 'emergency': {
      const spending = context.spending ?? 0;
      if (spending <= 0) return null;
      const months = num(data.months) ?? goal.targetAmount / spending;
      return `${decimal(goal.setAside / spending)} of ${decimal(months)} months of spending`;
    }
    case 'trip': {
      const start = num(data.startDate) ?? goal.byDate;
      const end = num(data.endDate);
      if (start === null) return null;
      const days = daysUntil(start, now);
      if (days >= 0) return countdown(days, 'to go');
      return end !== null && now <= end + DAY ? 'On the trip' : null;
    }
    case 'house': {
      const price = num(data.price);
      return price ? `Down payment for a ${amount(price)} house` : null;
    }
    case 'wedding': {
      const guests = num(data.guests);
      return guests ? `${amount(Math.round(goal.targetAmount / guests))} a guest for ${guests} guests` : null;
    }
    case 'umrah': {
      const travellers = num(data.travellers);
      if (!travellers) return goal.byDate ? `Leaving ${monthYear(goal.byDate)}` : null;
      return `For ${travellers} ${travellers === 1 ? 'person' : 'people'}${goal.byDate ? ` · leaving ${monthYear(goal.byDate)}` : ''}`;
    }
    case 'education': {
      const next = (context.parts ?? []).filter((part) => part.paidAt === null && part.dueAt !== null && part.dueAt >= now - DAY).sort((a, b) => a.dueAt! - b.dueAt!)[0];
      if (next) {
        const days = daysUntil(next.dueAt!, now);
        return `Next fee ${days <= 1 ? (days === 0 ? 'today' : 'tomorrow') : days < 60 ? `in ${days} days` : `in ${Math.round(days / 30)} months`}: ${amount(next.amount)}`;
      }
      return goal.byDate ? `${countdown(Math.max(0, daysUntil(goal.byDate, now)), 'until it starts')}` : null;
    }
    case 'gadget': {
      const first = num(data.firstPrice);
      const latest = num(data.linkPrice);
      if (first === null || latest === null || first === latest) return null;
      return latest < first ? `${amount(first - latest)} cheaper than when you added it` : `${amount(latest - first)} dearer than when you added it`;
    }
    case 'vehicle-tax':
    case 'insurance':
    case 'lebaran': {
      if (goal.byDate === null) return null;
      const days = Math.max(0, daysUntil(goal.byDate, now));
      const last = num(data.lastYear);
      return `${days === 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : `Due in ${days} days`}${last ? ` · last year ${amount(last)}` : ''}`;
    }
    default:
      return null;
  }
}
