import { ArrowDownRight, ArrowRightLeft, ArrowUpRight, CreditCard, type LucideIcon } from 'lucide-react';

export type EntryType = 'expense' | 'income' | 'transfer' | 'paylater';

export const entryTypes: { value: EntryType; label: string; short: string; icon: LucideIcon; accent: string }[] = [
  { value: 'expense', label: 'Expense', short: 'Expense', icon: ArrowUpRight, accent: 'var(--ref-on-surface)' },
  { value: 'income', label: 'Income', short: 'Income', icon: ArrowDownRight, accent: 'var(--color-success)' },
  { value: 'transfer', label: 'Transfer', short: 'Transfer', icon: ArrowRightLeft, accent: 'var(--ref-primary)' },
  { value: 'paylater', label: 'Settle PayLater', short: 'Settle', icon: CreditCard, accent: 'var(--ref-tertiary)' },
];

/** The colour the amount takes for each entry type, so the type is legible at a glance. */
export const entryAccent = (type: EntryType) => entryTypes.find((entry) => entry.value === type)?.accent ?? 'var(--ref-on-surface)';
