import {
  AlarmClock, Bus, CalendarDays, Clapperboard, Coffee, Gamepad2, Gift, GraduationCap, HeartPulse, House, PartyPopper, PawPrint, PiggyBank, Plane,
  Receipt, RefreshCw, Shirt, ShoppingBag, ShoppingBasket, Sparkles, Sun, UtensilsCrossed, Zap, type LucideIcon,
} from 'lucide-react';

/**
 * Flavour: the copy and a small mark take on the character of what the figures are about. A category is
 * read from its name (English or Indonesian, as people name their own), a day from its weekday. Lines are
 * wordplay on the subject only: never a guess at why the money went, and no praise or shame.
 */
export type CategoryFlavour = 'food' | 'coffee' | 'groceries' | 'transport' | 'travel' | 'housing' | 'utilities' | 'health' | 'entertainment'
  | 'subscriptions' | 'shopping' | 'fashion' | 'beauty' | 'education' | 'hobbies' | 'savings' | 'fees' | 'gifts' | 'pets';
export type DayFlavour = 'monday' | 'midweek' | 'friday' | 'weekend';
export type Flavour = CategoryFlavour | DayFlavour;

// Checked in order: the narrower families come before the ones whose words they share.
const MATCHERS: Array<[CategoryFlavour, RegExp]> = [
  ['coffee', /coffee|kopi|caf[eé]|espresso|latte|\btea\b|teh|boba/i],
  ['groceries', /grocer|supermarket|minimarket|market|pasar|sembako|belanja (?:dapur|bulanan)|household/i],
  ['subscriptions', /subscri|langganan|streaming|netflix|spotify|membership/i],
  ['food', /food|dining|makan|meal|resto|restaurant|snack|jajan|kuliner|lunch|dinner|breakfast/i],
  ['travel', /travel|flight|hotel|trip|holiday|vacation|liburan|wisata|tiket pesawat/i],
  ['transport', /transport|\bride|gojek|grab|ojek|taxi|fuel|bensin|\bbbm\b|parking|parkir|\btoll?\b|commute|kereta|\bkrl\b|\bmrt\b|\blrt\b|busway|\bcar\b|motor/i],
  ['housing', /housing|rent|sewa|kos\b|kost|mortgage|kpr|home|rumah/i],
  ['utilities', /utilit|electric|listrik|water|\bair\b|pdam|internet|wifi|pulsa|phone|data plan|\bgas\b/i],
  ['health', /health|medical|medic|doctor|dokter|clinic|klinik|hospital|pharma|apotek|obat|insurance|bpjs|gym|fitness/i],
  ['beauty', /beauty|skincare|makeup|salon|barber|cosmetic|perawatan/i],
  ['fashion', /fashion|cloth|apparel|baju|pakaian|shoe|sepatu|outfit/i],
  ['entertainment', /entertain|movie|cinema|bioskop|concert|konser|music|musik|game|hiburan|event/i],
  ['education', /educat|course|kursus|school|sekolah|tuition|book|buku|class|kelas|learning/i],
  ['hobbies', /hobb|craft|camera|photo|kamera|sport|olahraga|collect/i],
  ['savings', /saving|tabungan|invest|reksa|deposit|emergency fund/i],
  ['fees', /fee|biaya|admin|bank|transfer|charge|tax|pajak/i],
  ['gifts', /gift|hadiah|kado|donat|charity|zakat|sedekah|infaq/i],
  ['pets', /\bpet|kucing|anjing|\bcat\b|\bdog\b|vet\b/i],
  ['shopping', /shopping|belanja|marketplace|online shop|tokopedia|shopee/i],
];

export function categoryFlavour(name: string | null | undefined): CategoryFlavour | null {
  if (!name) return null;
  return MATCHERS.find(([, pattern]) => pattern.test(name))?.[0] ?? null;
}

export function dayFlavour(weekday: string | null | undefined): DayFlavour | null {
  if (!weekday) return null;
  const day = weekday.slice(0, 3).toLowerCase();
  return day === 'mon' ? 'monday' : day === 'fri' ? 'friday' : day === 'sat' || day === 'sun' ? 'weekend' : day === 'tue' || day === 'wed' || day === 'thu' ? 'midweek' : null;
}

type Bank = {
  /** Headlines for the category on top, with its share. */
  lead: Array<(label: string, share: number) => string>;
  /** Short billing lines that name the category. */
  star: Array<(label: string) => string>;
  /** What one receipt in the category is called: "the priciest plate". */
  thing: string;
  /** The mixtape the category headlines. */
  playlist: string;
  eyebrows: string[];
};

export const BANKS: Record<CategoryFlavour, Bank> = {
  food: {
    lead: [(l, s) => `${l} ate up ${s}%.`, (l, s) => `Bon appétit: ${l}, ${s}%.`, (l, s) => `The main course: ${l}, ${s}%.`, (l, s) => `${s}% served as ${l}.`],
    star: [l => `${l} was on the menu.`, l => `Today’s special: ${l}.`], thing: 'plate', playlist: 'dinner-party playlist',
    eyebrows: ['On the menu', 'Chef’s table', 'Kitchen report'],
  },
  coffee: {
    lead: [(l, s) => `${l} brewed up ${s}%.`, (l, s) => `Freshly ground: ${l}, ${s}%.`, (l, s) => `${l}, a strong ${s}%.`],
    star: [l => `Fuelled by ${l}.`, l => `${l}, extra shot.`], thing: 'cup', playlist: 'lo-fi beats to brew to',
    eyebrows: ['Fresh brew', 'Barista’s pick', 'Caffeine count'],
  },
  groceries: {
    lead: [(l, s) => `${l} filled the cart: ${s}%.`, (l, s) => `Aisle one: ${l}, ${s}%.`, (l, s) => `${s}% went into the ${l} basket.`],
    star: [l => `${l} stocked the shelves.`, l => `First on the list: ${l}.`], thing: 'basket', playlist: 'supermarket radio',
    eyebrows: ['Aisle by aisle', 'The shopping list', 'Pantry report'],
  },
  transport: {
    lead: [(l, s) => `${l} drove off with ${s}%.`, (l, s) => `On the move: ${l}, ${s}%.`, (l, s) => `${l} took the wheel: ${s}%.`],
    star: [l => `${l} kept things moving.`, l => `Next stop: ${l}.`], thing: 'ride', playlist: 'road-trip mix',
    eyebrows: ['On the road', 'Next stop', 'Mileage report'],
  },
  travel: {
    lead: [(l, s) => `${l} flew off with ${s}%.`, (l, s) => `Now boarding: ${l}, ${s}%.`, (l, s) => `${l} took ${s}%, window seat.`],
    star: [l => `${l}, cleared for take-off.`, l => `Destination: ${l}.`], thing: 'ticket', playlist: 'in-flight playlist',
    eyebrows: ['Departures', 'Now boarding', 'Passport stamps'],
  },
  housing: {
    lead: [(l, s) => `${l} holds the keys: ${s}%.`, (l, s) => `Home base: ${l}, ${s}%.`, (l, s) => `${s}% under one roof: ${l}.`],
    star: [l => `${l}, the foundation.`, l => `Home base: ${l}.`], thing: 'bill', playlist: 'home sessions',
    eyebrows: ['Home base', 'Under one roof', 'House rules'],
  },
  utilities: {
    lead: [(l, s) => `${l} kept the lights on: ${s}%.`, (l, s) => `Plugged in: ${l}, ${s}%.`, (l, s) => `${l} drew ${s}% of the current.`],
    star: [l => `${l}, always on.`, l => `Powered by ${l}.`], thing: 'bill', playlist: 'background hum',
    eyebrows: ['Power check', 'Meter reading', 'Always on'],
  },
  health: {
    lead: [(l, s) => `${l} took the biggest dose: ${s}%.`, (l, s) => `Check-up: ${l}, ${s}%.`, (l, s) => `${s}%, prescribed to ${l}.`],
    star: [l => `${l}, on the chart.`, l => `Vital sign: ${l}.`], thing: 'visit', playlist: 'waiting-room radio',
    eyebrows: ['Check-up', 'Vital signs', 'Health chart'],
  },
  entertainment: {
    lead: [(l, s) => `${l} stole the show: ${s}%.`, (l, s) => `Top billing: ${l}, ${s}%.`, (l, s) => `${l} got ${s}% of the screen time.`],
    star: [l => `${l}, now showing.`, l => `Starring ${l}.`], thing: 'ticket', playlist: 'soundtrack',
    eyebrows: ['Showtime', 'Box office', 'Now showing'],
  },
  subscriptions: {
    lead: [(l, s) => `${l} renewed its lead: ${s}%.`, (l, s) => `Auto-renewed: ${l}, ${s}%.`, (l, s) => `${l}, on repeat: ${s}%.`],
    star: [l => `${l}, renewed again.`, l => `Still subscribed: ${l}.`], thing: 'plan', playlist: 'auto-play queue',
    eyebrows: ['Auto-renew', 'The monthly plan', 'Still subscribed'],
  },
  shopping: {
    lead: [(l, s) => `${l} checked out with ${s}%.`, (l, s) => `Added to cart: ${l}, ${s}%.`, (l, s) => `${l} rang up ${s}%.`],
    star: [l => `${l}, added to cart.`, l => `In the bag: ${l}.`], thing: 'haul', playlist: 'checkout beats',
    eyebrows: ['Checkout', 'Cart total', 'Haul report'],
  },
  fashion: {
    lead: [(l, s) => `${l} wore the crown: ${s}%.`, (l, s) => `Dressed to win: ${l}, ${s}%.`, (l, s) => `${l} walked off with ${s}%.`],
    star: [l => `${l}, on the runway.`, l => `Fit check: ${l}.`], thing: 'piece', playlist: 'runway mix',
    eyebrows: ['Runway report', 'Fit check', 'Dress code'],
  },
  beauty: {
    lead: [(l, s) => `${l} glowed up to ${s}%.`, (l, s) => `Fresh look: ${l}, ${s}%.`, (l, s) => `${l}, ${s}% and glowing.`],
    star: [l => `${l}, glowing.`, l => `Mirror, mirror: ${l}.`], thing: 'treat', playlist: 'glow-up mix',
    eyebrows: ['Glow report', 'Mirror check', 'Fresh look'],
  },
  education: {
    lead: [(l, s) => `${l} topped the class: ${s}%.`, (l, s) => `Top marks: ${l}, ${s}%.`, (l, s) => `${l} took ${s}% of the syllabus.`],
    star: [l => `${l}, top of the class.`, l => `Class is in: ${l}.`], thing: 'lesson', playlist: 'study playlist',
    eyebrows: ['Class notes', 'Report card', 'Study hall'],
  },
  hobbies: {
    lead: [(l, s) => `${l} levelled up to ${s}%.`, (l, s) => `Side quest: ${l}, ${s}%.`, (l, s) => `${l} took ${s}% of the play time.`],
    star: [l => `${l}, the side quest.`, l => `Player one: ${l}.`], thing: 'buy', playlist: 'jam session',
    eyebrows: ['Side quest', 'Free play', 'Hobby hour'],
  },
  savings: {
    lead: [(l, s) => `${l} stacked up ${s}%.`, (l, s) => `Set aside: ${l}, ${s}%.`, (l, s) => `${s}% tucked into ${l}.`],
    star: [l => `${l}, stacked up.`, l => `Into the jar: ${l}.`], thing: 'deposit', playlist: 'piggy-bank anthems',
    eyebrows: ['Stacking up', 'Set aside', 'The stash'],
  },
  fees: {
    lead: [(l, s) => `${l} quietly took ${s}%.`, (l, s) => `Fine print: ${l}, ${s}%.`, (l, s) => `${l} skimmed ${s}% off the top.`],
    star: [l => `${l}, in the fine print.`, l => `Small print: ${l}.`], thing: 'charge', playlist: 'hold music',
    eyebrows: ['Fine print', 'Small charges', 'Service fee'],
  },
  gifts: {
    lead: [(l, s) => `${l} wrapped up ${s}%.`, (l, s) => `With a bow on top: ${l}, ${s}%.`, (l, s) => `${s}% went out as ${l}.`],
    star: [l => `${l}, gift-wrapped.`, l => `With love: ${l}.`], thing: 'gift', playlist: 'party playlist',
    eyebrows: ['Gift wrap', 'With love', 'Wrapped up'],
  },
  pets: {
    lead: [(l, s) => `${l} fetched ${s}%.`, (l, s) => `Paws up: ${l}, ${s}%.`, (l, s) => `${l} got the treats: ${s}%.`],
    star: [l => `${l}, best in show.`, l => `Good company: ${l}.`], thing: 'treat', playlist: 'walkies mix',
    eyebrows: ['Best in show', 'Paw prints', 'The treat jar'],
  },
};

export const DAY_BANKS: Record<DayFlavour, { week: Array<(day: string) => string>; peak: Array<(date: string) => string>; eyebrows: string[] }> = {
  monday: {
    week: [() => 'A case of the Mondays.', () => 'Mondays came out swinging.', () => 'The week started loud: Monday.'],
    peak: [date => `${date}: Monday, at full volume.`, date => `${date}. Some Monday.`], eyebrows: ['Case of the Mondays', 'Start of the week'],
  },
  midweek: {
    week: [day => `Midweek peak: ${day}.`, day => `${day} carried the middle of the week.`, day => `${day}, of all days.`],
    peak: [date => `${date}: the midweek high.`, date => `${date}, middle of the week, top of the chart.`], eyebrows: ['Midweek', 'Middle of the week'],
  },
  friday: {
    week: [() => 'TGIF: Friday led the week.', () => 'Friday came to play.', () => 'Friday, every week.'],
    peak: [date => `${date}: Friday went big.`, date => `TGIF, ${date}.`], eyebrows: ['TGIF', 'Friday feeling'],
  },
  weekend: {
    week: [day => `Weekend mode: ${day} on top.`, day => `${day} ran the week.`, () => 'The weekend took the lead.'],
    peak: [date => `${date}: the weekend went big.`, date => `${date}, weekend edition.`], eyebrows: ['Weekend mode', 'Days off, money on'],
  },
};

/** The mark beside a flavoured eyebrow: an icon and the little motion it makes. */
export const FLAVOUR_MARKS: Record<Flavour, { Icon: LucideIcon; motion: 'steam' | 'drive' | 'twinkle' | 'pulse' | 'spin' | 'bob' }> = {
  food: { Icon: UtensilsCrossed, motion: 'steam' }, coffee: { Icon: Coffee, motion: 'steam' }, groceries: { Icon: ShoppingBasket, motion: 'bob' },
  transport: { Icon: Bus, motion: 'drive' }, travel: { Icon: Plane, motion: 'drive' }, housing: { Icon: House, motion: 'bob' },
  utilities: { Icon: Zap, motion: 'pulse' }, health: { Icon: HeartPulse, motion: 'pulse' }, entertainment: { Icon: Clapperboard, motion: 'bob' },
  subscriptions: { Icon: RefreshCw, motion: 'spin' }, shopping: { Icon: ShoppingBag, motion: 'bob' }, fashion: { Icon: Shirt, motion: 'twinkle' },
  beauty: { Icon: Sparkles, motion: 'twinkle' }, education: { Icon: GraduationCap, motion: 'bob' }, hobbies: { Icon: Gamepad2, motion: 'bob' },
  savings: { Icon: PiggyBank, motion: 'twinkle' }, fees: { Icon: Receipt, motion: 'bob' }, gifts: { Icon: Gift, motion: 'twinkle' }, pets: { Icon: PawPrint, motion: 'bob' },
  monday: { Icon: AlarmClock, motion: 'pulse' }, midweek: { Icon: CalendarDays, motion: 'bob' }, friday: { Icon: PartyPopper, motion: 'twinkle' }, weekend: { Icon: Sun, motion: 'spin' },
};
