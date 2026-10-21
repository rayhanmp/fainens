/**
 * What a trip's packing list is made of: kinds of things, the bags they go in, a guess at an
 * item's kind from its name, and starter lists worked out from the weather, how long the trip is
 * and what you'll do there, with amounts (socks for every day, a few tops to wash and wear again).
 */

export const PACKING_CATEGORIES = ['clothes', 'toiletries', 'documents', 'electronics', 'medicine', 'other'] as const;
export type PackingCategory = (typeof PACKING_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<PackingCategory, string> = {
  clothes: 'Clothes',
  toiletries: 'Toiletries',
  documents: 'Documents and money',
  electronics: 'Electronics',
  medicine: 'Medicine',
  other: 'Other',
};

export const PACKING_BAGS = ['carry-on', 'checked', 'personal'] as const;
export type PackingBag = (typeof PACKING_BAGS)[number];
export const BAG_LABELS: Record<PackingBag, string> = { 'carry-on': 'Carry-on', checked: 'Checked bag', personal: 'Personal item' };

/** Where a kind of thing usually goes: papers and money with you, devices and medicine in the cabin, the rest checked. */
export const DEFAULT_BAG: Record<PackingCategory, PackingBag | null> = {
  documents: 'personal',
  electronics: 'carry-on',
  medicine: 'carry-on',
  clothes: 'checked',
  toiletries: 'checked',
  other: null,
};

const GUESSES: Array<[PackingCategory, RegExp]> = [
  ['documents', /passport|paspor|visa|\bktp\b|\bid\b|ticket|tiket|booking|insurance|asuransi|cash|uang|card|kartu|wallet|dompet|sim\b|licen[cs]e/i],
  ['electronics', /charger|cable|kabel|adapter|power ?bank|phone|\bhp\b|laptop|camera|kamera|headphone|earphone|earbud|e-?sim|wi-?fi|tablet|ipad|kindle|watch/i],
  ['medicine', /medicine|obat|vitamin|plaster|bandage|pain|paracetamol|panadol|antihistamine|first.?aid|p3k|mask|masker|inhaler|insulin/i],
  ['toiletries', /tooth|sikat|pasta gigi|shampoo|sampo|soap|sabun|deodorant|skincare|sunscreen|sunblock|lotion|razor|cukur|comb|sisir|lip ?balm|moisturi[sz]er|perfume|parfum|makeup|tissue|tisu|wipes/i],
  ['clothes', /shirt|kaos|kaus|baju|top|trouser|celana|pants|jeans|skirt|rok|dress|sock|underwear|dalaman|jacket|jaket|coat|sweater|hoodie|scarf|syal|glove|sarung tangan|beanie|hat|topi|shoe|sepatu|sandal|swim|renang|pyjama|piyama|sleepwear|thermal|belt|ikat pinggang|bra\b|kerudung|hijab/i],
];

/** A best guess at what kind of thing an item is, from its name; other when nothing fits. */
export function guessCategory(text: string): PackingCategory {
  return GUESSES.find(([, pattern]) => pattern.test(text))?.[0] ?? 'other';
}

export const ACTIVITIES = ['city', 'beach', 'hiking', 'snow', 'business'] as const;
export type Activity = (typeof ACTIVITIES)[number];
export const ACTIVITY_LABELS: Record<Activity, string> = { city: 'City walking', beach: 'Beach', hiking: 'Hiking', snow: 'Snow', business: 'Work' };

type Item = { text: string; category: PackingCategory; quantity?: number; bag?: PackingBag | null; shared?: boolean };
export type StarterItem = { text: string; category: PackingCategory; quantity: number; bag: PackingBag | null; travellerId: number | null };

/** The list for one trip: each person's things, then what the group shares. */
function itemsFor(climate: 'cold' | 'warm' | 'mixed', activities: readonly Activity[], days: number): Item[] {
  const nights = Math.max(1, days);
  const daily = Math.min(nights + 1, 8);
  const tops = Math.min(Math.ceil(nights / 2) + 1, 7);
  const bottoms = Math.min(Math.ceil(nights / 3) + 1, 4);
  const has = (activity: Activity) => activities.includes(activity);
  const items: Item[] = [
    { text: 'Passport', category: 'documents' },
    { text: 'ID card', category: 'documents' },
    { text: 'Cards and some local cash', category: 'documents' },
    { text: 'Underwear', category: 'clothes', quantity: daily },
    { text: 'Socks', category: 'clothes', quantity: daily },
    { text: climate === 'cold' ? 'Long-sleeved tops' : 'T-shirts and tops', category: 'clothes', quantity: tops },
    { text: climate === 'warm' ? 'Shorts and light trousers' : 'Trousers', category: 'clothes', quantity: bottoms },
    { text: 'Sleepwear', category: 'clothes' },
    { text: 'Comfortable walking shoes', category: 'clothes', bag: null },
    { text: 'Toothbrush and toothpaste', category: 'toiletries' },
    { text: 'Deodorant', category: 'toiletries' },
    { text: 'Skincare', category: 'toiletries' },
    { text: 'Your own medicines', category: 'medicine' },
    { text: 'Phone charger', category: 'electronics' },
    { text: 'Power bank', category: 'electronics' },
    { text: 'Plug adapter', category: 'electronics', shared: true },
    { text: 'Pocket Wi-Fi or eSIM', category: 'electronics', shared: true },
    { text: 'Copies of bookings and insurance', category: 'documents', shared: true },
    { text: 'Pain relievers and plasters', category: 'medicine', shared: true },
    { text: 'Laundry bag', category: 'other', bag: 'checked', shared: true },
  ];
  if (climate === 'cold') items.push(
    { text: 'Warm coat', category: 'clothes', bag: null },
    { text: 'Sweaters', category: 'clothes', quantity: 2 },
    { text: 'Thermal underwear', category: 'clothes', quantity: Math.min(nights, 3) },
    { text: 'Scarf, gloves and beanie', category: 'clothes' },
    { text: 'Lip balm and moisturiser', category: 'toiletries', bag: 'carry-on' },
  );
  if (climate === 'warm') items.push(
    { text: 'Hat and sunglasses', category: 'clothes' },
    { text: 'Sandals', category: 'clothes' },
    { text: 'Sunscreen', category: 'toiletries' },
    { text: 'Insect repellent', category: 'toiletries', shared: true },
  );
  if (climate === 'mixed') items.push(
    { text: 'A light jacket', category: 'clothes', bag: null },
    { text: 'Sunscreen', category: 'toiletries' },
  );
  if (climate !== 'cold') items.push({ text: 'Umbrella', category: 'other', bag: 'checked', shared: true });
  if (has('city')) items.push({ text: 'Day bag', category: 'other', bag: 'checked' }, { text: 'Reusable shopping bag', category: 'other', bag: 'checked', shared: true });
  if (has('beach')) items.push({ text: 'Swimwear', category: 'clothes', quantity: 2 }, { text: 'Flip-flops', category: 'clothes' }, { text: 'Beach towel', category: 'other', bag: 'checked' });
  if (has('hiking')) items.push({ text: 'Hiking shoes', category: 'clothes' }, { text: 'Rain jacket', category: 'clothes' }, { text: 'Water bottle', category: 'other', bag: 'carry-on' }, { text: 'Daypack', category: 'other', bag: 'checked' });
  if (has('snow')) items.push({ text: 'Snow boots', category: 'clothes' }, { text: 'Ski jacket and trousers', category: 'clothes' }, { text: 'Hand warmers', category: 'other', bag: 'checked', shared: true });
  if (has('business')) items.push({ text: 'Work outfits', category: 'clothes', quantity: Math.min(nights, 3) }, { text: 'Laptop and charger', category: 'electronics' }, { text: 'Business cards', category: 'documents' });
  return items;
}

/**
 * A starter list for the trip: each person's things (or the group's, before anyone's added), then
 * what the group shares, each with its kind, how many and the bag it usually goes in. What's on
 * the list already, by name and owner, is left out.
 */
export function starterList(options: {
  climate: 'cold' | 'warm' | 'mixed';
  activities: readonly Activity[];
  days: number;
  travellers: ReadonlyArray<{ id: number }>;
  existing: ReadonlyArray<{ text: string; travellerId: number | null }>;
}): StarterItem[] {
  const key = (text: string, travellerId: number | null) => `${travellerId ?? 'all'}:${text.trim().toLowerCase()}`;
  const has = new Set(options.existing.map((item) => key(item.text, item.travellerId)));
  const owners: Array<number | null> = options.travellers.length ? options.travellers.map((traveller) => traveller.id) : [null];
  const out: StarterItem[] = [];
  const push = (item: Item, travellerId: number | null) => {
    if (has.has(key(item.text, travellerId))) return;
    has.add(key(item.text, travellerId));
    out.push({ text: item.text, category: item.category, quantity: item.quantity ?? 1, bag: item.bag === undefined ? DEFAULT_BAG[item.category] : item.bag, travellerId });
  };
  const items = itemsFor(options.climate, options.activities, options.days);
  for (const owner of owners) for (const item of items.filter((entry) => !entry.shared)) push(item, owner);
  for (const item of items.filter((entry) => entry.shared)) push(item, null);
  return out;
}
