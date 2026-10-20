import type { Uncertainty } from './plan';

/** Each pot's colour, by its place in the plan: fixed order, never cycled past six (the most pots a plan holds). */
export const POT_COLORS = ['var(--color-accent)', '#0d9488', '#d97706', '#7c3aed', '#db2777', '#475569'] as const;

export function potColor(index: number): string {
  return POT_COLORS[Math.min(Math.max(0, index), POT_COLORS.length - 1)]!;
}

/** Common places to keep savings in Indonesia, with rough yearly returns after tax and how much they swing. */
export const POT_TEMPLATES: ReadonlyArray<{ name: string; returnRate: number; uncertainty: Uncertainty; title: string }> = [
  { name: 'Tabungan', returnRate: 2.5, uncertainty: 'off', title: 'A savings account: easy to reach, earns little' },
  { name: 'Deposito', returnRate: 3.6, uncertainty: 'off', title: 'A time deposit: about 4.5% before the 20% tax on interest' },
  { name: 'SBN ritel', returnRate: 6.3, uncertainty: 'low', title: 'Government bonds: ORI030 paid 7% in July 2026, 6.3% after the 10% coupon tax' },
  { name: 'Saham', returnRate: 9, uncertainty: 'high', title: 'Equity funds or shares: higher returns that swing a lot' },
];

export type PotTemplate = (typeof POT_TEMPLATES)[number];
