import type { GoalDraft } from './dialogs';

/**
 * Common things to save for in Indonesia, as starting points for a new goal. Amounts are left for
 * you to fill unless they can be worked out (an emergency fund from your spending); a house down
 * payment asks for the price and a share of it.
 */
export type GoalTemplate = {
  key: string;
  icon: string;
  name: string;
  /** One line on what it is or how much it usually takes. */
  hint: string;
  draft: Partial<GoalDraft>;
  /** Asks for the price and works the target out as this share (%) of it. */
  shareOfPrice?: number;
};

export const GOAL_TEMPLATES: GoalTemplate[] = [
  { key: 'emergency', icon: '🛟', name: 'Emergency fund', hint: 'Three to six months of spending, kept ready', draft: { kind: 'keep' } },
  { key: 'house', icon: '🏠', name: 'House down payment', hint: 'A share of the price, often 10–20% for a KPR', draft: { kind: 'spend' }, shareOfPrice: 20 },
  { key: 'wedding', icon: '💍', name: 'Wedding', hint: 'Venue, catering, attire and the rest', draft: { kind: 'spend' } },
  { key: 'umrah', icon: '🕋', name: 'Umrah', hint: 'Package, visa and spending money', draft: { kind: 'spend' } },
  { key: 'education', icon: '🎓', name: 'Education', hint: 'School fees or a course, by the term it starts', draft: { kind: 'spend' } },
  { key: 'gadget', icon: '💻', name: 'Gadget', hint: 'A laptop, phone or camera', draft: { kind: 'spend' } },
  { key: 'trip', icon: '✈️', name: 'Holiday', hint: 'Flights, stay and spending money', draft: { kind: 'spend' } },
  { key: 'vehicle-tax', icon: '🚗', name: 'Vehicle tax', hint: 'Pajak kendaraan, every year', draft: { kind: 'spend', recurrence: 'yearly' } },
  { key: 'insurance', icon: '🛡️', name: 'Yearly insurance', hint: 'A premium paid once a year', draft: { kind: 'spend', recurrence: 'yearly' } },
  { key: 'lebaran', icon: '🌙', name: 'Lebaran', hint: 'Mudik, hampers and THR for family, every year', draft: { kind: 'spend', recurrence: 'yearly' } },
];

/** Emoji to pick from for a goal; any other one can be typed. */
export const GOAL_ICONS = ['🎯', '🛟', '🏠', '💍', '🕋', '🎓', '💻', '📱', '✈️', '🏝️', '🚗', '🏍️', '🛡️', '🌙', '🎁', '👶', '🐶', '🏥', '📷', '🎮', '🛋️', '💼', '📈', '❤️'];
